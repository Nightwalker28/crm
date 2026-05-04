from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.models import SalesContact, SalesOpportunity
from app.modules.tasks.models import Task
from app.modules.tasks.services.tasks_services import (
    create_task,
    create_task_assignment_notifications,
    serialize_task,
)
from app.modules.user_management.models import User


CLOSED_OPPORTUNITY_STAGES = {"closed_won", "closed_lost"}
NO_REPLY_TITLE_PREFIX = "No reply follow-up"
INACTIVE_DEAL_TITLE_PREFIX = "Review inactive deal"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _display_contact_name(contact: SalesContact) -> str:
    full_name = " ".join(part for part in [contact.first_name, contact.last_name] if part).strip()
    return full_name or contact.primary_email or f"Contact {contact.contact_id}"


def _display_opportunity_name(opportunity: SalesOpportunity) -> str:
    return opportunity.opportunity_name or f"Opportunity {opportunity.opportunity_id}"


def _has_open_reminder_task(
    db: Session,
    *,
    tenant_id: int,
    source_module_key: str,
    source_entity_id: str,
    title: str,
) -> bool:
    return (
        db.query(Task.id)
        .filter(
            Task.tenant_id == tenant_id,
            Task.deleted_at.is_(None),
            Task.status != "completed",
            Task.source_module_key == source_module_key,
            Task.source_entity_id == source_entity_id,
            Task.title == title,
        )
        .first()
        is not None
    )


def _automation_actor(db: Session, *, tenant_id: int, user_id: int | None):
    if user_id:
        user = db.query(User).filter(User.tenant_id == tenant_id, User.id == user_id).first()
        if user:
            return user
    return SimpleNamespace(id=None, tenant_id=tenant_id, first_name=None, last_name=None, email="Lynk Automation")


def _create_source_linked_reminder_task(
    db: Session,
    *,
    tenant_id: int,
    assigned_to_user_id: int,
    source_module_key: str,
    source_entity_id: str,
    source_label: str,
    title: str,
    description: str,
    due_at: datetime,
) -> Task:
    actor = _automation_actor(db, tenant_id=tenant_id, user_id=assigned_to_user_id)
    task, added_keys = create_task(
        db,
        payload={
            "title": title,
            "description": description,
            "status": "todo",
            "priority": "medium",
            "due_at": due_at,
            "source_module_key": source_module_key,
            "source_entity_id": source_entity_id,
            "source_label": source_label,
            "assignees": [{"assignee_type": "user", "user_id": assigned_to_user_id}],
        },
        current_user=actor,
    )
    create_task_assignment_notifications(db, task=task, current_user=actor, assignee_keys=added_keys)
    task_state = serialize_task(task)
    source_entity_type = {
        "sales_contacts": "sales_contact",
        "sales_opportunities": "sales_opportunity",
    }[source_module_key]
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=getattr(actor, "id", None),
        module_key="tasks",
        entity_type="task",
        entity_id=str(task.id),
        action="create",
        description=f"Created automated reminder task: {task.title}",
        after_state=task_state,
    )
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=getattr(actor, "id", None),
        module_key=source_module_key,
        entity_type=source_entity_type,
        entity_id=source_entity_id,
        action="task.automated_reminder_created",
        description=f"Created automated reminder task: {task.title}",
        after_state=task_state,
    )
    return task


def _stale_contacts(db: Session, *, cutoff: datetime) -> list[SalesContact]:
    return (
        db.query(SalesContact)
        .filter(
            SalesContact.deleted_at.is_(None),
            SalesContact.assigned_to.is_not(None),
            SalesContact.last_contacted_at.is_not(None),
            SalesContact.last_contacted_at <= cutoff,
        )
        .order_by(SalesContact.last_contacted_at.asc(), SalesContact.contact_id.asc())
        .all()
    )


def _inactive_opportunities(db: Session, *, cutoff: datetime) -> list[SalesOpportunity]:
    return (
        db.query(SalesOpportunity)
        .filter(
            SalesOpportunity.deleted_at.is_(None),
            SalesOpportunity.assigned_to.is_not(None),
            or_(
                SalesOpportunity.sales_stage.is_(None),
                ~SalesOpportunity.sales_stage.in_(CLOSED_OPPORTUNITY_STAGES),
            ),
            or_(
                SalesOpportunity.last_contacted_at.is_(None),
                SalesOpportunity.last_contacted_at <= cutoff,
            ),
        )
        .order_by(SalesOpportunity.last_contacted_at.asc().nullsfirst(), SalesOpportunity.opportunity_id.asc())
        .all()
    )


def scan_follow_up_reminders(
    db: Session,
    *,
    now: datetime | None = None,
    no_reply_days: int | None = None,
    inactive_deal_days: int | None = None,
) -> dict:
    scan_time = _as_utc(now) or _utcnow()
    no_reply_cutoff = scan_time - timedelta(days=no_reply_days or settings.NO_REPLY_REMINDER_DAYS)
    inactive_deal_cutoff = scan_time - timedelta(days=inactive_deal_days or settings.INACTIVE_DEAL_REMINDER_DAYS)
    due_at = scan_time + timedelta(days=1)

    contacts_checked = 0
    contact_tasks_created = 0
    for contact in _stale_contacts(db, cutoff=no_reply_cutoff):
        contacts_checked += 1
        source_label = _display_contact_name(contact)
        title = f"{NO_REPLY_TITLE_PREFIX}: {source_label}"
        if _has_open_reminder_task(
            db,
            tenant_id=contact.tenant_id,
            source_module_key="sales_contacts",
            source_entity_id=str(contact.contact_id),
            title=title,
        ):
            continue
        last_contacted_at = _as_utc(contact.last_contacted_at)
        description = (
            f"No reply recorded since {last_contacted_at.date().isoformat() if last_contacted_at else 'the last follow-up'}. "
            "Check in or reschedule the follow-up."
        )
        _create_source_linked_reminder_task(
            db,
            tenant_id=contact.tenant_id,
            assigned_to_user_id=contact.assigned_to,
            source_module_key="sales_contacts",
            source_entity_id=str(contact.contact_id),
            source_label=source_label,
            title=title,
            description=description,
            due_at=due_at,
        )
        contact_tasks_created += 1

    opportunities_checked = 0
    opportunity_tasks_created = 0
    for opportunity in _inactive_opportunities(db, cutoff=inactive_deal_cutoff):
        opportunities_checked += 1
        source_label = _display_opportunity_name(opportunity)
        title = f"{INACTIVE_DEAL_TITLE_PREFIX}: {source_label}"
        if _has_open_reminder_task(
            db,
            tenant_id=opportunity.tenant_id,
            source_module_key="sales_opportunities",
            source_entity_id=str(opportunity.opportunity_id),
            title=title,
        ):
            continue
        last_contacted_at = _as_utc(opportunity.last_contacted_at)
        description = (
            f"No deal activity recorded since {last_contacted_at.date().isoformat() if last_contacted_at else 'creation'}. "
            "Review the deal and log the next step."
        )
        _create_source_linked_reminder_task(
            db,
            tenant_id=opportunity.tenant_id,
            assigned_to_user_id=opportunity.assigned_to,
            source_module_key="sales_opportunities",
            source_entity_id=str(opportunity.opportunity_id),
            source_label=source_label,
            title=title,
            description=description,
            due_at=due_at,
        )
        opportunity_tasks_created += 1

    return {
        "scan_time": scan_time.isoformat(),
        "no_reply_days": no_reply_days or settings.NO_REPLY_REMINDER_DAYS,
        "inactive_deal_days": inactive_deal_days or settings.INACTIVE_DEAL_REMINDER_DAYS,
        "contacts_checked": contacts_checked,
        "contact_tasks_created": contact_tasks_created,
        "opportunities_checked": opportunities_checked,
        "opportunity_tasks_created": opportunity_tasks_created,
    }
