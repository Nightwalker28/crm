from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1.router import router as v1_router
from app.core.config import settings, validate_startup_settings
from app.core.database import SessionLocal
from app.core.tenancy import is_cloud_mode_enabled, resolve_request_tenant, to_request_tenant_context
from app.core.uploads import UPLOADS_DIR

app = FastAPI(title="Lynk")


@app.on_event("startup")
def validate_runtime_configuration():
    validate_startup_settings()

# -------------------------
# CORS
# -------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[] if is_cloud_mode_enabled() else [settings.FRONTEND_ORIGIN],
    allow_origin_regex=r"https?://.*" if is_cloud_mode_enabled() else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def attach_tenant_context(request: Request, call_next):
    db = SessionLocal()
    try:
        request.state.cloud_mode = is_cloud_mode_enabled()
        request.state.tenant = to_request_tenant_context(resolve_request_tenant(db, request))
    except Exception as exc:
        status_code = getattr(exc, "status_code", 500)
        detail = getattr(exc, "detail", "Failed to resolve tenant")
        return JSONResponse(status_code=status_code, content={"detail": detail})
    finally:
        db.close()

    return await call_next(request)

# -------------------------
# Auth middleware
# Attaches refreshed access token cookie if needed
# -------------------------
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

    return response


# -------------------------
# Routes
# -------------------------
app.include_router(v1_router)
app.mount("/media", StaticFiles(directory=str(UPLOADS_DIR / "media")), name="media")
