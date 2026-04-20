from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_user
from app.modules.platform.schema import UserNotificationListResponse, UserNotificationResponse
from app.modules.platform.services.notifications import (
    get_notification_or_404,
    list_notifications,
    mark_all_notifications_read,
    mark_notification_read,
)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", response_model=UserNotificationListResponse)
def get_notifications(
    status_filter: str | None = Query(default=None, alias="status"),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    items, total, unread_count = list_notifications(
        db,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        pagination=pagination,
        status_filter=status_filter,
    )
    serialized = [UserNotificationResponse.model_validate(item) for item in items]
    response = build_paged_response(serialized, total_count=total, pagination=pagination)
    response["unread_count"] = unread_count
    return response


@router.post("/read-all")
def read_all_notifications(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    updated = mark_all_notifications_read(db, tenant_id=current_user.tenant_id, user_id=current_user.id)
    return {"updated_count": updated}


@router.post("/{notification_id}/read", response_model=UserNotificationResponse)
def read_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    notification = get_notification_or_404(
        db,
        notification_id=notification_id,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
    )
    notification = mark_notification_read(db, notification=notification)
    return UserNotificationResponse.model_validate(notification)
