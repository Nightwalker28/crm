"""The triggering record, as automation rules see it.

An event's payload is whatever its route chose to send: `lead.created` carries the email
and company but not the first name, so a condition on *First Name* silently never matched
and `{{payload.first_name}}` rendered empty. Rules read the record itself instead. Its
current columns are loaded when the rule runs and laid *under* the payload, so a value the
route captured at event time still wins, and anything it left out is still there.

This also owns the entity-type → module-key map. Events name the entity (`sales_lead`);
comments, tasks and access checks name the module (`sales_leads`). Automation wrote the
entity type where the module key belonged, so its notes never showed on the record.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable

from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm import Session

from app.modules.calendar.models import MeetingBooking
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryAdjustment, InventoryDelivery, InventoryReturn
from app.modules.purchasing.models import PurchaseOrder, PurchaseReceipt
from app.modules.documents.models import Document
from app.modules.finance.models import FinanceIO
from app.modules.sales.models import SalesContact, SalesLead, SalesOpportunity, SalesOrder, SalesQuote
from app.modules.tasks.models import Task

# Columns a rule has no business reading: storage internals and secrets.
_HIDDEN_COLUMNS = frozenset({
    "tenant_id",
    "storage_path",
    "provider_file_id",
    "provider_parent_id",
    "provider_account_id",
    "provider_path",
    "checksum",
    "public_token_hash",
})


def _lead_extras(lead: SalesLead) -> dict[str, Any]:
    return {"score": lead.score, "score_grade": lead.score_grade}


def _opportunity_extras(opportunity: SalesOpportunity) -> dict[str, Any]:
    stage = getattr(opportunity, "pipeline_stage", None)
    return {
        "stage_semantic_type": getattr(stage, "semantic_type", None),
        "stage_label": getattr(stage, "label", None),
    }


def _task_owner(task: Task) -> int | None:
    for assignee in getattr(task, "assignees", None) or []:
        if getattr(assignee, "user_id", None):
            return int(assignee.user_id)
    return task.created_by_user_id


def _booking_owner(booking: MeetingBooking) -> int | None:
    booking_type = getattr(booking, "booking_type", None)
    return getattr(booking_type, "owner_id", None)


@dataclass(frozen=True)
class AutomationRecordSource:
    entity_type: str
    module_key: str
    model: type
    id_field: str
    record_path: str
    owner_field: str | None = None
    owner_resolver: Callable[[Any], int | None] | None = None
    extras: Callable[[Any], dict[str, Any]] | None = None
    # Tried in order; the first group with any value names the record in task titles and
    # notifications (`{{payload.record_label}}`).
    label_fields: tuple[tuple[str, ...], ...] = ()
    soft_delete: bool = True
    hidden: frozenset[str] = field(default_factory=frozenset)

    def label_of(self, record: Any) -> str:
        for group in self.label_fields:
            text = " ".join(str(value).strip() for value in (getattr(record, name, None) for name in group) if value not in {None, ""}).strip()
            if text:
                return text
        return f"#{getattr(record, self.id_field, '')}"

    def owner_of(self, record: Any) -> int | None:
        if self.owner_resolver is not None:
            return self.owner_resolver(record)
        if self.owner_field:
            value = getattr(record, self.owner_field, None)
            return int(value) if value is not None else None
        return None


AUTOMATION_RECORD_SOURCES: dict[str, AutomationRecordSource] = {
    source.entity_type: source
    for source in (
        AutomationRecordSource("catalog_product", "inventory_stock", CatalogProduct, "id", "/dashboard/catalog/products/{id}?tab=stock", owner_field="updated_by_user_id", label_fields=(("name",),), hidden=frozenset({"cost_price", "public_unit_price"})),
        AutomationRecordSource("inventory_adjustment", "inventory_adjustments", InventoryAdjustment, "id", "/dashboard/inventory/adjustments/{id}", owner_field="posted_by", label_fields=(("number",),)),
        AutomationRecordSource("inventory_delivery", "inventory_deliveries", InventoryDelivery, "id", "/dashboard/inventory/deliveries/{id}", owner_field="posted_by", label_fields=(("number",),)),
        AutomationRecordSource("inventory_return", "inventory_returns", InventoryReturn, "id", "/dashboard/inventory/returns/{id}", owner_field="received_by", label_fields=(("number",),)),
        AutomationRecordSource("purchase_order", "purchase_orders", PurchaseOrder, "id", "/dashboard/purchasing/orders/{id}", owner_field="owner_id", label_fields=(("number",),)),
        AutomationRecordSource("purchase_receipt", "purchase_receipts", PurchaseReceipt, "id", "/dashboard/purchasing/receipts/{id}", owner_field="posted_by", label_fields=(("number",),)),
        AutomationRecordSource("sales_lead", "sales_leads", SalesLead, "lead_id", "/dashboard/sales/leads/{id}", owner_field="assigned_to", extras=_lead_extras, label_fields=(("first_name", "last_name"), ("company",), ("primary_email",))),
        AutomationRecordSource("sales_contact", "sales_contacts", SalesContact, "contact_id", "/dashboard/sales/contacts/{id}", owner_field="assigned_to", label_fields=(("first_name", "last_name"), ("primary_email",))),
        AutomationRecordSource("sales_opportunity", "sales_opportunities", SalesOpportunity, "opportunity_id", "/dashboard/sales/opportunities/{id}", owner_field="assigned_to", extras=_opportunity_extras, label_fields=(("opportunity_name",), ("client",))),
        AutomationRecordSource("sales_quote", "sales_quotes", SalesQuote, "quote_id", "/dashboard/sales/quotes/{id}", owner_field="assigned_to", label_fields=(("quote_number",), ("title",))),
        AutomationRecordSource("sales_order", "sales_orders", SalesOrder, "id", "/dashboard/sales/orders/{id}", owner_field="owner_id", label_fields=(("order_number",),)),
        AutomationRecordSource("finance_insertion_order", "finance_io", FinanceIO, "id", "/dashboard/finance/insertion-orders/{id}", owner_field="user_id", label_fields=(("io_number",), ("customer_name",))),
        AutomationRecordSource("task", "tasks", Task, "id", "/dashboard/tasks?taskId={id}", owner_resolver=_task_owner, label_fields=(("title",),)),
        AutomationRecordSource("document", "documents", Document, "id", "/dashboard/documents", owner_field="uploaded_by_user_id", label_fields=(("title",), ("original_filename",))),
        AutomationRecordSource("meeting_booking", "calendar", MeetingBooking, "id", "/dashboard/calendar", owner_resolver=_booking_owner, label_fields=(("guest_name",), ("guest_email",)), soft_delete=False),
    )
}

# Entity types whose events exist but whose records automation does not load (support is
# out of scope; contracts emit no automation trigger). Mapped so notes and tasks still land
# on the right module.
_MODULE_KEY_FALLBACK = {
    "support_case": "support_cases",
    "contract": "contracts",
}


def get_record_source(entity_type: str | None) -> AutomationRecordSource | None:
    return AUTOMATION_RECORD_SOURCES.get((entity_type or "").strip())


def module_key_for_entity(entity_type: str | None) -> str | None:
    """The module key for an event's entity type, or the value itself when it already is one."""

    key = (entity_type or "").strip()
    if not key:
        return None
    source = AUTOMATION_RECORD_SOURCES.get(key)
    if source is not None:
        return source.module_key
    if key in _MODULE_KEY_FALLBACK:
        return _MODULE_KEY_FALLBACK[key]
    known_modules = {item.module_key for item in AUTOMATION_RECORD_SOURCES.values()} | set(_MODULE_KEY_FALLBACK.values())
    return key if key in known_modules else None


def record_path_for(entity_type: str | None, entity_id: str | int | None) -> str | None:
    source = get_record_source(entity_type)
    if source is None or entity_id in {None, ""}:
        return None
    return source.record_path.format(id=entity_id)


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return None


def load_record(db: Session, *, tenant_id: int, entity_type: str | None, entity_id: str | int | None) -> tuple[AutomationRecordSource, Any] | None:
    source = get_record_source(entity_type)
    if source is None:
        return None
    try:
        record_id = int(entity_id)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    model = source.model
    query = db.query(model).filter(model.tenant_id == tenant_id, getattr(model, source.id_field) == record_id)
    if source.soft_delete and hasattr(model, "deleted_at"):
        query = query.filter(model.deleted_at.is_(None))
    record = query.first()
    return (source, record) if record is not None else None


def load_record_snapshot(db: Session, *, tenant_id: int, entity_type: str | None, entity_id: str | int | None) -> dict[str, Any]:
    """Every readable column of the triggering record, plus `owner_user_id`, `record_label` and `record_url`.

    Empty when the entity type is not loadable or the record is gone (binned or deleted
    since the event); the rule then sees only the payload, as it always did.
    """

    # A read: it must not flush whatever the caller has pending (the run row, mid-insert).
    with db.no_autoflush:
        loaded = load_record(db, tenant_id=tenant_id, entity_type=entity_type, entity_id=entity_id)
        if loaded is None:
            return {}
        source, record = loaded
        snapshot: dict[str, Any] = {}
        for column in sa_inspect(source.model).columns:
            if column.key in _HIDDEN_COLUMNS or column.key in source.hidden:
                continue
            snapshot[column.key] = _plain(getattr(record, column.key, None))
        if source.extras is not None:
            snapshot.update({key: _plain(value) for key, value in source.extras(record).items()})
        snapshot["owner_user_id"] = source.owner_of(record)
        snapshot["record_label"] = source.label_of(record)
        snapshot["record_url"] = source.record_path.format(id=getattr(record, source.id_field))
    return snapshot
