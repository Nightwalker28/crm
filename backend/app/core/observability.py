"""Logging, request ids and error tracking for the web app and the Celery processes (13 F0.8).

- `configure_logging` makes every process log one JSON object per line (or plain text for a
  terminal), each carrying the current request id or task id.
- `RequestContextMiddleware` gives every HTTP request an id (the caller's `X-Request-ID` when it
  is well formed), returns it in the response header, and writes one access line per request.
- `init_error_tracking` starts Sentry when `SENTRY_DSN` is set. Error-level log records become
  events, so `logger.error(...)` / `logger.exception(...)` is how code reports a problem.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from app.core.config import settings

logger = logging.getLogger("app.request")

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("lynk_request_id", default=None)
task_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("lynk_task_id", default=None)

REQUEST_ID_HEADER = "x-request-id"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._:-]{8,64}$")
# Liveness probes would drown the access log.
_QUIET_PATHS = frozenset({"/health", "/health/ready"})
_SENSITIVE_KEYS = frozenset({"authorization", "cookie", "set-cookie", "password", "token", "secret", "x-api-key"})


def current_request_id() -> str | None:
    return request_id_var.get()


class _ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        record.task_id = task_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    _RESERVED = frozenset(vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()) | {"message", "request_id", "task_id"}

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if getattr(record, "request_id", None):
            payload["request_id"] = record.request_id
        if getattr(record, "task_id", None):
            payload["task_id"] = record.task_id
        for key, value in record.__dict__.items():
            if key not in self._RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, separators=(",", ":"))


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)s %(name)s [%(context)s] %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        record.context = getattr(record, "request_id", None) or getattr(record, "task_id", None) or "-"
        return super().format(record)


def _log_format() -> str:
    if settings.LOG_FORMAT in {"json", "text"}:
        return settings.LOG_FORMAT
    return "text" if settings.DEBUG else "json"


def configure_logging() -> None:
    """Idempotent. Replaces the root handlers; uvicorn's and Celery's loggers propagate to it."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if _log_format() == "json" else TextFormatter())
    handler.addFilter(_ContextFilter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(settings.LOG_LEVEL if settings.LOG_LEVEL in logging.getLevelNamesMapping() else "INFO")
    # Our access line replaces uvicorn's; its error logger keeps going through the root.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        named = logging.getLogger(name)
        named.handlers[:] = []
        named.propagate = True
    logging.getLogger("uvicorn.access").disabled = True


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: "[Filtered]" if str(key).lower() in _SENSITIVE_KEYS else _scrub(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_scrub(item) for item in value]
    return value


def _before_send(event: dict, _hint: dict) -> dict:
    request = event.get("request")
    if isinstance(request, dict):
        request.pop("cookies", None)
        request.pop("data", None)
        if "headers" in request:
            request["headers"] = _scrub(request["headers"])
    if event.get("extra"):
        event["extra"] = _scrub(event["extra"])
    request_id = request_id_var.get()
    if request_id:
        event.setdefault("tags", {})["request_id"] = request_id
    return event


def init_error_tracking(component: str) -> bool:
    """Start Sentry for `component` ("web", "worker", "beat"). Returns False when it is off."""
    if not settings.SENTRY_DSN:
        return False
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.APP_ENVIRONMENT,
        release=settings.APP_VERSION or None,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        send_default_pii=False,
        max_request_body_size="never",
        before_send=_before_send,
        integrations=[
            StarletteIntegration(),
            FastApiIntegration(),
            CeleryIntegration(monitor_beat_tasks=False),
            SqlalchemyIntegration(),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
    )
    sentry_sdk.set_tag("component", component)
    return True


class RequestContextMiddleware:
    """Pure ASGI, so it costs nothing on streaming responses. Outermost in the stack."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = None
        for name, value in scope.get("headers") or ():
            if name == b"x-request-id":
                incoming = value.decode("latin-1")
                break
        request_id = incoming if incoming and _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        token = request_id_var.set(request_id)
        scope.setdefault("state", {})["request_id"] = request_id
        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_with_request_id(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = list(message.get("headers") or [])
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            path = scope.get("path", "")
            if path not in _QUIET_PATHS:
                state = scope.get("state") or {}
                logger.info(
                    "%s %s %s",
                    scope.get("method"),
                    path,
                    status_holder["status"],
                    extra={
                        "http_method": scope.get("method"),
                        "http_path": path,
                        "http_status": status_holder["status"],
                        "duration_ms": round((time.perf_counter() - started) * 1000, 1),
                        "tenant_id": getattr(state.get("tenant"), "id", None),
                    },
                )
            request_id_var.reset(token)
