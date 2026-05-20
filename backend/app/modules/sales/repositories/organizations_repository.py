from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.modules.platform.services.custom_fields import build_custom_field_filter_map
from app.modules.sales.models import SalesOrganization


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


def list_paginated(
    db: Session,
    *,
    tenant_id: int,
    offset: int,
    limit: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[list[SalesOrganization], int]:
    query = build_organization_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total = query.count()
    items = query.order_by(SalesOrganization.created_time.desc()).offset(offset).limit(limit).all()
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
