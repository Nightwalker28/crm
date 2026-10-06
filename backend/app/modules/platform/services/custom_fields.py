"""Custom fields on every module, on the one field system (13b §3.4, F3.1–F3.2).

Definitions live in `field_definitions` and values in `field_values`; what each type means is
`app/core/field_types.py`. Built-in modules (CRM, catalog and every ERP document) and custom
modules share both tables. This module holds what every module's service calls: check a
payload, save it, load it back, filter on it.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core import field_types
from app.core.field_types import FieldContext, FieldValueError
from app.modules.platform.models import FieldDefinition, FieldValue
from app.modules.platform.schema import CustomFieldDefinitionCreateRequest, CustomFieldDefinitionUpdateRequest
from app.modules.platform.services.numbering import allocate_business_number

# Built-in modules that take custom fields, with the name the field settings show.
SUPPORTED_MODULE_KEYS: dict[str, str] = {
    "sales_leads": "Leads",
    "sales_contacts": "Contacts",
    "sales_organizations": "Accounts",
    "sales_opportunities": "Deals",
    "sales_quotes": "Quotes",
    "sales_orders": "Orders",
    "catalog_products": "Products",
    "catalog_services": "Services",
    "finance_pos": "Invoices",
    "finance_credit_notes": "Credit notes",
    "finance_payments": "Payments",
    "purchase_orders": "Purchase orders",
    "purchase_receipts": "Receipts",
    "purchase_bills": "Bills",
    "inventory_deliveries": "Deliveries",
    "inventory_returns": "Returns",
    "inventory_adjustments": "Stock adjustments",
    "inventory_transfers": "Stock transfers",
}
CUSTOM_FIELD_FILTER_PREFIX = "custom:"
AUTO_NUMBER_DEFAULT_PREFIX = "NO"


# --- definitions ------------------------------------------------------------------------


def _definitions_query(db: Session, *, tenant_id: int, module_key: str):
    return (
        db.query(FieldDefinition)
        .options(selectinload(FieldDefinition.picklist))
        .filter(
            FieldDefinition.tenant_id == tenant_id,
            FieldDefinition.module_key == module_key,
            FieldDefinition.deleted_at.is_(None),
        )
    )


def list_custom_field_definitions(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    include_inactive: bool = False,
) -> list[FieldDefinition]:
    query = _definitions_query(db, tenant_id=tenant_id, module_key=module_key)
    if not include_inactive:
        query = query.filter(FieldDefinition.is_active.is_(True))
    return query.order_by(FieldDefinition.sort_order.asc(), FieldDefinition.id.asc()).all()


def serialize_definition(definition: FieldDefinition) -> dict[str, Any]:
    return {
        "id": definition.id,
        "module_key": definition.module_key,
        "field_key": definition.field_key,
        "label": definition.label,
        "field_type": definition.field_type,
        "picklist_key": definition.picklist_key,
        "lookup_module_key": definition.lookup_module_key,
        "config": definition.config,
        "placeholder": definition.placeholder,
        "help_text": definition.help_text,
        "is_required": bool(definition.is_required),
        "is_unique": bool(definition.is_unique),
        "is_active": bool(definition.is_active),
        "sort_order": definition.sort_order or 0,
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
    }


def _normalize_field_key(value: str) -> str:
    from app.modules.platform.services.picklists import slug_key

    return slug_key(value)


def _bad(detail: str, field: str | None = None) -> HTTPException:
    if field:
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=[{"loc": ["body", field], "msg": detail, "type": "domain"}],
        )
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def check_definition_shape(
    db: Session,
    *,
    tenant_id: int,
    field_type: str,
    label: str,
    picklist_key: str | None,
    picklist_values: list[str] | None,
    lookup_module_key: str | None,
    config: dict[str, Any] | None,
    is_unique: bool,
    is_required: bool,
) -> tuple[str, int | None]:
    """The canonical type and picklist id for a new field, or a refusal naming the fix.

    Shared by custom fields and custom modules, so both create fields the same way.
    """
    from app.modules.platform.services import picklists

    try:
        spec = field_types.field_type(field_type)
    except FieldValueError as exc:
        raise _bad("Choose one of the listed field types.", "field_type") from exc
    if is_unique and not spec.can_be_unique:
        raise _bad(f"{spec.label} fields cannot be unique.", "is_unique")
    if is_required and not spec.can_be_required:
        raise _bad(f"{spec.label} fields are filled by the platform, so they cannot be required.", "is_required")
    picklist_id = None
    if spec.key in {"picklist", "multi_picklist"}:
        if picklist_key:
            picklist_id = picklists.get_picklist(db, tenant_id, picklist_key).id
        else:
            values = [value for value in (picklist_values or []) if value and value.strip()]
            if not values:
                raise _bad("Choose a list, or enter the values for this field's own list.", "picklist_key")
            created = picklists.create_picklist(db, tenant_id, label=label, scope="local", actor_user_id=None)
            for value in values:
                picklists.add_value(db, tenant_id, created, label=value, actor_user_id=None, log=False)
            picklist_id = created.id
    if spec.key == "lookup" and lookup_module_key not in field_types.LOOKUP_TARGETS:
        raise _bad("Choose what this lookup links to.", "lookup_module_key")
    if config and not isinstance(config, dict):
        raise _bad("Field settings must be an object.", "config")
    return spec.key, picklist_id


def create_custom_field_definition(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    payload: CustomFieldDefinitionCreateRequest,
) -> FieldDefinition:
    if module_key not in SUPPORTED_MODULE_KEYS:
        raise _bad("This module does not take custom fields.")
    field_key = _normalize_field_key(payload.field_key or payload.label)
    if _definitions_query(db, tenant_id=tenant_id, module_key=module_key).filter(FieldDefinition.field_key == field_key).first():
        raise _bad("A field with this key already exists on the module.", "field_key")
    kind, picklist_id = check_definition_shape(
        db,
        tenant_id=tenant_id,
        field_type=payload.field_type,
        label=payload.label,
        picklist_key=payload.picklist_key,
        picklist_values=payload.picklist_values,
        lookup_module_key=payload.lookup_module_key,
        config=payload.config,
        is_unique=payload.is_unique,
        is_required=payload.is_required,
    )
    item = FieldDefinition(
        tenant_id=tenant_id,
        module_key=module_key,
        field_key=field_key,
        label=payload.label.strip(),
        field_type=kind,
        picklist_id=picklist_id,
        lookup_module_key=payload.lookup_module_key if kind == "lookup" else None,
        config=payload.config or None,
        placeholder=payload.placeholder.strip() if payload.placeholder else None,
        help_text=payload.help_text.strip() if payload.help_text else None,
        is_required=payload.is_required,
        is_unique=payload.is_unique,
        is_active=payload.is_active,
        sort_order=payload.sort_order,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def update_custom_field_definition(
    db: Session,
    *,
    tenant_id: int,
    field_id: int,
    payload: CustomFieldDefinitionUpdateRequest,
) -> FieldDefinition:
    item = (
        db.query(FieldDefinition)
        .filter(FieldDefinition.id == field_id, FieldDefinition.tenant_id == tenant_id, FieldDefinition.deleted_at.is_(None))
        .first()
    )
    if item is None or item.custom_module_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom field not found")
    data = payload.model_dump(exclude_unset=True)
    spec = field_types.field_type(item.field_type)
    if data.get("is_unique") and not spec.can_be_unique:
        raise _bad(f"{spec.label} fields cannot be unique.", "is_unique")
    if data.get("is_required") and not spec.can_be_required:
        raise _bad(f"{spec.label} fields cannot be required.", "is_required")
    for name, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        if name == "label" and not value:
            raise _bad("Enter a label.", "label")
        setattr(item, name, value)
    db.commit()
    db.refresh(item)
    return item


# --- values -----------------------------------------------------------------------------


def _value_error(field_key: str, message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail=[{"loc": ["body", "custom_fields", field_key], "msg": message, "type": "domain"}],
    )


def validate_custom_field_payload(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    payload: dict[str, Any] | None,
    existing: dict[str, Any] | None = None,
    enforce_required: bool = True,
    context: FieldContext | None = None,
    definitions: list[FieldDefinition] | None = None,
) -> dict[str, Any]:
    """The record's custom values after applying `payload` over `existing`, checked and in
    their stored form. Unknown keys and invalid values are refused on their field."""
    definitions = definitions if definitions is not None else list_custom_field_definitions(db, tenant_id=tenant_id, module_key=module_key)
    by_key = {definition.field_key: definition for definition in definitions}
    payload = payload or {}
    existing = dict(existing or {})
    unknown = sorted(set(payload) - set(by_key))
    if unknown:
        raise _value_error(unknown[0], "This field does not exist on the module.")
    ctx = context or FieldContext(db, tenant_id)
    normalized = {key: _stored_form(by_key[key], value) for key, value in existing.items() if key in by_key}
    for key, definition in by_key.items():
        if key not in payload:
            continue
        try:
            normalized[key] = field_types.normalize(definition, payload[key], ctx, current=normalized.get(key))
        except FieldValueError as exc:
            raise _value_error(key, str(exc)) from exc
    if enforce_required:
        for definition in definitions:
            if definition.is_required and field_types.is_empty(normalized.get(definition.field_key)):
                raise _value_error(definition.field_key, f"Fill in {definition.label}.")
    return {key: value for key, value in normalized.items() if not field_types.is_empty(value)}


def _stored_form(definition: FieldDefinition, value: Any) -> Any:
    """An already-saved value (JSON form, as loaded) back in the form `save` stores."""
    if isinstance(value, dict) and "id" in value:
        return value["id"]
    if value is None:
        return None
    kind = field_types.field_type(definition.field_type).key
    try:
        if kind in {"number", "decimal", "currency", "percent", "date", "datetime"}:
            return field_types.normalize(definition, value, None, current=None)  # type: ignore[arg-type]
    except FieldValueError:
        return value
    return value


def _rows(db: Session, *, tenant_id: int, module_key: str, record_ids: Iterable[int]) -> list[FieldValue]:
    ids = sorted({int(record_id) for record_id in record_ids})
    if not ids:
        return []
    return (
        db.query(FieldValue)
        .options(selectinload(FieldValue.definition).selectinload(FieldDefinition.picklist))
        .filter(FieldValue.tenant_id == tenant_id, FieldValue.module_key == module_key, FieldValue.record_id.in_(ids))
        .all()
    )


def load_custom_field_values_bulk(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    record_ids: Iterable[int],
    include_inactive: bool = False,
) -> dict[int, dict[str, Any]]:
    """Every record's values in one query, references labelled in one query per target."""
    rows = _rows(db, tenant_id=tenant_id, module_key=module_key, record_ids=record_ids)
    raw: dict[int, list[tuple[FieldDefinition, Any]]] = defaultdict(list)
    wanted: dict[str, set[int]] = defaultdict(set)
    for row in rows:
        definition = row.definition
        if definition is None or definition.deleted_at is not None or (not include_inactive and not definition.is_active):
            continue
        value = field_types.from_storage(definition, row)
        if value is None:
            continue
        raw[row.record_id].append((definition, value))
        if field_types.is_reference(definition.field_type):
            wanted[field_types.reference_target(definition)].add(int(value))
    labels = field_types.reference_labels(db, tenant_id, wanted) if wanted else {}
    return {
        record_id: {definition.field_key: field_types.present(definition, value, labels) for definition, value in items}
        for record_id, items in raw.items()
    }


def load_custom_field_values(db: Session, *, tenant_id: int, module_key: str, record_id: int) -> dict[str, Any]:
    return load_custom_field_values_bulk(db, tenant_id=tenant_id, module_key=module_key, record_ids=[record_id]).get(int(record_id), {})


def load_custom_field_values_with_fallback(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    record_id: int,
    fallback: dict[str, Any] | None = None,
) -> dict[str, Any]:
    values = load_custom_field_values(db, tenant_id=tenant_id, module_key=module_key, record_id=record_id)
    if values:
        return values
    return {key: value for key, value in (fallback or {}).items() if not field_types.is_empty(value)}


def hydrate_custom_field_record(db: Session, *, tenant_id: int, module_key: str, record, record_id: int):
    record.custom_data = load_custom_field_values(db, tenant_id=tenant_id, module_key=module_key, record_id=record_id) or None
    return record


def hydrate_custom_field_records(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    records: Iterable[tuple[int, Any]] | Iterable[Any],
    record_id_attr: str | None = None,
) -> list[Any]:
    pairs: list[tuple[int, Any]] = []
    for entry in records:
        if isinstance(entry, tuple):
            pairs.append((int(entry[0]), entry[1]))
        else:
            if not record_id_attr:
                raise ValueError("record_id_attr is required when hydrating raw record iterables")
            pairs.append((int(getattr(entry, record_id_attr)), entry))
    values = load_custom_field_values_bulk(db, tenant_id=tenant_id, module_key=module_key, record_ids=[pair[0] for pair in pairs])
    for record_id, record in pairs:
        record.custom_data = values.get(record_id) or None
    return [record for _record_id, record in pairs]


def _check_unique(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    definition: FieldDefinition,
    value: Any,
    record_id: int,
    excluded_record_ids=None,
) -> None:
    if not definition.is_unique or value is None:
        return
    column = getattr(FieldValue, field_types.storage_column(definition.field_type))
    query = db.query(FieldValue.id).filter(
        FieldValue.tenant_id == tenant_id,
        FieldValue.module_key == module_key,
        FieldValue.field_definition_id == definition.id,
        FieldValue.record_id != record_id,
        column == value,
    )
    if excluded_record_ids is not None:
        query = query.filter(FieldValue.record_id.notin_(excluded_record_ids))
    if query.first() is not None:
        raise _value_error(definition.field_key, f"Another record already has this {definition.label}.")


def save_custom_field_values(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    record_id: int,
    values: dict[str, Any],
    excluded_record_ids=None,
) -> None:
    """Replaces the record's values with `values` (as `validate_custom_field_payload` returns
    them), assigning auto-numbers the record does not have yet. Flushes, never commits."""
    definitions = list_custom_field_definitions(db, tenant_id=tenant_id, module_key=module_key, include_inactive=True)
    by_key = {definition.field_key: definition for definition in definitions}
    existing = {
        row.field_definition_id: row
        for row in db.query(FieldValue).filter(
            FieldValue.tenant_id == tenant_id, FieldValue.module_key == module_key, FieldValue.record_id == record_id
        )
    }
    for definition in definitions:
        row = existing.get(definition.id)
        spec = field_types.field_type(definition.field_type)
        if spec.system_assigned:
            if row is None and definition.is_active:
                prefix = (definition.config or {}).get("prefix") or AUTO_NUMBER_DEFAULT_PREFIX
                number = allocate_business_number(db, tenant_id=tenant_id, scope=f"field:{definition.id}", prefix=str(prefix)[:20])
                db.add(FieldValue(tenant_id=tenant_id, module_key=module_key, record_id=record_id,
                                  field_definition_id=definition.id, value_text=number))
            continue
        if definition.field_key not in values:
            # An inactive field keeps its value; an active one the payload cleared loses it.
            if row is not None and definition.is_active:
                db.delete(row)
            continue
        value = values[definition.field_key]
        if isinstance(value, dict) and "id" in value:
            value = value["id"]
        _check_unique(db, tenant_id=tenant_id, module_key=module_key, definition=definition, value=value,
                      record_id=record_id, excluded_record_ids=excluded_record_ids)
        if row is None:
            row = FieldValue(tenant_id=tenant_id, module_key=module_key, record_id=record_id, field_definition_id=definition.id)
            db.add(row)
        for column, stored in field_types.to_storage(definition, value).items():
            setattr(row, column, stored)
    unknown = sorted(set(values) - set(by_key))
    if unknown:
        raise _value_error(unknown[0], "This field does not exist on the module.")
    db.flush()


def apply_custom_fields(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    record_id: int,
    payload: dict[str, Any] | None,
    partial: bool,
    enforce_required: bool = True,
) -> dict[str, Any]:
    """Check and save a create or update's `custom_fields` in one call; returns the values.

    On a partial update the fields the payload leaves out keep their values. A system write
    (a payment an invoice records for itself) passes `enforce_required=False` (13b §5
    decision 9): it never asked anyone for the tenant's extra fields.
    """
    existing = load_custom_field_values(db, tenant_id=tenant_id, module_key=module_key, record_id=record_id) if partial else {}
    if partial and payload is None:
        return existing
    values = validate_custom_field_payload(
        db, tenant_id=tenant_id, module_key=module_key, payload=payload, existing=existing, enforce_required=enforce_required
    )
    save_custom_field_values(db, tenant_id=tenant_id, module_key=module_key, record_id=record_id, values=values)
    return load_custom_field_values(db, tenant_id=tenant_id, module_key=module_key, record_id=record_id)


def delete_custom_field_values(db: Session, *, tenant_id: int, module_key: str, record_ids: Iterable[int]) -> None:
    ids = list(record_ids)
    if ids:
        db.query(FieldValue).filter(
            FieldValue.tenant_id == tenant_id, FieldValue.module_key == module_key, FieldValue.record_id.in_(ids)
        ).delete(synchronize_session=False)


# --- filters, exports ----------------------------------------------------------------------


_FILTER_TYPES = {"text": "text", "number": "number", "date": "date", "boolean": "boolean", "select": "text", "relation": "number"}


def build_custom_field_filter_map(
    db: Session,
    *,
    tenant_id: int,
    module_key: str,
    record_id_expression,
) -> dict[str, dict[str, Any]]:
    """`custom:<key>` filter entries for a module's list query, one correlated value each."""
    field_map: dict[str, dict[str, Any]] = {}
    for definition in list_custom_field_definitions(db, tenant_id=tenant_id, module_key=module_key):
        spec = field_types.field_type(definition.field_type)
        if spec.storage == "json":
            continue
        column = getattr(FieldValue, field_types.storage_column(definition.field_type))
        expression = (
            select(column)
            .where(
                FieldValue.tenant_id == tenant_id,
                FieldValue.module_key == module_key,
                FieldValue.record_id == record_id_expression,
                FieldValue.field_definition_id == definition.id,
            )
            .limit(1)
            .scalar_subquery()
        )
        field_map[f"{CUSTOM_FIELD_FILTER_PREFIX}{definition.field_key}"] = {
            "expression": expression,
            "type": "date" if spec.storage == "datetime" else _FILTER_TYPES[spec.filter_type],
        }
    return field_map


def export_columns(db: Session, *, tenant_id: int, module_key: str) -> list[FieldDefinition]:
    return list_custom_field_definitions(db, tenant_id=tenant_id, module_key=module_key)


def export_cells(definitions: list[FieldDefinition], values: dict[str, Any] | None, ctx: FieldContext) -> dict[str, str]:
    """A record's custom values as CSV cells keyed `custom:<key>`."""
    values = values or {}
    return {
        f"{CUSTOM_FIELD_FILTER_PREFIX}{definition.field_key}": field_types.to_csv(definition, values.get(definition.field_key), ctx)
        for definition in definitions
    }


def sync_custom_fields(
    db: Session, *, tenant_id: int, module_key: str, record, payload: dict, created: bool, id_attr: str = "id",
    enforce_required: bool = True,
) -> None:
    """A document save's custom fields: always checked on create (required fields,
    auto-numbers), and on update only when the payload sends `custom_fields`."""
    if not created and "custom_fields" not in payload:
        return
    record.custom_fields = apply_custom_fields(
        db, tenant_id=tenant_id, module_key=module_key, record_id=getattr(record, id_attr),
        payload=payload.get("custom_fields"), partial=not created, enforce_required=enforce_required,
    ) or None


def export_extension(
    db: Session, *, tenant_id: int, module_key: str, record_ids: list[int], field_keys: list[str] | None = None,
) -> tuple[list[str], dict[int, dict[str, str]]]:
    """Custom-field columns for a CRM export: the headers (`custom:<key>`, the ones the
    caller asked for, or all) and each record's cells."""
    definitions = export_columns(db, tenant_id=tenant_id, module_key=module_key)
    if field_keys:
        wanted = set(field_keys)
        definitions = [item for item in definitions if f"{CUSTOM_FIELD_FILTER_PREFIX}{item.field_key}" in wanted]
    if not definitions:
        return [], {}
    ctx = FieldContext(db, tenant_id)
    values = load_custom_field_values_bulk(db, tenant_id=tenant_id, module_key=module_key, record_ids=record_ids)
    cells = {record_id: export_cells(definitions, values.get(record_id), ctx) for record_id in record_ids}
    return [f"{CUSTOM_FIELD_FILTER_PREFIX}{item.field_key}" for item in definitions], cells
