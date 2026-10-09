"""Client portal access (13d §3.7): the invite email, forgot and reset password, and changing
the password from inside the portal.

The portal keeps its own auth boundary: nothing here touches CRM users. Mail goes through the
tenant's workspace sender (the platform sender in cloud mode); when neither is set up, the
admin still sees and copies the setup link, and a reset request answers the same as ever.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.passwords import hash_password, validate_password_strength, verify_password
from app.modules.client_portal.models import ClientAccount, ClientPasswordReset
from app.modules.platform.services.activity_logs import safe_log_activity

logger = logging.getLogger(__name__)

RESET_TTL = timedelta(hours=1)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _company_name(db: Session, tenant_id: int) -> str:
    from app.modules.user_management.models import CompanyProfile, Tenant

    name = db.query(CompanyProfile.name).filter(CompanyProfile.tenant_id == tenant_id).order_by(CompanyProfile.id).scalar()
    return name or db.query(Tenant.name).filter(Tenant.id == tenant_id).scalar() or "us"


def _tenant_slug(db: Session, tenant_id: int) -> str | None:
    from app.modules.user_management.models import Tenant

    return db.query(Tenant.slug).filter(Tenant.id == tenant_id).scalar()


def _send(db: Session, *, tenant_id: int, recipient: str, subject: str, body: str) -> None:
    from app.modules.mail.services.tenant_mail import send_transactional_message

    send_transactional_message(db, tenant_id=tenant_id, recipient=recipient, subject=subject, body=body)


# Invite ---------------------------------------------------------------------------------------

INVITE_SUBJECT = "Set your password to sign in to {company}"
INVITE_BODY = (
    "Hello,\n\n{company} has set up a client account for you, where you can see your quotes, orders and invoices, "
    "and download their documents.\n\nSet your password here (the link works for seven days):\n{link}\n\n"
    "If you were not expecting this, you can ignore this email.\n\n{company}"
)


def send_invite(db: Session, *, account: ClientAccount, setup_link: str, actor_user_id: int | None) -> tuple[bool, str | None]:
    """Email the setup link. Returns (sent, why not); a failure never undoes the account."""
    company = _company_name(db, account.tenant_id)
    try:
        _send(db, tenant_id=account.tenant_id, recipient=account.email, subject=INVITE_SUBJECT.format(company=company),
              body=INVITE_BODY.format(company=company, link=setup_link))
    except Exception as exc:  # the admin copies the link instead; the reason is what they need
        message = str(exc) or "The invitation could not be emailed"
        if exc.__class__.__name__ != "MailSenderUnavailable":
            logger.warning("Client invite email failed", extra={"tenant_id": account.tenant_id, "client_account_id": account.id})
        return False, message
    safe_log_activity(db, tenant_id=account.tenant_id, actor_user_id=actor_user_id, module_key="client_portal", entity_type="client_account",
                      entity_id=account.id, action="client_account.invited", description=f"Emailed the portal invitation to {account.email}")
    return True, None


# Forgot and reset -----------------------------------------------------------------------------

RESET_SUBJECT = "Reset your {company} client portal password"
RESET_BODY = (
    "Hello,\n\nSomeone asked to reset the password for your {company} client account. To choose a new one, open this "
    "link within an hour:\n{link}\n\nIf it was not you, ignore this email; your password stays as it is.\n\n{company}"
)


def request_password_reset(db: Session, *, tenant_id: int, email: str) -> None:
    """Email a reset link when an active account has this address. The caller answers the same
    either way, so the request reveals nothing about who has an account."""
    from app.modules.client_portal.repositories import client_portal_repository

    account = client_portal_repository.get_client_account_by_email(db, tenant_id=tenant_id, email=email.strip().lower())
    if account is None or account.status != "active" or not account.password_hash:
        return
    token = secrets.token_urlsafe(32)
    # A new link ends the older ones.
    db.query(ClientPasswordReset).filter(ClientPasswordReset.client_account_id == account.id, ClientPasswordReset.used_at.is_(None)) \
        .update({ClientPasswordReset.used_at: _now()}, synchronize_session=False)
    db.add(ClientPasswordReset(tenant_id=tenant_id, client_account_id=account.id, token_hash=_hash(token), expires_at=_now() + RESET_TTL))
    db.commit()
    link = f"{settings.FRONTEND_ORIGIN.rstrip('/')}/client/reset?token={quote(token, safe='')}"
    slug = _tenant_slug(db, tenant_id)
    if slug:
        link += f"&tenant={quote(slug, safe='')}"
    company = _company_name(db, tenant_id)
    try:
        _send(db, tenant_id=tenant_id, recipient=account.email, subject=RESET_SUBJECT.format(company=company),
              body=RESET_BODY.format(company=company, link=link))
    except Exception:
        logger.warning("Client password reset email failed", extra={"tenant_id": tenant_id, "client_account_id": account.id})
        return
    safe_log_activity(db, tenant_id=tenant_id, actor_user_id=None, module_key="client_portal", entity_type="client_account",
                      entity_id=account.id, action="client_account.reset_requested", description=f"Password reset emailed to {account.email}")


def reset_password(db: Session, *, token: str, password: str, expected_tenant_id: int | None = None) -> ClientAccount:
    invalid = HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired. Ask for a new one.")
    reset = db.query(ClientPasswordReset).filter(ClientPasswordReset.token_hash == _hash(token.strip())).first()
    if reset is None or reset.used_at is not None or _as_utc(reset.expires_at) <= _now():
        raise invalid
    if expected_tenant_id is not None and reset.tenant_id != expected_tenant_id:
        raise invalid
    account = db.query(ClientAccount).filter(ClientAccount.id == reset.client_account_id, ClientAccount.tenant_id == reset.tenant_id).first()
    if account is None or account.status != "active":
        raise invalid
    try:
        validate_password_strength(password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    account.password_hash = hash_password(password)
    reset.used_at = _now()
    db.add_all([account, reset])
    db.commit()
    safe_log_activity(db, tenant_id=account.tenant_id, actor_user_id=None, module_key="client_portal", entity_type="client_account",
                      entity_id=account.id, action="client_account.password_reset", description=f"Client reset the password for {account.email}")
    return account


def change_password(db: Session, *, account: ClientAccount, current_password: str, new_password: str) -> None:
    if not verify_password(current_password, account.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Your current password is not right")
    try:
        validate_password_strength(new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    account.password_hash = hash_password(new_password)
    db.add(account)
    db.commit()
    safe_log_activity(db, tenant_id=account.tenant_id, actor_user_id=None, module_key="client_portal", entity_type="client_account",
                      entity_id=account.id, action="client_account.password_changed", description=f"Client changed the password for {account.email}")
