from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.modules.platform.models import CustomModuleDefinition, CustomModuleRecord, CustomModuleRecordValue


CUSTOM_MODULE_RECORD_SORT_FIELDS = {
    "title": CustomModuleRecord.title,
    "created_at": CustomModuleRecord.created_at,
    "updated_at": CustomModuleRecord.updated_at,
}


def record_load_options():
    return (selectinload(CustomModuleRecord.values).selectinload(CustomModuleRecordValue.field),)


def build_records_query(
    db: Session,
    *,
    definition: CustomModuleDefinition,
    search: str | None = None,
    include_deleted: bool = False,
):
    query = (
        db.query(CustomModuleRecord)
        .options(*record_load_options())
        .filter(
            CustomModuleRecord.tenant_id == definition.tenant_id,
            CustomModuleRecord.custom_module_id == definition.id,
        )
    )
    if not include_deleted:
        query = query.filter(CustomModuleRecord.deleted_at.is_(None))
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = (
            query.outerjoin(CustomModuleRecordValue, CustomModuleRecordValue.record_id == CustomModuleRecord.id)
            .filter(or_(CustomModuleRecord.title.ilike(pattern), CustomModuleRecordValue.text_value.ilike(pattern)))
            .distinct()
        )
    return query


def apply_record_sort(query, *, sort_by: str | None = None, sort_direction: str | None = None):
    sort_column = CUSTOM_MODULE_RECORD_SORT_FIELDS.get((sort_by or "").strip())
    default_direction = "asc"
    if sort_column is None:
        sort_column = CustomModuleRecord.updated_at
        default_direction = "desc"
    direction = (sort_direction or default_direction).strip().lower()
    ordered = sort_column.desc() if direction == "desc" else sort_column.asc()
    return query.order_by(None).order_by(ordered.nullslast(), CustomModuleRecord.id.desc())


def list_records(
    db: Session,
    *,
    definition: CustomModuleDefinition,
    offset: int,
    limit: int,
    search: str | None = None,
    include_deleted: bool = False,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[CustomModuleRecord], int]:
    query = build_records_query(db, definition=definition, search=search, include_deleted=include_deleted)
    total = query.count()
    records = (
        apply_record_sort(query, sort_by=sort_by, sort_direction=sort_direction)
        .offset(offset)
        .limit(limit)
        .all()
    )
    return records, total


def list_records_cursor(
    db: Session,
    *,
    definition: CustomModuleDefinition,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
) -> list[CustomModuleRecord]:
    query = build_records_query(db, definition=definition, search=search)
    if cursor is not None:
        query = query.filter(CustomModuleRecord.id < cursor)
    return query.order_by(None).order_by(CustomModuleRecord.id.desc()).limit(limit + 1).all()


def get_record(
    db: Session,
    *,
    definition: CustomModuleDefinition,
    record_id: int,
    include_deleted: bool = False,
) -> CustomModuleRecord | None:
    return (
        build_records_query(db, definition=definition, include_deleted=include_deleted)
        .filter(CustomModuleRecord.id == record_id)
        .first()
    )
