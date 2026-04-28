from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.platform.models import MessageTemplate


PLACEHOLDER_REGEX = re.compile(r"{{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*}}")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_key(value: str) -> str:
    key = value.strip().lower().replace(" ", "_")
    key = re.sub(r"[^a-z0-9_]+", "_", key)
    key = re.sub(r"_+", "_", key).strip("_")
    if not key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template key is required")
    return key


def extract_template_variables(body: str) -> list[str]:
    return sorted(set(PLACEHOLDER_REGEX.findall(body or "")))


def validate_template_body(body: str, variables: list[str]) -> None:
    placeholders = set(extract_template_variables(body))
    allowed = set(variables)
    unknown = sorted(placeholders - allowed)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Template uses undeclared variables: {', '.join(unknown)}",
        )


def render_template_body(template: MessageTemplate, values: dict[str, Any]) -> str:
    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        value = values.get(key)
        if value is None:
            return ""
        return str(value)

    return PLACEHOLDER_REGEX.sub(replace, template.body)


def serialize_message_template(template: MessageTemplate) -> dict[str, Any]:
    return {
        "id": template.id,
        "template_key": template.template_key,
        "name": template.name,
        "description": template.description,
        "channel": template.channel,
        "module_key": template.module_key,
        "body": template.body,
        "variables": template.variables or [],
        "is_system": bool(template.is_system),
        "is_active": bool(template.is_active),
        "created_at": template.created_at,
        "updated_at": template.updated_at,
    }


def list_message_templates(
    db: Session,
    *,
    tenant_id: int,
    channel: str | None = None,
    module_key: str | None = None,
    include_inactive: bool = False,
) -> list[MessageTemplate]:
    query = db.query(MessageTemplate).filter(
        MessageTemplate.tenant_id == tenant_id,
        MessageTemplate.deleted_at.is_(None),
    )
    if channel:
        query = query.filter(MessageTemplate.channel == channel)
    if module_key:
        query = query.filter(MessageTemplate.module_key == module_key)
    if not include_inactive:
        query = query.filter(MessageTemplate.is_active.is_(True))
    return query.order_by(MessageTemplate.is_system.desc(), MessageTemplate.name.asc()).all()


def get_message_template_or_404(db: Session, *, tenant_id: int, template_id: int) -> MessageTemplate:
    template = (
        db.query(MessageTemplate)
        .filter(
            MessageTemplate.id == template_id,
            MessageTemplate.tenant_id == tenant_id,
            MessageTemplate.deleted_at.is_(None),
        )
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message template not found")
    return template


def get_default_message_template(
    db: Session,
    *,
    tenant_id: int,
    channel: str,
    module_key: str,
) -> MessageTemplate:
    template = (
        db.query(MessageTemplate)
        .filter(
            MessageTemplate.tenant_id == tenant_id,
            MessageTemplate.channel == channel,
            MessageTemplate.module_key == module_key,
            MessageTemplate.deleted_at.is_(None),
            MessageTemplate.is_active.is_(True),
        )
        .order_by(MessageTemplate.is_system.desc(), MessageTemplate.name.asc())
        .first()
    )
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active message template found")
    return template


def create_message_template(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict[str, Any]) -> MessageTemplate:
    body = (payload.get("body") or "").strip()
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Template body is required")
    variables = sorted(set(payload.get("variables") or extract_template_variables(body)))
    validate_template_body(body, variables)
    template = MessageTemplate(
        tenant_id=tenant_id,
        template_key=_normalize_key(payload.get("template_key") or payload["name"]),
        name=payload["name"].strip(),
        description=(payload.get("description") or "").strip() or None,
        channel=payload["channel"].strip().lower(),
        module_key=(payload.get("module_key") or "").strip() or None,
        body=body,
        variables=variables,
        is_system=False,
        is_active=bool(payload.get("is_active", True)),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def update_message_template(db: Session, *, template: MessageTemplate, actor_user_id: int | None, payload: dict[str, Any]) -> MessageTemplate:
    if "template_key" in payload and payload["template_key"]:
        template.template_key = _normalize_key(payload["template_key"])
    for field in ("name", "description", "channel", "module_key"):
        if field not in payload:
            continue
        value = payload[field]
        if isinstance(value, str):
            value = value.strip()
        if field in {"description", "module_key"}:
            setattr(template, field, value or None)
        else:
            setattr(template, field, value)
    if "body" in payload:
        template.body = payload["body"].strip()
    if "variables" in payload:
        template.variables = sorted(set(payload["variables"] or []))
    if "is_active" in payload:
        template.is_active = bool(payload["is_active"])

    variables = template.variables or extract_template_variables(template.body)
    validate_template_body(template.body, variables)
    template.variables = variables
    template.updated_by_user_id = actor_user_id
    db.add(template)
    db.commit()
    db.refresh(template)
    return template


def soft_delete_message_template(db: Session, *, template: MessageTemplate, actor_user_id: int | None) -> MessageTemplate:
    template.deleted_at = _utcnow()
    template.updated_by_user_id = actor_user_id
    db.add(template)
    db.commit()
    db.refresh(template)
    return template
