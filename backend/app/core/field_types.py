"""The one field type set (13b §3.4, F3.1).

Every configurable field — a custom field on a built-in module, or a field of a custom module —
has one of these types. Each type says, once, how a value is checked, which `field_values`
column stores it, how it reads back, how it filters, how it appears in a report and how it
crosses a CSV. Services, imports, exports, filters and reports ask this module instead of
keeping their own type checks.

A field is described by any object with `field_type`, `label`, `field_key`, `config`,
`lookup_module_key` and, for picklists, `picklist_key` (see `FieldShape`).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Protocol
from urllib.parse import urlparse

from sqlalchemy.orm import Session

EMAIL_SEPARATOR = "@"
MULTI_SEPARATOR = ";"


class FieldValueError(ValueError):
    """A value a field cannot hold; the message names the fix."""


class FieldShape(Protocol):
    field_type: str
    label: str
    field_key: str
    config: dict | None
    lookup_module_key: str | None

    @property
    def picklist_key(self) -> str | None: ...


@dataclass(frozen=True)
class FieldType:
    key: str
    label: str
    # The `field_values` column the value lives in.
    storage: str  # text | number | date | datetime | boolean | json | record
    # How a list filter treats it: text | number | date | boolean | select | relation
    filter_type: str
    # How a report treats it: text | number | money | date | datetime | boolean | select | user | reference
    report_type: str
    can_be_unique: bool = True
    can_be_required: bool = True
    # Set by the platform, never typed (auto-number).
    system_assigned: bool = False


FIELD_TYPES: dict[str, FieldType] = {
    item.key: item
    for item in (
        FieldType("text", "Text", "text", "text", "text"),
        FieldType("long_text", "Long text", "text", "text", "text", can_be_unique=False),
        FieldType("number", "Number", "number", "number", "number"),
        FieldType("decimal", "Decimal", "number", "number", "number"),
        FieldType("currency", "Currency", "number", "number", "money"),
        FieldType("percent", "Percent", "number", "number", "number"),
        FieldType("boolean", "Yes/no", "boolean", "boolean", "boolean", can_be_unique=False),
        FieldType("date", "Date", "date", "date", "date"),
        FieldType("datetime", "Date and time", "datetime", "date", "datetime"),
        FieldType("email", "Email", "text", "text", "text"),
        FieldType("phone", "Phone", "text", "text", "text"),
        FieldType("url", "URL", "text", "text", "text"),
        FieldType("picklist", "Picklist", "text", "select", "select", can_be_unique=False),
        FieldType("multi_picklist", "Multi-select picklist", "json", "select", "text", can_be_unique=False),
        FieldType("user", "User", "record", "relation", "user", can_be_unique=False),
        FieldType("lookup", "Record lookup", "record", "relation", "reference", can_be_unique=False),
        FieldType("file", "File", "record", "relation", "reference", can_be_unique=False),
        FieldType("auto_number", "Auto-number", "text", "text", "text", can_be_required=False, system_assigned=True),
    )
}

STORAGE_COLUMNS = {
    "text": "value_text",
    "number": "value_number",
    "date": "value_date",
    "datetime": "value_datetime",
    "boolean": "value_boolean",
    "json": "value_json",
    "record": "value_record_id",
}

# Old type names, from the two field systems this replaces.
LEGACY_TYPE_NAMES = {"textarea": "long_text", "single_select": "picklist", "multi_select": "multi_picklist"}

# What a lookup can point at: module key → (LinkedRecordPicker type, label for the admin).
LOOKUP_TARGETS: dict[str, tuple[str, str]] = {
    "sales_contacts": ("contact", "Contact"),
    "sales_organizations": ("organization", "Account"),
    "sales_opportunities": ("opportunity", "Deal"),
    "sales_quotes": ("quote", "Quote"),
    "sales_orders": ("order", "Order"),
}


def field_type(key: str) -> FieldType:
    try:
        return FIELD_TYPES[LEGACY_TYPE_NAMES.get(key, key)]
    except KeyError as exc:
        raise FieldValueError(f"Unknown field type {key!r}.") from exc


def storage_column(key: str) -> str:
    return STORAGE_COLUMNS[field_type(key).storage]


def is_empty(value: Any) -> bool:
    return value is None or value == "" or value == [] or value == {}


def _config(field: FieldShape) -> dict:
    return field.config or {}


def _decimal(field: FieldShape, raw: Any) -> Decimal:
    if isinstance(raw, bool):
        raise FieldValueError(f"{field.label} must be a number.")
    text = str(raw).strip().replace(",", "")
    if field.field_type == "percent":
        text = text.rstrip("%").strip()
    try:
        value = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise FieldValueError(f"{field.label} must be a number.") from exc
    if not value.is_finite():
        raise FieldValueError(f"{field.label} must be a number.")
    config = _config(field)
    if field.field_type == "number" and value != value.to_integral_value():
        raise FieldValueError(f"{field.label} must be a whole number.")
    if config.get("min") is not None and value < Decimal(str(config["min"])):
        raise FieldValueError(f"{field.label} must be {config['min']} or more.")
    if config.get("max") is not None and value > Decimal(str(config["max"])):
        raise FieldValueError(f"{field.label} must be {config['max']} or less.")
    precision = config.get("precision")
    if precision is None and field.field_type == "currency":
        precision = 2
    if precision is not None:
        value = value.quantize(Decimal(1).scaleb(-int(precision)))
    return value


def _date(field: FieldShape, raw: Any) -> date:
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    try:
        return date.fromisoformat(str(raw).strip()[:10])
    except ValueError as exc:
        raise FieldValueError(f"{field.label} must be a date (YYYY-MM-DD).") from exc


def _datetime(field: FieldShape, raw: Any) -> datetime:
    if isinstance(raw, datetime):
        value = raw
    else:
        text = str(raw).strip()
        if len(text) == 10:
            text = f"{text}T00:00:00"
        try:
            value = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError as exc:
            raise FieldValueError(f"{field.label} must be a date and time.") from exc
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _boolean(field: FieldShape, raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    text = str(raw).strip().lower()
    if text in {"true", "1", "yes", "y", "on"}:
        return True
    if text in {"false", "0", "no", "n", "off"}:
        return False
    raise FieldValueError(f"{field.label} must be yes or no.")


def _reference_id(field: FieldShape, raw: Any) -> int:
    if isinstance(raw, dict):
        raw = raw.get("id")
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError) as exc:
        raise FieldValueError(f"Choose a record for {field.label}.") from exc
    if value <= 0:
        raise FieldValueError(f"Choose a record for {field.label}.")
    return value


class FieldContext:
    """What checking a value needs beyond the value: the tenant's lists and records."""

    def __init__(self, db: Session, tenant_id: int, *, allow_new_picklist_values: bool = False):
        from app.modules.platform.services.picklists import PicklistResolver

        self.db = db
        self.tenant_id = tenant_id
        self.picklists = PicklistResolver(db, tenant_id, allow_create=allow_new_picklist_values)

    def check_reference(self, field: FieldShape, record_id: int) -> None:
        if not reference_exists(self.db, self.tenant_id, field, record_id):
            raise FieldValueError(f"{field.label} points at a record that does not exist.")


def normalize(field: FieldShape, raw: Any, ctx: FieldContext, *, current: Any = None) -> Any:
    """The value to store for `raw`, in its Python form; None when empty.

    Raises `FieldValueError` with a sentence naming the fix.
    """
    spec = field_type(field.field_type)
    if spec.system_assigned:
        return current
    if is_empty(raw):
        return None
    kind = spec.key
    if kind in {"text", "long_text", "phone"}:
        value = str(raw).strip()
        limit = _config(field).get("max_length")
        if limit and len(value) > int(limit):
            raise FieldValueError(f"Keep {field.label} to {limit} characters.")
        return value or None
    if kind == "email":
        value = str(raw).strip()
        local, _, domain = value.partition(EMAIL_SEPARATOR)
        if not local or "." not in domain:
            raise FieldValueError(f"{field.label} must be an email address.")
        return value
    if kind == "url":
        value = str(raw).strip()
        if urlparse(value).scheme not in {"http", "https"} or not urlparse(value).netloc:
            raise FieldValueError(f"{field.label} must be a web address starting with http:// or https://.")
        return value
    if kind in {"number", "decimal", "currency", "percent"}:
        return _decimal(field, raw)
    if kind == "boolean":
        return _boolean(field, raw)
    if kind == "date":
        return _date(field, raw)
    if kind == "datetime":
        return _datetime(field, raw)
    if kind == "picklist":
        return _picklist_key(field, raw, ctx, current=current)
    if kind == "multi_picklist":
        items = raw if isinstance(raw, list) else [part for part in str(raw).split(MULTI_SEPARATOR)]
        keys: list[str] = []
        current_keys = set(current or [])
        for item in items:
            if is_empty(item) or (isinstance(item, str) and not item.strip()):
                continue
            key = _picklist_key(field, item, ctx, current=item if item in current_keys else None)
            if key and key not in keys:
                keys.append(key)
        return keys or None
    if kind in {"user", "lookup", "file"}:
        record_id = _reference_id(field, raw)
        ctx.check_reference(field, record_id)
        return record_id
    raise FieldValueError(f"{field.label} has an unknown type.")


def _picklist_key(field: FieldShape, raw: Any, ctx: FieldContext, *, current: Any) -> str:
    from fastapi import HTTPException

    from app.modules.platform.services.picklists import picklist_error_reason

    list_key = field.picklist_key
    if not list_key:
        raise FieldValueError(f"{field.label} has no list to choose from.")
    try:
        return ctx.picklists.resolve(list_key, raw, current=current, field_label=field.label)
    except HTTPException as exc:
        raise FieldValueError(picklist_error_reason(exc)) from exc


def to_storage(field: FieldShape, value: Any) -> dict[str, Any]:
    """`field_values` columns for a normalized value; every other value column is cleared."""
    columns = {column: None for column in STORAGE_COLUMNS.values()}
    if value is not None:
        columns[storage_column(field.field_type)] = value
    return columns


def from_storage(field: FieldShape, row: Any) -> Any:
    """The JSON form of a stored value (references are bare ids; see `present`)."""
    spec = field_type(field.field_type)
    raw = getattr(row, STORAGE_COLUMNS[spec.storage])
    if raw is None:
        return None
    if spec.storage == "number":
        number = Decimal(raw)
        return int(number) if spec.key == "number" else float(number)
    if spec.storage == "date":
        return raw.isoformat() if hasattr(raw, "isoformat") else str(raw)
    if spec.storage == "datetime":
        return raw.isoformat() if hasattr(raw, "isoformat") else str(raw)
    if spec.storage == "json":
        return list(raw) if isinstance(raw, (list, tuple)) else raw
    return raw


def is_reference(field_type_key: str) -> bool:
    return field_type(field_type_key).storage == "record"


def present(field: FieldShape, value: Any, labels: dict[tuple[str, int], str]) -> Any:
    """A value as an API returns it: references become `{"id", "label"}`."""
    if value is None or not is_reference(field.field_type):
        return value
    return {"id": value, "label": labels.get((reference_target(field), int(value)))}


def reference_target(field: FieldShape) -> str:
    """Which table a reference points into: `users`, `documents`, or a lookup's module key."""
    if field.field_type == "user":
        return "users"
    if field.field_type == "file":
        return "documents"
    return field.lookup_module_key or ""


def _reference_model(target: str):
    if target == "users":
        from app.modules.user_management.models import User

        return User, User.id, (User.first_name, User.last_name, User.email)
    if target == "documents":
        from app.modules.documents.models import Document

        return Document, Document.id, (Document.title, Document.original_filename)
    from app.modules.sales import models as sales

    mapping = {
        "sales_contacts": (sales.SalesContact, sales.SalesContact.contact_id, (sales.SalesContact.first_name, sales.SalesContact.last_name, sales.SalesContact.primary_email)),
        "sales_organizations": (sales.SalesOrganization, sales.SalesOrganization.org_id, (sales.SalesOrganization.org_name,)),
        "sales_opportunities": (sales.SalesOpportunity, sales.SalesOpportunity.opportunity_id, (sales.SalesOpportunity.opportunity_name,)),
        "sales_quotes": (sales.SalesQuote, sales.SalesQuote.quote_id, (sales.SalesQuote.quote_number, sales.SalesQuote.title)),
        "sales_orders": (sales.SalesOrder, sales.SalesOrder.id, (sales.SalesOrder.order_number,)),
    }
    if target not in mapping:
        raise FieldValueError("This lookup points at a module it cannot link to.")
    return mapping[target]


def _label_of(parts: Iterable[Any]) -> str:
    values = [str(part).strip() for part in parts if part not in (None, "")]
    if len(values) >= 2 and "@" in values[-1] and all("@" not in value for value in values[:-1]):
        values = values[:-1]  # a person's name, else their email
    return " ".join(values[:2]) if values else ""


def reference_exists(db: Session, tenant_id: int, field: FieldShape, record_id: int) -> bool:
    model, id_column, _label_columns = _reference_model(reference_target(field))
    query = db.query(id_column).filter(model.tenant_id == tenant_id, id_column == record_id)
    if hasattr(model, "deleted_at"):
        query = query.filter(model.deleted_at.is_(None))
    return query.first() is not None


def reference_labels(db: Session, tenant_id: int, wanted: dict[str, set[int]]) -> dict[tuple[str, int], str]:
    """Labels for referenced records, one query per target table."""
    labels: dict[tuple[str, int], str] = {}
    for target, ids in wanted.items():
        if not ids:
            continue
        try:
            model, id_column, label_columns = _reference_model(target)
        except FieldValueError:
            continue
        rows = db.query(id_column, *label_columns).filter(model.tenant_id == tenant_id, id_column.in_(sorted(ids))).all()
        for row in rows:
            labels[(target, int(row[0]))] = _label_of(row[1:]) or f"#{row[0]}"
    return labels


def to_csv(field: FieldShape, value: Any, ctx: FieldContext | None = None) -> str:
    """A stored (JSON-form) value as a CSV cell: picklists by label, references by id."""
    if value is None:
        return ""
    kind = field_type(field.field_type).key
    if kind == "boolean":
        return "true" if value else "false"
    if kind == "picklist" and ctx and field.picklist_key:
        return ctx.picklists.label(field.picklist_key, value) or ""
    if kind == "multi_picklist":
        items = value if isinstance(value, list) else [value]
        if ctx and field.picklist_key:
            items = [ctx.picklists.label(field.picklist_key, item) or item for item in items]
        return f"{MULTI_SEPARATOR} ".join(str(item) for item in items)
    if isinstance(value, dict):
        return str(value.get("id") or "")
    return str(value)


def catalog() -> list[dict[str, Any]]:
    """The types an admin can choose, for the field editors."""
    return [
        {
            "key": spec.key,
            "label": spec.label,
            "can_be_unique": spec.can_be_unique,
            "can_be_required": spec.can_be_required,
            "system_assigned": spec.system_assigned,
        }
        for spec in FIELD_TYPES.values()
    ]
