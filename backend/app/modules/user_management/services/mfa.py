import base64
import hashlib
import hmac
import secrets
import struct
import time
import urllib.parse
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.cache import cache_delete, cache_get_json, cache_set_json
from app.core.config import settings
from app.core.passwords import verify_password
from app.core.secrets import decrypt_application_secret, encrypt_application_secret
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.user_management.models import Tenant, User, UserMfaBackupCode

TOTP_PERIOD_SECONDS = 30
TOTP_DIGITS = 6
MFA_BACKUP_CODE_COUNT = 10
MFA_POLICY_VALUES = {"off", "admins_only", "all_users"}
MFA_CHALLENGE_RATE_LIMIT_PREFIX = "auth:mfa_challenge_failed"


def generate_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def build_totp_uri(*, secret: str, account_name: str, issuer: str = "Lynk") -> str:
    label = f"{issuer}:{account_name}"
    query = urllib.parse.urlencode(
        {
            "secret": secret,
            "issuer": issuer,
            "algorithm": "SHA1",
            "digits": str(TOTP_DIGITS),
            "period": str(TOTP_PERIOD_SECONDS),
        }
    )
    return f"otpauth://totp/{urllib.parse.quote(label)}?{query}"


def _normalize_code(code: str | None) -> str:
    return "".join(ch for ch in (code or "") if ch.isdigit())


def _decode_totp_secret(secret: str) -> bytes:
    padded = secret.upper() + ("=" * ((8 - len(secret) % 8) % 8))
    try:
        return base64.b32decode(padded, casefold=True)
    except (base64.binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid MFA secret") from exc


def generate_totp_code(secret: str, *, for_time: int | None = None) -> str:
    counter = int((for_time if for_time is not None else time.time()) // TOTP_PERIOD_SECONDS)
    digest = hmac.new(_decode_totp_secret(secret), struct.pack(">Q", counter), digestmod=hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10**TOTP_DIGITS)).zfill(TOTP_DIGITS)


def verify_totp_code(secret: str, code: str | None, *, at_time: int | None = None, window: int = 1) -> bool:
    normalized = _normalize_code(code)
    if len(normalized) != TOTP_DIGITS:
        return False
    now = int(at_time if at_time is not None else time.time())
    for drift in range(-window, window + 1):
        candidate_time = now + drift * TOTP_PERIOD_SECONDS
        if hmac.compare_digest(generate_totp_code(secret, for_time=candidate_time), normalized):
            return True
    return False


def _hash_backup_code(code: str) -> str:
    return hashlib.sha256(code.replace("-", "").strip().upper().encode("utf-8")).hexdigest()


def _mfa_challenge_attempt_key(user: User) -> str:
    return f"{MFA_CHALLENGE_RATE_LIMIT_PREFIX}:tenant:{user.tenant_id}:user:{user.id}"


def check_mfa_challenge_rate_limit(user: User) -> None:
    payload = cache_get_json(_mfa_challenge_attempt_key(user)) or {}
    if int(payload.get("count") or 0) >= settings.MFA_CHALLENGE_FAILED_ATTEMPT_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed MFA attempts",
        )


def record_failed_mfa_challenge_attempt(user: User) -> None:
    key = _mfa_challenge_attempt_key(user)
    payload = cache_get_json(key) or {}
    cache_set_json(
        key,
        {"count": int(payload.get("count") or 0) + 1},
        ttl_seconds=settings.MFA_CHALLENGE_FAILED_ATTEMPT_WINDOW_SECONDS,
    )


def clear_failed_mfa_challenge_attempts(user: User) -> None:
    cache_delete(_mfa_challenge_attempt_key(user))


def _generate_backup_code() -> str:
    raw = secrets.token_hex(5).upper()
    return f"{raw[:5]}-{raw[5:]}"


def start_mfa_setup(db: Session, *, user: User) -> dict[str, str]:
    secret = generate_totp_secret()
    encrypted = encrypt_application_secret(secret)
    user.encrypted_totp_secret = encrypted.ciphertext
    user.mfa_secret_key_version = encrypted.key_version
    user.mfa_enabled = False
    user.mfa_verified_at = None
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "secret": secret,
        "otpauth_uri": build_totp_uri(secret=secret, account_name=user.email),
    }


def _current_totp_secret(user: User) -> str:
    secret = decrypt_application_secret(user.encrypted_totp_secret, key_version=user.mfa_secret_key_version)
    if not secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MFA setup has not been started")
    return secret


def activate_mfa(db: Session, *, user: User, code: str) -> list[str]:
    secret = _current_totp_secret(user)
    if not verify_totp_code(secret, code):
        safe_log_activity(
            db,
            tenant_id=user.tenant_id,
            actor_user_id=user.id,
            module_key="security",
            entity_type="user",
            entity_id=user.id,
            action="mfa.challenge.failed",
            description="MFA setup verification failed",
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid MFA code")

    backup_codes = [_generate_backup_code() for _ in range(MFA_BACKUP_CODE_COUNT)]
    db.query(UserMfaBackupCode).filter(UserMfaBackupCode.user_id == user.id).delete(synchronize_session=False)
    for code_value in backup_codes:
        db.add(UserMfaBackupCode(user_id=user.id, code_hash=_hash_backup_code(code_value)))
    user.mfa_enabled = True
    user.mfa_verified_at = datetime.now(timezone.utc)
    db.add(user)
    db.commit()
    safe_log_activity(
        db,
        tenant_id=user.tenant_id,
        actor_user_id=user.id,
        module_key="security",
        entity_type="user",
        entity_id=user.id,
        action="mfa.enabled",
        description="MFA enabled",
    )
    return backup_codes


def verify_mfa_challenge(db: Session, *, user: User, code: str | None = None, backup_code: str | None = None) -> str:
    if not user.mfa_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MFA is not enabled")
    check_mfa_challenge_rate_limit(user)
    if backup_code:
        candidate_hash = _hash_backup_code(backup_code)
        backup = (
            db.query(UserMfaBackupCode)
            .filter(
                UserMfaBackupCode.user_id == user.id,
                UserMfaBackupCode.consumed_at.is_(None),
            )
            .all()
        )
        matched_backup = next(
            (
                candidate
                for candidate in backup
                if hmac.compare_digest(candidate.code_hash, candidate_hash)
            ),
            None,
        )
        if matched_backup:
            matched_backup.consumed_at = datetime.now(timezone.utc)
            user.mfa_verified_at = datetime.now(timezone.utc)
            db.add(matched_backup)
            db.add(user)
            db.commit()
            clear_failed_mfa_challenge_attempts(user)
            safe_log_activity(
                db,
                tenant_id=user.tenant_id,
                actor_user_id=user.id,
                module_key="security",
                entity_type="user",
                entity_id=user.id,
                action="mfa.backup_code.used",
                description="MFA backup code used",
            )
            return "backup_code"
        record_failed_mfa_challenge_attempt(user)
        _log_failed_challenge(db, user=user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA code")

    if verify_totp_code(_current_totp_secret(user), code):
        user.mfa_verified_at = datetime.now(timezone.utc)
        db.add(user)
        db.commit()
        clear_failed_mfa_challenge_attempts(user)
        return "totp"
    record_failed_mfa_challenge_attempt(user)
    _log_failed_challenge(db, user=user)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA code")


def disable_mfa(db: Session, *, user: User, current_password: str, code: str | None = None, backup_code: str | None = None) -> None:
    if not verify_password(current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password verification failed")
    verify_mfa_challenge(db, user=user, code=code, backup_code=backup_code)
    db.query(UserMfaBackupCode).filter(UserMfaBackupCode.user_id == user.id).delete(synchronize_session=False)
    user.mfa_enabled = False
    user.encrypted_totp_secret = None
    user.mfa_secret_key_version = None
    user.mfa_verified_at = None
    db.add(user)
    db.commit()
    safe_log_activity(
        db,
        tenant_id=user.tenant_id,
        actor_user_id=user.id,
        module_key="security",
        entity_type="user",
        entity_id=user.id,
        action="mfa.disabled",
        description="MFA disabled",
    )


def get_tenant_mfa_policy(db: Session, *, tenant_id: int) -> str:
    policy = db.query(Tenant.mfa_policy).filter(Tenant.id == tenant_id).scalar()
    return policy or "off"


def update_tenant_mfa_policy(db: Session, *, tenant_id: int, actor_user_id: int, policy: str) -> str:
    if policy not in MFA_POLICY_VALUES:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid MFA policy")
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    before = {"policy": tenant.mfa_policy or "off"}
    tenant.mfa_policy = policy
    db.add(tenant)
    db.commit()
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="tenant",
        entity_id=tenant_id,
        action="mfa.policy.updated",
        description="MFA policy updated",
        before_state=before,
        after_state={"policy": policy},
    )
    return policy


def admin_reset_user_mfa(db: Session, *, tenant_id: int, actor_user_id: int, user_id: int) -> None:
    user = (
        db.query(User)
        .filter(
            User.id == user_id,
            User.tenant_id == tenant_id,
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    before = {"mfa_enabled": bool(user.mfa_enabled)}
    db.query(UserMfaBackupCode).filter(UserMfaBackupCode.user_id == user.id).delete(synchronize_session=False)
    user.mfa_enabled = False
    user.encrypted_totp_secret = None
    user.mfa_secret_key_version = None
    user.mfa_verified_at = None
    db.add(user)
    db.commit()
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="user",
        entity_id=user.id,
        action="mfa.admin_reset",
        description="MFA reset by administrator",
        before_state=before,
        after_state={"mfa_enabled": False},
    )


def _log_failed_challenge(db: Session, *, user: User) -> None:
    safe_log_activity(
        db,
        tenant_id=user.tenant_id,
        actor_user_id=user.id,
        module_key="security",
        entity_type="user",
        entity_id=user.id,
        action="mfa.challenge.failed",
        description="MFA challenge failed",
    )
