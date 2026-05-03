import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _credential_fernet() -> Fernet:
    secret = settings.MAIL_CREDENTIAL_SECRET or settings.JWT_SECRET
    if not secret:
        raise RuntimeError("MAIL_CREDENTIAL_SECRET or JWT_SECRET must be set before storing mailbox credentials")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(value: str) -> str:
    return _credential_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return _credential_fernet().decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise RuntimeError("Stored mailbox credential could not be decrypted") from exc
