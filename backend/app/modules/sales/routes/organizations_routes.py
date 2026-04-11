from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import File, UploadFile, Body
from fastapi.responses import StreamingResponse
import io
from sqlalchemy.orm import Session

from app.core.pagination import Pagination, get_pagination, build_paged_response
from app.core.database import get_db
from app.core.security import require_user
from app.core.permissions import require_module_access
from app.modules.sales.schema import (
    SalesOrganizationCreate,
    SalesOrganizationUpdate,
    SalesOrganizationResponse,
    SalesOrganizationListResponse,
)
from app.modules.sales.services.organizations_services import (
    create_organization,
    list_organizations_paginated,
    search_organizations_pagianted,
    get_organization,
    update_organization,
    delete_organization,
    import_organizations_from_csv,
    export_organizations,
)

router = APIRouter(prefix="/organizations", tags=["Sales"])

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
):
    try:
        return create_organization(
            db=db,
            payload=payload,
            current_user=current_user,
            replace_duplicates=replace_duplicates,
            skip_duplicates=skip_duplicates,
            create_new_records=create_new_records,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    

# read all
@router.get("", response_model=SalesOrganizationListResponse)
def get_sales_organizations(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations'))
):
    items, total = list_organizations_paginated(db=db, offset=pagination.offset, limit=pagination.limit)
    return build_paged_response(items, total_count=total, pagination=pagination)

# search
@router.get("/search/{name}", response_model=SalesOrganizationListResponse)
def search_sales_organizations(
    name: str,
    pagination: Pagination = Depends(get_pagination),
    db:  Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
):
    items, total = search_organizations_pagianted(db, name, offset=pagination.offset, limit=pagination.limit)
    return build_paged_response(items, total_count=total, pagination=pagination)

# read single
@router.get("/{org_id}", response_model=SalesOrganizationResponse)
def get_sales_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
):
    org = get_organization(db=db, org_id=org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    return org

# update
@router.put("/{org_id}", response_model=SalesOrganizationResponse)
def edit_sales_organization(
    org_id: int,
    payload: SalesOrganizationUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
):
    org = update_organization(db=db, org_id=org_id, payload=payload)
    if not org:
        raise HTTPException(status_c4ode=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    return org

# delete
@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sales_organization(
    org_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations')),
):
    deleted = delete_organization(db=db, org_id=org_id)

    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

# import
@router.post("/import", status_code=status.HTTP_201_CREATED)
async def import_sales_organizations(
    file: UploadFile = File(...),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_organizations'))
):
    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

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
):
    content, meta = export_organizations(db=db, org_ids=org_ids)
    filename = "organizations_export.zip"

    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename=\"{filename}\"',
            "X-Export-Rows": str(meta["rows"]),
            "X-Export-Batches": str(meta["batches"]),
        },
    )
