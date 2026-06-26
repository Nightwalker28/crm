import urllib.parse
import requests
import uuid
import hashlib
import secrets
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import HTTPException, Request, status
from jose import jwt, JWTError
from jose.exceptions import ExpiredSignatureError
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.cache import cache_delete, cache_get_json, cache_set_json
from app.core.config import settings
from app.core.microsoft_oauth import MICROSOFT_GRAPH_BASE, microsoft_auth_url, microsoft_scope_string, microsoft_token_url
from app.core.passwords import (
    hash_password,
    password_hash_needs_upgrade,
    validate_password_strength,
    verify_password,
)
from app.core.tenancy import (
    get_frontend_origin_for_request,
    get_google_redirect_uri_for_request,
    get_microsoft_redirect_uri_for_request,
    is_auth_tenant_resolution_enabled,
    is_cloud_mode_enabled,
)
from app.modules.user_management.models import (
    Module,
    RefreshToken,
    Tenant,
    TenantModuleConfig,
    RoleModulePermission,
    User,
    UserAuthMode,
    UserSetupToken,
    UserStatus,
)
from app.core.access_control import ADMIN_MIN_ROLE_LEVEL, get_user_role_level, user_has_module_assignment
from app.modules.user_management.services.admin_modules import build_module_schema, is_module_enabled_for_tenant, _custom_tab_labels

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_AUTH_REQUEST_TIMEOUT_SECONDS = 20
logger = logging.getLogger(__name__)
MANUAL_LOGIN_RATE_LIMIT_PREFIX = "auth:manual_login_failed"

SCOPES = " ".join(
    [
        "openid",
        "email",
        "profile",
    ]
)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# -------------------------------------------------------------------
# GOOGLE OAUTH
# -------------------------------------------------------------------

def _create_oauth_state(*, tenant: Tenant | None, frontend_origin: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "google_oauth_state",
        "frontend_origin": frontend_origin.rstrip("/"),
        "iat": now,
        "exp": now + timedelta(minutes=settings.GOOGLE_OAUTH_STATE_EXPIRE_MINUTES),
    }
    if tenant:
        payload["tenant_id"] = tenant.id
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_oauth_state(state_token: str | None) -> dict | None:
    if not state_token:
        return None
    try:
        payload = jwt.decode(
            state_token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        return None

    if payload.get("type") != "google_oauth_state":
        return None
    return payload


def _create_microsoft_oauth_state(*, tenant: Tenant | None, frontend_origin: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "microsoft_oauth_state",
        "frontend_origin": frontend_origin.rstrip("/"),
        "iat": now,
        "exp": now + timedelta(minutes=settings.GOOGLE_OAUTH_STATE_EXPIRE_MINUTES),
    }
    if tenant:
        payload["tenant_id"] = tenant.id
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_microsoft_oauth_state(state_token: str | None) -> dict | None:
    if not state_token:
        return None
    try:
        payload = jwt.decode(state_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    return payload if payload.get("type") == "microsoft_oauth_state" else None


def _profile_from_google_id_token(id_token: str | None) -> dict | None:
    if not id_token:
        return None
    try:
        claims = jwt.get_unverified_claims(id_token)
    except JWTError:
        return None
    return {
        "email": claims.get("email"),
        "picture": claims.get("picture"),
        "given_name": claims.get("given_name"),
        "family_name": claims.get("family_name"),
    }


def get_google_auth_url(*, request: Request, tenant: Tenant | None) -> str:
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": get_google_redirect_uri_for_request(request),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
        "state": _create_oauth_state(
            tenant=tenant,
            frontend_origin=get_frontend_origin_for_request(request),
        ),
    }
    return GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)


def get_microsoft_auth_url(*, request: Request, tenant: Tenant | None) -> str:
    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Microsoft sign-in is not configured.")
    params = {
        "client_id": settings.MICROSOFT_CLIENT_ID,
        "redirect_uri": get_microsoft_redirect_uri_for_request(request),
        "response_type": "code",
        "response_mode": "query",
        "scope": microsoft_scope_string(include_configured=True),
        "state": _create_microsoft_oauth_state(
            tenant=tenant,
            frontend_origin=get_frontend_origin_for_request(request),
        ),
    }
    return microsoft_auth_url() + "?" + urllib.parse.urlencode(params)


def _hash_setup_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _manual_login_attempt_keys(*, tenant_id: int, email: str, client_host: str | None) -> list[str]:
    normalized_email = email.strip().lower()
    email_hash = hashlib.sha256(normalized_email.encode("utf-8")).hexdigest()
    keys = [f"{MANUAL_LOGIN_RATE_LIMIT_PREFIX}:tenant:{tenant_id}:email:{email_hash}"]
    if client_host:
        host_hash = hashlib.sha256(client_host.strip().lower().encode("utf-8")).hexdigest()
        keys.append(f"{MANUAL_LOGIN_RATE_LIMIT_PREFIX}:tenant:{tenant_id}:ip:{host_hash}")
    return keys


def check_manual_login_rate_limit(*, tenant_id: int, email: str, client_host: str | None = None) -> None:
    for key in _manual_login_attempt_keys(tenant_id=tenant_id, email=email, client_host=client_host):
        payload = cache_get_json(key) or {}
        if int(payload.get("count") or 0) >= settings.MANUAL_LOGIN_FAILED_ATTEMPT_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many failed login attempts",
            )


def record_failed_manual_login_attempt(*, tenant_id: int, email: str, client_host: str | None = None) -> None:
    for key in _manual_login_attempt_keys(tenant_id=tenant_id, email=email, client_host=client_host):
        payload = cache_get_json(key) or {}
        count = int(payload.get("count") or 0) + 1
        cache_set_json(
            key,
            {"count": count},
            ttl_seconds=settings.MANUAL_LOGIN_FAILED_ATTEMPT_WINDOW_SECONDS,
        )


def clear_failed_manual_login_attempts(*, tenant_id: int, email: str, client_host: str | None = None) -> None:
    for key in _manual_login_attempt_keys(tenant_id=tenant_id, email=email, client_host=client_host):
        cache_delete(key)


# -------------------------------------------------------------------
# TOKEN CREATION
# -------------------------------------------------------------------

def _role_level_claim_for_user(user: User) -> int | None:
    role = getattr(user, "role", None)
    level = getattr(role, "level", None) if role else None
    if level is None:
        raise ValueError("Cannot issue access token without role_level claim")
    return int(level)


def _create_token(
    *,
    user: User,
    token_type: Literal["access", "refresh"],
    expires_delta: timedelta,
) -> str:
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(user.id),
        "tenant_id": user.tenant_id,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    if token_type == "access":
        payload["role_level"] = _role_level_claim_for_user(user)

    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_access_token(user: User) -> str:
    return _create_token(
        user=user,
        token_type="access",
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def create_refresh_token(user: User, db: Session) -> str:
    jti = uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.REFRESH_TOKEN_EXPIRE_HOURS
    )

    db_token = RefreshToken(
        user_id=user.id,
        token_jti=jti,
        expires_at=expires_at,
    )
    db.add(db_token)
    db.commit()

    payload = {
        "sub": str(user.id),
        "tenant_id": user.tenant_id,
        "type": "refresh",
        "jti": jti,
        "exp": expires_at,
    }

    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def rotate_refresh_token(user: User, db: Session, *, old_refresh_token_id: int) -> str:
    deleted = db.query(RefreshToken).filter(
        RefreshToken.id == old_refresh_token_id,
        RefreshToken.user_id == user.id,
    ).delete()
    if deleted != 1:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")

    jti = uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.REFRESH_TOKEN_EXPIRE_HOURS
    )
    db.add(
        RefreshToken(
            user_id=user.id,
            token_jti=jti,
            expires_at=expires_at,
        )
    )
    db.commit()

    payload = {
        "sub": str(user.id),
        "tenant_id": user.tenant_id,
        "type": "refresh",
        "jti": jti,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


# -------------------------------------------------------------------
# TOKEN VALIDATION
# -------------------------------------------------------------------

def decode_token(token: str, expected_type: Literal["access", "refresh"]) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    if payload.get("type") != expected_type:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    return payload


# -------------------------------------------------------------------
# GOOGLE CALLBACK LOGIC (unchanged behavior, cleaner structure)
# -------------------------------------------------------------------

def _find_google_login_user(db: Session, *, tenant: Tenant | None, email: str) -> User | None:
    normalized_email = email.strip().lower()
    query = db.query(User).filter(func.lower(User.email) == normalized_email)

    if tenant:
        return query.filter(User.tenant_id == tenant.id).first()

    if not (is_cloud_mode_enabled() and is_auth_tenant_resolution_enabled()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")

    users = (
        query.join(Tenant, Tenant.id == User.tenant_id)
        .filter(Tenant.is_active == 1)
        .limit(2)
        .all()
    )
    if len(users) > 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This Google account matches multiple tenants",
        )
    return users[0] if users else None


def _find_microsoft_login_user(db: Session, *, tenant: Tenant | None, email: str) -> User | None:
    try:
        return _find_google_login_user(db, tenant=tenant, email=email)
    except HTTPException as exc:
        if exc.detail == "This Google account matches multiple tenants":
            raise HTTPException(status_code=exc.status_code, detail="This Microsoft account matches multiple tenants") from exc
        raise


def handle_google_callback(
    code: str,
    db: Session,
    *,
    tenant: Tenant | None,
    request: Request,
):
    # 1) Exchange code for Google token
    try:
        token_res = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": get_google_redirect_uri_for_request(request),
                "grant_type": "authorization_code",
            },
            timeout=GOOGLE_AUTH_REQUEST_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning("Google OAuth token exchange request failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to authenticate with Google",
        ) from exc

    try:
        token_json = token_res.json()
    except ValueError as exc:
        logger.warning("Google OAuth token exchange returned non-JSON response with status %s", token_res.status_code)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to authenticate with Google",
        ) from exc
    if not token_res.ok or "access_token" not in token_json:
        logger.warning(
            "Google OAuth token exchange failed with status %s and error %s",
            token_res.status_code,
            {
                "error": token_json.get("error"),
                "error_description": token_json.get("error_description"),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to authenticate with Google",
        )

    # 2) Read Google profile claims from the OIDC id_token returned by the token exchange.
    # This avoids a second userinfo network hop on the critical login callback path.
    profile = _profile_from_google_id_token(token_json.get("id_token"))
    if not profile:
        try:
            profile_res = requests.get(
                GOOGLE_USERINFO_URL,
                headers={"Authorization": f"Bearer {token_json['access_token']}"},
                timeout=GOOGLE_AUTH_REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            logger.warning("Google OAuth profile request failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to authenticate with Google",
            ) from exc

        try:
            profile = profile_res.json()
        except ValueError as exc:
            logger.warning("Google OAuth profile request returned non-JSON response with status %s", profile_res.status_code)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to authenticate with Google",
            ) from exc
        if not profile_res.ok:
            logger.warning(
                "Google OAuth profile request failed with status %s and error %s",
                profile_res.status_code,
                {
                    "error": profile.get("error"),
                    "error_description": profile.get("error_description"),
                },
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to authenticate with Google",
            )
    email = profile.get("email")
    picture = profile.get("picture")

    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email")

    # 3) Domain restriction
    domain = email.split("@")[-1].lower()
    if settings.ALLOWED_DOMAINS and domain not in settings.ALLOWED_DOMAINS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email domain not allowed",
        )

    first_name = profile.get("given_name")
    last_name = profile.get("family_name")

    # 4) Find or create user
    user = _find_google_login_user(db, tenant=tenant, email=email)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This Google account has not been provisioned",
        )

    if user.is_active == UserStatus.inactive:
        return {"status": "inactive"}

    if user.auth_mode == UserAuthMode.manual_only:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Google sign-in is not enabled for this account",
        )

    # 5) Active user
    if picture and user.photo_url != picture:
        user.photo_url = picture
    user.last_login_provider = "google"
    db.add(user)
    db.commit()

    return {
        "status": "active",
        "user": user,
    }


def handle_microsoft_callback(
    code: str,
    db: Session,
    *,
    tenant: Tenant | None,
    request: Request,
):
    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Microsoft sign-in is not configured.")
    try:
        token_res = requests.post(
            microsoft_token_url(),
            data={
                "code": code,
                "client_id": settings.MICROSOFT_CLIENT_ID,
                "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                "redirect_uri": get_microsoft_redirect_uri_for_request(request),
                "grant_type": "authorization_code",
                "scope": microsoft_scope_string(include_configured=True),
            },
            timeout=GOOGLE_AUTH_REQUEST_TIMEOUT_SECONDS,
        )
        token_json = token_res.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Microsoft OAuth token exchange failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to authenticate with Microsoft") from exc
    if not token_res.ok or "access_token" not in token_json:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to authenticate with Microsoft")

    try:
        profile_res = requests.get(
            f"{MICROSOFT_GRAPH_BASE}/me",
            headers={"Authorization": f"Bearer {token_json['access_token']}"},
            timeout=GOOGLE_AUTH_REQUEST_TIMEOUT_SECONDS,
        )
        profile = profile_res.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Microsoft Graph profile request failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to authenticate with Microsoft") from exc
    if not profile_res.ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to authenticate with Microsoft")

    email = profile.get("mail") or profile.get("userPrincipalName")
    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Microsoft account has no email")
    domain = email.split("@")[-1].lower()
    if settings.ALLOWED_DOMAINS and domain not in settings.ALLOWED_DOMAINS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email domain not allowed")

    user = _find_microsoft_login_user(db, tenant=tenant, email=email)
    if not user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This Microsoft account has not been provisioned")
    if user.is_active == UserStatus.inactive:
        return {"status": "inactive"}
    if user.auth_mode == UserAuthMode.manual_only:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Microsoft sign-in is not enabled for this account")

    user.last_login_provider = "microsoft"
    db.add(user)
    db.commit()
    scopes = set(token_json.get("scope", "").split())
    if "Calendars.ReadWrite" in scopes:
        from app.modules.calendar.services.calendar_services import upsert_microsoft_calendar_connection

        upsert_microsoft_calendar_connection(
            db,
            tenant_id=user.tenant_id,
            user=user,
            token_json=token_json,
            account_email=email,
        )
    return {"status": "active", "user": user}


def create_user_setup_link(
    db: Session,
    user: User,
    *,
    frontend_origin: str | None = None,
    commit: bool = True,
) -> str:
    _cleanup_stale_user_setup_tokens(db)

    raw_token = secrets.token_urlsafe(32)
    token_hash = _hash_setup_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(
        hours=settings.USER_SETUP_TOKEN_EXPIRE_HOURS
    )

    db.query(UserSetupToken).filter(
        UserSetupToken.user_id == user.id,
        UserSetupToken.consumed_at.is_(None),
    ).delete()

    db.add(
        UserSetupToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
    )
    if commit:
        db.commit()
    else:
        db.flush()

    token_query = urllib.parse.urlencode({"token": raw_token})
    base_origin = (frontend_origin or settings.FRONTEND_ORIGIN).rstrip("/")
    return f"{base_origin}/auth/setup-password?{token_query}"


def _cleanup_stale_user_setup_tokens(db: Session) -> None:
    retention_days = max(settings.USER_SETUP_TOKEN_RETENTION_DAYS, 1)
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)

    (
        db.query(UserSetupToken)
        .filter(
            or_(
                UserSetupToken.consumed_at < cutoff,
                UserSetupToken.expires_at < cutoff,
            )
        )
        .delete(synchronize_session=False)
    )


def set_initial_password(db: Session, *, token: str, password: str) -> User:
    try:
        validate_password_strength(password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    token_hash = _hash_setup_token(token)
    db_token = (
        db.query(UserSetupToken)
        .filter(
            UserSetupToken.token_hash == token_hash,
            UserSetupToken.consumed_at.is_(None),
        )
        .first()
    )

    if not db_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Setup link is invalid or has already been used",
        )

    expires_at = _as_utc(db_token.expires_at)

    if expires_at <= datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Setup link has expired",
        )

    user = db.query(User).filter(User.id == db_token.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )

    user.password_hash = hash_password(password)
    db_token.consumed_at = datetime.now(timezone.utc)
    db.add(user)
    db.add(db_token)
    db.commit()
    db.refresh(user)
    return user


def authenticate_manual_user(
    db: Session,
    *,
    tenant_id: int,
    email: str,
    password: str,
    frontend_origin: str | None = None,
) -> User:
    normalized_email = email.strip().lower()
    user = (
        db.query(User)
        .filter(
            User.tenant_id == tenant_id,
            User.email == normalized_email,
        )
        .first()
    )

    if not user or not verify_password(password, user.password_hash):
        if user and not user.password_hash:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "password_setup_required",
                    "message": "This account does not have a password set yet",
                },
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if user.is_active == UserStatus.inactive:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is inactive",
        )

    if user.auth_mode not in {UserAuthMode.manual_only, UserAuthMode.manual_or_google}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Manual sign-in is not enabled for this account",
        )

    if password_hash_needs_upgrade(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_provider = "manual"
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# -------------------------------------------------------------------
# MODULE ACCESS
# -------------------------------------------------------------------

def get_role_visible_modules(role_id: int | None, *, db: Session) -> list[Module]:
    if not role_id:
        return []

    return (
        db.query(Module)
        .join(RoleModulePermission, RoleModulePermission.module_id == Module.id)
        .filter(
            RoleModulePermission.role_id == role_id,
            RoleModulePermission.can_view == 1,
        )
        .order_by(Module.name.asc())
        .all()
    )


def get_user_accessible_modules(user: User, db: Session):
    configs = (
        db.query(TenantModuleConfig)
        .filter(TenantModuleConfig.tenant_id == user.tenant_id)
        .all()
    )
    config_map = {config.module_id: config for config in configs}
    custom_tab_labels = _custom_tab_labels(db, tenant_id=user.tenant_id)
    role_level = get_user_role_level(db, user)
    if role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL:
        modules = (
            db.query(Module)
            .order_by(Module.name.asc())
            .all()
        )
        return [
            build_module_schema(module, config_map.get(module.id), custom_tab_labels=custom_tab_labels)
            for module in modules
            if is_module_enabled_for_tenant(db, tenant_id=user.tenant_id, module=module)
        ]

    visible_modules = get_role_visible_modules(user.role_id, db=db)
    return [
        build_module_schema(module, config_map.get(module.id), custom_tab_labels=custom_tab_labels)
        for module in visible_modules
        if is_module_enabled_for_tenant(db, tenant_id=user.tenant_id, module=module)
        and user_has_module_assignment(db, user=user, module=module)
    ]
