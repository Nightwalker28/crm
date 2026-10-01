"""Runs a report definition (config version 2, `docs/crm-evolution/11-reports.md` §4.2).

A run is always evaluated as the person viewing it: the source's base query carries the
module's own visibility, and nothing here widens it. Shared reports therefore never show a
viewer a record they could not open from the module itself.

The shape of a run:

1. the source's base query (tenant, recycle bin, search, module visibility) becomes an ID
   subquery, so a search join can never double-count a record;
2. the outer query over the module's table adds "Show me", the date filter and the field
   conditions, all against report fields, so every report field can be filtered;
3. grouped rows, then subtotals per first grouping, then grand totals: three aggregate
   queries, because an average or a minimum cannot be added up from its parts.
"""

from __future__ import annotations

import csv
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from io import BytesIO, StringIO
from html import escape
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import HTTPException, status
from sqlalchemy import Date, Integer, String, and_, cast, func, literal, or_
from sqlalchemy.orm import Session

from app.core.module_filters import apply_filter_conditions
from app.modules.platform.services.module_fields import sanitize_disabled_filter_conditions
from app.modules.platform.services.report_catalog import (
    DATE_TYPES,
    EMPTY_KEY,
    ReportField,
    ReportSource,
    field_rank,
    resolve_labels,
    resolve_source,
)


CONFIG_VERSION = 2
FORMATS = {"summary", "matrix", "tabular"}
AGGREGATES = {"count", "sum", "avg", "min", "max"}
GRANULARITIES = {"day", "week", "month", "quarter", "year"}
SCOPES = {"all", "mine", "my_team"}
CHART_TYPES = {"column", "bar", "line", "donut", "funnel", "metric", "none"}
DATE_RANGES = {
    "all_time", "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
    "this_quarter", "last_quarter", "next_quarter", "this_year", "last_year",
    "last_7_days", "last_30_days", "last_90_days", "next_30_days", "next_90_days", "custom",
}
MAX_GROUPINGS = 2
MAX_MEASURES = 4
MAX_COLUMNS = 12
DEFAULT_LIMIT = 25
MAX_LIMIT = 100
# The second grouping of a matrix becomes table columns; past this many it stops reading.
MAX_COLUMN_GROUPS = 12
# Combinations fetched for a two-level report before it is reported as truncated.
MAX_GROUP_ROWS = 5000
MAX_RECORDS_PAGE = 100
MAX_EXPORT_RECORDS = 5000

AGGREGATE_LABELS = {"sum": "Sum of", "avg": "Average", "min": "Minimum", "max": "Maximum"}


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


# ------------------------------------------------------------------------ definition


def _resolve_key(source: ReportSource, key: Any) -> str:
    key = str(key or "").strip()
    return source.aliases.get(key, key)


def upgrade_config(config: dict[str, Any] | None) -> dict[str, Any]:
    """Read a version 1 config (`dimension`, `metric`, `metric_field`, `view_mode`) as
    version 2. Nothing is written back; a v1 row stays v1 until someone saves it."""
    config = dict(config or {})
    if config.get("version") == CONFIG_VERSION:
        return config
    measures: list[dict[str, Any]] = [{"aggregate": "count"}]
    if config.get("metric") == "sum" and config.get("metric_field"):
        measures = [{"aggregate": "sum", "field": config.get("metric_field")}]
    view_mode = config.get("view_mode") or "bar"
    return {
        "version": CONFIG_VERSION,
        "format": "summary",
        # Day groups were the old behaviour and are what made date reports unreadable.
        "groupings": [{"field": config.get("dimension"), "granularity": "month"}] if config.get("dimension") else [],
        "measures": measures,
        "scope": "all",
        "date_filter": None,
        "filters": config.get("filters") or {},
        "columns": [],
        "chart": {"type": {"bar": "column", "pie": "donut", "table": "none"}.get(view_mode, "column")},
        "sort": {"by": "value", "direction": "desc"},
        "limit": DEFAULT_LIMIT,
    }


def normalize_config(db: Session, current_user, source: ReportSource, fields: list[ReportField], config: dict[str, Any] | None) -> dict[str, Any]:
    """Validate a definition against the viewer's fields. Unknown or disabled fields are
    dropped, not fatal: a shared report must still open for a viewer whose tenant turned a
    field off. Structural mistakes (a sum with no number, a matrix with one grouping) are 400s."""
    config = upgrade_config(config)
    by_key = {item.key: item for item in fields}

    report_format = str(config.get("format") or "summary").strip().lower()
    if report_format not in FORMATS:
        raise _bad_request("Unsupported report format")

    groupings: list[dict[str, Any]] = []
    if report_format != "tabular":
        for raw in (config.get("groupings") or [])[:MAX_GROUPINGS]:
            if not isinstance(raw, dict):
                continue
            item = by_key.get(_resolve_key(source, raw.get("field")))
            if not item or not item.can_group or any(g["field"] == item.key for g in groupings):
                continue
            granularity = None
            if item.field_type in DATE_TYPES:
                granularity = str(raw.get("granularity") or "month").lower()
                if granularity not in GRANULARITIES:
                    granularity = "month"
            groupings.append({"field": item.key, "granularity": granularity})
    if report_format == "matrix" and len(groupings) != 2:
        raise _bad_request("A matrix report needs a row grouping and a column grouping")

    measures: list[dict[str, Any]] = []
    for raw in (config.get("measures") or [])[:MAX_MEASURES]:
        if not isinstance(raw, dict):
            continue
        aggregate = str(raw.get("aggregate") or "count").lower()
        if aggregate not in AGGREGATES:
            raise _bad_request("Unsupported report measure")
        if aggregate == "count":
            if not any(m["aggregate"] == "count" for m in measures):
                measures.append({"aggregate": "count", "field": None})
            continue
        item = by_key.get(_resolve_key(source, raw.get("field")))
        if not item or not item.can_measure:
            raise _bad_request("Choose a number field to measure")
        if not any(m["aggregate"] == aggregate and m["field"] == item.key for m in measures):
            measures.append({"aggregate": aggregate, "field": item.key})
    if not measures:
        measures = [{"aggregate": "count", "field": None}]

    scope = str(config.get("scope") or "all").lower()
    if scope not in SCOPES or source.scope_clause is None:
        scope = "all"

    date_filter = None
    raw_date = config.get("date_filter")
    if isinstance(raw_date, dict):
        item = by_key.get(_resolve_key(source, raw_date.get("field")))
        date_range = str(raw_date.get("range") or "all_time").lower()
        if item and item.field_type in DATE_TYPES and date_range in DATE_RANGES and date_range != "all_time":
            date_filter = {"field": item.key, "range": date_range, "start": None, "end": None}
            if date_range == "custom":
                start, end = _parse_date(raw_date.get("start")), _parse_date(raw_date.get("end"))
                if start is None and end is None:
                    raise _bad_request("A custom date range needs a start or an end date")
                if start and end and end < start:
                    raise _bad_request("The end date must be on or after the start date")
                date_filter.update({"start": start.isoformat() if start else None, "end": end.isoformat() if end else None})

    filters = config.get("filters") if isinstance(config.get("filters"), dict) else {}

    def conditions(name: str) -> list[dict]:
        raw_conditions = filters.get(name) if isinstance(filters.get(name), list) else []
        kept = [c for c in raw_conditions if isinstance(c, dict) and _resolve_key(source, c.get("field")) in by_key]
        for condition in kept:
            condition["field"] = _resolve_key(source, condition.get("field"))
        return sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=source.module_key, conditions=kept)

    normalized_filters = {
        "search": str(filters.get("search") or "")[:100],
        "logic": "all",
        "conditions": [],
        "all_conditions": conditions("all_conditions"),
        "any_conditions": conditions("any_conditions"),
    }

    columns = []
    for key in config.get("columns") or []:
        resolved = _resolve_key(source, key)
        if resolved in by_key and resolved not in columns:
            columns.append(resolved)
    columns = columns[:MAX_COLUMNS]

    chart = config.get("chart") if isinstance(config.get("chart"), dict) else {}
    chart_type = str(chart.get("type") or ("none" if report_format == "tabular" else "column")).lower()
    if chart_type not in CHART_TYPES or report_format == "tabular":
        chart_type = "none" if report_format == "tabular" else "column"

    sort = config.get("sort") if isinstance(config.get("sort"), dict) else {}
    sort_by = str(sort.get("by") or "value")
    if report_format == "tabular":
        sort_by = _resolve_key(source, sort_by)
        if sort_by not in by_key:
            sort_by = "default"
    elif sort_by not in {"value", "label"}:
        sort_by = "value"
    direction = "asc" if str(sort.get("direction") or "desc").lower() == "asc" else "desc"

    try:
        limit = int(config.get("limit") or DEFAULT_LIMIT)
    except (TypeError, ValueError):
        limit = DEFAULT_LIMIT

    return {
        "version": CONFIG_VERSION,
        "format": report_format,
        "groupings": groupings,
        "measures": measures,
        "scope": scope,
        "date_filter": date_filter,
        "filters": normalized_filters,
        "columns": columns,
        "chart": {"type": chart_type},
        "sort": {"by": sort_by, "direction": direction},
        "limit": max(1, min(limit, MAX_LIMIT)),
    }


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError as exc:
        raise _bad_request("Dates must use YYYY-MM-DD") from exc


# -------------------------------------------------------------------------- dates


def _user_tz(current_user) -> tuple[str, Any]:
    name = getattr(current_user, "timezone", None) or "UTC"
    try:
        return name, ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return "UTC", timezone.utc


def _today(tz) -> date:
    return datetime.now(tz).date()


def _quarter_start(day: date) -> date:
    return date(day.year, 3 * ((day.month - 1) // 3) + 1, 1)


def _add_months(day: date, months: int) -> date:
    month_index = day.year * 12 + (day.month - 1) + months
    return date(month_index // 12, month_index % 12 + 1, 1)


def resolve_date_range(date_range: str, today: date, start: str | None = None, end: str | None = None) -> tuple[date | None, date | None]:
    """Inclusive bounds for a relative range, in the viewer's calendar. Weeks start Monday."""
    if date_range == "custom":
        return _parse_date(start), _parse_date(end)
    if date_range == "today":
        return today, today
    if date_range == "yesterday":
        day = today - timedelta(days=1)
        return day, day
    week_start = today - timedelta(days=today.weekday())
    if date_range == "this_week":
        return week_start, week_start + timedelta(days=6)
    if date_range == "last_week":
        return week_start - timedelta(days=7), week_start - timedelta(days=1)
    month_start = today.replace(day=1)
    if date_range == "this_month":
        return month_start, _add_months(month_start, 1) - timedelta(days=1)
    if date_range == "last_month":
        return _add_months(month_start, -1), month_start - timedelta(days=1)
    quarter_start = _quarter_start(today)
    if date_range == "this_quarter":
        return quarter_start, _add_months(quarter_start, 3) - timedelta(days=1)
    if date_range == "last_quarter":
        return _add_months(quarter_start, -3), quarter_start - timedelta(days=1)
    if date_range == "next_quarter":
        return _add_months(quarter_start, 3), _add_months(quarter_start, 6) - timedelta(days=1)
    if date_range == "this_year":
        return date(today.year, 1, 1), date(today.year, 12, 31)
    if date_range == "last_year":
        return date(today.year - 1, 1, 1), date(today.year - 1, 12, 31)
    if date_range.startswith("last_") and date_range.endswith("_days"):
        days = int(date_range.split("_")[1])
        return today - timedelta(days=days - 1), today
    if date_range.startswith("next_") and date_range.endswith("_days"):
        days = int(date_range.split("_")[1])
        return today, today + timedelta(days=days - 1)
    return None, None


def _dialect(db: Session) -> str:
    return db.bind.dialect.name if db.bind is not None else "sqlite"


def _local_date(db: Session, item: ReportField, tz_name: str):
    """The field as a calendar date in the viewer's time zone. A timestamp at 23:30 UTC is
    the next day in Colombo, and a monthly report has to agree with the record page."""
    if _dialect(db) != "postgresql":
        # SQLite gives `CAST(... AS DATE)` numeric affinity, which turns `2026-03-02` into
        # 2026. Its `date()` reads both stored shapes and returns the ISO day.
        return func.date(item.expression)
    if item.field_type == "datetime":
        return cast(func.timezone(tz_name, item.expression), Date)
    return cast(item.expression, Date)


def _date_bucket(db: Session, item: ReportField, granularity: str, tz_name: str):
    """A sortable text key per bucket: `2026-09-28` (day, and a week's Monday),
    `2026-09`, `2026-Q3`, `2026`."""
    day = _local_date(db, item, tz_name)
    if _dialect(db) == "postgresql":
        if granularity == "day":
            return func.to_char(day, "YYYY-MM-DD")
        if granularity == "week":
            return func.to_char(func.date_trunc("week", day), "YYYY-MM-DD")
        if granularity == "month":
            return func.to_char(day, "YYYY-MM")
        if granularity == "quarter":
            return func.to_char(day, 'YYYY-"Q"Q')
        return func.to_char(day, "YYYY")
    if granularity == "day":
        return func.strftime("%Y-%m-%d", day)
    if granularity == "week":
        return func.date(day, "weekday 0", "-6 days")
    if granularity == "month":
        return func.strftime("%Y-%m", day)
    if granularity == "quarter":
        quarter = (cast(func.strftime("%m", day), Integer) + 2) // 3
        return func.strftime("%Y", day) + literal("-Q") + cast(quarter, String)
    return func.strftime("%Y", day)


MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def date_bucket_label(key: str, granularity: str) -> str:
    try:
        if granularity == "year":
            return key
        if granularity == "quarter":
            year, quarter = key.split("-Q")
            return f"Q{int(quarter)} {year}"
        if granularity == "month":
            year, month = key.split("-")
            return f"{MONTHS[int(month) - 1]} {year}"
        day = date.fromisoformat(key)
        text = f"{day.day} {MONTHS[day.month - 1]} {day.year}"
        return f"Week of {text}" if granularity == "week" else text
    except (ValueError, IndexError):
        return key


# -------------------------------------------------------------------------- query


class _Plan:
    """A normalized definition bound to the viewer: the scoped query and the expressions."""

    def __init__(self, db: Session, current_user, source: ReportSource, fields: list[ReportField], config: dict[str, Any]):
        self.db = db
        self.user = current_user
        self.source = source
        self.fields = {item.key: item for item in fields}
        self.config = config
        self.tz_name, self.tz = _user_tz(current_user)
        self.today = _today(self.tz)

        base = source.base_query(db, current_user, config["filters"].get("search") or None)
        ids = base.order_by(None).with_entities(source.record_id)
        query = db.query(source.model).filter(source.model.tenant_id == current_user.tenant_id, source.record_id.in_(ids))

        if config["scope"] != "all" and source.scope_clause is not None:
            query = query.filter(source.scope_clause(db, current_user, config["scope"]))

        date_filter = config.get("date_filter")
        if date_filter:
            item = self.fields[date_filter["field"]]
            start, end = resolve_date_range(date_filter["range"], self.today, date_filter.get("start"), date_filter.get("end"))
            local = _local_date(db, item, self.tz_name)
            if start:
                query = query.filter(local >= start)
            if end:
                query = query.filter(local <= end)

        field_map = {key: {"expression": item.expression, "type": item.filter_type} for key, item in self.fields.items()}
        query = apply_filter_conditions(query, conditions=config["filters"]["all_conditions"], logic="all", field_map=field_map)
        query = apply_filter_conditions(query, conditions=config["filters"]["any_conditions"], logic="any", field_map=field_map)
        self.query = query.order_by(None)

        self.groupings = [(self.fields[g["field"]], g.get("granularity")) for g in config["groupings"]]
        self.group_exprs = [
            _date_bucket(db, item, granularity, self.tz_name) if item.field_type in DATE_TYPES else item.expression
            for item, granularity in self.groupings
        ]

    def measure_exprs(self) -> list[Any]:
        exprs = []
        for measure in self.config["measures"]:
            if measure["aggregate"] == "count":
                exprs.append(func.count(self.source.record_id))
                continue
            expression = self.fields[measure["field"]].expression
            aggregate = {"sum": func.sum, "avg": func.avg, "min": func.min, "max": func.max}[measure["aggregate"]]
            exprs.append(aggregate(expression))
        return exprs

    def measure_payload(self) -> list[dict[str, Any]]:
        payload = []
        for measure in self.config["measures"]:
            if measure["aggregate"] == "count":
                payload.append({"key": "count", "aggregate": "count", "field": None, "label": "Records", "field_type": "number"})
                continue
            item = self.fields[measure["field"]]
            payload.append({
                "key": f"{measure['aggregate']}:{item.key}",
                "aggregate": measure["aggregate"],
                "field": item.key,
                "label": f"{AGGREGATE_LABELS[measure['aggregate']]} {item.label.lower()}" if measure["aggregate"] != "sum" else item.label,
                "field_type": item.field_type,
            })
        return payload

    def group_filter(self, keys: list[Any]):
        """The clause selecting one group or cell, keyed as the run returned it."""
        clauses = []
        for (item, _granularity), expression, key in zip(self.groupings, self.group_exprs, keys):
            if key is None:
                continue
            key = str(key)
            if key == EMPTY_KEY:
                if item.field_type in {"text", "select"}:
                    clauses.append(or_(expression.is_(None), func.trim(expression) == ""))
                else:
                    clauses.append(expression.is_(None))
            elif item.field_type == "boolean":
                clauses.append(expression.is_(key == "true"))
            elif item.field_type in {"user", "reference"}:
                try:
                    clauses.append(expression == int(key))
                except ValueError as exc:
                    raise _bad_request("Unknown group") from exc
            else:
                clauses.append(expression == key)
        return and_(*clauses) if clauses else None


def _key(value: Any) -> str:
    if value is None:
        return EMPTY_KEY
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip() or EMPTY_KEY


def _number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(round(value, 2))
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _resolve(db: Session, plan: _Plan, keys_by_level: list[set[str]]) -> list[dict[str, str]]:
    labels = []
    for (item, granularity), keys in zip(plan.groupings, keys_by_level):
        if item.field_type in DATE_TYPES:
            level = {key: date_bucket_label(key, granularity or "month") for key in keys if key != EMPTY_KEY}
            if EMPTY_KEY in keys:
                level[EMPTY_KEY] = "No date"
            labels.append(level)
        else:
            labels.append(resolve_labels(db, plan.user.tenant_id, item, keys))
    return labels


def _order(plan: _Plan, level: int, totals: dict[str, float | None], labels: dict[str, str]) -> list[str]:
    """Dates in date order and stages in pipeline order, whatever the sort says, because a
    chart of months sorted by size is not a timeline. Everything else follows the sort."""
    item, _granularity = plan.groupings[level]
    keys = list(totals)
    empty_last = lambda key: key == EMPTY_KEY  # noqa: E731
    if item.field_type in DATE_TYPES:
        return sorted(keys, key=lambda key: (empty_last(key), key))
    rank = field_rank(plan.db, plan.user.tenant_id, item)
    if rank:
        return sorted(keys, key=lambda key: (empty_last(key), rank.get(key, len(rank)), labels.get(key, key)))
    sort = plan.config["sort"]
    reverse = sort["direction"] == "desc"
    if sort["by"] == "label":
        ordered = sorted((key for key in keys if not empty_last(key)), key=lambda key: labels.get(key, key).casefold(), reverse=reverse)
    else:
        ordered = sorted(
            (key for key in keys if not empty_last(key)),
            key=lambda key: totals[key] if totals[key] is not None else float("-inf"),
            reverse=reverse,
        )
    # "No value" is always last: it is the group nobody is looking for.
    return ordered + [key for key in keys if empty_last(key)]


def run_report(db: Session, current_user, *, module_key: str, config: dict[str, Any] | None) -> dict[str, Any]:
    source, fields = resolve_source(db, current_user, module_key)
    normalized = normalize_config(db, current_user, source, fields, config)
    if normalized["format"] == "tabular":
        records = run_records(db, current_user, module_key=module_key, config=normalized, group_keys=None, offset=0, limit=50)
        return {
            "module_key": source.module_key,
            "label": source.label,
            "config": normalized,
            "groupings": [],
            "measures": [],
            "rows": [],
            "subtotals": [],
            "totals": {"count": records["total"], "values": []},
            "row_groups": [],
            "column_groups": [],
            "truncated": False,
            "records": records,
            "generated_at": datetime.now(timezone.utc),
        }
    plan = _Plan(db, current_user, source, fields, normalized)
    measures = plan.measure_exprs()
    count_expr = func.count(source.record_id)

    total_row = plan.query.with_entities(count_expr, *measures).one()
    totals = {"count": int(total_row[0] or 0), "values": [_number(v) for v in total_row[1:]]}

    result: dict[str, Any] = {
        "module_key": source.module_key,
        "label": source.label,
        "config": normalized,
        "groupings": [
            {**item.payload(), "granularity": granularity} for item, granularity in plan.groupings
        ],
        "measures": plan.measure_payload(),
        "rows": [],
        "subtotals": [],
        "totals": totals,
        "row_groups": [],
        "column_groups": [],
        "truncated": False,
        "records": None,
        "generated_at": datetime.now(timezone.utc),
    }
    if not plan.groupings:
        return result

    first_expr = plan.group_exprs[0].label("g0")
    first_rows = (
        plan.query.with_entities(first_expr, count_expr, *measures)
        .group_by(plan.group_exprs[0])
        .limit(MAX_GROUP_ROWS + 1)
        .all()
    )
    truncated = len(first_rows) > MAX_GROUP_ROWS
    first = {_key(row[0]): {"count": int(row[1] or 0), "values": [_number(v) for v in row[2:]]} for row in first_rows[:MAX_GROUP_ROWS]}

    second: dict[tuple[str, str], dict[str, Any]] = {}
    if len(plan.groupings) == 2:
        combo_rows = (
            plan.query.with_entities(first_expr, plan.group_exprs[1].label("g1"), count_expr, *measures)
            .group_by(plan.group_exprs[0], plan.group_exprs[1])
            .limit(MAX_GROUP_ROWS + 1)
            .all()
        )
        truncated = truncated or len(combo_rows) > MAX_GROUP_ROWS
        for row in combo_rows[:MAX_GROUP_ROWS]:
            second[(_key(row[0]), _key(row[1]))] = {"count": int(row[2] or 0), "values": [_number(v) for v in row[3:]]}

    level_keys = [set(first)] + ([{k[1] for k in second}] if len(plan.groupings) == 2 else [])
    labels = _resolve(db, plan, level_keys)

    first_totals = {key: (value["values"][0] if value["values"] else value["count"]) for key, value in first.items()}
    row_order = _order(plan, 0, first_totals, labels[0])
    if len(row_order) > normalized["limit"]:
        truncated = True
        row_order = row_order[: normalized["limit"]]
    result["row_groups"] = [{"key": key, "label": labels[0][key]} for key in row_order]

    if len(plan.groupings) == 1:
        result["rows"] = [
            {"keys": [key], "labels": [labels[0][key]], **first[key]} for key in row_order
        ]
    else:
        column_totals: dict[str, float] = {}
        for (k0, k1), value in second.items():
            measure = value["values"][0] if value["values"] else value["count"]
            column_totals[k1] = (column_totals.get(k1) or 0) + (measure or 0)
        column_order = _order(plan, 1, column_totals, labels[1])
        if normalized["format"] == "matrix" and len(column_order) > MAX_COLUMN_GROUPS:
            truncated = True
            column_order = column_order[:MAX_COLUMN_GROUPS]
        result["column_groups"] = [{"key": key, "label": labels[1][key]} for key in column_order]
        visible_rows = set(row_order)
        column_rank = {key: index for index, key in enumerate(column_order)}
        row_rank = {key: index for index, key in enumerate(row_order)}
        rows = [
            {"keys": [k0, k1], "labels": [labels[0][k0], labels[1][k1]], **value}
            for (k0, k1), value in second.items()
            if k0 in visible_rows and k1 in column_rank
        ]
        rows.sort(key=lambda row: (row_rank[row["keys"][0]], column_rank[row["keys"][1]]))
        result["rows"] = rows
        result["subtotals"] = [{"keys": [key], "labels": [labels[0][key]], **first[key]} for key in row_order]
    result["truncated"] = truncated
    return result


# ------------------------------------------------------------------------ records


def _display(item: ReportField, value: Any) -> Any:
    if value is None:
        return None
    if item.field_type in {"number", "money"}:
        return _number(value)
    if item.field_type == "boolean":
        return bool(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def run_records(
    db: Session,
    current_user,
    *,
    module_key: str,
    config: dict[str, Any] | None,
    group_keys: list[Any] | None,
    offset: int = 0,
    limit: int = 25,
) -> dict[str, Any]:
    """The records behind a report, or behind one of its groups or cells (drill-down)."""
    source, fields = resolve_source(db, current_user, module_key)
    normalized = normalize_config(db, current_user, source, fields, config)
    plan = _Plan(db, current_user, source, fields, normalized)
    query = plan.query
    if group_keys:
        if len(group_keys) > len(plan.groupings):
            raise _bad_request("Unknown group")
        clause = plan.group_filter(list(group_keys))
        if clause is not None:
            query = query.filter(clause)

    column_keys = normalized["columns"] or [key for key in source.default_columns if key in plan.fields]
    # The record's label is its own column; repeating the name field beside it says it twice.
    column_keys = [key for key in column_keys if key != source.label_field]
    columns = [plan.fields[key] for key in column_keys]
    limit = max(1, min(int(limit or 25), MAX_EXPORT_RECORDS))
    offset = max(0, int(offset or 0))

    total = query.with_entities(func.count(source.record_id)).scalar() or 0
    sort = normalized["sort"]
    ordered = query
    if normalized["format"] == "tabular" and sort["by"] in plan.fields:
        expression = plan.fields[sort["by"]].expression
        ordered = ordered.order_by(expression.desc().nullslast() if sort["direction"] == "desc" else expression.asc().nullslast())
    ordered = ordered.order_by(source.record_id.desc())
    rows = (
        ordered.with_entities(source.record_id, source.record_label(db), *[item.expression for item in columns])
        .offset(offset)
        .limit(limit)
        .all()
    )

    reference_keys: dict[str, set[str]] = {}
    for row in rows:
        for item, value in zip(columns, row[2:]):
            if item.labels:
                reference_keys.setdefault(item.key, set()).add(_key(value))
    reference_labels = {
        key: resolve_labels(db, current_user.tenant_id, plan.fields[key], keys) for key, keys in reference_keys.items()
    }

    records = []
    for row in rows:
        values = {}
        for item, value in zip(columns, row[2:]):
            if item.labels and value is not None:
                values[item.key] = reference_labels[item.key].get(_key(value), str(value))
            else:
                values[item.key] = _display(item, value)
        records.append({
            "id": row[0],
            "label": (row[1] or "").strip() or f"#{row[0]}",
            "path": source.record_path.format(id=row[0]) if source.record_path else None,
            "values": values,
        })
    return {
        "columns": [item.payload() for item in columns],
        "records": records,
        "total": int(total),
        "offset": offset,
        "limit": limit,
    }


# ------------------------------------------------------------------------- export


def _csv_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return value


def _export_rows(db: Session, current_user, *, module_key: str, config: dict[str, Any] | None, max_records: int = MAX_EXPORT_RECORDS):
    source, fields = resolve_source(db, current_user, module_key)
    normalized = normalize_config(db, current_user, source, fields, config)
    if normalized["format"] == "tabular":
        offset = 0
        while offset < max_records:
            records = run_records(db, current_user, module_key=module_key, config=normalized, group_keys=None, offset=offset, limit=min(MAX_EXPORT_RECORDS, max_records - offset))
            if offset == 0:
                yield ["Name", *[column["label"] for column in records["columns"]]]
            for record in records["records"]:
                yield [record["label"], *[_csv_value(record["values"].get(column["key"])) for column in records["columns"]]]
            offset += len(records["records"])
            if not records["records"] or offset >= records["total"]:
                break
        return

    result = run_report(db, current_user, module_key=module_key, config=normalized)
    group_labels = [grouping["label"] for grouping in result["groupings"]]
    measure_labels = [measure["label"] for measure in result["measures"] if measure["aggregate"] != "count"]
    yield [*group_labels, "Records", *measure_labels]
    count_index = [index for index, measure in enumerate(result["measures"]) if measure["aggregate"] != "count"]
    for row in result["rows"]:
        yield [*row["labels"], row["count"], *[_csv_value(row["values"][i]) for i in count_index]]
    yield [*(["Total"] + [""] * (len(group_labels) - 1) if group_labels else []), result["totals"]["count"], *[_csv_value(result["totals"]["values"][i]) for i in count_index]]


def report_csv_bytes(db: Session, current_user, *, module_key: str, config: dict[str, Any] | None, max_records: int = MAX_EXPORT_RECORDS) -> bytes:
    output = StringIO()
    writer = csv.writer(output)
    writer.writerows(_export_rows(db, current_user, module_key=module_key, config=config, max_records=max_records))
    return output.getvalue().encode("utf-8")


def report_xlsx_bytes(db: Session, current_user, *, module_key: str, config: dict[str, Any] | None, max_records: int = MAX_EXPORT_RECORDS) -> bytes:
    def column_name(index: int) -> str:
        result = ""
        while index:
            index, digit = divmod(index - 1, 26)
            result = chr(65 + digit) + result
        return result

    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        workbook.writestr("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        workbook.writestr("xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>')
        workbook.writestr("xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
        with workbook.open("xl/worksheets/sheet1.xml", "w") as sheet:
            sheet.write(b'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>')
            for row_number, row in enumerate(_export_rows(db, current_user, module_key=module_key, config=config, max_records=max_records), 1):
                sheet.write(f'<row r="{row_number}">'.encode())
                for column_number, value in enumerate(row, 1):
                    cell = f"{column_name(column_number)}{row_number}"
                    if isinstance(value, (int, float)) and not isinstance(value, bool):
                        sheet.write(f'<c r="{cell}"><v>{value}</v></c>'.encode())
                    else:
                        # Inline strings never execute spreadsheet formulas from report data.
                        literal = escape(re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", str(value if value is not None else "")), quote=False)
                        sheet.write(f'<c r="{cell}" t="inlineStr"><is><t>{literal}</t></is></c>'.encode())
                sheet.write(b"</row>")
            sheet.write(b"</sheetData></worksheet>")
    return output.getvalue()
