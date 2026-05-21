from __future__ import annotations

from typing import Sequence

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.platform.models import GenericSystemRecord


def build_records_query(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    search: str | None = None,
    include_deleted: bool = False,
):
    query = db.query(GenericSystemRecord).filter(
        GenericSystemRecord.tenant_id == tenant_id,
        GenericSystemRecord.module_key == module_key,
    )
    if include_deleted:
        query = query.filter(GenericSystemRecord.deleted_at.is_not(None))
    else:
        query = query.filter(GenericSystemRecord.deleted_at.is_(None))
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(GenericSystemRecord.title.ilike(pattern), GenericSystemRecord.status.ilike(pattern)))
    return query


def list_records(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    offset: int,
    limit: int,
    search: str | None = None,
) -> tuple[Sequence[GenericSystemRecord], int]:
    query = build_records_query(db, tenant_id=tenant_id, module_key=module_key, search=search)
    total = query.count()
    records = query.order_by(GenericSystemRecord.id.desc()).offset(offset).limit(limit).all()
    return records, total


def list_records_cursor(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
) -> Sequence[GenericSystemRecord]:
    query = build_records_query(db, tenant_id=tenant_id, module_key=module_key, search=search)
    if cursor is not None:
        query = query.filter(GenericSystemRecord.id < cursor)
    return query.order_by(None).order_by(GenericSystemRecord.id.desc()).limit(limit + 1).all()


def get_record(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    record_id: int,
    include_deleted: bool = False,
) -> GenericSystemRecord | None:
    return (
        build_records_query(db, tenant_id=tenant_id, module_key=module_key, include_deleted=include_deleted)
        .filter(GenericSystemRecord.id == record_id)
        .first()
    )
