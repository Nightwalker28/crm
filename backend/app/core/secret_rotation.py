from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.core.secrets import (
    current_application_key_version,
    decrypt_secret_with_rotation,
    decrypt_sensitive_value_with_rotation,
    encrypt_sensitive_value,
)
from app.modules.calendar.models import UserCalendarConnection
from app.modules.documents.models import DocumentStorageConnection
from app.modules.mail.models import UserMailConnection
from app.modules.user_management.models import TenantSsoSettings, User

LegacyDecryptor = Callable[[str | None], str | None]


@dataclass(frozen=True)
class SecretFieldTarget:
    secret_type: str
    model: type
    value_field: str
    key_version_field: str
    tenant_field: str | None = None
    legacy_decrypt: LegacyDecryptor | None = None
    allow_plaintext_legacy: bool = True


SECRET_FIELD_TARGETS: tuple[SecretFieldTarget, ...] = (
    SecretFieldTarget("mfa_totp", User, "encrypted_totp_secret", "mfa_secret_key_version", tenant_field="tenant_id"),
    SecretFieldTarget("sso_client_secret", TenantSsoSettings, "encrypted_client_secret", "client_secret_key_version", tenant_field="tenant_id"),
    SecretFieldTarget("mail_oauth_access", UserMailConnection, "access_token", "access_token_key_version", tenant_field="tenant_id"),
    SecretFieldTarget("mail_oauth_refresh", UserMailConnection, "refresh_token", "refresh_token_key_version", tenant_field="tenant_id"),
    SecretFieldTarget(
        "mail_password",
        UserMailConnection,
        "encrypted_password",
        "encrypted_password_key_version",
        tenant_field="tenant_id",
        legacy_decrypt=lambda value: decrypt_secret_with_rotation(value)[0],
    ),
    SecretFieldTarget("calendar_oauth_access", UserCalendarConnection, "access_token", "access_token_key_version", tenant_field="tenant_id"),
    SecretFieldTarget("calendar_oauth_refresh", UserCalendarConnection, "refresh_token", "refresh_token_key_version", tenant_field="tenant_id"),
    SecretFieldTarget(
        "document_oauth_access",
        DocumentStorageConnection,
        "access_token",
        "access_token_key_version",
        tenant_field="tenant_id",
        legacy_decrypt=lambda value: decrypt_secret_with_rotation(value)[0],
    ),
    SecretFieldTarget(
        "document_oauth_refresh",
        DocumentStorageConnection,
        "refresh_token",
        "refresh_token_key_version",
        tenant_field="tenant_id",
        legacy_decrypt=lambda value: decrypt_secret_with_rotation(value)[0],
    ),
)


SECRET_TYPES = tuple(target.secret_type for target in SECRET_FIELD_TARGETS)


def reencrypt_application_secrets(
    db: Session,
    *,
    secret_types: list[str] | None = None,
    tenant_id: int | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    selected_types = set(secret_types or SECRET_TYPES)
    unknown = selected_types.difference(SECRET_TYPES)
    if unknown:
        raise ValueError(f"Unknown secret type(s): {', '.join(sorted(unknown))}")

    current_version = current_application_key_version()
    results: dict[str, Any] = {
        "dry_run": dry_run,
        "current_key_version": current_version,
        "tenant_id": tenant_id,
        "secret_types": sorted(selected_types),
        "scanned": 0,
        "rotated": 0,
        "skipped": 0,
        "failed": 0,
        "details": {},
    }

    for target in SECRET_FIELD_TARGETS:
        if target.secret_type not in selected_types:
            continue
        detail = _reencrypt_target(db, target=target, tenant_id=tenant_id, dry_run=dry_run, current_version=current_version)
        results["details"][target.secret_type] = detail
        for key in ("scanned", "rotated", "skipped", "failed"):
            results[key] += detail[key]

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return results


def _reencrypt_target(
    db: Session,
    *,
    target: SecretFieldTarget,
    tenant_id: int | None,
    dry_run: bool,
    current_version: str,
) -> dict[str, Any]:
    query = db.query(target.model).filter(getattr(target.model, target.value_field).isnot(None))
    if tenant_id is not None and target.tenant_field:
        query = query.filter(getattr(target.model, target.tenant_field) == tenant_id)

    detail = {"scanned": 0, "rotated": 0, "skipped": 0, "failed": 0}
    for row in query.yield_per(100):
        detail["scanned"] += 1
        try:
            plaintext, should_rotate = _read_secret_for_rotation(row, target=target, current_version=current_version)
        except RuntimeError:
            detail["failed"] += 1
            continue
        if not plaintext or not should_rotate:
            detail["skipped"] += 1
            continue
        detail["rotated"] += 1
        if dry_run:
            continue
        encrypted = encrypt_sensitive_value(plaintext)
        setattr(row, target.value_field, encrypted.ciphertext)
        setattr(row, target.key_version_field, encrypted.key_version)
        db.add(row)
    return detail


def _read_secret_for_rotation(row: Any, *, target: SecretFieldTarget, current_version: str) -> tuple[str | None, bool]:
    value = getattr(row, target.value_field, None)
    if not value:
        return None, False
    key_version = getattr(row, target.key_version_field, None)
    if key_version:
        plaintext, needs_reencrypt = decrypt_sensitive_value_with_rotation(value, key_version=key_version)
        return plaintext, needs_reencrypt or key_version != current_version

    try:
        plaintext, _needs_reencrypt = decrypt_sensitive_value_with_rotation(value)
        return plaintext, True
    except RuntimeError:
        pass

    if target.legacy_decrypt is not None:
        try:
            plaintext = target.legacy_decrypt(value)
            if plaintext:
                return plaintext, True
        except RuntimeError:
            pass

    if target.allow_plaintext_legacy:
        return value, True
    raise RuntimeError("Stored secret could not be decrypted")
