from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import requests
from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session, joinedload

from app.core.pagination import Pagination
from app.modules.platform.models import CrmEvent, CrmEventDelivery, NotificationChannel


SUPPORTED_CHANNEL_PROVIDERS = {"slack", "teams"}
SLACK_ALERT_EVENT_TYPES = {
    "lead.created",
    "deal.assigned",
    "invoice.overdue",
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
    if event_type == "invoice.overdue":
        return _message_lines(
            "Invoice overdue",
            [
                ("Invoice", payload.get("invoice_number")),
                ("Company", payload.get("customer_name")),
                ("Amount", payload.get("amount")),
                ("Due Date", _format_date(payload.get("due_date"))),
            ],
            action=payload.get("action") or "Follow up on payment",
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
    return _message_lines(event_type, [(key, value) for key, value in payload.items() if key != "webhook_url"])


def _post_slack_webhook(webhook_url: str, text: str) -> None:
    response = requests.post(webhook_url, json={"text": text}, timeout=5)
    if response.status_code >= 400:
        raise RuntimeError(f"Slack webhook failed with status {response.status_code}: {response.text[:200]}")


def send_channel_message(channel: NotificationChannel, text: str) -> None:
    if channel.provider == "slack":
        _post_slack_webhook(channel.webhook_url, text)
        return
    if channel.provider == "teams":
        response = requests.post(channel.webhook_url, json={"text": text}, timeout=5)
        if response.status_code >= 400:
            raise RuntimeError(f"Teams webhook failed with status {response.status_code}: {response.text[:200]}")
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
        "error_message": delivery.error_message,
        "delivered_at": delivery.delivered_at,
        "created_at": delivery.created_at,
    }


def serialize_crm_event(event: CrmEvent, deliveries: list[CrmEventDelivery] | None = None) -> dict[str, Any]:
    return {
        "id": event.id,
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

    if event_type in SLACK_ALERT_EVENT_TYPES:
        channels = (
            db.query(NotificationChannel)
            .filter(
                NotificationChannel.tenant_id == tenant_id,
                NotificationChannel.provider == "slack",
                NotificationChannel.is_active.is_(True),
            )
            .all()
        )
        message = format_event_message(event_type, encoded_payload)
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
            try:
                send_channel_message(channel, message)
            except Exception as exc:  # Slack must not break CRM writes.
                delivery.status = "failed"
                delivery.error_message = str(exc)[:1000]
            else:
                delivery.status = "delivered"
                delivery.delivered_at = _utcnow()
            db.add(delivery)

    db.commit()
    db.refresh(event)
    return event


def safe_emit_crm_event(db: Session, **kwargs: Any) -> CrmEvent | None:
    try:
        return emit_crm_event(db, **kwargs)
    except Exception:
        db.rollback()
        return None


def actor_payload(user) -> dict[str, Any]:
    return {
        "actor_user_id": getattr(user, "id", None),
        "actor_name": _display_user_name(user),
    }
