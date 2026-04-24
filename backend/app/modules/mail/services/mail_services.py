from __future__ import annotations

import base64
import email.utils
import urllib.parse
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import requests
from fastapi import HTTPException, Request, status
from jose import jwt, JWTError
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.core.tenancy import (
    get_frontend_origin_for_request,
    get_google_redirect_uri_for_request,
    get_microsoft_redirect_uri_for_request,
)
from app.modules.mail.models import MailMessage, UserMailConnection
from app.modules.mail.schema import MailProvider
from app.modules.user_management.models import Tenant, User, UserStatus


GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"
GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MICROSOFT_MAIL_SCOPES = "offline_access User.Read Mail.Read Mail.Send"
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
        "can_send": (
            connection.status == "connected"
            and (
                (connection.provider == MailProvider.google.value and GMAIL_SEND_SCOPE in scopes)
                or (connection.provider == MailProvider.microsoft.value and "Mail.Send" in scopes)
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
            )
        ),
        "last_synced_at": connection.last_synced_at,
        "last_error": connection.last_error,
    }


def build_mail_context(db: Session, *, tenant_id: int, current_user) -> dict:
    connections = (
        db.query(UserMailConnection)
        .filter(
            UserMailConnection.tenant_id == tenant_id,
            UserMailConnection.user_id == current_user.id,
        )
        .order_by(UserMailConnection.provider.asc(), UserMailConnection.id.asc())
        .all()
    )
    connected = any(connection.status == "connected" for connection in connections)
    can_sync = any(_serialize_connection(connection)["can_sync"] for connection in connections)
    return {
        "connections": [_serialize_connection(connection) for connection in connections],
        "sync_available": can_sync,
        "sync_note": (
            "Mailbox sync is available for this account."
            if can_sync
            else (
                "Mailbox sending is connected, but inbox sync is not available for this provider/scope."
                if connected
                else "Mailbox sync is not connected yet. Google and Microsoft mail should use an explicit connect flow before requesting mailbox scopes."
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
) -> list[MailMessage]:
    query = db.query(MailMessage).filter(
        MailMessage.tenant_id == tenant_id,
        MailMessage.owner_user_id == current_user.id,
        MailMessage.deleted_at.is_(None),
    )
    if folder:
        query = query.filter(MailMessage.folder == folder)
    if search and search.strip():
        query = apply_ranked_search(
            query,
            search=search.strip(),
            document=searchable_text(
                MailMessage.subject,
                MailMessage.snippet,
                MailMessage.from_email,
                MailMessage.from_name,
                MailMessage.source_label,
            ),
            default_order_column=MailMessage.created_at,
        )
    return (
        query
        .filter(
            or_(
                MailMessage.received_at.is_not(None),
                MailMessage.sent_at.is_not(None),
                MailMessage.created_at.is_not(None),
            )
        )
        .order_by(MailMessage.received_at.desc().nullslast(), MailMessage.sent_at.desc().nullslast(), MailMessage.created_at.desc())
        .limit(limit)
        .all()
    )


def get_mail_message_or_404(
    db: Session,
    message_id: int,
    *,
    tenant_id: int,
    current_user,
) -> MailMessage:
    message = (
        db.query(MailMessage)
        .filter(
            MailMessage.id == message_id,
            MailMessage.tenant_id == tenant_id,
            MailMessage.owner_user_id == current_user.id,
            MailMessage.deleted_at.is_(None),
        )
        .first()
    )
    if not message:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mail message not found")
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
        "scope": MICROSOFT_MAIL_SCOPES,
        "response_mode": "query",
        "state": _create_mail_oauth_state(
            tenant=tenant,
            user=user,
            provider=MailProvider.microsoft,
            frontend_origin=get_frontend_origin_for_request(request),
        ),
    }
    return MICROSOFT_AUTH_URL + "?" + urllib.parse.urlencode(params)


def _token_expiry(token_json: dict) -> datetime | None:
    expires_in = token_json.get("expires_in")
    if not expires_in:
        return None
    return _utcnow() + timedelta(seconds=int(expires_in))


def upsert_google_mail_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    token_json: dict,
    account_email: str,
) -> UserMailConnection:
    connection = (
        db.query(UserMailConnection)
        .filter(
            UserMailConnection.tenant_id == tenant_id,
            UserMailConnection.user_id == user.id,
            UserMailConnection.provider == MailProvider.google.value,
        )
        .first()
    )
    if not connection:
        connection = UserMailConnection(
            tenant_id=tenant_id,
            user_id=user.id,
            provider=MailProvider.google.value,
        )
    connection.status = "connected"
    connection.account_email = account_email
    connection.scopes = token_json.get("scope", "").split()
    connection.access_token = token_json.get("access_token")
    if token_json.get("refresh_token"):
        connection.refresh_token = token_json["refresh_token"]
    connection.token_expires_at = _token_expiry(token_json)
    connection.provider_mailbox_id = account_email
    connection.provider_mailbox_name = "Gmail Inbox"
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def upsert_microsoft_mail_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    token_json: dict,
    account_email: str,
) -> UserMailConnection:
    connection = (
        db.query(UserMailConnection)
        .filter(
            UserMailConnection.tenant_id == tenant_id,
            UserMailConnection.user_id == user.id,
            UserMailConnection.provider == MailProvider.microsoft.value,
        )
        .first()
    )
    if not connection:
        connection = UserMailConnection(
            tenant_id=tenant_id,
            user_id=user.id,
            provider=MailProvider.microsoft.value,
        )
    connection.status = "connected"
    connection.account_email = account_email
    connection.scopes = token_json.get("scope", "").split()
    connection.access_token = token_json.get("access_token")
    if token_json.get("refresh_token"):
        connection.refresh_token = token_json["refresh_token"]
    connection.token_expires_at = _token_expiry(token_json)
    connection.provider_mailbox_id = account_email
    connection.provider_mailbox_name = "Outlook Inbox"
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def _refresh_google_mail_token(db: Session, connection: UserMailConnection) -> str:
    expires_at = connection.token_expires_at
    if connection.access_token and expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at > _utcnow() + timedelta(minutes=2):
            return connection.access_token

    if not connection.refresh_token:
        connection.status = "error"
        connection.last_error = "Reconnect Gmail to refresh mailbox access."
        db.add(connection)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)

    res = requests.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": connection.refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=20,
    )
    body = res.json()
    if not res.ok or not body.get("access_token"):
        connection.status = "error"
        connection.last_error = "Failed to refresh Gmail access."
        db.add(connection)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)

    connection.access_token = body["access_token"]
    connection.token_expires_at = _token_expiry(body)
    connection.status = "connected"
    connection.last_error = None
    db.add(connection)
    db.commit()
    return connection.access_token


def _refresh_microsoft_mail_token(db: Session, connection: UserMailConnection) -> str:
    expires_at = connection.token_expires_at
    if connection.access_token and expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at > _utcnow() + timedelta(minutes=2):
            return connection.access_token

    if not connection.refresh_token:
        connection.status = "error"
        connection.last_error = "Reconnect Microsoft to refresh mailbox access."
        db.add(connection)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)

    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Microsoft Entra mail integration is not configured.")

    res = requests.post(
        MICROSOFT_TOKEN_URL,
        data={
            "client_id": settings.MICROSOFT_CLIENT_ID,
            "client_secret": settings.MICROSOFT_CLIENT_SECRET,
            "refresh_token": connection.refresh_token,
            "grant_type": "refresh_token",
            "scope": MICROSOFT_MAIL_SCOPES,
        },
        timeout=20,
    )
    body = res.json()
    if not res.ok or not body.get("access_token"):
        connection.status = "error"
        connection.last_error = "Failed to refresh Microsoft mailbox access."
        db.add(connection)
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)

    connection.access_token = body["access_token"]
    connection.token_expires_at = _token_expiry(body)
    connection.status = "connected"
    connection.last_error = None
    db.add(connection)
    db.commit()
    return connection.access_token


def _mail_connection_for_user(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: MailProvider,
) -> UserMailConnection:
    connection = (
        db.query(UserMailConnection)
        .filter(
            UserMailConnection.tenant_id == tenant_id,
            UserMailConnection.user_id == user_id,
            UserMailConnection.provider == provider.value,
            UserMailConnection.status == "connected",
        )
        .first()
    )
    if not connection:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Connect {provider.value} mail before sending.")
    return connection


def _recipient_dicts(emails: list[str]) -> list[dict] | None:
    return [{"email": value, "name": None} for value in emails] or None


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
    message["To"] = ", ".join(payload["to"])
    if payload.get("cc"):
        message["Cc"] = ", ".join(payload["cc"])
    if payload.get("bcc"):
        message["Bcc"] = ", ".join(payload["bcc"])
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

    def recipients(values: list[str]) -> list[dict]:
        return [{"emailAddress": {"address": value}} for value in values]

    res = requests.post(
        f"{MICROSOFT_GRAPH_BASE}/me/sendMail",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={
            "message": {
                "subject": payload.get("subject") or "",
                "body": {"contentType": "Text", "content": payload.get("body_text") or ""},
                "toRecipients": recipients(payload["to"]),
                "ccRecipients": recipients(payload.get("cc") or []),
                "bccRecipients": recipients(payload.get("bcc") or []),
            },
            "saveToSentItems": True,
        },
        timeout=20,
    )
    if not res.ok:
        body = res.json() if res.content else {}
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=body.get("error", {}).get("message") or "Failed to send Microsoft message.")


def send_mail_message(db: Session, *, current_user: User, payload: dict) -> MailMessage:
    provider = MailProvider(payload["provider"])
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
    else:
        _send_microsoft_message(db, connection=connection, payload=payload)

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
    recipients = []
    for name, address in email.utils.getaddresses([value]):
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
    existing = (
        db.query(MailMessage)
        .filter(
            MailMessage.tenant_id == tenant_id,
            MailMessage.connection_id == connection.id,
            MailMessage.provider_message_id == provider_message_id,
        )
        .first()
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
    connection = (
        db.query(UserMailConnection)
        .filter(
            UserMailConnection.tenant_id == current_user.tenant_id,
            UserMailConnection.user_id == current_user.id,
            UserMailConnection.provider == MailProvider.google.value,
        )
        .first()
    )
    if not connection or connection.status != "connected":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Connect Gmail before syncing the inbox.")

    token = _refresh_google_mail_token(db, connection)
    headers = {"Authorization": f"Bearer {token}"}
    synced = 0
    try:
        list_res = requests.get(
            f"{GMAIL_API_BASE}/users/me/messages",
            headers=headers,
            params={"labelIds": "INBOX", "maxResults": max_results},
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
                params={"format": "full"},
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
    existing = (
        db.query(MailMessage)
        .filter(
            MailMessage.tenant_id == tenant_id,
            MailMessage.connection_id == connection.id,
            MailMessage.provider_message_id == provider_message_id,
        )
        .first()
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
    connection = (
        db.query(UserMailConnection)
        .filter(
            UserMailConnection.tenant_id == current_user.tenant_id,
            UserMailConnection.user_id == current_user.id,
            UserMailConnection.provider == MailProvider.microsoft.value,
        )
        .first()
    )
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
    user = (
        db.query(User)
        .filter(
            User.tenant_id == tenant.id,
            User.id == int(state_payload["user_id"]),
        )
        .first()
    )
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
    user = (
        db.query(User)
        .filter(
            User.tenant_id == tenant.id,
            User.id == int(state_payload["user_id"]),
        )
        .first()
    )
    if not user or user.is_active != UserStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mailbox user is not active")

    token_res = requests.post(
        MICROSOFT_TOKEN_URL,
        data={
            "client_id": settings.MICROSOFT_CLIENT_ID,
            "client_secret": settings.MICROSOFT_CLIENT_SECRET,
            "code": code,
            "redirect_uri": get_microsoft_redirect_uri_for_request(request),
            "grant_type": "authorization_code",
            "scope": MICROSOFT_MAIL_SCOPES,
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
    connection = (
        db.query(UserMailConnection)
        .filter(
            UserMailConnection.tenant_id == tenant_id,
            UserMailConnection.user_id == user_id,
            UserMailConnection.provider == provider.value,
        )
        .first()
    )
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
