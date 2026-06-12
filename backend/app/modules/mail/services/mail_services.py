from __future__ import annotations

import base64
import email
import imaplib
import email.utils
import logging
import re
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.policy import default as default_email_policy
from email.utils import make_msgid
import urllib.parse

import requests
from fastapi import HTTPException, Request, status
from jose import jwt, JWTError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.encrypted_fields import get_encrypted_model_value, set_encrypted_model_value
from app.core.microsoft_oauth import MICROSOFT_GRAPH_BASE, MICROSOFT_MAIL_SCOPES, microsoft_auth_url, microsoft_scope_string, microsoft_token_url
from app.core.access_control import require_role_module_action_access
from app.core.secrets import decrypt_secret_with_rotation
from app.core.tenancy import (
    get_frontend_origin_for_request,
    get_google_redirect_uri_for_request,
    get_microsoft_redirect_uri_for_request,
)
from app.modules.mail.models import MailMessage, UserMailConnection
from app.modules.mail.repositories import mail_repository
from app.modules.mail.schema import MailProvider
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.message_templates import render_template_text
from app.modules.platform.services.record_comments import get_record_comment_module_config, get_record_reference
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization, SalesQuote
from app.modules.user_management.models import Tenant, User, UserStatus


logger = logging.getLogger(__name__)

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
GMAIL_MESSAGE_LIST_FIELDS = "messages/id,nextPageToken"
GMAIL_MESSAGE_DETAIL_FIELDS = (
    "id,threadId,snippet,"
    "payload(headers(name,value),mimeType,body(data),parts(mimeType,body(data),parts(mimeType,body(data))))"
)
IMAP_FULL_SYNC_SEARCH = "ALL"
SMTP_SENT_FOLDER_CANDIDATES = ("Sent", "Sent Mail", "[Gmail]/Sent Mail", "INBOX.Sent")
MAIL_CONNECT_STATE_TYPES = {
    MailProvider.google.value: "google_mail_oauth_state",
    MailProvider.microsoft.value: "microsoft_mail_oauth_state",
}


def _serialize_connection(connection: UserMailConnection) -> dict:
    scopes = set(connection.scopes or [])
    return {
        "provider": connection.provider,
        "status": connection.status,
        "account_email": connection.account_email,
        "provider_mailbox_id": connection.provider_mailbox_id,
        "provider_mailbox_name": connection.provider_mailbox_name,
        "sync_cursor": connection.sync_cursor,
        "can_send": (
            connection.status == "connected"
            and (
                (connection.provider == MailProvider.google.value and GMAIL_SEND_SCOPE in scopes)
                or (connection.provider == MailProvider.microsoft.value and "Mail.Send" in scopes)
                or connection.provider == MailProvider.imap_smtp.value
            )
        ),
        "can_sync": (
            connection.status == "connected"
            and (
                (
                    connection.provider == MailProvider.google.value
                    and settings.GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED
                    and GMAIL_READONLY_SCOPE in scopes
                )
                or (connection.provider == MailProvider.microsoft.value and "Mail.Read" in scopes)
                or connection.provider == MailProvider.imap_smtp.value
            )
        ),
        "last_synced_at": connection.last_synced_at,
        "last_error": connection.last_error,
    }


def build_mail_context(db: Session, *, tenant_id: int, current_user) -> dict:
    connections = mail_repository.list_connections(db, tenant_id=tenant_id, user_id=current_user.id)
    serialized_connections = [_serialize_connection(connection) for connection in connections]
    connected = any(connection["status"] == "connected" for connection in serialized_connections)
    can_sync = any(connection["can_sync"] for connection in serialized_connections)
    sync_provider_labels = [
        {"google": "Gmail", "microsoft": "Microsoft", "imap_smtp": "IMAP/SMTP"}.get(connection["provider"], connection["provider"])
        for connection in serialized_connections
        if connection["can_sync"]
    ]
    return {
        "connections": serialized_connections,
        "sync_available": can_sync,
        "sync_note": (
            f"Mailbox sync is available through {', '.join(sync_provider_labels)}."
            if can_sync
            else (
                "Mailbox sending is connected, but inbox sync is not available for this provider/scope."
                if connected
                else "Mailbox sync is not connected yet. Connect Gmail, Microsoft, or IMAP/SMTP from this page before syncing mail."
            )
        ),
    }


def serialize_mail_message(message: MailMessage) -> dict:
    return {
        "id": message.id,
        "provider": message.provider,
        "provider_message_id": message.provider_message_id,
        "provider_thread_id": message.provider_thread_id,
        "direction": message.direction,
        "folder": message.folder,
        "from_email": message.from_email,
        "from_name": message.from_name,
        "to_recipients": message.to_recipients,
        "cc_recipients": message.cc_recipients,
        "bcc_recipients": message.bcc_recipients,
        "subject": message.subject,
        "snippet": message.snippet,
        "body_text": message.body_text,
        "received_at": message.received_at,
        "sent_at": message.sent_at,
        "source_module_key": message.source_module_key,
        "source_entity_id": message.source_entity_id,
        "source_label": message.source_label,
        "created_at": message.created_at,
        "updated_at": message.updated_at,
    }


def list_mail_messages(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    folder: str | None = None,
    search: str | None = None,
    limit: int = 50,
    before_id: int | None = None,
) -> list[MailMessage]:
    return mail_repository.list_messages(
        db,
        tenant_id=tenant_id,
        owner_user_id=current_user.id,
        folder=folder,
        search=search,
        limit=limit,
        before_id=before_id,
    )


def list_mail_messages_cursor(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    limit: int,
    cursor: int | None = None,
    folder: str | None = None,
    search: str | None = None,
) -> list[MailMessage]:
    return mail_repository.list_messages_cursor(
        db,
        tenant_id=tenant_id,
        owner_user_id=current_user.id,
        folder=folder,
        search=search,
        limit=limit,
        cursor=cursor,
    )


def get_mail_message_or_404(
    db: Session,
    message_id: int,
    *,
    tenant_id: int,
    current_user,
) -> MailMessage:
    message = mail_repository.get_message(db, tenant_id=tenant_id, owner_user_id=current_user.id, message_id=message_id)
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mail message not found")
    return message


def _record_label(record, config: dict) -> str:
    label = getattr(record, config["label_field"], None)
    if label:
        return str(label)
    return f"{config['entity_type']} #{getattr(record, config['id_field'])}"


def link_mail_message_to_record(
    db: Session,
    *,
    message_id: int,
    current_user: User,
    payload: dict,
) -> MailMessage:
    message = get_mail_message_or_404(
        db,
        message_id,
        tenant_id=current_user.tenant_id,
        current_user=current_user,
    )
    module_key = _normalize_source_value(payload.get("source_module_key"))
    entity_id = _normalize_source_value(payload.get("source_entity_id"))
    if not module_key or not entity_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a record to link this mail message.")

    try:
        require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        config = get_record_comment_module_config(module_key)
        record = get_record_reference(
            db,
            tenant_id=current_user.tenant_id,
            module_key=module_key,
            entity_id=entity_id,
        )
    except HTTPException as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected record is not available.") from exc
    except (PermissionError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected record is not available.") from exc

    before_state = serialize_mail_message(message)
    message.source_module_key = module_key
    message.source_entity_id = str(entity_id)
    message.source_label = _record_label(record, config)
    db.add(message)
    db.commit()
    db.refresh(message)
    after_state = serialize_mail_message(message)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key=module_key,
        entity_type=config["entity_type"],
        entity_id=entity_id,
        action="mail.linked",
        description=f"Linked email: {message.subject or '(no subject)'}",
        before_state=before_state,
        after_state=after_state,
    )
    return message


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _create_mail_oauth_state(*, tenant: Tenant, user: User, provider: MailProvider, frontend_origin: str) -> str:
    now = _utcnow()
    payload = {
        "type": MAIL_CONNECT_STATE_TYPES[provider.value],
        "provider": provider.value,
        "tenant_id": tenant.id,
        "user_id": user.id,
        "frontend_origin": frontend_origin.rstrip("/"),
        "iat": now,
        "exp": now + timedelta(minutes=settings.GOOGLE_OAUTH_STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_mail_oauth_state(state_token: str | None) -> dict | None:
    if not state_token:
        return None
    try:
        payload = jwt.decode(
            state_token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except JWTError:
        return None
    provider = payload.get("provider")
    if provider not in MAIL_CONNECT_STATE_TYPES or payload.get("type") != MAIL_CONNECT_STATE_TYPES[provider]:
        return None
    return payload


def get_google_mail_connect_url(*, request: Request, tenant: Tenant, user: User) -> str:
    gmail_scopes = [GMAIL_SEND_SCOPE]
    if settings.GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED:
        gmail_scopes.append(GMAIL_READONLY_SCOPE)
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": get_google_redirect_uri_for_request(request),
        "response_type": "code",
        "scope": " ".join(["openid", "email", "profile", *gmail_scopes]),
        "access_type": "offline",
        "prompt": "consent",
        "state": _create_mail_oauth_state(
            tenant=tenant,
            user=user,
            provider=MailProvider.google,
            frontend_origin=get_frontend_origin_for_request(request),
        ),
    }
    return GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)


def get_microsoft_mail_connect_url(*, request: Request, tenant: Tenant, user: User) -> str:
    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Microsoft Entra mail integration is not configured.")
    params = {
        "client_id": settings.MICROSOFT_CLIENT_ID,
        "redirect_uri": get_microsoft_redirect_uri_for_request(request),
        "response_type": "code",
        "scope": microsoft_scope_string(*MICROSOFT_MAIL_SCOPES),
        "response_mode": "query",
        "state": _create_mail_oauth_state(
            tenant=tenant,
            user=user,
            provider=MailProvider.microsoft,
            frontend_origin=get_frontend_origin_for_request(request),
        ),
    }
    return microsoft_auth_url() + "?" + urllib.parse.urlencode(params)


def _token_expiry(token_json: dict) -> datetime | None:
    expires_in = token_json.get("expires_in")
    if not expires_in:
        return None
    return _utcnow() + timedelta(seconds=int(expires_in))


def _set_oauth_connection_token(connection: UserMailConnection, field_name: str, value: str | None) -> None:
    set_encrypted_model_value(connection, field_name, value, key_version_field=f"{field_name}_key_version")


def _oauth_connection_token(db: Session, connection: UserMailConnection, field_name: str) -> str | None:
    return get_encrypted_model_value(
        db,
        connection,
        field_name,
        key_version_field=f"{field_name}_key_version",
    )


def _set_mail_password(connection: UserMailConnection, value: str | None) -> None:
    set_encrypted_model_value(connection, "encrypted_password", value, key_version_field="encrypted_password_key_version")


def _mail_password(db: Session, connection: UserMailConnection) -> str | None:
    return get_encrypted_model_value(
        db,
        connection,
        "encrypted_password",
        key_version_field="encrypted_password_key_version",
        legacy_decrypt=lambda value: decrypt_secret_with_rotation(value)[0],
    )


def _get_oauth_mail_connection(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: MailProvider,
) -> UserMailConnection | None:
    return mail_repository.get_connection(db, tenant_id=tenant_id, user_id=user_id, provider=provider)


def _apply_oauth_mail_connection_state(
    db: Session,
    *,
    connection: UserMailConnection,
    token_json: dict,
    account_email: str,
    mailbox_name: str,
) -> UserMailConnection:
    connection.status = "connected"
    connection.account_email = account_email
    connection.scopes = token_json.get("scope", "").split()
    _set_oauth_connection_token(connection, "access_token", token_json.get("access_token"))
    if token_json.get("refresh_token"):
        _set_oauth_connection_token(connection, "refresh_token", token_json["refresh_token"])
    connection.token_expires_at = _token_expiry(token_json)
    connection.provider_mailbox_id = account_email
    connection.provider_mailbox_name = mailbox_name
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def upsert_google_mail_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    token_json: dict,
    account_email: str,
) -> UserMailConnection:
    connection = _get_oauth_mail_connection(db, tenant_id=tenant_id, user_id=user.id, provider=MailProvider.google)
    normalized_account_email = account_email.strip().lower()
    if not normalized_account_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google account email is missing.")
    expected_account_email = (user.email or "").strip().lower()
    if not connection and expected_account_email and normalized_account_email != expected_account_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Google account email does not match the signed-in user.",
        )
    if connection and connection.account_email and connection.account_email.lower() != normalized_account_email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Google returned a different mailbox account. Disconnect Gmail before connecting another account.",
        )
    if not connection:
        connection = UserMailConnection(
            tenant_id=tenant_id,
            user_id=user.id,
            provider=MailProvider.google.value,
        )
    return _apply_oauth_mail_connection_state(
        db,
        connection=connection,
        token_json=token_json,
        account_email=normalized_account_email,
        mailbox_name="Gmail Inbox",
    )


def upsert_microsoft_mail_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    token_json: dict,
    account_email: str,
) -> UserMailConnection:
    connection = _get_oauth_mail_connection(db, tenant_id=tenant_id, user_id=user.id, provider=MailProvider.microsoft)
    if not connection:
        connection = UserMailConnection(
            tenant_id=tenant_id,
            user_id=user.id,
            provider=MailProvider.microsoft.value,
        )
    return _apply_oauth_mail_connection_state(
        db,
        connection=connection,
        token_json=token_json,
        account_email=account_email,
        mailbox_name="Outlook Inbox",
    )


def _mail_ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()


def _connect_imap(host: str, port: int, security: str):
    if security == "ssl":
        return imaplib.IMAP4_SSL(host, port, ssl_context=_mail_ssl_context(), timeout=20)
    client = imaplib.IMAP4(host, port, timeout=20)
    if security == "starttls":
        client.starttls(ssl_context=_mail_ssl_context())
    return client


def _connect_smtp(host: str, port: int, security: str):
    if security == "ssl":
        return smtplib.SMTP_SSL(host, port, timeout=20, context=_mail_ssl_context())
    client = smtplib.SMTP(host, port, timeout=20)
    if security == "starttls":
        client.starttls(context=_mail_ssl_context())
    return client


def _mail_provider_error(exc: Exception, *, protocol: str) -> str:
    if isinstance(exc, imaplib.IMAP4.error):
        raw = str(exc).lower()
        if "invalid credentials" in raw or "authenticationfailed" in raw or "auth" in raw:
            return f"{protocol} authentication failed. For Gmail IMAP/SMTP, enable IMAP and use a Google app password."
        return f"{protocol} server rejected the request: {exc}"
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return f"{protocol} authentication failed. For Gmail SMTP, use a Google app password instead of the normal account password."
    if isinstance(exc, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected, TimeoutError, OSError)):
        return f"{protocol} server connection failed. Check host, port, security mode, and firewall access."
    if isinstance(exc, ssl.SSLError):
        return f"{protocol} TLS negotiation failed. Check the selected security mode and port."
    return str(exc)


def _test_imap_connection(*, host: str, port: int, security: str, username: str, password: str) -> None:
    client = None
    try:
        client = _connect_imap(host, port, security)
        client.login(username, password)
        client.logout()
    finally:
        if client is not None:
            try:
                client.shutdown()
            except Exception:
                pass


def _test_smtp_connection(*, host: str, port: int, security: str, username: str, password: str) -> None:
    client = None
    try:
        client = _connect_smtp(host, port, security)
        client.login(username, password)
    finally:
        if client is not None:
            try:
                client.quit()
            except Exception:
                pass


def upsert_imap_smtp_mail_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    payload: dict,
) -> UserMailConnection:
    imap_username = payload["imap_username"].strip()
    smtp_username = (payload.get("smtp_username") or imap_username).strip()
    password = payload["password"]
    try:
        _test_imap_connection(
            host=payload["imap_host"].strip(),
            port=int(payload["imap_port"]),
            security=payload["imap_security"],
            username=imap_username,
            password=password,
        )
        _test_smtp_connection(
            host=payload["smtp_host"].strip(),
            port=int(payload["smtp_port"]),
            security=payload["smtp_security"],
            username=smtp_username,
            password=password,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to verify IMAP/SMTP settings: {_mail_provider_error(exc, protocol='Mailbox')}",
        ) from exc

    connection = mail_repository.get_connection(db, tenant_id=tenant_id, user_id=user.id, provider=MailProvider.imap_smtp)
    if not connection:
        connection = UserMailConnection(
            tenant_id=tenant_id,
            user_id=user.id,
            provider=MailProvider.imap_smtp.value,
        )
    connection.status = "connected"
    connection.account_email = str(payload["account_email"]).strip()
    connection.scopes = ["imap.read", "smtp.send"]
    connection.imap_host = payload["imap_host"].strip()
    connection.imap_port = int(payload["imap_port"])
    connection.imap_security = payload["imap_security"]
    connection.imap_username = imap_username
    connection.smtp_host = payload["smtp_host"].strip()
    connection.smtp_port = int(payload["smtp_port"])
    connection.smtp_security = payload["smtp_security"]
    connection.smtp_username = smtp_username
    _set_mail_password(connection, password)
    connection.provider_mailbox_id = connection.account_email
    connection.provider_mailbox_name = "IMAP/SMTP Mailbox"
    connection.sync_cursor = None
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def disconnect_mail_connection(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: MailProvider,
) -> UserMailConnection:
    connection = mail_repository.get_connection(db, tenant_id=tenant_id, user_id=user_id, provider=provider)
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mail connection not found.")
    connection.status = "disconnected"
    connection.scopes = None
    _set_oauth_connection_token(connection, "access_token", None)
    _set_oauth_connection_token(connection, "refresh_token", None)
    connection.token_expires_at = None
    connection.provider_mailbox_id = None
    connection.provider_mailbox_name = None
    connection.imap_host = None
    connection.imap_port = None
    connection.imap_security = None
    connection.imap_username = None
    connection.smtp_host = None
    connection.smtp_port = None
    connection.smtp_security = None
    connection.smtp_username = None
    _set_mail_password(connection, None)
    connection.sync_cursor = None
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def _mark_mail_connection_error(db: Session, connection: UserMailConnection, detail: str) -> None:
    connection.status = "error"
    connection.last_error = detail
    db.add(connection)
    db.flush()


def _refresh_oauth_mail_token(
    db: Session,
    connection: UserMailConnection,
    *,
    token_url: str,
    token_data: dict,
    missing_refresh_detail: str,
    failed_refresh_detail: str,
) -> str:
    expires_at = connection.token_expires_at
    access_token = _oauth_connection_token(db, connection, "access_token")
    if access_token and expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at > _utcnow() + timedelta(minutes=2):
            return access_token

    refresh_token = _oauth_connection_token(db, connection, "refresh_token")
    if not refresh_token:
        _mark_mail_connection_error(db, connection, missing_refresh_detail)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)

    res = requests.post(
        token_url,
        data={**token_data, "refresh_token": refresh_token},
        timeout=20,
    )
    body = res.json()
    if not res.ok or not body.get("access_token"):
        _mark_mail_connection_error(db, connection, failed_refresh_detail)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)

    _set_oauth_connection_token(connection, "access_token", body["access_token"])
    if body.get("refresh_token"):
        _set_oauth_connection_token(connection, "refresh_token", body["refresh_token"])
    connection.token_expires_at = _token_expiry(body)
    connection.status = "connected"
    connection.last_error = None
    db.add(connection)
    db.flush()
    return body["access_token"]


def _refresh_google_mail_token(db: Session, connection: UserMailConnection) -> str:
    return _refresh_oauth_mail_token(
        db,
        connection,
        token_url=GOOGLE_TOKEN_URL,
        token_data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "grant_type": "refresh_token",
        },
        missing_refresh_detail="Reconnect Gmail to refresh mailbox access.",
        failed_refresh_detail="Failed to refresh Gmail access.",
    )


def _refresh_microsoft_mail_token(db: Session, connection: UserMailConnection) -> str:
    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Microsoft Entra mail integration is not configured.")

    return _refresh_oauth_mail_token(
        db,
        connection,
        token_url=microsoft_token_url(),
        token_data={
            "client_id": settings.MICROSOFT_CLIENT_ID,
            "client_secret": settings.MICROSOFT_CLIENT_SECRET,
            "grant_type": "refresh_token",
            "scope": microsoft_scope_string(*MICROSOFT_MAIL_SCOPES),
        },
        missing_refresh_detail="Reconnect Microsoft to refresh mailbox access.",
        failed_refresh_detail="Failed to refresh Microsoft mailbox access.",
    )


def _mail_connection_for_user(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: MailProvider,
) -> UserMailConnection:
    connection = mail_repository.get_connection(db, tenant_id=tenant_id, user_id=user_id, provider=provider, connected_only=True)
    if not connection:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Connect {provider.value} mail before sending.")
    return connection


def _decrypt_connection_password(db: Session, connection: UserMailConnection) -> str | None:
    return _mail_password(db, connection)


def _recipient_dicts(emails: list[str]) -> list[dict] | None:
    return [{"email": value, "name": None} for value in emails] or None


def _mail_header_recipients(emails: list[str]) -> str:
    return ", ".join(emails)


def _apply_email_message_recipients(message: EmailMessage, payload: dict) -> None:
    message["To"] = _mail_header_recipients(payload["to"])
    if payload.get("cc"):
        message["Cc"] = _mail_header_recipients(payload["cc"])
    if payload.get("bcc"):
        message["Bcc"] = _mail_header_recipients(payload["bcc"])


def _microsoft_recipients(emails: list[str]) -> list[dict]:
    return [{"emailAddress": {"address": value}} for value in emails]


def _normalize_source_value(value) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _full_name(first_name: str | None, last_name: str | None, fallback: str | None = None) -> str:
    return " ".join(part for part in [first_name, last_name] if part).strip() or fallback or ""


def _organization_token_values(organization: SalesOrganization | None) -> dict[str, str]:
    if not organization:
        return {}
    return {
        "id": str(organization.org_id),
        "name": organization.org_name or "",
        "email": organization.primary_email or "",
        "phone": organization.primary_phone or "",
        "website": organization.website or "",
        "industry": organization.industry or "",
    }


def _contact_token_values(contact: SalesContact | None) -> dict[str, str]:
    if not contact:
        return {}
    return {
        "id": str(contact.contact_id),
        "first_name": contact.first_name or "",
        "last_name": contact.last_name or "",
        "full_name": _full_name(contact.first_name, contact.last_name, contact.primary_email),
        "email": contact.primary_email or "",
        "primary_email": contact.primary_email or "",
        "phone": contact.contact_telephone or "",
        "title": contact.current_title or "",
        "organization_name": contact.organization_name or "",
    }


def _opportunity_token_values(opportunity: SalesOpportunity | None) -> dict[str, str]:
    if not opportunity:
        return {}
    return {
        "id": str(opportunity.opportunity_id),
        "name": opportunity.opportunity_name or "",
        "stage": opportunity.sales_stage or "",
        "client": opportunity.client or "",
        "value": opportunity.total_cost_of_project or "",
        "currency": opportunity.currency_type or "",
    }


def _quote_token_values(quote: SalesQuote | None) -> dict[str, str]:
    if not quote:
        return {}
    return {
        "id": str(quote.quote_id),
        "number": quote.quote_number or "",
        "title": quote.title or "",
        "customer_name": quote.customer_name or "",
        "status": quote.status or "",
        "currency": quote.currency or "",
        "total": str(quote.total_amount or ""),
    }


def _lead_token_values(lead) -> dict[str, str]:
    if not lead:
        return {}
    return {
        "id": str(lead.lead_id),
        "first_name": lead.first_name or "",
        "last_name": lead.last_name or "",
        "full_name": _full_name(lead.first_name, lead.last_name, lead.primary_email),
        "email": lead.primary_email or "",
        "primary_email": lead.primary_email or "",
        "phone": lead.phone or "",
        "company": lead.company or "",
        "title": lead.title or "",
        "status": lead.status or "",
    }


def _template_values_for_contact(contact: SalesContact) -> dict[str, object]:
    organization = contact.organization
    contact_values = _contact_token_values(contact)
    organization_values = _organization_token_values(organization)
    return {
        "contact": contact_values,
        "organization": organization_values,
        "customer_name": contact_values.get("full_name", ""),
        "first_name": contact_values.get("first_name", ""),
        "last_name": contact_values.get("last_name", ""),
        "primary_email": contact_values.get("primary_email", ""),
        "organization_name": organization_values.get("name") or contact_values.get("organization_name", ""),
    }


def _find_contact_for_single_recipient(db: Session, *, tenant_id: int, recipients: list[str]) -> SalesContact | None:
    if len(recipients) != 1:
        return None
    email_address = recipients[0].strip().lower()
    if not email_address:
        return None
    return (
        db.query(SalesContact)
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
            func.lower(SalesContact.primary_email) == email_address,
        )
        .first()
    )


def _mail_template_values(db: Session, *, current_user: User, payload: dict) -> dict[str, object]:
    values: dict[str, object] = {
        "user": {
            "first_name": current_user.first_name or "",
            "last_name": current_user.last_name or "",
            "full_name": _full_name(current_user.first_name, current_user.last_name, current_user.email),
            "email": current_user.email or "",
        }
    }
    module_key = _normalize_source_value(payload.get("source_module_key"))
    entity_id = _normalize_source_value(payload.get("source_entity_id"))
    contact: SalesContact | None = None
    organization: SalesOrganization | None = None
    opportunity: SalesOpportunity | None = None
    quote: SalesQuote | None = None

    if module_key == "sales_contacts" and entity_id:
        contact = db.query(SalesContact).filter(SalesContact.tenant_id == current_user.tenant_id, SalesContact.contact_id == int(entity_id), SalesContact.deleted_at.is_(None)).first()
    elif module_key == "sales_organizations" and entity_id:
        organization = db.query(SalesOrganization).filter(SalesOrganization.tenant_id == current_user.tenant_id, SalesOrganization.org_id == int(entity_id), SalesOrganization.deleted_at.is_(None)).first()
    elif module_key == "sales_opportunities" and entity_id:
        opportunity = db.query(SalesOpportunity).filter(SalesOpportunity.tenant_id == current_user.tenant_id, SalesOpportunity.opportunity_id == int(entity_id), SalesOpportunity.deleted_at.is_(None)).first()
        contact = opportunity.contact if opportunity else None
        organization = opportunity.organization if opportunity else None
    elif module_key == "sales_quotes" and entity_id:
        quote = db.query(SalesQuote).filter(SalesQuote.tenant_id == current_user.tenant_id, SalesQuote.quote_id == int(entity_id), SalesQuote.deleted_at.is_(None)).first()
        contact = quote.contact if quote else None
        organization = quote.organization if quote else None
        opportunity = quote.opportunity if quote else None
    elif module_key == "sales_leads" and entity_id:
        from app.modules.sales.models import SalesLead

        lead = db.query(SalesLead).filter(SalesLead.tenant_id == current_user.tenant_id, SalesLead.lead_id == int(entity_id), SalesLead.deleted_at.is_(None)).first()
        if lead:
            lead_values = _lead_token_values(lead)
            values["lead"] = lead_values
            values.setdefault("contact", lead_values)
            values.setdefault("organization", {"name": lead_values.get("company", "")})
    if not contact:
        contact = _find_contact_for_single_recipient(db, tenant_id=current_user.tenant_id, recipients=payload.get("to") or [])
    if contact and "contact" not in values:
        values.update(_template_values_for_contact(contact))
        organization = organization or contact.organization
    values.setdefault("contact", {})
    values.setdefault("organization", _organization_token_values(organization))
    values.setdefault("opportunity", _opportunity_token_values(opportunity))
    values.setdefault("quote", _quote_token_values(quote))
    return values


def _render_mail_template_variables(db: Session, *, current_user: User, payload: dict) -> dict:
    values = _mail_template_values(db, current_user=current_user, payload=payload)
    rendered = dict(payload)
    rendered["subject"] = render_template_text(payload.get("subject") or "", values)
    rendered["body_text"] = render_template_text(payload.get("body_text") or "", values)
    return rendered


def _resolve_mail_source_context(db: Session, *, current_user: User, payload: dict) -> dict | None:
    module_key = _normalize_source_value(payload.get("source_module_key"))
    entity_id = _normalize_source_value(payload.get("source_entity_id"))
    if not module_key and not entity_id:
        return None
    if not module_key or not entity_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mail source requires both module and record.")

    try:
        require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        config = get_record_comment_module_config(module_key)
        get_record_reference(
            db,
            tenant_id=current_user.tenant_id,
            module_key=module_key,
            entity_id=entity_id,
        )
    except HTTPException as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mail source is not available.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mail source is not available.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mail source is not available.") from exc

    return {
        "module_key": module_key,
        "entity_type": config["entity_type"],
        "entity_id": entity_id,
    }


def _log_mail_source_activity(
    db: Session,
    *,
    current_user: User,
    message: MailMessage,
    source_context: dict | None,
) -> None:
    if not source_context:
        return
    subject = message.subject or "(no subject)"
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key=source_context["module_key"],
        entity_type=source_context["entity_type"],
        entity_id=source_context["entity_id"],
        action="mail.sent",
        description=f"Sent email: {subject}",
        after_state=serialize_mail_message(message),
    )


def _send_gmail_message(
    db: Session,
    *,
    connection: UserMailConnection,
    payload: dict,
    sender_email: str,
) -> str | None:
    if GMAIL_SEND_SCOPE not in set(connection.scopes or []):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reconnect Gmail to grant send-mail access.")
    token = _refresh_google_mail_token(db, connection)
    message = EmailMessage()
    message["From"] = sender_email
    _apply_email_message_recipients(message, payload)
    message["Subject"] = payload.get("subject") or ""
    message.set_content(payload.get("body_text") or "")
    raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
    res = requests.post(
        f"{GMAIL_API_BASE}/users/me/messages/send",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"raw": raw},
        timeout=20,
    )
    body = res.json() if res.content else {}
    if not res.ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=body.get("error", {}).get("message") or "Failed to send Gmail message.")
    return body.get("id")


def _send_microsoft_message(db: Session, *, connection: UserMailConnection, payload: dict) -> None:
    token = _refresh_microsoft_mail_token(db, connection)
    res = requests.post(
        f"{MICROSOFT_GRAPH_BASE}/me/sendMail",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "message": {
                "subject": payload.get("subject") or "",
                "body": {"contentType": "Text", "content": payload.get("body_text") or ""},
                "toRecipients": _microsoft_recipients(payload["to"]),
                "ccRecipients": _microsoft_recipients(payload.get("cc") or []),
                "bccRecipients": _microsoft_recipients(payload.get("bcc") or []),
            },
            "saveToSentItems": True,
        },
        timeout=20,
    )
    if not res.ok:
        body = res.json() if res.content else {}
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=body.get("error", {}).get("message") or "Failed to send Microsoft message.")


def _append_sent_imap_message(*, connection: UserMailConnection, password: str, message: EmailMessage) -> None:
    if not connection.imap_host or not connection.imap_port or not connection.imap_username:
        return
    client = None
    append_errors: list[str] = []
    try:
        client = _connect_imap(connection.imap_host, int(connection.imap_port), connection.imap_security or "ssl")
        client.login(connection.imap_username, password)
        raw_message = message.as_bytes()
        for folder in SMTP_SENT_FOLDER_CANDIDATES:
            try:
                status_text, _ = client.append(folder, None, None, raw_message)
            except Exception as exc:
                append_errors.append(f"{folder}: {_mail_provider_error(exc, protocol='IMAP')}")
                continue
            if status_text == "OK":
                return
            append_errors.append(f"{folder}: append returned {status_text}")
        raise RuntimeError("; ".join(append_errors) or "No sent folder accepted the message.")
    finally:
        if client is not None:
            try:
                client.logout()
            except Exception:
                pass


def _send_imap_smtp_message(*, db: Session, connection: UserMailConnection, payload: dict, sender_email: str) -> str | None:
    password = _decrypt_connection_password(db, connection)
    if not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reconnect IMAP/SMTP mail to save mailbox credentials.")
    if not connection.smtp_host or not connection.smtp_port or not connection.smtp_username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reconnect IMAP/SMTP mail to complete SMTP settings.")

    message = EmailMessage()
    message_id = make_msgid()
    message["From"] = sender_email
    _apply_email_message_recipients(message, payload)
    message["Subject"] = payload.get("subject") or ""
    message["Message-ID"] = message_id
    message.set_content(payload.get("body_text") or "")

    try:
        client = _connect_smtp(connection.smtp_host, int(connection.smtp_port), connection.smtp_security or "starttls")
        try:
            client.login(connection.smtp_username, password)
            client.send_message(message)
        finally:
            client.quit()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to send SMTP message: {_mail_provider_error(exc, protocol='SMTP')}",
        ) from exc

    try:
        _append_sent_imap_message(connection=connection, password=password, message=message)
        connection.last_error = None
    except Exception as exc:
        connection.last_error = f"SMTP sent, but IMAP sent-folder append failed: {_mail_provider_error(exc, protocol='IMAP')}"
        logger.warning(
            "IMAP sent-folder append failed after SMTP send",
            extra={
                "tenant_id": connection.tenant_id,
                "user_id": connection.user_id,
                "connection_id": connection.id,
                "provider": connection.provider,
            },
            exc_info=True,
        )
    return message_id


def send_mail_message(db: Session, *, current_user: User, payload: dict) -> MailMessage:
    provider = MailProvider(payload["provider"])
    source_context = _resolve_mail_source_context(db, current_user=current_user, payload=payload)
    payload = _render_mail_template_variables(db, current_user=current_user, payload=payload)
    connection = _mail_connection_for_user(
        db,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        provider=provider,
    )
    provider_message_id = None
    if provider == MailProvider.google:
        provider_message_id = _send_gmail_message(
            db,
            connection=connection,
            payload=payload,
            sender_email=connection.account_email or current_user.email,
        )
    elif provider == MailProvider.microsoft:
        _send_microsoft_message(db, connection=connection, payload=payload)
    else:
        provider_message_id = _send_imap_smtp_message(
            db=db,
            connection=connection,
            payload=payload,
            sender_email=connection.account_email or current_user.email,
        )

    now = _utcnow()
    message = MailMessage(
        tenant_id=current_user.tenant_id,
        owner_user_id=current_user.id,
        connection_id=connection.id,
        provider=provider.value,
        provider_message_id=provider_message_id,
        direction="outbound",
        folder="sent",
        from_email=connection.account_email or current_user.email,
        to_recipients=_recipient_dicts(payload["to"]),
        cc_recipients=_recipient_dicts(payload.get("cc") or []),
        bcc_recipients=_recipient_dicts(payload.get("bcc") or []),
        subject=payload.get("subject") or None,
        snippet=(payload.get("body_text") or "")[:300] or None,
        body_text=payload.get("body_text") or None,
        sent_at=now,
        source_module_key=payload.get("source_module_key"),
        source_entity_id=payload.get("source_entity_id"),
        source_label=payload.get("source_label"),
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    try:
        _log_mail_source_activity(db, current_user=current_user, message=message, source_context=source_context)
    except Exception:
        db.rollback()
        logger.exception(
            "Mail source activity logging failed after mail send",
            extra={
                "tenant_id": current_user.tenant_id,
                "user_id": current_user.id,
                "connection_id": connection.id,
                "message_id": message.id,
                "provider": provider.value,
                "source_module_key": payload.get("source_module_key"),
                "source_entity_id": payload.get("source_entity_id"),
            },
        )
    return message


def _header(headers: list[dict], name: str) -> str | None:
    lowered = name.lower()
    for item in headers:
        if str(item.get("name", "")).lower() == lowered:
            return item.get("value")
    return None


def _parse_address(value: str | None) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    name, address = email.utils.parseaddr(value)
    return address or None, name or None


def _parse_recipients(value: str | None) -> list[dict] | None:
    if not value:
        return None
    unfolded = re.sub(r"\r?\n[ \t]+", " ", value).replace("\r", " ").replace("\n", " ")
    decoded = _decoded_header(unfolded) or unfolded
    recipients = []
    for name, address in email.utils.getaddresses([decoded]):
        if address:
            recipients.append({"email": address, "name": name or None})
    return recipients or None


def _parse_message_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _extract_text_payload(payload: dict | None) -> str | None:
    if not payload:
        return None
    if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
        data = payload["body"]["data"]
        try:
            return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")
        except Exception:
            return None
    for part in payload.get("parts") or []:
        extracted = _extract_text_payload(part)
        if extracted:
            return extracted
    return None


def _sync_google_message(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    connection: UserMailConnection,
    message_payload: dict,
) -> bool:
    provider_message_id = message_payload.get("id")
    if not provider_message_id:
        return False
    headers = message_payload.get("payload", {}).get("headers") or []
    from_email, from_name = _parse_address(_header(headers, "From"))
    subject = _header(headers, "Subject")
    received_at = _parse_message_datetime(_header(headers, "Date"))
    existing = mail_repository.find_message_by_provider_id(
        db,
        tenant_id=tenant_id,
        connection_id=connection.id,
        provider_message_id=provider_message_id,
    )
    message = existing or MailMessage(
        tenant_id=tenant_id,
        owner_user_id=user_id,
        connection_id=connection.id,
        provider=MailProvider.google.value,
        provider_message_id=provider_message_id,
    )
    message.provider_thread_id = message_payload.get("threadId")
    message.direction = "inbound"
    message.folder = "inbox"
    message.from_email = from_email
    message.from_name = from_name
    message.to_recipients = _parse_recipients(_header(headers, "To"))
    message.cc_recipients = _parse_recipients(_header(headers, "Cc"))
    message.subject = subject
    message.snippet = message_payload.get("snippet")
    message.body_text = _extract_text_payload(message_payload.get("payload"))
    message.received_at = received_at
    message.deleted_at = None
    db.add(message)
    return existing is None


def sync_google_inbox(db: Session, *, current_user: User, max_results: int = 25) -> dict:
    if not settings.GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Gmail inbox sync is disabled because it requires restricted Google scopes. "
                "Enable GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED only after restricted-scope verification is planned."
            ),
        )
    connection = mail_repository.get_connection(db, tenant_id=current_user.tenant_id, user_id=current_user.id, provider=MailProvider.google)
    if not connection or connection.status != "connected":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect Gmail before syncing the inbox.")

    token = _refresh_google_mail_token(db, connection)
    headers = {"Authorization": f"Bearer {token}"}
    synced = 0
    try:
        list_res = requests.get(
            f"{GMAIL_API_BASE}/users/me/messages",
            headers=headers,
            params={"labelIds": "INBOX", "maxResults": max_results, "fields": GMAIL_MESSAGE_LIST_FIELDS},
            timeout=20,
        )
        list_body = list_res.json()
        if not list_res.ok:
            raise RuntimeError(list_body.get("error", {}).get("message") or "Failed to list Gmail messages.")
        for item in list_body.get("messages") or []:
            message_id = item.get("id")
            if not message_id:
                continue
            detail_res = requests.get(
                f"{GMAIL_API_BASE}/users/me/messages/{message_id}",
                headers=headers,
                params={"format": "full", "fields": GMAIL_MESSAGE_DETAIL_FIELDS},
                timeout=20,
            )
            detail_body = detail_res.json()
            if not detail_res.ok:
                continue
            if _sync_google_message(
                db,
                tenant_id=current_user.tenant_id,
                user_id=current_user.id,
                connection=connection,
                message_payload=detail_body,
            ):
                synced += 1
        connection.status = "connected"
        connection.last_synced_at = _utcnow()
        connection.last_error = None
        db.add(connection)
        db.commit()
    except Exception as exc:
        db.rollback()
        connection = mail_repository.get_connection(db, tenant_id=current_user.tenant_id, user_id=current_user.id, provider=MailProvider.google)
        if connection is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        connection.status = "error"
        connection.last_error = str(exc)
        db.add(connection)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)

    return {
        "provider": MailProvider.google.value,
        "synced_message_count": synced,
        "status": connection.status,
        "last_synced_at": connection.last_synced_at,
        "last_error": connection.last_error,
    }


def _decoded_header(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def _extract_email_text(message: email.message.Message) -> str | None:
    if message.is_multipart():
        text_parts: list[str] = []
        for part in message.walk():
            if part.get_content_disposition() == "attachment":
                continue
            if part.get_content_type() != "text/plain":
                continue
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            charset = part.get_content_charset() or "utf-8"
            text_parts.append(payload.decode(charset, errors="replace"))
        return max(text_parts, key=len) if text_parts else None
    payload = message.get_payload(decode=True)
    if payload is None:
        body = message.get_payload()
        return body if isinstance(body, str) else None
    charset = message.get_content_charset() or "utf-8"
    return payload.decode(charset, errors="replace")


def _sync_imap_message(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    connection: UserMailConnection,
    uid: str,
    raw_message: bytes,
) -> bool:
    provider_message_id = f"imap:{uid}"
    parsed = email.message_from_bytes(raw_message, policy=default_email_policy)
    from_email, from_name = _parse_address(str(parsed.get("From") or ""))
    subject = _decoded_header(str(parsed.get("Subject") or "")) or None
    body_text = _extract_email_text(parsed)
    existing = mail_repository.find_message_by_provider_id(
        db,
        tenant_id=tenant_id,
        connection_id=connection.id,
        provider_message_id=provider_message_id,
    )
    message = existing or MailMessage(
        tenant_id=tenant_id,
        owner_user_id=user_id,
        connection_id=connection.id,
        provider=MailProvider.imap_smtp.value,
        provider_message_id=provider_message_id,
    )
    message.provider_thread_id = str(parsed.get("Message-ID") or "")[:255] or None
    message.direction = "inbound"
    message.folder = "inbox"
    message.from_email = from_email
    message.from_name = from_name
    message.to_recipients = _parse_recipients(str(parsed.get("To") or ""))
    message.cc_recipients = _parse_recipients(str(parsed.get("Cc") or ""))
    message.bcc_recipients = _parse_recipients(str(parsed.get("Bcc") or ""))
    message.subject = subject
    message.snippet = (body_text or "")[:300] or None
    message.body_text = body_text
    message.received_at = _parse_message_datetime(str(parsed.get("Date") or ""))
    message.deleted_at = None
    db.add(message)
    return existing is None


def sync_imap_smtp_inbox(db: Session, *, current_user: User, max_results: int = 25) -> dict:
    connection = mail_repository.get_connection(db, tenant_id=current_user.tenant_id, user_id=current_user.id, provider=MailProvider.imap_smtp)
    if not connection or connection.status != "connected":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect IMAP/SMTP mail before syncing the inbox.")
    password = _decrypt_connection_password(db, connection)
    if not password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reconnect IMAP/SMTP mail to save mailbox credentials.")
    if not connection.imap_host or not connection.imap_port or not connection.imap_username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Reconnect IMAP/SMTP mail to complete IMAP settings.")

    client = None
    synced = 0
    try:
        client = _connect_imap(connection.imap_host, int(connection.imap_port), connection.imap_security or "ssl")
        client.login(connection.imap_username, password)
        status_text, _ = client.select("INBOX")
        if status_text != "OK":
            raise RuntimeError("Failed to open IMAP inbox.")
        search_criteria = IMAP_FULL_SYNC_SEARCH
        last_seen_uid = int(connection.sync_cursor) if str(connection.sync_cursor or "").isdigit() else None
        if last_seen_uid:
            search_criteria = f"UID {last_seen_uid + 1}:*"
        status_text, data = client.uid("search", None, search_criteria)
        if status_text != "OK":
            raise RuntimeError("Failed to list IMAP messages.")
        uid_numbers = sorted(
            {
                int(uid_bytes.decode("ascii", errors="ignore"))
                for uid_bytes in (data[0] or b"").split()
                if uid_bytes.decode("ascii", errors="ignore").isdigit()
            }
        )
        if last_seen_uid:
            uid_numbers = [uid for uid in uid_numbers if uid > last_seen_uid]
        selected_uids = uid_numbers[-max_results:] if not last_seen_uid else uid_numbers[:max_results]
        max_seen_uid = last_seen_uid or 0
        for uid_number in selected_uids:
            uid = str(uid_number)
            max_seen_uid = max(max_seen_uid, uid_number)
            status_text, fetch_data = client.uid("fetch", uid, "(RFC822)")
            if status_text != "OK":
                continue
            raw_message = None
            for item in fetch_data:
                if isinstance(item, tuple) and len(item) >= 2 and isinstance(item[1], bytes):
                    raw_message = item[1]
                    break
            if not raw_message:
                continue
            if _sync_imap_message(
                db,
                tenant_id=current_user.tenant_id,
                user_id=current_user.id,
                connection=connection,
                uid=uid,
                raw_message=raw_message,
            ):
                synced += 1
        connection.status = "connected"
        if max_seen_uid:
            connection.sync_cursor = str(max_seen_uid)
        connection.last_synced_at = _utcnow()
        connection.last_error = None
        db.add(connection)
        db.commit()
    except Exception as exc:
        db.rollback()
        connection = mail_repository.get_connection(db, tenant_id=current_user.tenant_id, user_id=current_user.id, provider=MailProvider.imap_smtp)
        if connection is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        connection.status = "error"
        connection.last_error = str(exc)
        db.add(connection)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error) from exc
    finally:
        if client is not None:
            try:
                client.logout()
            except Exception:
                pass

    return {
        "provider": MailProvider.imap_smtp.value,
        "synced_message_count": synced,
        "status": connection.status,
        "last_synced_at": connection.last_synced_at,
        "last_error": connection.last_error,
    }


def _recipient_from_graph(value: dict | None) -> dict | None:
    email_address = (value or {}).get("emailAddress") or {}
    address = email_address.get("address")
    if not address:
        return None
    return {"email": address, "name": email_address.get("name")}


def _recipients_from_graph(values: list[dict] | None) -> list[dict] | None:
    recipients = [_recipient_from_graph(value) for value in (values or [])]
    filtered = [recipient for recipient in recipients if recipient]
    return filtered or None


def _parse_iso_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _sync_microsoft_message(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    connection: UserMailConnection,
    message_payload: dict,
) -> bool:
    provider_message_id = message_payload.get("id")
    if not provider_message_id:
        return False
    sender = _recipient_from_graph(message_payload.get("from"))
    existing = mail_repository.find_message_by_provider_id(
        db,
        tenant_id=tenant_id,
        connection_id=connection.id,
        provider_message_id=provider_message_id,
    )
    message = existing or MailMessage(
        tenant_id=tenant_id,
        owner_user_id=user_id,
        connection_id=connection.id,
        provider=MailProvider.microsoft.value,
        provider_message_id=provider_message_id,
    )
    message.provider_thread_id = message_payload.get("conversationId")
    message.direction = "inbound"
    message.folder = "inbox"
    message.from_email = sender["email"] if sender else None
    message.from_name = sender.get("name") if sender else None
    message.to_recipients = _recipients_from_graph(message_payload.get("toRecipients"))
    message.cc_recipients = _recipients_from_graph(message_payload.get("ccRecipients"))
    message.bcc_recipients = _recipients_from_graph(message_payload.get("bccRecipients"))
    message.subject = message_payload.get("subject")
    message.snippet = message_payload.get("bodyPreview")
    message.received_at = _parse_iso_datetime(message_payload.get("receivedDateTime"))
    message.sent_at = _parse_iso_datetime(message_payload.get("sentDateTime"))
    message.deleted_at = None
    db.add(message)
    return existing is None


def sync_microsoft_inbox(db: Session, *, current_user: User, max_results: int = 25) -> dict:
    connection = mail_repository.get_connection(db, tenant_id=current_user.tenant_id, user_id=current_user.id, provider=MailProvider.microsoft)
    if not connection or connection.status != "connected":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect Microsoft before syncing the inbox.")

    token = _refresh_microsoft_mail_token(db, connection)
    headers = {"Authorization": f"Bearer {token}"}
    synced = 0
    try:
        res = requests.get(
            f"{MICROSOFT_GRAPH_BASE}/me/mailFolders/inbox/messages",
            headers=headers,
            params={
                "$top": max_results,
                "$select": "id,conversationId,subject,bodyPreview,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,sentDateTime",
                "$orderby": "receivedDateTime desc",
            },
            timeout=20,
        )
        body = res.json()
        if not res.ok:
            raise RuntimeError(body.get("error", {}).get("message") or "Failed to list Microsoft inbox messages.")
        for item in body.get("value") or []:
            if _sync_microsoft_message(
                db,
                tenant_id=current_user.tenant_id,
                user_id=current_user.id,
                connection=connection,
                message_payload=item,
            ):
                synced += 1
        connection.status = "connected"
        connection.last_synced_at = _utcnow()
        connection.last_error = None
        db.add(connection)
        db.commit()
    except Exception as exc:
        connection.status = "error"
        connection.last_error = str(exc)
        db.add(connection)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)

    return {
        "provider": MailProvider.microsoft.value,
        "synced_message_count": synced,
        "status": connection.status,
        "last_synced_at": connection.last_synced_at,
        "last_error": connection.last_error,
    }


def handle_google_mail_callback(
    code: str,
    db: Session,
    *,
    tenant: Tenant,
    request: Request,
    state_payload: dict,
) -> dict:
    user = mail_repository.get_user(db, tenant_id=tenant.id, user_id=int(state_payload["user_id"]))
    if not user or user.is_active != UserStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mailbox user is not active")

    token_res = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": get_google_redirect_uri_for_request(request),
            "grant_type": "authorization_code",
        },
        timeout=20,
    )
    token_json = token_res.json()
    if not token_res.ok or "access_token" not in token_json:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to connect Gmail")

    profile_res = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {token_json['access_token']}"},
        timeout=20,
    )
    profile = profile_res.json()
    account_email = profile.get("email") or user.email
    upsert_google_mail_connection(
        db,
        tenant_id=tenant.id,
        user=user,
        token_json=token_json,
        account_email=account_email,
    )
    sync_result = (
        sync_google_inbox(db, current_user=user, max_results=10)
        if settings.GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED
        else {
            "provider": MailProvider.google.value,
            "synced_message_count": 0,
            "status": "connected",
            "last_synced_at": None,
            "last_error": None,
        }
    )
    return {"status": "connected", "user": user, "sync": sync_result}


def handle_microsoft_mail_callback(
    code: str,
    db: Session,
    *,
    tenant: Tenant,
    request: Request,
    state_payload: dict,
) -> dict:
    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Microsoft Entra mail integration is not configured.")
    user = mail_repository.get_user(db, tenant_id=tenant.id, user_id=int(state_payload["user_id"]))
    if not user or user.is_active != UserStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mailbox user is not active")

    token_res = requests.post(
        microsoft_token_url(),
        data={
            "client_id": settings.MICROSOFT_CLIENT_ID,
            "client_secret": settings.MICROSOFT_CLIENT_SECRET,
            "code": code,
            "redirect_uri": get_microsoft_redirect_uri_for_request(request),
            "grant_type": "authorization_code",
            "scope": microsoft_scope_string(*MICROSOFT_MAIL_SCOPES),
        },
        timeout=20,
    )
    token_json = token_res.json()
    if not token_res.ok or "access_token" not in token_json:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to connect Microsoft mailbox")

    profile_res = requests.get(
        f"{MICROSOFT_GRAPH_BASE}/me",
        headers={"Authorization": f"Bearer {token_json['access_token']}"},
        timeout=20,
    )
    profile = profile_res.json()
    account_email = profile.get("mail") or profile.get("userPrincipalName") or user.email
    upsert_microsoft_mail_connection(
        db,
        tenant_id=tenant.id,
        user=user,
        token_json=token_json,
        account_email=account_email,
    )
    sync_result = sync_microsoft_inbox(db, current_user=user, max_results=10)
    return {"status": "connected", "user": user, "sync": sync_result}


def ensure_disconnected_mail_connection(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: MailProvider,
) -> UserMailConnection:
    connection = mail_repository.get_connection(db, tenant_id=tenant_id, user_id=user_id, provider=provider)
    if connection:
        return connection
    connection = UserMailConnection(
        tenant_id=tenant_id,
        user_id=user_id,
        provider=provider.value,
        status="disconnected",
    )
    db.add(connection)
    db.flush()
    return connection
