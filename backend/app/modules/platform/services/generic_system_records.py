from __future__ import annotations

from datetime import datetime
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.modules.platform.models import GenericSystemRecord
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
    query = db.query(GenericSystemRecord).filter(
        GenericSystemRecord.tenant_id == tenant_id,
        GenericSystemRecord.module_key == module_key,
        GenericSystemRecord.deleted_at.is_(None),
    )
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(GenericSystemRecord.title.ilike(pattern), GenericSystemRecord.status.ilike(pattern)))
    total = query.count()
    records = query.order_by(GenericSystemRecord.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return records, total


def get_record_or_404(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    record_id: int,
    include_deleted: bool = False,
) -> GenericSystemRecord:
    module_key = ensure_generic_module_key(module_key)
    query = db.query(GenericSystemRecord).filter(
        GenericSystemRecord.tenant_id == tenant_id,
        GenericSystemRecord.module_key == module_key,
        GenericSystemRecord.id == record_id,
    )
    if not include_deleted:
        query = query.filter(GenericSystemRecord.deleted_at.is_(None))
    record = query.first()
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

