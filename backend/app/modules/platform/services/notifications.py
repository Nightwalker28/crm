from __future__ import annotations

from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.modules.platform.models import UserNotification


def create_notification(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    category: str,
    title: str,
    message: str,
    link_url: str | None = None,
    metadata: dict | None = None,
) -> UserNotification:
    notification = UserNotification(
        tenant_id=tenant_id,
        user_id=user_id,
        category=category,
        title=title,
        message=message,
        link_url=link_url,
        payload=metadata or None,
        status="unread",
    )
    db.add(notification)
    db.commit()
    db.refresh(notification)
    return notification


def list_notifications(
    db: Session,
    *,
    tenant_id: int,
    user_id: int,
    pagination: Pagination,
    status_filter: str | None = None,
):
    query = db.query(UserNotification).filter(
        UserNotification.tenant_id == tenant_id,
        UserNotification.user_id == user_id,
    )
    if status_filter in {"read", "unread"}:
        query = query.filter(UserNotification.status == status_filter)

    total = query.count()
    unread_count = (
        db.query(UserNotification)
        .filter(
            UserNotification.tenant_id == tenant_id,
            UserNotification.user_id == user_id,
            UserNotification.status == "unread",
        )
        .count()
    )
    items = (
        query.order_by(UserNotification.created_at.desc())
        .offset((pagination.page - 1) * pagination.page_size)
        .limit(pagination.page_size)
        .all()
    )
    return items, total, unread_count


def get_notification_or_404(db: Session, *, notification_id: int, tenant_id: int, user_id: int) -> UserNotification:
    notification = (
        db.query(UserNotification)
        .filter(
            UserNotification.id == notification_id,
            UserNotification.tenant_id == tenant_id,
            UserNotification.user_id == user_id,
        )
        .first()
    )
    if not notification:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")
    return notification


def mark_notification_read(db: Session, *, notification: UserNotification) -> UserNotification:
    from sqlalchemy import func

    if notification.status != "read":
        notification.status = "read"
        notification.read_at = func.now()
        db.add(notification)
        db.commit()
        db.refresh(notification)
    return notification


def mark_all_notifications_read(db: Session, *, tenant_id: int, user_id: int) -> int:
    from sqlalchemy import func

    updated = (
        db.query(UserNotification)
        .filter(
            UserNotification.tenant_id == tenant_id,
            UserNotification.user_id == user_id,
            UserNotification.status != "read",
        )
        .update(
            {
                UserNotification.status: "read",
                UserNotification.read_at: func.now(),
            },
            synchronize_session=False,
        )
    )
    db.commit()
    return updated
