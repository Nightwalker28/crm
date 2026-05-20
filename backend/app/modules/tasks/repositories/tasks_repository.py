from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.access_control import ADMIN_MIN_ROLE_LEVEL, get_user_role_level
from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.tasks.models import Task, TaskAssignee


def build_task_query(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    include_deleted: bool = False,
    only_deleted: bool = False,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = (
        db.query(Task)
        .options(
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
            selectinload(Task.assignees).selectinload(TaskAssignee.team),
        )
        .filter(Task.tenant_id == tenant_id)
    )
    if only_deleted:
        query = query.filter(Task.deleted_at.is_not(None))
    elif not include_deleted:
        query = query.filter(Task.deleted_at.is_(None))

    role_level = get_user_role_level(db, current_user)
    if role_level is None or role_level < ADMIN_MIN_ROLE_LEVEL:
        visibility_filters = [
            Task.created_by_user_id == current_user.id,
            Task.assignees.any(TaskAssignee.user_id == current_user.id),
        ]
        if getattr(current_user, "team_id", None):
            visibility_filters.append(Task.assignees.any(TaskAssignee.team_id == current_user.team_id))
        query = query.filter(or_(*visibility_filters))

    field_map = {
        "title": {"expression": Task.title, "type": "text"},
        "description": {"expression": Task.description, "type": "text"},
        "status": {"expression": Task.status, "type": "text"},
        "priority": {"expression": Task.priority, "type": "text"},
        "source_label": {"expression": Task.source_label, "type": "text"},
        "source_module_key": {"expression": Task.source_module_key, "type": "text"},
        "source_entity_id": {"expression": Task.source_entity_id, "type": "text"},
        "start_at": {"expression": Task.start_at, "type": "date"},
        "due_at": {"expression": Task.due_at, "type": "date"},
        "assigned_at": {"expression": Task.assigned_at, "type": "date"},
        "created_at": {"expression": Task.created_at, "type": "date"},
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    return apply_ranked_search(
        query,
        search=search,
        document=searchable_text(Task.title, Task.description, Task.status, Task.priority, Task.source_label),
        default_order_column=Task.created_at,
    )


def list_tasks(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = build_task_query(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    tasks = (
        query.order_by(Task.due_at.is_(None), Task.due_at.asc(), Task.created_at.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return tasks, total_count


def get_task(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    task_id: int,
    include_deleted: bool = False,
) -> Task | None:
    return (
        build_task_query(
            db,
            tenant_id=tenant_id,
            current_user=current_user,
            only_deleted=include_deleted,
        )
        .filter(Task.id == task_id)
        .first()
    )


def list_deleted_tasks(db: Session, *, tenant_id: int, pagination):
    query = (
        db.query(Task)
        .options(
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
            selectinload(Task.assignees).selectinload(TaskAssignee.team),
        )
        .filter(Task.tenant_id == tenant_id, Task.deleted_at.is_not(None))
    )
    total_count = query.count()
    tasks = query.order_by(Task.deleted_at.desc(), Task.updated_at.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return tasks, total_count

