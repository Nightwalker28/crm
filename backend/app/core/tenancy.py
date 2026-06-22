from __future__ import annotations

from dataclasses import dataclass
import time

from fastapi import HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session, joinedload

from app.core.cache import cache_delete, cache_delete_prefix, cache_get_json, cache_set_json
from app.core.config import settings
from app.modules.user_management.models import Tenant, TenantDomain


@dataclass(slots=True)
class RequestTenantContext:
    id: int
    slug: str
    name: str
    is_active: bool


_license_cache: tuple[float, dict | None] | None = None
TENANT_CONTEXT_CACHE_TTL_SECONDS = 60
TENANT_CONTEXT_CACHE_PREFIX = "tenant-context:"


def _clear_verified_deployment_license_cache() -> None:
    global _license_cache
    _license_cache = None


def get_verified_deployment_license() -> dict | None:
    """Return the verified deployment license, refreshing the process cache by TTL."""
    global _license_cache
    now = time.monotonic()
    if _license_cache is not None:
        verified_at, cached_payload = _license_cache
        if now - verified_at < settings.DEPLOYMENT_LICENSE_CACHE_TTL_SECONDS:
            return cached_payload

    token = (settings.DEPLOYMENT_LICENSE or "").strip()
    public_key = (settings.DEPLOYMENT_LICENSE_PUBLIC_KEY or "").strip()
    if not token or not public_key:
        _license_cache = (now, None)
        return None

    try:
        payload = jwt.decode(
            token,
            public_key,
            algorithms=[settings.DEPLOYMENT_LICENSE_ALGORITHM],
        )
    except JWTError:
        _license_cache = (now, None)
        return None

    if payload.get("deployment_mode") != "cloud":
        _license_cache = (now, None)
        return None

    _license_cache = (now, payload)
    return payload


get_verified_deployment_license.cache_clear = _clear_verified_deployment_license_cache


def is_cloud_mode_enabled() -> bool:
    return get_verified_deployment_license() is not None


def is_auth_tenant_resolution_enabled() -> bool:
    return settings.TENANT_RESOLUTION_MODE == "auth"


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
    frontend_origin = request.headers.get("x-lynk-frontend-origin")
    if frontend_origin:
        return frontend_origin.rstrip("/")
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


def get_microsoft_redirect_uri_for_request(request: Request) -> str:
    redirect_uri = (settings.MICROSOFT_REDIRECT_URI or "").strip()
    if not redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Microsoft redirect URI is not configured",
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


def _tenant_context_cache_key(hostname: str) -> str:
    return f"{TENANT_CONTEXT_CACHE_PREFIX}{hostname}"


def _serialize_request_tenant_context(context: RequestTenantContext | None) -> dict | None:
    if context is None:
        return None
    return {
        "id": context.id,
        "slug": context.slug,
        "name": context.name,
        "is_active": context.is_active,
    }


def _deserialize_request_tenant_context(payload: dict | None) -> RequestTenantContext | None:
    if not payload:
        return None
    return RequestTenantContext(
        id=int(payload["id"]),
        slug=str(payload["slug"]),
        name=str(payload["name"]),
        is_active=bool(payload["is_active"]),
    )


def invalidate_tenant_context_cache(hostname: str | None = None) -> None:
    normalized = normalize_hostname(hostname)
    if normalized:
        cache_delete(_tenant_context_cache_key(f"host:{normalized}"))
        return
    cache_delete_prefix(TENANT_CONTEXT_CACHE_PREFIX)


def resolve_request_tenant(db: Session, request: Request) -> Tenant | None:
    if not is_cloud_mode_enabled():
        return get_or_create_single_tenant(db)
    if is_auth_tenant_resolution_enabled():
        return None

    hostname = normalize_hostname(request.headers.get("host"))
    if not hostname:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Request host is missing",
        )

    tenant_domain = (
        db.query(TenantDomain)
        .options(joinedload(TenantDomain.tenant))
        .filter(TenantDomain.hostname == hostname, TenantDomain.status == "verified")
        .first()
    )
    if not tenant_domain or not tenant_domain.tenant or not tenant_domain.tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant could not be resolved for this host",
        )
    return tenant_domain.tenant


def resolve_request_tenant_context_cached(db: Session, request: Request) -> RequestTenantContext | None:
    if is_auth_tenant_resolution_enabled() and is_cloud_mode_enabled():
        return None

    hostname = normalize_hostname(request.headers.get("host")) or "single"
    cache_key = _tenant_context_cache_key("single" if not is_cloud_mode_enabled() else f"host:{hostname}")
    cached = cache_get_json(cache_key)
    if cached is not None:
        return _deserialize_request_tenant_context(cached)

    tenant = resolve_request_tenant(db, request)
    context = to_request_tenant_context(tenant) if tenant else None
    cache_set_json(
        cache_key,
        _serialize_request_tenant_context(context),
        ttl_seconds=TENANT_CONTEXT_CACHE_TTL_SECONDS,
    )
    return context
