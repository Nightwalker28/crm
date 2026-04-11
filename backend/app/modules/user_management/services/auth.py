import urllib.parse
import requests
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import HTTPException, status
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.passwords import hash_password, verify_password, validate_password_strength
from app.modules.user_management.models import (
    User,
    Module,
    DepartmentModulePermission,
    UserStatus, RefreshToken ,
    Team,
    RefreshToken
)
from app.modules.user_management.services.google_tokens import upsert_google_tokens

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"

SCOPES = "openid email profile https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive"


# -------------------------------------------------------------------
# GOOGLE OAUTH
# -------------------------------------------------------------------

def get_google_auth_url() -> str:
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
    }
    return GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)


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

def handle_google_callback(code: str, db: Session):
    # 1) Exchange code for Google token
    token_res = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
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
    user = db.query(User).filter(User.email == email).first()

    if not user:
        user = User(
            email=email,
            first_name=first_name,
            last_name=last_name,
            photo_url=picture,
            is_active=UserStatus.pending,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        upsert_google_tokens(
            db,
            user_id=user.id,
            access_token=token_json["access_token"],
            refresh_token=token_json.get("refresh_token"),
            expires_in=token_json.get("expires_in"),
            scope=token_json.get("scope"),
            token_type=token_json.get("token_type"),
        )
        return {"status": "pending"}

    upsert_google_tokens(
        db,
        user_id=user.id,
        access_token=token_json["access_token"],
        refresh_token=token_json.get("refresh_token"),
        expires_in=token_json.get("expires_in"),
        scope=token_json.get("scope"),
        token_type=token_json.get("token_type"),
    )

    if user.is_active == UserStatus.pending:
        return {"status": "pending"}

    if user.is_active == UserStatus.inactive:
        return {"status": "inactive"}

    # 5) Active user
    if picture and user.photo_url != picture:
        user.photo_url = picture
        db.commit()

    return {
        "status": "active",
        "user": user,
    }


def register_manual_user(
    db: Session,
    *,
    email: str,
    password: str,
    first_name: str | None = None,
    last_name: str | None = None,
):
    normalized_email = email.strip().lower()

    try:
        validate_password_strength(password)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    existing_user = db.query(User).filter(User.email == normalized_email).first()
    if existing_user:
        if existing_user.password_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This email is already registered with Google sign-in",
        )

    user = User(
        email=normalized_email,
        first_name=first_name.strip() if first_name else None,
        last_name=last_name.strip() if last_name else None,
        password_hash=hash_password(password),
        is_active=UserStatus.pending,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_manual_user(
    db: Session,
    *,
    email: str,
    password: str,
) -> User:
    normalized_email = email.strip().lower()
    user = db.query(User).filter(User.email == normalized_email).first()

    if not user or not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if user.is_active == UserStatus.pending:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is pending approval",
        )

    if user.is_active == UserStatus.inactive:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is inactive",
        )

    return user


# -------------------------------------------------------------------
# MODULE ACCESS 
# -------------------------------------------------------------------

def get_department_modules(department_id: int | None, db: Session) -> list[Module]:
    """Return the modules a given department is allowed to access."""
    if not department_id:
        return []

    return (
        db.query(Module)
        .join(DepartmentModulePermission, DepartmentModulePermission.module_id == Module.id)
        .filter(DepartmentModulePermission.department_id == department_id)
        .order_by(Module.name.asc())
        .all()
    )


def get_user_accessible_modules(user: User, db: Session) -> list[Module]:
    """Convenience wrapper that loads modules for a user's department."""
    department_id = None
    if user.team_id:
        department_id = (
            db.query(Team.department_id)
            .filter(Team.id == user.team_id)
            .scalar()
        )
    return get_department_modules(department_id, db)
