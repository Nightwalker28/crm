from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import requests
from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session, joinedload

from app.core.pagination import Pagination
from app.core.unit_of_work import in_unit_of_work, on_commit, on_commit_session, savepoint
from app.modules.platform.models import CrmEvent, CrmEventDelivery, NotificationChannel


logger = logging.getLogger(__name__)

SUPPORTED_CHANNEL_PROVIDERS = {"slack", "teams"}
CRM_EVENT_TYPES = {
    "inventory.stock_low",
    "inventory.adjustment_posted",
    "inventory.delivery_posted",
    "inventory.return_received",
    "purchase.receipt_posted",
    "inventory.revalued",
    "purchase.bill_posted",
    "purchase.bill_overdue",
    "finance.invoice_issued",
    "finance.invoice_overdue",
    "finance.payment_recorded",
    "finance.credit_note_issued",
    "lead.created",
    "lead.updated",
    "lead.converted",
    "deal.assigned",
    "opportunity.created",
    "opportunity.stage_changed",
    # Emitted on entering a won/lost stage by semantic type, never by label.
    "opportunity.won",
    "opportunity.lost",
    # Relationship changes worth reacting to. A participant's role change is
    # deliberately absent: it is audited, but it is not an event worth waking
    # automations for.
    "opportunity.participant_added",
    "opportunity.participant_removed",
    "opportunity.primary_contact_changed",
    "quote.created",
    "quote.status_changed",
    "order.created",
    "order.status_changed",
    "task.due_today",
    "task.overdue",
    "task.assigned",
    "booking.created",
    "document.uploaded",
    "document.shared",
}
SLACK_ALERT_EVENT_TYPES = {
    "lead.created",
    "deal.assigned",
    "task.due_today",
    "task.assigned",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_provider(value: str) -> str:
    provider = (value or "").strip().lower()
    if provider not in SUPPORTED_CHANNEL_PROVIDERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provider must be slack or teams")
    return provider


def _masked_webhook_url(value: str) -> str:
    stripped = (value or "").strip()
    if len(stripped) <= 16:
        return "********"
    return f"{stripped[:8]}...{stripped[-8:]}"


def _display_user_name(user) -> str | None:
    if not user:
        return None
    full_name = " ".join(part for part in [getattr(user, "first_name", None), getattr(user, "last_name", None)] if part).strip()
    return full_name or getattr(user, "email", None) or None


def _format_date(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _message_lines(title: str, fields: list[tuple[str, Any]], action: str | None = None) -> str:
    lines = [title, ""]
    for label, value in fields:
        if value is None or value == "":
            continue
        lines.append(f"{label}: {value}")
    if action:
        lines.append(f"Action: {action}")
    return "\n".join(lines).strip()


def format_event_message(event_type: str, payload: dict[str, Any]) -> str:
    actor_name = payload.get("actor_name")
    if event_type == "lead.created":
        lead_name = payload.get("lead_name") or payload.get("primary_email") or "New lead"
        assigned_to = payload.get("assigned_to_name") or "Unassigned"
        return _message_lines(
            f"New lead assigned to {assigned_to}",
            [
                ("Lead", lead_name),
                ("Company", payload.get("company") or payload.get("organization_name")),
                ("Source", payload.get("source") or "CRM"),
                ("Status", payload.get("status") or "New"),
            ],
            action=payload.get("action") or "Follow up today",
        )
    if event_type == "deal.assigned":
        return _message_lines(
            f"Deal assigned to {payload.get('assigned_to_name') or 'a teammate'}",
            [
                ("Deal", payload.get("deal_name")),
                ("Company", payload.get("company")),
                ("Value", payload.get("deal_value")),
                ("Stage", payload.get("stage")),
            ],
            action=payload.get("action") or "Review deal",
        )
    if event_type == "task.due_today":
        return _message_lines(
            "Task due today",
            [
                ("Task", payload.get("task_title")),
                ("Priority", payload.get("priority")),
                ("Due", _format_date(payload.get("due_at"))),
                ("Assigned By", payload.get("assigned_by_name") or actor_name),
            ],
            action=payload.get("action") or "Complete or reschedule",
        )
    if event_type == "task.assigned":
        return _message_lines(
            f"Task assigned by {actor_name or 'a teammate'}",
            [
                ("Task", payload.get("task_title")),
                ("Priority", payload.get("priority")),
                ("Due", _format_date(payload.get("due_at"))),
                ("Assignees", payload.get("assignees")),
            ],
            action=payload.get("action") or "Review task",
        )
    return _message_lines(
        event_type,
        [
            ("Event Type", event_type),
            ("Entity Type", payload.get("entity_type")),
            ("Entity ID", payload.get("entity_id")),
            ("Action", payload.get("action")),
        ],
    )


def _post_slack_webhook(webhook_url: str, text: str) -> None:
    response = requests.post(webhook_url, json={"text": text}, timeout=5)
    response.raise_for_status()


def send_channel_message(channel: NotificationChannel, text: str) -> None:
    if channel.provider == "slack":
        _post_slack_webhook(channel.webhook_url, text)
        return
    if channel.provider == "teams":
        response = requests.post(channel.webhook_url, json={"text": text}, timeout=5)
        response.raise_for_status()
        return
    raise RuntimeError(f"Unsupported provider {channel.provider}")


def serialize_notification_channel(channel: NotificationChannel) -> dict[str, Any]:
    return {
        "id": channel.id,
        "provider": channel.provider,
        "channel_name": channel.channel_name,
        "webhook_url_masked": _masked_webhook_url(channel.webhook_url),
        "is_active": bool(channel.is_active),
        "created_at": channel.created_at,
        "updated_at": channel.updated_at,
    }


def serialize_crm_event_delivery(delivery: CrmEventDelivery) -> dict[str, Any]:
    channel = getattr(delivery, "channel", None)
    return {
        "id": delivery.id,
        "channel_id": delivery.channel_id,
        "provider": delivery.provider,
        "status": delivery.status,
        "channel_name": getattr(channel, "channel_name", None),
        "error_message": (
            "Delivery failed. Check the notification channel configuration and try a test message."
            if delivery.error_message
            else None
        ),
        "delivered_at": delivery.delivered_at,
        "created_at": delivery.created_at,
    }


def serialize_crm_event(event: CrmEvent, deliveries: list[CrmEventDelivery] | None = None) -> dict[str, Any]:
    return {
        "id": event.id,
        "public_id": event.public_id,
        "actor_user_id": event.actor_user_id,
        "event_type": event.event_type,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "payload": event.payload or {},
        "created_at": event.created_at,
        "deliveries": [
            serialize_crm_event_delivery(delivery)
            for delivery in (deliveries or [])
        ],
    }


def list_crm_events(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
    event_type: str | None = None,
    entity_type: str | None = None,
    delivery_provider: str | None = None,
    delivery_status: str | None = None,
) -> tuple[list[CrmEvent], dict[int, list[CrmEventDelivery]], int]:
    query = db.query(CrmEvent).filter(CrmEvent.tenant_id == tenant_id)
    if event_type:
        query = query.filter(CrmEvent.event_type == event_type.strip())
    if entity_type:
        query = query.filter(CrmEvent.entity_type == entity_type.strip())

    normalized_provider = (delivery_provider or "").strip().lower()
    normalized_status = (delivery_status or "").strip().lower()
    if normalized_provider or normalized_status:
        delivery_query = db.query(CrmEventDelivery.event_id).filter(CrmEventDelivery.tenant_id == tenant_id)
        if normalized_provider:
            delivery_query = delivery_query.filter(CrmEventDelivery.provider == normalized_provider)
        if normalized_status:
            delivery_query = delivery_query.filter(CrmEventDelivery.status == normalized_status)
        query = query.filter(CrmEvent.id.in_(delivery_query.distinct()))

    total = query.count()
    events = (
        query
        .order_by(CrmEvent.created_at.desc(), CrmEvent.id.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    event_ids = [event.id for event in events]
    deliveries_by_event_id: dict[int, list[CrmEventDelivery]] = {event_id: [] for event_id in event_ids}
    if event_ids:
        deliveries = (
            db.query(CrmEventDelivery)
            .options(joinedload(CrmEventDelivery.channel))
            .filter(
                CrmEventDelivery.tenant_id == tenant_id,
                CrmEventDelivery.event_id.in_(event_ids),
            )
            .order_by(CrmEventDelivery.created_at.desc(), CrmEventDelivery.id.desc())
            .all()
        )
        for delivery in deliveries:
            deliveries_by_event_id.setdefault(delivery.event_id, []).append(delivery)
    return events, deliveries_by_event_id, total


def list_crm_events_cursor(
    db: Session,
    *,
    tenant_id: int,
    limit: int,
    cursor: int | None = None,
    event_type: str | None = None,
    entity_type: str | None = None,
    delivery_provider: str | None = None,
    delivery_status: str | None = None,
) -> tuple[list[CrmEvent], dict[int, list[CrmEventDelivery]]]:
    query = db.query(CrmEvent).filter(CrmEvent.tenant_id == tenant_id)
    if event_type:
        query = query.filter(CrmEvent.event_type == event_type.strip())
    if entity_type:
        query = query.filter(CrmEvent.entity_type == entity_type.strip())

    normalized_provider = (delivery_provider or "").strip().lower()
    normalized_status = (delivery_status or "").strip().lower()
    if normalized_provider or normalized_status:
        delivery_query = db.query(CrmEventDelivery.event_id).filter(CrmEventDelivery.tenant_id == tenant_id)
        if normalized_provider:
            delivery_query = delivery_query.filter(CrmEventDelivery.provider == normalized_provider)
        if normalized_status:
            delivery_query = delivery_query.filter(CrmEventDelivery.status == normalized_status)
        query = query.filter(CrmEvent.id.in_(delivery_query.distinct()))
    if cursor is not None:
        query = query.filter(CrmEvent.id < cursor)

    events = query.order_by(None).order_by(CrmEvent.id.desc()).limit(limit + 1).all()
    event_ids = [event.id for event in events]
    deliveries_by_event_id: dict[int, list[CrmEventDelivery]] = {event_id: [] for event_id in event_ids}
    if event_ids:
        deliveries = (
            db.query(CrmEventDelivery)
            .options(joinedload(CrmEventDelivery.channel))
            .filter(
                CrmEventDelivery.tenant_id == tenant_id,
                CrmEventDelivery.event_id.in_(event_ids),
            )
            .order_by(CrmEventDelivery.created_at.desc(), CrmEventDelivery.id.desc())
            .all()
        )
        for delivery in deliveries:
            deliveries_by_event_id.setdefault(delivery.event_id, []).append(delivery)
    return events, deliveries_by_event_id


def list_notification_channels(db: Session, *, tenant_id: int) -> list[NotificationChannel]:
    return (
        db.query(NotificationChannel)
        .filter(NotificationChannel.tenant_id == tenant_id)
        .order_by(NotificationChannel.provider.asc(), NotificationChannel.channel_name.asc(), NotificationChannel.id.asc())
        .all()
    )


def create_notification_channel(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict[str, Any]) -> NotificationChannel:
    provider = _normalize_provider(payload.get("provider", "slack"))
    webhook_url = (payload.get("webhook_url") or "").strip()
    if not webhook_url.startswith("https://"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook URL must be an HTTPS URL")
    channel = NotificationChannel(
        tenant_id=tenant_id,
        provider=provider,
        webhook_url=webhook_url,
        channel_name=(payload.get("channel_name") or "").strip() or None,
        is_active=bool(payload.get("is_active", True)),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return channel


def get_notification_channel_or_404(db: Session, *, tenant_id: int, channel_id: int) -> NotificationChannel:
    channel = (
        db.query(NotificationChannel)
        .filter(NotificationChannel.id == channel_id, NotificationChannel.tenant_id == tenant_id)
        .first()
    )
    if not channel:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification channel not found")
    return channel


def update_notification_channel(
    db: Session,
    *,
    channel: NotificationChannel,
    actor_user_id: int | None,
    payload: dict[str, Any],
) -> NotificationChannel:
    if "provider" in payload and payload["provider"] is not None:
        channel.provider = _normalize_provider(payload["provider"])
    if "webhook_url" in payload and payload["webhook_url"]:
        webhook_url = payload["webhook_url"].strip()
        if not webhook_url.startswith("https://"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook URL must be an HTTPS URL")
        channel.webhook_url = webhook_url
    if "channel_name" in payload:
        channel.channel_name = (payload["channel_name"] or "").strip() or None
    if "is_active" in payload and payload["is_active"] is not None:
        channel.is_active = bool(payload["is_active"])
    channel.updated_by_user_id = actor_user_id
    db.add(channel)
    db.commit()
    db.refresh(channel)
    return channel


def delete_notification_channel(db: Session, *, channel: NotificationChannel) -> None:
    db.delete(channel)
    db.commit()


def send_test_message(db: Session, *, channel: NotificationChannel, actor_name: str | None = None) -> dict[str, Any]:
    text = f"Lynk test alert sent by {actor_name or 'an admin'}."
    send_channel_message(channel, text)
    return {"ok": True, "message": "Test message sent"}


def stage_crm_event(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    event_type: str,
    entity_type: str,
    entity_id: str | int,
    payload: dict[str, Any] | None = None,
) -> CrmEvent:
    """Write the event with the caller's transaction; queue its work only once that commits.

    Automation and channel deliveries run in Celery and read the event from the database, so
    queueing them before the commit could run them against a row that is not there yet, or
    that a rollback then removes (13a E5).
    """
    encoded_payload = jsonable_encoder(payload or {})
    event = CrmEvent(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=str(entity_id),
        payload=encoded_payload,
    )
    db.add(event)
    db.flush()

    delivery_ids: list[int] = []
    if event_type in SLACK_ALERT_EVENT_TYPES:
        channels = (
            db.query(NotificationChannel)
            .filter(
                NotificationChannel.tenant_id == tenant_id,
                NotificationChannel.provider.in_(SUPPORTED_CHANNEL_PROVIDERS),
                NotificationChannel.is_active.is_(True),
            )
            .all()
        )
        for channel in channels:
            delivery = CrmEventDelivery(
                tenant_id=tenant_id,
                event_id=event.id,
                channel_id=channel.id,
                provider=channel.provider,
                status="pending",
            )
            db.add(delivery)
            db.flush()
            delivery_ids.append(delivery.id)

    event_id = event.id
    on_commit(db, lambda: _dispatch_crm_event(db, event_id=event_id, delivery_ids=delivery_ids))
    return event


def stage_standard_crm_event(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    event_type: str,
    entity_type: str,
    entity_id: str | int,
    payload: dict[str, Any] | None = None,
) -> CrmEvent:
    """`stage_crm_event` for a standard event type, with the entity named in its payload."""
    return stage_crm_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        event_type=_standard_event_type(event_type),
        entity_type=entity_type,
        entity_id=entity_id,
        payload=_standard_event_payload(entity_type, entity_id, payload),
    )


def _standard_event_type(event_type: str) -> str:
    normalized_type = event_type.strip().lower()
    if normalized_type not in CRM_EVENT_TYPES:
        raise ValueError(f"Unsupported standard CRM event type: {normalized_type}")
    return normalized_type


def _standard_event_payload(entity_type: str, entity_id: str | int, payload: dict[str, Any] | None) -> dict[str, Any]:
    return {"entity_type": entity_type, "entity_id": str(entity_id), **(payload or {})}


def _dispatch_crm_event(db: Session, *, event_id: int, delivery_ids: list[int]) -> None:
    """Queue an event's deliveries and automation; a queueing failure is recorded on the rows."""
    failed_deliveries: dict[int, str] = {}
    for delivery_id in delivery_ids:
        try:
            enqueue_crm_event_delivery(delivery_id)
        except Exception as exc:
            logger.exception("Failed to enqueue CRM event delivery", extra={"delivery_id": delivery_id, "event_id": event_id})
            failed_deliveries[delivery_id] = f"Delivery could not be queued: {str(exc)[:900]}"
    automation_error: str | None = None
    try:
        enqueue_crm_event_automation(event_id)
    except Exception as exc:
        logger.exception("Failed to enqueue CRM event automation", extra={"event_id": event_id})
        automation_error = str(exc)[:1000]
    if not failed_deliveries and automation_error is None:
        return

    # This runs after the commit, when the caller's session is between transactions.
    with on_commit_session(db) as session:
        for delivery in session.query(CrmEventDelivery).filter(CrmEventDelivery.id.in_(list(failed_deliveries))).all():
            delivery.status = "failed"
            delivery.error_message = failed_deliveries[delivery.id]
        if automation_error is not None:
            event = session.query(CrmEvent).filter(CrmEvent.id == event_id).first()
            if event is not None:
                persisted_payload = dict(event.payload or {})
                persisted_payload["_automation_dispatch"] = {
                    "status": "failed",
                    "error_message": automation_error,
                    "failed_at": _utcnow().isoformat(),
                }
                event.payload = jsonable_encoder(persisted_payload)
        session.commit()


def emit_crm_event(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    event_type: str,
    entity_type: str,
    entity_id: str | int,
    payload: dict[str, Any] | None = None,
) -> CrmEvent:
    """Stage the event and commit. Inside a unit of work the commit is the action's own."""
    event = stage_crm_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
    )
    db.commit()
    if not in_unit_of_work(db):
        db.refresh(event)
    return event


def process_crm_event_delivery(db: Session, *, delivery_id: int) -> CrmEventDelivery | None:
    delivery = (
        db.query(CrmEventDelivery)
        .options(joinedload(CrmEventDelivery.event), joinedload(CrmEventDelivery.channel))
        .filter(CrmEventDelivery.id == delivery_id)
        .first()
    )
    if delivery is None:
        return None
    if delivery.status == "delivered":
        return delivery
    if not delivery.event or not delivery.channel:
        delivery.status = "failed"
        delivery.error_message = "Delivery is missing its event or notification channel"
        db.add(delivery)
        db.commit()
        db.refresh(delivery)
        return delivery

    delivery.status = "running"
    delivery.error_message = None
    db.add(delivery)
    db.commit()

    try:
        message = format_event_message(delivery.event.event_type, delivery.event.payload or {})
        send_channel_message(delivery.channel, message)
    except Exception as exc:
        delivery.status = "failed"
        delivery.error_message = str(exc)[:1000]
        db.add(delivery)
        db.commit()
        db.refresh(delivery)
        raise

    delivery.status = "delivered"
    delivery.delivered_at = _utcnow()
    delivery.error_message = None
    db.add(delivery)
    db.commit()
    db.refresh(delivery)
    return delivery


def enqueue_crm_event_delivery(delivery_id: int) -> None:
    from app.tasks.automation_tasks import process_crm_event_delivery_task

    process_crm_event_delivery_task.delay(delivery_id)


def enqueue_crm_event_automation(event_id: int) -> None:
    from app.tasks.automation_tasks import process_crm_event

    process_crm_event.delay(event_id)


def safe_emit_crm_event(db: Session, **kwargs: Any) -> CrmEvent | None:
    """An event that must never fail the action it reports.

    Inside a unit of work the event gets a savepoint: a failure drops the event alone, where a
    rollback would have dropped the whole business action with it.
    """
    if in_unit_of_work(db):
        try:
            with savepoint(db):
                return stage_crm_event(db, **kwargs)
        except Exception:
            logger.exception("CRM event not recorded", extra={"event_type": kwargs.get("event_type")})
            return None
    try:
        return emit_crm_event(db, **kwargs)
    except Exception:
        db.rollback()
        return None


def safe_publish_crm_event(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    event_type: str,
    entity_type: str,
    entity_id: str | int,
    payload: dict[str, Any] | None = None,
) -> CrmEvent | None:
    return safe_emit_crm_event(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        event_type=_standard_event_type(event_type),
        entity_type=entity_type,
        entity_id=entity_id,
        payload=_standard_event_payload(entity_type, entity_id, payload),
    )


def field_changes(before: dict[str, Any], after: dict[str, Any], keys: Any = None) -> dict[str, dict[str, Any]]:
    """`{field: {"from": old, "to": new}}` for each field whose value actually changed.

    Automation's *changed*, *changed to* and *changed from* operators read this. An update
    event that sent only the submitted keys (`changed_fields`) could not say what a field
    changed from, so *changed to* never matched, and resubmitting an unchanged value
    counted as a change.
    """

    names = keys if keys is not None else set(before) | set(after)
    encoded_before = jsonable_encoder(before)
    encoded_after = jsonable_encoder(after)
    return {
        name: {"from": encoded_before.get(name), "to": encoded_after.get(name)}
        for name in sorted(names)
        if encoded_before.get(name) != encoded_after.get(name)
    }


def actor_payload(user) -> dict[str, Any]:
    return {
        "actor_user_id": getattr(user, "id", None),
        "actor_name": _display_user_name(user),
    }
