"""Manual call logs — 07-telephony.md Phase 1.

Lynk places no calls yet. The record header's Call is a `tel:` link, and the call itself
happens on whatever phone the operator uses. What this service records is the operator's
report of that call — direction, outcome, when, how long, with whom — on the record it
was about. It is the provider-neutral base a provider phase builds on (a `capture` other
than ``manual``), never a claim that Lynk dialled, connected or timed anything.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.access_control import PermissionPolicy
from app.modules.mail.services import mail_associations
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.record_comments import get_record_reference
from app.modules.sales.services.followups import create_record_follow_up_task
from app.modules.sales.services.opportunity_contacts_services import (
    contact_display_name,
    is_contact_on_opportunity,
)
from app.modules.telephony.models import CallLog
from app.modules.telephony.repositories import call_logs_repository

# The records whose Timeline offers a Call mode. Each is a record a call can be *about*:
# a lead or contact is the person, a deal or quote names the person on the line.
CALL_LOG_ENTITY_TYPES = {
    "sales_leads": "sales_lead",
    "sales_contacts": "sales_contact",
    "sales_opportunities": "sales_opportunity",
    "sales_quotes": "sales_quote",
}

DIRECTION_LABELS = {"outbound": "Outbound", "inbound": "Inbound"}
OUTCOME_LABELS = {
    "connected": "Connected",
    "left_voicemail": "Left voicemail",
    "left_message": "Left live message",
    "no_answer": "No answer",
    "busy": "Busy",
    "wrong_number": "Wrong number",
}

# Clocks disagree a little; a call logged "now" from a fast laptop is not in the future.
FUTURE_TOLERANCE = timedelta(minutes=5)

UNAVAILABLE_DEAL_CONTACT = "The person on the call is not a participant on this deal."
UNAVAILABLE_QUOTE_CONTACT = "The person on the call is not this quote's contact."


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    # SQLite hands back naive datetimes; every stored time here is UTC.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _record_label(module_key: str, record) -> str:
    if module_key == "sales_leads":
        name = " ".join(part for part in [record.first_name, record.last_name] if part).strip()
        return name or record.primary_email or "Lead"
    if module_key == "sales_contacts":
        return contact_display_name(record) or "Contact"
    if module_key == "sales_opportunities":
        return record.opportunity_name or "Deal"
    return record.quote_number or getattr(record, "title", None) or "Quote"


def _require_log_access(db: Session, *, current_user, module_key: str) -> None:
    """The record's own three layers: module enabled, department access, then `edit`.

    `edit`, like the follow-up log it replaces: logging a call writes to the record (the
    call, its last-contacted stamp, an optional reminder). No telephony permission exists
    yet; it arrives with the provider configuration it would guard (07 Phase 2).
    """

    policy = PermissionPolicy(db, current_user)
    if not policy.can_view_module(module_key) or not policy.can_perform_action(module_key, "edit"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot log calls on this record.")


def _viewable_contact(db: Session, *, current_user, contact_id: int, detail: str):
    contact = call_logs_repository.get_active_contact(db, tenant_id=current_user.tenant_id, contact_id=contact_id)
    if contact is None:
        raise _unprocessable(detail)
    try:
        # Naming someone files the call on their Timeline too, so the operator must be
        # able to see them. One message for every reason, as mail's link targets use.
        mail_associations.resolve_link_target(
            db,
            current_user=current_user,
            module_key="sales_contacts",
            entity_id=str(contact_id),
        )
    except HTTPException as exc:
        raise _unprocessable(detail) from exc
    return contact


def _resolve_call_contact(db: Session, *, current_user, module_key: str, record, contact_id: int | None):
    """Who was on the line, proven against the record — never inferred from a number.

    - A contact's call is with that contact; naming anyone else is refused.
    - A lead is not a contact, so its call names no contact.
    - A deal's call may name one of its people (legacy primary or active participant).
      With several, the client makes the operator choose; nothing here picks for them.
    - A quote's call may name the quote's own contact.
    """

    if module_key == "sales_contacts":
        if contact_id is not None and contact_id != record.contact_id:
            raise _unprocessable("A contact's call is with that contact.")
        return record
    if contact_id is None:
        return None
    if module_key == "sales_leads":
        raise _unprocessable("A lead's call is with the lead; it names no contact.")
    if module_key == "sales_opportunities":
        if not is_contact_on_opportunity(db, opportunity=record, contact_id=contact_id):
            raise _unprocessable(UNAVAILABLE_DEAL_CONTACT)
        return _viewable_contact(db, current_user=current_user, contact_id=contact_id, detail=UNAVAILABLE_DEAL_CONTACT)
    if contact_id != record.contact_id:
        raise _unprocessable(UNAVAILABLE_QUOTE_CONTACT)
    return _viewable_contact(db, current_user=current_user, contact_id=contact_id, detail=UNAVAILABLE_QUOTE_CONTACT)


def _phone_on_file(module_key: str, record, contact) -> str | None:
    value = record.phone if module_key == "sales_leads" else getattr(contact, "contact_telephone", None)
    value = (value or "").strip()
    return value[:64] or None


def serialize_call_log(call: CallLog) -> dict:
    return {
        "id": call.id,
        "module_key": call.source_module_key,
        "entity_id": call.source_entity_id,
        "capture": call.capture,
        "direction": call.direction,
        "outcome": call.outcome,
        "occurred_at": _as_utc(call.occurred_at),
        "duration_seconds": call.duration_seconds,
        "note": call.note,
        "phone_number": call.phone_number,
        "contact_id": call.contact_id,
        "follow_up_task_id": call.follow_up_task_id,
    }


def log_record_call(
    db: Session,
    *,
    current_user,
    module_key: str,
    entity_id: str,
    payload: dict,
) -> dict:
    """Record a call the operator reports, on the record it was about, in one transaction.

    Every refusal happens before anything is written: the call, the record's stamp, the
    audit entry and the optional reminder commit together or not at all.
    """

    entity_type = CALL_LOG_ENTITY_TYPES.get(module_key)
    if entity_type is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calls are not logged on this kind of record.")
    _require_log_access(db, current_user=current_user, module_key=module_key)
    record = get_record_reference(db, tenant_id=current_user.tenant_id, module_key=module_key, entity_id=entity_id)

    now = _utcnow()
    occurred_at = _as_utc(payload.get("occurred_at")) or now
    if occurred_at > now + FUTURE_TOLERANCE:
        raise _unprocessable("A call cannot be logged in the future.")
    contact = _resolve_call_contact(
        db,
        current_user=current_user,
        module_key=module_key,
        record=record,
        contact_id=payload.get("contact_id"),
    )

    direction = payload.get("direction") or "outbound"
    outcome = payload["outcome"]
    note = (payload.get("note") or "").strip() or None
    record_id = str(entity_id)
    source_label = _record_label(module_key, record)
    with_label = contact_display_name(contact) if contact is not None and module_key != "sales_contacts" else None

    try:
        call = CallLog(
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            source_module_key=module_key,
            source_entity_id=record_id,
            contact_id=contact.contact_id if contact is not None else None,
            capture="manual",
            direction=direction,
            outcome=outcome,
            phone_number=_phone_on_file(module_key, record, contact),
            occurred_at=occurred_at,
            duration_seconds=payload.get("duration_seconds"),
            note=note,
        )
        db.add(call)

        # "Last contacted" moves forward only: logging yesterday's call today must not
        # rewind a stamp a later conversation already set. Quotes carry no stamp.
        if hasattr(record, "last_contacted_at"):
            previous = _as_utc(record.last_contacted_at)
            if previous is None or occurred_at >= previous:
                record.last_contacted_at = occurred_at
                record.last_contacted_channel = "call"
                record.last_contacted_by_user_id = current_user.id
                db.add(record)

        task = None
        if payload.get("create_follow_up_task"):
            task = create_record_follow_up_task(
                db,
                current_user=current_user,
                module_key=module_key,
                entity_id=record_id,
                source_label=source_label,
                channel="call",
                due_at=payload.get("follow_up_due_at"),
                note=note,
            )
            call.follow_up_task_id = task.id
            if module_key == "sales_leads" and payload.get("follow_up_due_at") is not None:
                # As the lead's follow-up log does: the reminder is the lead's next step.
                record.next_follow_up_at = payload["follow_up_due_at"]
                db.add(record)

        db.flush()
        summary = f"{DIRECTION_LABELS[direction].lower()} call"
        if with_label:
            summary += f" with {with_label}"
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            module_key=module_key,
            entity_type=entity_type,
            entity_id=record_id,
            action="call.logged",
            description=f"Logged {summary} for {source_label}: {OUTCOME_LABELS[outcome]}",
            after_state={
                "call_log_id": call.id,
                "capture": "manual",
                "direction": direction,
                "outcome": outcome,
                "occurred_at": occurred_at.isoformat(),
                "duration_seconds": call.duration_seconds,
                "contact_id": call.contact_id,
                "note": note,
                "follow_up_task_id": call.follow_up_task_id,
            },
            commit=False,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(call)
    return serialize_call_log(call)
