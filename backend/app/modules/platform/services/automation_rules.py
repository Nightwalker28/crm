from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.config import settings
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
from app.modules.platform.services.automation_records import (
    load_record_snapshot,
    module_key_for_entity,
    record_path_for,
)
from app.modules.platform.services.automation_registry import (
    SUPPORTED_AUTOMATION_ACTIONS,
    SUPPORTED_AUTOMATION_TRIGGERS,
    actions_for_trigger,
    condition_fields_for_trigger,
    derived_trigger_keys,
    get_action_or_none,
    get_trigger_or_none,
    is_trigger_available,
    module_key_for_trigger,
)
from app.modules.sales.models import SalesLead, SalesQuote
from app.modules.sales.services.leads_services import convert_sales_lead, recalculate_lead_score
from app.modules.sales.services.orders_services import convert_quote_to_order
from app.modules.support.models import SupportCase, SupportCaseEvent
from app.modules.tasks.models import Task, TaskAssignee
from app.modules.user_management.models import Module, Team, User


CONDITION_OPERATOR_ALIASES = {
    "is": "equals",
    "is_not": "not_equals",
    "not_contains": "not_contains",
    "is_empty": "is_empty",
    "is_not_empty": "is_not_empty",
    "in": "in",
    "not_in": "not_in",
}
AUTOMATION_CONTEXT_KEY = "_automation"
SENSITIVE_DEBUG_KEYS = ("authorization", "cookie", "password", "secret", "token", "api_key", "webhook", "credential")
TEMPLATE_TOKEN_PATTERN = re.compile(r"{{\s*([A-Za-z0-9_.]+)\s*}}")
# The user an action targets: the record's owner, the person whose change fired the
# event, or a specific user id.
USER_TARGET_OWNER = "owner"
USER_TARGET_ACTOR = "actor"
UNAVAILABLE_TRIGGER_DETAIL = "This trigger is not emitted yet, so a rule on it would never run"


@dataclass(frozen=True)
class AutomationActor:
    id: int | None
    tenant_id: int


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_trigger(value: str) -> str:
    trigger = (value or "").strip()
    if trigger not in SUPPORTED_AUTOMATION_TRIGGERS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported automation trigger")
    return trigger


def _require_available_trigger(trigger_event: str, *, enabled: bool) -> None:
    if enabled and not is_trigger_available(trigger_event):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=UNAVAILABLE_TRIGGER_DETAIL)


def _normalize_module_key(value: Any, *, trigger_event: str) -> str | None:
    module_key = str(value or "").strip() or None
    trigger = get_trigger_or_none(trigger_event)
    if module_key and trigger and module_key != trigger.module_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Automation rule module does not match trigger")
    return module_key or module_key_for_trigger(trigger_event)


def _normalize_condition_mode(value: Any) -> str:
    mode = str(value or "all").strip().lower()
    if mode not in {"all", "any"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported automation condition mode")
    return mode


def _normalize_condition_field(value: Any) -> str:
    field = str(value or "").strip()
    if not field:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Condition field is required")
    return field if field.startswith("payload.") else f"payload.{field}"


def _condition_payload_key(field: str) -> str:
    return field.removeprefix("payload.")


def _normalize_condition_operator(value: Any) -> str:
    operator = str(value or "equals").strip()
    operator = CONDITION_OPERATOR_ALIASES.get(operator, operator)
    return "is_not_empty" if operator == "exists" else operator


def _normalize_condition_values(item: dict[str, Any], *, operator: str) -> tuple[Any, list[Any] | None]:
    if operator in {"in", "not_in"}:
        raw_values = item.get("values", item.get("value"))
        if isinstance(raw_values, str):
            values = [part.strip() for part in raw_values.split(",") if part.strip()]
        elif isinstance(raw_values, list):
            values = [part for part in raw_values if part not in {None, ""}]
        else:
            values = []
        return None, values
    return item.get("value"), None


def _normalize_conditions(value: Any, *, trigger_event: str) -> list[dict[str, Any]]:
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="conditions_json must be a list")
    condition_fields = {
        f"payload.{field.key}": set(field.operators)
        for field in condition_fields_for_trigger(trigger_event)
    }
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Each condition must be an object")
        field = _normalize_condition_field(item.get("field"))
        operator = _normalize_condition_operator(item.get("operator"))
        allowed_operators = condition_fields.get(field)
        if allowed_operators is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported condition field: {_condition_payload_key(field)}")
        if operator not in allowed_operators:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported condition operator for field")
        value, values = _normalize_condition_values(item, operator=operator)
        entry = {"field": field, "operator": operator, "value": value}
        if values is not None:
            entry["values"] = values
        normalized.append(entry)
    return normalized


def _normalize_actions(value: Any, *, trigger_event: str, require_complete: bool = True) -> list[dict[str, Any]]:
    if value is None or value == "":
        if not require_complete:
            return []
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="actions_json must include at least one action")
    if not isinstance(value, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="actions_json must be a list")
    if not value:
        if not require_complete:
            return []
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="actions_json must include at least one action")
    if not require_complete:
        value = [item for item in value if isinstance(item, dict) and str(item.get("type") or "").strip()]
    if not value:
        return []
    available_actions = {action.key for action in actions_for_trigger(trigger_event)}
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Each action must be an object")
        action_type = str(item.get("type") or "").strip()
        if not action_type:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Action type is required")
        if action_type not in SUPPORTED_AUTOMATION_ACTIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported automation action")
        if action_type not in available_actions:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Automation action is not available for this trigger")
        action = get_action_or_none(action_type)
        for field in action.fields if action else ():
            if require_complete and field.required and item.get(field.key) in {None, ""}:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Action field is required: {field.key}")
        normalized.append(dict(item, type=action_type))
    return normalized


def _serialize_rule(rule: AutomationRule) -> dict[str, Any]:
    return {
        "id": rule.id,
        "name": rule.name,
        "description": rule.description,
        "module_key": rule.module_key,
        "enabled": bool(rule.enabled),
        "trigger_event": rule.trigger_event,
        "condition_mode": rule.condition_mode or "all",
        "conditions_json": rule.conditions_json or [],
        "actions_json": rule.actions_json or [],
        "created_by_id": rule.created_by_id,
        "updated_by_id": rule.updated_by_id,
        "created_at": rule.created_at,
        "updated_at": rule.updated_at,
    }


def _event_input(event: CrmEvent, snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    """What a rule reads: the event, with the record's current fields under its payload.

    The payload wins where both have a key, because it was captured when the event
    happened; the snapshot supplies everything the emitting route left out.
    """

    payload = {**(snapshot or {}), **dict(event.payload or {})}
    if "record_url" not in payload:
        path = record_path_for(event.entity_type, event.entity_id)
        if path:
            payload["record_url"] = path
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


def _coerce_moment(value: Any) -> datetime | date | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return value
    if not isinstance(value, str) or len(value) < 10 or value[4:5] != "-":
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        if len(text) == 10:
            return date.fromisoformat(text)
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _comparable_pair(actual: Any, expected: Any) -> tuple[Any, Any] | None:
    """Both sides as numbers, or both as dates, or None when they are neither.

    Dates were compared through `float()`, so every *before*/*after* condition on a date
    field was false. A date-only side compares against the other side's calendar day.
    """

    left_number, right_number = _coerce_number(actual), _coerce_number(expected)
    if left_number is not None and right_number is not None:
        return left_number, right_number
    left_moment, right_moment = _coerce_moment(actual), _coerce_moment(expected)
    if left_moment is None or right_moment is None:
        return None
    if isinstance(left_moment, datetime) != isinstance(right_moment, datetime):
        left_moment = left_moment.date() if isinstance(left_moment, datetime) else left_moment
        right_moment = right_moment.date() if isinstance(right_moment, datetime) else right_moment
    return left_moment, right_moment


def _values_equal(actual: Any, expected: Any) -> bool:
    if actual in {None, ""} or expected in {None, ""}:
        return actual in {None, ""} and expected in {None, ""}
    pair = _comparable_pair(actual, expected)
    if pair is not None:
        return pair[0] == pair[1]
    return str(actual).strip().casefold() == str(expected).strip().casefold()


def _condition_matches(data: dict[str, Any], condition: dict[str, Any]) -> bool:
    actual = _lookup_path(data, condition["field"])
    expected = condition.get("value")
    expected_values = condition.get("values")
    operator = condition.get("operator", "equals")
    if operator in {"exists", "is_not_empty"}:
        return actual not in {None, ""}
    if operator == "is_empty":
        return actual in {None, ""}
    if operator == "equals":
        return _values_equal(actual, expected)
    if operator == "not_equals":
        return not _values_equal(actual, expected)
    if operator == "contains":
        return str(expected).lower() in str(actual or "").lower()
    if operator == "not_contains":
        return str(expected).lower() not in str(actual or "").lower()
    if operator in {"in", "not_in"}:
        values = expected_values if isinstance(expected_values, list) else []
        matched = any(_values_equal(actual, value) for value in values)
        return matched if operator == "in" else not matched
    if operator in {"changed", "changed_to", "changed_from"}:
        payload_key = _condition_payload_key(condition["field"])
        changes = _lookup_path(data, "payload.field_changes")
        changed_fields = _lookup_path(data, "payload.changed_fields")
        change_record = changes.get(payload_key) if isinstance(changes, dict) else None
        did_change = (
            isinstance(change_record, dict)
            or (isinstance(changed_fields, list) and payload_key in {str(field) for field in changed_fields})
        )
        if operator == "changed":
            return did_change
        if not isinstance(change_record, dict):
            return False
        if operator == "changed_to":
            return _values_equal(change_record.get("to"), expected)
        return _values_equal(change_record.get("from"), expected)
    if operator in {"gt", "gte", "lt", "lte"}:
        pair = _comparable_pair(actual, expected)
        if pair is None:
            return False
        left, right = pair
        if operator == "gt":
            return left > right
        if operator == "gte":
            return left >= right
        if operator == "lt":
            return left < right
        return left <= right
    return False


def _conditions_match(rule: AutomationRule, event: CrmEvent, data: dict[str, Any] | None = None) -> bool:
    data = data if data is not None else _event_input(event)
    conditions = rule.conditions_json or []
    if not conditions:
        return True
    if (rule.condition_mode or "all") == "any":
        return any(_condition_matches(data, condition) for condition in conditions)
    return all(_condition_matches(data, condition) for condition in conditions)


def _automation_depth(event: CrmEvent) -> int:
    payload = event.payload or {}
    context = payload.get(AUTOMATION_CONTEXT_KEY)
    if not isinstance(context, dict):
        return 0
    try:
        return int(context.get("depth") or 0)
    except (TypeError, ValueError):
        return 0


def _existing_run_for_rule_event(db: Session, *, rule_id: int, event_id: int | None) -> AutomationRuleRun | None:
    if event_id is None:
        return None
    return (
        db.query(AutomationRuleRun)
        .filter(AutomationRuleRun.rule_id == rule_id, AutomationRuleRun.event_id == event_id)
        .order_by(AutomationRuleRun.id.asc())
        .first()
    )


def _record_skipped_run(db: Session, *, rule: AutomationRule, event: CrmEvent, reason: str) -> AutomationRuleRun:
    existing = _existing_run_for_rule_event(db, rule_id=rule.id, event_id=event.id)
    if existing is not None:
        return existing
    data = _event_input(event)
    run = AutomationRuleRun(
        tenant_id=event.tenant_id,
        rule_id=rule.id,
        event_id=event.id,
        trigger_event_key=rule.trigger_event,
        source_module_key=event.entity_type,
        source_record_id=str(event.entity_id),
        status="skipped",
        input_json=jsonable_encoder(data),
        error_message=reason,
        started_at=_utcnow(),
        finished_at=_utcnow(),
        completed_at=_utcnow(),
        step_results_json=[],
    )
    db.add(run)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = _existing_run_for_rule_event(db, rule_id=rule.id, event_id=event.id)
        if existing is not None:
            return existing
        raise
    db.refresh(run)
    return run


def _redact_debug_value(value: Any) -> Any:
    if isinstance(value, dict):
        redacted: dict[str, Any] = {}
        for key, item in value.items():
            lowered_key = str(key).lower()
            if any(marker in lowered_key for marker in SENSITIVE_DEBUG_KEYS):
                redacted[key] = "[redacted]"
            else:
                redacted[key] = _redact_debug_value(item)
        return redacted
    if isinstance(value, list):
        return [_redact_debug_value(item) for item in value]
    return value


def _action_counts(step_results: Any, result_json: Any) -> tuple[int, int, int]:
    if isinstance(step_results, list):
        attempted = len(step_results)
        succeeded = sum(1 for item in step_results if isinstance(item, dict) and item.get("status") == "success")
        failed = sum(1 for item in step_results if isinstance(item, dict) and item.get("status") == "failed")
        return attempted, succeeded, failed
    actions = result_json.get("actions") if isinstance(result_json, dict) else None
    if isinstance(actions, list):
        return len(actions), len(actions), 0
    return 0, 0, 0


def list_automation_rules(db: Session, *, tenant_id: int, module_key: str | None = None) -> list[AutomationRule]:
    query = db.query(AutomationRule).filter(AutomationRule.tenant_id == tenant_id)
    if module_key:
        query = query.filter(AutomationRule.module_key == module_key)
    return query.order_by(AutomationRule.enabled.desc(), AutomationRule.trigger_event.asc(), AutomationRule.name.asc(), AutomationRule.id.asc()).all()


def get_automation_rule_or_404(db: Session, *, tenant_id: int, rule_id: int) -> AutomationRule:
    rule = db.query(AutomationRule).filter(AutomationRule.tenant_id == tenant_id, AutomationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Automation rule not found")
    return rule


def create_automation_rule(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict[str, Any]) -> AutomationRule:
    trigger_event = _normalize_trigger(payload.get("trigger_event"))
    enabled = bool(payload.get("enabled", True))
    _require_available_trigger(trigger_event, enabled=enabled)
    rule = AutomationRule(
        tenant_id=tenant_id,
        name=payload["name"].strip(),
        description=(payload.get("description") or "").strip() or None,
        module_key=_normalize_module_key(payload.get("module_key"), trigger_event=trigger_event),
        enabled=enabled,
        trigger_event=trigger_event,
        condition_mode=_normalize_condition_mode(payload.get("condition_mode")),
        conditions_json=_normalize_conditions(payload.get("conditions_json"), trigger_event=trigger_event),
        actions_json=_normalize_actions(payload.get("actions_json"), trigger_event=trigger_event, require_complete=enabled),
        created_by_id=actor_user_id,
        updated_by_id=actor_user_id,
    )
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def update_automation_rule(db: Session, *, rule: AutomationRule, actor_user_id: int | None, payload: dict[str, Any]) -> AutomationRule:
    next_enabled = bool(payload["enabled"]) if "enabled" in payload and payload["enabled"] is not None else bool(rule.enabled)
    if "name" in payload and payload["name"] is not None:
        rule.name = payload["name"].strip()
    if "description" in payload:
        rule.description = (payload["description"] or "").strip() or None
    if "enabled" in payload and payload["enabled"] is not None:
        rule.enabled = bool(payload["enabled"])
    if "trigger_event" in payload and payload["trigger_event"] is not None:
        rule.trigger_event = _normalize_trigger(payload["trigger_event"])
        if "module_key" not in payload:
            rule.module_key = module_key_for_trigger(rule.trigger_event)
    if "module_key" in payload:
        rule.module_key = _normalize_module_key(payload.get("module_key"), trigger_event=rule.trigger_event)
    if "condition_mode" in payload and payload["condition_mode"] is not None:
        rule.condition_mode = _normalize_condition_mode(payload["condition_mode"])
    if "conditions_json" in payload and payload["conditions_json"] is not None:
        rule.conditions_json = _normalize_conditions(payload["conditions_json"], trigger_event=rule.trigger_event)
    elif "trigger_event" in payload and payload["trigger_event"] is not None:
        rule.conditions_json = _normalize_conditions(rule.conditions_json or [], trigger_event=rule.trigger_event)
    if "actions_json" in payload and payload["actions_json"] is not None:
        rule.actions_json = _normalize_actions(payload["actions_json"], trigger_event=rule.trigger_event, require_complete=next_enabled)
    elif ("trigger_event" in payload and payload["trigger_event"] is not None) or next_enabled:
        rule.actions_json = _normalize_actions(rule.actions_json or [], trigger_event=rule.trigger_event, require_complete=next_enabled)
    _require_available_trigger(rule.trigger_event, enabled=bool(rule.enabled))
    rule.updated_by_id = actor_user_id
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


def delete_automation_rule(db: Session, *, rule: AutomationRule) -> None:
    db.delete(rule)
    db.commit()


def preview_automation_rule(payload: dict[str, Any]) -> dict[str, Any]:
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Rule name is required")
    trigger_event = _normalize_trigger(payload.get("trigger_event"))
    enabled = bool(payload.get("enabled", True))
    module_key = _normalize_module_key(payload.get("module_key"), trigger_event=trigger_event)
    condition_mode = _normalize_condition_mode(payload.get("condition_mode"))
    conditions = _normalize_conditions(payload.get("conditions_json"), trigger_event=trigger_event)
    actions = _normalize_actions(payload.get("actions_json"), trigger_event=trigger_event, require_complete=enabled)
    warnings: list[str] = []
    trigger_available = is_trigger_available(trigger_event)
    if not trigger_available:
        warnings.append(f"{UNAVAILABLE_TRIGGER_DETAIL}. Choose another trigger.")
    if not enabled and not actions:
        warnings.append("Draft is disabled and has no actions yet.")
    if not conditions:
        warnings.append("No conditions are set; this rule will run for every matching trigger.")
    preview_actions = []
    for index, action in enumerate(actions):
        definition = get_action_or_none(str(action.get("type") or ""))
        preview_actions.append(
            {
                "index": index,
                "type": action["type"],
                "label": definition.label if definition else action["type"],
                "config": jsonable_encoder(action),
            }
        )
    return {
        "valid": True,
        "can_enable": bool(actions) and trigger_available,
        "module_key": module_key,
        "trigger_event": trigger_event,
        "condition_mode": condition_mode,
        "condition_count": len(conditions),
        "action_count": len(actions),
        "warnings": warnings,
        "actions": preview_actions,
    }


def list_automation_rule_runs(
    db: Session,
    *,
    tenant_id: int,
    rule_id: int | None = None,
    module_key: str | None = None,
    pagination: Pagination | None = None,
) -> list[AutomationRuleRun]:
    query = db.query(AutomationRuleRun).options(joinedload(AutomationRuleRun.rule)).filter(AutomationRuleRun.tenant_id == tenant_id)
    if rule_id is not None:
        query = query.filter(AutomationRuleRun.rule_id == rule_id)
    if module_key:
        query = query.join(AutomationRule).filter(AutomationRule.module_key == module_key)
    query = query.order_by(AutomationRuleRun.started_at.desc(), AutomationRuleRun.id.desc())
    if pagination:
        query = query.offset(pagination.offset).limit(pagination.limit)
    return query.all()


def serialize_automation_rule(rule: AutomationRule) -> dict[str, Any]:
    return _serialize_rule(rule)


def serialize_automation_rule_run(run: AutomationRuleRun) -> dict[str, Any]:
    step_results = _redact_debug_value(run.step_results_json or [])
    result_json = _redact_debug_value(run.result_json or {})
    input_json = _redact_debug_value(run.input_json or {})
    attempted, succeeded, failed = _action_counts(step_results, result_json)
    source_module = run.source_module_key or (input_json.get("entity_type") if isinstance(input_json, dict) else None)
    source_record_id = run.source_record_id or (input_json.get("entity_id") if isinstance(input_json, dict) else None)
    return {
        "id": run.id,
        "rule_id": run.rule_id,
        "rule_name": run.rule.name if run.rule else None,
        "event_id": run.event_id,
        "trigger_event_key": run.trigger_event_key,
        "source_module_key": source_module,
        "source_record_id": str(source_record_id) if source_record_id is not None else None,
        "source_label": f"{source_module} #{source_record_id}" if source_module and source_record_id is not None else None,
        "status": run.status,
        "input_json": input_json,
        "result_json": result_json,
        "step_results_json": step_results if isinstance(step_results, list) else [],
        "action_attempt_count": attempted,
        "action_success_count": succeeded,
        "action_failed_count": failed,
        "error_message": run.error_message,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "completed_at": run.completed_at,
    }


def _template(value: Any, data: dict[str, Any]) -> Any:
    if not isinstance(value, str):
        return value

    def replace_token(match: re.Match[str]) -> str:
        key = match.group(1)
        if key in {"event_type", "entity_type", "entity_id", "actor_user_id"}:
            return str(data.get(key) or "")
        if key.startswith("payload."):
            payload = data.get("payload") or {}
            payload_key = key.removeprefix("payload.")
            payload_value = payload.get(payload_key)
            if isinstance(payload_value, (str, int, float, bool)) or payload_value is None:
                return str(payload_value or "")
        return match.group(0)

    return TEMPLATE_TOKEN_PATTERN.sub(replace_token, value)


def _resolve_user_id(action: dict[str, Any], data: dict[str, Any]) -> int | None:
    raw_value = action.get("user_id")
    if raw_value == USER_TARGET_ACTOR:
        raw_value = data.get("actor_user_id")
    elif raw_value == USER_TARGET_OWNER:
        raw_value = _lookup_path(data, "payload.owner_user_id")
    elif isinstance(raw_value, str) and raw_value.startswith("payload."):
        raw_value = _lookup_path(data, raw_value)
    try:
        return int(raw_value) if raw_value not in {None, ""} else None
    except (TypeError, ValueError):
        return None


def _resolve_action_user_id(action: dict[str, Any], data: dict[str, Any], field_key: str) -> int | None:
    return _resolve_user_id({"user_id": action.get(field_key)}, data)


def _ensure_user(db: Session, *, tenant_id: int, user_id: int | None) -> User | None:
    if user_id is None:
        return None
    return db.query(User).filter(User.tenant_id == tenant_id, User.id == user_id).first()


def _add_automation_activity(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    module_key: str,
    entity_type: str,
    entity_id: str | int,
    action: str,
    description: str,
    after_state: dict[str, Any] | None = None,
) -> None:
    db.add(
        ActivityLog(
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key=module_key,
            entity_type=entity_type,
            entity_id=str(entity_id),
            action=action,
            description=description,
            after_state=jsonable_encoder(after_state or {}),
        )
    )


def _resolve_record_id(action: dict[str, Any], data: dict[str, Any], field_key: str) -> int | None:
    raw_value = action.get(field_key) or data.get("entity_id") or _lookup_path(data, f"payload.{field_key}")
    try:
        return int(raw_value) if raw_value not in {None, ""} else None
    except (TypeError, ValueError):
        return None


def _create_task_action(db: Session, *, tenant_id: int, actor_user_id: int | None, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    title = str(_template(action.get("title") or "Automation task", data)).strip()
    if not title:
        raise RuntimeError("Task title is required")
    due_in_days = action.get("due_in_days")
    due_at = None
    if due_in_days not in {None, ""}:
        try:
            due_at = _utcnow() + timedelta(days=int(due_in_days))
        except (TypeError, ValueError) as exc:
            raise RuntimeError("Due in days must be a whole number") from exc
    task = Task(
        tenant_id=tenant_id,
        title=title[:255],
        description=(str(_template(action.get("description") or "", data)).strip() or None),
        status="todo",
        priority=action.get("priority") if action.get("priority") in {"high", "medium", "low"} else "medium",
        due_at=due_at,
        # The module key, not the entity type: `Task.source_module_key` is what links the
        # task back to its record, and `sales_lead` linked nowhere.
        source_module_key=module_key_for_entity(action.get("source_module_key") or data.get("entity_type")),
        source_entity_id=str(action.get("source_entity_id") or data.get("entity_id") or "").strip() or None,
        source_label=str(_template(action.get("source_label") or _lookup_path(data, "payload.record_label") or data.get("event_type") or "Automation", data)).strip()[:255],
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(task)
    db.flush()
    assignee_user_id = _resolve_user_id({"user_id": action.get("assignee_user_id")}, data)
    if action.get("assignee_user_id") not in {None, ""} and assignee_user_id is not None and not _ensure_user(db, tenant_id=tenant_id, user_id=assignee_user_id):
        raise RuntimeError("Task assignee not found")
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
        if action.get("user_id") == USER_TARGET_OWNER:
            raise RuntimeError("The record has no owner to notify")
        raise RuntimeError("Notification user not found")
    notification = UserNotification(
        tenant_id=tenant_id,
        user_id=user_id,
        category="automation",
        title=str(_template(action.get("title") or "Automation notification", data)).strip()[:255],
        message=str(_template(action.get("message") or "An automation rule ran.", data)).strip(),
        link_url=(str(_template(action.get("link_url") or "", data)).strip() or _lookup_path(data, "payload.record_url") or None),
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
    # Comments are keyed by module (`sales_leads`); the event names the entity (`sales_lead`).
    # Writing the entity type here is why automation notes never showed on the record.
    module_key = module_key_for_entity(action.get("module_key") or data.get("entity_type")) or ""
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
            entity_type=str(data.get("entity_type") or module_key),
            entity_id=entity_id,
            action="automation.note",
            description="Added automation note",
            after_state={"comment_id": comment.id, "body": comment.body},
        )
    )
    return {"type": "add_record_note", "comment_id": comment.id}


def _convert_lead_to_opportunity_action(db: Session, *, tenant_id: int, actor_user_id: int | None, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    lead_id = _resolve_record_id(action, data, "lead_id")
    if lead_id is None:
        raise RuntimeError("Lead id is required")
    lead = db.query(SalesLead).filter(SalesLead.tenant_id == tenant_id, SalesLead.lead_id == lead_id, SalesLead.deleted_at.is_(None)).first()
    if not lead:
        raise RuntimeError("Lead not found")
    actor = automation_actor(actor_user_id or lead.assigned_to, tenant_id)
    result = convert_sales_lead(
        db,
        lead,
        {
            "create_account": True,
            "create_contact": True,
            "create_deal": True,
            "deal_stage": action.get("deal_stage") or "qualified",
            "deal_name": _template(action.get("deal_name") or "{{payload.first_name}} {{payload.last_name}} opportunity", data),
            "assigned_to": lead.assigned_to or actor.id,
        },
        current_user=actor,
    )
    _add_automation_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="sales_leads",
        entity_type="sales_lead",
        entity_id=lead_id,
        action="automation.convert_lead",
        description="Converted lead through automation",
        after_state={
            "account_id": result.get("account_id"),
            "contact_id": result.get("contact_id"),
            "opportunity_id": result.get("deal_id"),
        },
    )
    db.flush()
    return {
        "type": "convert_lead_to_opportunity",
        "lead_id": lead_id,
        "account_id": result.get("account_id"),
        "contact_id": result.get("contact_id"),
        "opportunity_id": result.get("deal_id"),
    }


def _convert_quote_to_order_action(db: Session, *, tenant_id: int, actor_user_id: int | None, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    quote_id = _resolve_record_id(action, data, "quote_id")
    if quote_id is None:
        raise RuntimeError("Quote id is required")
    quote = db.query(SalesQuote).filter(SalesQuote.tenant_id == tenant_id, SalesQuote.quote_id == quote_id, SalesQuote.deleted_at.is_(None)).first()
    if not quote:
        raise RuntimeError("Quote not found")
    order = convert_quote_to_order(db, quote, automation_actor(actor_user_id or quote.assigned_to, tenant_id))
    _add_automation_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="sales_quotes",
        entity_type="sales_quote",
        entity_id=quote_id,
        action="automation.convert_quote_to_order",
        description="Created sales order from quote through automation",
        after_state={"order_id": order.id, "order_number": order.order_number},
    )
    db.flush()
    return {"type": "convert_quote_to_order", "quote_id": quote_id, "order_id": order.id, "order_number": order.order_number}


def _assign_support_case_action(db: Session, *, tenant_id: int, actor_user_id: int | None, action: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    case_id = _resolve_record_id(action, data, "case_id")
    if case_id is None:
        raise RuntimeError("Support case id is required")
    assignee_user_id = _resolve_action_user_id(action, data, "assignee_user_id")
    assignee = _ensure_user(db, tenant_id=tenant_id, user_id=assignee_user_id)
    if not assignee:
        raise RuntimeError("Support case assignee not found")
    case = db.query(SupportCase).filter(SupportCase.tenant_id == tenant_id, SupportCase.id == case_id).first()
    if not case:
        raise RuntimeError("Support case not found")
    previous_assignee_id = case.assigned_to_id
    case.assigned_to_id = assignee.id
    db.add(case)
    db.add(
        SupportCaseEvent(
            tenant_id=tenant_id,
            case_id=case.id,
            event_type="automation.assigned",
            payload_json={"from_user_id": previous_assignee_id, "to_user_id": assignee.id},
            created_by_id=actor_user_id,
        )
    )
    notification = UserNotification(
        tenant_id=tenant_id,
        user_id=assignee.id,
        category="automation",
        title=str(_template(action.get("notification_title") or "Support case assigned", data)).strip()[:255],
        message=str(_template(action.get("notification_message") or "{{payload.subject}} needs attention.", data)).strip(),
        link_url=f"/dashboard/support/cases/{case.id}",
        payload={"automation": True, "case_id": case.id},
    )
    db.add(notification)
    _add_automation_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="support_cases",
        entity_type="support_case",
        entity_id=case.id,
        action="automation.assign_case",
        description="Assigned support case through automation",
        after_state={"from_user_id": previous_assignee_id, "to_user_id": assignee.id},
    )
    db.flush()
    return {"type": "assign_support_case", "case_id": case.id, "assignee_user_id": assignee.id, "notification_id": notification.id}


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
    if action_type == "convert_lead_to_opportunity":
        return _convert_lead_to_opportunity_action(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action=action, data=data)
    if action_type == "convert_quote_to_order":
        return _convert_quote_to_order_action(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action=action, data=data)
    if action_type == "assign_support_case":
        return _assign_support_case_action(db, tenant_id=tenant_id, actor_user_id=actor_user_id, action=action, data=data)
    raise RuntimeError(f"Unsupported action {action_type}")


def event_trigger_keys(event: CrmEvent) -> list[str]:
    """The event's own type, plus every specific trigger it satisfies."""

    keys = [event.event_type] if event.event_type in SUPPORTED_AUTOMATION_TRIGGERS else []
    for key in derived_trigger_keys(event.event_type, event.payload or {}):
        if key not in keys:
            keys.append(key)
    return keys


def build_event_data(db: Session, event: CrmEvent) -> dict[str, Any]:
    snapshot = load_record_snapshot(db, tenant_id=event.tenant_id, entity_type=event.entity_type, entity_id=event.entity_id)
    return _event_input(event, snapshot)


def _trigger_module_enabled(db: Session, *, tenant_id: int, trigger_event: str) -> bool:
    """False when the trigger's module is switched off for the tenant.

    A module with no row (older installs, tests) does not gate anything.
    """

    from app.modules.user_management.services.admin_modules import is_module_enabled_for_tenant

    module_key = module_key_for_trigger(trigger_event)
    if not module_key:
        return True
    module = db.query(Module).filter(Module.name == module_key).first()
    if module is None:
        return True
    return is_module_enabled_for_tenant(db, tenant_id=tenant_id, module=module)


def execute_rule_for_event(db: Session, *, rule: AutomationRule, event: CrmEvent, data: dict[str, Any] | None = None) -> AutomationRuleRun | None:
    if not rule.enabled or rule.tenant_id != event.tenant_id or rule.trigger_event not in event_trigger_keys(event):
        return None
    rule_id = rule.id
    event_id = event.id
    existing = _existing_run_for_rule_event(db, rule_id=rule_id, event_id=event_id)
    if existing is not None:
        return existing
    data = data if data is not None else build_event_data(db, event)
    if not _conditions_match(rule, event, data):
        return None

    run = AutomationRuleRun(
        tenant_id=event.tenant_id,
        rule_id=rule.id,
        event_id=event.id,
        trigger_event_key=rule.trigger_event,
        source_module_key=event.entity_type,
        source_record_id=str(event.entity_id),
        status="running",
        input_json=jsonable_encoder(data),
        started_at=_utcnow(),
    )
    db.add(run)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return _existing_run_for_rule_event(db, rule_id=rule_id, event_id=event_id)
    action_results = []
    try:
        for index, action in enumerate(rule.actions_json or []):
            try:
                result = _execute_action(db, tenant_id=event.tenant_id, actor_user_id=event.actor_user_id, action=action, data=data)
            except Exception as action_exc:
                action_results.append(
                    {
                        "index": index,
                        "type": action.get("type"),
                        "status": "failed",
                        "error": str(action_exc)[:1000],
                    }
                )
                raise
            action_results.append({"index": index, "type": action.get("type"), "status": "success", "result": result})
    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)[:1000]
        run.step_results_json = jsonable_encoder(action_results)
        run.finished_at = _utcnow()
        run.completed_at = run.finished_at
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
    run.result_json = {"actions": jsonable_encoder([item["result"] for item in action_results])}
    run.step_results_json = jsonable_encoder(action_results)
    run.finished_at = _utcnow()
    run.completed_at = run.finished_at
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def process_crm_event_automations(db: Session, *, event_id: int) -> list[AutomationRuleRun]:
    event = db.query(CrmEvent).filter(CrmEvent.id == event_id).first()
    if not event:
        return []
    trigger_keys = event_trigger_keys(event)
    if not trigger_keys:
        return []
    rules = (
        db.query(AutomationRule)
        .filter(
            AutomationRule.tenant_id == event.tenant_id,
            AutomationRule.trigger_event.in_(trigger_keys),
            AutomationRule.enabled.is_(True),
        )
        .order_by(AutomationRule.id.asc())
        .all()
    )
    if not rules:
        return []
    if _automation_depth(event) >= settings.AUTOMATION_MAX_EVENT_DEPTH:
        return [
            _record_skipped_run(
                db,
                rule=rule,
                event=event,
                reason="Automation skipped because max automation depth was reached",
            )
            for rule in rules
        ]
    data = build_event_data(db, event)
    enabled_by_trigger: dict[str, bool] = {}
    runs: list[AutomationRuleRun] = []
    for rule in rules:
        if rule.trigger_event not in enabled_by_trigger:
            enabled_by_trigger[rule.trigger_event] = _trigger_module_enabled(db, tenant_id=event.tenant_id, trigger_event=rule.trigger_event)
        if not enabled_by_trigger[rule.trigger_event]:
            runs.append(_record_skipped_run(db, rule=rule, event=event, reason="Automation skipped because the trigger's module is disabled"))
            continue
        run = execute_rule_for_event(db, rule=rule, event=event, data=data)
        if run is not None:
            runs.append(run)
    return runs


def automation_actor(user_id: int | None, tenant_id: int) -> AutomationActor:
    return AutomationActor(id=user_id, tenant_id=tenant_id)


def serialize_condition_fields_for_tenant(db: Session, *, tenant_id: int, fields) -> list[dict[str, Any]]:
    """The condition fields, with options that depend on the tenant resolved.

    *Stage* offered the six seeded keys, so a stage the tenant added could not be picked.
    It now lists the tenant's own pipeline, including deactivated stages, since a rule may
    still need to match a deal sitting in one.
    """

    from app.modules.platform.services.automation_registry import serialize_condition_field
    from app.modules.sales.services.pipelines_services import get_default_opportunity_pipeline

    serialized = [serialize_condition_field(field) for field in fields]
    for item in serialized:
        if item["module_key"] == "sales_opportunities" and item["payload_key"] == "sales_stage":
            pipeline = get_default_opportunity_pipeline(db, tenant_id)
            stages = sorted(pipeline.stages, key=lambda stage: (stage.position, stage.id)) if pipeline else []
            if stages:
                item["options"] = [{"value": stage.key, "label": stage.label} for stage in stages]
    return serialized


def list_automation_templates() -> list[dict[str, Any]]:
    from app.modules.platform.services.automation_registry import AUTOMATION_TEMPLATES, serialize_template

    return [serialize_template(template) for template in AUTOMATION_TEMPLATES if is_trigger_available(template.trigger_event)]
