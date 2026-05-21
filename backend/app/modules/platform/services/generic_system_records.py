from __future__ import annotations

from datetime import datetime
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.modules.platform.models import GenericSystemRecord
from app.modules.platform.repositories import generic_system_records_repository
from app.modules.platform.system_modules import SYSTEM_MODULES


GENERIC_SYSTEM_MODULE_KEYS = {
    key
    for key, definition in SYSTEM_MODULES.items()
    if definition.get("base_route") and str(definition.get("base_route")).startswith("/dashboard/modules/")
}


def ensure_generic_module_key(module_key: str) -> str:
    normalized = module_key.strip()
    if normalized not in GENERIC_SYSTEM_MODULE_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Generic module not found")
    return normalized


def list_records(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    pagination: Pagination,
    search: str | None = None,
) -> tuple[Sequence[GenericSystemRecord], int]:
    module_key = ensure_generic_module_key(module_key)
    return generic_system_records_repository.list_records(
        db,
        tenant_id=tenant_id,
        module_key=module_key,
        offset=pagination.offset,
        limit=pagination.limit,
        search=search,
    )


def list_records_cursor(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
) -> Sequence[GenericSystemRecord]:
    module_key = ensure_generic_module_key(module_key)
    return generic_system_records_repository.list_records_cursor(
        db,
        tenant_id=tenant_id,
        module_key=module_key,
        limit=limit,
        cursor=cursor,
        search=search,
    )


def get_record_or_404(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    record_id: int,
    include_deleted: bool = False,
) -> GenericSystemRecord:
    module_key = ensure_generic_module_key(module_key)
    record = generic_system_records_repository.get_record(
        db,
        tenant_id=tenant_id,
        module_key=module_key,
        record_id=record_id,
        include_deleted=include_deleted,
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    return record


def create_record(db: Session, *, tenant_id: int, module_key: str, payload: dict, actor_user_id: int | None):
    module_key = ensure_generic_module_key(module_key)
    record = GenericSystemRecord(
        tenant_id=tenant_id,
        module_key=module_key,
        title=payload["title"].strip(),
        status=(payload.get("status") or None),
        data=payload.get("data") or {},
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_record(db: Session, *, record: GenericSystemRecord, payload: dict, actor_user_id: int | None):
    if "title" in payload and payload["title"] is not None:
        record.title = payload["title"].strip()
    if "status" in payload:
        record.status = payload["status"] or None
    if "data" in payload:
        record.data = payload["data"] or {}
    record.updated_by_user_id = actor_user_id
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def delete_record(db: Session, *, record: GenericSystemRecord) -> None:
    record.deleted_at = datetime.utcnow()
    db.add(record)
    db.commit()


def restore_record(db: Session, *, record: GenericSystemRecord):
    record.deleted_at = None
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
