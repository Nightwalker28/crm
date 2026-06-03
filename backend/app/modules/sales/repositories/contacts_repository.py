from __future__ import annotations

from typing import Sequence

from sqlalchemy.orm import Session

from app.core.cursor_pagination import apply_desc_id_cursor
from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.pagination import Pagination
from app.modules.platform.services.custom_fields import build_custom_field_filter_map
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.user_management.models import User

CONTACT_SORT_FIELDS = {
    "first_name": SalesContact.first_name,
    "last_name": SalesContact.last_name,
    "primary_email": SalesContact.primary_email,
    "contact_telephone": SalesContact.contact_telephone,
    "current_title": SalesContact.current_title,
    "region": SalesContact.region,
    "country": SalesContact.country,
    "linkedin_url": SalesContact.linkedin_url,
    "organization_id": SalesContact.organization_id,
    "assigned_to": SalesContact.assigned_to,
    "organization_name": SalesOrganization.org_name,
    "created_time": SalesContact.created_time,
}


def apply_search_filter(query, search: str | None):
    return apply_ranked_search(
        query,
        search=search,
        document=SalesContact.search_doc,
        default_order_column=SalesContact.created_time,
    )


def build_contacts_query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = (
        db.query(SalesContact)
        .outerjoin(SalesOrganization)
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        )
    )
    filter_field_map = {
        "first_name": {"expression": SalesContact.first_name, "type": "text"},
        "last_name": {"expression": SalesContact.last_name, "type": "text"},
        "primary_email": {"expression": SalesContact.primary_email, "type": "text"},
        "contact_telephone": {"expression": SalesContact.contact_telephone, "type": "text"},
        "current_title": {"expression": SalesContact.current_title, "type": "text"},
        "region": {"expression": SalesContact.region, "type": "text"},
        "country": {"expression": SalesContact.country, "type": "text"},
        "linkedin_url": {"expression": SalesContact.linkedin_url, "type": "text"},
        "organization_id": {"expression": SalesContact.organization_id, "type": "number"},
        "assigned_to": {"expression": SalesContact.assigned_to, "type": "number"},
        "organization_name": {"expression": SalesOrganization.org_name, "type": "text"},
        "created_time": {"expression": SalesContact.created_time, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="sales_contacts",
            record_id_expression=SalesContact.contact_id,
        ),
    }
    query = apply_filter_conditions(
        query,
        conditions=all_filter_conditions,
        logic="all",
        field_map=filter_field_map,
    )
    query = apply_filter_conditions(
        query,
        conditions=any_filter_conditions,
        logic="any",
        field_map=filter_field_map,
    )
    return apply_search_filter(query, search)


def apply_contact_sort(query, *, sort_by: str | None = None, sort_direction: str | None = None):
    sort_column = CONTACT_SORT_FIELDS.get((sort_by or "").strip())
    if sort_column is None:
        return query.order_by(None).order_by(
            SalesContact.created_time.desc(),
            SalesContact.contact_id.desc(),
        )

    direction = (sort_direction or "asc").strip().lower()
    ordered = sort_column.desc() if direction == "desc" else sort_column.asc()
    return query.order_by(None).order_by(ordered.nullslast(), SalesContact.contact_id.desc())


def list_contacts(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[Sequence[SalesContact], int]:
    query = build_contacts_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    contacts = (
        apply_contact_sort(query, sort_by=sort_by, sort_direction=sort_direction)
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return contacts, total_count


def list_contacts_cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesContact]:
    query = build_contacts_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    query = apply_desc_id_cursor(query, SalesContact.contact_id, cursor)
    return query.order_by(None).order_by(SalesContact.contact_id.desc()).limit(limit + 1).all()


def list_all_contacts(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesContact]:
    return (
        build_contacts_query(
            db,
            tenant_id=tenant_id,
            search=search,
            all_filter_conditions=all_filter_conditions,
            any_filter_conditions=any_filter_conditions,
        )
        .order_by(SalesContact.created_time.desc())
        .all()
    )


def get_contact(
    db: Session,
    *,
    tenant_id: int,
    contact_id: int,
    include_deleted: bool = False,
) -> SalesContact | None:
    query = db.query(SalesContact).filter(
        SalesContact.contact_id == contact_id,
        SalesContact.tenant_id == tenant_id,
    )
    if not include_deleted:
        query = query.filter(SalesContact.deleted_at.is_(None))
    return query.first()


def list_deleted_contacts(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
) -> tuple[Sequence[SalesContact], int]:
    query = db.query(SalesContact).filter(
        SalesContact.tenant_id == tenant_id,
        SalesContact.deleted_at.is_not(None),
    )
    total_count = query.count()
    contacts = (
        query.order_by(SalesContact.deleted_at.desc(), SalesContact.created_time.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return contacts, total_count


def user_exists(db: Session, *, tenant_id: int, user_id: int) -> bool:
    return bool(db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first())


def organization_exists(db: Session, *, tenant_id: int, organization_id: int) -> bool:
    return bool(
        db.query(SalesOrganization.org_id)
        .filter(
            SalesOrganization.org_id == organization_id,
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.deleted_at.is_(None),
        )
        .first()
    )
