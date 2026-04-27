from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.module_csv import ImportExecutionResponse, StandardImportSummary, parse_mapping_json, read_upload_bytes, remap_csv_bytes, rows_from_csv_bytes, suggest_header_mapping
from app.core.module_export import bytes_download_response
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_user
from app.core.permissions import require_action_access, require_module_access
from app.modules.sales.schema import (
    SalesContactCreateRequest,
    SalesContactListItem,
    SalesContactListResponse,
    SalesContactResponse,
    ContactSummaryResponse,
    SalesContactUpdateRequest,
    SalesOrganizationListResponse,
)
from app.modules.sales.services.contacts_services import (
    create_sales_contact,
    delete_sales_contact,
    export_contacts_to_csv,
    get_all_contacts,
    get_contact_or_404,
    import_contacts_from_csv,
    list_deleted_sales_contacts,
    list_sales_contacts,
    restore_sales_contact,
    update_sales_contact,
)
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.data_transfer_jobs import (
    create_data_transfer_job,
    enqueue_export_job,
    enqueue_import_job,
    persist_job_upload,
    should_background_data_transfer_with_size,
)
from app.modules.platform.schema import DataTransferExecutionResponse, DataTransferExportRequest
from app.modules.sales.services.organizations_services import search_organizations_paginated
from app.modules.sales.services.summary_services import build_contact_summary
from app.modules.user_management.services import admin_modules

router = APIRouter(prefix="/contacts", tags=["Sales"])

CONTACT_LIST_FIELDS = {
    "first_name",
    "last_name",
    "primary_email",
    "linkedin_url",
    "current_title",
    "region",
    "country",
    "organization_id",
    "organization_name",
    "assigned_to",
    "created_time",
}

CONTACT_IMPORT_TARGET_FIELDS = [
    "first_name",
    "last_name",
    "contact_telephone",
    "linkedin_url",
    "primary_email",
    "current_title",
    "region",
    "country",
    "email_opt_out",
    "assigned_to",
    "organization_id",
]

CONTACT_IMPORT_ALIASES = {
    "first_name": ["firstname", "first name", "given name"],
    "last_name": ["lastname", "last name", "surname", "family name"],
    "contact_telephone": ["phone", "telephone", "mobile", "contact telephone"],
    "linkedin_url": ["linkedin", "linkedin profile", "linkedin url"],
    "primary_email": ["email", "email address", "work email", "primary email"],
    "current_title": ["job title", "title", "designation", "current title"],
    "region": ["state", "province", "region"],
    "country": ["country", "nation"],
    "email_opt_out": ["opt out", "email opt out", "unsubscribe"],
    "assigned_to": ["owner", "assignee", "assigned to"],
    "organization_id": ["organization", "organization id", "org id", "company id"],
}


def _serialize_contact(contact) -> dict:
    return SalesContactResponse.model_validate(contact).model_dump(mode="json")


def _parse_list_fields(raw_fields: str | None, allowed_fields: set[str]) -> set[str]:
    if not raw_fields:
        return allowed_fields
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & allowed_fields
    return valid or allowed_fields


def _serialize_contact_list_item(contact, fields: set[str]) -> SalesContactListItem:
    payload = {"contact_id": contact.contact_id}
    for field in fields:
        payload[field] = getattr(contact, field, None)
    payload["custom_fields"] = getattr(contact, "custom_data", None)
    return SalesContactListItem.model_validate(payload)


@router.get("", response_model=SalesContactListResponse)
def list_contacts(
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    contacts, total_count = list_sales_contacts(
        db,
        current_user.tenant_id,
        pagination,
        search=None,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields, CONTACT_LIST_FIELDS)
    serialized = [_serialize_contact_list_item(contact, selected_fields) for contact in contacts]
    return build_paged_response(serialized, total_count, pagination)


@router.get("/search", response_model=SalesContactListResponse)
def search_contacts(
    query: str = Query(
        ...,
        min_length=1,
        description="Search by name, email, title, region, country, or LinkedIn URL",
    ),
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    contacts, total_count = list_sales_contacts(
        db,
        current_user.tenant_id,
        pagination,
        search=query,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields, CONTACT_LIST_FIELDS)
    serialized = [_serialize_contact_list_item(contact, selected_fields) for contact in contacts]
    return build_paged_response(serialized, total_count, pagination)


@router.get("/recycle", response_model=SalesContactListResponse)
def list_deleted_contacts(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "restore")),
):
    contacts, total_count = list_deleted_sales_contacts(db, current_user.tenant_id, pagination)
    serialized = [SalesContactResponse.model_validate(contact) for contact in contacts]
    return build_paged_response(serialized, total_count, pagination)


@router.post("", response_model=SalesContactResponse, status_code=status.HTTP_201_CREATED)
def create_contact(
    payload: SalesContactCreateRequest,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "create")),
):
    try:
        created = create_sales_contact(
            db=db,
            payload=payload.model_dump(),
            current_user=current_user,
            replace_duplicates=replace_duplicates,
            skip_duplicates=skip_duplicates,
            create_new_records=create_new_records,
        )
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key="sales_contacts",
            entity_type="sales_contact",
            entity_id=created.contact_id,
            action="create",
            description=f"Created contact {created.primary_email}",
            after_state=_serialize_contact(created),
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/import", response_model=ImportExecutionResponse)
async def import_contacts(
    file: UploadFile = File(...),
    mapping_json: str | None = Form(default=None),
    duplicate_mode: str | None = Query(default=None),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "create")),
):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    mapping = parse_mapping_json(mapping_json, target_headers=CONTACT_IMPORT_TARGET_FIELDS)
    remapped_file_bytes = remap_csv_bytes(
        file_bytes,
        target_headers=CONTACT_IMPORT_TARGET_FIELDS,
        mapping=mapping,
    )
    _, remapped_rows = rows_from_csv_bytes(remapped_file_bytes)
    if should_background_data_transfer_with_size(
        row_count=len(remapped_rows),
        file_size_bytes=len(remapped_file_bytes),
    ):
        job = create_data_transfer_job(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            module_key="sales_contacts",
            operation_type="import",
            payload={
                "filename": file.filename,
                "row_count": len(remapped_rows),
                "duplicate_mode": duplicate_mode or admin_modules.get_module_duplicate_mode(db, "sales_contacts", tenant_id=current_user.tenant_id),
            },
        )
        stored_path = persist_job_upload(job_id=job.id, filename="contacts-import.csv", file_bytes=remapped_file_bytes)
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
    summary = import_contacts_from_csv(
        db,
        remapped_file_bytes,
        tenant_id=current_user.tenant_id,
        default_assigned_to=current_user.id,
        duplicate_mode=duplicate_mode,
        default_duplicate_mode=admin_modules.get_module_duplicate_mode(db, "sales_contacts", tenant_id=current_user.tenant_id),
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
async def preview_contact_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "create")),
):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    source_headers, _ = rows_from_csv_bytes(file_bytes)
    return {
        "source_headers": source_headers,
        "target_headers": CONTACT_IMPORT_TARGET_FIELDS,
        "required_headers": ["primary_email"],
        "default_duplicate_mode": admin_modules.get_module_duplicate_mode(db, "sales_contacts", tenant_id=current_user.tenant_id),
        "suggested_mapping": suggest_header_mapping(
            source_headers=source_headers,
            target_headers=CONTACT_IMPORT_TARGET_FIELDS,
            aliases=CONTACT_IMPORT_ALIASES,
        ),
    }


@router.post("/export", response_model=DataTransferExecutionResponse)
def export_contacts(
    payload: DataTransferExportRequest = Body(default=DataTransferExportRequest()),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "export")),
):
    job = create_data_transfer_job(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_contacts",
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


@router.get("/organization-search", response_model=SalesOrganizationListResponse)
def search_organizations_for_contacts(
    name: str = Query(..., min_length=1, description="Organization name to match"),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    items, total = search_organizations_paginated(
        db=db,
        tenant_id=current_user.tenant_id,
        name=name,
        offset=pagination.offset,
        limit=pagination.limit,
    )
    return build_paged_response(items, total_count=total, pagination=pagination)


@router.get("/{contact_id}", response_model=SalesContactResponse)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    contact = get_contact_or_404(db, contact_id, tenant_id=current_user.tenant_id)
    return contact


@router.get("/{contact_id}/summary", response_model=ContactSummaryResponse)
def get_contact_summary(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    contact = get_contact_or_404(db, contact_id, tenant_id=current_user.tenant_id)
    return build_contact_summary(db, contact)


@router.put("/{contact_id}", response_model=SalesContactResponse)
def update_contact(
    contact_id: int,
    payload: SalesContactUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "edit")),
):
    contact = get_contact_or_404(db, contact_id, tenant_id=current_user.tenant_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return contact

    before_state = _serialize_contact(contact)
    updated = update_sales_contact(db, contact, update_data)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_contacts",
        entity_type="sales_contact",
        entity_id=updated.contact_id,
        action="update",
        description=f"Updated contact {updated.primary_email}",
        before_state=before_state,
        after_state=_serialize_contact(updated),
    )
    return updated


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "delete")),
):
    contact = get_contact_or_404(db, contact_id, tenant_id=current_user.tenant_id)
    before_state = _serialize_contact(contact)
    delete_sales_contact(db, contact)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_contacts",
        entity_type="sales_contact",
        entity_id=contact.contact_id,
        action="soft_delete",
        description=f"Moved contact {contact.primary_email} to recycle bin",
        before_state=before_state,
    )


@router.post("/{contact_id}/restore", response_model=SalesContactResponse)
def restore_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "restore")),
):
    contact = get_contact_or_404(db, contact_id, tenant_id=current_user.tenant_id, include_deleted=True)
    restored = restore_sales_contact(db, contact)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_contacts",
        entity_type="sales_contact",
        entity_id=restored.contact_id,
        action="restore",
        description=f"Restored contact {restored.primary_email} from recycle bin",
        after_state=_serialize_contact(restored),
    )
    return restored
