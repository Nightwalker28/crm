from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_csv import (
    ImportExecutionResponse,
    StandardImportSummary,
    count_csv_rows_bytes,
    parse_mapping_json,
    read_upload_bytes,
    remap_csv_bytes,
    rows_from_csv_bytes,
    suggest_header_mapping,
)
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.access_control import require_role_module_action_access
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema import DataTransferExecutionResponse, DataTransferExportRequest
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.data_transfer_jobs import (
    create_data_transfer_job,
    enqueue_export_job,
    enqueue_import_job,
    persist_job_upload,
    should_background_data_transfer_with_size,
)
from app.modules.platform.services.module_fields import (
    enabled_module_fields,
    enabled_module_field_sequence,
    reject_disabled_field_writes,
    sanitize_data_transfer_export_payload,
    sanitize_disabled_field_payload,
    sanitize_disabled_filter_conditions,
)
from app.modules.sales.schema import (
    LeadConversionRequest,
    LeadConversionResponse,
    LeadSummaryResponse,
    SalesLeadCreateRequest,
    SalesLeadListItem,
    SalesLeadListResponse,
    SalesLeadResponse,
    SalesLeadUpdateRequest,
)
from app.modules.sales.services.followups import log_lead_follow_up
from app.modules.sales.schema import FollowUpActionRequest, FollowUpActionResponse
from app.modules.sales.services.leads_services import (
    EXPORT_COLUMNS,
    convert_sales_lead,
    create_sales_lead,
    delete_sales_lead,
    get_lead_or_404,
    import_leads_from_csv,
    list_deleted_sales_leads,
    list_sales_leads,
    list_sales_leads_cursor,
    restore_sales_lead,
    update_sales_lead,
)
from app.modules.user_management.services import admin_modules

router = APIRouter(prefix="/leads", tags=["Sales"])

LEAD_LIST_FIELDS = {
    "first_name",
    "last_name",
    "company",
    "primary_email",
    "phone",
    "title",
    "source",
    "status",
    "assigned_to",
    "created_time",
    "last_contacted_at",
    "last_contacted_channel",
}

LEAD_IMPORT_TARGET_FIELDS = [
    "first_name",
    "last_name",
    "company",
    "primary_email",
    "phone",
    "title",
    "source",
    "status",
    "notes",
    "assigned_to",
]

LEAD_IMPORT_ALIASES = {
    "first_name": ["firstname", "first name", "given name"],
    "last_name": ["lastname", "last name", "surname"],
    "company": ["company", "account", "organization"],
    "primary_email": ["email", "email address", "primary email", "work email"],
    "phone": ["phone", "telephone", "mobile"],
    "title": ["job title", "designation"],
    "source": ["lead source", "source"],
    "status": ["lead status", "status"],
    "notes": ["note", "notes"],
    "assigned_to": ["owner", "assignee", "assigned to"],
}


def _serialize_lead(lead) -> dict:
    return SalesLeadResponse.model_validate(lead).model_dump(mode="json")


def _display_lead_name(lead) -> str:
    full_name = " ".join(part for part in [getattr(lead, "first_name", None), getattr(lead, "last_name", None)] if part).strip()
    return full_name or getattr(lead, "primary_email", None) or "Lead"


def _parse_list_fields(raw_fields: str | None, allowed_fields: set[str]) -> set[str]:
    if not raw_fields:
        return allowed_fields
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & allowed_fields
    return valid or allowed_fields


def _enabled_lead_list_fields(db: Session, tenant_id: int) -> set[str]:
    return enabled_module_fields(db, tenant_id=tenant_id, module_key="sales_leads", field_keys=LEAD_LIST_FIELDS)


def _enabled_lead_import_fields(db: Session, tenant_id: int) -> list[str]:
    return enabled_module_field_sequence(db, tenant_id=tenant_id, module_key="sales_leads", field_keys=LEAD_IMPORT_TARGET_FIELDS)


def _require_conversion_target_permissions(db: Session, current_user, payload: LeadConversionRequest) -> None:
    required: list[tuple[str, str]] = []
    if payload.account_id is not None:
        required.append(("sales_organizations", "view"))
    elif payload.create_account:
        required.append(("sales_organizations", "create"))

    if payload.contact_id is not None:
        required.append(("sales_contacts", "view"))
    elif payload.create_contact:
        required.append(("sales_contacts", "create"))

    if payload.create_deal:
        required.append(("sales_opportunities", "create"))

    for module_key, action in required:
        try:
            require_role_module_action_access(db, user=current_user, module_key=module_key, action=action)
        except ValueError as exc:
            detail = str(exc)
            if detail in {"module not found", "unknown action"}:
                raise HTTPException(status_code=500, detail=detail) from exc
            raise
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc


def _serialize_lead_list_item(lead, fields: set[str]) -> SalesLeadListItem:
    payload = {"lead_id": lead.lead_id}
    for field in fields:
        payload[field] = getattr(lead, field, None)
    payload["custom_fields"] = getattr(lead, "custom_data", None)
    return SalesLeadListItem.model_validate(payload)


def _parse_filters(db: Session, tenant_id: int, filter_logic: str, filters: str | None, filters_all: str | None, filters_any: str | None):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=tenant_id, module_key="sales_leads", conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=tenant_id, module_key="sales_leads", conditions=any_conditions)
    return all_conditions, any_conditions


@router.get("", response_model=SalesLeadListResponse)
def list_leads(
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "view")),
):
    all_conditions, any_conditions = _parse_filters(db, current_user.tenant_id, filter_logic, filters, filters_all, filters_any)
    leads, total_count = list_sales_leads(
        db,
        current_user.tenant_id,
        pagination,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields, _enabled_lead_list_fields(db, current_user.tenant_id))
    return build_paged_response([_serialize_lead_list_item(lead, selected_fields) for lead in leads], total_count, pagination)


@router.get("/cursor")
def list_leads_cursor(
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "view")),
):
    all_conditions, any_conditions = _parse_filters(db, current_user.tenant_id, filter_logic, filters, filters_all, filters_any)
    leads = list_sales_leads_cursor(
        db,
        current_user.tenant_id,
        limit=pagination.limit,
        cursor=pagination.cursor,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields, _enabled_lead_list_fields(db, current_user.tenant_id))
    return build_cursor_response([_serialize_lead_list_item(lead, selected_fields) for lead in leads], limit=pagination.limit, id_attr="lead_id")


@router.get("/search", response_model=SalesLeadListResponse)
def search_leads(
    query: str = Query(..., min_length=1),
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "view")),
):
    all_conditions, any_conditions = _parse_filters(db, current_user.tenant_id, filter_logic, filters, filters_all, filters_any)
    leads, total_count = list_sales_leads(
        db,
        current_user.tenant_id,
        pagination,
        search=query,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields, _enabled_lead_list_fields(db, current_user.tenant_id))
    return build_paged_response([_serialize_lead_list_item(lead, selected_fields) for lead in leads], total_count, pagination)


@router.get("/recycle", response_model=SalesLeadListResponse)
def list_deleted_leads(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "restore")),
):
    leads, total_count = list_deleted_sales_leads(db, current_user.tenant_id, pagination)
    return build_paged_response([SalesLeadResponse.model_validate(lead) for lead in leads], total_count, pagination)


@router.post("", response_model=SalesLeadResponse, status_code=status.HTTP_201_CREATED)
def create_lead(
    payload: SalesLeadCreateRequest,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "create")),
):
    submitted_fields = set(payload.model_fields_set) - {"custom_fields"}
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key="sales_leads", field_keys=submitted_fields)
    sanitized_payload = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key="sales_leads", payload=payload.model_dump())
    created = create_sales_lead(db, sanitized_payload, current_user, replace_duplicates, skip_duplicates, create_new_records)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_leads",
        entity_type="sales_lead",
        entity_id=created.lead_id,
        action="create",
        description=f"Created lead {_display_lead_name(created)}",
        after_state=_serialize_lead(created),
    )
    return created


@router.post("/import", response_model=ImportExecutionResponse)
async def import_leads(
    file: UploadFile = File(...),
    mapping_json: str | None = Form(default=None),
    duplicate_mode: str | None = Query(default=None),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "create")),
):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    target_headers = _enabled_lead_import_fields(db, current_user.tenant_id)
    mapping = parse_mapping_json(mapping_json, target_headers=target_headers)
    remapped_file_bytes = remap_csv_bytes(file_bytes, target_headers=target_headers, mapping=mapping)
    row_count = count_csv_rows_bytes(remapped_file_bytes)
    if should_background_data_transfer_with_size(row_count=row_count, file_size_bytes=len(remapped_file_bytes)):
        job = create_data_transfer_job(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            module_key="sales_leads",
            operation_type="import",
            payload={
                "filename": file.filename,
                "row_count": row_count,
                "duplicate_mode": duplicate_mode or admin_modules.get_module_duplicate_mode(db, "sales_leads", tenant_id=current_user.tenant_id),
            },
        )
        stored_path = persist_job_upload(job_id=job.id, filename="leads-import.csv", file_bytes=remapped_file_bytes)
        job.payload = {**(job.payload or {}), "source_file_path": stored_path}
        db.add(job)
        db.commit()
        db.refresh(job)
        enqueue_import_job(job.id)
        return ImportExecutionResponse(mode="background", message=f"Import queued in background as job #{job.id}.", job_id=job.id, job_status=job.status)
    summary = import_leads_from_csv(
        db,
        remapped_file_bytes,
        tenant_id=current_user.tenant_id,
        default_assigned_to=current_user.id,
        duplicate_mode=duplicate_mode,
        default_duplicate_mode=admin_modules.get_module_duplicate_mode(db, "sales_leads", tenant_id=current_user.tenant_id),
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    return ImportExecutionResponse(mode="inline", message=summary["message"], summary=StandardImportSummary(**summary))


@router.post("/import/preview")
async def preview_lead_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "create")),
):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    source_headers, _ = rows_from_csv_bytes(file_bytes)
    return {
        "source_headers": source_headers,
        "target_headers": _enabled_lead_import_fields(db, current_user.tenant_id),
        "required_headers": ["primary_email"],
        "default_duplicate_mode": admin_modules.get_module_duplicate_mode(db, "sales_leads", tenant_id=current_user.tenant_id),
        "suggested_mapping": suggest_header_mapping(
            source_headers=source_headers,
            target_headers=_enabled_lead_import_fields(db, current_user.tenant_id),
            aliases=LEAD_IMPORT_ALIASES,
        ),
    }


@router.post("/export", response_model=DataTransferExecutionResponse)
def export_leads(
    payload: DataTransferExportRequest = Body(default=DataTransferExportRequest()),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "export")),
):
    sanitized_payload = sanitize_data_transfer_export_payload(
        db,
        tenant_id=current_user.tenant_id,
        module_key="sales_leads",
        payload=payload.model_dump(),
        export_field_keys=EXPORT_COLUMNS,
    )
    job = create_data_transfer_job(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_leads",
        operation_type="export",
        payload=sanitized_payload,
    )
    enqueue_export_job(job.id)
    return DataTransferExecutionResponse(mode="background", message=f"Export queued in background as job #{job.id}.", job_id=job.id, job_status=job.status)


@router.get("/{lead_id}", response_model=SalesLeadResponse)
def get_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "view")),
):
    return get_lead_or_404(db, lead_id, tenant_id=current_user.tenant_id)


@router.get("/{lead_id}/summary", response_model=LeadSummaryResponse)
def get_lead_summary(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "view")),
):
    return LeadSummaryResponse(lead=get_lead_or_404(db, lead_id, tenant_id=current_user.tenant_id))


@router.post("/{lead_id}/follow-up", response_model=FollowUpActionResponse)
def log_lead_follow_up_route(
    lead_id: int,
    payload: FollowUpActionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "edit")),
):
    lead = get_lead_or_404(db, lead_id, tenant_id=current_user.tenant_id)
    return log_lead_follow_up(db, lead=lead, payload=payload.model_dump(), current_user=current_user)


@router.post("/{lead_id}/convert", response_model=LeadConversionResponse)
def convert_lead(
    lead_id: int,
    payload: LeadConversionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "edit")),
):
    lead = get_lead_or_404(db, lead_id, tenant_id=current_user.tenant_id)
    _require_conversion_target_permissions(db, current_user, payload)
    before_state = _serialize_lead(lead)
    result = convert_sales_lead(db, lead, payload.model_dump(), current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_leads",
        entity_type="sales_lead",
        entity_id=result["lead"].lead_id,
        action="convert",
        description=f"Converted lead {_display_lead_name(result['lead'])}",
        before_state=before_state,
        after_state={
            **_serialize_lead(result["lead"]),
            "account_id": result["account_id"],
            "contact_id": result["contact_id"],
            "deal_id": result["deal_id"],
        },
    )
    return LeadConversionResponse.model_validate(result)


@router.put("/{lead_id}", response_model=SalesLeadResponse)
def update_lead(
    lead_id: int,
    payload: SalesLeadUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "edit")),
):
    lead = get_lead_or_404(db, lead_id, tenant_id=current_user.tenant_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return lead
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key="sales_leads", field_keys=set(update_data) - {"custom_fields"})
    update_data = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key="sales_leads", payload=update_data)
    before_state = _serialize_lead(lead)
    updated = update_sales_lead(db, lead, update_data)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_leads",
        entity_type="sales_lead",
        entity_id=updated.lead_id,
        action="update",
        description=f"Updated lead {_display_lead_name(updated)}",
        before_state=before_state,
        after_state=_serialize_lead(updated),
    )
    return updated


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "delete")),
):
    lead = get_lead_or_404(db, lead_id, tenant_id=current_user.tenant_id)
    before_state = _serialize_lead(lead)
    delete_sales_lead(db, lead)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_leads",
        entity_type="sales_lead",
        entity_id=lead.lead_id,
        action="soft_delete",
        description=f"Moved lead {_display_lead_name(lead)} to recycle bin",
        before_state=before_state,
    )


@router.post("/{lead_id}/restore", response_model=SalesLeadResponse)
def restore_lead(
    lead_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("sales_leads")),
    require_permission=Depends(require_action_access("sales_leads", "restore")),
):
    lead = get_lead_or_404(db, lead_id, tenant_id=current_user.tenant_id, include_deleted=True)
    restored = restore_sales_lead(db, lead)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_leads",
        entity_type="sales_lead",
        entity_id=restored.lead_id,
        action="restore",
        description=f"Restored lead {_display_lead_name(restored)} from recycle bin",
        after_state=_serialize_lead(restored),
    )
    return restored
