from __future__ import annotations

from typing import Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.cursor_pagination import apply_desc_id_cursor
from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.modules.platform.services.custom_fields import build_custom_field_filter_map
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization, SalesQuote
from app.modules.user_management.models import User


def user_exists(db: Session, *, tenant_id: int, user_id: int) -> bool:
    return bool(db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first())


def contact_exists(db: Session, *, tenant_id: int, contact_id: int) -> bool:
    return bool(
        db.query(SalesContact.contact_id)
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


def get_opportunity(db: Session, *, tenant_id: int, opportunity_id: int) -> SalesOpportunity | None:
    return (
        db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.opportunity_id == opportunity_id,
            SalesOpportunity.tenant_id == tenant_id,
            SalesOpportunity.deleted_at.is_(None),
        )
        .first()
    )


def quote_number_exists(db: Session, *, tenant_id: int, quote_number: str, exclude_quote_id: int | None = None) -> bool:
    query = db.query(SalesQuote.quote_id).filter(
        SalesQuote.tenant_id == tenant_id,
        SalesQuote.deleted_at.is_(None),
        func.lower(SalesQuote.quote_number) == quote_number.strip().lower(),
    )
    if exclude_quote_id is not None:
        query = query.filter(SalesQuote.quote_id != exclude_quote_id)
    return bool(query.first())


def apply_search_filter(query, search: str | None):
    return apply_ranked_search(
        query,
        search=search,
        document=SalesQuote.search_doc,
        default_order_column=SalesQuote.created_time,
    )


def build_quotes_query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(SalesQuote).filter(
        SalesQuote.tenant_id == tenant_id,
        SalesQuote.deleted_at.is_(None),
    )
    field_map = {
        "quote_number": {"expression": SalesQuote.quote_number, "type": "text"},
        "title": {"expression": SalesQuote.title, "type": "text"},
        "customer_name": {"expression": SalesQuote.customer_name, "type": "text"},
        "contact_id": {"expression": SalesQuote.contact_id, "type": "number"},
        "organization_id": {"expression": SalesQuote.organization_id, "type": "number"},
        "opportunity_id": {"expression": SalesQuote.opportunity_id, "type": "number"},
        "assigned_to": {"expression": SalesQuote.assigned_to, "type": "number"},
        "status": {"expression": SalesQuote.status, "type": "text"},
        "issue_date": {"expression": SalesQuote.issue_date, "type": "date"},
        "expiry_date": {"expression": SalesQuote.expiry_date, "type": "date"},
        "currency": {"expression": SalesQuote.currency, "type": "text"},
        "subtotal_amount": {"expression": SalesQuote.subtotal_amount, "type": "number"},
        "discount_amount": {"expression": SalesQuote.discount_amount, "type": "number"},
        "tax_amount": {"expression": SalesQuote.tax_amount, "type": "number"},
        "total_amount": {"expression": SalesQuote.total_amount, "type": "number"},
        "created_time": {"expression": SalesQuote.created_time, "type": "date"},
        "updated_at": {"expression": SalesQuote.updated_at, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="sales_quotes",
            record_id_expression=SalesQuote.quote_id,
        ),
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    return apply_search_filter(query, search)


def list_quotes(
    db: Session,
    *,
    tenant_id: int,
    pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[Sequence[SalesQuote], int]:
    query = build_quotes_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    quotes = query.order_by(SalesQuote.created_time.desc(), SalesQuote.quote_id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return quotes, total_count


def list_quotes_cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesQuote]:
    query = build_quotes_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    query = apply_desc_id_cursor(query, SalesQuote.quote_id, cursor)
    return query.order_by(None).order_by(SalesQuote.quote_id.desc()).limit(limit + 1).all()


def list_all_quotes(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesQuote]:
    return (
        build_quotes_query(
            db,
            tenant_id=tenant_id,
            search=search,
            all_filter_conditions=all_filter_conditions,
            any_filter_conditions=any_filter_conditions,
        )
        .order_by(SalesQuote.created_time.desc(), SalesQuote.quote_id.desc())
        .all()
    )


def get_quote(db: Session, *, tenant_id: int, quote_id: int, include_deleted: bool = False) -> SalesQuote | None:
    query = db.query(SalesQuote).filter(SalesQuote.quote_id == quote_id, SalesQuote.tenant_id == tenant_id)
    if not include_deleted:
        query = query.filter(SalesQuote.deleted_at.is_(None))
    return query.first()


def list_deleted_quotes(db: Session, *, tenant_id: int, pagination) -> tuple[Sequence[SalesQuote], int]:
    query = db.query(SalesQuote).filter(SalesQuote.tenant_id == tenant_id, SalesQuote.deleted_at.is_not(None))
    total_count = query.count()
    quotes = (
        query.order_by(SalesQuote.deleted_at.desc(), SalesQuote.created_time.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return quotes, total_count
