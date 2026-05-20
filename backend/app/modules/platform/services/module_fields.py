from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.platform.models import ModuleFieldConfig
from app.modules.platform.schema import ModuleFieldConfigResponse, ModuleFieldConfigUpdateRequest


PROTECTED_FIELD_KEYS = {
    "id",
    "record_id",
    "primary_key",
    "uuid",
    "key",
    "title",
    "name",
}


def is_protected_module_field(field_key: str) -> bool:
    normalized = field_key.strip()
    if normalized.startswith("custom:"):
        normalized = normalized.removeprefix("custom:")
    return (
        normalized in PROTECTED_FIELD_KEYS
        or normalized.endswith("_id")
        or normalized.endswith("_key")
    )


def _serialize_field_config(config: ModuleFieldConfig) -> ModuleFieldConfigResponse:
    is_protected = bool(config.is_protected) or is_protected_module_field(config.field_key)
    return ModuleFieldConfigResponse(
        id=config.id,
        module_key=config.module_key,
        field_key=config.field_key,
        label=config.label,
        field_type=config.field_type,
        field_source=config.field_source,
        is_enabled=bool(config.is_enabled) or is_protected,
        is_protected=is_protected,
        sort_order=config.sort_order or 0,
        created_at=config.created_at,
        updated_at=config.updated_at,
    )


def list_module_field_configs(db: Session, *, tenant_id: int, module_key: str) -> list[ModuleFieldConfigResponse]:
    configs = (
        db.query(ModuleFieldConfig)
        .filter(
            ModuleFieldConfig.tenant_id == tenant_id,
            ModuleFieldConfig.module_key == module_key,
        )
        .order_by(ModuleFieldConfig.sort_order.asc(), ModuleFieldConfig.id.asc())
        .all()
    )
    return [_serialize_field_config(config) for config in configs]


def update_module_field_config(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    field_key: str,
    payload: ModuleFieldConfigUpdateRequest,
) -> ModuleFieldConfigResponse:
    normalized_module_key = module_key.strip()
    normalized_field_key = field_key.strip()
    if not normalized_module_key or not normalized_field_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Module key and field key are required")

    is_protected = is_protected_module_field(normalized_field_key) or bool(payload.is_protected)
    if is_protected and payload.is_enabled is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Protected identifier fields cannot be disabled")

    config = (
        db.query(ModuleFieldConfig)
        .filter(
            ModuleFieldConfig.tenant_id == tenant_id,
            ModuleFieldConfig.module_key == normalized_module_key,
            ModuleFieldConfig.field_key == normalized_field_key,
        )
        .first()
    )
    if config is None:
        config = ModuleFieldConfig(
            tenant_id=tenant_id,
            module_key=normalized_module_key,
            field_key=normalized_field_key,
            label=payload.label.strip() if payload.label else normalized_field_key,
        )

    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is None:
            continue
        if isinstance(value, str):
            value = value.strip()
        setattr(config, field, value)
    config.module_key = normalized_module_key
    config.field_key = normalized_field_key
    config.is_protected = is_protected
    if config.is_protected:
        config.is_enabled = True

    db.add(config)
    try:
        db.commit()
        db.refresh(config)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Field config already exists") from exc
    return _serialize_field_config(config)
