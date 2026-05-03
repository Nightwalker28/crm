from __future__ import annotations

import io
import zipfile

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
from app.core.access_control import require_role_module_action_access
from app.modules.documents.models import Document, DocumentLink
from app.modules.documents.schema import DocumentResponse
from app.modules.documents.services.storage_backends import get_document_storage_backend, supported_storage_providers
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.record_comments import get_record_comment_module_config, get_record_reference

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

    stored = get_document_storage_backend("local").save(tenant_id=tenant_id, extension=extension, content=content)
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
