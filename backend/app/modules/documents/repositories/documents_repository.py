from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from app.modules.documents.models import Document, DocumentLink


def list_documents(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    module_key: str | None = None,
    entity_id: str | int | None = None,
    is_template: bool | None = None,
    limit: int = 50,
) -> tuple[list[Document], int]:
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
    if is_template is not None:
        query = query.filter(Document.is_template == is_template)
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
) -> list[Document]:
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
    if is_template is not None:
        query = query.filter(Document.is_template == is_template)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Document.title.ilike(pattern),
                Document.original_filename.ilike(pattern),
                Document.description.ilike(pattern),
            )
        )
    if cursor is not None:
        query = query.filter(Document.id < cursor)
    return query.order_by(None).order_by(Document.id.desc()).limit(limit + 1).all()


def get_document(db: Session, *, tenant_id: int, document_id: int, include_deleted: bool = False) -> Document | None:
    query = (
        db.query(Document)
        .options(joinedload(Document.links))
        .filter(Document.id == document_id, Document.tenant_id == tenant_id)
    )
    query = query.filter(Document.deleted_at.is_not(None) if include_deleted else Document.deleted_at.is_(None))
    return query.first()


def list_deleted_documents(db: Session, *, tenant_id: int, pagination) -> tuple[list[Document], int]:
    query = (
        db.query(Document)
        .options(joinedload(Document.links))
        .filter(Document.tenant_id == tenant_id, Document.deleted_at.is_not(None))
    )
    total = query.count()
    items = query.order_by(Document.deleted_at.desc(), Document.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return items, total
