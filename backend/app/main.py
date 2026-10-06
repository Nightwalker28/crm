import asyncio
import contextlib
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import router as v1_router
from app.core.background_health import readiness, watchdog_loop
from app.core.cache import warn_if_local_cache_multi_worker
from app.core.config import settings, validate_startup_settings
from app.core.database import SessionLocal
from app.core.http_errors import ErrorBoundaryMiddleware, SecurityHeadersMiddleware, register_exception_handlers
from app.core.observability import RequestContextMiddleware, configure_logging, current_request_id, init_error_tracking
from app.core.tenancy import is_cloud_mode_enabled, resolve_request_tenant_context_cached
from app.core.uploads import UPLOADS_DIR

# At import, so an error during startup is reported too. Off unless SENTRY_DSN is set.
init_error_tracking("web")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Here rather than at import: the server's processes get JSON logs, tests keep theirs quiet.
    configure_logging()
    validate_startup_settings()
    warn_if_local_cache_multi_worker()
    watchdog = asyncio.create_task(watchdog_loop()) if settings.BACKGROUND_WATCHDOG_ENABLED else None
    try:
        yield
    finally:
        if watchdog is not None:
            watchdog.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await watchdog


app = FastAPI(title="Lynk", lifespan=lifespan)
register_exception_handlers(app)

_UNSCOPED_PATHS = frozenset({"/health", "/health/ready", "/media"})


@app.get("/health")
def health_check():
    """Liveness: the process answers. Container healthchecks use this one."""
    return {"status": "ok"}


@app.get("/health/ready")
def readiness_check():
    """Readiness: PostgreSQL, Redis, the broker, Celery beat and the worker. 503 when one is down."""
    ready, body = readiness()
    return JSONResponse(status_code=200 if ready else 503, content=body)

# -------------------------
# Middleware, innermost first: each add wraps the ones before it. A request passes
# RequestContext (request id, access log) → CORS → security headers → session cookies →
# tenant → error boundary → the route. CORS wraps everything, so even a tenant or 500
# error reaches the browser readable instead of as a CORS failure.
# -------------------------
app.add_middleware(ErrorBoundaryMiddleware)


@app.middleware("http")
async def attach_tenant_context(request: Request, call_next):
    path = request.url.path
    if path in _UNSCOPED_PATHS or path.startswith("/media/") or path.startswith("/api/v1/integrations/public"):
        request.state.cloud_mode = is_cloud_mode_enabled()
        request.state.tenant = None
        return await call_next(request)

    db = SessionLocal()
    try:
        request.state.cloud_mode = is_cloud_mode_enabled()
        request.state.tenant = resolve_request_tenant_context_cached(db, request)
    except Exception as exc:
        status_code = getattr(exc, "status_code", 500)
        detail = getattr(exc, "detail", "Failed to resolve tenant")
        return JSONResponse(status_code=status_code, content={"detail": detail, "request_id": current_request_id()})
    finally:
        db.close()

    return await call_next(request)

# Attaches a refreshed access token cookie if needed.
@app.middleware("http")
async def attach_access_token_cookie(request: Request, call_next):
    response = await call_next(request)

    new_access_token = getattr(request.state, "_new_access_token", None)
    if new_access_token:
        response.set_cookie(
            key=settings.ACCESS_TOKEN_COOKIE_NAME,
            value=new_access_token,
            httponly=settings.COOKIE_HTTPONLY,
            secure=settings.COOKIE_SECURE,
            samesite=settings.COOKIE_SAMESITE,
            path=settings.COOKIE_PATH,
            max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        )
    new_refresh_token = getattr(request.state, "_new_refresh_token", None)
    if new_refresh_token:
        response.set_cookie(
            key=settings.REFRESH_TOKEN_COOKIE_NAME,
            value=new_refresh_token,
            httponly=settings.COOKIE_HTTPONLY,
            secure=settings.COOKIE_SECURE,
            samesite=settings.COOKIE_SAMESITE,
            path=settings.COOKIE_PATH,
            max_age=settings.REFRESH_TOKEN_EXPIRE_HOURS * 60 * 60,
        )

    return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.FRONTEND_CORS_ORIGINS,
    allow_origin_regex=None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-Request-ID"],
)
app.add_middleware(RequestContextMiddleware)

# -------------------------
# Routes
# -------------------------
app.include_router(v1_router)
app.mount("/media", StaticFiles(directory=str(UPLOADS_DIR / "media")), name="media")
