from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_admin
from app.modules.platform.schema import CrmEventListResponse, CrmEventResponse
from app.modules.platform.services.crm_events import list_crm_events, list_crm_events_cursor, serialize_crm_event


router = APIRouter(prefix="/admin/crm-events", tags=["CRM Events"])


@router.get("", response_model=CrmEventListResponse)
def get_crm_events(
    event_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    delivery_provider: str | None = Query(default=None),
    delivery_status: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    events, deliveries_by_event_id, total = list_crm_events(
        db,
        tenant_id=admin.tenant_id,
        pagination=pagination,
        event_type=event_type,
        entity_type=entity_type,
        delivery_provider=delivery_provider,
        delivery_status=delivery_status,
    )
    serialized = [
        CrmEventResponse.model_validate(
            serialize_crm_event(event, deliveries_by_event_id.get(event.id, []))
        )
        for event in events
    ]
    return build_paged_response(serialized, total_count=total, pagination=pagination)


@router.get("/cursor", response_model=dict)
def get_crm_events_cursor(
    event_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    delivery_provider: str | None = Query(default=None),
    delivery_status: str | None = Query(default=None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    events, deliveries_by_event_id = list_crm_events_cursor(
        db,
        tenant_id=admin.tenant_id,
        limit=pagination.limit,
        cursor=pagination.cursor,
        event_type=event_type,
        entity_type=entity_type,
        delivery_provider=delivery_provider,
        delivery_status=delivery_status,
    )
    serialized = [
        CrmEventResponse.model_validate(
            serialize_crm_event(event, deliveries_by_event_id.get(event.id, []))
        ).model_dump(mode="json")
        for event in events
    ]
    return build_cursor_response(serialized, limit=pagination.limit, id_attr="id")
