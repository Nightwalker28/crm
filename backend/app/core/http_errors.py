"""One error shape for every API response, and the API's security headers (13 F0.7 B2, F0.8 F4).

Every error body is `{"detail": ..., "request_id": "..."}`. `detail` keeps the shape FastAPI
already returned (a string, a dict such as `{"code": ..., "message": ...}`, or the validation
list), so existing clients keep working; `request_id` matches the `X-Request-ID` header and the
logs. An unexpected exception is logged with its traceback (and so reaches the error tracker)
and answers 500 with a generic message: internals never reach the client.
"""

from __future__ import annotations

import json
import logging

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import settings
from app.core.observability import current_request_id

logger = logging.getLogger("app.errors")

INTERNAL_ERROR_DETAIL = "Something went wrong on our side. Try again; if it keeps happening, quote the request id."


def _with_request_id(response: JSONResponse) -> JSONResponse:
    request_id = current_request_id()
    if not request_id:
        return response
    try:
        body = json.loads(response.body)
    except ValueError:
        return response
    if isinstance(body, dict):
        body["request_id"] = request_id
        headers = {key: value for key, value in response.headers.items() if key.lower() not in {"content-length", "content-type"}}
        return JSONResponse(status_code=response.status_code, content=body, headers=headers)
    return response


async def _http_exception(request: Request, exc: StarletteHTTPException):
    return _with_request_id(await http_exception_handler(request, exc))


async def _validation_exception(request: Request, exc: RequestValidationError):
    return _with_request_id(await request_validation_exception_handler(request, exc))


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_exception)
    app.add_exception_handler(RequestValidationError, _validation_exception)


def internal_error_response() -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content={"detail": INTERNAL_ERROR_DETAIL, "request_id": current_request_id()},
    )


class ErrorBoundaryMiddleware:
    """Turns an unhandled exception into the 500 shape.

    It sits inside CORS, so the browser can read the 500 instead of reporting a CORS failure,
    which is what Starlette's outermost error handler gives. An exception after the response
    has started (a broken stream) can only be logged.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception:
            logger.exception("Unhandled error on %s %s", scope.get("method"), scope.get("path"))
            if started:
                raise
            await internal_error_response()(scope, receive, send)


_STATIC_SECURITY_HEADERS = (
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"x-frame-options", b"DENY"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=()"),
)
# The API serves JSON, files and media: nothing it returns should run script or be framed.
_JSON_CSP = b"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
_FILE_CSP = b"frame-ancestors 'none'; base-uri 'none'"
# No includeSubDomains: the operator's other subdomains are not ours to pin to HTTPS.
_HSTS = b"max-age=31536000"


class SecurityHeadersMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                present = {name.lower() for name, _ in headers}
                for name, value in _STATIC_SECURITY_HEADERS:
                    if name not in present:
                        headers.append((name, value))
                if b"content-security-policy" not in present:
                    content_type = next((value for name, value in headers if name.lower() == b"content-type"), b"")
                    headers.append((b"content-security-policy", _JSON_CSP if content_type.startswith(b"application/json") else _FILE_CSP))
                if settings.COOKIE_SECURE and b"strict-transport-security" not in present:
                    headers.append((b"strict-transport-security", _HSTS))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)
