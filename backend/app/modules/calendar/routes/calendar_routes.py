from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.calendar.schema import (
    CalendarContextResponse,
    CalendarEventCreateRequest,
    CalendarEventListResponse,
    CalendarEventResponse,
    CalendarInviteResponseRequest,
    CalendarSyncResponse,
    CalendarTaskEventResponse,
    CalendarTaskCreateResponse,
    CalendarEventUpdateRequest,
)
from app.modules.calendar.services.calendar_services import (
    build_calendar_context,
    create_calendar_event,
    create_calendar_event_from_task,
    delete_calendar_event_from_task,
    delete_calendar_event,
    get_calendar_event_from_task,
    get_calendar_event_or_404,
    list_calendar_events,
    list_pending_invites,
    respond_to_calendar_invite,
    serialize_calendar_event,
    sync_current_user_calendar,
    update_calendar_event,
)
from app.modules.platform.services.activity_logs import log_activity


router = APIRouter(prefix="/calendar", tags=["Calendar"])


@router.get("/context", response_model=CalendarContextResponse)
def get_calendar_context(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "view")),
):
    return build_calendar_context(db, tenant_id=current_user.tenant_id, current_user=current_user)


@router.get("/events", response_model=CalendarEventListResponse)
def get_calendar_events(
    start_at: datetime = Query(...),
    end_at: datetime = Query(...),
    include_pending: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "view")),
):
    events = list_calendar_events(
        db,
        tenant_id=current_user.tenant_id,
        current_user=current_user,
        start_at=start_at,
        end_at=end_at,
    )
    if include_pending:
        pending_map = {event.id: event for event in list_pending_invites(db, tenant_id=current_user.tenant_id, current_user=current_user)}
        for event in pending_map.values():
            if all(existing.id != event.id for existing in events):
                events.append(event)
        events.sort(key=lambda item: (item.start_at, item.id))
    return {"results": [CalendarEventResponse.model_validate(serialize_calendar_event(event, current_user=current_user)) for event in events]}


@router.post("/events", response_model=CalendarEventResponse, status_code=status.HTTP_201_CREATED)
def create_calendar_event_route(
    payload: CalendarEventCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "create")),
):
    event, added_participants = create_calendar_event(db, payload=payload.model_dump(mode="json"), current_user=current_user)
    serialized = serialize_calendar_event(event, current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="calendar",
        entity_type="calendar_event",
        entity_id=str(event.id),
        action="create",
        description=f"Created calendar event {event.title}",
        after_state=serialized,
    )
    return CalendarEventResponse.model_validate(serialized)


@router.get("/events/{event_id}", response_model=CalendarEventResponse)
def get_calendar_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "view")),
):
    event = get_calendar_event_or_404(db, event_id, tenant_id=current_user.tenant_id, current_user=current_user)
    return CalendarEventResponse.model_validate(serialize_calendar_event(event, current_user=current_user))


@router.put("/events/{event_id}", response_model=CalendarEventResponse)
def update_calendar_event_route(
    event_id: int,
    payload: CalendarEventUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "edit")),
):
    event = get_calendar_event_or_404(db, event_id, tenant_id=current_user.tenant_id, current_user=current_user)
    if event.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the event owner can edit this event.")

    before_state = serialize_calendar_event(event, current_user=current_user)
    updated, added_participants = update_calendar_event(
        db,
        event=event,
        payload=payload.model_dump(exclude_unset=True, mode="json"),
        current_user=current_user,
    )
    serialized = serialize_calendar_event(updated, current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="calendar",
        entity_type="calendar_event",
        entity_id=str(updated.id),
        action="update",
        description=f"Updated calendar event {updated.title}",
        before_state=before_state,
        after_state=serialized,
    )
    return CalendarEventResponse.model_validate(serialized)


@router.post("/events/{event_id}/respond", response_model=CalendarEventResponse)
def respond_to_calendar_event_route(
    event_id: int,
    payload: CalendarInviteResponseRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "edit")),
):
    event = get_calendar_event_or_404(db, event_id, tenant_id=current_user.tenant_id, current_user=current_user)
    updated = respond_to_calendar_invite(
        db,
        event=event,
        current_user=current_user,
        response_status=payload.response_status.value,
    )
    serialized = serialize_calendar_event(updated, current_user=current_user)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="calendar",
        entity_type="calendar_event",
        entity_id=str(updated.id),
        action=f"invite_{payload.response_status.value}",
        description=f"{payload.response_status.value.capitalize()} calendar invite {updated.title}",
        after_state=serialized,
    )
    return CalendarEventResponse.model_validate(serialized)


@router.post("/events/from-task/{task_id}", response_model=CalendarTaskCreateResponse, status_code=status.HTTP_201_CREATED)
def create_calendar_event_from_task_route(
    task_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_calendar_module=Depends(require_module_access("calendar")),
    require_calendar_permission=Depends(require_action_access("calendar", "create")),
    require_task_module=Depends(require_module_access("tasks")),
    require_task_permission=Depends(require_action_access("tasks", "view")),
):
    event, reused_existing = create_calendar_event_from_task(db, task_id=task_id, current_user=current_user)
    serialized = serialize_calendar_event(event, current_user=current_user)
    if not reused_existing:
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            module_key="calendar",
            entity_type="calendar_event",
            entity_id=str(event.id),
            action="create_from_task",
            description=f"Created calendar event {event.title} from task {task_id}",
            after_state=serialized,
        )
    return CalendarTaskCreateResponse(
        event=CalendarEventResponse.model_validate(serialized),
        created_from_task_id=task_id,
        reused_existing=reused_existing,
    )


@router.get("/events/from-task/{task_id}", response_model=CalendarTaskEventResponse)
def get_calendar_event_from_task_route(
    task_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_calendar_module=Depends(require_module_access("calendar")),
    require_calendar_permission=Depends(require_action_access("calendar", "view")),
    require_task_module=Depends(require_module_access("tasks")),
    require_task_permission=Depends(require_action_access("tasks", "view")),
):
    event = get_calendar_event_from_task(db, task_id=task_id, current_user=current_user)
    return CalendarTaskEventResponse(
        event=CalendarEventResponse.model_validate(serialize_calendar_event(event, current_user=current_user)) if event else None,
        task_id=task_id,
    )


@router.delete("/events/from-task/{task_id}", response_model=CalendarTaskEventResponse)
def delete_calendar_event_from_task_route(
    task_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_calendar_module=Depends(require_module_access("calendar")),
    require_calendar_permission=Depends(require_action_access("calendar", "delete")),
    require_task_module=Depends(require_module_access("tasks")),
    require_task_permission=Depends(require_action_access("tasks", "view")),
):
    deleted = delete_calendar_event_from_task(db, task_id=task_id, current_user=current_user)
    if deleted:
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            module_key="calendar",
            entity_type="calendar_event",
            entity_id=str(deleted.id),
            action="delete_from_task",
            description=f"Removed calendar event {deleted.title} linked to task {task_id}",
            after_state=serialize_calendar_event(deleted, current_user=current_user),
        )
    return CalendarTaskEventResponse(event=None, task_id=task_id)


@router.post("/sync", response_model=CalendarSyncResponse)
def sync_calendar_route(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "edit")),
):
    result = sync_current_user_calendar(db, current_user=current_user)
    return CalendarSyncResponse.model_validate(result)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_calendar_event_route(
    event_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "delete")),
):
    event = get_calendar_event_or_404(db, event_id, tenant_id=current_user.tenant_id, current_user=current_user)
    if event.owner_user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the event owner can delete this event.")

    before_state = serialize_calendar_event(event, current_user=current_user)
    deleted = delete_calendar_event(db, event=event)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="calendar",
        entity_type="calendar_event",
        entity_id=str(deleted.id),
        action="delete",
        description=f"Deleted calendar event {deleted.title}",
        before_state=before_state,
        after_state=serialize_calendar_event(deleted, current_user=current_user),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
