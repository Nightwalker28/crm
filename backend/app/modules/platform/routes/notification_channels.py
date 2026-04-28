from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin
from app.modules.platform.schema import (
    NotificationChannelCreateRequest,
    NotificationChannelListResponse,
    NotificationChannelResponse,
    NotificationChannelTestResponse,
    NotificationChannelUpdateRequest,
)
from app.modules.platform.services.crm_events import (
    create_notification_channel,
    delete_notification_channel,
    get_notification_channel_or_404,
    list_notification_channels,
    send_test_message,
    serialize_notification_channel,
    update_notification_channel,
)


router = APIRouter(prefix="/admin/notification-channels", tags=["Notification Channels"])


@router.get("", response_model=NotificationChannelListResponse)
def list_channels(
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    channels = list_notification_channels(db, tenant_id=admin.tenant_id)
    return {"results": [NotificationChannelResponse.model_validate(serialize_notification_channel(channel)) for channel in channels]}


@router.post("", response_model=NotificationChannelResponse, status_code=status.HTTP_201_CREATED)
def create_channel(
    payload: NotificationChannelCreateRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    channel = create_notification_channel(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        payload=payload.model_dump(),
    )
    return NotificationChannelResponse.model_validate(serialize_notification_channel(channel))


@router.put("/{channel_id}", response_model=NotificationChannelResponse)
def update_channel(
    channel_id: int,
    payload: NotificationChannelUpdateRequest,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    channel = get_notification_channel_or_404(db, tenant_id=admin.tenant_id, channel_id=channel_id)
    channel = update_notification_channel(
        db,
        channel=channel,
        actor_user_id=admin.id,
        payload=payload.model_dump(exclude_unset=True),
    )
    return NotificationChannelResponse.model_validate(serialize_notification_channel(channel))


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    channel = get_notification_channel_or_404(db, tenant_id=admin.tenant_id, channel_id=channel_id)
    delete_notification_channel(db, channel=channel)


@router.post("/{channel_id}/test", response_model=NotificationChannelTestResponse)
def test_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    channel = get_notification_channel_or_404(db, tenant_id=admin.tenant_id, channel_id=channel_id)
    return send_test_message(db, channel=channel, actor_name=admin.email)
