from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_user, require_admin, require_superuser
from app.core.permissions import require_module_access
from app.modules.sales.schema import (
    SalesContactCreateRequest,
    SalesContactImportSummary,
    SalesContactListResponse,
    SalesContactResponse,
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
    list_sales_contacts,
    update_sales_contact,
)
from app.modules.sales.services.organizations_services import search_organizations_pagianted

router = APIRouter(prefix="/contacts", tags=["Sales"])


@router.get("", response_model=SalesContactListResponse)
def list_contacts(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts'))
):
    contacts, total_count = list_sales_contacts(db, pagination, search=None)
    serialized = [SalesContactResponse.model_validate(contact) for contact in contacts]
    return build_paged_response(serialized, total_count, pagination)


@router.get("/search", response_model=SalesContactListResponse)
def search_contacts(
    query: str = Query(
        ...,
        min_length=1,
        description="Search by name, email, title, region, country, or LinkedIn URL",
    ),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts'))
):
    contacts, total_count = list_sales_contacts(db, pagination, search=query)
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
    require_module = Depends(require_module_access('sales_contacts'))
):
    try:
        return create_sales_contact(
            db=db,
            payload=payload.model_dump(),
            current_user=current_user,
            replace_duplicates=replace_duplicates,
            skip_duplicates=skip_duplicates,
            create_new_records=create_new_records,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/import", response_model=SalesContactImportSummary)
async def import_contacts(
    file: UploadFile = File(...),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts'))
):
    filename = (file.filename or "").lower()
    if not filename.endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only CSV files are supported")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    summary = import_contacts_from_csv(
        db,
        file_bytes,
        default_assigned_to=current_user.id,
        replace_duplicates=replace_duplicates,
        skip_duplicates=skip_duplicates,
        create_new_records=create_new_records,
    )
    return SalesContactImportSummary(**summary)


@router.get("/export", response_class=StreamingResponse)
def export_contacts(
    search: str | None = Query(
        default=None,
        description="Optional filter by name, email, title, region, country, or LinkedIn URL",
    ),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts'))
):
    contacts = get_all_contacts(db, search)
    csv_bytes = export_contacts_to_csv(contacts)
    buffer = BytesIO(csv_bytes)

    headers = {"Content-Disposition": 'attachment; filename="sales_contacts.csv"'}
    return StreamingResponse(buffer, media_type="text/csv", headers=headers)


@router.get("/organization-search", response_model=SalesOrganizationListResponse)
def search_organizations_for_contacts(
    name: str = Query(..., min_length=1, description="Organization name to match"),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts'))
):
    items, total = search_organizations_pagianted(
        db,
        name,
        offset=pagination.offset,
        limit=pagination.limit,
    )
    return build_paged_response(items, total_count=total, pagination=pagination)


@router.get("/{contact_id}", response_model=SalesContactResponse)
def get_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts'))
):
    contact = get_contact_or_404(db, contact_id)
    return contact


@router.put("/{contact_id}", response_model=SalesContactResponse)
def update_contact(
    contact_id: int,
    payload: SalesContactUpdateRequest,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts'))
):
    contact = get_contact_or_404(db, contact_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return contact

    return update_sales_contact(db, contact, update_data)


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts'))
):
    contact = get_contact_or_404(db, contact_id)
    delete_sales_contact(db, contact)
