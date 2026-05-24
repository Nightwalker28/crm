from __future__ import annotations

from typing import Sequence

from sqlalchemy.orm import Session

from app.core.cursor_pagination import apply_desc_id_cursor
from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.pagination import Pagination
from app.modules.platform.services.custom_fields import build_custom_field_filter_map
from app.modules.__area__.models import __Module__
from app.modules.user_management.models import User


def apply_search_filter(query, search: str | None):
    return apply_ranked_search(
        query,
        search=search,
        document=__Module__.search_doc,
        default_order_column=__Module__.created_time,
    )


def build___modules___query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(__Module__).filter(
        __Module__.tenant_id == tenant_id,
        __Module__.deleted_at.is_(None),
    )
    filter_field_map = {
        "name": {"expression": __Module__.name, "type": "text"},
        "description": {"expression": __Module__.description, "type": "text"},
        "status": {"expression": __Module__.status, "type": "text"},
        "created_time": {"expression": __Module__.created_time, "type": "date"},
        **build_custom_field_filter_map(
            db,
            tenant_id=tenant_id,
            module_key="__MODULE_KEY__",
            record_id_expression=__Module__.__id_field__,
        ),
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=filter_field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=filter_field_map)
    return apply_search_filter(query, search)


def list___modules__(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[Sequence[__Module__], int]:
    query = build___modules___query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    records = query.offset(pagination.offset).limit(pagination.limit).all()
    return records, total_count


def list___modules___cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[__Module__]:
    query = build___modules___query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    query = apply_desc_id_cursor(query, __Module__.__id_field__, cursor)
    return query.order_by(None).order_by(__Module__.__id_field__.desc()).limit(limit + 1).all()


def get___module__(
    db: Session,
    *,
    tenant_id: int,
    __id_field__: int,
    include_deleted: bool = False,
) -> __Module__ | None:
    query = db.query(__Module__).filter(
        __Module__.__id_field__ == __id_field__,
        __Module__.tenant_id == tenant_id,
    )
    if not include_deleted:
        query = query.filter(__Module__.deleted_at.is_(None))
    return query.first()


def list_deleted___modules__(db: Session, *, tenant_id: int, pagination: Pagination) -> tuple[Sequence[__Module__], int]:
    query = db.query(__Module__).filter(__Module__.tenant_id == tenant_id, __Module__.deleted_at.is_not(None))
    total_count = query.count()
    records = query.order_by(__Module__.deleted_at.desc(), __Module__.created_time.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return records, total_count


def user_exists(db: Session, *, tenant_id: int, user_id: int) -> bool:
    return bool(db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first())
