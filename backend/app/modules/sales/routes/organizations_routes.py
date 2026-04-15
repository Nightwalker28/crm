from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi import File, UploadFile, Body
from sqlalchemy.orm import Session

from app.core.pagination import Pagination, get_pagination, build_paged_response
from app.core.database import get_db
from app.core.module_csv import read_upload_bytes
from app.core.module_export import bytes_download_response
from app.core.security import require_user
from app.core.permissions import require_action_access, require_module_access
from app.modules.platform.services.activity_logs import log_activity
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
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "view")),
):
    if search:
        items, total = search_organizations_pagianted(
            db=db,
            name=search,
            offset=pagination.offset,
            limit=pagination.limit,
        )
    else:
        items, total = list_organizations_paginated(db=db, offset=pagination.offset, limit=pagination.limit)
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
    items, total = list_deleted_organizations_paginated(db=db, offset=pagination.offset, limit=pagination.limit)
    serialized = [SalesOrganizationResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)

# search
@router.get("/search/{name}", response_model=SalesOrganizationListResponse)
def search_sales_organizations(
    name: str,
    fields: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db:  Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "view")),
):
    items, total = search_organizations_pagianted(db, name, offset=pagination.offset, limit=pagination.limit)
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
    org = get_organization(db=db, org_id=org_id)
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
    org = get_organization(db=db, org_id=org_id)
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
    existing = get_organization(db=db, org_id=org_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    before_state = _serialize_organization(existing)
    org = update_organization(db=db, org_id=org_id, payload=payload)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    log_activity(
        db,
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
    org = get_organization(db=db, org_id=org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    before_state = _serialize_organization(org)
    deleted = delete_organization(db=db, org_id=org_id)

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    log_activity(
        db,
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
    org = restore_organization(db=db, org_id=org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    log_activity(
        db,
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
async def import_sales_organizations(
    file: UploadFile = File(...),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "create")),
):
    content = await read_upload_bytes(file, allowed_extensions={"csv"})

    try:
        result = import_organizations_from_csv(
            db=db,
            file_bytes=content,
            current_user=current_user,
            replace_duplicates=replace_duplicates,
            skip_duplicates=skip_duplicates,
            create_new_records=create_new_records,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    return {
        "message": "Import completed",
        "inserted": result["inserted"],
        "updated": result["updated"],
        "skipped_duplicates": result["skipped_duplicates"],
        "errors": result["errors"],
        "duplicate_orgs": result["duplicate_orgs"],
    }

# export
@router.post("/export")
def export_sales_organizations(
    org_ids: list[int] | None = Body(default=None, embed=True),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
    require_permission = Depends(require_action_access("sales_organizations", "export")),
):
    content, meta = export_organizations(db=db, org_ids=org_ids)
    filename = "organizations_export.zip"
    return bytes_download_response(
        content=content,
        filename=filename,
        media_type="application/zip",
        extra_headers={
            "X-Export-Rows": str(meta["rows"]),
            "X-Export-Batches": str(meta["batches"]),
        },
    )
