"""Per-user server-sent events: notifications and data-transfer job progress.

The stream never touches the database on the event loop. Every commit that writes a
notification or a job publishes a wake-up on Redis (`realtime_channel`); one subscriber per
process (`_RealtimeHub`) wakes the matching streams, which then read what changed in a worker
thread with a short-lived session. A slow fallback check catches writes that bypass the ORM
hooks and messages lost while Redis reconnects. Without Redis the stream polls, still off the
event loop.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from time import monotonic
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
# The publishing half (commit hooks) lives in realtime_hooks, registered with app.core.database.
from app.core.realtime_hooks import REALTIME_CHANNEL_PREFIX, realtime_channel
from app.modules.platform.models import DataTransferJob, UserNotification
from app.modules.platform.schema import DataTransferJobResponse, UserNotificationResponse

logger = logging.getLogger(__name__)

try:
    import redis.asyncio as redis_asyncio
except ImportError:  # pragma: no cover - Redis is a hard dependency in containers
    redis_asyncio = None


REALTIME_HEARTBEAT_INTERVAL_SECONDS = 20
# With Redis, a stream checks on every wake-up and at least this often.
REALTIME_FALLBACK_CHECK_SECONDS = 30
# Without Redis, a stream polls this often.
REALTIME_POLL_INTERVAL_SECONDS = 5


# ---------------------------------------------------------------------------------------------
# Subscribing: one Redis connection per process, fanned out to the open streams.
# ---------------------------------------------------------------------------------------------


class _RealtimeHub:
    RECONNECT_DELAY_SECONDS = 5

    def __init__(self) -> None:
        self._listeners: dict[str, set[asyncio.Event]] = {}
        self._task: asyncio.Task | None = None
        self.available = False

    def register(self, channel: str) -> asyncio.Event:
        wakeup = asyncio.Event()
        self._listeners.setdefault(channel, set()).add(wakeup)
        if (self._task is None or self._task.done()) and redis_asyncio is not None and settings.REDIS_URL:
            self._task = asyncio.get_running_loop().create_task(self._run())
        return wakeup

    def unregister(self, channel: str, wakeup: asyncio.Event) -> None:
        listeners = self._listeners.get(channel)
        if listeners is None:
            return
        listeners.discard(wakeup)
        if not listeners:
            self._listeners.pop(channel, None)

    def _wake_all(self) -> None:
        for listeners in self._listeners.values():
            for wakeup in listeners:
                wakeup.set()

    async def _run(self) -> None:
        while self._listeners:
            client = None
            try:
                client = redis_asyncio.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
                pubsub = client.pubsub(ignore_subscribe_messages=True)
                await pubsub.psubscribe(f"{REALTIME_CHANNEL_PREFIX}:*")
                self.available = True
                # Anything published while disconnected was lost: every stream checks once.
                self._wake_all()
                while self._listeners:
                    message = await pubsub.get_message(timeout=REALTIME_HEARTBEAT_INTERVAL_SECONDS)
                    if not message:
                        continue
                    channel = message.get("channel")
                    if isinstance(channel, bytes):
                        channel = channel.decode()
                    for wakeup in self._listeners.get(channel, ()):
                        wakeup.set()
                await pubsub.aclose()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # pragma: no cover - network dependent
                if self.available:
                    logger.warning("Realtime subscriber lost Redis, streams fall back to polling: %s", exc)
                self.available = False
                await asyncio.sleep(self.RECONNECT_DELAY_SECONDS)
            finally:
                if client is not None:
                    try:
                        await client.aclose()
                    except Exception:  # pragma: no cover
                        pass
        self.available = False


_hub = _RealtimeHub()


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


def _initial_markers_in_new_session(tenant_id: int, user_id: int) -> dict[str, datetime]:
    with SessionLocal() as db:
        return initial_realtime_markers(db, tenant_id=tenant_id, user_id=user_id)


def _collect_in_new_session(tenant_id: int, user_id: int, markers: dict[str, datetime]):
    with SessionLocal() as db:
        return collect_realtime_events(db, tenant_id=tenant_id, user_id=user_id, markers=markers)


async def realtime_stream(*, tenant_id: int, user_id: int):
    markers = await asyncio.to_thread(_initial_markers_in_new_session, tenant_id, user_id)
    yield encode_sse_event(event="heartbeat", data={"connected": True, "ts": datetime.now(timezone.utc)})

    channel = realtime_channel(tenant_id, user_id)
    wakeup = _hub.register(channel)
    try:
        last_check = last_heartbeat = monotonic()
        while True:
            check_every = REALTIME_FALLBACK_CHECK_SECONDS if _hub.available else REALTIME_POLL_INTERVAL_SECONDS
            now = monotonic()
            timeout = max(0.0, min(last_check + check_every, last_heartbeat + REALTIME_HEARTBEAT_INTERVAL_SECONDS) - now)
            try:
                await asyncio.wait_for(wakeup.wait(), timeout=timeout)
            except asyncio.TimeoutError:
                pass
            woken = wakeup.is_set()
            wakeup.clear()

            now = monotonic()
            if woken or now - last_check >= check_every:
                last_check = now
                events = await asyncio.to_thread(_collect_in_new_session, tenant_id, user_id, markers)
                for event_name, payload, event_id in events:
                    yield encode_sse_event(event=event_name, data=payload, event_id=event_id)
            if now - last_heartbeat >= REALTIME_HEARTBEAT_INTERVAL_SECONDS:
                last_heartbeat = now
                yield encode_sse_event(event="heartbeat", data={"ts": datetime.now(timezone.utc)})
    finally:
        _hub.unregister(channel, wakeup)
