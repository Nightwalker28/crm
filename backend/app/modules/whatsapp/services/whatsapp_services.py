from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, urlencode

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.message_templates import (
    get_default_message_template,
    get_message_template_or_404,
    render_template_body,
)
from app.modules.sales.models import SalesContact
from app.modules.sales.services.followups import create_record_follow_up_task
from app.modules.tasks.services.tasks_services import serialize_task
from app.modules.whatsapp.models import WhatsAppInteraction
from app.modules.whatsapp.repositories import whatsapp_repository


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- #
# Modes and capabilities (06-whatsapp-business.md, Phase 1)
#
# A *delivery mode* is how a WhatsApp action reaches the customer:
#
# - ``external_link`` opens WhatsApp (app or web) with the number and text filled
#   in. The operator presses send there. Lynk knows it prepared and opened the
#   chat, and nothing after that: not whether it was sent, delivered or read, and
#   no reply ever comes back. Everything this mode records says "prepared".
# - ``meta_cloud_api`` sends from Lynk through a connected provider account and
#   gets provider-confirmed statuses. No tenant can have it yet (Phase 2 adds the
#   account), so it always resolves as not configured.
#
# ``ask_each_time`` is not a mode. It is a default that lets the operator pick
# when more than one mode is usable.
#
# The tenant policy decides which modes are allowed and which is the default.
# No tenant has a stored policy yet — Phase 5 adds the settings screen and its
# storage — so every tenant resolves to the backward-compatible policy: external
# only, external by default, exactly what the product did before modes existed.
# --------------------------------------------------------------------------- #

EXTERNAL_LINK = "external_link"
META_CLOUD_API = "meta_cloud_api"
ASK_EACH_TIME = "ask_each_time"

DELIVERY_MODES = (EXTERNAL_LINK, META_CLOUD_API)
DEFAULT_MODE_CHOICES = (*DELIVERY_MODES, ASK_EACH_TIME)

# What each mode can truthfully promise. The UI reads these instead of
# inferring them from the mode name.
_MODE_TRAITS = {
    EXTERNAL_LINK: {"sends_from_crm": False, "tracks_delivery": False, "receives_inbound": False},
    META_CLOUD_API: {"sends_from_crm": True, "tracks_delivery": True, "receives_inbound": True},
}

# The one status an external-mode interaction can ever have.
EXTERNAL_INTERACTION_STATUS = "prepared"


@dataclass(frozen=True)
class WhatsAppPolicy:
    enabled_modes: tuple[str, ...]
    default_mode: str


DEFAULT_POLICY = WhatsAppPolicy(enabled_modes=(EXTERNAL_LINK,), default_mode=EXTERNAL_LINK)


def get_tenant_whatsapp_policy(db: Session, *, tenant_id: int) -> WhatsAppPolicy:
    """The tenant's allowed modes and default.

    The single place a stored policy will be read from. Until one exists, every
    tenant gets ``DEFAULT_POLICY``; a later phase must keep a tenant with no stored
    row on it, so connecting a provider never switches anyone's default silently.
    """

    return DEFAULT_POLICY


def is_meta_cloud_api_configured(db: Session, *, tenant_id: int) -> bool:
    """Whether the tenant has a connected, usable Meta account. None can yet."""

    return False


def resolve_whatsapp_capabilities(policy: WhatsAppPolicy, *, meta_configured: bool) -> dict[str, Any]:
    """Resolve a policy and the provider state into what the WhatsApp action does.

    ``effective_mode`` is what one press of the action does now:

    - the default mode, when it is usable;
    - ``ask_each_time`` only when the default asks for it *and* two or more modes
      are usable (a choice of one is not a choice);
    - otherwise the one usable mode, so a default pointing at an unconfigured
      provider still leaves the operator an allowed way to reach the customer;
    - ``None`` when no mode is usable, and the action is not offered.

    It never picks a mode the policy did not enable.
    """

    modes = []
    usable: list[str] = []
    for mode in DELIVERY_MODES:
        enabled = mode in policy.enabled_modes
        configured = mode != META_CLOUD_API or meta_configured
        available = enabled and configured
        if available:
            usable.append(mode)
        modes.append(
            {
                "mode": mode,
                "enabled": enabled,
                "available": available,
                "unavailable_reason": (
                    None if available else "disabled_by_policy" if not enabled else "not_configured"
                ),
                **_MODE_TRAITS[mode],
            }
        )

    if policy.default_mode in usable:
        effective = policy.default_mode
    elif policy.default_mode == ASK_EACH_TIME and len(usable) > 1:
        effective = ASK_EACH_TIME
    elif usable:
        effective = usable[0]
    else:
        effective = None

    return {
        "default_mode": policy.default_mode,
        "effective_mode": effective,
        "modes": modes,
    }


def get_whatsapp_capabilities(db: Session, *, current_user) -> dict[str, Any]:
    tenant_id = current_user.tenant_id
    return resolve_whatsapp_capabilities(
        get_tenant_whatsapp_policy(db, tenant_id=tenant_id),
        meta_configured=is_meta_cloud_api_configured(db, tenant_id=tenant_id),
    )


def _require_external_link_mode(db: Session, *, tenant_id: int) -> None:
    if EXTERNAL_LINK not in get_tenant_whatsapp_policy(db, tenant_id=tenant_id).enabled_modes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="External WhatsApp is turned off for this workspace",
        )


COUNTRY_DIAL_CODES = {
    "lk": "94",
    "sri lanka": "94",
}


def _country_dial_code(value: str | None) -> str | None:
    country = (value or "").strip().lower()
    if not country:
        return None
    if country.startswith("+") and country[1:].isdigit():
        return country[1:]
    return COUNTRY_DIAL_CODES.get(country)


def _normalize_phone_for_whatsapp(value: str | None, *, country: str | None = None) -> str:
    raw = (value or "").strip()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact has no phone number")
    digits = "".join(ch for ch in raw if ch.isdigit())
    if raw.startswith("00"):
        digits = digits[2:]
    elif raw.startswith("+"):
        pass
    elif digits.startswith("0"):
        dial_code = _country_dial_code(country)
        if not dial_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Contact phone number needs a country code for WhatsApp",
            )
        digits = f"{dial_code}{digits.lstrip('0')}"
    if len(digits) < 7:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact phone number is not valid for WhatsApp")
    return digits


def _build_whatsapp_url(*, phone_number: str, message: str) -> str:
    return f"https://web.whatsapp.com/send?{urlencode({'phone': phone_number, 'text': message}, quote_via=quote)}"


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
    """Prepare an external (click-to-chat) WhatsApp message to a contact and record it.

    ``external_link`` mode: the returned URL opens WhatsApp with the message filled
    in, and the operator sends it there. What is recorded — the interaction, the
    contact's ``whatsapp_last_contacted_at`` stamp and the audit entry — is that the
    chat was *prepared*, never that a message was sent or delivered.

    Everything is validated before anything is written, and the interaction, the
    optional reminder and the audit entry commit together.
    """

    tenant_id = current_user.tenant_id
    _require_external_link_mode(db, tenant_id=tenant_id)
    contact = whatsapp_repository.get_active_contact(db, tenant_id=tenant_id, contact_id=contact_id)
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")

    template = (
        get_message_template_or_404(db, tenant_id=tenant_id, template_id=template_id)
        if template_id
        else get_default_message_template(
            db,
            tenant_id=tenant_id,
            channel="whatsapp",
            module_key="sales_contacts",
        )
    )
    if template.channel != "whatsapp":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template is not a WhatsApp template")

    company_country = whatsapp_repository.get_company_country(db, tenant_id=tenant_id)
    phone_number = _normalize_phone_for_whatsapp(contact.contact_telephone, country=contact.country or company_country)
    rendered_message = render_template_body(template, build_contact_template_values(contact, variables))
    whatsapp_url = _build_whatsapp_url(phone_number=phone_number, message=rendered_message)
    contact_label = _contact_display_name(contact)
    contact_entity_id = str(contact.contact_id)

    prepared_at = _utcnow()
    follow_up_task_payload = None
    try:
        task = None
        if create_follow_up_task_flag:
            task = create_record_follow_up_task(
                db,
                current_user=current_user,
                module_key="sales_contacts",
                entity_id=contact_entity_id,
                source_label=contact_label,
                channel="whatsapp",
                due_at=follow_up_due_at,
                note=f"Follow up after WhatsApp outreach to {contact_label}.",
                title=follow_up_title or f"Follow up on WhatsApp with {contact_label}",
            )

        contact.whatsapp_last_contacted_at = prepared_at
        db.add(contact)

        interaction = WhatsAppInteraction(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            contact_id=contact.contact_id,
            template_id=template.id,
            follow_up_task_id=task.id if task else None,
            phone_number=phone_number,
            message_body=rendered_message,
            whatsapp_url=whatsapp_url,
            source_module_key="sales_contacts",
            source_entity_id=contact_entity_id,
            sent_at=prepared_at,
        )
        db.add(interaction)
        db.flush()

        log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            module_key="sales_contacts",
            entity_type="sales_contact",
            entity_id=contact.contact_id,
            action="whatsapp_click",
            description=f"Prepared WhatsApp message for {contact_label}",
            after_state={
                "interaction_id": interaction.id,
                "mode": EXTERNAL_LINK,
                "status": EXTERNAL_INTERACTION_STATUS,
                "template_id": template.id,
                "template_name": template.name,
                "phone_number": phone_number,
                "message_body": rendered_message,
                "follow_up_task_id": task.id if task else None,
            },
            commit=False,
        )
        if task is not None:
            follow_up_task_payload = serialize_task(task)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(interaction)

    return {
        "interaction_id": interaction.id,
        "contact_id": contact.contact_id,
        "mode": EXTERNAL_LINK,
        "status": EXTERNAL_INTERACTION_STATUS,
        "phone_number": phone_number,
        "template_id": template.id,
        "message_body": rendered_message,
        "whatsapp_url": whatsapp_url,
        "last_contacted_at": prepared_at,
        "follow_up_task": follow_up_task_payload,
    }
