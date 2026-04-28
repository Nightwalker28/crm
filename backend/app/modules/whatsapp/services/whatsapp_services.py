from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.access_control import require_role_module_action_access
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.message_templates import (
    get_default_message_template,
    get_message_template_or_404,
    render_template_body,
)
from app.modules.sales.models import SalesContact
from app.modules.tasks.services.tasks_services import create_task, create_task_assignment_notifications, serialize_task
from app.modules.whatsapp.models import WhatsAppInteraction


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_phone_for_whatsapp(value: str | None) -> str:
    raw = (value or "").strip()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact has no phone number")
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) < 7:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact phone number is not valid for WhatsApp")
    return digits


def _contact_display_name(contact: SalesContact) -> str:
    full_name = " ".join(part for part in [contact.first_name, contact.last_name] if part).strip()
    return full_name or contact.primary_email


def build_contact_template_values(contact: SalesContact, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    values: dict[str, Any] = {
        "customer_name": _contact_display_name(contact),
        "first_name": contact.first_name or "",
        "last_name": contact.last_name or "",
        "primary_email": contact.primary_email or "",
        "phone": contact.contact_telephone or "",
        "organization_name": contact.organization_name or "",
    }
    values.update(extra or {})
    return values


def record_contact_whatsapp_click(
    db: Session,
    *,
    current_user,
    contact_id: int,
    template_id: int | None = None,
    variables: dict[str, Any] | None = None,
    create_follow_up_task_flag: bool = False,
    follow_up_due_at: datetime | None = None,
    follow_up_title: str | None = None,
) -> dict[str, Any]:
    contact = (
        db.query(SalesContact)
        .filter(
            SalesContact.contact_id == contact_id,
            SalesContact.tenant_id == current_user.tenant_id,
            SalesContact.deleted_at.is_(None),
        )
        .first()
    )
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")

    template = (
        get_message_template_or_404(db, tenant_id=current_user.tenant_id, template_id=template_id)
        if template_id
        else get_default_message_template(
            db,
            tenant_id=current_user.tenant_id,
            channel="whatsapp",
            module_key="sales_contacts",
        )
    )
    if template.channel != "whatsapp":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template is not a WhatsApp template")

    phone_number = _normalize_phone_for_whatsapp(contact.contact_telephone)
    rendered_message = render_template_body(template, build_contact_template_values(contact, variables))
    whatsapp_url = f"https://wa.me/{phone_number}?text={quote(rendered_message)}"

    follow_up_task_payload = None
    if create_follow_up_task_flag:
        try:
            require_role_module_action_access(db, user=current_user, module_key="tasks", action="create")
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

        task_title = (follow_up_title or f"Follow up on WhatsApp with {_contact_display_name(contact)}").strip()
        task, added_keys = create_task(
            db,
            payload={
                "title": task_title,
                "description": f"Follow up after WhatsApp outreach to {_contact_display_name(contact)}.",
                "status": "todo",
                "priority": "medium",
                "due_at": follow_up_due_at,
                "assignees": [{"assignee_type": "user", "user_id": current_user.id}],
            },
            current_user=current_user,
        )
        create_task_assignment_notifications(db, task=task, current_user=current_user, assignee_keys=added_keys)
        follow_up_task_payload = serialize_task(task)

    contacted_at = _utcnow()
    contact.whatsapp_last_contacted_at = contacted_at
    db.add(contact)
    db.flush()

    interaction = WhatsAppInteraction(
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        contact_id=contact.contact_id,
        template_id=template.id,
        follow_up_task_id=follow_up_task_payload["id"] if follow_up_task_payload else None,
        phone_number=phone_number,
        message_body=rendered_message,
        whatsapp_url=whatsapp_url,
        source_module_key="sales_contacts",
        source_entity_id=str(contact.contact_id),
        sent_at=contacted_at,
    )
    db.add(interaction)
    db.commit()
    db.refresh(interaction)
    db.refresh(contact)

    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="sales_contacts",
        entity_type="sales_contact",
        entity_id=contact.contact_id,
        action="whatsapp_click",
        description=f"Prepared WhatsApp message for {_contact_display_name(contact)}",
        after_state={
            "interaction_id": interaction.id,
            "template_id": template.id,
            "template_name": template.name,
            "phone_number": phone_number,
            "message_body": rendered_message,
            "follow_up_task_id": follow_up_task_payload["id"] if follow_up_task_payload else None,
        },
    )

    return {
        "interaction_id": interaction.id,
        "contact_id": contact.contact_id,
        "phone_number": phone_number,
        "template_id": template.id,
        "message_body": rendered_message,
        "whatsapp_url": whatsapp_url,
        "last_contacted_at": contacted_at,
        "follow_up_task": follow_up_task_payload,
    }
