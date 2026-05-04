from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.access_control import ADMIN_MIN_ROLE_LEVEL, get_user_role_level
from app.core.module_filters import apply_filter_conditions
from app.core.module_search import apply_ranked_search
from app.core.pagination import Pagination
from app.core.postgres_search import searchable_text
from app.modules.platform.models import CrmEvent
from app.modules.platform.services.crm_events import safe_emit_crm_event
from app.modules.platform.services.notifications import create_notification
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.tasks.schema import TaskResponse
from app.modules.user_management.models import Team, User


TASK_ASSIGNMENT_NOTIFICATION_CATEGORY = "task_assignment"
TASK_DUE_TODAY_NOTIFICATION_CATEGORY = "task_due_today"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_datetime(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _display_user_name(user: User | None) -> str | None:
    if not user:
        return None
    full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return full_name or user.email or None


def _task_assignee_labels(task: Task) -> str:
    labels = [getattr(assignee, "label", None) for assignee in getattr(task, "assignees", [])]
    return ", ".join(label for label in labels if label) or "Unassigned"


def _assignee_key(assignee_type: str, target_id: int) -> str:
    return f"{assignee_type}:{target_id}"


def _build_task_query(
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
        .filter(
            Task.tenant_id == tenant_id,
        )
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
    query = apply_filter_conditions(
        query,
        conditions=all_filter_conditions,
        logic="all",
        field_map=field_map,
    )
    query = apply_filter_conditions(
        query,
        conditions=any_filter_conditions,
        logic="any",
        field_map=field_map,
    )

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
    pagination: Pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[Sequence[Task], int]:
    query = _build_task_query(
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


def get_task_or_404(
    db: Session,
    task_id: int,
    *,
    tenant_id: int,
    current_user,
    include_deleted: bool = False,
) -> Task:
    query = _build_task_query(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        only_deleted=include_deleted,
    ).filter(Task.id == task_id)
    task = query.first()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def _normalize_assignees(
    db: Session,
    *,
    tenant_id: int,
    assignees_payload: list[dict] | None,
    current_user,
) -> list[dict]:
    raw_assignees = assignees_payload or []

    normalized: list[dict] = []
    seen_keys: set[str] = set()

    for item in raw_assignees:
        assignee_type = item.get("assignee_type")
        if assignee_type == "user":
            user_id = item.get("user_id")
            if not user_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User assignee requires user_id")
            user = (
                db.query(User)
                .filter(User.id == user_id, User.tenant_id == tenant_id)
                .first()
            )
            if not user:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee user not found")
            key = _assignee_key("user", user_id)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            normalized.append(
                {
                    "assignee_type": "user",
                    "assignee_key": key,
                    "user_id": user_id,
                    "team_id": None,
                }
            )
            continue

        if assignee_type == "team":
            team_id = item.get("team_id")
            if not team_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Team assignee requires team_id")
            team = (
                db.query(Team)
                .filter(Team.id == team_id, Team.tenant_id == tenant_id)
                .first()
            )
            if not team:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assignee team not found")
            key = _assignee_key("team", team_id)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            normalized.append(
                {
                    "assignee_type": "team",
                    "assignee_key": key,
                    "user_id": None,
                    "team_id": team_id,
                }
            )
            continue

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported assignee type")

    return normalized


def _sync_task_assignees(
    db: Session,
    *,
    task: Task,
    tenant_id: int,
    current_user,
    assignees_payload: list[dict] | None,
) -> tuple[list[str], list[str], bool]:
    normalized = _normalize_assignees(
        db,
        tenant_id=tenant_id,
        assignees_payload=assignees_payload,
        current_user=current_user,
    )
    next_map = {item["assignee_key"]: item for item in normalized}
    current_map = {item.assignee_key: item for item in task.assignees}

    removed_keys = [key for key in current_map if key not in next_map]
    added_keys = [key for key in next_map if key not in current_map]

    for key in removed_keys:
        db.delete(current_map[key])

    for key in added_keys:
        db.add(
            TaskAssignee(
                tenant_id=tenant_id,
                task_id=task.id,
                assignee_type=next_map[key]["assignee_type"],
                assignee_key=key,
                user_id=next_map[key]["user_id"],
                team_id=next_map[key]["team_id"],
            )
        )

    return added_keys, removed_keys, bool(next_map)


def _update_assignment_metadata(
    *,
    task: Task,
    current_user,
    assignees_changed: bool,
    has_assignees: bool,
) -> None:
    if not assignees_changed:
        return
    if has_assignees:
        task.assigned_by_user_id = current_user.id
        task.assigned_at = _utcnow()
    else:
        task.assigned_by_user_id = None
        task.assigned_at = None


def _resolve_notification_user_ids(db: Session, *, tenant_id: int, assignee_keys: list[str]) -> list[int]:
    user_ids: set[int] = set()
    for key in assignee_keys:
        assignee_type, _, raw_id = key.partition(":")
        if assignee_type == "user" and raw_id.isdigit():
            user_ids.add(int(raw_id))
            continue
        if assignee_type == "team" and raw_id.isdigit():
            members = (
                db.query(User.id)
                .filter(
                    User.tenant_id == tenant_id,
                    User.team_id == int(raw_id),
                )
                .all()
            )
            user_ids.update(user_id for (user_id,) in members)
    return sorted(user_ids)


def _task_due_alert_exists(db: Session, *, tenant_id: int, task_id: int, day_start: datetime, day_end: datetime) -> bool:
    return (
        db.query(CrmEvent.id)
        .filter(
            CrmEvent.tenant_id == tenant_id,
            CrmEvent.event_type == "task.due_today",
            CrmEvent.entity_type == "task",
            CrmEvent.entity_id == str(task_id),
            CrmEvent.created_at >= day_start,
            CrmEvent.created_at < day_end,
        )
        .first()
        is not None
    )


def _task_due_alert_payload(task: Task) -> dict:
    return {
        "task_id": task.id,
        "task_title": task.title,
        "priority": task.priority,
        "status": task.status,
        "due_at": task.due_at,
        "assignees": _task_assignee_labels(task),
        "assigned_by_name": _display_user_name(task.assigned_by),
        "href": f"/dashboard/tasks?taskId={task.id}",
    }


def _task_due_notification_user_ids(db: Session, *, task: Task) -> list[int]:
    assignee_keys = [assignee.assignee_key for assignee in getattr(task, "assignees", [])]
    user_ids = set(_resolve_notification_user_ids(db, tenant_id=task.tenant_id, assignee_keys=assignee_keys))
    if not user_ids and task.created_by_user_id:
        user_ids.add(int(task.created_by_user_id))
    return sorted(user_ids)


def scan_due_task_alerts(db: Session, *, now: datetime | None = None) -> dict:
    scan_time = now or _utcnow()
    if scan_time.tzinfo is None:
        scan_time = scan_time.replace(tzinfo=timezone.utc)
    scan_time = scan_time.astimezone(timezone.utc)
    day_start = scan_time.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)

    due_tasks = (
        db.query(Task)
        .options(
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
            selectinload(Task.assignees).selectinload(TaskAssignee.team),
            selectinload(Task.assigned_by),
        )
        .filter(
            Task.deleted_at.is_(None),
            Task.status != "completed",
            Task.due_at >= day_start,
            Task.due_at < day_end,
        )
        .order_by(Task.due_at.asc(), Task.id.asc())
        .all()
    )

    alerts_created = 0
    notifications_created = 0
    for task in due_tasks:
        if _task_due_alert_exists(
            db,
            tenant_id=task.tenant_id,
            task_id=task.id,
            day_start=day_start,
            day_end=day_end,
        ):
            continue

        payload = _task_due_alert_payload(task)
        event = safe_emit_crm_event(
            db,
            tenant_id=task.tenant_id,
            actor_user_id=task.assigned_by_user_id or task.updated_by_user_id or task.created_by_user_id,
            event_type="task.due_today",
            entity_type="task",
            entity_id=task.id,
            payload=payload,
        )
        if event is None:
            continue
        alerts_created += 1

        for user_id in _task_due_notification_user_ids(db, task=task):
            create_notification(
                db,
                tenant_id=task.tenant_id,
                user_id=user_id,
                category=TASK_DUE_TODAY_NOTIFICATION_CATEGORY,
                title=f"Task due today: {task.title}",
                message="A task assigned to you or your team is due today.",
                link_url=f"/dashboard/tasks?taskId={task.id}",
                metadata={
                    "task_id": task.id,
                    "due_at": _serialize_datetime(task.due_at),
                    "alert_date": day_start.date().isoformat(),
                },
            )
            notifications_created += 1

    return {
        "scan_date": day_start.date().isoformat(),
        "due_tasks": len(due_tasks),
        "alerts_created": alerts_created,
        "notifications_created": notifications_created,
    }


def _notify_task_assignees(
    db: Session,
    *,
    task: Task,
    tenant_id: int,
    assignee_keys: list[str],
    actor_name: str | None,
) -> None:
    if not assignee_keys:
        return

    user_ids = _resolve_notification_user_ids(db, tenant_id=tenant_id, assignee_keys=assignee_keys)
    due_suffix = f" Due {task.due_at.strftime('%b %d, %Y %H:%M')}" if task.due_at else ""
    for user_id in user_ids:
        create_notification(
            db,
            tenant_id=tenant_id,
            user_id=user_id,
            category=TASK_ASSIGNMENT_NOTIFICATION_CATEGORY,
            title=f"Task assigned: {task.title}",
            message=f"{actor_name or 'A teammate'} assigned a task to you or your team.{due_suffix}".strip(),
            link_url=f"/dashboard/tasks?taskId={task.id}",
            metadata={
                "task_id": task.id,
                "task_status": task.status,
                "task_priority": task.priority,
            },
        )


def serialize_task(task: Task) -> dict:
    return TaskResponse.model_validate(
        {
        "id": task.id,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "priority": task.priority,
        "start_at": _serialize_datetime(task.start_at),
        "due_at": _serialize_datetime(task.due_at),
        "completed_at": _serialize_datetime(task.completed_at),
        "source_module_key": task.source_module_key,
        "source_entity_id": task.source_entity_id,
        "source_label": task.source_label,
        "created_by_user_id": task.created_by_user_id,
        "updated_by_user_id": task.updated_by_user_id,
        "assigned_by_user_id": task.assigned_by_user_id,
        "created_by_name": _display_user_name(task.creator),
        "updated_by_name": _display_user_name(task.updated_by),
        "assigned_by_name": _display_user_name(task.assigned_by),
        "assigned_at": _serialize_datetime(task.assigned_at),
        "created_at": _serialize_datetime(task.created_at),
        "updated_at": _serialize_datetime(task.updated_at),
        "assignees": [
            {
                "assignee_type": assignee.assignee_type,
                "assignee_key": assignee.assignee_key,
                "user_id": assignee.user_id,
                "team_id": assignee.team_id,
                "label": assignee.label,
            }
            for assignee in sorted(task.assignees, key=lambda item: item.assignee_key)
        ],
        }
    ).model_dump(mode="json")


def create_task(db: Session, *, payload: dict, current_user) -> tuple[Task, list[str]]:
    data = dict(payload)
    assignees_payload = data.pop("assignees", None)
    task = Task(
        tenant_id=current_user.tenant_id,
        title=data["title"].strip(),
        description=(data.get("description") or "").strip() or None,
        status=data.get("status", "todo"),
        priority=data.get("priority", "medium"),
        start_at=data.get("start_at"),
        due_at=data.get("due_at"),
        completed_at=data.get("completed_at"),
        source_module_key=(data.get("source_module_key") or "").strip() or None,
        source_entity_id=str(data.get("source_entity_id")).strip() if data.get("source_entity_id") not in {None, ""} else None,
        source_label=(data.get("source_label") or "").strip() or None,
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )
    db.add(task)
    db.flush()
    added_keys, _, has_assignees = _sync_task_assignees(
        db,
        task=task,
        tenant_id=current_user.tenant_id,
        current_user=current_user,
        assignees_payload=assignees_payload,
    )
    _update_assignment_metadata(
        task=task,
        current_user=current_user,
        assignees_changed=bool(added_keys),
        has_assignees=has_assignees,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return get_task_or_404(db, task.id, tenant_id=current_user.tenant_id, current_user=current_user), added_keys


def update_task(db: Session, *, task: Task, payload: dict, current_user) -> tuple[Task, list[str]]:
    data = dict(payload)
    assignees_payload = data.pop("assignees", None)

    for field in ("title", "description", "status", "priority", "start_at", "due_at", "completed_at", "source_module_key", "source_entity_id", "source_label"):
        if field not in data:
            continue
        value = data[field]
        if field in {"title", "description", "source_module_key", "source_entity_id", "source_label"} and isinstance(value, str):
            value = value.strip() or None
        setattr(task, field, value)

    task.updated_by_user_id = current_user.id

    added_keys: list[str] = []
    removed_keys: list[str] = []
    if assignees_payload is not None:
        added_keys, removed_keys, has_assignees = _sync_task_assignees(
            db,
            task=task,
            tenant_id=current_user.tenant_id,
            current_user=current_user,
            assignees_payload=assignees_payload,
        )
        _update_assignment_metadata(
            task=task,
            current_user=current_user,
            assignees_changed=bool(added_keys or removed_keys),
            has_assignees=has_assignees,
        )

    db.add(task)
    db.commit()
    db.refresh(task)
    return get_task_or_404(db, task.id, tenant_id=current_user.tenant_id, current_user=current_user), added_keys


def delete_task(db: Session, *, task: Task, current_user) -> Task:
    task.deleted_at = _utcnow()
    task.updated_by_user_id = current_user.id
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def list_deleted_tasks(
    db: Session,
    *,
    tenant_id: int,
    pagination: Pagination,
) -> tuple[Sequence[Task], int]:
    query = (
        db.query(Task)
        .options(
            selectinload(Task.assignees).selectinload(TaskAssignee.user),
            selectinload(Task.assignees).selectinload(TaskAssignee.team),
        )
        .filter(
            Task.tenant_id == tenant_id,
            Task.deleted_at.is_not(None),
        )
    )
    total_count = query.count()
    tasks = (
        query.order_by(Task.deleted_at.desc(), Task.updated_at.desc())
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return tasks, total_count


def restore_task(db: Session, *, task: Task, current_user) -> Task:
    task.deleted_at = None
    task.updated_by_user_id = current_user.id
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def create_task_assignment_notifications(db: Session, *, task: Task, current_user, assignee_keys: list[str]) -> None:
    _notify_task_assignees(
        db,
        task=task,
        tenant_id=current_user.tenant_id,
        assignee_keys=assignee_keys,
        actor_name=_display_user_name(current_user),
    )


def list_task_assignment_options(db: Session, *, tenant_id: int) -> dict:
    users = (
        db.query(User)
        .options(selectinload(User.team))
        .filter(User.tenant_id == tenant_id)
        .order_by(User.first_name.asc(), User.last_name.asc(), User.email.asc())
        .all()
    )
    teams = db.query(Team).filter(Team.tenant_id == tenant_id).order_by(Team.name.asc()).all()

    return {
        "users": [
            {
                "id": user.id,
                "name": _display_user_name(user) or f"User {user.id}",
                "email": user.email,
                "team_id": user.team_id,
                "team_name": user.team_name,
            }
            for user in users
        ],
        "teams": [
            {
                "id": team.id,
                "name": team.name,
                "department_id": team.department_id,
            }
            for team in teams
        ],
    }
