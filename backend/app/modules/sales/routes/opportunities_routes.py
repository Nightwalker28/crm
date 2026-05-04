from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_csv import ImportExecutionResponse, StandardImportSummary, parse_mapping_json, read_upload_bytes, remap_csv_bytes, rows_from_csv_bytes, suggest_header_mapping
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.crm_events import actor_payload, safe_emit_crm_event
from app.modules.platform.services.data_transfer_jobs import (
    create_data_transfer_job,
    enqueue_export_job,
    enqueue_import_job,
    persist_job_upload,
    should_background_data_transfer_with_size,
)
from app.modules.platform.schema import DataTransferExecutionResponse, DataTransferExportRequest
from app.modules.user_management.services import admin_modules
from app.modules.sales.schema import (
    FollowUpActionRequest,
    FollowUpActionResponse,
    OpportunityPipelineSummaryResponse,
    OpportunitySummaryResponse,
    SalesOpportunityCreate,
    SalesOpportunityListItem,
    SalesOpportunityListResponse,
    SalesOpportunityResponse,
    SalesOpportunityUpdate,
)
from app.modules.sales.services.followups import log_opportunity_follow_up
from app.modules.sales.services import opportunities_api
from app.modules.sales.services.summary_services import build_opportunity_summary
from app.modules.sales.services.opportunities_services import (
    create_opportunity,
    delete_opportunity,
    export_opportunities_to_csv,
    get_opportunity_or_404,
    import_opportunities_from_csv,
    list_deleted_opportunities,
    list_opportunities,
    restore_opportunity,
    summarize_opportunity_pipeline,
    update_opportunity,
)

router = APIRouter(prefix="/opportunities", tags=["Sales"])

OPPORTUNITY_LIST_FIELDS = {
    "opportunity_name",
    "client",
    "sales_stage",
    "expected_close_date",
    "total_cost_of_project",
    "currency_type",
    "created_time",
}

OPPORTUNITY_IMPORT_TARGET_FIELDS = [
    "opportunity_name",
    "contact_id",
    "organization_id",
    "assigned_to",
    "sales_stage",
    "start_date",
    "expected_close_date",
    "campaign_type",
    "total_leads",
    "cpl",
    "total_cost_of_project",
    "currency_type",
    "target_geography",
    "target_audience",
    "domain_cap",
    "tactics",
    "delivery_format",
]

OPPORTUNITY_IMPORT_ALIASES = {
    "opportunity_name": ["name", "opportunity", "deal name", "opportunity name"],
    "contact_id": ["contact", "contact id", "client", "client id"],
    "organization_id": ["organization", "organization id", "org id", "company id"],
    "assigned_to": ["owner", "assignee", "assigned to"],
    "sales_stage": ["stage", "pipeline stage", "sales stage"],
    "start_date": ["start", "start date"],
    "expected_close_date": ["close date", "expected close", "expected close date"],
    "campaign_type": ["type", "campaign type"],
    "total_leads": ["leads", "total leads"],
    "cpl": ["cost per lead", "cpl"],
    "total_cost_of_project": ["project cost", "total cost", "total project cost"],
    "currency_type": ["currency", "currency type"],
    "target_geography": ["geography", "target geography", "region"],
    "target_audience": ["audience", "target audience"],
    "domain_cap": ["domain cap"],
    "tactics": ["tactic", "tactics"],
    "delivery_format": ["format", "delivery format"],
}


def _serialize_opportunity(opportunity) -> dict:
    return SalesOpportunityResponse.model_validate(opportunity).model_dump(mode="json")


def _display_user_name(user) -> str | None:
    if not user:
        return None
    full_name = " ".join(part for part in [getattr(user, "first_name", None), getattr(user, "last_name", None)] if part).strip()
    return full_name or getattr(user, "email", None) or None


def _emit_deal_assigned_event(db: Session, *, current_user, opportunity) -> None:
    if not getattr(opportunity, "assigned_to", None):
        return
    safe_emit_crm_event(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        event_type="deal.assigned",
        entity_type="sales_opportunity",
        entity_id=opportunity.opportunity_id,
        payload={
            **actor_payload(current_user),
            "deal_name": opportunity.opportunity_name,
            "company": getattr(getattr(opportunity, "organization", None), "org_name", None) or opportunity.client,
            "deal_value": opportunity.total_cost_of_project,
            "stage": opportunity.sales_stage,
            "assigned_to": opportunity.assigned_to,
            "assigned_to_name": _display_user_name(getattr(opportunity, "assigned_user", None)),
            "href": f"/dashboard/sales/opportunities/{opportunity.opportunity_id}",
        },
    )


def _parse_list_fields(raw_fields: str | None) -> set[str]:
    if not raw_fields:
        return OPPORTUNITY_LIST_FIELDS
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & OPPORTUNITY_LIST_FIELDS
    return valid or OPPORTUNITY_LIST_FIELDS


def _serialize_opportunity_list_item(opportunity, fields: set[str]) -> SalesOpportunityListItem:
    safe_fields = set(fields)
    safe_fields.update(
        {
            "assigned_to",
            "contact_id",
            "organization_id",
            "start_date",
            "campaign_type",
            "total_leads",
            "cpl",
            "target_geography",
            "target_audience",
            "domain_cap",
            "tactics",
            "delivery_format",
            "attachments",
            "custom_fields",
        }
    )
    payload = {"opportunity_id": opportunity.opportunity_id}
    for field in safe_fields:
        if field == "custom_fields":
            payload[field] = getattr(opportunity, "custom_data", None)
        else:
            payload[field] = getattr(opportunity, field, None)
    return SalesOpportunityListItem.model_validate(payload)


@router.get("", response_model=SalesOpportunityListResponse)
def list_sales_opportunities(
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    items, total_count = list_opportunities(
        db,
        current_user.tenant_id,
        pagination,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields)
    serialized = [_serialize_opportunity_list_item(item, selected_fields) for item in items]
    return build_paged_response(serialized, total_count, pagination)


@router.get("/search", response_model=SalesOpportunityListResponse)
def search_sales_opportunities(
    query: str = Query(..., min_length=1, description="Search by opportunity fields"),
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    items, total_count = list_opportunities(
        db,
        current_user.tenant_id,
        pagination,
        search=query,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields)
    serialized = [_serialize_opportunity_list_item(item, selected_fields) for item in items]
    return build_paged_response(serialized, total_count, pagination)


@router.get("/pipeline-summary", response_model=OpportunityPipelineSummaryResponse)
def get_sales_opportunity_pipeline_summary(
    query: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return summarize_opportunity_pipeline(
        db,
        current_user.tenant_id,
        search=query.strip() if isinstance(query, str) and query.strip() else None,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )


@router.get("/recycle", response_model=SalesOpportunityListResponse)
def list_deleted_sales_opportunities(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "restore")),
):
    items, total_count = list_deleted_opportunities(db, current_user.tenant_id, pagination)
    serialized = [SalesOpportunityResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count, pagination)


@router.post("", response_model=SalesOpportunityResponse, status_code=status.HTTP_201_CREATED)
def create_sales_opportunity(
    payload: SalesOpportunityCreate,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "create")),
):
    data = payload.model_dump()
    if not data.get("assigned_to"):
        data["assigned_to"] = current_user.id
    opportunity = create_opportunity(db, data, current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=opportunity.opportunity_id,
        action="create",
        description=f"Created opportunity {opportunity.opportunity_name}",
        after_state=_serialize_opportunity(opportunity),
    )
    _emit_deal_assigned_event(db, current_user=current_user, opportunity=opportunity)
    return SalesOpportunityResponse.model_validate(opportunity)


@router.post("/{opportunity_id}/attachments", response_model=SalesOpportunityResponse, status_code=status.HTTP_201_CREATED)
async def upload_opportunity_attachments(
    opportunity_id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "edit")),
):
    return await opportunities_api.upload_opportunity_attachments(
        db,
        opportunity_id=opportunity_id,
        tenant_id=current_user.tenant_id,
        files=files,
    )


@router.delete("/{opportunity_id}/attachments", response_model=SalesOpportunityResponse)
def delete_opportunity_attachments(
    opportunity_id: int,
    attachments: list[str] = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "edit")),
):
    return opportunities_api.delete_opportunity_attachments(
        db,
        opportunity_id=opportunity_id,
        tenant_id=current_user.tenant_id,
        attachments=attachments,
    )


@router.get("/{opportunity_id}", response_model=SalesOpportunityResponse)
def get_sales_opportunity(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "view")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    return SalesOpportunityResponse.model_validate(opportunity)


@router.get("/{opportunity_id}/summary", response_model=OpportunitySummaryResponse)
def get_sales_opportunity_summary(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "view")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    return build_opportunity_summary(db, opportunity)


@router.post("/{opportunity_id}/follow-up", response_model=FollowUpActionResponse)
def log_opportunity_follow_up_route(
    opportunity_id: int,
    payload: FollowUpActionRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "edit")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    return log_opportunity_follow_up(
        db,
        opportunity=opportunity,
        payload=payload.model_dump(),
        current_user=current_user,
    )


@router.put("/{opportunity_id}", response_model=SalesOpportunityResponse)
def update_sales_opportunity(
    opportunity_id: int,
    payload: SalesOpportunityUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "edit")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return SalesOpportunityResponse.model_validate(opportunity)

    before_state = _serialize_opportunity(opportunity)
    updated = update_opportunity(db, opportunity, update_data, current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=updated.opportunity_id,
        action="update",
        description=f"Updated opportunity {updated.opportunity_name}",
        before_state=before_state,
        after_state=_serialize_opportunity(updated),
    )
    if "assigned_to" in update_data and before_state.get("assigned_to") != updated.assigned_to:
        _emit_deal_assigned_event(db, current_user=current_user, opportunity=updated)
    return SalesOpportunityResponse.model_validate(updated)


@router.delete("/{opportunity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sales_opportunity(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "delete")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id)
    before_state = _serialize_opportunity(opportunity)
    delete_opportunity(db, opportunity)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=opportunity.opportunity_id,
        action="soft_delete",
        description=f"Moved opportunity {opportunity.opportunity_name} to recycle bin",
        before_state=before_state,
    )


@router.post("/{opportunity_id}/restore", response_model=SalesOpportunityResponse)
def restore_sales_opportunity(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "restore")),
):
    opportunity = get_opportunity_or_404(db, opportunity_id, tenant_id=current_user.tenant_id, include_deleted=True)
    if opportunity.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Opportunity is not in recycle bin")
    restored = restore_opportunity(db, opportunity)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=restored.opportunity_id,
        action="restore",
        description=f"Restored opportunity {restored.opportunity_name} from recycle bin",
        after_state=_serialize_opportunity(restored),
    )
    return SalesOpportunityResponse.model_validate(restored)


@router.post("/{opportunity_id}/create_finance_io")
def create_finance_io(
    opportunity_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "create")),
):
    return opportunities_api.create_finance_io_for_opportunity(
        db,
        opportunity_id=opportunity_id,
        current_user=current_user,
    )


@router.post("/import", response_model=ImportExecutionResponse, status_code=status.HTTP_201_CREATED)
async def import_sales_opportunities(
    file: UploadFile = File(...),
    mapping_json: str | None = Form(default=None),
    duplicate_mode: str | None = Query(default=None),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "create")),
):
    content = await read_upload_bytes(file, allowed_extensions={"csv"})
    mapping = parse_mapping_json(mapping_json, target_headers=OPPORTUNITY_IMPORT_TARGET_FIELDS)
    remapped_content = remap_csv_bytes(
        content,
        target_headers=OPPORTUNITY_IMPORT_TARGET_FIELDS,
        mapping=mapping,
    )
    _, remapped_rows = rows_from_csv_bytes(remapped_content)
    if should_background_data_transfer_with_size(
        row_count=len(remapped_rows),
        file_size_bytes=len(remapped_content),
    ):
        mode = duplicate_mode or admin_modules.get_module_duplicate_mode(db, "sales_opportunities", tenant_id=current_user.tenant_id)
        job = create_data_transfer_job(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            module_key="sales_opportunities",
            operation_type="import",
            payload={"filename": file.filename, "row_count": len(remapped_rows), "duplicate_mode": mode},
        )
        stored_path = persist_job_upload(job_id=job.id, filename="opportunities-import.csv", file_bytes=remapped_content)
        job.payload = {
            **(job.payload or {}),
            "source_file_path": stored_path,
        }
        db.add(job)
        db.commit()
        db.refresh(job)
        enqueue_import_job(job.id)
        return ImportExecutionResponse(
            mode="background",
            message=f"Import queued in background as job #{job.id}.",
            job_id=job.id,
            job_status=job.status,
        )
    summary = import_opportunities_from_csv(
        db=db,
        file_bytes=remapped_content,
        current_user=current_user,
        duplicate_mode=duplicate_mode,
        default_duplicate_mode=admin_modules.get_module_duplicate_mode(db, "sales_opportunities", tenant_id=current_user.tenant_id),
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    return ImportExecutionResponse(
        mode="inline",
        message=summary["message"],
        summary=StandardImportSummary(**summary),
    )


@router.post("/import/preview")
async def preview_sales_opportunities_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "create")),
):
    content = await read_upload_bytes(file, allowed_extensions={"csv"})
    source_headers, _ = rows_from_csv_bytes(content)
    return {
        "source_headers": source_headers,
        "target_headers": OPPORTUNITY_IMPORT_TARGET_FIELDS,
        "required_headers": ["opportunity_name", "contact_id"],
        "default_duplicate_mode": admin_modules.get_module_duplicate_mode(db, "sales_opportunities", tenant_id=current_user.tenant_id),
        "suggested_mapping": suggest_header_mapping(
            source_headers=source_headers,
            target_headers=OPPORTUNITY_IMPORT_TARGET_FIELDS,
            aliases=OPPORTUNITY_IMPORT_ALIASES,
        ),
    }


@router.post("/export", response_model=DataTransferExecutionResponse)
def export_sales_opportunities(
    payload: DataTransferExportRequest = Body(default=DataTransferExportRequest()),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_opportunities")),
    require_permission = Depends(require_action_access("sales_opportunities", "export")),
):
    job = create_data_transfer_job(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_opportunities",
        operation_type="export",
        payload=payload.model_dump(),
    )
    enqueue_export_job(job.id)
    return DataTransferExecutionResponse(
        mode="background",
        message=f"Export queued in background as job #{job.id}.",
        job_id=job.id,
        job_status=job.status,
    )
