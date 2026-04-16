from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Date, DateTime, Numeric, Text, and_, cast, func, not_, or_

FILTER_OPERATORS = {
    "is",
    "is_not",
    "contains",
    "not_contains",
    "in",
    "not_in",
    "gt",
    "gte",
    "lt",
    "lte",
    "is_empty",
    "is_not_empty",
}

FILTER_LOGIC_VALUES = {"all", "any"}


def normalize_filter_logic(logic: str | None) -> str:
    return "any" if (logic or "").strip().lower() == "any" else "all"


def parse_filter_conditions(raw_filters: str | None) -> list[dict[str, Any]]:
    if not raw_filters:
        return []
    try:
        parsed = json.loads(raw_filters)
    except json.JSONDecodeError as exc:
        raise ValueError("Invalid filter payload") from exc

    if not isinstance(parsed, list):
        raise ValueError("Invalid filter payload")

    normalized: list[dict[str, Any]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "").strip()
        operator = str(item.get("operator") or "").strip()
        if not field or operator not in FILTER_OPERATORS:
            continue
        entry = {
            "field": field,
            "operator": operator,
            "value": item.get("value"),
            "values": item.get("values"),
        }
        normalized.append(entry)
    return normalized


def apply_filter_conditions(query, *, conditions: list[dict[str, Any]] | None, logic: str, field_map: dict[str, dict[str, Any]]):
    if not conditions:
        return query

    expressions = []
    for condition in conditions:
        definition = field_map.get(condition["field"])
        if not definition:
            continue
        expression = _build_condition_expression(definition, condition)
        if expression is not None:
            expressions.append(expression)

    if not expressions:
        return query

    if normalize_filter_logic(logic) == "any":
        return query.filter(or_(*expressions))
    return query.filter(and_(*expressions))


def _build_condition_expression(definition: dict[str, Any], condition: dict[str, Any]):
    expression = definition["expression"]
    field_type = definition.get("type", "text")
    operator = condition["operator"]
    value = condition.get("value")
    values = condition.get("values")

    if operator == "is_empty":
        return or_(expression.is_(None), func.trim(cast(expression, Text)) == "")
    if operator == "is_not_empty":
        return and_(expression.is_not(None), func.trim(cast(expression, Text)) != "")

    if field_type == "number":
        return _build_number_expression(expression, operator, value, values)
    if field_type == "date":
        return _build_date_expression(expression, operator, value, values)
    if field_type == "boolean":
        return _build_boolean_expression(expression, operator, value, values)
    return _build_text_expression(expression, operator, value, values)


def _build_text_expression(expression, operator: str, value: Any, values: Any):
    lowered = func.lower(func.coalesce(cast(expression, Text), ""))
    normalized_value = _normalize_text(value)
    normalized_values = _normalize_text_values(values, fallback=value)

    if operator == "is":
        if normalized_value is None:
            return None
        return lowered == normalized_value.lower()
    if operator == "is_not":
        if normalized_value is None:
            return None
        return lowered != normalized_value.lower()
    if operator == "contains":
        if normalized_value is None:
            return None
        return lowered.like(f"%{normalized_value.lower()}%")
    if operator == "not_contains":
        if normalized_value is None:
            return None
        return not_(lowered.like(f"%{normalized_value.lower()}%"))
    if operator == "in":
        if not normalized_values:
            return None
        return lowered.in_([item.lower() for item in normalized_values])
    if operator == "not_in":
        if not normalized_values:
            return None
        return not_(lowered.in_([item.lower() for item in normalized_values]))
    if operator in {"gt", "gte", "lt", "lte"}:
        comparable = _coerce_decimal(value)
        if comparable is None:
            return None
        numeric_expression = _numeric_expression(expression)
        if operator == "gt":
            return numeric_expression > comparable
        if operator == "gte":
            return numeric_expression >= comparable
        if operator == "lt":
            return numeric_expression < comparable
        return numeric_expression <= comparable
    return None


def _build_number_expression(expression, operator: str, value: Any, values: Any):
    comparable = _coerce_decimal(value)
    comparable_values = _coerce_decimal_values(values, fallback=value)
    numeric_expression = _numeric_expression(expression)

    if operator == "is":
        if comparable is None:
            return None
        return numeric_expression == comparable
    if operator == "is_not":
        if comparable is None:
            return None
        return numeric_expression != comparable
    if operator == "in":
        if not comparable_values:
            return None
        return numeric_expression.in_(comparable_values)
    if operator == "not_in":
        if not comparable_values:
            return None
        return not_(numeric_expression.in_(comparable_values))
    if operator == "gt":
        if comparable is None:
            return None
        return numeric_expression > comparable
    if operator == "gte":
        if comparable is None:
            return None
        return numeric_expression >= comparable
    if operator == "lt":
        if comparable is None:
            return None
        return numeric_expression < comparable
    if operator == "lte":
        if comparable is None:
            return None
        return numeric_expression <= comparable
    return None


def _build_date_expression(expression, operator: str, value: Any, values: Any):
    comparable = _coerce_date(value)
    comparable_values = _coerce_date_values(values, fallback=value)
    date_expression = cast(expression, Date)

    if operator == "is":
        if comparable is None:
            return None
        return date_expression == comparable
    if operator == "is_not":
        if comparable is None:
            return None
        return date_expression != comparable
    if operator == "in":
        if not comparable_values:
            return None
        return date_expression.in_(comparable_values)
    if operator == "not_in":
        if not comparable_values:
            return None
        return not_(date_expression.in_(comparable_values))
    if operator == "gt":
        if comparable is None:
            return None
        return date_expression > comparable
    if operator == "gte":
        if comparable is None:
            return None
        return date_expression >= comparable
    if operator == "lt":
        if comparable is None:
            return None
        return date_expression < comparable
    if operator == "lte":
        if comparable is None:
            return None
        return date_expression <= comparable
    if operator == "contains":
        if comparable is None:
            return None
        return cast(expression, DateTime).like(f"%{comparable.isoformat()}%")
    return None


def _build_boolean_expression(expression, operator: str, value: Any, values: Any):
    comparable = _coerce_bool(value)
    comparable_values = _coerce_bool_values(values, fallback=value)

    if operator == "is":
        if comparable is None:
            return None
        return expression.is_(comparable)
    if operator == "is_not":
        if comparable is None:
            return None
        return expression.is_not(comparable)
    if operator == "in":
        if not comparable_values:
            return None
        return expression.in_(comparable_values)
    if operator == "not_in":
        if not comparable_values:
            return None
        return not_(expression.in_(comparable_values))
    return None


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _normalize_text_values(values: Any, *, fallback: Any = None) -> list[str]:
    if isinstance(values, list):
        normalized = [_normalize_text(item) for item in values]
        return [item for item in normalized if item]
    if isinstance(values, str):
        normalized = [_normalize_text(item) for item in values.split(",")]
        return [item for item in normalized if item]
    single = _normalize_text(fallback)
    return [single] if single else []


def _coerce_decimal(value: Any) -> Decimal | None:
    normalized = _normalize_text(value)
    if normalized is None:
        return None
    try:
        return Decimal(normalized)
    except (InvalidOperation, ValueError):
        return None


def _coerce_decimal_values(values: Any, *, fallback: Any = None) -> list[Decimal]:
    source = values if isinstance(values, list) else values.split(",") if isinstance(values, str) else [fallback]
    normalized = [_coerce_decimal(item) for item in source]
    return [item for item in normalized if item is not None]


def _coerce_date(value: Any) -> date | None:
    normalized = _normalize_text(value)
    if normalized is None:
        return None
    try:
        return date.fromisoformat(normalized)
    except ValueError:
        try:
            return datetime.fromisoformat(normalized).date()
        except ValueError:
            return None


def _coerce_date_values(values: Any, *, fallback: Any = None) -> list[date]:
    source = values if isinstance(values, list) else values.split(",") if isinstance(values, str) else [fallback]
    normalized = [_coerce_date(item) for item in source]
    return [item for item in normalized if item is not None]


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = _normalize_text(value)
    if normalized is None:
        return None
    lowered = normalized.lower()
    if lowered in {"true", "1", "yes"}:
        return True
    if lowered in {"false", "0", "no"}:
        return False
    return None


def _coerce_bool_values(values: Any, *, fallback: Any = None) -> list[bool]:
    source = values if isinstance(values, list) else values.split(",") if isinstance(values, str) else [fallback]
    normalized = [_coerce_bool(item) for item in source]
    return [item for item in normalized if item is not None]


def _numeric_expression(expression):
    sanitized = func.nullif(func.regexp_replace(cast(expression, Text), r"[^0-9.\-]", "", "g"), "")
    return cast(sanitized, Numeric)
