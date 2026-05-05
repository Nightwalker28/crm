from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone

from app.core.access_control import (
    ADMIN_MIN_ROLE_LEVEL,
    SUPERUSER_MIN_ROLE_LEVEL,
    USER_MIN_ROLE_LEVEL,
    require_minimum_role_level,
)
from app.core.cache import cache_delete, cache_get_json, cache_set_json
from app.core.config import settings
from app.core.database import get_db
from app.core.tenancy import is_cloud_mode_enabled
from app.modules.user_management.models import User, UserStatus, RefreshToken
from app.modules.user_management.services.auth import decode_token, create_access_token, rotate_refresh_token

REFRESH_RATE_LIMIT_PREFIX = "auth:refresh_failed"


def _refresh_attempt_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for") if hasattr(request, "headers") else None
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or "unknown"
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or "unknown"


def _refresh_attempt_keys(request: Request, user_id: int | str | None = None) -> list[str]:
    tenant = getattr(getattr(request, "state", None), "tenant", None)
    tenant_id = getattr(tenant, "id", "global")
    keys = [f"{REFRESH_RATE_LIMIT_PREFIX}:tenant:{tenant_id}:ip:{_refresh_attempt_ip(request)}"]
    if user_id is not None:
        keys.append(f"{REFRESH_RATE_LIMIT_PREFIX}:tenant:{tenant_id}:user:{user_id}")
    return keys


def check_refresh_token_rate_limit(request: Request, user_id: int | str | None = None) -> None:
    for key in _refresh_attempt_keys(request, user_id):
        payload = cache_get_json(key) or {}
        if int(payload.get("count") or 0) >= settings.REFRESH_TOKEN_FAILED_ATTEMPT_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed refresh attempts",
            )


def record_failed_refresh_attempt(request: Request, user_id: int | str | None = None) -> None:
    for key in _refresh_attempt_keys(request, user_id):
        payload = cache_get_json(key) or {}
        count = int(payload.get("count") or 0) + 1
        cache_set_json(
            key,
            {"count": count},
            ttl_seconds=settings.REFRESH_TOKEN_FAILED_ATTEMPT_WINDOW_SECONDS,
        )


def clear_failed_refresh_attempts(request: Request, user_id: int | str | None = None) -> None:
    for key in _refresh_attempt_keys(request, user_id):
        cache_delete(key)


def _validate_request_tenant(request: Request, payload: dict) -> int:
    user_id = int(payload.get("sub"))
    request_tenant = getattr(request.state, "tenant", None)
    token_tenant_id = payload.get("tenant_id")

    if is_cloud_mode_enabled():
        if not request_tenant or token_tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Tenant context missing",
            )
        if int(token_tenant_id) != int(request_tenant.id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session tenant mismatch",
            )

    return user_id


def _revoke_refresh_token(db: Session, refresh_token_id: int) -> None:
    db.query(RefreshToken).filter(RefreshToken.id == refresh_token_id).delete()
    db.commit()


def _attach_access_token_claims(user: User, payload: dict) -> User:
    role_level = payload.get("role_level")
    if role_level is not None:
        try:
            user._token_role_level = int(role_level)
        except (TypeError, ValueError):
            pass
    return user


def _load_user_with_team(db: Session, user_id: int) -> User | None:
    return (
        db.query(User)
        .options(joinedload(User.team), joinedload(User.role))
        .filter(User.id == user_id)
        .first()
    )


def _attach_department_context(user: User) -> User:
    if getattr(user, "department_id", None) is not None:
        user._department_id_loaded = True
        user._department_id = user.department_id
        return user
    team = getattr(user, "team", None)
    user._department_id_loaded = True
    user._department_id = getattr(team, "department_id", None) if team else None
    return user


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    cached_user = getattr(request.state, "_current_user", None)
    if cached_user is not None:
        return cached_user

    access_token = request.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)

    # No session at all
    if not access_token and not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    # 1. Try access token
    if access_token:
        try:
            payload = decode_token(access_token, expected_type="access")
            user_id = _validate_request_tenant(request, payload)
        except HTTPException:
            payload = None

        if payload:
            user = _load_user_with_team(db, user_id)
            if not user or user.is_active != UserStatus.active:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Inactive or missing user",
                )
            request_tenant = getattr(request.state, "tenant", None)
            if request_tenant and user.tenant_id != request_tenant.id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session tenant mismatch",
                )
            request.state._current_user = _attach_department_context(
                _attach_access_token_claims(user, payload)
            )
            return request.state._current_user

    # 2. Access token missing or expired → try refresh
    if refresh_token:
        try:
            payload = decode_token(refresh_token, expected_type="refresh")
            user_id = _validate_request_tenant(request, payload)
            jti = payload.get("jti")
        except HTTPException:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired",
            )

        if not jti:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired",
            )

        # Validate refresh token session in DB (revocation + expiry)
        now = datetime.now(timezone.utc)
        db_token = (
            db.query(RefreshToken)
            .filter(
                RefreshToken.user_id == user_id,
                RefreshToken.token_jti == jti,
                RefreshToken.expires_at > now,
            )
            .first()
        )

        if not db_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired",
            )

        user = _load_user_with_team(db, user_id)
        if not user or user.is_active != UserStatus.active:
            _revoke_refresh_token(db, db_token.id)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Inactive account" if user else "Inactive or missing user",
            )
        request_tenant = getattr(request.state, "tenant", None)
        if request_tenant and user.tenant_id != request_tenant.id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session tenant mismatch",
            )

        new_access_token = create_access_token(user)
        decoded_new_access_token = decode_token(new_access_token, expected_type="access")
        _attach_access_token_claims(user, decoded_new_access_token)
        new_refresh_token = rotate_refresh_token(user, db, old_refresh_token_id=db_token.id)

        # Attach cookies to response (middleware in main.py will set them)
        request.state._new_access_token = new_access_token
        request.state._new_refresh_token = new_refresh_token

        request.state._current_user = _attach_department_context(user)

        return request.state._current_user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session expired",
    )

def require_admin(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        require_minimum_role_level(
            db,
            user=current_user,
            minimum_level=ADMIN_MIN_ROLE_LEVEL,
        )
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Admin privileges required")
    return current_user

def require_superuser(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        require_minimum_role_level(
            db,
            user=current_user,
            minimum_level=SUPERUSER_MIN_ROLE_LEVEL,
        )
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Superuser privileges required")
    return current_user


def require_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        require_minimum_role_level(
            db,
            user=current_user,
            minimum_level=USER_MIN_ROLE_LEVEL,
        )
    except PermissionError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="User privileges required")
    return current_user
