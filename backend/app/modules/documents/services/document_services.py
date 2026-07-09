from __future__ import annotations

import io
import hashlib
import logging
import time
import urllib.parse
import zipfile
from datetime import datetime, timedelta, timezone

import requests
from fastapi import HTTPException, Request, UploadFile, status
from jose import JWTError, jwt
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.core.cache import cache_acquire_lock, cache_release_lock
from app.core.config import settings
from app.core.encrypted_fields import get_encrypted_model_value, set_encrypted_model_value
from app.core.secrets import decrypt_secret_with_rotation
from app.core.microsoft_oauth import MICROSOFT_DRIVE_SCOPE, MICROSOFT_GRAPH_BASE, microsoft_auth_url, microsoft_scope_string, microsoft_token_url
from app.core.access_control import require_role_module_action_access
from app.core.tenancy import get_frontend_origin_for_request, get_google_redirect_uri_for_request, get_microsoft_redirect_uri_for_request
from app.core.uploads import UPLOAD_READ_CHUNK_BYTES, read_upload_limited
from app.modules.documents.models import Document, DocumentClientShare, DocumentLink, DocumentStorageConnection, DocumentVersion
from app.modules.documents.repositories import documents_repository
from app.modules.documents.services.storage_backends import get_document_storage_backend, supported_storage_providers
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.record_comments import get_record_comment_module_config, get_record_reference
from app.modules.sales.models import SalesContact, SalesOrganization
from app.modules.user_management.models import Tenant, User, UserStatus

DOCUMENT_CONTENT_TYPES_BY_EXTENSION = {
    "pdf": {"application/pdf"},
    "doc": {"application/msword"},
    "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    "odt": {"application/vnd.oasis.opendocument.text"},
    "rtf": {"application/rtf", "text/rtf"},
    "txt": {"text/plain"},
}
ALLOWED_DOCUMENT_EXTENSIONS = set(DOCUMENT_CONTENT_TYPES_BY_EXTENSION)
ALLOWED_DOCUMENT_CONTENT_TYPES = {content_type for values in DOCUMENT_CONTENT_TYPES_BY_EXTENSION.values() for content_type in values}
DOCUMENT_MAGIC_TYPES = {
    "pdf": b"%PDF-",
    "doc": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
    "zip": b"PK\x03\x04",
    "rtf": b"{\\rtf",
}
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
GOOGLE_DRIVE_CONNECT_STATE_TYPE = "google_drive_document_storage_state"
MICROSOFT_ONEDRIVE_CONNECT_STATE_TYPE = "microsoft_onedrive_document_storage_state"
DOCUMENT_PROVIDER_LOCAL = "local"
DOCUMENT_PROVIDER_GOOGLE_DRIVE = "google_drive"
DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE = "microsoft_onedrive"

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def document_upload_limits() -> dict:
    return {
        "allowed_extensions": sorted(ALLOWED_DOCUMENT_EXTENSIONS),
        "max_upload_bytes": settings.DOCUMENT_MAX_UPLOAD_BYTES,
        "tenant_storage_limit_bytes": settings.DOCUMENT_TENANT_STORAGE_LIMIT_BYTES,
    }


def document_storage_usage(db: Session, *, tenant_id: int) -> dict:
    used = _tenant_storage_used(db, tenant_id=tenant_id)
    limit = int(settings.DOCUMENT_TENANT_STORAGE_LIMIT_BYTES)
    remaining = max(limit - used, 0)
    return {
        "used_bytes": used,
        "tenant_storage_limit_bytes": limit,
        "remaining_bytes": remaining,
        "usage_percent": round((used / limit) * 100, 2) if limit > 0 else 0,
    }


def document_storage_providers() -> list[dict]:
    return supported_storage_providers()


def list_document_storage_connections(db: Session, *, tenant_id: int, user_id: int) -> list[DocumentStorageConnection]:
    return (
        db.query(DocumentStorageConnection)
        .filter(DocumentStorageConnection.tenant_id == tenant_id, DocumentStorageConnection.user_id == user_id)
        .order_by(DocumentStorageConnection.provider.asc())
        .all()
    )


def _safe_return_path(return_path: str | None) -> str:
    value = (return_path or "/dashboard/documents").strip()
    if not value.startswith("/") or value.startswith("//") or "\\" in value:
        return "/dashboard/documents"
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme or parsed.netloc or not parsed.path.startswith("/"):
        return "/dashboard/documents"
    return parsed.path[:300] or "/dashboard/documents"


def _create_drive_oauth_state(
    *,
    tenant: Tenant,
    user,
    frontend_origin: str,
    provider: str = DOCUMENT_PROVIDER_GOOGLE_DRIVE,
    return_path: str | None = None,
) -> str:
    now = _utcnow()
    payload = {
        "type": GOOGLE_DRIVE_CONNECT_STATE_TYPE if provider == DOCUMENT_PROVIDER_GOOGLE_DRIVE else MICROSOFT_ONEDRIVE_CONNECT_STATE_TYPE,
        "provider": provider,
        "tenant_id": tenant.id,
        "user_id": user.id,
        "frontend_origin": frontend_origin.rstrip("/"),
        "return_path": _safe_return_path(return_path),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.GOOGLE_OAUTH_STATE_EXPIRE_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_drive_oauth_state(state_token: str | None) -> dict | None:
    if not state_token:
        return None
    try:
        payload = jwt.decode(state_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") not in {GOOGLE_DRIVE_CONNECT_STATE_TYPE, MICROSOFT_ONEDRIVE_CONNECT_STATE_TYPE}:
        return None
    if payload.get("provider") not in {DOCUMENT_PROVIDER_GOOGLE_DRIVE, DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE}:
        return None
    try:
        int(payload["tenant_id"])
        int(payload["user_id"])
    except (KeyError, TypeError, ValueError):
        return None
    frontend_origin = str(payload.get("frontend_origin") or "").strip().rstrip("/")
    parsed_origin = urllib.parse.urlsplit(frontend_origin)
    if parsed_origin.scheme not in {"http", "https"} or not parsed_origin.netloc:
        return None
    payload["frontend_origin"] = frontend_origin
    payload["return_path"] = _safe_return_path(payload.get("return_path"))
    return payload


def get_google_drive_connect_url(*, request: Request, tenant: Tenant, user, return_path: str | None = None) -> str:
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": get_google_redirect_uri_for_request(request),
        "response_type": "code",
        "scope": " ".join(["openid", "email", "profile", GOOGLE_DRIVE_FILE_SCOPE]),
        "access_type": "offline",
        "prompt": "consent",
        "state": _create_drive_oauth_state(
            tenant=tenant,
            user=user,
            frontend_origin=get_frontend_origin_for_request(request),
            return_path=return_path,
        ),
    }
    return GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)


def get_microsoft_onedrive_connect_url(*, request: Request, tenant: Tenant, user, return_path: str | None = None) -> str:
    if not settings.MICROSOFT_CLIENT_ID or not settings.MICROSOFT_CLIENT_SECRET:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Microsoft OneDrive is not configured.")
    params = {
        "client_id": settings.MICROSOFT_CLIENT_ID,
        "redirect_uri": get_microsoft_redirect_uri_for_request(request),
        "response_type": "code",
        "response_mode": "query",
        "scope": microsoft_scope_string(MICROSOFT_DRIVE_SCOPE),
        "state": _create_drive_oauth_state(
            tenant=tenant,
            user=user,
            frontend_origin=get_frontend_origin_for_request(request),
            provider=DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE,
            return_path=return_path,
        ),
    }
    return microsoft_auth_url() + "?" + urllib.parse.urlencode(params)


def _token_expiry(token_json: dict) -> datetime | None:
    expires_in = token_json.get("expires_in")
    if not expires_in:
        return None
    return _utcnow() + timedelta(seconds=int(expires_in))


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _set_connection_token(connection: DocumentStorageConnection, field_name: str, value: str | None) -> None:
    set_encrypted_model_value(connection, field_name, value, key_version_field=f"{field_name}_key_version")


def _connection_token(db: Session, connection: DocumentStorageConnection, field_name: str) -> str | None:
    return get_encrypted_model_value(
        db,
        connection,
        field_name,
        key_version_field=f"{field_name}_key_version",
        legacy_decrypt=lambda value: decrypt_secret_with_rotation(value)[0],
    )


def _usable_connection_access_token(db: Session, connection: DocumentStorageConnection) -> str | None:
    expires_at = _as_utc(connection.token_expires_at)
    access_token = _connection_token(db, connection, "access_token")
    if access_token and expires_at and expires_at > _utcnow() + timedelta(minutes=1):
        return access_token
    return None


def _refresh_connection_access_token_with_lock(
    db: Session,
    connection: DocumentStorageConnection,
    *,
    provider_label: str,
    refresh,
) -> str:
    lock_key = f"document-storage-token-refresh:{connection.id}"
    token = cache_acquire_lock(lock_key, ttl_seconds=30)
    if not token:
        for _ in range(10):
            time.sleep(0.1)
            db.refresh(connection)
            access_token = _usable_connection_access_token(db, connection)
            if access_token:
                return access_token
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{provider_label} token refresh is already in progress.",
        )
    try:
        db.refresh(connection)
        access_token = _usable_connection_access_token(db, connection)
        if access_token:
            return access_token
        return refresh()
    finally:
        cache_release_lock(lock_key, token)


def _upsert_google_drive_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    token_json: dict,
    account_email: str,
) -> DocumentStorageConnection:
    connection = (
        db.query(DocumentStorageConnection)
        .filter(
            DocumentStorageConnection.tenant_id == tenant_id,
            DocumentStorageConnection.user_id == user.id,
            DocumentStorageConnection.provider == DOCUMENT_PROVIDER_GOOGLE_DRIVE,
        )
        .first()
    )
    if not connection:
        connection = DocumentStorageConnection(
            tenant_id=tenant_id,
            user_id=user.id,
            provider=DOCUMENT_PROVIDER_GOOGLE_DRIVE,
        )
        db.add(connection)
    connection.status = "connected"
    connection.account_email = account_email
    connection.scopes = token_json.get("scope", "").split()
    if token_json.get("access_token"):
        _set_connection_token(connection, "access_token", token_json["access_token"])
    if token_json.get("refresh_token"):
        _set_connection_token(connection, "refresh_token", token_json["refresh_token"])
    connection.token_expires_at = _token_expiry(token_json)
    connection.provider_root_id = "drive"
    connection.provider_root_name = "Google Drive"
    connection.last_error = None
    db.commit()
    db.refresh(connection)
    return connection


def handle_google_drive_callback(code: str, db: Session, *, tenant: Tenant, request: Request, state_payload: dict) -> dict:
    user = db.query(User).filter(User.tenant_id == tenant.id, User.id == int(state_payload["user_id"])).first()
    if not user or user.is_active != UserStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Document storage user is not active")
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to connect Google Drive")
    scopes = set(token_json.get("scope", "").split())
    if GOOGLE_DRIVE_FILE_SCOPE not in scopes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive file scope was not granted")
    profile_res = requests.get(
        GOOGLE_USERINFO_URL,
        headers={"Authorization": f"Bearer {token_json['access_token']}"},
        timeout=20,
    )
    profile = profile_res.json() if profile_res.ok else {}
    account_email = profile.get("email") or user.email
    connection = _upsert_google_drive_connection(
        db,
        tenant_id=tenant.id,
        user=user,
        token_json=token_json,
        account_email=account_email,
    )
    return {"provider": connection.provider, "status": connection.status}


def handle_microsoft_onedrive_callback(code: str, db: Session, *, tenant: Tenant, request: Request, state_payload: dict) -> dict:
    user = db.query(User).filter(User.tenant_id == tenant.id, User.id == int(state_payload["user_id"])).first()
    if not user or user.is_active != UserStatus.active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Document storage user is not active")
    token_res = requests.post(
        microsoft_token_url(),
        data={
            "code": code,
            "client_id": settings.MICROSOFT_CLIENT_ID,
            "client_secret": settings.MICROSOFT_CLIENT_SECRET,
            "redirect_uri": get_microsoft_redirect_uri_for_request(request),
            "grant_type": "authorization_code",
            "scope": microsoft_scope_string(MICROSOFT_DRIVE_SCOPE),
        },
        timeout=20,
    )
    token_json = token_res.json()
    if not token_res.ok or "access_token" not in token_json:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to connect Microsoft OneDrive")
    if MICROSOFT_DRIVE_SCOPE not in set(token_json.get("scope", "").split()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Microsoft OneDrive file scope was not granted")
    profile_res = requests.get(f"{MICROSOFT_GRAPH_BASE}/me", headers={"Authorization": f"Bearer {token_json['access_token']}"}, timeout=20)
    profile = profile_res.json() if profile_res.ok else {}
    drive_res = requests.get(f"{MICROSOFT_GRAPH_BASE}/me/drive/special/approot", headers={"Authorization": f"Bearer {token_json['access_token']}"}, timeout=20)
    drive = drive_res.json() if drive_res.ok else {}
    connection = _upsert_document_storage_connection(
        db,
        tenant_id=tenant.id,
        user=user,
        provider=DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE,
        token_json=token_json,
        account_email=profile.get("mail") or profile.get("userPrincipalName") or user.email,
        provider_root_id=drive.get("id") or "drive",
        provider_root_name=drive.get("name") or "Microsoft OneDrive App Folder",
    )
    return {"provider": connection.provider, "status": connection.status}


def _upsert_document_storage_connection(
    db: Session,
    *,
    tenant_id: int,
    user: User,
    provider: str,
    token_json: dict,
    account_email: str,
    provider_root_id: str,
    provider_root_name: str,
) -> DocumentStorageConnection:
    connection = (
        db.query(DocumentStorageConnection)
        .filter(
            DocumentStorageConnection.tenant_id == tenant_id,
            DocumentStorageConnection.user_id == user.id,
            DocumentStorageConnection.provider == provider,
        )
        .first()
    )
    if not connection:
        connection = DocumentStorageConnection(tenant_id=tenant_id, user_id=user.id, provider=provider)
    connection.status = "connected"
    connection.account_email = account_email
    connection.scopes = token_json.get("scope", "").split()
    if token_json.get("access_token"):
        _set_connection_token(connection, "access_token", token_json["access_token"])
    if token_json.get("refresh_token"):
        _set_connection_token(connection, "refresh_token", token_json["refresh_token"])
    connection.token_expires_at = _token_expiry(token_json)
    connection.provider_root_id = provider_root_id
    connection.provider_root_name = provider_root_name
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def disconnect_document_storage_connection(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: str,
) -> DocumentStorageConnection:
    if provider not in {DOCUMENT_PROVIDER_GOOGLE_DRIVE, DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported document storage provider.")
    connection = _document_storage_connection(db, tenant_id=tenant_id, user_id=user_id, provider=provider, connected_only=False)
    connection.status = "disconnected"
    _set_connection_token(connection, "access_token", None)
    _set_connection_token(connection, "refresh_token", None)
    connection.token_expires_at = None
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def _validate_document_upload_content(file: UploadFile, content: bytes) -> tuple[bytes, str, str, str]:
    filename = (file.filename or "").strip()
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_DOCUMENT_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported document type. Allowed types: .pdf, .doc, .docx, .txt, .rtf, .odt",
        )

    declared_content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if declared_content_type and declared_content_type not in ALLOWED_DOCUMENT_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported document content type.")

    detected_content_type = _validate_document_signature(content, extension)
    if declared_content_type and declared_content_type not in DOCUMENT_CONTENT_TYPES_BY_EXTENSION[extension]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document content type does not match file extension.")
    return content, extension, declared_content_type or detected_content_type, filename


async def read_document_upload(file: UploadFile) -> tuple[bytes, str, str, str]:
    content = await read_upload_limited(
        file,
        max_bytes=settings.DOCUMENT_MAX_UPLOAD_BYTES,
        empty_detail="Uploaded document is empty.",
        oversize_detail=f"Document exceeds the {settings.DOCUMENT_MAX_UPLOAD_BYTES} byte upload limit.",
    )
    return _validate_document_upload_content(file, content)


def read_document_upload_sync(file: UploadFile) -> tuple[bytes, str, str, str]:
    chunks: list[bytes] = []
    total_bytes = 0
    while True:
        chunk = file.file.read(UPLOAD_READ_CHUNK_BYTES)
        if not chunk:
            break
        total_bytes += len(chunk)
        if total_bytes > settings.DOCUMENT_MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Document exceeds the {settings.DOCUMENT_MAX_UPLOAD_BYTES} byte upload limit.",
            )
        chunks.append(chunk)
    content = b"".join(chunks)
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded document is empty.")
    return _validate_document_upload_content(file, content)


def _validate_document_signature(content: bytes, extension: str) -> str:
    _reject_document_polyglot(content, extension)
    if extension == "pdf":
        if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-2048:]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded PDF content is invalid.")
        return "application/pdf"
    if extension == "docx":
        names = _zip_member_names(content)
        if "[Content_Types].xml" not in names or not any(name.startswith("word/") for name in names):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded DOCX content is invalid.")
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if extension == "odt":
        names = _zip_member_names(content)
        if "mimetype" not in names:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded ODT content is invalid.")
        try:
            with zipfile.ZipFile(io.BytesIO(content)) as archive:
                mimetype = archive.read("mimetype").decode("utf-8").strip()
        except (KeyError, UnicodeDecodeError, zipfile.BadZipFile) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded ODT content is invalid.") from exc
        if mimetype != "application/vnd.oasis.opendocument.text":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded ODT content is invalid.")
        return "application/vnd.oasis.opendocument.text"
    if extension == "doc" and not content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded DOC content is invalid.")
    if extension == "doc":
        return "application/msword"
    if extension in {"txt", "rtf"}:
        try:
            content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                content.decode("latin-1")
            except UnicodeDecodeError as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded text document is invalid.") from exc
    if extension == "rtf" and not content.lstrip().startswith(b"{\\rtf"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded RTF content is invalid.")
    if extension == "rtf":
        return "application/rtf"
    return "text/plain"


def _reject_document_polyglot(content: bytes, extension: str) -> None:
    lstripped = content.lstrip()
    checks = {
        "pdf": content.startswith(DOCUMENT_MAGIC_TYPES["pdf"]),
        "doc": content.startswith(DOCUMENT_MAGIC_TYPES["doc"]),
        "zip": content.startswith(DOCUMENT_MAGIC_TYPES["zip"]),
        "rtf": lstripped.startswith(DOCUMENT_MAGIC_TYPES["rtf"]),
    }
    expected_magic = {
        "pdf": {"pdf"},
        "doc": {"doc"},
        "docx": {"zip"},
        "odt": {"zip"},
        "rtf": {"rtf"},
        "txt": set(),
    }[extension]
    if any(matches and name not in expected_magic for name, matches in checks.items()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document content does not match file extension.")


def _zip_member_names(content: bytes) -> set[str]:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            return set(archive.namelist())
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded document archive is invalid.") from exc


def _tenant_storage_used(db: Session, *, tenant_id: int) -> int:
    version_bytes = (
        db.query(func.coalesce(func.sum(DocumentVersion.size_bytes), 0))
        .join(Document, Document.id == DocumentVersion.document_id)
        .filter(DocumentVersion.tenant_id == tenant_id, Document.deleted_at.is_(None))
        .scalar()
    )
    legacy_bytes = (
        db.query(func.coalesce(func.sum(Document.file_size_bytes), 0))
        .filter(Document.tenant_id == tenant_id, Document.deleted_at.is_(None), Document.current_version_id.is_(None))
        .scalar()
    )
    return int(version_bytes or 0) + int(legacy_bytes or 0)


def _document_storage_connection(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: str,
    connected_only: bool = True,
) -> DocumentStorageConnection:
    query = db.query(DocumentStorageConnection).filter(
        DocumentStorageConnection.tenant_id == tenant_id,
        DocumentStorageConnection.user_id == user_id,
        DocumentStorageConnection.provider == provider,
    )
    if connected_only:
        query = query.filter(DocumentStorageConnection.status == "connected")
    connection = query.first()
    if not connection:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{provider.replace('_', ' ').title()} is not connected.")
    return connection


def _refresh_google_drive_access_token(db: Session, connection: DocumentStorageConnection) -> str:
    access_token = _usable_connection_access_token(db, connection)
    if access_token:
        return access_token

    def refresh() -> str:
        refresh_token = _connection_token(db, connection, "refresh_token")
        if not refresh_token:
            connection.status = "error"
            connection.last_error = "Reconnect Google Drive to restore document storage access."
            db.add(connection)
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)
        token_res = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=20,
        )
        token_json = token_res.json()
        if not token_res.ok or not token_json.get("access_token"):
            connection.status = "error"
            connection.last_error = "Failed to refresh Google Drive access."
            db.add(connection)
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)
        _set_connection_token(connection, "access_token", token_json["access_token"])
        connection.token_expires_at = _token_expiry(token_json)
        connection.status = "connected"
        connection.last_error = None
        db.add(connection)
        db.commit()
        db.refresh(connection)
        return token_json["access_token"]

    return _refresh_connection_access_token_with_lock(db, connection, provider_label="Google Drive", refresh=refresh)


def _google_drive_backend_for_user(db: Session, *, tenant_id: int, user_id: int):
    connection = _document_storage_connection(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        provider=DOCUMENT_PROVIDER_GOOGLE_DRIVE,
    )
    token = _refresh_google_drive_access_token(db, connection)
    return get_document_storage_backend(DOCUMENT_PROVIDER_GOOGLE_DRIVE, access_token=token)


def _microsoft_onedrive_backend_for_user(db: Session, *, tenant_id: int, user_id: int):
    connection = _document_storage_connection(db, tenant_id=tenant_id, user_id=user_id, provider=DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE)
    token = _refresh_microsoft_onedrive_access_token(db, connection)
    return get_document_storage_backend(DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE, access_token=token)


def _refresh_microsoft_onedrive_access_token(db: Session, connection: DocumentStorageConnection) -> str:
    access_token = _usable_connection_access_token(db, connection)
    if access_token:
        return access_token

    def refresh() -> str:
        refresh_token = _connection_token(db, connection, "refresh_token")
        if not refresh_token:
            connection.status = "error"
            connection.last_error = "Reconnect Microsoft OneDrive to restore document storage access."
            db.add(connection)
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)
        token_res = requests.post(
            microsoft_token_url(),
            data={
                "client_id": settings.MICROSOFT_CLIENT_ID,
                "client_secret": settings.MICROSOFT_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
                "scope": microsoft_scope_string(MICROSOFT_DRIVE_SCOPE),
            },
            timeout=20,
        )
        token_json = token_res.json()
        if not token_res.ok or not token_json.get("access_token"):
            connection.status = "error"
            connection.last_error = "Failed to refresh Microsoft OneDrive access."
            db.add(connection)
            db.commit()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=connection.last_error)
        _set_connection_token(connection, "access_token", token_json["access_token"])
        if token_json.get("refresh_token"):
            _set_connection_token(connection, "refresh_token", token_json["refresh_token"])
        connection.token_expires_at = _token_expiry(token_json)
        connection.status = "connected"
        connection.last_error = None
        db.add(connection)
        db.commit()
        db.refresh(connection)
        return token_json["access_token"]

    return _refresh_connection_access_token_with_lock(db, connection, provider_label="Microsoft OneDrive", refresh=refresh)


def require_connected_document_storage(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: str,
) -> DocumentStorageConnection:
    return _document_storage_connection(db, tenant_id=tenant_id, user_id=user_id, provider=provider)


def upload_document_storage_artifact(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: str,
    filename: str,
    content: bytes,
    content_type: str = "application/zip",
) -> dict:
    backend = (
        _google_drive_backend_for_user(db, tenant_id=tenant_id, user_id=user_id)
        if provider == DOCUMENT_PROVIDER_GOOGLE_DRIVE
        else _microsoft_onedrive_backend_for_user(db, tenant_id=tenant_id, user_id=user_id)
        if provider == DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE
        else None
    )
    if backend is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported backup storage provider.")
    stored = backend.save(
        tenant_id=tenant_id,
        extension="zip",
        content=content,
        filename=filename,
        content_type=content_type,
    )
    return {"provider": stored.provider, "storage_path": stored.storage_path}


def _require_linked_record_access(db: Session, *, user, module_key: str, entity_id: str | int, action: str) -> None:
    try:
        require_role_module_action_access(db, user=user, module_key=module_key, action=action)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported linked module.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    get_record_reference(db, tenant_id=user.tenant_id, module_key=module_key, entity_id=entity_id)


def _require_any_linked_record_access(db: Session, *, user, document: Document, action: str) -> None:
    if not document.links:
        return
    last_error: HTTPException | None = None
    for link in document.links:
        try:
            _require_linked_record_access(
                db,
                user=user,
                module_key=link.module_key,
                entity_id=link.entity_id,
                action=action,
            )
            return
        except HTTPException as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access to linked record is forbidden.") from last_error


def require_document_link_access(db: Session, *, user, document: Document, action: str = "view") -> None:
    _require_any_linked_record_access(db, user=user, document=document, action=action)


def _serialize_document(document: Document) -> dict:
    return _document_audit_ref(document)


def serialize_client_document_share(share: DocumentClientShare) -> dict:
    document = share.document
    return {
        "id": document.id,
        "title": document.title,
        "description": document.description,
        "original_filename": document.original_filename,
        "content_type": document.content_type,
        "extension": document.extension,
        "file_size_bytes": document.file_size_bytes,
        "created_at": document.created_at,
        "updated_at": document.updated_at,
        "share_id": share.id,
        "expires_at": share.expires_at,
    }


def _serialize_version(version: DocumentVersion) -> dict:
    return {
        "id": version.id,
        "document_id": version.document_id,
        "version_number": version.version_number,
        "file_name": version.file_name,
        "mime_type": version.mime_type,
        "size_bytes": version.size_bytes,
        "checksum": version.checksum,
        "uploaded_by_id": version.uploaded_by_id,
        "created_at": version.created_at.isoformat() if version.created_at else None,
    }


def _document_audit_ref(document: Document) -> dict:
    return {
        "document_id": document.id,
        "title": document.title,
        "storage_provider": document.storage_provider,
        "content_type": document.content_type,
        "file_size_bytes": document.file_size_bytes,
        "current_version_id": document.current_version_id,
    }


def resolve_document_storage_path(document: Document):
    backend = get_document_storage_backend(document.storage_provider)
    return backend.resolve_path(document.storage_path)


def _resolve_document_storage_key(db: Session, *, document: Document, storage_key: str, current_user) -> dict:
    if document.storage_provider == DOCUMENT_PROVIDER_LOCAL:
        backend = get_document_storage_backend(DOCUMENT_PROVIDER_LOCAL)
        return {"kind": "path", "path": backend.resolve_path(storage_key)}
    if document.storage_provider == DOCUMENT_PROVIDER_GOOGLE_DRIVE:
        storage_user_id = document.uploaded_by_user_id or current_user.id
        backend = _google_drive_backend_for_user(db, tenant_id=document.tenant_id, user_id=storage_user_id)
        return {"kind": "bytes", "content": backend.download(storage_key)}
    if document.storage_provider == DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE:
        storage_user_id = document.uploaded_by_user_id or current_user.id
        backend = _microsoft_onedrive_backend_for_user(db, tenant_id=document.tenant_id, user_id=storage_user_id)
        return {"kind": "bytes", "content": backend.download(storage_key)}
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Document storage provider is not configured.")


def resolve_document_download(db: Session, *, document: Document, current_user) -> dict:
    return _resolve_document_storage_key(db, document=document, storage_key=document.storage_path, current_user=current_user)


def resolve_document_version_download(db: Session, *, document: Document, version: DocumentVersion, current_user) -> dict:
    return _resolve_document_storage_key(db, document=document, storage_key=version.storage_key, current_user=current_user)


def _store_document_content(
    db: Session,
    *,
    tenant_id: int,
    content: bytes,
    extension: str,
    original_filename: str,
    content_type: str,
    storage_provider: str,
    current_user=None,
):
    normalized_provider = (storage_provider or DOCUMENT_PROVIDER_LOCAL).strip().lower()
    if normalized_provider == DOCUMENT_PROVIDER_LOCAL:
        return get_document_storage_backend(DOCUMENT_PROVIDER_LOCAL).save(tenant_id=tenant_id, extension=extension, content=content)
    if normalized_provider == DOCUMENT_PROVIDER_GOOGLE_DRIVE:
        if current_user is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive uploads require a connected user.")
        backend = _google_drive_backend_for_user(db, tenant_id=tenant_id, user_id=current_user.id)
        return backend.save(
            tenant_id=tenant_id,
            extension=extension,
            content=content,
            filename=original_filename,
            content_type=content_type,
        )
    if normalized_provider == DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE:
        if current_user is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Microsoft OneDrive uploads require a connected user.")
        backend = _microsoft_onedrive_backend_for_user(db, tenant_id=tenant_id, user_id=current_user.id)
        return backend.save(tenant_id=tenant_id, extension=extension, content=content, filename=original_filename, content_type=content_type)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported document storage provider.")


def _delete_document_storage_key(
    db: Session,
    *,
    tenant_id: int,
    storage_provider: str,
    storage_key: str,
    current_user=None,
) -> None:
    if not storage_key:
        return
    normalized_provider = (storage_provider or DOCUMENT_PROVIDER_LOCAL).strip().lower()
    try:
        if normalized_provider == DOCUMENT_PROVIDER_LOCAL:
            get_document_storage_backend(DOCUMENT_PROVIDER_LOCAL).delete(storage_key)
            return
        if normalized_provider == DOCUMENT_PROVIDER_GOOGLE_DRIVE:
            if current_user is None:
                return
            _google_drive_backend_for_user(db, tenant_id=tenant_id, user_id=current_user.id).delete(storage_key)
            return
        if normalized_provider == DOCUMENT_PROVIDER_MICROSOFT_ONEDRIVE:
            if current_user is None:
                return
            _microsoft_onedrive_backend_for_user(db, tenant_id=tenant_id, user_id=current_user.id).delete(storage_key)
    except Exception as cleanup_error:
        logger.warning(
            "Failed to clean up document storage object after write failure",
            extra={"tenant_id": tenant_id, "storage_provider": normalized_provider, "storage_key": storage_key},
            exc_info=cleanup_error,
        )


def _document_write_conflict() -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Document write conflict.")


def list_documents(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    module_key: str | None = None,
    entity_id: str | int | None = None,
    is_template: bool | None = None,
    limit: int = 50,
    sort_by: str | None = None,
    sort_direction: str | None = None,
    current_user=None,
) -> tuple[list[Document], int]:
    if (module_key and entity_id is None) or (not module_key and entity_id is not None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both module key and record ID are required.")
    if module_key and entity_id is not None:
        if current_user is not None:
            _require_linked_record_access(db, user=current_user, module_key=module_key, entity_id=entity_id, action="view")
        else:
            get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)

    return documents_repository.list_documents(
        db,
        tenant_id=tenant_id,
        search=search,
        module_key=module_key,
        entity_id=entity_id,
        is_template=is_template,
        limit=limit,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )


def list_documents_cursor(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    module_key: str | None = None,
    entity_id: str | int | None = None,
    is_template: bool | None = None,
    limit: int = 50,
    cursor: int | None = None,
    current_user=None,
) -> list[Document]:
    if (module_key and entity_id is None) or (not module_key and entity_id is not None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both module key and record ID are required.")
    if module_key and entity_id is not None:
        if current_user is not None:
            _require_linked_record_access(db, user=current_user, module_key=module_key, entity_id=entity_id, action="view")
        else:
            get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)
    return documents_repository.list_documents_cursor(
        db,
        tenant_id=tenant_id,
        search=search,
        module_key=module_key,
        entity_id=entity_id,
        is_template=is_template,
        limit=limit,
        cursor=cursor,
    )


def get_document_or_404(db: Session, *, tenant_id: int, document_id: int) -> Document:
    document = documents_repository.get_document(db, tenant_id=tenant_id, document_id=document_id)
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


def _ensure_share_target(db: Session, *, tenant_id: int, contact_id: int | None, organization_id: int | None) -> None:
    if contact_id is None and organization_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Share target is required.")
    if contact_id is not None:
        contact = db.query(SalesContact.contact_id).filter(SalesContact.tenant_id == tenant_id, SalesContact.contact_id == contact_id).first()
        if not contact:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found.")
    if organization_id is not None:
        organization = db.query(SalesOrganization.org_id).filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == organization_id).first()
        if not organization:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found.")


def _active_share_filter(now: datetime):
    return (
        DocumentClientShare.revoked_at.is_(None),
        or_(DocumentClientShare.expires_at.is_(None), DocumentClientShare.expires_at > now),
    )


def list_document_client_shares(db: Session, *, tenant_id: int, document_id: int) -> list[DocumentClientShare]:
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document_id)
    return (
        db.query(DocumentClientShare)
        .filter(DocumentClientShare.tenant_id == tenant_id, DocumentClientShare.document_id == document.id)
        .order_by(DocumentClientShare.created_at.desc(), DocumentClientShare.id.desc())
        .all()
    )


def share_document_with_client(db: Session, *, tenant_id: int, document_id: int, payload: dict, current_user) -> DocumentClientShare:
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document_id)
    if current_user is not None:
        require_document_link_access(db, user=current_user, document=document, action="edit")
    contact_id = payload.get("contact_id")
    organization_id = payload.get("organization_id")
    expires_at = payload.get("expires_at")
    _ensure_share_target(db, tenant_id=tenant_id, contact_id=contact_id, organization_id=organization_id)
    share = (
        db.query(DocumentClientShare)
        .filter(
            DocumentClientShare.tenant_id == tenant_id,
            DocumentClientShare.document_id == document.id,
            DocumentClientShare.contact_id.is_(None) if contact_id is None else DocumentClientShare.contact_id == contact_id,
            DocumentClientShare.organization_id.is_(None) if organization_id is None else DocumentClientShare.organization_id == organization_id,
            DocumentClientShare.revoked_at.is_(None),
        )
        .first()
    )
    if not share:
        share = DocumentClientShare(
            tenant_id=tenant_id,
            document_id=document.id,
            contact_id=contact_id,
            organization_id=organization_id,
            created_by_user_id=getattr(current_user, "id", None),
        )
    share.expires_at = expires_at
    share.revoked_at = None
    db.add(share)
    db.commit()
    db.refresh(share)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="client_share.create",
        description=f"Shared document {document.title} with client portal",
        after_state={"share_id": share.id, "contact_id": share.contact_id, "organization_id": share.organization_id, "expires_at": share.expires_at.isoformat() if share.expires_at else None},
    )
    return share


def revoke_document_client_share(db: Session, *, tenant_id: int, document_id: int, share_id: int, current_user) -> DocumentClientShare:
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document_id)
    if current_user is not None:
        require_document_link_access(db, user=current_user, document=document, action="edit")
    share = (
        db.query(DocumentClientShare)
        .filter(
            DocumentClientShare.tenant_id == tenant_id,
            DocumentClientShare.document_id == document.id,
            DocumentClientShare.id == share_id,
        )
        .first()
    )
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document share not found.")
    if share.revoked_at is None:
        share.revoked_at = _utcnow()
        db.add(share)
        db.commit()
        db.refresh(share)
        log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=getattr(current_user, "id", None),
            module_key="documents",
            entity_type="document",
            entity_id=document.id,
            action="client_share.revoke",
            description=f"Revoked client portal access for document {document.title}",
            after_state={"share_id": share.id, "revoked_at": share.revoked_at.isoformat() if share.revoked_at else None},
        )
    return share


def list_client_documents(
    db: Session,
    *,
    tenant_id: int,
    contact_id: int | None,
    organization_id: int | None,
) -> list[DocumentClientShare]:
    if contact_id is None and organization_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client account is not linked to a document profile.")
    conditions = []
    if contact_id is not None:
        conditions.append(DocumentClientShare.contact_id == contact_id)
    if organization_id is not None:
        conditions.append(DocumentClientShare.organization_id == organization_id)
    return (
        db.query(DocumentClientShare)
        .join(Document, Document.id == DocumentClientShare.document_id)
        .options(joinedload(DocumentClientShare.document))
        .filter(
            DocumentClientShare.tenant_id == tenant_id,
            Document.deleted_at.is_(None),
            or_(*conditions),
            *_active_share_filter(_utcnow()),
        )
        .order_by(Document.updated_at.desc(), Document.id.desc(), DocumentClientShare.id.desc())
        .all()
    )


def get_client_document_share_or_404(
    db: Session,
    *,
    tenant_id: int,
    contact_id: int | None,
    organization_id: int | None,
    document_id: int,
) -> DocumentClientShare:
    if contact_id is None and organization_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client account is not linked to a document profile.")
    conditions = []
    if contact_id is not None:
        conditions.append(DocumentClientShare.contact_id == contact_id)
    if organization_id is not None:
        conditions.append(DocumentClientShare.organization_id == organization_id)
    share = (
        db.query(DocumentClientShare)
        .join(Document, Document.id == DocumentClientShare.document_id)
        .options(joinedload(DocumentClientShare.document))
        .filter(
            DocumentClientShare.tenant_id == tenant_id,
            DocumentClientShare.document_id == document_id,
            Document.deleted_at.is_(None),
            or_(*conditions),
            *_active_share_filter(_utcnow()),
        )
        .first()
    )
    if not share:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return share


def get_deleted_document_or_404(db: Session, *, tenant_id: int, document_id: int) -> Document:
    document = documents_repository.get_deleted_document(db, tenant_id=tenant_id, document_id=document_id)
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deleted document not found.")
    return document


def list_document_templates(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    limit: int = 50,
    current_user=None,
) -> tuple[list[Document], int]:
    return list_documents(db, tenant_id=tenant_id, search=search, is_template=True, limit=limit, current_user=current_user)


def list_document_versions(db: Session, *, document: Document) -> list[DocumentVersion]:
    return (
        db.query(DocumentVersion)
        .filter(DocumentVersion.tenant_id == document.tenant_id, DocumentVersion.document_id == document.id)
        .order_by(DocumentVersion.version_number.desc(), DocumentVersion.id.desc())
        .all()
    )


def get_document_version_or_404(
    db: Session,
    *,
    tenant_id: int,
    document_id: int,
    version_id: int,
) -> DocumentVersion:
    version = (
        db.query(DocumentVersion)
        .filter(
            DocumentVersion.tenant_id == tenant_id,
            DocumentVersion.document_id == document_id,
            DocumentVersion.id == version_id,
        )
        .first()
    )
    if not version:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document version not found.")
    return version


def upload_document_version(
    db: Session,
    *,
    tenant_id: int,
    document_id: int,
    file: UploadFile,
    current_user,
) -> Document:
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document_id)
    require_document_link_access(db, user=current_user, document=document, action="edit")
    content, extension, content_type, original_filename = read_document_upload_sync(file)
    if _tenant_storage_used(db, tenant_id=tenant_id) + len(content) > settings.DOCUMENT_TENANT_STORAGE_LIMIT_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant document storage limit exceeded.")
    stored = _store_document_content(
        db,
        tenant_id=tenant_id,
        extension=extension,
        content=content,
        original_filename=original_filename,
        content_type=content_type,
        storage_provider=document.storage_provider,
        current_user=current_user,
    )
    try:
        latest_version = (
            db.query(func.coalesce(func.max(DocumentVersion.version_number), 0))
            .filter(DocumentVersion.tenant_id == tenant_id, DocumentVersion.document_id == document.id)
            .scalar()
        )
        before_state = _serialize_document(document)
        version = DocumentVersion(
            tenant_id=tenant_id,
            document_id=document.id,
            version_number=int(latest_version or 0) + 1,
            storage_key=stored.storage_path,
            file_name=original_filename[:255],
            mime_type=content_type,
            size_bytes=len(content),
            checksum=hashlib.sha256(content).hexdigest(),
            uploaded_by_id=getattr(current_user, "id", None),
        )
        db.add(version)
        db.flush()
        document.original_filename = original_filename[:255]
        document.content_type = content_type
        document.extension = extension
        document.file_size_bytes = len(content)
        document.storage_path = stored.storage_path
        document.current_version_id = version.id
        db.add(document)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _delete_document_storage_key(
            db,
            tenant_id=tenant_id,
            storage_provider=stored.provider,
            storage_key=stored.storage_path,
            current_user=current_user,
        )
        raise _document_write_conflict() from exc
    except Exception:
        db.rollback()
        _delete_document_storage_key(
            db,
            tenant_id=tenant_id,
            storage_provider=stored.provider,
            storage_key=stored.storage_path,
            current_user=current_user,
        )
        raise
    db.refresh(document)
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document.id)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="version.create",
        description=f"Uploaded version {version.version_number} for document {document.title}",
        before_state=before_state,
        after_state=_serialize_document(document),
    )
    return document


def update_document_template_status(
    db: Session,
    *,
    tenant_id: int,
    document_id: int,
    is_template: bool,
    template_category: str | None,
    current_user=None,
) -> Document:
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document_id)
    if current_user is not None:
        require_document_link_access(db, user=current_user, document=document, action="edit")
    before_state = _serialize_document(document)
    document.is_template = bool(is_template)
    category = (template_category or "").strip()
    document.template_category = category[:120] if document.is_template and category else None
    db.add(document)
    db.commit()
    db.refresh(document)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="template.update",
        description=f"Updated template status for document {document.title}",
        before_state=before_state,
        after_state=_serialize_document(document),
    )
    return document


def create_document(
    db: Session,
    *,
    tenant_id: int,
    user_id: int | None,
    file: UploadFile,
    title: str | None = None,
    description: str | None = None,
    linked_module_key: str | None = None,
    linked_entity_id: str | int | None = None,
    storage_provider: str = DOCUMENT_PROVIDER_LOCAL,
    current_user=None,
) -> Document:
    content, extension, content_type, original_filename = read_document_upload_sync(file)
    if _tenant_storage_used(db, tenant_id=tenant_id) + len(content) > settings.DOCUMENT_TENANT_STORAGE_LIMIT_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant document storage limit exceeded.")

    if linked_module_key and linked_entity_id is not None:
        if current_user is not None:
            _require_linked_record_access(
                db,
                user=current_user,
                module_key=linked_module_key,
                entity_id=linked_entity_id,
                action="edit",
            )
        else:
            get_record_reference(db, tenant_id=tenant_id, module_key=linked_module_key, entity_id=linked_entity_id)
    elif linked_module_key or linked_entity_id is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both linked module and linked record are required.")

    stored = _store_document_content(
        db,
        tenant_id=tenant_id,
        extension=extension,
        content=content,
        original_filename=original_filename,
        content_type=content_type,
        storage_provider=storage_provider,
        current_user=current_user,
    )
    normalized_title = (title or original_filename).strip()
    if not normalized_title:
        normalized_title = f"Untitled.{extension}"
    document = Document(
        tenant_id=tenant_id,
        uploaded_by_user_id=user_id,
        title=normalized_title[:255],
        description=(description or "").strip() or None,
        original_filename=original_filename[:255],
        content_type=content_type,
        extension=extension,
        file_size_bytes=len(content),
        storage_provider=stored.provider,
        storage_path=stored.storage_path,
    )
    try:
        db.add(document)
        db.flush()
        version = DocumentVersion(
            tenant_id=tenant_id,
            document_id=document.id,
            version_number=1,
            storage_key=stored.storage_path,
            file_name=original_filename[:255],
            mime_type=content_type,
            size_bytes=len(content),
            checksum=hashlib.sha256(content).hexdigest(),
            uploaded_by_id=user_id,
        )
        db.add(version)
        db.flush()
        document.current_version_id = version.id
        db.add(document)

        if linked_module_key and linked_entity_id is not None:
            db.add(
                DocumentLink(
                    tenant_id=tenant_id,
                    document_id=document.id,
                    module_key=linked_module_key,
                    entity_id=str(linked_entity_id),
                    created_by_user_id=user_id,
                )
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        _delete_document_storage_key(
            db,
            tenant_id=tenant_id,
            storage_provider=stored.provider,
            storage_key=stored.storage_path,
            current_user=current_user,
        )
        raise _document_write_conflict() from exc
    except Exception:
        db.rollback()
        _delete_document_storage_key(
            db,
            tenant_id=tenant_id,
            storage_provider=stored.provider,
            storage_key=stored.storage_path,
            current_user=current_user,
        )
        raise
    db.refresh(document)
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document.id)
    serialized = _serialize_document(document)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=user_id,
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="create",
        description=f"Uploaded document {document.title}",
        after_state=serialized,
    )
    if linked_module_key and linked_entity_id is not None:
        config = get_record_comment_module_config(linked_module_key)
        log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=user_id,
            module_key=linked_module_key,
            entity_type=config["entity_type"],
            entity_id=str(linked_entity_id),
            action="document.attach",
            description=f"Attached document {document.title}",
            after_state=serialized,
        )
    return document


def list_deleted_documents(db: Session, *, tenant_id: int, pagination) -> tuple[list[Document], int]:
    return documents_repository.list_deleted_documents(db, tenant_id=tenant_id, pagination=pagination)


def soft_delete_document(db: Session, *, tenant_id: int, document_id: int, current_user=None) -> Document:
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document_id)
    if current_user is not None:
        _require_any_linked_record_access(db, user=current_user, document=document, action="edit")
    before_state = _serialize_document(document)
    document.deleted_at = _utcnow()
    db.add(document)
    db.commit()
    db.refresh(document)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="delete",
        description=f"Moved document {document.title} to recycle bin",
        before_state=before_state,
        after_state=_serialize_document(document),
    )
    return document


def restore_document(db: Session, *, tenant_id: int, document_id: int, current_user=None) -> Document:
    document = get_deleted_document_or_404(db, tenant_id=tenant_id, document_id=document_id)
    before_state = _serialize_document(document)
    document.deleted_at = None
    db.add(document)
    db.commit()
    db.refresh(document)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="restore",
        description=f"Restored document {document.title} from recycle bin",
        before_state=before_state,
        after_state=_serialize_document(document),
    )
    return document


def log_document_download(db: Session, *, document: Document, current_user) -> None:
    log_activity(
        db,
        tenant_id=document.tenant_id,
        actor_user_id=getattr(current_user, "id", None),
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="download",
        description=f"Downloaded document {document.title}",
        after_state=_document_audit_ref(document),
    )


def log_client_document_view(db: Session, *, share: DocumentClientShare, client_account_id: int) -> None:
    document = share.document
    log_activity(
        db,
        tenant_id=document.tenant_id,
        actor_user_id=None,
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="portal.document.viewed",
        description=f"Client viewed document {document.title}",
        after_state={
            "document_id": document.id,
            "share_id": share.id,
            "client_account_id": client_account_id,
            "contact_id": share.contact_id,
            "organization_id": share.organization_id,
        },
    )


def log_client_document_download(db: Session, *, share: DocumentClientShare, client_account_id: int) -> None:
    document = share.document
    log_activity(
        db,
        tenant_id=document.tenant_id,
        actor_user_id=None,
        module_key="documents",
        entity_type="document",
        entity_id=document.id,
        action="portal.document.downloaded",
        description=f"Client downloaded document {document.title}",
        after_state={
            "document_id": document.id,
            "share_id": share.id,
            "client_account_id": client_account_id,
            "contact_id": share.contact_id,
            "organization_id": share.organization_id,
        },
    )
