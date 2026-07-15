from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.modules.platform.services.custom_fields import build_custom_field_filter_map
from app.modules.sales.models import SalesOrganization
from app.modules.user_management.models import User

ORGANIZATION_SORT_FIELDS = {
    "org_name": SalesOrganization.org_name,
    "primary_email": SalesOrganization.primary_email,
    "website": SalesOrganization.website,
    "industry": SalesOrganization.industry,
    "annual_revenue": SalesOrganization.annual_revenue,
    "primary_phone": SalesOrganization.primary_phone,
    "billing_country": SalesOrganization.billing_country,
    "assigned_to": SalesOrganization.assigned_to,
    "customer_group_id": SalesOrganization.customer_group_id,
    "created_time": SalesOrganization.created_time,
    "updated_at": SalesOrganization.updated_at,
}


def build_organization_query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(SalesOrganization).filter(
        SalesOrganization.tenant_id == tenant_id,
        SalesOrganization.deleted_at.is_(None),
    )
    query = apply_ranked_search(
        query,
        search=search,
        document=SalesOrganization.search_doc,
        default_order_column=SalesOrganization.created_time,
    )
    field_map = {
        "org_name": {"expression": SalesOrganization.org_name, "type": "text"},
        "primary_email": {"expression": SalesOrganization.primary_email, "type": "text"},
        "website": {"expression": SalesOrganization.website, "type": "text"},
        "industry": {"expression": SalesOrganization.industry, "type": "text"},
        "annual_revenue": {"expression": SalesOrganization.annual_revenue, "type": "text"},
        "primary_phone": {"expression": SalesOrganization.primary_phone, "type": "text"},
        "billing_country": {"expression": SalesOrganization.billing_country, "type": "text"},
        "created_time": {"expression": SalesOrganization.created_time, "type": "date"},
        "assigned_to": {"expression": SalesOrganization.assigned_to, "type": "number"},
        "updated_at": {"expression": SalesOrganization.updated_at, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="sales_organizations",
            record_id_expression=SalesOrganization.org_id,
        ),
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    return query


def find_active_by_name(db: Session, *, tenant_id: int, org_name: str) -> SalesOrganization | None:
    return (
        db.query(SalesOrganization)
        .filter(
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.org_name == org_name,
            SalesOrganization.deleted_at.is_(None),
        )
        .first()
    )


def apply_organization_sort(query, *, sort_by: str | None = None, sort_direction: str | None = None):
    sort_column = ORGANIZATION_SORT_FIELDS.get((sort_by or "").strip())
    if sort_column is None:
        return query.order_by(None).order_by(
            SalesOrganization.created_time.desc(),
            SalesOrganization.org_id.desc(),
        )

    direction = (sort_direction or "asc").strip().lower()
    ordered = sort_column.desc() if direction == "desc" else sort_column.asc()
    return query.order_by(None).order_by(ordered.nullslast(), SalesOrganization.org_id.desc())


def list_paginated(
    db: Session,
    *,
    tenant_id: int,
    offset: int,
    limit: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[SalesOrganization], int]:
    query = build_organization_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total = query.count()
    items = (
        apply_organization_sort(query, sort_by=sort_by, sort_direction=sort_direction)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return items, total


def list_cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[SalesOrganization]:
    query = build_organization_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    if cursor is not None:
        query = query.filter(SalesOrganization.org_id < cursor)
    return query.order_by(None).order_by(SalesOrganization.org_id.desc()).limit(limit + 1).all()


def get_organization(
    db: Session,
    *,
    tenant_id: int,
    org_id: int,
    include_deleted: bool = False,
) -> SalesOrganization | None:
    query = db.query(SalesOrganization).filter(
        SalesOrganization.org_id == org_id,
        SalesOrganization.tenant_id == tenant_id,
    )
    if not include_deleted:
        query = query.filter(SalesOrganization.deleted_at.is_(None))
    return query.first()


def user_exists(db: Session, *, tenant_id: int, user_id: int) -> bool:
    return bool(db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first())


def list_deleted_paginated(
    db: Session,
    *,
    tenant_id: int,
    offset: int,
    limit: int,
) -> tuple[list[SalesOrganization], int]:
    query = db.query(SalesOrganization).filter(
        SalesOrganization.tenant_id == tenant_id,
        SalesOrganization.deleted_at.is_not(None),
    )
    total = query.count()
    items = (
        query.order_by(SalesOrganization.deleted_at.desc(), SalesOrganization.created_time.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return items, total
