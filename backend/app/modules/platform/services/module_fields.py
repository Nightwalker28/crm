from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.platform.models import ModuleFieldConfig
from app.modules.platform.schema import ModuleFieldConfigResponse, ModuleFieldConfigUpdateRequest
from app.modules.platform.system_modules import SYSTEM_MODULES


PROTECTED_FIELD_KEYS = {
    "id",
    "record_id",
    "primary_key",
    "uuid",
    "key",
    "title",
    "name",
}

MODULE_PROTECTED_FIELD_KEYS = {
    "sales_contacts": {"primary_email"},
    "sales_organizations": {"org_name", "primary_email"},
    "sales_opportunities": {"opportunity_name"},
    "finance_io": {"io_number", "customer_name"},
}


def is_protected_module_field(field_key: str, module_key: str | None = None) -> bool:
    normalized = field_key.strip()
    if normalized.startswith("custom:"):
        normalized = normalized.removeprefix("custom:")
    return (
        normalized in PROTECTED_FIELD_KEYS
        or (module_key is not None and normalized in MODULE_PROTECTED_FIELD_KEYS.get(module_key, set()))
        or normalized.endswith("_id")
        or normalized.endswith("_key")
    )


def _serialize_field_config(config: ModuleFieldConfig) -> ModuleFieldConfigResponse:
    is_protected = bool(config.is_protected) or is_protected_module_field(config.field_key, config.module_key)
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


def _default_field_state(module_key: str) -> dict[str, bool]:
    definition = SYSTEM_MODULES.get(module_key) or {}
    states: dict[str, bool] = {}
    for field_definition in definition.get("fields") or []:
        field_key = str(field_definition["field_key"])
        protected = bool(field_definition.get("is_protected")) or is_protected_module_field(field_key, module_key)
        states[field_key] = protected or bool(field_definition.get("is_enabled", True))
    return states


def module_field_enabled_map(db: Session, *, tenant_id: int, module_key: str) -> dict[str, bool]:
    states = _default_field_state(module_key)
    configs = (
        db.query(ModuleFieldConfig)
        .filter(
            ModuleFieldConfig.tenant_id == tenant_id,
            ModuleFieldConfig.module_key == module_key,
        )
        .all()
    )
    for config in configs:
        protected = bool(config.is_protected) or is_protected_module_field(config.field_key, module_key)
        states[config.field_key] = protected or bool(config.is_enabled)
    return states


def enabled_module_fields(db: Session, *, tenant_id: int, module_key: str, field_keys: set[str] | list[str]) -> set[str]:
    states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    return {field_key for field_key in field_keys if states.get(field_key, True)}


def enabled_module_field_sequence(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    field_keys: list[str],
) -> list[str]:
    states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    return [field_key for field_key in field_keys if states.get(field_key, True)]


def sanitize_disabled_field_payload(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    payload: dict,
) -> dict:
    states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    return {
        field_key: value
        for field_key, value in payload.items()
        if field_key == "custom_fields" or states.get(field_key, True)
    }


def reject_disabled_field_writes(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    field_keys: set[str],
) -> None:
    states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    disabled = sorted(field_key for field_key in field_keys if not states.get(field_key, True))
    if disabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Disabled fields cannot be written: {', '.join(disabled)}",
        )


def sanitize_disabled_filter_conditions(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    conditions: list[dict] | None,
) -> list[dict]:
    if not conditions:
        return []
    states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    return [condition for condition in conditions if states.get(str(condition.get("field") or ""), True)]


def sanitize_data_transfer_export_payload(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    payload: dict,
    export_field_keys: list[str],
) -> dict:
    enabled_export_fields = enabled_module_field_sequence(
        db,
        tenant_id=tenant_id,
        module_key=module_key,
        field_keys=export_field_keys,
    )
    visible_columns = payload.get("visible_columns")
    if isinstance(visible_columns, list):
        requested_fields = [field for field in visible_columns if isinstance(field, str)]
        enabled_requested_fields = [field for field in requested_fields if field in enabled_export_fields]
        if enabled_requested_fields:
            enabled_export_fields = enabled_requested_fields

    return {
        **payload,
        "field_keys": enabled_export_fields,
        "visible_columns": enabled_export_fields,
        "filters_all": sanitize_disabled_filter_conditions(
            db,
            tenant_id=tenant_id,
            module_key=module_key,
            conditions=payload.get("filters_all"),
        ),
        "filters_any": sanitize_disabled_filter_conditions(
            db,
            tenant_id=tenant_id,
            module_key=module_key,
            conditions=payload.get("filters_any"),
        ),
    }


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

    is_protected = is_protected_module_field(normalized_field_key, normalized_module_key) or bool(payload.is_protected)
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
