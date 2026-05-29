from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.modules.platform.models import DataTransferJob, UserNotification
from app.modules.platform.schema import DataTransferJobResponse, UserNotificationResponse


REALTIME_POLL_INTERVAL_SECONDS = 2
REALTIME_HEARTBEAT_INTERVAL_SECONDS = 20


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _max_datetime(left: datetime, right: datetime) -> datetime:
    if left.tzinfo is not None and right.tzinfo is None:
        right = right.replace(tzinfo=left.tzinfo)
    elif left.tzinfo is None and right.tzinfo is not None:
        left = left.replace(tzinfo=right.tzinfo)
    return max(left, right)


def encode_sse_event(*, event: str, data: dict[str, Any], event_id: str | None = None) -> str:
    lines: list[str] = []
    if event_id:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    payload = json.dumps(data, default=_json_default, separators=(",", ":"))
    for line in payload.splitlines() or ["{}"]:
        lines.append(f"data: {line}")
    lines.append("")
    return "\n".join(lines) + "\n"


def _latest_marker(db: Session, model, field, *, tenant_id: int, user_field, user_id: int) -> datetime:
    value = (
        db.query(func.max(field))
        .filter(model.tenant_id == tenant_id, user_field == user_id)
        .scalar()
    )
    return value or datetime.now(timezone.utc)


def initial_realtime_markers(db: Session, *, tenant_id: int, user_id: int) -> dict[str, datetime]:
    return {
        "notification_created_at": _latest_marker(
            db,
            UserNotification,
            UserNotification.created_at,
            tenant_id=tenant_id,
            user_field=UserNotification.user_id,
            user_id=user_id,
        ),
        "notification_updated_at": _latest_marker(
            db,
            UserNotification,
            UserNotification.updated_at,
            tenant_id=tenant_id,
            user_field=UserNotification.user_id,
            user_id=user_id,
        ),
        "job_updated_at": _latest_marker(
            db,
            DataTransferJob,
            DataTransferJob.updated_at,
            tenant_id=tenant_id,
            user_field=DataTransferJob.actor_user_id,
            user_id=user_id,
        ),
    }


def _unread_count(db: Session, *, tenant_id: int, user_id: int) -> int:
    return (
        db.query(UserNotification.id)
        .filter(
            UserNotification.tenant_id == tenant_id,
            UserNotification.user_id == user_id,
            UserNotification.status == "unread",
        )
        .count()
    )


def collect_realtime_events(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    markers: dict[str, datetime],
) -> list[tuple[str, dict[str, Any], str]]:
    events: list[tuple[str, dict[str, Any], str]] = []
    notification_created_at = markers["notification_created_at"]
    notification_updated_at = markers["notification_updated_at"]
    job_updated_at = markers["job_updated_at"]

    created_notifications = (
        db.query(UserNotification)
        .filter(
            UserNotification.tenant_id == tenant_id,
            UserNotification.user_id == user_id,
            UserNotification.created_at > notification_created_at,
        )
        .order_by(UserNotification.created_at.asc(), UserNotification.id.asc())
        .all()
    )
    unread_count = _unread_count(db, tenant_id=tenant_id, user_id=user_id)
    for notification in created_notifications:
        payload = UserNotificationResponse.model_validate(notification).model_dump(mode="json", by_alias=True)
        payload["unread_count"] = unread_count
        events.append(("notification.created", payload, f"notification:{notification.id}:{notification.updated_at.isoformat()}"))
        markers["notification_created_at"] = _max_datetime(markers["notification_created_at"], notification.created_at)
        markers["notification_updated_at"] = _max_datetime(markers["notification_updated_at"], notification.updated_at)

    updated_notifications = (
        db.query(UserNotification)
        .filter(
            UserNotification.tenant_id == tenant_id,
            UserNotification.user_id == user_id,
            UserNotification.updated_at > notification_updated_at,
            UserNotification.created_at <= notification_created_at,
        )
        .order_by(UserNotification.updated_at.asc(), UserNotification.id.asc())
        .all()
    )
    if updated_notifications:
        unread_count = _unread_count(db, tenant_id=tenant_id, user_id=user_id)
    for notification in updated_notifications:
        payload = UserNotificationResponse.model_validate(notification).model_dump(mode="json", by_alias=True)
        payload["unread_count"] = unread_count
        events.append(("notification.updated", payload, f"notification:{notification.id}:{notification.updated_at.isoformat()}"))
        markers["notification_updated_at"] = _max_datetime(markers["notification_updated_at"], notification.updated_at)

    updated_jobs = (
        db.query(DataTransferJob)
        .filter(
            DataTransferJob.tenant_id == tenant_id,
            DataTransferJob.actor_user_id == user_id,
            DataTransferJob.updated_at > job_updated_at,
        )
        .order_by(DataTransferJob.updated_at.asc(), DataTransferJob.id.asc())
        .all()
    )
    for job in updated_jobs:
        payload = DataTransferJobResponse.model_validate(job).model_dump(mode="json")
        events.append(("job.updated", payload, f"job:{job.id}:{job.updated_at.isoformat()}"))
        markers["job_updated_at"] = _max_datetime(markers["job_updated_at"], job.updated_at)

    return events


async def realtime_stream(*, tenant_id: int, user_id: int):
    db = SessionLocal()
    try:
        markers = initial_realtime_markers(db, tenant_id=tenant_id, user_id=user_id)
    finally:
        db.close()

    yield encode_sse_event(event="heartbeat", data={"connected": True, "ts": datetime.now(timezone.utc)})
    ticks_since_heartbeat = 0
    while True:
        await asyncio.sleep(REALTIME_POLL_INTERVAL_SECONDS)
        ticks_since_heartbeat += REALTIME_POLL_INTERVAL_SECONDS
        db = SessionLocal()
        try:
            events = collect_realtime_events(db, tenant_id=tenant_id, user_id=user_id, markers=markers)
        finally:
            db.close()
        for event_name, payload, event_id in events:
            yield encode_sse_event(event=event_name, data=payload, event_id=event_id)
        if ticks_since_heartbeat >= REALTIME_HEARTBEAT_INTERVAL_SECONDS:
            ticks_since_heartbeat = 0
            yield encode_sse_event(event="heartbeat", data={"ts": datetime.now(timezone.utc)})
