"""Workspace SMTP sender for scheduled and system-generated messages."""

from __future__ import annotations

from email.message import EmailMessage

from fastapi import HTTPException
from sqlalchemy.orm import Session

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


def send_system_message(db: Session, *, tenant_id: int, recipient: str, subject: str, body: str, attachment: tuple[str, bytes, str] | None = None) -> None:
    settings = get_settings(db, tenant_id)
    if settings is None:
        raise ValueError("Configure the workspace email sender in Settings → Integrations")
    password = decrypt_application_secret(settings.encrypted_password, key_version=settings.encrypted_password_key_version)
    if not password:
        raise ValueError("The workspace email sender has no password")
    message = EmailMessage()
    message["From"] = settings.sender_email
    message["To"] = recipient
    message["Subject"] = subject.replace("\r", " ").replace("\n", " ")
    message.set_content(body)
    if attachment:
        filename, content, media_type = attachment
        main_type, sub_type = media_type.split("/", 1)
        message.add_attachment(content, maintype=main_type, subtype=sub_type, filename=filename)
    client = _connect_smtp(settings.smtp_host, settings.smtp_port, settings.smtp_security)
    try:
        client.login(settings.smtp_username, password)
        client.send_message(message)
    finally:
        client.quit()
