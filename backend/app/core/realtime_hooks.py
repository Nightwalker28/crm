"""The commit hooks that wake realtime streams (13a H3). See `app/core/realtime.py`.

Registered on every `Session` when `app.core.database` is imported, so they exist before any
commit. They must not be registered lazily: a first import inside another session event would
add listeners to the list SQLAlchemy is iterating ("deque mutated during iteration"). For the
same reason this module imports no models; it recognises rows by table name.
"""

from __future__ import annotations

import logging

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)

try:
    import redis
except ImportError:  # pragma: no cover - Redis is a hard dependency in containers
    redis = None

REALTIME_CHANNEL_PREFIX = "lynk:realtime"
_SESSION_TARGETS_KEY = "lynk_realtime_targets"
# Table name → the column naming the user whose stream should wake.
_WATCHED_TABLES = {"user_notifications": "user_id", "data_transfer_jobs": "actor_user_id"}

_publisher = None


def realtime_channel(tenant_id: int, user_id: int) -> str:
    return f"{REALTIME_CHANNEL_PREFIX}:{tenant_id}:{user_id}"


def _publisher_client():
    global _publisher
    if _publisher is None and redis is not None and settings.REDIS_URL:
        _publisher = redis.Redis.from_url(settings.REDIS_URL, socket_timeout=0.5, socket_connect_timeout=0.5)
    return _publisher


def publish_realtime_wakeups(targets: set[tuple[int, int]]) -> None:
    """Best effort: a lost wake-up is caught by the stream's fallback check."""
    client = _publisher_client()
    if client is None or not targets:
        return
    try:
        pipe = client.pipeline(transaction=False)
        for tenant_id, user_id in targets:
            pipe.publish(realtime_channel(tenant_id, user_id), "1")
        pipe.execute()
    except Exception as exc:  # pragma: no cover - network dependent
        logger.debug("Realtime wake-up not published: %s", exc)


def mark_realtime_target(db: Session, *, tenant_id: int | None, user_id: int | None) -> None:
    """For writes the ORM hooks cannot see (bulk `query.update`): wake the user after commit."""
    if tenant_id is None or user_id is None:
        return
    db.info.setdefault(_SESSION_TARGETS_KEY, set()).add((int(tenant_id), int(user_id)))


@event.listens_for(Session, "after_flush")
def _collect_realtime_targets(session: Session, _flush_context) -> None:
    for instance in (*session.new, *session.dirty):
        user_column = _WATCHED_TABLES.get(getattr(instance, "__tablename__", ""))
        if user_column:
            mark_realtime_target(session, tenant_id=getattr(instance, "tenant_id", None), user_id=getattr(instance, user_column, None))


@event.listens_for(Session, "after_commit")
def _publish_realtime_targets(session: Session) -> None:
    targets = session.info.pop(_SESSION_TARGETS_KEY, None)
    if targets:
        publish_realtime_wakeups(targets)


@event.listens_for(Session, "after_rollback")
def _drop_realtime_targets(session: Session) -> None:
    session.info.pop(_SESSION_TARGETS_KEY, None)
