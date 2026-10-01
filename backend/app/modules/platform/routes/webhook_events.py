from fastapi import APIRouter, Depends

from app.core.security import require_admin
from app.modules.platform.schema import WebhookEventTypeListResponse
from app.modules.platform.services.webhook_events import list_webhook_event_types


router = APIRouter(prefix="/admin/webhooks", tags=["Webhooks"])


@router.get("/event-types", response_model=WebhookEventTypeListResponse)
def get_webhook_event_types(admin=Depends(require_admin)):
    """The events a webhook may carry, with their versions and typed fields.

    Static and identical for every tenant; subscriptions (08 Phase 2) validate against it.
    """

    return {"results": list_webhook_event_types()}
