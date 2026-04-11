from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import router as v1_router
from app.core.config import settings

app = FastAPI(title="Lynk")

# -------------------------
# CORS
# -------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],  # must be a list
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
