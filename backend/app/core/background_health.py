"""Readiness checks, and the watchdog that notices when Celery beat or the worker stops (13 F0.8 F3, F6).

Two heartbeats, written to Redis:
- **beat**: every time beat publishes the heartbeat task (`before_task_publish`, in the beat
  process), it stamps `lynk:heartbeat:beat`.
- **worker**: when a worker runs that task, it stamps `lynk:heartbeat:worker`.

A stale beat stamp means beat has stopped. A fresh beat stamp with a stale worker stamp means
no worker is taking tasks (stopped, or stuck behind a backlog). The queue depth is reported
beside them.

`/health/ready` reports every check and answers 503 when one fails. The watchdog runs in each
web process; a Redis key makes one alert per incident across processes, and one more on recovery.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from sqlalchemy import text

from app.core.config import settings
from app.core.database import SessionLocal

logger = logging.getLogger("app.background_health")

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None

HEARTBEAT_TASK_NAME = "app.tasks.platform.heartbeat"
BEAT_HEARTBEAT_KEY = "lynk:heartbeat:beat"
WORKER_HEARTBEAT_KEY = "lynk:heartbeat:worker"
ALERT_STATE_KEY = "lynk:alert:background"
CELERY_DEFAULT_QUEUE = "celery"
_HEARTBEAT_TTL_SECONDS = 7 * 24 * 60 * 60
_PROCESS_STARTED_AT = time.time()


def _redis_from_url(url: str | None):
    if redis is None or not url:
        return None
    return redis.Redis.from_url(url, socket_timeout=2, socket_connect_timeout=2, decode_responses=True)


def _state_client():
    return _redis_from_url(settings.REDIS_URL)


# ---------------------------------------------------------------------------------------------
# Writing the heartbeats
# ---------------------------------------------------------------------------------------------


def stamp_heartbeat(key: str) -> None:
    client = _state_client()
    if client is None:
        return
    try:
        client.set(key, json.dumps({"at": time.time()}), ex=_HEARTBEAT_TTL_SECONDS)
    except Exception as exc:  # pragma: no cover - network dependent
        logger.warning("Heartbeat %s not written: %s", key, exc)


def _read_heartbeat(client, key: str) -> float | None:
    raw = client.get(key)
    if not raw:
        return None
    try:
        return float(json.loads(raw)["at"])
    except (ValueError, KeyError, TypeError):
        return None


# ---------------------------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------------------------


def check_database() -> dict[str, Any]:
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception as exc:
        logger.warning("Readiness: database check failed: %s", exc)
        return {"status": "error"}


def _ping(url: str | None) -> dict[str, Any]:
    client = _redis_from_url(url)
    if client is None:
        return {"status": "not_configured"}
    try:
        client.ping()
        return {"status": "ok"}
    except Exception as exc:
        logger.warning("Readiness: Redis ping failed: %s", exc)
        return {"status": "error"}


def check_redis() -> dict[str, Any]:
    return _ping(settings.REDIS_URL)


def check_broker() -> dict[str, Any]:
    broker_url = settings.CELERY_BROKER_URL
    if not broker_url:
        return {"status": "not_configured"}
    if not broker_url.startswith(("redis://", "rediss://")):
        return {"status": "unknown"}
    return _ping(broker_url)


def _queue_depth() -> int | None:
    broker_url = settings.CELERY_BROKER_URL or ""
    if not broker_url.startswith(("redis://", "rediss://")):
        return None
    client = _redis_from_url(broker_url)
    try:
        return int(client.llen(CELERY_DEFAULT_QUEUE))
    except Exception:
        return None


def _heartbeat_status(last_seen: float | None, now: float) -> dict[str, Any]:
    stale_after = settings.BACKGROUND_HEARTBEAT_STALE_SECONDS
    if last_seen is None:
        # A fresh deployment has not had a beat yet: give it one stale period.
        if now - _PROCESS_STARTED_AT < stale_after:
            return {"status": "starting"}
        return {"status": "error", "last_seen_seconds": None}
    age = max(0, int(now - last_seen))
    return {"status": "ok" if age <= stale_after else "error", "last_seen_seconds": age}


def check_background() -> dict[str, dict[str, Any]]:
    client = _state_client()
    if client is None:
        unknown = {"status": "unknown"}
        return {"beat": unknown, "worker": unknown, "queue": {"status": "unknown", "depth": None}}
    now = time.time()
    try:
        beat = _heartbeat_status(_read_heartbeat(client, BEAT_HEARTBEAT_KEY), now)
        worker = _heartbeat_status(_read_heartbeat(client, WORKER_HEARTBEAT_KEY), now)
    except Exception as exc:
        logger.warning("Readiness: heartbeat read failed: %s", exc)
        unknown = {"status": "unknown"}
        return {"beat": unknown, "worker": unknown, "queue": {"status": "unknown", "depth": None}}
    depth = _queue_depth()
    return {"beat": beat, "worker": worker, "queue": {"status": "ok" if depth is not None else "unknown", "depth": depth}}


def readiness() -> tuple[bool, dict[str, Any]]:
    checks: dict[str, Any] = {
        "database": check_database(),
        "redis": check_redis(),
        "broker": check_broker(),
        **check_background(),
    }
    ready = all(check.get("status") != "error" for check in checks.values())
    return ready, {"status": "ready" if ready else "not_ready", "checks": checks}


# ---------------------------------------------------------------------------------------------
# Watchdog
# ---------------------------------------------------------------------------------------------

_PROBLEM_COPY = {
    "beat": "Celery beat has stopped: scheduled work (overdue scans, report emails, backups, reminders, recycle-bin purges) is not being queued.",
    "worker": "No Celery worker is taking tasks: automations, imports, exports, emails and backups are waiting in the queue.",
}


def background_problems(background: dict[str, dict[str, Any]]) -> list[str]:
    problems = [part for part in ("beat", "worker") if background[part].get("status") == "error"]
    # A stopped beat also starves the worker of heartbeats: report the cause only.
    if "beat" in problems and "worker" in problems:
        problems = ["beat"]
    return problems


def _describe(problems: list[str], background: dict[str, dict[str, Any]]) -> str:
    lines = [_PROBLEM_COPY[part] for part in problems]
    for part in ("beat", "worker"):
        seen = background[part].get("last_seen_seconds")
        lines.append(f"{part}: last heartbeat {'never' if seen is None else f'{seen} seconds ago'}")
    lines.append(f"queue depth: {background['queue'].get('depth')}")
    lines.append(f"environment: {settings.APP_ENVIRONMENT}")
    return "\n".join(lines)


def _notify_operator(subject: str, body: str) -> None:
    from app.modules.mail.services.tenant_mail import send_operator_alert

    try:
        send_operator_alert(subject=subject, body=body)
    except Exception as exc:  # pragma: no cover - SMTP dependent
        logger.warning("Operator alert email not sent: %s", exc)


def run_watchdog_check() -> str | None:
    """One pass. Returns the alert it raised ("problem", "recovered") or None."""
    client = _state_client()
    if client is None:
        return None
    background = check_background()
    problems = background_problems(background)
    try:
        previous = client.get(ALERT_STATE_KEY)
        if problems:
            state = ",".join(problems)
            if previous == state:
                return None
            # Another web process may have raised it already: only the one whose write wins alerts.
            won = client.set(ALERT_STATE_KEY, state, nx=previous is None, xx=previous is not None, ex=_HEARTBEAT_TTL_SECONDS)
            if not won:
                return None
            body = _describe(problems, background)
            logger.error("Background jobs stopped (%s)\n%s", state, body, extra={"alert": "background_stopped", "parts": state})
            _notify_operator(f"[Lynk {settings.APP_ENVIRONMENT}] Background jobs stopped: {state}", body)
            return "problem"
        if previous is not None and client.delete(ALERT_STATE_KEY):
            body = _describe([], background)
            logger.warning("Background jobs recovered (%s)\n%s", previous, body, extra={"alert": "background_recovered", "parts": previous})
            _notify_operator(f"[Lynk {settings.APP_ENVIRONMENT}] Background jobs recovered", body)
            return "recovered"
    except Exception as exc:  # pragma: no cover - network dependent
        logger.warning("Background watchdog check failed: %s", exc)
    return None


async def watchdog_loop() -> None:
    interval = max(30, settings.BACKGROUND_HEARTBEAT_INTERVAL_SECONDS)
    while True:
        await asyncio.sleep(interval)
        try:
            await asyncio.to_thread(run_watchdog_check)
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover
            logger.exception("Background watchdog crashed; it retries next interval")
