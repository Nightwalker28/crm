from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.access_control import require_role_module_action_access
from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.crm_events import actor_payload, safe_emit_crm_event
from app.modules.platform.services.record_comments import get_record_comment_module_config, get_record_reference
from app.modules.tasks.schema import (
    TaskAssignmentOptionsResponse,
    TaskCreateRequest,
    TaskListResponse,
    TaskResponse,
    TaskUpdateRequest,
)
from app.modules.tasks.services.tasks_services import (
    create_task,
    create_task_assignment_notifications,
    delete_task,
    get_task_or_404,
    list_task_assignment_options,
    list_tasks,
    serialize_task,
    update_task,
)


router = APIRouter(prefix="/tasks", tags=["Tasks"])


def _user_today(current_user) -> object:
    timezone_name = getattr(current_user, "timezone", None) or "UTC"
    try:
        tzinfo = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        tzinfo = timezone.utc
    return datetime.now(tzinfo).date()


def _is_due_today(task, current_user) -> bool:
    if not task.due_at:
        return False
    due_at = task.due_at
    if due_at.tzinfo is None:
        due_at = due_at.replace(tzinfo=timezone.utc)
    timezone_name = getattr(current_user, "timezone", None) or "UTC"
    try:
        due_at = due_at.astimezone(ZoneInfo(timezone_name))
    except ZoneInfoNotFoundError:
        due_at = due_at.astimezone(timezone.utc)
    return due_at.date() == _user_today(current_user)


def _task_assignee_labels(task) -> str:
    labels = [getattr(assignee, "label", None) for assignee in getattr(task, "assignees", [])]
    return ", ".join(label for label in labels if label) or "Unassigned"


def _emit_task_alert_events(db: Session, *, current_user, task, added_keys: list[str]) -> None:
    payload = {
        **actor_payload(current_user),
        "task_id": task.id,
        "task_title": task.title,
        "priority": task.priority,
        "status": task.status,
        "due_at": task.due_at,
        "assignees": _task_assignee_labels(task),
        "assigned_by_name": getattr(task, "assigned_by_name", None),
        "href": f"/dashboard/tasks?taskId={task.id}",
    }
    if added_keys:
        safe_emit_crm_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            event_type="task.assigned",
            entity_type="task",
            entity_id=task.id,
            payload=payload,
        )
    if _is_due_today(task, current_user):
        safe_emit_crm_event(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            event_type="task.due_today",
            entity_type="task",
            entity_id=task.id,
            payload=payload,
        )


def _normalize_source_value(value) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _resolve_task_source_context(
    db: Session,
    *,
    current_user,
    source_module_key: str | None,
    source_entity_id: str | None,
    strict: bool,
) -> dict | None:
    module_key = _normalize_source_value(source_module_key)
    entity_id = _normalize_source_value(source_entity_id)
    if not module_key and not entity_id:
        return None
    if not module_key or not entity_id:
        if strict:
            raise HTTPException(status_code=400, detail="Task source requires both module and record.")
        return None

    try:
        require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        config = get_record_comment_module_config(module_key)
        get_record_reference(
            db,
            tenant_id=current_user.tenant_id,
            module_key=module_key,
            entity_id=entity_id,
        )
    except HTTPException:
        if strict:
            raise
        return None
    except PermissionError as exc:
        if strict:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        return None
    except ValueError as exc:
        if strict:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return None

    return {
        "module_key": module_key,
        "entity_type": config["entity_type"],
        "entity_id": entity_id,
    }


def _resolve_payload_source_context(
    db: Session,
    *,
    current_user,
    payload: dict,
    existing_task=None,
) -> dict | None:
    source_module_key = payload.get(
        "source_module_key",
        getattr(existing_task, "source_module_key", None),
    )
    source_entity_id = payload.get(
        "source_entity_id",
        getattr(existing_task, "source_entity_id", None),
    )
    return _resolve_task_source_context(
        db,
        current_user=current_user,
        source_module_key=source_module_key,
        source_entity_id=source_entity_id,
        strict=True,
    )


def _mirror_task_source_activity(
    db: Session,
    *,
    current_user,
    task,
    action: str,
    description: str,
    before_state: dict | None = None,
    after_state: dict | None = None,
    source_context: dict | None = None,
) -> None:
    context = source_context or _resolve_task_source_context(
        db,
        current_user=current_user,
        source_module_key=getattr(task, "source_module_key", None),
        source_entity_id=getattr(task, "source_entity_id", None),
        strict=False,
    )
    if not context:
        return

    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key=context["module_key"],
        entity_type=context["entity_type"],
        entity_id=context["entity_id"],
        action=action,
        description=description,
        before_state=before_state,
        after_state=after_state,
    )


@router.get("", response_model=TaskListResponse)
def get_tasks(
    query: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("tasks")),
    require_permission=Depends(require_action_access("tasks", "view")),
):
    try:
        all_conditions = parse_filter_conditions(
            filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None)
        )
        any_conditions = parse_filter_conditions(
            filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    tasks, total_count = list_tasks(
        db,
        tenant_id=current_user.tenant_id,
        current_user=current_user,
        pagination=pagination,
        search=query,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    serialized = [TaskResponse.model_validate(serialize_task(task)) for task in tasks]
    return build_paged_response(serialized, total_count=total_count, pagination=pagination)


@router.get("/options", response_model=TaskAssignmentOptionsResponse)
def get_task_assignment_options(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("tasks")),
    require_permission=Depends(require_action_access("tasks", "view")),
):
    return list_task_assignment_options(db, tenant_id=current_user.tenant_id)


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("tasks")),
    require_permission=Depends(require_action_access("tasks", "view")),
):
    task = get_task_or_404(db, task_id, tenant_id=current_user.tenant_id, current_user=current_user)
    return TaskResponse.model_validate(serialize_task(task))


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task_route(
    payload: TaskCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("tasks")),
    require_permission=Depends(require_action_access("tasks", "create")),
):
    payload_data = payload.model_dump(mode="json")
    source_context = _resolve_payload_source_context(db, current_user=current_user, payload=payload_data)
    task, added_keys = create_task(db, payload=payload_data, current_user=current_user)
    create_task_assignment_notifications(db, task=task, current_user=current_user, assignee_keys=added_keys)
    task_state = serialize_task(task)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="tasks",
        entity_type="task",
        entity_id=str(task.id),
        action="create",
        description=f"Created task {task.title}",
        after_state=task_state,
    )
    _mirror_task_source_activity(
        db,
        current_user=current_user,
        task=task,
        action="task.create",
        description=f"Created task {task.title}",
        after_state=task_state,
        source_context=source_context,
    )
    _emit_task_alert_events(db, current_user=current_user, task=task, added_keys=added_keys)
    return TaskResponse.model_validate(task_state)


@router.put("/{task_id}", response_model=TaskResponse)
def update_task_route(
    task_id: int,
    payload: TaskUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("tasks")),
    require_permission=Depends(require_action_access("tasks", "edit")),
):
    existing = get_task_or_404(db, task_id, tenant_id=current_user.tenant_id, current_user=current_user)
    before_state = serialize_task(existing)
    payload_data = payload.model_dump(exclude_unset=True, mode="json")
    source_context = _resolve_payload_source_context(
        db,
        current_user=current_user,
        payload=payload_data,
        existing_task=existing,
    )
    updated, added_keys = update_task(
        db,
        task=existing,
        payload=payload_data,
        current_user=current_user,
    )
    create_task_assignment_notifications(db, task=updated, current_user=current_user, assignee_keys=added_keys)
    task_state = serialize_task(updated)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="tasks",
        entity_type="task",
        entity_id=str(updated.id),
        action="update",
        description=f"Updated task {updated.title}",
        before_state=before_state,
        after_state=task_state,
    )
    _mirror_task_source_activity(
        db,
        current_user=current_user,
        task=updated,
        action="task.update",
        description=f"Updated task {updated.title}",
        before_state=before_state,
        after_state=task_state,
        source_context=source_context,
    )
    _emit_task_alert_events(db, current_user=current_user, task=updated, added_keys=added_keys)
    return TaskResponse.model_validate(task_state)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_route(
    task_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("tasks")),
    require_permission=Depends(require_action_access("tasks", "delete")),
):
    existing = get_task_or_404(db, task_id, tenant_id=current_user.tenant_id, current_user=current_user)
    before_state = serialize_task(existing)
    source_context = _resolve_task_source_context(
        db,
        current_user=current_user,
        source_module_key=existing.source_module_key,
        source_entity_id=existing.source_entity_id,
        strict=False,
    )
    deleted = delete_task(db, task=existing, current_user=current_user)
    deleted_state = serialize_task(deleted)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="tasks",
        entity_type="task",
        entity_id=str(deleted.id),
        action="delete",
        description=f"Deleted task {deleted.title}",
        before_state=before_state,
        after_state=deleted_state,
    )
    _mirror_task_source_activity(
        db,
        current_user=current_user,
        task=deleted,
        action="task.delete",
        description=f"Deleted task {deleted.title}",
        before_state=before_state,
        after_state=deleted_state,
        source_context=source_context,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
