from __future__ import annotations

from cryptography.fernet import Fernet

from app.core.config import settings


def _get_fernet() -> Fernet:
    key = settings.GOOGLE_TOKEN_ENCRYPTION_KEY
    if not key:
        raise RuntimeError("GOOGLE_TOKEN_ENCRYPTION_KEY is not set")
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _get_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    return _get_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
