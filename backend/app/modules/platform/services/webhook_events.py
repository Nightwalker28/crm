"""The external contract for CRM events: which events leave Lynk, and in what shape.

08-webhooks-events.md Phase 1. Webhooks consume the existing `crm_events` stream (the one
automations and Slack/Teams alerts already read); nothing here emits, stores or delivers.
This module only decides, for a recorded event, whether it has an external form and what
that form is.

Three rules keep the contract stable while internal events evolve:

- **External names are mapped, not copied.** A catalogue entry names the internal
  `(event_type, entity_type)` pair it reads. That lets a contact's creation (internally
  `lead.created` on `sales_contact`, for the Slack alert) go out as `contact.created`, and
  `deal.assigned` go out as `opportunity.assigned`, without renaming anything automations
  depend on.
- **Payload fields are allowlisted and typed.** `data` holds exactly the fields its entry
  declares, always present (null when unknown), coerced to the declared kind. Internal keys
  (`_automation*`), UI paths (`href`), staff display names and free-text client messages
  never leave.
- **`version` is per event type.** It changes when a field is removed, renamed or retyped.
  Adding a field, or adding an envelope key, does not change it: receivers must ignore
  what they do not recognise.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from app.modules.platform.models import CrmEvent


FIELD_KINDS = frozenset({"id", "string", "integer", "decimal", "boolean", "date", "datetime", "string_list"})
ACTOR_TYPES = ("user", "client_portal", "system")

# Internal entity types → the record type an outside system sees.
RECORD_TYPES = {
    "sales_lead": "lead",
    "sales_contact": "contact",
    "sales_opportunity": "opportunity",
    "sales_quote": "quote",
    "sales_order": "order",
    "finance_insertion_order": "invoice",
    "task": "task",
}


@dataclass(frozen=True)
class WebhookEventField:
    name: str
    kind: str
    # The internal payload key this field reads. Defaults to `name`.
    source: str | None = None

    @property
    def source_key(self) -> str:
        return self.source or self.name


@dataclass(frozen=True)
class WebhookEventType:
    key: str
    version: int
    source_event_type: str
    source_entity_type: str
    # The module whose tenant enablement gates delivery (enforced by the Phase 3 worker).
    module_key: str
    description: str
    fields: tuple[WebhookEventField, ...]

    @property
    def record_type(self) -> str:
        return RECORD_TYPES[self.source_entity_type]


def _f(name: str, kind: str = "string", source: str | None = None) -> WebhookEventField:
    return WebhookEventField(name=name, kind=kind, source=source)


_LEAD_FIELDS = (
    _f("name", source="lead_name"),
    _f("email", source="primary_email"),
    _f("company"),
    _f("source"),
    _f("status"),
    _f("owner_user_id", "id", "assigned_to"),
    _f("score", "integer"),
    _f("score_grade"),
)
_OPPORTUNITY_STAGE_FIELDS = (
    _f("name", source="deal_name"),
    _f("stage_id", "id"),
    _f("stage_label"),
    _f("stage_semantic_type"),
    _f("previous_stage_id", "id"),
    _f("previous_stage_label", source="previous_stage"),
    _f("previous_stage_semantic_type"),
    _f("owner_user_id", "id", "assigned_to"),
)
_PARTICIPANT_FIELDS = (
    _f("name", source="deal_name"),
    _f("contact_id", "id"),
    _f("contact_name"),
    _f("role_key"),
    _f("is_primary", "boolean"),
)
_QUOTE_FIELDS = (
    _f("quote_number"),
    _f("customer_name"),
    _f("status"),
    _f("total_amount", "decimal"),
)
_TASK_FIELDS = (
    _f("title", source="task_title"),
    _f("priority"),
    _f("status"),
    _f("due_at", "datetime"),
)


WEBHOOK_EVENT_TYPES: tuple[WebhookEventType, ...] = (
    WebhookEventType(
        "lead.created", 1, "lead.created", "sales_lead", "sales_leads",
        "A lead was created in Lynk.",
        _LEAD_FIELDS,
    ),
    WebhookEventType(
        "lead.updated", 1, "lead.updated", "sales_lead", "sales_leads",
        "A lead was edited. `changed_fields` names what the edit touched.",
        (*_LEAD_FIELDS, _f("changed_fields", "string_list"), _f("previous_status", source="before_status")),
    ),
    WebhookEventType(
        "lead.converted", 1, "lead.converted", "sales_lead", "sales_leads",
        "A lead was converted. The IDs name the account, contact and opportunity it became.",
        (
            _f("name", source="lead_name"),
            _f("email", source="primary_email"),
            _f("company"),
            _f("status"),
            _f("account_id", "id"),
            _f("contact_id", "id"),
            _f("opportunity_id", "id", "deal_id"),
        ),
    ),
    WebhookEventType(
        "contact.created", 1, "lead.created", "sales_contact", "sales_contacts",
        "A contact was created in Lynk.",
        (
            _f("name", source="lead_name"),
            _f("email", source="primary_email"),
            _f("organization_name"),
            _f("owner_user_id", "id", "assigned_to"),
        ),
    ),
    WebhookEventType(
        "opportunity.assigned", 1, "deal.assigned", "sales_opportunity", "sales_opportunities",
        "An opportunity was given an owner, on creation or reassignment.",
        (
            _f("name", source="deal_name"),
            _f("company"),
            _f("amount", "decimal", "deal_value"),
            _f("stage_label", source="stage"),
            _f("owner_user_id", "id", "assigned_to"),
        ),
    ),
    WebhookEventType(
        "opportunity.stage_changed", 1, "opportunity.stage_changed", "sales_opportunity", "sales_opportunities",
        "An opportunity moved stage. Match on `stage_id` or `stage_semantic_type`, never on the label.",
        _OPPORTUNITY_STAGE_FIELDS,
    ),
    WebhookEventType(
        "opportunity.won", 1, "opportunity.won", "sales_opportunity", "sales_opportunities",
        "An opportunity entered a won stage from a stage that was not won.",
        _OPPORTUNITY_STAGE_FIELDS,
    ),
    WebhookEventType(
        "opportunity.lost", 1, "opportunity.lost", "sales_opportunity", "sales_opportunities",
        "An opportunity entered a lost stage from a stage that was not lost.",
        _OPPORTUNITY_STAGE_FIELDS,
    ),
    WebhookEventType(
        "opportunity.participant_added", 1, "opportunity.participant_added", "sales_opportunity", "sales_opportunities",
        "A contact was added to an opportunity, or restored to it (`restored`).",
        (*_PARTICIPANT_FIELDS, _f("restored", "boolean")),
    ),
    WebhookEventType(
        "opportunity.participant_removed", 1, "opportunity.participant_removed", "sales_opportunity", "sales_opportunities",
        "A contact was removed from an opportunity.",
        _PARTICIPANT_FIELDS,
    ),
    WebhookEventType(
        "opportunity.primary_contact_changed", 1, "opportunity.primary_contact_changed", "sales_opportunity", "sales_opportunities",
        "An opportunity's primary contact changed.",
        (*_PARTICIPANT_FIELDS, _f("previous_contact_id", "id")),
    ),
    WebhookEventType(
        "quote.created", 1, "quote.created", "sales_quote", "sales_quotes",
        "A quote was created.",
        _QUOTE_FIELDS,
    ),
    WebhookEventType(
        "quote.status_changed", 1, "quote.status_changed", "sales_quote", "sales_quotes",
        "A quote's status changed, by a teammate or by the client in the portal (see `actor`).",
        (*_QUOTE_FIELDS, _f("previous_status")),
    ),
    WebhookEventType(
        "order.created", 1, "order.created", "sales_order", "sales_orders",
        "A sales order was created, directly or from a quote (`quote_id`).",
        (_f("order_number"), _f("status"), _f("quote_id", "id")),
    ),
    WebhookEventType(
        "invoice.overdue", 1, "invoice.overdue", "finance_insertion_order", "finance_io",
        "An invoice became overdue.",
        (
            _f("invoice_number"),
            _f("customer_name"),
            _f("amount", "decimal"),
            _f("currency"),
            _f("due_date", "date"),
            _f("status"),
        ),
    ),
    WebhookEventType(
        "task.assigned", 1, "task.assigned", "task", "tasks",
        "A task gained assignees.",
        _TASK_FIELDS,
    ),
    WebhookEventType(
        "task.due_today", 1, "task.due_today", "task", "tasks",
        "A task is due today. Sent at most once per task per day.",
        _TASK_FIELDS,
    ),
)

WEBHOOK_EVENT_TYPES_BY_KEY = {event_type.key: event_type for event_type in WEBHOOK_EVENT_TYPES}
_BY_SOURCE = {(event_type.source_event_type, event_type.source_entity_type): event_type for event_type in WEBHOOK_EVENT_TYPES}


def webhook_event_type_for(event: CrmEvent) -> WebhookEventType | None:
    """The external type of a recorded event, or None when it has no external form."""

    return _BY_SOURCE.get(((event.event_type or "").strip().lower(), (event.entity_type or "").strip()))


def _as_utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _coerce(kind: str, value: Any) -> Any:
    """Coerce a stored payload value to its declared kind; anything unusable becomes null.

    Payloads are JSON-encoded when stored, so dates arrive as ISO strings and Decimals as
    strings or floats. A value that cannot honestly be read as the declared kind is sent
    as null rather than passed through, so a receiver can trust the documented type.
    """

    if value is None:
        return None
    if kind == "string":
        return value if isinstance(value, str) else str(value)
    if kind == "id":
        if isinstance(value, bool):
            return None
        return str(value) if isinstance(value, (int, str)) and str(value).strip() else None
    if kind == "integer":
        if isinstance(value, bool):
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None
    if kind == "decimal":
        if isinstance(value, bool):
            return None
        try:
            # Money travels as a string so no receiver rounds it through a float.
            return str(Decimal(str(value)))
        except (InvalidOperation, ValueError):
            return None
    if kind == "boolean":
        return value if isinstance(value, bool) else None
    if kind == "date":
        if isinstance(value, datetime):
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        try:
            return date.fromisoformat(str(value)[:10]).isoformat()
        except ValueError:
            return None
    if kind == "datetime":
        if isinstance(value, datetime):
            return _as_utc_iso(value)
        try:
            return _as_utc_iso(datetime.fromisoformat(str(value).replace("Z", "+00:00")))
        except ValueError:
            return None
    if kind == "string_list":
        if not isinstance(value, list):
            return None
        return [item if isinstance(item, str) else str(item) for item in value if item is not None]
    raise ValueError(f"Unknown webhook field kind: {kind}")


def _actor(event: CrmEvent) -> dict[str, Any]:
    if event.actor_user_id is not None:
        return {"type": "user", "user_id": str(event.actor_user_id)}
    # The client portal is the one writer that records who acted without a staff user.
    if (event.payload or {}).get("client_account_id") is not None:
        return {"type": "client_portal", "user_id": None}
    return {"type": "system", "user_id": None}


def build_webhook_envelope(event: CrmEvent) -> dict[str, Any] | None:
    """The external form of a recorded event, or None when it must not leave Lynk.

    None for an event with no catalogue entry (support cases, contracts, anything added
    internally but not yet approved for export) and for an event with no public ID (it
    predates webhooks).
    """

    event_type = webhook_event_type_for(event)
    if event_type is None or not event.public_id:
        return None
    payload = event.payload or {}
    return {
        "id": event.public_id,
        "type": event_type.key,
        "version": event_type.version,
        "occurred_at": _as_utc_iso(event.created_at) if event.created_at else None,
        "actor": _actor(event),
        "record": {"type": event_type.record_type, "id": str(event.entity_id)},
        "data": {field.name: _coerce(field.kind, payload.get(field.source_key)) for field in event_type.fields},
    }


def serialize_webhook_event_type(event_type: WebhookEventType) -> dict[str, Any]:
    return {
        "type": event_type.key,
        "version": event_type.version,
        "record_type": event_type.record_type,
        "module_key": event_type.module_key,
        "description": event_type.description,
        "fields": [{"name": field.name, "kind": field.kind} for field in event_type.fields],
    }


def list_webhook_event_types() -> list[dict[str, Any]]:
    return [serialize_webhook_event_type(event_type) for event_type in WEBHOOK_EVENT_TYPES]
