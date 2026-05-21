from __future__ import annotations

from typing import Sequence

from sqlalchemy.orm import Session

from app.core.cursor_pagination import apply_desc_id_cursor
from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.pagination import Pagination
from app.modules.platform.services.custom_fields import build_custom_field_filter_map
from app.modules.sales.models import SalesLead
from app.modules.user_management.models import User


def apply_search_filter(query, search: str | None):
    return apply_ranked_search(
        query,
        search=search,
        document=SalesLead.search_doc,
        default_order_column=SalesLead.created_time,
    )


def build_leads_query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(SalesLead).filter(
        SalesLead.tenant_id == tenant_id,
        SalesLead.deleted_at.is_(None),
    )
    filter_field_map = {
        "first_name": {"expression": SalesLead.first_name, "type": "text"},
        "last_name": {"expression": SalesLead.last_name, "type": "text"},
        "company": {"expression": SalesLead.company, "type": "text"},
        "primary_email": {"expression": SalesLead.primary_email, "type": "text"},
        "phone": {"expression": SalesLead.phone, "type": "text"},
        "title": {"expression": SalesLead.title, "type": "text"},
        "source": {"expression": SalesLead.source, "type": "text"},
        "status": {"expression": SalesLead.status, "type": "text"},
        "created_time": {"expression": SalesLead.created_time, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="sales_leads",
            record_id_expression=SalesLead.lead_id,
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


def list_leads(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[Sequence[SalesLead], int]:
    query = build_leads_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    leads = query.offset(pagination.offset).limit(pagination.limit).all()
    return leads, total_count


def list_leads_cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesLead]:
    query = build_leads_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    query = apply_desc_id_cursor(query, SalesLead.lead_id, cursor)
    return query.order_by(None).order_by(SalesLead.lead_id.desc()).limit(limit + 1).all()


def list_all_leads(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[SalesLead]:
    return (
        build_leads_query(
            db,
            tenant_id=tenant_id,
            search=search,
            all_filter_conditions=all_filter_conditions,
            any_filter_conditions=any_filter_conditions,
        )
        .order_by(SalesLead.created_time.desc())
        .all()
    )


def get_lead(
    db: Session,
    *,
    tenant_id: int,
    lead_id: int,
    include_deleted: bool = False,
) -> SalesLead | None:
    query = db.query(SalesLead).filter(
        SalesLead.lead_id == lead_id,
        SalesLead.tenant_id == tenant_id,
    )
    if not include_deleted:
        query = query.filter(SalesLead.deleted_at.is_(None))
    return query.first()


def list_deleted_leads(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
) -> tuple[Sequence[SalesLead], int]:
    query = db.query(SalesLead).filter(
        SalesLead.tenant_id == tenant_id,
        SalesLead.deleted_at.is_not(None),
    )
    total_count = query.count()
    leads = (
        query.order_by(SalesLead.deleted_at.desc(), SalesLead.created_time.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return leads, total_count


def user_exists(db: Session, *, tenant_id: int, user_id: int) -> bool:
    return bool(db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first())
