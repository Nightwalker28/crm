from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.core.pagination import Pagination
from app.modules.platform.models import CrmEvent
from app.modules.platform.services.crm_events import safe_emit_crm_event
from app.modules.platform.services.notifications import create_notification
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.tasks.repositories import tasks_repository
from app.modules.tasks.schema import TaskResponse
from app.modules.user_management.models import Team, User


TASK_ASSIGNMENT_NOTIFICATION_CATEGORY = "task_assignment"
TASK_DUE_TODAY_NOTIFICATION_CATEGORY = "task_due_today"
logger = logging.getLogger(__name__)


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


def _clean_required_title(value) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Task title is required")
    return cleaned


def list_tasks(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    pagination: Pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[Sequence[Task], int]:
    tasks, total_count = tasks_repository.list_tasks(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        pagination=pagination,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    return tasks, total_count


def list_tasks_cursor(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> Sequence[Task]:
    return tasks_repository.list_tasks_cursor(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        limit=limit,
        cursor=cursor,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )


def get_task_or_404(
    db: Session,
    task_id: int,
    *,
    tenant_id: int,
    current_user,
    include_deleted: bool = False,
) -> Task:
    task = tasks_repository.get_task(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        task_id=task_id,
        include_deleted=include_deleted,
    )
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return task


def get_deleted_task_or_404(
    db: Session,
    task_id: int,
    *,
    tenant_id: int,
    current_user,
) -> Task:
    task = tasks_repository.get_deleted_task(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        task_id=task_id,
    )
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found in recycle bin")
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


def _existing_task_due_alert_ids(
    db: Session,
    *,
    tenant_id: int,
    task_ids: Sequence[int],
    day_start: datetime,
    day_end: datetime,
) -> set[int]:
    if not task_ids:
        return set()
    rows = (
        db.query(CrmEvent.entity_id)
        .filter(
            CrmEvent.tenant_id == tenant_id,
            CrmEvent.event_type == "task.due_today",
            CrmEvent.entity_type == "task",
            CrmEvent.entity_id.in_([str(task_id) for task_id in task_ids]),
            CrmEvent.created_at >= day_start,
            CrmEvent.created_at < day_end,
        )
        .all()
    )
    return {int(entity_id) for (entity_id,) in rows if str(entity_id).isdigit()}


def _task_due_alert_exists(db: Session, *, tenant_id: int, task_id: int, day_start: datetime, day_end: datetime) -> bool:
    return task_id in _existing_task_due_alert_ids(
        db,
        tenant_id=tenant_id,
        task_ids=[task_id],
        day_start=day_start,
        day_end=day_end,
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


def _safe_create_task_notification(db: Session, *, task: Task, user_id: int, category: str, title: str, message: str, link_url: str, metadata: dict, commit: bool = True) -> bool:
    try:
        create_notification(
            db,
            tenant_id=task.tenant_id,
            user_id=user_id,
            category=category,
            title=title,
            message=message,
            link_url=link_url,
            metadata=metadata,
            commit=commit,
        )
        return True
    except Exception:
        db.rollback()
        logger.exception(
            "Task notification creation failed",
            extra={
                "tenant_id": task.tenant_id,
                "task_id": task.id,
                "user_id": user_id,
                "category": category,
            },
        )
        return False


def emit_task_due_today_alert(
    db: Session,
    *,
    task: Task,
    actor_user_id: int | None,
    day_start: datetime,
    day_end: datetime,
    payload: dict | None = None,
    notify_assignees: bool = True,
) -> tuple[bool, int]:
    if _task_due_alert_exists(
        db,
        tenant_id=task.tenant_id,
        task_id=task.id,
        day_start=day_start,
        day_end=day_end,
    ):
        return False, 0

    event = safe_emit_crm_event(
        db,
        tenant_id=task.tenant_id,
        actor_user_id=actor_user_id,
        event_type="task.due_today",
        entity_type="task",
        entity_id=task.id,
        payload=payload or _task_due_alert_payload(task),
    )
    if event is None:
        return False, 0

    notifications_created = 0
    if notify_assignees:
        for user_id in _task_due_notification_user_ids(db, task=task):
            if _safe_create_task_notification(
                db,
                task=task,
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
            ):
                notifications_created += 1
    return True, notifications_created


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
    alerted_by_tenant: dict[int, set[int]] = {}
    for task in due_tasks:
        alerted_by_tenant.setdefault(task.tenant_id, set())
    for tenant_id, task_ids in {
        tenant_id: [task.id for task in due_tasks if task.tenant_id == tenant_id]
        for tenant_id in alerted_by_tenant
    }.items():
        alerted_by_tenant[tenant_id] = _existing_task_due_alert_ids(
            db,
            tenant_id=tenant_id,
            task_ids=task_ids,
            day_start=day_start,
            day_end=day_end,
        )

    for task in due_tasks:
        if task.id in alerted_by_tenant.get(task.tenant_id, set()):
            continue

        emitted, notification_count = emit_task_due_today_alert(
            db,
            task=task,
            actor_user_id=task.assigned_by_user_id or task.updated_by_user_id or task.created_by_user_id,
            day_start=day_start,
            day_end=day_end,
        )
        if not emitted:
            continue
        alerts_created += 1
        notifications_created += notification_count

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
    commit: bool = True,
) -> None:
    if not assignee_keys:
        return

    user_ids = _resolve_notification_user_ids(db, tenant_id=tenant_id, assignee_keys=assignee_keys)
    for user_id in user_ids:
        _safe_create_task_notification(
            db,
            task=task,
            user_id=user_id,
            category=TASK_ASSIGNMENT_NOTIFICATION_CATEGORY,
            title=f"Task assigned: {task.title}",
            message=f"{actor_name or 'A teammate'} assigned a task to you or your team.",
            link_url=f"/dashboard/tasks?taskId={task.id}",
            metadata={
                "task_id": task.id,
                "task_status": task.status,
                "task_priority": task.priority,
            },
            commit=commit,
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


def create_task(db: Session, *, payload: dict, current_user, commit: bool = True) -> tuple[Task, list[str]]:
    data = dict(payload)
    assignees_payload = data.pop("assignees", None)
    try:
        task = Task(
            tenant_id=current_user.tenant_id,
            title=_clean_required_title(data.get("title")),
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
        task_id = task.id
        if commit:
            db.commit()
        else:
            db.flush()
    except Exception:
        db.rollback()
        raise
    if not commit:
        return task, added_keys
    return get_task_or_404(db, task_id, tenant_id=current_user.tenant_id, current_user=current_user), added_keys


def update_task(db: Session, *, task: Task, payload: dict, current_user) -> tuple[Task, list[str]]:
    data = dict(payload)
    assignees_payload = data.pop("assignees", None)

    for field in ("title", "description", "status", "priority", "start_at", "due_at", "completed_at", "source_module_key", "source_entity_id", "source_label"):
        if field not in data:
            continue
        value = data[field]
        if field == "title":
            value = _clean_required_title(value)
            setattr(task, field, value)
            continue
        if field in {"title", "description", "source_module_key", "source_entity_id", "source_label"} and isinstance(value, str):
            value = value.strip() or None
        setattr(task, field, value)

    task.updated_by_user_id = current_user.id

    added_keys: list[str] = []
    removed_keys: list[str] = []
    try:
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
        task_id = task.id
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_task_or_404(db, task_id, tenant_id=current_user.tenant_id, current_user=current_user), added_keys


def delete_task(db: Session, *, task: Task, current_user) -> Task:
    try:
        task.deleted_at = _utcnow()
        task.updated_by_user_id = current_user.id
        db.add(task)
        db.commit()
        db.refresh(task)
    except Exception:
        db.rollback()
        raise
    return task


def list_deleted_tasks(
    db: Session,
    *,
    tenant_id: int,
    current_user,
    pagination: Pagination,
) -> tuple[Sequence[Task], int]:
    return tasks_repository.list_deleted_tasks(
        db,
        tenant_id=tenant_id,
        current_user=current_user,
        pagination=pagination,
    )


def restore_task(db: Session, *, task: Task, current_user) -> Task:
    try:
        task.deleted_at = None
        task.updated_by_user_id = current_user.id
        db.add(task)
        db.commit()
        db.refresh(task)
    except Exception:
        db.rollback()
        raise
    return task


def create_task_assignment_notifications(db: Session, *, task: Task, current_user, assignee_keys: list[str], commit: bool = True) -> None:
    _notify_task_assignees(
        db,
        task=task,
        tenant_id=current_user.tenant_id,
        assignee_keys=assignee_keys,
        actor_name=_display_user_name(current_user),
        commit=commit,
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
                "team_name": getattr(getattr(user, "team", None), "name", None),
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
