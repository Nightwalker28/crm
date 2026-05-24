from datetime import datetime
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.modules.__area__.models import __Module__
from app.modules.__area__.repositories import __modules___repository
from app.modules.platform.services.custom_fields import (
    hydrate_custom_field_record,
    hydrate_custom_field_records,
    load_custom_field_values_with_fallback,
    save_custom_field_values,
    validate_custom_field_payload,
)


def _ensure_assigned_user(db: Session, user_id: int | None, *, tenant_id: int) -> None:
    if user_id is None:
        return
    if not __modules___repository.user_exists(db, user_id=user_id, tenant_id=tenant_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")


def list___modules__(
    db: Session,
    tenant_id: int,
    pagination: Pagination,
    search: str | None = None,
    *,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[Sequence[__Module__], int]:
    records, total_count = __modules___repository.list___modules__(
        db,
        tenant_id=tenant_id,
        pagination=pagination,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    return hydrate_custom_field_records(db, tenant_id=tenant_id, module_key="__MODULE_KEY__", records=records, record_id_attr="__id_field__"), total_count


def list___modules___cursor(
    db: Session,
    tenant_id: int,
    *,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[__Module__]:
    records = __modules___repository.list___modules___cursor(
        db,
        tenant_id=tenant_id,
        limit=limit,
        cursor=cursor,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    return hydrate_custom_field_records(db, tenant_id=tenant_id, module_key="__MODULE_KEY__", records=records, record_id_attr="__id_field__")


def get___module___or_404(db: Session, __id_field__: int, *, tenant_id: int, include_deleted: bool = False) -> __Module__:
    record = __modules___repository.get___module__(db, tenant_id=tenant_id, __id_field__=__id_field__, include_deleted=include_deleted)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="__Module__ not found")
    return hydrate_custom_field_record(db, tenant_id=tenant_id, module_key="__MODULE_KEY__", record=record, record_id=record.__id_field__)


def create___module__(db: Session, payload: dict, current_user) -> __Module__:
    data = dict(payload)
    custom_data = validate_custom_field_payload(
        db,
        tenant_id=current_user.tenant_id,
        module_key="__MODULE_KEY__",
        payload=data.pop("custom_fields", None),
    )
    data["custom_data"] = custom_data
    data["tenant_id"] = current_user.tenant_id
    if not data.get("assigned_to"):
        data["assigned_to"] = current_user.id if current_user else None
    _ensure_assigned_user(db, data.get("assigned_to"), tenant_id=current_user.tenant_id)

    record = __Module__(**data)
    db.add(record)
    db.commit()
    db.refresh(record)
    save_custom_field_values(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", record_id=record.__id_field__, values=custom_data)
    db.commit()
    return hydrate_custom_field_record(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", record=record, record_id=record.__id_field__)


def update___module__(db: Session, record: __Module__, data: dict) -> __Module__:
    custom_data_to_save: dict | None = None
    if "custom_fields" in data:
        custom_data_to_save = validate_custom_field_payload(
            db,
            tenant_id=record.tenant_id,
            module_key="__MODULE_KEY__",
            payload=data.pop("custom_fields"),
            existing=load_custom_field_values_with_fallback(
                db,
                tenant_id=record.tenant_id,
                module_key="__MODULE_KEY__",
                record_id=record.__id_field__,
                fallback=record.custom_data,
            ),
        )
        data["custom_data"] = custom_data_to_save
    if "assigned_to" in data:
        _ensure_assigned_user(db, data["assigned_to"], tenant_id=record.tenant_id)
    for field, value in data.items():
        setattr(record, field, value)
    db.add(record)
    db.commit()
    db.refresh(record)
    if custom_data_to_save is not None:
        save_custom_field_values(db, tenant_id=record.tenant_id, module_key="__MODULE_KEY__", record_id=record.__id_field__, values=custom_data_to_save)
        db.commit()
    return hydrate_custom_field_record(db, tenant_id=record.tenant_id, module_key="__MODULE_KEY__", record=record, record_id=record.__id_field__)


def delete___module__(db: Session, record: __Module__) -> None:
    record.deleted_at = datetime.utcnow()
    db.add(record)
    db.commit()


def restore___module__(db: Session, record: __Module__) -> __Module__:
    record.deleted_at = None
    db.add(record)
    db.commit()
    db.refresh(record)
    return hydrate_custom_field_record(db, tenant_id=record.tenant_id, module_key="__MODULE_KEY__", record=record, record_id=record.__id_field__)


def list_deleted___modules__(db: Session, tenant_id: int, pagination: Pagination) -> tuple[Sequence[__Module__], int]:
    return __modules___repository.list_deleted___modules__(db, tenant_id=tenant_id, pagination=pagination)
