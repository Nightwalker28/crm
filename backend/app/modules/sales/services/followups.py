from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.access_control import require_department_module_access, require_role_module_action_access
from app.modules.platform.services.activity_logs import log_activity
from app.modules.tasks.services.tasks_services import (
    create_task,
    create_task_assignment_notifications,
    serialize_task,
)


CHANNEL_LABELS = {
    "whatsapp": "WhatsApp",
    "email": "Email",
    "call": "Call",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _display_contact_name(contact) -> str:
    full_name = " ".join(part for part in [getattr(contact, "first_name", None), getattr(contact, "last_name", None)] if part).strip()
    return full_name or getattr(contact, "primary_email", None) or "Contact"


def _display_opportunity_name(opportunity) -> str:
    return getattr(opportunity, "opportunity_name", None) or "Opportunity"


def _require_task_create_access(db: Session, *, current_user) -> None:
    try:
        require_department_module_access(db, user=current_user, module_key="tasks")
        require_role_module_action_access(db, user=current_user, module_key="tasks", action="create")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tasks module is not available.") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc


def _create_follow_up_task(
    db: Session,
    *,
    current_user,
    module_key: str,
    entity_id: str,
    source_label: str,
    channel: str,
    due_at,
    note: str | None,
):
    _require_task_create_access(db, current_user=current_user)
    channel_label = CHANNEL_LABELS[channel]
    task, added_keys = create_task(
        db,
        payload={
            "title": f"Follow up with {source_label}",
            "description": note or f"{channel_label} follow-up for {source_label}.",
            "status": "todo",
            "priority": "medium",
            "due_at": due_at,
            "source_module_key": module_key,
            "source_entity_id": entity_id,
            "source_label": source_label,
            "assignees": [{"assignee_type": "user", "user_id": current_user.id}],
        },
        current_user=current_user,
    )
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
        description=f"Created follow-up task for {source_label}",
        after_state=task_state,
    )
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key=module_key,
        entity_type="sales_contact" if module_key == "sales_contacts" else "sales_opportunity",
        entity_id=entity_id,
        action="task.follow_up_created",
        description=f"Created follow-up task: {task.title}",
        after_state=task_state,
    )
    return task


def log_contact_follow_up(db: Session, *, contact, payload: dict, current_user) -> dict:
    channel = payload["channel"]
    if payload.get("create_follow_up_task"):
        _require_task_create_access(db, current_user=current_user)
    contacted_at = _utcnow()
    contact.last_contacted_at = contacted_at
    contact.last_contacted_channel = channel
    contact.last_contacted_by_user_id = current_user.id
    if channel == "whatsapp":
        contact.whatsapp_last_contacted_at = contacted_at
    db.add(contact)
    db.commit()
    db.refresh(contact)

    source_label = _display_contact_name(contact)
    note = (payload.get("note") or "").strip() or None
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="sales_contacts",
        entity_type="sales_contact",
        entity_id=str(contact.contact_id),
        action=f"follow_up.{channel}",
        description=f"Logged {CHANNEL_LABELS[channel]} follow-up for {source_label}",
        after_state={
            "channel": channel,
            "note": note,
            "last_contacted_at": contacted_at.isoformat(),
        },
    )

    task = None
    if payload.get("create_follow_up_task"):
        task = _create_follow_up_task(
            db,
            current_user=current_user,
            module_key="sales_contacts",
            entity_id=str(contact.contact_id),
            source_label=source_label,
            channel=channel,
            due_at=payload.get("follow_up_due_at"),
            note=note,
        )

    return {
        "module_key": "sales_contacts",
        "entity_id": str(contact.contact_id),
        "channel": channel,
        "last_contacted_at": contacted_at,
        "follow_up_task_id": task.id if task else None,
    }


def log_opportunity_follow_up(db: Session, *, opportunity, payload: dict, current_user) -> dict:
    channel = payload["channel"]
    if payload.get("create_follow_up_task"):
        _require_task_create_access(db, current_user=current_user)
    contacted_at = _utcnow()
    opportunity.last_contacted_at = contacted_at
    opportunity.last_contacted_channel = channel
    opportunity.last_contacted_by_user_id = current_user.id
    db.add(opportunity)
    db.commit()
    db.refresh(opportunity)

    source_label = _display_opportunity_name(opportunity)
    note = (payload.get("note") or "").strip() or None
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="sales_opportunities",
        entity_type="sales_opportunity",
        entity_id=str(opportunity.opportunity_id),
        action=f"follow_up.{channel}",
        description=f"Logged {CHANNEL_LABELS[channel]} follow-up for {source_label}",
        after_state={
            "channel": channel,
            "note": note,
            "last_contacted_at": contacted_at.isoformat(),
        },
    )

    task = None
    if payload.get("create_follow_up_task"):
        task = _create_follow_up_task(
            db,
            current_user=current_user,
            module_key="sales_opportunities",
            entity_id=str(opportunity.opportunity_id),
            source_label=source_label,
            channel=channel,
            due_at=payload.get("follow_up_due_at"),
            note=note,
        )

    return {
        "module_key": "sales_opportunities",
        "entity_id": str(opportunity.opportunity_id),
        "channel": channel,
        "last_contacted_at": contacted_at,
        "follow_up_task_id": task.id if task else None,
    }
