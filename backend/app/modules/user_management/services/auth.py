import urllib.parse
import requests
import uuid
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import HTTPException, Request, status
from jose import jwt, JWTError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.passwords import hash_password, verify_password, validate_password_strength
from app.core.tenancy import (
    get_frontend_origin_for_request,
    get_google_redirect_uri_for_request,
)
from app.modules.user_management.models import (
    Module,
    RefreshToken,
    Tenant,
    Team,
    TeamModulePermission,
    User,
    UserAuthMode,
    UserSetupToken,
    UserStatus,
)
from app.core.access_control import ADMIN_MIN_ROLE_LEVEL, get_user_role_level

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

SCOPES = "openid email profile"


# -------------------------------------------------------------------
# GOOGLE OAUTH
# -------------------------------------------------------------------

def _create_oauth_state(*, tenant: Tenant, frontend_origin: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "google_oauth_state",
        "tenant_id": tenant.id,
        "frontend_origin": frontend_origin.rstrip("/"),
        "iat": now,
        "exp": now + timedelta(minutes=settings.GOOGLE_OAUTH_STATE_EXPIRE_MINUTES),
    }
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


def get_google_auth_url(*, request: Request, tenant: Tenant) -> str:
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


def _hash_setup_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# -------------------------------------------------------------------
# TOKEN CREATION
# -------------------------------------------------------------------

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

def handle_google_callback(
    code: str,
    db: Session,
    *,
    tenant: Tenant,
    request: Request,
):
    # 1) Exchange code for Google token
    token_res = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": get_google_redirect_uri_for_request(request),
            "grant_type": "authorization_code",
        },
    )

    token_json = token_res.json()
    if "access_token" not in token_json:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to authenticate with Google",
        )

    # 2) Fetch Google profile
    profile_res = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {token_json['access_token']}"},
    )

    profile = profile_res.json()
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
    user = (
        db.query(User)
        .filter(
            User.tenant_id == tenant.id,
            func.lower(User.email) == email.strip().lower(),
        )
        .first()
    )

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
        db.commit()

    return {
        "status": "active",
        "user": user,
    }


def create_user_setup_link(
    db: Session,
    user: User,
    *,
    frontend_origin: str | None = None,
) -> str:
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
    db.commit()

    token_query = urllib.parse.urlencode({"token": raw_token})
    base_origin = (frontend_origin or settings.FRONTEND_ORIGIN).rstrip("/")
    return f"{base_origin}/auth/setup-password?{token_query}"


def set_initial_password(db: Session, *, token: str, password: str) -> User:
    validate_password_strength(password)

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

    expires_at = db_token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

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
                    "setup_link": (
                        create_user_setup_link(
                            db,
                            user,
                            frontend_origin=frontend_origin,
                        )
                        if user.auth_mode in {UserAuthMode.manual_only, UserAuthMode.manual_or_google}
                        else None
                    ),
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

    return user


# -------------------------------------------------------------------
# MODULE ACCESS 
# -------------------------------------------------------------------

def get_team_modules(team_id: int | None, db: Session) -> list[Module]:
    if not team_id:
        return []

    return (
        db.query(Module)
        .join(TeamModulePermission, TeamModulePermission.module_id == Module.id)
        .filter(TeamModulePermission.team_id == team_id)
        .filter(Module.is_enabled == 1)
        .order_by(Module.name.asc())
        .all()
    )


def get_user_accessible_modules(user: User, db: Session) -> list[Module]:
    role_level = get_user_role_level(db, user)
    if role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL:
        return (
            db.query(Module)
            .filter(Module.is_enabled == 1)
            .order_by(Module.name.asc())
            .all()
        )

    if user.team_id:
        team_modules = get_team_modules(user.team_id, db)
        if team_modules:
            return team_modules

        department_id = (
            db.query(Team.department_id)
            .filter(Team.id == user.team_id)
            .scalar()
        )
        if department_id:
            from app.modules.user_management.models import DepartmentModulePermission

            return (
                db.query(Module)
                .join(DepartmentModulePermission, DepartmentModulePermission.module_id == Module.id)
                .filter(DepartmentModulePermission.department_id == department_id)
                .filter(Module.is_enabled == 1)
                .order_by(Module.name.asc())
                .all()
            )

    return []
