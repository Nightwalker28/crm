from __future__ import annotations

from datetime import datetime, timedelta

import requests
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.modules.user_management.models import UserGoogleToken

GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
EXPIRY_SKEW_SECONDS = 60

def upsert_google_tokens(
    db: Session,
    *,
    user_id: int,
    access_token: str,
    refresh_token: str | None,
    expires_in: int | None,
    scope: str | None,
    token_type: str | None,
) -> UserGoogleToken:
    expires_at = None
    if expires_in:
        expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

    record = db.query(UserGoogleToken).filter(UserGoogleToken.user_id == user_id).first()

    if record:
        record.access_token_enc = encrypt_secret(access_token)
        if refresh_token:
            record.refresh_token_enc = encrypt_secret(refresh_token)
        if expires_at:
            record.expires_at = expires_at
        if scope is not None:
            record.scopes = scope
        if token_type is not None:
            record.token_type = token_type
    else:
        record = UserGoogleToken(
            user_id=user_id,
            access_token_enc=encrypt_secret(access_token),
            refresh_token_enc=encrypt_secret(refresh_token) if refresh_token else None,
            scopes=scope,
            token_type=token_type,
            expires_at=expires_at,
        )
        db.add(record)

    db.commit()
    db.refresh(record)
    return record


def get_valid_google_access_token(db: Session, *, user_id: int) -> str:
    record = db.query(UserGoogleToken).filter(UserGoogleToken.user_id == user_id).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Google tokens not found")

    if record.expires_at:
        now = datetime.utcnow()
        if record.expires_at - timedelta(seconds=EXPIRY_SKEW_SECONDS) > now:
            return decrypt_secret(record.access_token_enc)

    if not record.refresh_token_enc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google refresh token missing")

    refresh_token = decrypt_secret(record.refresh_token_enc)
    token_res = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=30,
    )
    token_json = token_res.json()
    new_access_token = token_json.get("access_token")
    if not new_access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Failed to refresh Google token")

    upsert_google_tokens(
        db,
        user_id=user_id,
        access_token=new_access_token,
        refresh_token=token_json.get("refresh_token"),
        expires_in=token_json.get("expires_in"),
        scope=token_json.get("scope"),
        token_type=token_json.get("token_type"),
    )
    return new_access_token
