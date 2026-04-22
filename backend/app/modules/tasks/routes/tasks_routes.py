from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.activity_logs import log_activity
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
    task, added_keys = create_task(db, payload=payload.model_dump(mode="json"), current_user=current_user)
    create_task_assignment_notifications(db, task=task, current_user=current_user, assignee_keys=added_keys)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="tasks",
        entity_type="task",
        entity_id=str(task.id),
        action="create",
        description=f"Created task {task.title}",
        after_state=serialize_task(task),
    )
    return TaskResponse.model_validate(serialize_task(task))


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
    updated, added_keys = update_task(
        db,
        task=existing,
        payload=payload.model_dump(exclude_unset=True, mode="json"),
        current_user=current_user,
    )
    create_task_assignment_notifications(db, task=updated, current_user=current_user, assignee_keys=added_keys)
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
        after_state=serialize_task(updated),
    )
    return TaskResponse.model_validate(serialize_task(updated))


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
    deleted = delete_task(db, task=existing, current_user=current_user)
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
        after_state=serialize_task(deleted),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
