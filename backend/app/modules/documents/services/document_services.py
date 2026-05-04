from __future__ import annotations

import io
import urllib.parse
import zipfile
from datetime import datetime, timedelta, timezone

import requests
from fastapi import HTTPException, Request, UploadFile, status
from jose import JWTError, jwt
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.access_control import require_role_module_action_access
from app.core.tenancy import get_frontend_origin_for_request, get_google_redirect_uri_for_request
from app.modules.documents.models import Document, DocumentLink, DocumentStorageConnection
from app.modules.documents.schema import DocumentResponse
from app.modules.documents.services.storage_backends import get_document_storage_backend, supported_storage_providers
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.record_comments import get_record_comment_module_config, get_record_reference
from app.modules.user_management.models import Tenant, User, UserStatus

ALLOWED_DOCUMENT_EXTENSIONS = {"pdf", "doc", "docx", "txt", "rtf", "odt"}
ALLOWED_DOCUMENT_CONTENT_TYPES = {
    "application/pdf",
    "application/msword",
    "application/rtf",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/rtf",
}
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
GOOGLE_DRIVE_CONNECT_STATE_TYPE = "google_drive_document_storage_state"
DOCUMENT_PROVIDER_LOCAL = "local"
DOCUMENT_PROVIDER_GOOGLE_DRIVE = "google_drive"


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


def _create_drive_oauth_state(*, tenant: Tenant, user, frontend_origin: str) -> str:
    now = _utcnow()
    payload = {
        "type": GOOGLE_DRIVE_CONNECT_STATE_TYPE,
        "provider": DOCUMENT_PROVIDER_GOOGLE_DRIVE,
        "tenant_id": tenant.id,
        "user_id": user.id,
        "frontend_origin": frontend_origin.rstrip("/"),
        "iat": now,
        "exp": now + timedelta(minutes=settings.GOOGLE_OAUTH_STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_drive_oauth_state(state_token: str | None) -> dict | None:
    if not state_token:
        return None
    try:
        payload = jwt.decode(state_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") != GOOGLE_DRIVE_CONNECT_STATE_TYPE:
        return None
    if payload.get("provider") != DOCUMENT_PROVIDER_GOOGLE_DRIVE:
        return None
    return payload


def get_google_drive_connect_url(*, request: Request, tenant: Tenant, user) -> str:
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
        ),
    }
    return GOOGLE_AUTH_URL + "?" + urllib.parse.urlencode(params)


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
    connection.access_token = token_json.get("access_token") or connection.access_token
    if token_json.get("refresh_token"):
        connection.refresh_token = token_json["refresh_token"]
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


def disconnect_document_storage_connection(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: str,
) -> DocumentStorageConnection:
    if provider != DOCUMENT_PROVIDER_GOOGLE_DRIVE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported document storage provider.")
    connection = _document_storage_connection(db, tenant_id=tenant_id, user_id=user_id, provider=provider, connected_only=False)
    connection.status = "disconnected"
    connection.access_token = None
    connection.refresh_token = None
    connection.token_expires_at = None
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


async def read_document_upload(file: UploadFile) -> tuple[bytes, str, str, str]:
    filename = (file.filename or "").strip()
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if extension not in ALLOWED_DOCUMENT_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported document type. Allowed types: .pdf, .doc, .docx, .txt, .rtf, .odt",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded document is empty.")
    if len(content) > settings.DOCUMENT_MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document exceeds the {settings.DOCUMENT_MAX_UPLOAD_BYTES} byte upload limit.",
        )

    content_type = (file.content_type or "").split(";", 1)[0].strip().lower()
    if content_type and content_type not in ALLOWED_DOCUMENT_CONTENT_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported document content type.")

    _validate_document_signature(content, extension)
    return content, extension, content_type or _default_content_type(extension), filename


def _validate_document_signature(content: bytes, extension: str) -> None:
    if extension == "pdf":
        if not content.startswith(b"%PDF-") or b"%%EOF" not in content[-2048:]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded PDF content is invalid.")
    if extension == "docx":
        names = _zip_member_names(content)
        if "[Content_Types].xml" not in names or not any(name.startswith("word/") for name in names):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded DOCX content is invalid.")
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
    if extension == "doc" and not content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded DOC content is invalid.")
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


def _zip_member_names(content: bytes) -> set[str]:
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            return set(archive.namelist())
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded document archive is invalid.") from exc


def _default_content_type(extension: str) -> str:
    return {
        "pdf": "application/pdf",
        "doc": "application/msword",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "odt": "application/vnd.oasis.opendocument.text",
        "rtf": "application/rtf",
        "txt": "text/plain",
    }[extension]


def _tenant_storage_used(db: Session, *, tenant_id: int) -> int:
    value = (
        db.query(func.coalesce(func.sum(Document.file_size_bytes), 0))
        .filter(Document.tenant_id == tenant_id, Document.deleted_at.is_(None))
        .scalar()
    )
    return int(value or 0)


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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive is not connected.")
    return connection


def _refresh_google_drive_access_token(db: Session, connection: DocumentStorageConnection) -> str:
    expires_at = _as_utc(connection.token_expires_at)
    if connection.access_token and expires_at and expires_at > _utcnow() + timedelta(minutes=1):
        return connection.access_token
    if not connection.refresh_token:
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
            "refresh_token": connection.refresh_token,
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
    connection.access_token = token_json["access_token"]
    connection.token_expires_at = _token_expiry(token_json)
    connection.status = "connected"
    connection.last_error = None
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection.access_token


def _google_drive_backend_for_user(db: Session, *, tenant_id: int, user_id: int):
    connection = _document_storage_connection(
        db,
        tenant_id=tenant_id,
        user_id=user_id,
        provider=DOCUMENT_PROVIDER_GOOGLE_DRIVE,
    )
    token = _refresh_google_drive_access_token(db, connection)
    return get_document_storage_backend(DOCUMENT_PROVIDER_GOOGLE_DRIVE, access_token=token)


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
    return DocumentResponse.model_validate(document).model_dump(mode="json")


def resolve_document_storage_path(document: Document):
    backend = get_document_storage_backend(document.storage_provider)
    return backend.resolve_path(document.storage_path)


def resolve_document_download(db: Session, *, document: Document, current_user) -> dict:
    if document.storage_provider == DOCUMENT_PROVIDER_LOCAL:
        return {"kind": "path", "path": resolve_document_storage_path(document)}
    if document.storage_provider == DOCUMENT_PROVIDER_GOOGLE_DRIVE:
        storage_user_id = document.uploaded_by_user_id or current_user.id
        backend = _google_drive_backend_for_user(db, tenant_id=document.tenant_id, user_id=storage_user_id)
        return {"kind": "bytes", "content": backend.download(document.storage_path)}
    raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Document storage provider is not configured.")


def list_documents(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    module_key: str | None = None,
    entity_id: str | int | None = None,
    limit: int = 50,
    current_user=None,
) -> tuple[list[Document], int]:
    if (module_key and entity_id is None) or (not module_key and entity_id is not None):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Both module key and record ID are required.")
    if module_key and entity_id is not None:
        if current_user is not None:
            _require_linked_record_access(db, user=current_user, module_key=module_key, entity_id=entity_id, action="view")
        else:
            get_record_reference(db, tenant_id=tenant_id, module_key=module_key, entity_id=entity_id)

    query = (
        db.query(Document)
        .options(joinedload(Document.links))
        .filter(Document.tenant_id == tenant_id, Document.deleted_at.is_(None))
    )
    if module_key and entity_id is not None:
        query = query.join(DocumentLink).filter(
            DocumentLink.tenant_id == tenant_id,
            DocumentLink.module_key == module_key,
            DocumentLink.entity_id == str(entity_id),
        )
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Document.title.ilike(pattern),
                Document.original_filename.ilike(pattern),
                Document.description.ilike(pattern),
            )
        )
    total = query.count()
    documents = query.order_by(Document.created_at.desc(), Document.id.desc()).limit(limit).all()
    return documents, total


def get_document_or_404(db: Session, *, tenant_id: int, document_id: int) -> Document:
    document = (
        db.query(Document)
        .options(joinedload(Document.links))
        .filter(
            Document.id == document_id,
            Document.tenant_id == tenant_id,
            Document.deleted_at.is_(None),
        )
        .first()
    )
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    return document


def get_deleted_document_or_404(db: Session, *, tenant_id: int, document_id: int) -> Document:
    document = (
        db.query(Document)
        .options(joinedload(Document.links))
        .filter(
            Document.id == document_id,
            Document.tenant_id == tenant_id,
            Document.deleted_at.is_not(None),
        )
        .first()
    )
    if not document:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deleted document not found.")
    return document


async def create_document(
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
    content, extension, content_type, original_filename = await read_document_upload(file)
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

    normalized_provider = (storage_provider or DOCUMENT_PROVIDER_LOCAL).strip().lower()
    if normalized_provider == DOCUMENT_PROVIDER_LOCAL:
        stored = get_document_storage_backend(DOCUMENT_PROVIDER_LOCAL).save(tenant_id=tenant_id, extension=extension, content=content)
    elif normalized_provider == DOCUMENT_PROVIDER_GOOGLE_DRIVE:
        if current_user is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google Drive uploads require a connected user.")
        backend = _google_drive_backend_for_user(db, tenant_id=tenant_id, user_id=current_user.id)
        stored = backend.save(
            tenant_id=tenant_id,
            extension=extension,
            content=content,
            filename=original_filename,
            content_type=content_type,
        )
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported document storage provider.")
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
    db.add(document)
    db.flush()

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
    query = (
        db.query(Document)
        .options(joinedload(Document.links))
        .filter(Document.tenant_id == tenant_id, Document.deleted_at.is_not(None))
    )
    total = query.count()
    items = query.order_by(Document.deleted_at.desc(), Document.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return items, total


def soft_delete_document(db: Session, *, tenant_id: int, document_id: int, current_user=None) -> Document:
    document = get_document_or_404(db, tenant_id=tenant_id, document_id=document_id)
    if current_user is not None:
        _require_any_linked_record_access(db, user=current_user, document=document, action="edit")
    before_state = _serialize_document(document)
    document.deleted_at = func.now()
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
        after_state=_serialize_document(document),
    )
