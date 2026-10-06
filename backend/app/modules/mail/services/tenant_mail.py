"""Workspace SMTP sender for scheduled and system-generated messages."""

from __future__ import annotations

from email.message import EmailMessage

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings as app_settings
from app.core.secrets import decrypt_application_secret, encrypt_application_secret
from app.modules.mail.models import TenantMailSettings
from app.modules.mail.services.mail_services import _connect_smtp
from app.modules.platform.services.activity_logs import log_activity


def get_settings(db: Session, tenant_id: int) -> TenantMailSettings | None:
    return db.query(TenantMailSettings).filter(TenantMailSettings.tenant_id == tenant_id).first()


def settings_summary(settings: TenantMailSettings | None) -> dict:
    if settings is None:
        return {"configured": False, "sender_email": None, "smtp_host": None, "smtp_port": None, "smtp_security": None, "smtp_username": None}
    return {
        "configured": True,
        "sender_email": settings.sender_email,
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
        "smtp_security": settings.smtp_security,
        "smtp_username": settings.smtp_username,
    }


def save_settings(db: Session, tenant_id: int, *, actor_user_id: int, sender_email: str, smtp_host: str, smtp_port: int, smtp_security: str, smtp_username: str, password: str | None) -> dict:
    settings = get_settings(db, tenant_id)
    if settings is None and not password:
        raise HTTPException(status_code=400, detail="SMTP password is required")
    if settings is None:
        settings = TenantMailSettings(tenant_id=tenant_id)
        db.add(settings)
    settings.sender_email = sender_email.strip().lower()
    settings.smtp_host = smtp_host.strip()
    settings.smtp_port = smtp_port
    settings.smtp_security = smtp_security
    settings.smtp_username = smtp_username.strip()
    if password:
        encrypted = encrypt_application_secret(password)
        settings.encrypted_password = encrypted.ciphertext
        settings.encrypted_password_key_version = encrypted.key_version
    log_activity(
        db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="reports",
        entity_type="tenant_mail_settings", entity_id=tenant_id,
        action="update", description="Updated workspace email sender",
        after_state={"sender_email": settings.sender_email, "smtp_host": settings.smtp_host, "smtp_port": settings.smtp_port, "smtp_security": settings.smtp_security},
        commit=False,
    )
    db.commit()
    return settings_summary(settings)


def _build_message(*, sender: str, recipient: str, subject: str, body: str, attachment: tuple[str, bytes, str] | None) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject.replace("\r", " ").replace("\n", " ")
    message.set_content(body)
    if attachment:
        filename, content, media_type = attachment
        main_type, sub_type = media_type.split("/", 1)
        message.add_attachment(content, maintype=main_type, subtype=sub_type, filename=filename)
    return message


def _deliver(*, host: str, port: int, security: str, username: str, password: str, message: EmailMessage) -> None:
    client = _connect_smtp(host, port, security)
    try:
        if username:
            client.login(username, password)
        client.send_message(message)
    finally:
        client.quit()


def send_system_message(db: Session, *, tenant_id: int, recipient: str, subject: str, body: str, attachment: tuple[str, bytes, str] | None = None) -> None:
    settings = get_settings(db, tenant_id)
    if settings is None:
        raise ValueError("Configure the workspace email sender in Settings → Integrations")
    password = decrypt_application_secret(settings.encrypted_password, key_version=settings.encrypted_password_key_version)
    if not password:
        raise ValueError("The workspace email sender has no password")
    message = _build_message(sender=settings.sender_email, recipient=recipient, subject=subject, body=body, attachment=attachment)
    _deliver(
        host=settings.smtp_host,
        port=settings.smtp_port,
        security=settings.smtp_security,
        username=settings.smtp_username,
        password=password,
        message=message,
    )


# ---------------------------------------------------------------------------------------------
# Transactional mail: invites, password resets, operator alerts (13 F0.7 B3/B4, F0.8 F6).
#
# A tenant's own workspace sender comes first. The platform sender (PLATFORM_SMTP_*) stands in
# only in cloud mode, where the operator runs many tenants; a single-client install sends
# from the client's own sender or not at all (owner decision, 2026-10-04).
# ---------------------------------------------------------------------------------------------


class MailSenderUnavailable(Exception):
    """No sender can carry this tenant's mail. The message says what an admin should set up."""


def platform_sender_configured() -> bool:
    return bool(app_settings.PLATFORM_SMTP_HOST and app_settings.PLATFORM_SMTP_SENDER_EMAIL)


def _send_via_platform(*, recipient: str, subject: str, body: str) -> None:
    message = _build_message(sender=app_settings.PLATFORM_SMTP_SENDER_EMAIL, recipient=recipient, subject=subject, body=body, attachment=None)
    _deliver(
        host=app_settings.PLATFORM_SMTP_HOST,
        port=app_settings.PLATFORM_SMTP_PORT,
        security=app_settings.PLATFORM_SMTP_SECURITY,
        username=app_settings.PLATFORM_SMTP_USERNAME,
        password=app_settings.PLATFORM_SMTP_PASSWORD,
        message=message,
    )


def transactional_sender(db: Session, tenant_id: int) -> str | None:
    """"workspace", "platform", or None when this tenant cannot send transactional mail."""
    if get_settings(db, tenant_id) is not None:
        return "workspace"
    from app.core.tenancy import is_cloud_mode_enabled

    if is_cloud_mode_enabled() and platform_sender_configured():
        return "platform"
    return None


def send_transactional_message(db: Session, *, tenant_id: int, recipient: str, subject: str, body: str) -> str:
    """Send through the tenant's sender, else the platform's (cloud only). Returns which one."""
    sender = transactional_sender(db, tenant_id)
    if sender == "workspace":
        send_system_message(db, tenant_id=tenant_id, recipient=recipient, subject=subject, body=body)
    elif sender == "platform":
        _send_via_platform(recipient=recipient, subject=subject, body=body)
    else:
        raise MailSenderUnavailable("No email sender is set up. Configure the workspace email sender in Settings → Integrations.")
    return sender


def send_operator_alert(*, subject: str, body: str) -> bool:
    """Mail OPS_ALERT_EMAIL. The platform sender, else (single-tenant installs) the tenant's own."""
    recipient = app_settings.OPS_ALERT_EMAIL
    if not recipient:
        return False
    if platform_sender_configured():
        _send_via_platform(recipient=recipient, subject=subject, body=body)
        return True
    from app.core.database import SessionLocal
    from app.core.tenancy import is_cloud_mode_enabled
    from app.modules.user_management.models import Tenant

    if is_cloud_mode_enabled():
        return False
    with SessionLocal() as db:
        tenant = db.query(Tenant).filter(Tenant.slug == app_settings.SINGLE_TENANT_SLUG).first()
        if tenant is None or get_settings(db, tenant.id) is None:
            return False
        send_system_message(db, tenant_id=tenant.id, recipient=recipient, subject=subject, body=body)
    return True
