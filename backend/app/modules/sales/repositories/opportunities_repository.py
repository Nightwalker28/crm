from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Numeric, case, cast, func, literal
from sqlalchemy.orm import Session

from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.platform.services.custom_fields import build_custom_field_filter_map
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization
from app.modules.user_management.models import User

OPPORTUNITY_SORT_FIELDS = {
    "opportunity_name": SalesOpportunity.opportunity_name,
    "client": SalesOpportunity.client,
    "sales_stage": SalesOpportunity.sales_stage,
    "expected_close_date": SalesOpportunity.expected_close_date,
    "probability_percent": SalesOpportunity.probability_percent,
    "total_cost_of_project": SalesOpportunity.total_cost_of_project,
    "currency_type": SalesOpportunity.currency_type,
    "created_time": SalesOpportunity.created_time,
}


def user_exists(db: Session, *, tenant_id: int, user_id: int) -> bool:
    return bool(db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first())


def get_contact(db: Session, *, tenant_id: int, contact_id: int) -> SalesContact | None:
    return (
        db.query(SalesContact)
        .filter(
            SalesContact.contact_id == contact_id,
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        )
        .first()
    )


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


def apply_search_filter(query, search: str | None):
    document = searchable_text(
        SalesOpportunity.opportunity_name,
        SalesOpportunity.client,
        SalesOpportunity.sales_stage,
        SalesOpportunity.campaign_type,
        SalesOpportunity.target_geography,
        SalesOpportunity.target_audience,
        SalesOpportunity.tactics,
    )
    return apply_ranked_search(
        query,
        search=search,
        document=document,
        default_order_column=SalesOpportunity.created_time,
    )


def build_opportunity_query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(SalesOpportunity).filter(
        SalesOpportunity.tenant_id == tenant_id,
        SalesOpportunity.deleted_at.is_(None),
    )
    field_map = {
        "opportunity_name": {"expression": SalesOpportunity.opportunity_name, "type": "text"},
        "client": {"expression": SalesOpportunity.client, "type": "text"},
        "sales_stage": {"expression": SalesOpportunity.sales_stage, "type": "text"},
        "contact_id": {"expression": SalesOpportunity.contact_id, "type": "number"},
        "organization_id": {"expression": SalesOpportunity.organization_id, "type": "number"},
        "assigned_to": {"expression": SalesOpportunity.assigned_to, "type": "number"},
        "expected_close_date": {"expression": SalesOpportunity.expected_close_date, "type": "date"},
        "probability_percent": {"expression": SalesOpportunity.probability_percent, "type": "number"},
        "total_cost_of_project": {"expression": SalesOpportunity.total_cost_of_project, "type": "text"},
        "currency_type": {"expression": SalesOpportunity.currency_type, "type": "text"},
        "target_geography": {"expression": SalesOpportunity.target_geography, "type": "text"},
        "created_time": {"expression": SalesOpportunity.created_time, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="sales_opportunities",
            record_id_expression=SalesOpportunity.opportunity_id,
        ),
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    return apply_search_filter(query, search)


def apply_opportunity_sort(query, *, sort_by: str | None = None, sort_direction: str | None = None):
    sort_column = OPPORTUNITY_SORT_FIELDS.get((sort_by or "").strip())
    if sort_column is None:
        return query.order_by(None).order_by(
            SalesOpportunity.created_time.desc(),
            SalesOpportunity.opportunity_id.desc(),
        )

    direction = (sort_direction or "asc").strip().lower()
    ordered = sort_column.desc() if direction == "desc" else sort_column.asc()
    return query.order_by(None).order_by(ordered.nullslast(), SalesOpportunity.opportunity_id.desc())


def list_all(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[SalesOpportunity]:
    return (
        build_opportunity_query(
            db,
            tenant_id=tenant_id,
            search=search,
            all_filter_conditions=all_filter_conditions,
            any_filter_conditions=any_filter_conditions,
        )
        .order_by(SalesOpportunity.created_time.desc())
        .all()
    )


def list_paginated(
    db: Session,
    *,
    tenant_id: int,
    pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[SalesOpportunity], int]:
    query = build_opportunity_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    items = (
        apply_opportunity_sort(query, sort_by=sort_by, sort_direction=sort_direction)
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return items, total_count


def list_cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[SalesOpportunity]:
    query = build_opportunity_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    if cursor is not None:
        query = query.filter(SalesOpportunity.opportunity_id < cursor)
    return query.order_by(None).order_by(SalesOpportunity.opportunity_id.desc()).limit(limit + 1).all()


def _opportunity_value_expression(db: Session):
    value = func.coalesce(SalesOpportunity.total_cost_of_project, "")
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        trimmed = func.trim(value)
        numeric_text = func.replace(trimmed, ",", "")
        return case(
            (
                trimmed.op("~")(r"^\s*-?[0-9][0-9,]*(\.[0-9]+)?\s*$"),
                cast(numeric_text, Numeric(18, 2)),
            ),
            else_=literal(0),
        )
    return cast(func.replace(value, ",", ""), Numeric(18, 2))


def summarize_pipeline(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> list[tuple[str | None, int, Decimal | None]]:
    query = build_opportunity_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    return (
        query.order_by(None)
        .with_entities(
            SalesOpportunity.sales_stage,
            func.count(SalesOpportunity.opportunity_id),
            func.coalesce(func.sum(_opportunity_value_expression(db)), 0),
        )
        .group_by(SalesOpportunity.sales_stage)
        .all()
    )


def list_deleted(db: Session, *, tenant_id: int, pagination) -> tuple[list[SalesOpportunity], int]:
    query = db.query(SalesOpportunity).filter(
        SalesOpportunity.tenant_id == tenant_id,
        SalesOpportunity.deleted_at.is_not(None),
    )
    total_count = query.count()
    items = (
        query.order_by(SalesOpportunity.deleted_at.desc(), SalesOpportunity.created_time.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return items, total_count


def get_opportunity(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
    include_deleted: bool = False,
) -> SalesOpportunity | None:
    query = db.query(SalesOpportunity).filter(
        SalesOpportunity.opportunity_id == opportunity_id,
        SalesOpportunity.tenant_id == tenant_id,
    )
    if not include_deleted:
        query = query.filter(SalesOpportunity.deleted_at.is_(None))
    return query.first()


def get_deleted_opportunity(
    db: Session,
    *,
    tenant_id: int,
    opportunity_id: int,
) -> SalesOpportunity | None:
    query = db.query(SalesOpportunity).filter(
        SalesOpportunity.opportunity_id == opportunity_id,
        SalesOpportunity.tenant_id == tenant_id,
        SalesOpportunity.deleted_at.is_not(None),
    )
    return query.first()


def existing_names(db: Session, *, tenant_id: int, names: list[str]) -> set[str]:
    return {
        row.opportunity_name
        for row in db.query(SalesOpportunity.opportunity_name)
        .filter(
            SalesOpportunity.tenant_id == tenant_id,
            SalesOpportunity.opportunity_name.in_(names),
            SalesOpportunity.deleted_at.is_(None),
        )
        .distinct()
    }


def active_by_name(db: Session, *, tenant_id: int, names: list[str]) -> dict[str, SalesOpportunity]:
    return {
        row.opportunity_name: row
        for row in db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.tenant_id == tenant_id,
            SalesOpportunity.opportunity_name.in_(names),
            SalesOpportunity.deleted_at.is_(None),
        )
        .all()
    }
