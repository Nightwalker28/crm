from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.cache import cache_delete, cache_delete_prefix, cache_get_json, cache_set_json
from app.modules.platform.models import CustomFieldDefinition, CustomFieldValue
from app.modules.platform.schema import (
    CustomFieldDefinitionCreateRequest,
    CustomFieldDefinitionUpdateRequest,
)


SUPPORTED_MODULE_KEYS = {
    "finance_io",
    "sales_contacts",
    "sales_organizations",
    "sales_opportunities",
}

SUPPORTED_FIELD_TYPES = {"text", "long_text", "number", "date", "boolean"}
DEFINITION_CACHE_TTL_SECONDS = 300


@dataclass(frozen=True)
class CachedCustomFieldDefinition:
    id: int
    module_key: str
    field_key: str
    label: str
    field_type: str
    placeholder: str | None
    help_text: str | None
    is_required: bool
    is_active: bool
    sort_order: int


def list_custom_field_definitions(
    db: Session,
    *,
    module_key: str,
    include_inactive: bool = False,
) -> list[CustomFieldDefinition | CachedCustomFieldDefinition]:
    cache_key = f"custom-field-definitions:{module_key}:{int(include_inactive)}"
    cached = cache_get_json(cache_key)
    if cached:
        return [CachedCustomFieldDefinition(**item) for item in cached]

    query = db.query(CustomFieldDefinition).filter(CustomFieldDefinition.module_key == module_key)
    if not include_inactive:
        query = query.filter(CustomFieldDefinition.is_active.is_(True))
    results = query.order_by(CustomFieldDefinition.sort_order.asc(), CustomFieldDefinition.id.asc()).all()
    cached_results = [
        CachedCustomFieldDefinition(
            id=item.id,
            module_key=item.module_key,
            field_key=item.field_key,
            label=item.label,
            field_type=item.field_type,
            placeholder=item.placeholder,
            help_text=item.help_text,
            is_required=bool(item.is_required),
            is_active=bool(item.is_active),
            sort_order=item.sort_order,
        )
        for item in results
    ]
    cache_set_json(
        cache_key,
        [item.__dict__ for item in cached_results],
        ttl_seconds=DEFINITION_CACHE_TTL_SECONDS,
    )
    return results


def create_custom_field_definition(
    db: Session,
    *,
    module_key: str,
    payload: CustomFieldDefinitionCreateRequest,
) -> CustomFieldDefinition:
    _ensure_supported_module(module_key)
    field_key = _normalize_field_key(payload.field_key)
    _ensure_supported_field_type(payload.field_type)

    existing = (
        db.query(CustomFieldDefinition)
        .filter(
            CustomFieldDefinition.module_key == module_key,
            CustomFieldDefinition.field_key == field_key,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field key already exists for this module")

    item = CustomFieldDefinition(
        module_key=module_key,
        field_key=field_key,
        label=payload.label.strip(),
        field_type=payload.field_type,
        placeholder=payload.placeholder.strip() if payload.placeholder else None,
        help_text=payload.help_text.strip() if payload.help_text else None,
        is_required=payload.is_required,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    invalidate_custom_field_definition_cache(module_key)
    return item


def update_custom_field_definition(
    db: Session,
    *,
    field_id: int,
    payload: CustomFieldDefinitionUpdateRequest,
) -> CustomFieldDefinition:
    item = _get_custom_field_definition_or_404(db, field_id)
    data = payload.model_dump(exclude_unset=True)
    if "field_type" in data and data["field_type"] is not None:
        _ensure_supported_field_type(data["field_type"])

    for field, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(item, field, value)

    db.commit()
    db.refresh(item)
    invalidate_custom_field_definition_cache(item.module_key)
    return item


def invalidate_custom_field_definition_cache(module_key: str | None = None) -> None:
    if module_key is None:
        cache_delete_prefix("custom-field-definitions:")
        return

    for include_inactive in (False, True):
        cache_delete(f"custom-field-definitions:{module_key}:{int(include_inactive)}")


def validate_custom_field_payload(
    db: Session,
    *,
    module_key: str,
    payload: dict[str, Any] | None,
    existing: dict[str, Any] | None = None,
    enforce_required: bool = True,
) -> dict[str, Any]:
    definitions = list_custom_field_definitions(db, module_key=module_key, include_inactive=False)
    definition_map = {definition.field_key: definition for definition in definitions}
    payload = payload or {}
    existing = existing or {}

    unknown_keys = sorted(set(payload) - set(definition_map))
    if unknown_keys:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown custom field keys: {', '.join(unknown_keys)}",
        )

    normalized: dict[str, Any] = dict(existing)
    for key, definition in definition_map.items():
        if key in payload:
            normalized[key] = _normalize_custom_field_value(definition, payload[key])

    if enforce_required:
        missing = [
            definition.label
            for definition in definitions
            if definition.is_required and _is_empty_custom_value(normalized.get(definition.field_key))
        ]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing required custom fields: {', '.join(missing)}",
            )

    return {key: value for key, value in normalized.items() if not _is_empty_custom_value(value)}


def load_custom_field_values(
    db: Session,
    *,
    module_key: str,
    record_id: int,
) -> dict[str, Any]:
    rows = (
        db.query(CustomFieldValue)
        .join(CustomFieldDefinition, CustomFieldDefinition.id == CustomFieldValue.field_definition_id)
        .filter(
            CustomFieldValue.module_key == module_key,
            CustomFieldValue.record_id == record_id,
        )
        .all()
    )
    results: dict[str, Any] = {}
    for row in rows:
        definition = row.definition
        if not definition:
            continue
        if definition.field_type in {"text", "long_text"}:
            results[definition.field_key] = row.value_text
        elif definition.field_type == "number":
            results[definition.field_key] = row.value_number
        elif definition.field_type == "date":
            results[definition.field_key] = row.value_date
        elif definition.field_type == "boolean":
            results[definition.field_key] = row.value_boolean
    return {key: value for key, value in results.items() if not _is_empty_custom_value(value)}


def load_custom_field_values_with_fallback(
    db: Session,
    *,
    module_key: str,
    record_id: int,
    fallback: dict[str, Any] | None = None,
) -> dict[str, Any]:
    values = load_custom_field_values(db, module_key=module_key, record_id=record_id)
    if values:
        return values
    return {key: value for key, value in (fallback or {}).items() if not _is_empty_custom_value(value)}


def hydrate_custom_field_record(
    db: Session,
    *,
    module_key: str,
    record,
    record_id: int,
):
    values = load_custom_field_values_with_fallback(
        db,
        module_key=module_key,
        record_id=record_id,
        fallback=getattr(record, "custom_data", None),
    )
    record.custom_data = values or None
    return record


def hydrate_custom_field_records(
    db: Session,
    *,
    module_key: str,
    records: Iterable[tuple[int, Any]] | Iterable[Any],
    record_id_attr: str | None = None,
) -> list[Any]:
    hydrated: list[Any] = []
    for entry in records:
        if isinstance(entry, tuple):
            record_id, record = entry
        else:
            if not record_id_attr:
                raise ValueError("record_id_attr is required when hydrating raw record iterables")
            record = entry
            record_id = getattr(record, record_id_attr)
        hydrated.append(hydrate_custom_field_record(db, module_key=module_key, record=record, record_id=record_id))
    return hydrated


def save_custom_field_values(
    db: Session,
    *,
    module_key: str,
    record_id: int,
    values: dict[str, Any],
) -> None:
    definitions = list_custom_field_definitions(db, module_key=module_key, include_inactive=True)
    definition_map = {definition.field_key: definition for definition in definitions}

    (
        db.query(CustomFieldValue)
        .filter(
            CustomFieldValue.module_key == module_key,
            CustomFieldValue.record_id == record_id,
        )
        .delete(synchronize_session=False)
    )

    for field_key, value in values.items():
        definition = definition_map.get(field_key)
        if not definition:
            continue
        row = CustomFieldValue(
            module_key=module_key,
            record_id=record_id,
            field_definition_id=definition.id,
        )
        if definition.field_type in {"text", "long_text"}:
            row.value_text = str(value)
        elif definition.field_type == "number":
            row.value_number = value
        elif definition.field_type == "date":
            row.value_date = str(value)
        elif definition.field_type == "boolean":
            row.value_boolean = bool(value)
        db.add(row)


def _get_custom_field_definition_or_404(db: Session, field_id: int) -> CustomFieldDefinition:
    item = db.query(CustomFieldDefinition).filter(CustomFieldDefinition.id == field_id).first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom field not found")
    return item


def _normalize_field_key(value: str) -> str:
    field_key = value.strip().lower().replace(" ", "_")
    if not field_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field key is required")
    return field_key


def _ensure_supported_module(module_key: str) -> None:
    if module_key not in SUPPORTED_MODULE_KEYS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported module for custom fields")


def _ensure_supported_field_type(field_type: str) -> None:
    if field_type not in SUPPORTED_FIELD_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported custom field type")


def _normalize_custom_field_value(definition: CustomFieldDefinition, value: Any) -> Any:
    if value is None or value == "":
        return None

    if definition.field_type in {"text", "long_text"}:
        return str(value).strip() or None

    if definition.field_type == "number":
        try:
            return float(Decimal(str(value)))
        except (InvalidOperation, ValueError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid number for custom field '{definition.label}'",
            )

    if definition.field_type == "date":
        try:
            return date.fromisoformat(str(value)).isoformat()
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid date for custom field '{definition.label}'",
            )

    if definition.field_type == "boolean":
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in {"true", "1", "yes"}:
            return True
        if text in {"false", "0", "no"}:
            return False
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid boolean for custom field '{definition.label}'",
        )

    return value


def _is_empty_custom_value(value: Any) -> bool:
    return value is None or value == "" or value == []
