from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

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

MODULE_PROTECTED_FIELD_KEYS = {
    # Email is optional on leads and contacts since 13b Phase 3 (13a A9), so it can be hidden.
    "sales_leads": set(),
    "sales_contacts": set(),
    "sales_organizations": {"org_name"},
    "sales_opportunities": {"opportunity_name"},
    "sales_quotes": {"quote_number", "customer_name"},
    "sales_orders": {"order_number"},
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
        is_required=bool(config.is_required),
        is_readonly=bool(config.is_readonly) and not is_protected,
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
    return {}


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
    if is_protected and payload.is_readonly is True:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Protected identifier fields cannot be read-only")
    if normalized_field_key.startswith("custom:") and (payload.is_required is not None or payload.is_readonly is not None):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set a custom field's rules on the field itself, in Settings → Fields",
        )

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
    # Hidden, required and read-only exclude each other: a user could never satisfy the rule.
    # Checked before anything is set, so a refusal leaves the session clean.
    def effective(name: str) -> bool:
        value = update_data.get(name)
        return bool(getattr(config, name, False)) if value is None else bool(value)

    will_require = effective("is_required")
    if will_require and effective("is_readonly") and not is_protected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A field cannot be both required and read-only")
    if will_require and not is_protected and update_data.get("is_enabled", config.is_enabled) is False:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A hidden field cannot be required")

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
        config.is_readonly = False

    db.add(config)
    try:
        db.commit()
        db.refresh(config)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Field config already exists") from exc
    return _serialize_field_config(config)


@dataclass(frozen=True)
class FieldRule:
    label: str
    required: bool
    readonly: bool


def module_field_rules(db: Session, *, tenant_id: int, module_key: str) -> dict[str, FieldRule]:
    """An administrator's required and read-only standard fields (13b Phase 4, F3.4).

    Custom fields keep their rules on their definition; only configs that set a rule appear here.
    """

    configs = (
        db.query(ModuleFieldConfig)
        .filter(
            ModuleFieldConfig.tenant_id == tenant_id,
            ModuleFieldConfig.module_key == module_key,
        )
        .all()
    )
    rules: dict[str, FieldRule] = {}
    for config in configs:
        if config.field_key.startswith("custom:"):
            continue
        protected = bool(config.is_protected) or is_protected_module_field(config.field_key, module_key)
        enabled = protected or bool(config.is_enabled)
        required = enabled and bool(config.is_required)
        readonly = not protected and bool(config.is_readonly)
        if required or readonly:
            rules[config.field_key] = FieldRule(label=config.label or config.field_key, required=required, readonly=readonly)
    return rules


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _same_value(submitted: Any, current: Any) -> bool:
    if _is_blank(submitted) and _is_blank(current):
        return True
    if submitted == current:
        return True
    if isinstance(submitted, (int, float, Decimal)) and isinstance(current, (int, float, Decimal)):
        return Decimal(str(submitted)) == Decimal(str(current))
    if hasattr(current, "isoformat") and isinstance(submitted, str):
        return current.isoformat() == submitted
    return str(submitted).strip() == str(current).strip()


_MISSING = object()


def enforce_field_rules(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    payload: dict,
    existing: Any | None = None,
) -> dict:
    """Apply an administrator's field rules to a user write and return the payload to save.

    Called from the routes, which are the user writes (13b §5 decision 9); system writes —
    the portal, website orders, lead conversion, automation — call the services directly and
    keep only the domain's required fields.

    - Create (`existing` is None): a required field must have a value; a read-only field is
      dropped, so the record takes its default.
    - Update: a submitted required field cannot be emptied; a read-only field that differs
      from the record is refused, an unchanged one is dropped.
    """

    rules = module_field_rules(db, tenant_id=tenant_id, module_key=module_key)
    if not rules:
        return payload
    result = dict(payload)
    missing: list[str] = []
    readonly_changed: list[str] = []
    for field_key, rule in rules.items():
        if rule.readonly and field_key in result:
            submitted = result.pop(field_key)
            if existing is not None:
                current = getattr(existing, field_key, _MISSING)
                if current is not _MISSING and not _same_value(submitted, current):
                    readonly_changed.append(rule.label)
            continue
        if not rule.required:
            continue
        if existing is None:
            if _is_blank(result.get(field_key)):
                missing.append(rule.label)
        elif field_key in result and _is_blank(result[field_key]):
            missing.append(rule.label)
    if readonly_changed:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Read-only fields cannot be changed: {', '.join(sorted(readonly_changed))}",
        )
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Required fields are missing: {', '.join(sorted(missing))}",
        )
    return result


class ImportFieldRules:
    """Field rules for an import (13b §5 decision 9: imports are user writes).

    Loaded once per file. A read-only field is never set from a file. A required field must
    have a value when the row creates a record or overwrites one; a merge keeps the stored
    value for a blank cell, so it is not checked there.
    """

    def __init__(self, db: Session, *, tenant_id: int, module_key: str):
        self.rules = module_field_rules(db, tenant_id=tenant_id, module_key=module_key)

    def apply(self, payload: dict, *, existing: Any | None = None, overwrite: bool = False) -> str | None:
        """Drops read-only fields from `payload` in place; returns the row's failure reason, if any."""

        if not self.rules:
            return None
        missing: list[str] = []
        for field_key, rule in self.rules.items():
            if rule.readonly:
                payload.pop(field_key, None)
                continue
            if rule.required and (existing is None or overwrite) and _is_blank(payload.get(field_key)):
                missing.append(rule.label)
        if missing:
            return f"Required fields are missing: {', '.join(sorted(missing))}"
        return None
