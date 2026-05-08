import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _fernet_for_secret(secret: str) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


def _credential_secrets() -> list[str]:
    secret = settings.MAIL_CREDENTIAL_SECRET or settings.JWT_SECRET
    if not secret:
        raise RuntimeError("MAIL_CREDENTIAL_SECRET or JWT_SECRET must be set before storing mailbox credentials")
    secrets = [secret]
    if settings.MAIL_CREDENTIAL_SECRET and settings.JWT_SECRET and settings.JWT_SECRET != settings.MAIL_CREDENTIAL_SECRET:
        secrets.append(settings.JWT_SECRET)
    return secrets


def _credential_fernet() -> Fernet:
    return _fernet_for_secret(_credential_secrets()[0])


def encrypt_secret(value: str) -> str:
    return _credential_fernet().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str | None) -> str | None:
    result, _ = decrypt_secret_with_rotation(value)
    return result


def decrypt_secret_with_rotation(value: str | None) -> tuple[str | None, bool]:
    if not value:
        return None, False
    last_error = None
    for index, secret in enumerate(_credential_secrets()):
        try:
            return _fernet_for_secret(secret).decrypt(value.encode("utf-8")).decode("utf-8"), index > 0
        except InvalidToken as exc:
            last_error = exc
    raise RuntimeError("Stored mailbox credential could not be decrypted") from last_error
