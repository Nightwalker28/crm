from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_csv import read_upload_bytes
from app.core.module_export import bytes_download_response
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_user
from app.core.permissions import require_action_access, require_module_access
from app.modules.sales.schema import (
    SalesContactCreateRequest,
    SalesContactImportSummary,
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
from app.modules.sales.services.organizations_services import search_organizations_pagianted
from app.modules.sales.services.summary_services import build_contact_summary

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
    return SalesContactListItem.model_validate(payload)


@router.get("", response_model=SalesContactListResponse)
def list_contacts(
    fields: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    contacts, total_count = list_sales_contacts(db, pagination, search=None)
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
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    contacts, total_count = list_sales_contacts(db, pagination, search=query)
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
    contacts, total_count = list_deleted_sales_contacts(db, pagination)
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


@router.post("/import", response_model=SalesContactImportSummary)
async def import_contacts(
    file: UploadFile = File(...),
    replace_duplicates: bool = False,
    skip_duplicates: bool = False,
    create_new_records: bool = False,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "create")),
):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
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
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "export")),
):
    contacts = get_all_contacts(db, search)
    csv_bytes = export_contacts_to_csv(contacts)
    return bytes_download_response(
        content=csv_bytes,
        filename="sales_contacts.csv",
        media_type="text/csv",
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
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    contact = get_contact_or_404(db, contact_id)
    return contact


@router.get("/{contact_id}/summary", response_model=ContactSummaryResponse)
def get_contact_summary(
    contact_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(require_user),
    require_module = Depends(require_module_access('sales_contacts')),
    require_permission = Depends(require_action_access("sales_contacts", "view")),
):
    contact = get_contact_or_404(db, contact_id)
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
    contact = get_contact_or_404(db, contact_id)
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return contact

    before_state = _serialize_contact(contact)
    updated = update_sales_contact(db, contact, update_data)
    log_activity(
        db,
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
    contact = get_contact_or_404(db, contact_id)
    before_state = _serialize_contact(contact)
    delete_sales_contact(db, contact)
    log_activity(
        db,
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
    contact = get_contact_or_404(db, contact_id, include_deleted=True)
    restored = restore_sales_contact(db, contact)
    log_activity(
        db,
        actor_user_id=current_user.id if current_user else None,
        module_key="sales_contacts",
        entity_type="sales_contact",
        entity_id=restored.contact_id,
        action="restore",
        description=f"Restored contact {restored.primary_email} from recycle bin",
        after_state=_serialize_contact(restored),
    )
    return restored
