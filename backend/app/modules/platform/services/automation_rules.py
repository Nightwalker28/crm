from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.pagination import Pagination
from app.modules.platform.models import (
    ActivityLog,
    AutomationRule,
    AutomationRuleDeadLetter,
    AutomationRuleRun,
    CrmEvent,
    RecordComment,
    UserNotification,
)
from app.modules.sales.models import SalesLead
from app.modules.sales.services.leads_services import recalculate_lead_score
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.user_management.models import Team, User


SUPPORTED_AUTOMATION_TRIGGERS = {
    "lead.created",
    "lead.updated",
    "lead.converted",
    "opportunity.stage_changed",
    "quote.created",
    "quote.status_changed",
    "task.overdue",
}
SUPPORTED_ACTION_TYPES = {
    "create_task",
    "send_notification",
    "recalculate_lead_score",
    "add_record_note",
}
SUPPORTED_CONDITION_OPERATORS = {"equals", "not_equals", "contains", "exists", "gt", "gte", "lt", "lte"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_trigger(value: str) -> str:
    trigger = (value or "").strip()
    if trigger not in SUPPORTED_AUTOMATION_TRIGGERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported automation trigger")
    return trigger


def _normalize_conditions(value: Any) -> list[dict[str, Any]]:
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="conditions_json must be a list")
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Each condition must be an object")
        field = str(item.get("field") or "").strip()
        operator = str(item.get("operator") or "equals").strip()
        if not field:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Condition field is required")
        if operator not in SUPPORTED_CONDITION_OPERATORS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported condition operator")
        normalized.append({"field": field, "operator": operator, "value": item.get("value")})
    return normalized


def _normalize_actions(value: Any) -> list[dict[str, Any]]:
    if value is None or value == "":
        return []
    if not isinstance(value, list) or not value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="actions_json must include at least one action")
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Each action must be an object")
        action_type = str(item.get("type") or "").strip()
        if action_type not in SUPPORTED_ACTION_TYPES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported automation action")
        normalized.append(dict(item, type=action_type))
    return normalized


def _serialize_rule(rule: AutomationRule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "name": rule.name,
        "description": rule.description,
        "enabled": bool(rule.enabled),
        "trigger_event": rule.trigger_event,
        "conditions_json": rule.conditions_json or [],
        "actions_json": rule.actions_json or [],
        "created_by_id": rule.created_by_id,
        "updated_by_id": rule.updated_by_id,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


def _event_input(event: CrmEvent) -> dict[str, Any]:
    payload = dict(event.payload or {})
    return {
        "event_id": event.id,
        "event_type": event.event_type,
        "entity_type": event.entity_type,
        "entity_id": event.entity_id,
        "actor_user_id": event.actor_user_id,
        "payload": payload,
    }


def _lookup_path(data: dict[str, Any], path: str) -> Any:
    current: Any = data
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _coerce_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _condition_matches(data: dict[str, Any], condition: dict[str, Any]) -> bool:
    actual = _lookup_path(data, condition["field"])
    expected = condition.get("value")
    operator = condition.get("operator", "equals")
    if operator == "exists":
        return actual not in {None, ""}
    if operator == "equals":
        return str(actual) == str(expected)
    if operator == "not_equals":
        return str(actual) != str(expected)
    if operator == "contains":
        return str(expected).lower() in str(actual or "").lower()
    if operator in {"gt", "gte", "lt", "lte"}:
        left = _coerce_number(actual)
        right = _coerce_number(expected)
        if left is None or right is None:
            return False
        if operator == "gt":
            return left > right
        if operator == "gte":
            return left >= right
        if operator == "lt":
            return left < right
        return left <= right
    return False


def _conditions_match(rule: AutomationRule, event: CrmEvent) -> bool:
    data = _event_input(event)
    return all(_condition_matches(data, condition) for condition in (rule.conditions_json or []))


def list_automation_rules(db: Session, *, tenant_id: int) -> list[AutomationRule]:
    return (
        db.query(AutomationRule)
        .filter(AutomationRule.tenant_id == tenant_id)
        .order_by(AutomationRule.enabled.desc(), AutomationRule.trigger_event.asc(), AutomationRule.name.asc(), AutomationRule.id.asc())
        .all()
    )


def get_automation_rule_or_404(db: Session, *, tenant_id: int, rule_id: int) -> AutomationRule:
    rule = db.query(AutomationRule).filter(AutomationRule.tenant_id == tenant_id, AutomationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Automation rule not found")
    return rule


def create_automation_rule(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict[str, Any]) -> AutomationRule:
    rule = AutomationRule(
        tenant_id=tenant_id,
        name=payload["name"].strip(),
        description=(payload.get("description") or "").strip() or None,
        enabled=bool(payload.get("enabled", True)),
        trigger_event=_normalize_trigger(payload.get("trigger_event")),
        conditions_json=_normalize_conditions(payload.get("conditions_json")),
        actions_json=_normalize_actions(payload.get("actions_json")),
        created_by_id=actor_user_id,
        updated_by_id=actor_user_id,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def update_automation_rule(db: Session, *, rule: AutomationRule, actor_user_id: int | None, payload: dict[str, Any]) -> AutomationRule:
    if "name" in payload and payload["name"] is not None:
        rule.name = payload["name"].strip()
    if "description" in payload:
        rule.description = (payload["description"] or "").strip() or None
    if "enabled" in payload and payload["enabled"] is not None:
        rule.enabled = bool(payload["enabled"])
    if "trigger_event" in payload and payload["trigger_event"] is not None:
        rule.trigger_event = _normalize_trigger(payload["trigger_event"])
    if "conditions_json" in payload and payload["conditions_json"] is not None:
        rule.conditions_json = _normalize_conditions(payload["conditions_json"])
    if "actions_json" in payload and payload["actions_json"] is not None:
        rule.actions_json = _normalize_actions(payload["actions_json"])
    rule.updated_by_id = actor_user_id
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def delete_automation_rule(db: Session, *, rule: AutomationRule) -> None:
    db.delete(rule)
    db.commit()


def list_automation_rule_runs(db: Session, *, tenant_id: int, rule_id: int | None = None, pagination: Pagination | None = None) -> list[AutomationRuleRun]:
    query = db.query(AutomationRuleRun).filter(AutomationRuleRun.tenant_id == tenant_id)
    if rule_id is not None:
        query = query.filter(AutomationRuleRun.rule_id == rule_id)
    query = query.order_by(AutomationRuleRun.started_at.desc(), AutomationRuleRun.id.desc())
    if pagination:
        query = query.offset(pagination.offset).limit(pagination.limit)
    return query.all()


def serialize_automation_rule(rule: AutomationRule) -> dict[str, Any]:
    return _serialize_rule(rule)


def _template(value: Any, data: dict[str, Any]) -> Any:
    if not isinstance(value, str):
        return value
    result = value
    for key in ("event_type", "entity_type", "entity_id", "actor_user_id"):
        result = result.replace("{{" + key + "}}", str(data.get(key) or ""))
    payload = data.get("payload") or {}
    for key, payload_value in payload.items():
        if isinstance(payload_value, (str, int, float, bool)) or payload_value is None:
            result = result.replace("{{payload." + key + "}}", str(payload_value or ""))
    return result


def _resolve_user_id(action: dict[str, Any], data: dict[str, Any]) -> int | None:
    raw_value = action.get("user_id")
    if raw_value == "actor":
        raw_value = data.get("actor_user_id")
    elif isinstance(raw_value, str) and raw_value.startswith("payload."):
        raw_value = _lookup_path(data, raw_value)
    try:
        return int(raw_value) if raw_value not in {None, ""} else None
    except (TypeError, ValueError):
        return None


def _ensure_user(db: Session, *, tenant_id: int, user_id: int | None) -> User | None:
    if user_id is None:
        return None
    return db.query(User).filter(User.tenant_id == tenant_id, User.id == user_id).first()


def _create_task_action(db: Session, *, tenant_id: int, actor_user_id: int | None, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    title = str(_template(action.get("title") or "Automation task", data)).strip()
    if not title:
        raise RuntimeError("Task title is required")
    due_in_days = action.get("due_in_days")
    due_at = None
    if due_in_days not in {None, ""}:
        due_at = _utcnow() + timedelta(days=int(due_in_days))
    task = Task(
        tenant_id=tenant_id,
        title=title[:255],
        description=(str(_template(action.get("description") or "", data)).strip() or None),
        status="todo",
        priority=action.get("priority") if action.get("priority") in {"high", "medium", "low"} else "medium",
        due_at=due_at,
        source_module_key=str(action.get("source_module_key") or data.get("entity_type") or "").strip() or None,
        source_entity_id=str(action.get("source_entity_id") or data.get("entity_id") or "").strip() or None,
        source_label=str(_template(action.get("source_label") or data.get("event_type") or "Automation", data)).strip()[:255],
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(task)
    db.flush()
    assignee_user_id = _resolve_user_id({"user_id": action.get("assignee_user_id")}, data)
    if _ensure_user(db, tenant_id=tenant_id, user_id=assignee_user_id):
        db.add(
            TaskAssignee(
                tenant_id=tenant_id,
                task_id=task.id,
                assignee_type="user",
                assignee_key=f"user:{assignee_user_id}",
                user_id=assignee_user_id,
            )
        )
        task.assigned_by_user_id = actor_user_id
        task.assigned_at = _utcnow()
    return {"type": "create_task", "task_id": task.id}


def _send_notification_action(db: Session, *, tenant_id: int, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    user_id = _resolve_user_id(action, data)
    if not _ensure_user(db, tenant_id=tenant_id, user_id=user_id):
        raise RuntimeError("Notification user not found")
    notification = UserNotification(
        tenant_id=tenant_id,
        user_id=user_id,
        category="automation",
        title=str(_template(action.get("title") or "Automation notification", data)).strip()[:255],
        message=str(_template(action.get("message") or "An automation rule ran.", data)).strip(),
        link_url=(str(_template(action.get("link_url"), data)).strip() or None) if action.get("link_url") is not None else None,
        payload={"automation": True, "event_id": data.get("event_id")},
    )
    db.add(notification)
    db.flush()
    return {"type": "send_notification", "notification_id": notification.id}


def _recalculate_lead_score_action(db: Session, *, tenant_id: int, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    raw_lead_id = action.get("lead_id") or (data.get("entity_id") if data.get("entity_type") == "sales_lead" else None) or _lookup_path(data, "payload.lead_id")
    try:
        lead_id = int(raw_lead_id)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("Lead id is required") from exc
    lead = db.query(SalesLead).filter(SalesLead.tenant_id == tenant_id, SalesLead.lead_id == lead_id, SalesLead.deleted_at.is_(None)).first()
    if not lead:
        raise RuntimeError("Lead not found")
    score_record = recalculate_lead_score(db, lead)
    db.flush()
    return {"type": "recalculate_lead_score", "lead_id": lead.lead_id, "score": score_record.score, "grade": score_record.grade}


def _add_record_note_action(db: Session, *, tenant_id: int, actor_user_id: int | None, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    module_key = str(action.get("module_key") or data.get("entity_type") or "").strip()
    entity_id = str(action.get("entity_id") or data.get("entity_id") or "").strip()
    body = str(_template(action.get("body") or "Automation note", data)).strip()
    if not module_key or not entity_id or not body:
        raise RuntimeError("Record note requires module_key, entity_id, and body")
    comment = RecordComment(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=module_key,
        entity_id=entity_id,
        body=body[:5000],
    )
    db.add(comment)
    db.flush()
    db.add(
        ActivityLog(
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key=module_key,
            entity_type=module_key.rstrip("s"),
            entity_id=entity_id,
            action="automation.note",
            description="Added automation note",
            after_state={"comment_id": comment.id, "body": comment.body},
        )
    )
    return {"type": "add_record_note", "comment_id": comment.id}


def _execute_action(db: Session, *, tenant_id: int, actor_user_id: int | None, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    action_type = action.get("type")
    if action_type == "create_task":
        return _create_task_action(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action=action, data=data)
    if action_type == "send_notification":
        return _send_notification_action(db, tenant_id=tenant_id, action=action, data=data)
    if action_type == "recalculate_lead_score":
        return _recalculate_lead_score_action(db, tenant_id=tenant_id, action=action, data=data)
    if action_type == "add_record_note":
        return _add_record_note_action(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action=action, data=data)
    raise RuntimeError(f"Unsupported action {action_type}")


def execute_rule_for_event(db: Session, *, rule: AutomationRule, event: CrmEvent) -> AutomationRuleRun | None:
    if not rule.enabled or rule.tenant_id != event.tenant_id or rule.trigger_event != event.event_type:
        return None
    if not _conditions_match(rule, event):
        return None

    data = _event_input(event)
    run = AutomationRuleRun(
        tenant_id=event.tenant_id,
        rule_id=rule.id,
        event_id=event.id,
        status="running",
        input_json=jsonable_encoder(data),
        started_at=_utcnow(),
    )
    db.add(run)
    db.flush()
    try:
        action_results = [
            _execute_action(db, tenant_id=event.tenant_id, actor_user_id=event.actor_user_id, action=action, data=data)
            for action in (rule.actions_json or [])
        ]
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)[:1000]
        run.finished_at = _utcnow()
        db.add(run)
        db.flush()
        db.add(
            AutomationRuleDeadLetter(
                tenant_id=event.tenant_id,
                rule_id=rule.id,
                run_id=run.id,
                event_id=event.id,
                payload_json=jsonable_encoder({"event": data, "actions": rule.actions_json or []}),
                error_message=run.error_message,
            )
        )
        db.commit()
        return run

    run.status = "succeeded"
    run.result_json = {"actions": jsonable_encoder(action_results)}
    run.finished_at = _utcnow()
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def process_crm_event_automations(db: Session, *, event_id: int) -> list[AutomationRuleRun]:
    event = db.query(CrmEvent).filter(CrmEvent.id == event_id).first()
    if not event or event.event_type not in SUPPORTED_AUTOMATION_TRIGGERS:
        return []
    rules = (
        db.query(AutomationRule)
        .filter(
            AutomationRule.tenant_id == event.tenant_id,
            AutomationRule.trigger_event == event.event_type,
            AutomationRule.enabled.is_(True),
        )
        .order_by(AutomationRule.id.asc())
        .all()
    )
    runs: list[AutomationRuleRun] = []
    for rule in rules:
        run = execute_rule_for_event(db, rule=rule, event=event)
        if run is not None:
            runs.append(run)
    return runs


def automation_actor(user_id: int | None, tenant_id: int) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, tenant_id=tenant_id)
