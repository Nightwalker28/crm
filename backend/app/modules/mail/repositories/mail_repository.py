from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.mail.models import MailMessage, UserMailConnection
from app.modules.mail.schema import MailProvider
from app.modules.user_management.models import User


def list_connections(db: Session, *, tenant_id: int, user_id: int) -> list[UserMailConnection]:
    return (
        db.query(UserMailConnection)
        .filter(
            UserMailConnection.tenant_id == tenant_id,
            UserMailConnection.user_id == user_id,
        )
        .order_by(UserMailConnection.provider.asc(), UserMailConnection.id.asc())
        .all()
    )


def get_connection(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    provider: MailProvider,
    connected_only: bool = False,
) -> UserMailConnection | None:
    query = db.query(UserMailConnection).filter(
        UserMailConnection.tenant_id == tenant_id,
        UserMailConnection.user_id == user_id,
        UserMailConnection.provider == provider.value,
    )
    if connected_only:
        query = query.filter(UserMailConnection.status == "connected")
    return query.first()


def list_messages(
    db: Session,
    *,
    tenant_id: int,
    owner_user_id: int,
    folder: str | None = None,
    search: str | None = None,
    limit: int = 50,
    before_id: int | None = None,
) -> list[MailMessage]:
    query = build_messages_query(
        db,
        tenant_id=tenant_id,
        owner_user_id=owner_user_id,
        folder=folder,
        search=search,
    )
    if before_id:
        query = query.filter(MailMessage.id < before_id)
    return (
        query.order_by(MailMessage.received_at.desc().nullslast(), MailMessage.sent_at.desc().nullslast(), MailMessage.created_at.desc())
        .limit(limit)
        .all()
    )


def build_messages_query(
    db: Session,
    *,
    tenant_id: int,
    owner_user_id: int,
    folder: str | None = None,
    search: str | None = None,
):
    normalized_folder = (folder or "").strip() or None
    normalized_search = (search or "").strip()
    query = db.query(MailMessage).filter(
        MailMessage.tenant_id == tenant_id,
        MailMessage.owner_user_id == owner_user_id,
        MailMessage.deleted_at.is_(None),
    )
    if normalized_folder:
        query = query.filter(MailMessage.folder == normalized_folder)
    if len(normalized_search) >= 2:
        query = apply_ranked_search(
            query,
            search=normalized_search,
            document=searchable_text(
                MailMessage.subject,
                MailMessage.snippet,
                MailMessage.from_email,
                MailMessage.from_name,
                MailMessage.source_label,
            ),
            default_order_column=MailMessage.created_at,
        )
    return query.filter(
        or_(
            MailMessage.received_at.is_not(None),
            MailMessage.sent_at.is_not(None),
            MailMessage.created_at.is_not(None),
        )
    )


def list_messages_cursor(
    db: Session,
    *,
    tenant_id: int,
    owner_user_id: int,
    limit: int,
    cursor: int | None = None,
    folder: str | None = None,
    search: str | None = None,
) -> list[MailMessage]:
    query = build_messages_query(
        db,
        tenant_id=tenant_id,
        owner_user_id=owner_user_id,
        folder=folder,
        search=search,
    )
    if cursor is not None:
        query = query.filter(MailMessage.id < cursor)
    return query.order_by(None).order_by(MailMessage.id.desc()).limit(limit + 1).all()


def get_message(db: Session, *, tenant_id: int, owner_user_id: int, message_id: int) -> MailMessage | None:
    return (
        db.query(MailMessage)
        .filter(
            MailMessage.id == message_id,
            MailMessage.tenant_id == tenant_id,
            MailMessage.owner_user_id == owner_user_id,
            MailMessage.deleted_at.is_(None),
        )
        .first()
    )


def find_message_by_provider_id(
    db: Session,
    *,
    tenant_id: int,
    connection_id: int,
    provider_message_id: str,
) -> MailMessage | None:
    return (
        db.query(MailMessage)
        .filter(
            MailMessage.tenant_id == tenant_id,
            MailMessage.connection_id == connection_id,
            MailMessage.provider_message_id == provider_message_id,
        )
        .first()
    )


def get_user(db: Session, *, tenant_id: int, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id, User.tenant_id == tenant_id).first()
