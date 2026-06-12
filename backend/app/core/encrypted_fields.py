from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.core.secrets import decrypt_sensitive_value_with_rotation, encrypt_sensitive_value

LegacyDecryptor = Callable[[str | None], str | None]


def set_encrypted_model_value(model: Any, field_name: str, value: str | None, *, key_version_field: str) -> None:
    if value:
        encrypted = encrypt_sensitive_value(value)
        setattr(model, field_name, encrypted.ciphertext)
        setattr(model, key_version_field, encrypted.key_version)
        return
    setattr(model, field_name, None)
    setattr(model, key_version_field, None)


def get_encrypted_model_value(
    db: Session,
    model: Any,
    field_name: str,
    *,
    key_version_field: str,
    legacy_decrypt: LegacyDecryptor | None = None,
    allow_plaintext_legacy: bool = True,
) -> str | None:
    value = getattr(model, field_name, None)
    if not value:
        return None

    key_version = getattr(model, key_version_field, None)
    if key_version:
        plaintext, needs_reencrypt = decrypt_sensitive_value_with_rotation(value, key_version=key_version)
    else:
        plaintext, needs_reencrypt = _read_legacy_value(
            value,
            legacy_decrypt=legacy_decrypt,
            allow_plaintext_legacy=allow_plaintext_legacy,
        )

    if plaintext and needs_reencrypt:
        set_encrypted_model_value(model, field_name, plaintext, key_version_field=key_version_field)
        db.add(model)
        db.flush()
    return plaintext


def _read_legacy_value(
    value: str,
    *,
    legacy_decrypt: LegacyDecryptor | None,
    allow_plaintext_legacy: bool,
) -> tuple[str | None, bool]:
    try:
        plaintext, _needs_reencrypt = decrypt_sensitive_value_with_rotation(value)
        return plaintext, True
    except RuntimeError:
        pass

    if legacy_decrypt is not None:
        try:
            plaintext = legacy_decrypt(value)
            if plaintext:
                return plaintext, True
        except RuntimeError:
            pass

    if allow_plaintext_legacy:
        return value, True
    raise RuntimeError("Stored encrypted field could not be decrypted")
