"""Account emails: user invites and password resets (13 F0.7 B3, B4).

Both go through the transactional sender (`tenant_mail.send_transactional_message`): the
tenant's workspace sender, or in cloud mode the platform's. When neither exists an invite
still hands the admin its setup link, and a reset is logged and dropped: the person asking is
told the same thing either way, so the response never says whether an account exists.
"""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.cache import cache_get_json, cache_set_json
from app.core.config import settings
from app.core.database import SessionLocal
from app.modules.mail.services.tenant_mail import MailSenderUnavailable, send_transactional_message
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.user_management.models import Tenant, User, UserAuthMode, UserStatus
from app.modules.user_management.schema import InviteEmailResult
from app.modules.user_management.services.auth import create_password_reset_link

logger = logging.getLogger(__name__)

PRODUCT_NAME = "Lynk"
PASSWORD_RESET_RATE_LIMIT_PREFIX = "auth:password-reset"
_PASSWORD_AUTH_MODES = {UserAuthMode.manual_only, UserAuthMode.manual_or_google}


def _display_name(user: User | None) -> str:
    if user is None:
        return "An administrator"
    name = " ".join(part for part in (user.first_name, user.last_name) if part)
    return name or user.email


def _tenant_name(db: Session, tenant_id: int) -> str:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    return getattr(tenant, "name", None) or PRODUCT_NAME


def _send_failure_copy(exc: Exception) -> str:
    if isinstance(exc, MailSenderUnavailable):
        return str(exc)
    return "The email server refused the message. Check the workspace email sender in Settings → Integrations."


# ---------------------------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------------------------


def send_user_invite_email(db: Session, *, user: User, setup_link: str, inviter: User | None) -> InviteEmailResult:
    tenant_name = _tenant_name(db, user.tenant_id)
    hours = settings.USER_SETUP_TOKEN_EXPIRE_HOURS
    body = (
        f"{_display_name(inviter)} added you to {tenant_name} on {PRODUCT_NAME}.\n\n"
        f"Set your password to sign in:\n{setup_link}\n\n"
        f"The link works once and expires in {hours} hours. If it has expired, ask your administrator "
        f"to send a new invite.\n"
    )
    try:
        send_transactional_message(
            db,
            tenant_id=user.tenant_id,
            recipient=user.email,
            subject=f"You're invited to {tenant_name} on {PRODUCT_NAME}",
            body=body,
        )
    except Exception as exc:
        logger.warning("Invite email for user %s not sent: %s", user.id, exc)
        result = InviteEmailResult(sent=False, error=_send_failure_copy(exc))
    else:
        result = InviteEmailResult(sent=True)
    safe_log_activity(
        db,
        tenant_id=user.tenant_id,
        actor_user_id=getattr(inviter, "id", None),
        module_key="security",
        entity_type="user",
        entity_id=user.id,
        action="user.invite_sent" if result.sent else "user.invite_failed",
        description=f"Invite emailed to {user.email}" if result.sent else f"Invite email to {user.email} failed",
        after_state={"sent": result.sent},
    )
    return result


# ---------------------------------------------------------------------------------------------
# Password reset
# ---------------------------------------------------------------------------------------------


def _rate_limit_keys(*, email: str, client_host: str | None) -> list[str]:
    keys = [f"{PASSWORD_RESET_RATE_LIMIT_PREFIX}:email:{hashlib.sha256(email.encode()).hexdigest()}"]
    if client_host:
        keys.append(f"{PASSWORD_RESET_RATE_LIMIT_PREFIX}:ip:{hashlib.sha256(client_host.encode()).hexdigest()}")
    return keys


def password_reset_rate_limited(*, email: str, client_host: str | None) -> bool:
    """Counts this request; True once a key is over the limit for its window."""
    limited = False
    window = settings.PASSWORD_RESET_REQUEST_WINDOW_SECONDS
    for key in _rate_limit_keys(email=email, client_host=client_host):
        count = int((cache_get_json(key) or {}).get("count") or 0)
        if count >= settings.PASSWORD_RESET_REQUEST_LIMIT:
            limited = True
            continue
        cache_set_json(key, {"count": count + 1}, ttl_seconds=window)
    return limited


def deliver_password_reset(*, tenant_id: int | None, email: str, frontend_origin: str | None) -> None:
    """Runs after the response (a background task), with its own session.

    The same code path runs whether or not the account exists, so neither the answer nor its
    timing tells the caller anything.
    """
    if tenant_id is None:
        return
    with SessionLocal() as db:
        user = (
            db.query(User)
            .filter(User.tenant_id == tenant_id, func.lower(User.email) == email)
            .first()
        )
        if user is None or user.is_active != UserStatus.active or user.auth_mode not in _PASSWORD_AUTH_MODES:
            return
        link = create_password_reset_link(db, user, frontend_origin=frontend_origin)
        tenant_name = _tenant_name(db, tenant_id)
        minutes = settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES
        body = (
            f"Someone asked to reset the password for {user.email} on {tenant_name}.\n\n"
            f"Choose a new password here:\n{link}\n\n"
            f"The link works once and expires in {minutes} minutes. Setting a new password signs "
            f"you out on every other device.\n\n"
            f"If you did not ask for this, ignore this email: your password has not changed.\n"
        )
        try:
            send_transactional_message(
                db,
                tenant_id=tenant_id,
                recipient=user.email,
                subject=f"Reset your {PRODUCT_NAME} password",
                body=body,
            )
            sent = True
        except Exception as exc:
            logger.warning("Password reset email for user %s not sent: %s", user.id, exc)
            sent = False
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=user.id,
            module_key="security",
            entity_type="user",
            entity_id=user.id,
            action="auth.password_reset_requested",
            description="Password reset requested" if sent else "Password reset requested; the email could not be sent",
            after_state={"sent": sent},
        )
