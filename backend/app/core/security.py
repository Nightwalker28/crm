from fastapi import Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.core.config import settings
from app.core.database import get_db
from app.modules.user_management.models import User, Role, UserStatus, RefreshToken
from app.modules.user_management.services.auth import decode_token, create_access_token

def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
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
            user_id = int(payload.get("sub"))
        except HTTPException:
            payload = None

        if payload:
            user = db.query(User).filter(User.id == user_id).first()
            if not user or user.is_active != UserStatus.active:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Inactive or missing user",
                )
            return user

    # 2. Access token missing or expired → try refresh
    if refresh_token:
        try:
            payload = decode_token(refresh_token, expected_type="refresh")
            user_id = int(payload.get("sub"))
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

        user = db.query(User).filter(User.id == user_id).first()
        if not user or user.is_active != UserStatus.active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Inactive or missing user",
            )

        # Issue new access token
        new_access_token = create_access_token(user)

        # Attach cookie to response (middleware in main.py will set it)
        request.state._new_access_token = new_access_token

        return user

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session expired",
    )

def require_admin(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Simple check: treat highest level as admin
    role: Role | None = db.query(Role).filter(Role.id == current_user.role_id).first()
    # Admins are level 100 and above
    if not role or role.level < 100:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Admin privileges required")
    return current_user

def require_superuser(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role: Role | None = db.query(Role).filter(Role.id == current_user.role_id).first()
    # Superusers are level 90 and above (admins also qualify)
    if not role or role.level < 90:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Superuser privileges required")
    return current_user


def require_user(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    role: Role | None = db.query(Role).filter(Role.id == current_user.role_id).first()
    # Users are level 10 and above
    if not role or role.level < 10:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="User privileges required")
    return current_user


