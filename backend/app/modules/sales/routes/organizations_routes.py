from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi import File, UploadFile, Body, Form
from sqlalchemy.orm import Session

from app.core.pagination import Pagination, get_pagination, build_paged_response
from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.module_csv import ImportExecutionResponse, StandardImportSummary, parse_mapping_json, read_upload_bytes, remap_csv_bytes, rows_from_csv_bytes, suggest_header_mapping
from app.core.security import require_user
from app.core.permissions import require_action_access, require_module_access
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.data_transfer_jobs import (
    create_data_transfer_job,
    enqueue_export_job,
    enqueue_import_job,
    persist_job_upload,
    should_background_data_transfer_with_size,
)
from app.modules.platform.schema import DataTransferExecutionResponse, DataTransferExportRequest
from app.modules.sales.schema import (
    SalesOrganizationCreate,
    SalesOrganizationListItem,
    SalesOrganizationUpdate,
    OrganizationSummaryResponse,
    SalesOrganizationResponse,
    SalesOrganizationListResponse,
)
from app.modules.sales.services.organizations_services import (
    create_organization,
    list_deleted_organizations_paginated,
    list_organizations_paginated,
    search_organizations_pagianted,
    get_organization,
    restore_organization,
    update_organization,
    delete_organization,
    import_organizations_from_csv,
    export_organizations,
)
from app.modules.sales.services.summary_services import build_organization_summary
from app.modules.user_management.services import admin_modules

router = APIRouter(prefix="/organizations", tags=["Sales"])

ORGANIZATION_LIST_FIELDS = {
    "org_name",
    "primary_email",
    "website",
    "industry",
    "annual_revenue",
    "primary_phone",
    "billing_country",
}

ORGANIZATION_IMPORT_TARGET_FIELDS = [
    "org_name",
    "primary_email",
    "website",
    "primary_phone",
    "secondary_phone",
    "secondary_email",
    "industry",
    "annual_revenue",
    "billing_address",
    "billing_city",
    "billing_state",
    "billing_postal_code",
    "billing_country",
]

ORGANIZATION_IMPORT_ALIASES = {
    "org_name": ["organization", "organization name", "org name", "company", "company name", "customer"],
    "primary_email": ["email", "email address", "primary email", "company email"],
    "website": ["url", "website url", "domain"],
    "primary_phone": ["phone", "primary phone", "telephone"],
    "secondary_phone": ["alternate phone", "secondary phone"],
    "secondary_email": ["alternate email", "secondary email"],
    "industry": ["vertical", "industry type"],
    "annual_revenue": ["revenue", "annual revenue"],
    "billing_address": ["address", "billing address"],
    "billing_city": ["city", "billing city"],
    "billing_state": ["state", "province", "billing state"],
    "billing_postal_code": ["postal code", "zip", "zip code"],
    "billing_country": ["country", "billing country"],
}


def _serialize_organization(org) -> dict:
    return SalesOrganizationResponse.model_validate(org).model_dump(mode="json")


def _parse_list_fields(raw_fields: str | None, allowed_fields: set[str]) -> set[str]:
    if not raw_fields:
        return allowed_fields
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & allowed_fields
    return valid or allowed_fields


def _serialize_organization_list_item(org, fields: set[str]) -> SalesOrganizationListItem:
    payload = {"org_id": org.org_id}
    for field in fields:
        payload[field] = getattr(org, field, None)
    payload["custom_fields"] = getattr(org, "custom_data", None)
    return SalesOrganizationListItem.model_validate(payload)

# create
@router.post("/create", response_model=SalesOrganizationResponse, status_code=status.HTTP_201_CREATED)
def create_sales_organization(
    payload: SalesOrganizationCreate,
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access("sales_organizations")),
    require_permission = Depends(require_action_access("sales_organizations", "create")),
):
    try:
        created = create_organization(
            db=db,
            payload=payload,
            current_user=current_user,
            replace_duplicates=replace_duplicates,
            skip_duplicates=skip_duplicates,
            create_new_records=create_new_records,
        )
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key="sales_organizations",
            entity_type="sales_organization",
            entity_id=created.org_id,
            action="create",
            description=f"Created organization {created.org_name}",
            after_state=_serialize_organization(created),
        )
        return created
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    

# read all
@router.get("", response_model=SalesOrganizationListResponse)
def get_sales_organizations(
    search: str | None = Query(default=None, min_length=1),
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if search:
        items, total = search_organizations_pagianted(
            db=db,
            tenant_id=current_user.tenant_id,
            name=search,
            offset=pagination.offset,
            limit=pagination.limit,
            all_filter_conditions=all_conditions,
            any_filter_conditions=any_conditions,
        )
    else:
        items, total = list_organizations_paginated(
            db=db,
            tenant_id=current_user.tenant_id,
            offset=pagination.offset,
            limit=pagination.limit,
            all_filter_conditions=all_conditions,
            any_filter_conditions=any_conditions,
        )
    selected_fields = _parse_list_fields(fields, ORGANIZATION_LIST_FIELDS)
    serialized = [_serialize_organization_list_item(item, selected_fields) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)


@router.get("/recycle", response_model=SalesOrganizationListResponse)
def get_deleted_sales_organizations(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "restore")),
):
    items, total = list_deleted_organizations_paginated(
        db=db,
        tenant_id=current_user.tenant_id,
        offset=pagination.offset,
        limit=pagination.limit,
    )
    serialized = [SalesOrganizationResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)

# search
@router.get("/search/{name}", response_model=SalesOrganizationListResponse)
def search_sales_organizations(
    name: str,
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db:  Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    items, total = search_organizations_pagianted(
        db,
        name,
        tenant_id=current_user.tenant_id,
        offset=pagination.offset,
        limit=pagination.limit,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields, ORGANIZATION_LIST_FIELDS)
    serialized = [_serialize_organization_list_item(item, selected_fields) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)

# read single
@router.get("/{org_id}", response_model=SalesOrganizationResponse)
def get_sales_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "view")),
):
    org = get_organization(db=db, org_id=org_id, tenant_id=current_user.tenant_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    return org


@router.get("/{org_id}/summary", response_model=OrganizationSummaryResponse)
def get_sales_organization_summary(
    org_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "view")),
):
    org = get_organization(db=db, org_id=org_id, tenant_id=current_user.tenant_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    return build_organization_summary(db, org)

# update
@router.put("/{org_id}", response_model=SalesOrganizationResponse)
def edit_sales_organization(
    org_id: int,
    payload: SalesOrganizationUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "edit")),
):
    existing = get_organization(db=db, org_id=org_id, tenant_id=current_user.tenant_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    before_state = _serialize_organization(existing)
    org = update_organization(db=db, org_id=org_id, payload=payload, tenant_id=current_user.tenant_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_organizations",
        entity_type="sales_organization",
        entity_id=org.org_id,
        action="update",
        description=f"Updated organization {org.org_name}",
        before_state=before_state,
        after_state=_serialize_organization(org),
    )
    return org

# delete
@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sales_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "delete")),
):
    org = get_organization(db=db, org_id=org_id, tenant_id=current_user.tenant_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    before_state = _serialize_organization(org)
    deleted = delete_organization(db=db, org_id=org_id, tenant_id=current_user.tenant_id)

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_organizations",
        entity_type="sales_organization",
        entity_id=org.org_id,
        action="soft_delete",
        description=f"Moved organization {org.org_name} to recycle bin",
        before_state=before_state,
    )


@router.post("/{org_id}/restore", response_model=SalesOrganizationResponse)
def restore_sales_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "restore")),
):
    org = restore_organization(db=db, org_id=org_id, tenant_id=current_user.tenant_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_organizations",
        entity_type="sales_organization",
        entity_id=org.org_id,
        action="restore",
        description=f"Restored organization {org.org_name} from recycle bin",
        after_state=_serialize_organization(org),
    )
    return org

# import
@router.post("/import", status_code=status.HTTP_201_CREATED)
@router.post("/import", response_model=ImportExecutionResponse)
async def import_sales_organizations(
    file: UploadFile = File(...),
    mapping_json: str | None = Form(default=None),
    duplicate_mode: str | None = Query(default=None),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "create")),
):
    content = await read_upload_bytes(file, allowed_extensions={"csv"})
    mapping = parse_mapping_json(mapping_json, target_headers=ORGANIZATION_IMPORT_TARGET_FIELDS)
    remapped_content = remap_csv_bytes(
        content,
        target_headers=ORGANIZATION_IMPORT_TARGET_FIELDS,
        mapping=mapping,
    )
    _, remapped_rows = rows_from_csv_bytes(remapped_content)
    if should_background_data_transfer_with_size(
        row_count=len(remapped_rows),
        file_size_bytes=len(remapped_content),
    ):
        mode = duplicate_mode or admin_modules.get_module_duplicate_mode(db, "sales_organizations", tenant_id=current_user.tenant_id)
        job = create_data_transfer_job(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            module_key="sales_organizations",
            operation_type="import",
            payload={"filename": file.filename, "row_count": len(remapped_rows), "duplicate_mode": mode},
        )
        stored_path = persist_job_upload(job_id=job.id, filename="organizations-import.csv", file_bytes=remapped_content)
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

    try:
        result = import_organizations_from_csv(
            db=db,
            file_bytes=remapped_content,
            current_user=current_user,
            duplicate_mode=duplicate_mode,
            default_duplicate_mode=admin_modules.get_module_duplicate_mode(db, "sales_organizations", tenant_id=current_user.tenant_id),
            replace_duplicates=replace_duplicates,
            skip_duplicates=skip_duplicates,
            create_new_records=create_new_records,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return ImportExecutionResponse(
        mode="inline",
        message=result["message"],
        summary=StandardImportSummary(**result),
    )


@router.post("/import/preview")
async def preview_sales_organizations_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "create")),
):
    content = await read_upload_bytes(file, allowed_extensions={"csv"})
    source_headers, _ = rows_from_csv_bytes(content)
    return {
        "source_headers": source_headers,
        "target_headers": ORGANIZATION_IMPORT_TARGET_FIELDS,
        "required_headers": ["org_name", "primary_email"],
        "default_duplicate_mode": admin_modules.get_module_duplicate_mode(db, "sales_organizations", tenant_id=current_user.tenant_id),
        "suggested_mapping": suggest_header_mapping(
            source_headers=source_headers,
            target_headers=ORGANIZATION_IMPORT_TARGET_FIELDS,
            aliases=ORGANIZATION_IMPORT_ALIASES,
        ),
    }

# export
@router.post("/export", response_model=DataTransferExecutionResponse)
def export_sales_organizations(
    payload: DataTransferExportRequest = Body(default=DataTransferExportRequest()),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "export")),
):
    job = create_data_transfer_job(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_organizations",
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
