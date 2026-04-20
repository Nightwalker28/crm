from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

from fastapi import HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.modules.user_management.models import Tenant, TenantDomain


@dataclass(slots=True)
class RequestTenantContext:
    id: int
    slug: str
    name: str
    is_active: bool


@lru_cache(maxsize=1)
def get_verified_deployment_license() -> dict | None:
    token = (settings.DEPLOYMENT_LICENSE or "").strip()
    public_key = (settings.DEPLOYMENT_LICENSE_PUBLIC_KEY or "").strip()
    if not token or not public_key:
        return None

    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=[settings.DEPLOYMENT_LICENSE_ALGORITHM],
        )
    except JWTError:
        return None

    if payload.get("deployment_mode") != "cloud":
        return None

    return payload


def is_cloud_mode_enabled() -> bool:
    return get_verified_deployment_license() is not None


def normalize_hostname(host: str | None) -> str | None:
    if not host:
        return None
    normalized = host.strip().lower()
    if not normalized:
        return None
    if normalized.startswith("http://") or normalized.startswith("https://"):
        normalized = normalized.split("://", 1)[1]
    if "/" in normalized:
        normalized = normalized.split("/", 1)[0]
    if ":" in normalized:
        normalized = normalized.split(":", 1)[0]
    return normalized or None


def get_request_scheme(request: Request) -> str:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip()
    return request.url.scheme or "http"


def get_request_origin(request: Request) -> str:
    origin = request.headers.get("origin")
    if origin:
        return origin.rstrip("/")
    host = request.headers.get("host")
    if not host:
        return settings.FRONTEND_ORIGIN.rstrip("/")
    return f"{get_request_scheme(request)}://{host}".rstrip("/")


def get_frontend_origin_for_request(request: Request) -> str:
    if is_cloud_mode_enabled():
        return get_request_origin(request)
    return settings.FRONTEND_ORIGIN.rstrip("/")


def get_google_redirect_uri_for_request(request: Request) -> str:
    redirect_uri = (settings.GOOGLE_REDIRECT_URI or "").strip()
    if not redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google redirect URI is not configured",
        )
    if "{host}" in redirect_uri or "{scheme}" in redirect_uri:
        return redirect_uri.format(
            host=request.headers.get("host", ""),
            scheme=get_request_scheme(request),
        )
    return redirect_uri


def get_or_create_single_tenant(db: Session) -> Tenant:
    tenant = (
        db.query(Tenant)
        .filter(Tenant.slug == settings.SINGLE_TENANT_SLUG)
        .first()
    )
    if tenant:
        return tenant

    tenant = Tenant(
        slug=settings.SINGLE_TENANT_SLUG,
        name=settings.SINGLE_TENANT_NAME,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


def to_request_tenant_context(tenant: Tenant) -> RequestTenantContext:
    return RequestTenantContext(
        id=int(tenant.id),
        slug=str(tenant.slug),
        name=str(tenant.name),
        is_active=bool(tenant.is_active),
    )


def resolve_request_tenant(db: Session, request: Request) -> Tenant:
    if not is_cloud_mode_enabled():
        return get_or_create_single_tenant(db)

    hostname = normalize_hostname(request.headers.get("host"))
    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request host is missing",
        )

    tenant_domain = (
        db.query(TenantDomain)
        .options(joinedload(TenantDomain.tenant))
        .filter(TenantDomain.hostname == hostname)
        .first()
    )
    if not tenant_domain or not tenant_domain.tenant or not tenant_domain.tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant could not be resolved for this host",
        )
    return tenant_domain.tenant
