from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import csv
from io import StringIO
from typing import Any, Callable

from fastapi import HTTPException, status
from sqlalchemy import Date, Numeric, String, case, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope, require_role_module_action_access
from app.core.module_filters import apply_filter_conditions
from app.modules.finance.models import FinanceIO
from app.modules.finance.repositories import io_repository
from app.modules.finance.services.io_search_services import get_finance_module_id
from app.modules.platform.models import CustomFieldValue, CustomModuleDefinition, CustomModuleRecord, CustomModuleRecordValue, ForecastSnapshot, UserModuleReport
from app.modules.platform.services import custom_modules
from app.modules.platform.services.custom_fields import CUSTOM_FIELD_FILTER_PREFIX, list_custom_field_definitions
from app.modules.platform.services.module_fields import module_field_enabled_map, sanitize_disabled_filter_conditions
from app.modules.sales.models import SalesContact, SalesLead, SalesOpportunity, SalesOrganization, SalesQuote
from app.modules.sales.repositories import contacts_repository, leads_repository, opportunities_repository, organizations_repository, quotes_repository
from app.modules.tasks.models import Task
from app.modules.tasks.repositories import tasks_repository
from app.modules.user_management.models import Team, User


MAX_REPORT_BUCKETS = 50
SAVED_REPORT_VIEW_MODES = {"table", "bar", "pie"}
CRM_MODULE_KEYS = {"sales_leads", "sales_contacts", "sales_organizations", "sales_opportunities", "sales_quotes", "tasks"}
FORECAST_STAGE_PROBABILITIES = {
    "lead": Decimal("10"),
    "qualified": Decimal("25"),
    "proposal": Decimal("50"),
    "negotiation": Decimal("75"),
    "closed_won": Decimal("100"),
    "closed_lost": Decimal("0"),
    "unstaged": Decimal("10"),
}
FORECAST_COMMIT_THRESHOLD = Decimal("75")
FORECAST_BEST_CASE_THRESHOLD = Decimal("50")


@dataclass(frozen=True)
class ReportField:
    key: str
    label: str
    field_type: str
    expression: Any


@dataclass(frozen=True)
class ReportAdapter:
    module_key: str
    label: str
    build_query: Callable[[Session, Any, str | None, list[dict], list[dict]], Any]
    fields: Callable[[Session, int], list[ReportField]]


def _as_field_payload(field: ReportField) -> dict[str, str]:
    return {"key": field.key, "label": field.label, "field_type": field.field_type}


def _normalize_limit(limit: int | None) -> int:
    if limit is None:
        return 12
    return max(1, min(int(limit), MAX_REPORT_BUCKETS))


def _normalize_metric(metric: str | None) -> str:
    normalized = (metric or "count").strip().lower()
    if normalized not in {"count", "sum"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported report metric")
    return normalized


def _serialize_bucket_key(value: Any) -> str:
    if value is None:
        return "__empty__"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (datetime, date)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    return str(value).strip() or "__empty__"


def _serialize_bucket_label(value: Any) -> str:
    key = _serialize_bucket_key(value)
    if key == "__empty__":
        return "No value"
    if key == "true":
        return "Yes"
    if key == "false":
        return "No"
    return key


def _as_float(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def _has_module_view_access(db: Session, current_user, module_key: str) -> bool:
    try:
        require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        return True
    except (PermissionError, ValueError):
        return False


def _bucket_rows(rows) -> list[dict[str, Any]]:
    return [
        {
            "key": _serialize_bucket_key(row.key),
            "label": _serialize_bucket_label(row.key),
            "count": int(row.count or 0),
            "value": _as_float(getattr(row, "value", row.count) or 0),
        }
        for row in rows
    ]


def _parse_decimalish(value: Any) -> Decimal:
    if value is None:
        return Decimal("0")
    cleaned = str(value).strip().replace(",", "")
    if not cleaned:
        return Decimal("0")
    try:
        return Decimal(cleaned)
    except Exception:
        return Decimal("0")


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"))


def _normalize_forecast_stage(stage: str | None) -> str:
    normalized = (stage or "").strip().lower().replace(" ", "_")
    return normalized or "unstaged"


def _stage_label(stage: str | None) -> str:
    labels = {
        "lead": "Lead",
        "qualified": "Qualified",
        "proposal": "Proposal",
        "negotiation": "Negotiation",
        "closed_won": "Closed Won",
        "closed_lost": "Closed Lost",
        "unstaged": "Unstaged",
    }
    normalized = _normalize_forecast_stage(stage)
    return labels.get(normalized, normalized.replace("_", " ").title())


def _forecast_probability(opportunity: SalesOpportunity) -> Decimal:
    explicit = getattr(opportunity, "probability_percent", None)
    if explicit is not None:
        return max(Decimal("0"), min(Decimal(str(explicit)), Decimal("100")))
    return FORECAST_STAGE_PROBABILITIES.get(_normalize_forecast_stage(opportunity.sales_stage), FORECAST_STAGE_PROBABILITIES["unstaged"])


def _empty_forecast_bucket(key: str, label: str) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "count": 0,
        "gross_pipeline_amount": Decimal("0"),
        "weighted_pipeline_amount": Decimal("0"),
        "commit_amount": Decimal("0"),
        "best_case_amount": Decimal("0"),
        "actual_revenue_amount": Decimal("0"),
    }


def _add_forecast_bucket_amount(bucket: dict[str, Any], *, amount: Decimal, probability: Decimal, stage_key: str) -> None:
    bucket["count"] += 1
    if stage_key == "closed_won":
        bucket["actual_revenue_amount"] += amount
        return
    if stage_key == "closed_lost":
        return
    weighted_amount = amount * (probability / Decimal("100"))
    bucket["gross_pipeline_amount"] += amount
    bucket["weighted_pipeline_amount"] += weighted_amount
    if probability >= FORECAST_COMMIT_THRESHOLD:
        bucket["commit_amount"] += amount
    if probability >= FORECAST_BEST_CASE_THRESHOLD:
        bucket["best_case_amount"] += amount


def _finalize_forecast_bucket(bucket: dict[str, Any]) -> dict[str, Any]:
    return {
        **bucket,
        "gross_pipeline_amount": _money(bucket["gross_pipeline_amount"]),
        "weighted_pipeline_amount": _money(bucket["weighted_pipeline_amount"]),
        "commit_amount": _money(bucket["commit_amount"]),
        "best_case_amount": _money(bucket["best_case_amount"]),
        "actual_revenue_amount": _money(bucket["actual_revenue_amount"]),
    }


def _forecast_json(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(_money(value))
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, list):
        return [_forecast_json(item) for item in value]
    if isinstance(value, dict):
        return {key: _forecast_json(item) for key, item in value.items()}
    return value


def _user_labels(db: Session, *, tenant_id: int, user_ids: set[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    users = db.query(User).filter(User.tenant_id == tenant_id, User.id.in_(user_ids)).all()
    labels: dict[int, str] = {}
    for user in users:
        full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
        labels[user.id] = full_name or user.email or f"User {user.id}"
    return labels


def _team_labels(db: Session, *, tenant_id: int, team_ids: set[int]) -> dict[int, str]:
    if not team_ids:
        return {}
    teams = db.query(Team).filter(Team.tenant_id == tenant_id, Team.id.in_(team_ids)).all()
    return {team.id: team.name or f"Team {team.id}" for team in teams}


def _enabled_fields(db: Session, *, tenant_id: int, module_key: str, fields: list[ReportField]) -> list[ReportField]:
    states = module_field_enabled_map(db, tenant_id=tenant_id, module_key=module_key)
    return [field for field in fields if states.get(field.key, True)]


def _custom_field_report_fields(db: Session, *, tenant_id: int, module_key: str, record_id_expression) -> list[ReportField]:
    fields: list[ReportField] = []
    definitions = list_custom_field_definitions(db, tenant_id=tenant_id, module_key=module_key, include_inactive=False)
    for definition in definitions:
        key = f"{CUSTOM_FIELD_FILTER_PREFIX}{definition.field_key}"
        if definition.field_type in {"text", "long_text"}:
            value_column = CustomFieldValue.value_text
            field_type = "text"
        elif definition.field_type == "number":
            value_column = cast(cast(CustomFieldValue.value_number, String), Numeric(18, 6))
            field_type = "number"
        elif definition.field_type == "date":
            value_column = cast(CustomFieldValue.value_date, Date)
            field_type = "date"
        elif definition.field_type == "boolean":
            value_column = CustomFieldValue.value_boolean
            field_type = "boolean"
        else:
            continue
        expression = (
            select(value_column)
            .where(
                CustomFieldValue.module_key == module_key,
                CustomFieldValue.tenant_id == tenant_id,
                CustomFieldValue.record_id == record_id_expression,
                CustomFieldValue.field_definition_id == definition.id,
            )
            .limit(1)
            .scalar_subquery()
        )
        fields.append(ReportField(key=key, label=definition.label, field_type=field_type, expression=expression))
    return fields


def _lead_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="sales_leads", fields=[
        ReportField("status", "Status", "select", SalesLead.status),
        ReportField("assigned_to", "Owner", "text", cast(SalesLead.assigned_to, String)),
        ReportField("source", "Source", "text", SalesLead.source),
        ReportField("company", "Company", "text", SalesLead.company),
        ReportField("title", "Job Title", "text", SalesLead.title),
        ReportField("created_time", "Created Date", "date", cast(SalesLead.created_time, Date)),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_leads", record_id_expression=SalesLead.lead_id),
    ])


def _contact_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="sales_contacts", fields=[
        ReportField("assigned_to", "Owner", "text", cast(SalesContact.assigned_to, String)),
        ReportField("organization_name", "Account", "text", SalesOrganization.org_name),
        ReportField("current_title", "Job Title", "text", SalesContact.current_title),
        ReportField("region", "Region", "text", SalesContact.region),
        ReportField("country", "Country", "text", SalesContact.country),
        ReportField("created_time", "Created Date", "date", cast(SalesContact.created_time, Date)),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_contacts", record_id_expression=SalesContact.contact_id),
    ])


def _organization_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="sales_organizations", fields=[
        ReportField("assigned_to", "Owner", "text", cast(SalesOrganization.assigned_to, String)),
        ReportField("industry", "Industry", "text", SalesOrganization.industry),
        ReportField("billing_country", "Country", "text", SalesOrganization.billing_country),
        ReportField("created_time", "Created Date", "date", cast(SalesOrganization.created_time, Date)),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_organizations", record_id_expression=SalesOrganization.org_id),
    ])


def _opportunity_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="sales_opportunities", fields=[
        ReportField("sales_stage", "Stage", "select", SalesOpportunity.sales_stage),
        ReportField("assigned_to", "Owner", "text", cast(SalesOpportunity.assigned_to, String)),
        ReportField("client", "Client", "text", SalesOpportunity.client),
        ReportField("currency_type", "Currency", "text", SalesOpportunity.currency_type),
        ReportField("target_geography", "Target Geography", "text", SalesOpportunity.target_geography),
        ReportField("expected_close_date", "Expected Close", "date", SalesOpportunity.expected_close_date),
        ReportField("created_time", "Created Date", "date", cast(SalesOpportunity.created_time, Date)),
        ReportField("probability_percent", "Probability", "number", SalesOpportunity.probability_percent),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_opportunities", record_id_expression=SalesOpportunity.opportunity_id),
    ])


def _quote_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="sales_quotes", fields=[
        ReportField("status", "Status", "select", SalesQuote.status),
        ReportField("assigned_to", "Owner", "text", cast(SalesQuote.assigned_to, String)),
        ReportField("customer_name", "Customer", "text", SalesQuote.customer_name),
        ReportField("currency", "Currency", "text", SalesQuote.currency),
        ReportField("issue_date", "Issue Date", "date", SalesQuote.issue_date),
        ReportField("expiry_date", "Expiry Date", "date", SalesQuote.expiry_date),
        ReportField("created_time", "Created Date", "date", cast(SalesQuote.created_time, Date)),
        ReportField("total_amount", "Total Amount", "number", SalesQuote.total_amount),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_quotes", record_id_expression=SalesQuote.quote_id),
    ])


def _task_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="tasks", fields=[
        ReportField("status", "Status", "select", Task.status),
        ReportField("priority", "Priority", "select", Task.priority),
        ReportField("source_module_key", "Source Module", "text", Task.source_module_key),
        ReportField("due_at", "Due Date", "date", cast(Task.due_at, Date)),
        ReportField("created_at", "Created Date", "date", cast(Task.created_at, Date)),
    ])


def _finance_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="finance_io", fields=[
        ReportField("status", "Status", "select", FinanceIO.status),
        ReportField("currency", "Currency", "text", FinanceIO.currency),
        ReportField("customer_name", "Customer", "text", FinanceIO.customer_name),
        ReportField("issue_date", "Issue Date", "date", FinanceIO.issue_date),
        ReportField("due_date", "Due Date", "date", FinanceIO.due_date),
        ReportField("updated_at", "Updated Date", "date", cast(FinanceIO.updated_at, Date)),
        ReportField("total_amount", "Total Amount", "number", FinanceIO.total_amount),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="finance_io", record_id_expression=FinanceIO.id),
    ])


def _build_finance_query(db: Session, current_user, search: str | None, all_conditions: list[dict], any_conditions: list[dict]):
    scope = get_finance_user_scope(db, current_user)
    return io_repository.build_insertion_orders_query(
        db,
        tenant_id=current_user.tenant_id,
        module_id=get_finance_module_id(db),
        user_id=scope.user_id_filter,
        search=search,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )


BUILT_IN_ADAPTERS: dict[str, ReportAdapter] = {
    "tasks": ReportAdapter("tasks", "Tasks", lambda db, user, search, all_c, any_c: tasks_repository.build_task_query(db, tenant_id=user.tenant_id, current_user=user, search=search, all_filter_conditions=all_c, any_filter_conditions=any_c), _task_fields),
    "sales_leads": ReportAdapter("sales_leads", "Leads", lambda db, user, search, all_c, any_c: leads_repository.build_leads_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=all_c, any_filter_conditions=any_c), _lead_fields),
    "sales_contacts": ReportAdapter("sales_contacts", "Contacts", lambda db, user, search, all_c, any_c: contacts_repository.build_contacts_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=all_c, any_filter_conditions=any_c), _contact_fields),
    "sales_organizations": ReportAdapter("sales_organizations", "Accounts", lambda db, user, search, all_c, any_c: organizations_repository.build_organization_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=all_c, any_filter_conditions=any_c), _organization_fields),
    "sales_opportunities": ReportAdapter("sales_opportunities", "Deals", lambda db, user, search, all_c, any_c: opportunities_repository.build_opportunity_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=all_c, any_filter_conditions=any_c), _opportunity_fields),
    "sales_quotes": ReportAdapter("sales_quotes", "Quotes", lambda db, user, search, all_c, any_c: quotes_repository.build_quotes_query(db, tenant_id=user.tenant_id, search=search, all_filter_conditions=all_c, any_filter_conditions=any_c), _quote_fields),
    "finance_io": ReportAdapter("finance_io", "Insertion Orders", _build_finance_query, _finance_fields),
}


def _dimension_fields(fields: list[ReportField]) -> list[ReportField]:
    return [field for field in fields if field.field_type in {"text", "select", "date", "boolean"}]


def _metric_fields(fields: list[ReportField]) -> list[ReportField]:
    return [field for field in fields if field.field_type == "number"]


def _custom_module_field_expression(field, definition: CustomModuleDefinition):
    if field.field_type == "single_select":
        value_column = CustomModuleRecordValue.text_value
        field_type = "select"
    elif field.field_type in custom_modules.TEXT_TYPES:
        value_column = CustomModuleRecordValue.text_value
        field_type = "text"
    elif field.field_type in custom_modules.NUMBER_TYPES:
        value_column = CustomModuleRecordValue.number_value
        field_type = "number"
    elif field.field_type in custom_modules.DATE_TYPES:
        value_column = cast(CustomModuleRecordValue.datetime_value, Date)
        field_type = "date"
    elif field.field_type == "boolean":
        value_column = CustomModuleRecordValue.boolean_value
        field_type = "boolean"
    else:
        return None
    expression = (
        select(value_column)
        .where(
            CustomModuleRecordValue.tenant_id == definition.tenant_id,
            CustomModuleRecordValue.custom_module_id == definition.id,
            CustomModuleRecordValue.record_id == CustomModuleRecord.id,
            CustomModuleRecordValue.field_id == field.id,
        )
        .limit(1)
        .scalar_subquery()
    )
    return ReportField(field.key, field.label, field_type, expression)


def _custom_report_context(db: Session, current_user, module_key: str):
    definition = custom_modules._get_module_definition(db, tenant_id=current_user.tenant_id, key=module_key)
    custom_modules._require_module_action(db, user=current_user, definition=definition, action="view")
    fields = [
        ReportField("title", "Title", "text", CustomModuleRecord.title),
        ReportField("created_at", "Created Date", "date", cast(CustomModuleRecord.created_at, Date)),
        ReportField("updated_at", "Updated Date", "date", cast(CustomModuleRecord.updated_at, Date)),
    ]
    for field in sorted((item for item in definition.fields if item.deleted_at is None and item.is_active), key=lambda item: (item.sort_order, item.id)):
        report_field = _custom_module_field_expression(field, definition)
        if report_field:
            fields.append(report_field)
    fields = _enabled_fields(db, tenant_id=current_user.tenant_id, module_key=module_key, fields=fields)
    return definition, fields


def _build_custom_query(db: Session, *, current_user, definition: CustomModuleDefinition, search: str | None, all_conditions: list[dict], any_conditions: list[dict], fields: list[ReportField]):
    query = db.query(CustomModuleRecord).filter(
        CustomModuleRecord.tenant_id == current_user.tenant_id,
        CustomModuleRecord.custom_module_id == definition.id,
        CustomModuleRecord.deleted_at.is_(None),
    )
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = (
            query.outerjoin(CustomModuleRecordValue, CustomModuleRecordValue.record_id == CustomModuleRecord.id)
            .filter((CustomModuleRecord.title.ilike(pattern)) | (CustomModuleRecordValue.text_value.ilike(pattern)))
            .distinct()
        )
    field_map = {field.key: {"expression": field.expression, "type": "boolean" if field.field_type == "boolean" else "number" if field.field_type == "number" else "date" if field.field_type == "date" else "text"} for field in fields}
    query = apply_filter_conditions(query, conditions=all_conditions, logic="all", field_map=field_map)
    return apply_filter_conditions(query, conditions=any_conditions, logic="any", field_map=field_map)


def _module_payload(module_key: str, label: str, fields: list[ReportField]) -> dict[str, Any]:
    dimensions = _dimension_fields(fields)
    return {
        "module_key": module_key,
        "label": label,
        "dimensions": [_as_field_payload(field) for field in dimensions],
        "metrics": [_as_field_payload(field) for field in _metric_fields(fields)],
        "filter_fields": [_as_field_payload(field) for field in fields],
        "default_dimension": dimensions[0].key if dimensions else None,
    }


def _get_report_fields_for_module(db: Session, current_user, module_key: str) -> tuple[str, list[ReportField]]:
    adapter = BUILT_IN_ADAPTERS.get(module_key)
    if adapter:
        try:
            require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        return adapter.label, adapter.fields(db, current_user.tenant_id)

    definition, fields = _custom_report_context(db, current_user, module_key)
    return definition.name, fields


def validate_report_config(db: Session, current_user, *, module_key: str, config: dict[str, Any]) -> dict[str, Any]:
    _label, fields = _get_report_fields_for_module(db, current_user, module_key)
    dimension_fields = {field.key: field for field in _dimension_fields(fields)}
    metric_fields = {field.key: field for field in _metric_fields(fields)}
    if not dimension_fields:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This module does not have report dimensions")

    dimension = str(config.get("dimension") or "").strip()
    if dimension not in dimension_fields:
        dimension = next(iter(dimension_fields.values())).key

    metric = _normalize_metric(str(config.get("metric") or "count"))
    metric_field = str(config.get("metric_field") or "").strip()
    if metric == "sum":
        if metric_field not in metric_fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select a numeric field for sum reports")
    else:
        metric_field = ""

    filters = config.get("filters") if isinstance(config.get("filters"), dict) else {}
    all_conditions = filters.get("all_conditions") if isinstance(filters.get("all_conditions"), list) else []
    any_conditions = filters.get("any_conditions") if isinstance(filters.get("any_conditions"), list) else []
    sanitized_filters = {
        "search": str(filters.get("search") or ""),
        "logic": "all",
        "conditions": [],
        "all_conditions": sanitize_disabled_filter_conditions(
            db,
            tenant_id=current_user.tenant_id,
            module_key=module_key,
            conditions=all_conditions,
        ),
        "any_conditions": sanitize_disabled_filter_conditions(
            db,
            tenant_id=current_user.tenant_id,
            module_key=module_key,
            conditions=any_conditions,
        ),
    }
    view_mode = str(config.get("view_mode") or "bar").strip().lower()
    if view_mode not in SAVED_REPORT_VIEW_MODES:
        view_mode = "bar"

    return {
        "dimension": dimension,
        "metric": metric,
        "metric_field": metric_field,
        "filters": sanitized_filters,
        "view_mode": view_mode,
    }


def _serialize_saved_report(report: UserModuleReport) -> dict[str, Any]:
    return {
        "id": report.id,
        "module_key": report.module_key,
        "name": report.name,
        "config": report.config or {},
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }


def list_saved_reports(db: Session, current_user, *, module_key: str | None = None) -> list[dict[str, Any]]:
    query = db.query(UserModuleReport).filter(
        UserModuleReport.tenant_id == current_user.tenant_id,
        UserModuleReport.user_id == current_user.id,
    )
    if module_key:
        _get_report_fields_for_module(db, current_user, module_key)
        query = query.filter(UserModuleReport.module_key == module_key)
    reports = query.order_by(UserModuleReport.updated_at.desc(), UserModuleReport.id.desc()).all()
    return [_serialize_saved_report(report) for report in reports]


def create_saved_report(db: Session, current_user, *, module_key: str, name: str, config: dict[str, Any]) -> dict[str, Any]:
    normalized_module_key = module_key.strip()
    normalized_name = name.strip()
    if not normalized_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Report name is required")
    normalized_config = validate_report_config(db, current_user, module_key=normalized_module_key, config=config)
    report = UserModuleReport(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        module_key=normalized_module_key,
        name=normalized_name,
        config=normalized_config,
    )
    db.add(report)
    try:
        db.commit()
        db.refresh(report)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A saved report with this name already exists") from exc
    return _serialize_saved_report(report)


def _get_saved_report_or_404(db: Session, current_user, report_id: int) -> UserModuleReport:
    report = (
        db.query(UserModuleReport)
        .filter(
            UserModuleReport.id == report_id,
            UserModuleReport.tenant_id == current_user.tenant_id,
            UserModuleReport.user_id == current_user.id,
        )
        .first()
    )
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved report not found")
    return report


def update_saved_report(db: Session, current_user, *, report_id: int, name: str | None = None, config: dict[str, Any] | None = None) -> dict[str, Any]:
    report = _get_saved_report_or_404(db, current_user, report_id)
    if name is not None:
        normalized_name = name.strip()
        if not normalized_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Report name is required")
        report.name = normalized_name
    if config is not None:
        report.config = validate_report_config(db, current_user, module_key=report.module_key, config=config)
    db.add(report)
    try:
        db.commit()
        db.refresh(report)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A saved report with this name already exists") from exc
    return _serialize_saved_report(report)


def delete_saved_report(db: Session, current_user, *, report_id: int) -> None:
    report = _get_saved_report_or_404(db, current_user, report_id)
    db.delete(report)
    db.commit()


def list_report_modules(db: Session, current_user) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for module_key, adapter in BUILT_IN_ADAPTERS.items():
        try:
            require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        except (PermissionError, ValueError):
            continue
        fields = adapter.fields(db, current_user.tenant_id)
        if _dimension_fields(fields):
            results.append(_module_payload(module_key, adapter.label, fields))

    custom_definitions = (
        db.query(CustomModuleDefinition)
        .filter(
            CustomModuleDefinition.tenant_id == current_user.tenant_id,
            CustomModuleDefinition.is_active.is_(True),
            CustomModuleDefinition.deleted_at.is_(None),
        )
        .order_by(CustomModuleDefinition.name.asc())
        .all()
    )
    for definition in custom_definitions:
        try:
            _, fields = _custom_report_context(db, current_user, definition.key)
        except HTTPException:
            continue
        if _dimension_fields(fields):
            results.append(_module_payload(definition.key, definition.name, fields))
    return results


def generate_module_report(
    db: Session,
    current_user,
    *,
    module_key: str,
    dimension_key: str | None,
    metric: str | None,
    metric_field_key: str | None,
    search: str | None,
    all_conditions: list[dict],
    any_conditions: list[dict],
    limit: int | None,
) -> dict[str, Any]:
    normalized_metric = _normalize_metric(metric)
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=module_key, conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key=module_key, conditions=any_conditions)

    adapter = BUILT_IN_ADAPTERS.get(module_key)
    if adapter:
        try:
            require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        except PermissionError as exc:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
        fields = adapter.fields(db, current_user.tenant_id)
        query = adapter.build_query(db, current_user, search, all_conditions, any_conditions)
        label = adapter.label
    else:
        definition, fields = _custom_report_context(db, current_user, module_key)
        query = _build_custom_query(db, current_user=current_user, definition=definition, search=search, all_conditions=all_conditions, any_conditions=any_conditions, fields=fields)
        label = definition.name

    dimensions = {field.key: field for field in _dimension_fields(fields)}
    if not dimensions:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This module does not have report dimensions")
    dimension = dimensions.get(dimension_key or "") or next(iter(dimensions.values()))

    metrics = {field.key: field for field in _metric_fields(fields)}
    metric_field = None
    if normalized_metric == "sum":
        metric_field = metrics.get(metric_field_key or "")
        if not metric_field:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select a numeric field for sum reports")

    total_count = query.order_by(None).count()
    count_expr = func.count().label("count")
    value_expr = func.count().label("value") if normalized_metric == "count" else func.coalesce(func.sum(metric_field.expression), 0).label("value")
    rows = (
        query.order_by(None)
        .with_entities(dimension.expression.label("dimension"), count_expr, value_expr)
        .group_by(dimension.expression)
        .order_by(value_expr.desc(), count_expr.desc())
        .limit(_normalize_limit(limit))
        .all()
    )

    return {
        "module_key": module_key,
        "label": label,
        "dimension": _as_field_payload(dimension),
        "metric": normalized_metric,
        "metric_field": _as_field_payload(metric_field) if metric_field else None,
        "total_count": int(total_count or 0),
        "rows": [
            {
                "key": _serialize_bucket_key(row.dimension),
                "label": _serialize_bucket_label(row.dimension),
                "count": int(row.count or 0),
                "value": _as_float(row.value),
            }
            for row in rows
        ],
    }


def module_report_csv_bytes(report: dict[str, Any]) -> bytes:
    output = StringIO()
    writer = csv.writer(output)
    dimension_label = report["dimension"]["label"]
    metric_label = report["metric_field"]["label"] if report.get("metric_field") else "Records"
    writer.writerow([dimension_label, "Records", metric_label])
    for row in report.get("rows", []):
        writer.writerow([row.get("label", ""), row.get("count", 0), row.get("value", 0)])
    return output.getvalue().encode("utf-8")


def generate_forecast_summary(
    db: Session,
    current_user,
    *,
    period_start: date,
    period_end: date,
    owner_id: int | None = None,
    team_id: int | None = None,
    pipeline_key: str | None = None,
) -> dict[str, Any]:
    if period_end < period_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="period_end must be on or after period_start")

    query = (
        db.query(SalesOpportunity)
        .outerjoin(User, SalesOpportunity.assigned_to == User.id)
        .filter(
            SalesOpportunity.tenant_id == current_user.tenant_id,
            SalesOpportunity.deleted_at.is_(None),
            SalesOpportunity.expected_close_date.is_not(None),
            SalesOpportunity.expected_close_date >= period_start,
            SalesOpportunity.expected_close_date <= period_end,
        )
    )
    if owner_id is not None:
        query = query.filter(SalesOpportunity.assigned_to == owner_id)
    if team_id is not None:
        query = query.filter(User.team_id == team_id)

    opportunities = query.order_by(SalesOpportunity.expected_close_date.asc(), SalesOpportunity.opportunity_id.asc()).all()
    stage_buckets: dict[str, dict[str, Any]] = {}
    owner_buckets: dict[str, dict[str, Any]] = {}
    team_buckets: dict[str, dict[str, Any]] = {}
    owner_ids: set[int] = set()
    team_ids: set[int] = set()
    totals = _empty_forecast_bucket("total", "Total")
    open_count = 0
    won_count = 0

    for opportunity in opportunities:
        stage_key = _normalize_forecast_stage(opportunity.sales_stage)
        amount = _parse_decimalish(opportunity.total_cost_of_project)
        probability = _forecast_probability(opportunity)
        if stage_key not in {"closed_won", "closed_lost"}:
            open_count += 1
        if stage_key == "closed_won":
            won_count += 1

        stage_bucket = stage_buckets.setdefault(stage_key, _empty_forecast_bucket(stage_key, _stage_label(stage_key)))
        _add_forecast_bucket_amount(stage_bucket, amount=amount, probability=probability, stage_key=stage_key)

        owner_key = str(opportunity.assigned_to) if opportunity.assigned_to is not None else "__unassigned__"
        if opportunity.assigned_to is not None:
            owner_ids.add(opportunity.assigned_to)
        owner_bucket = owner_buckets.setdefault(owner_key, _empty_forecast_bucket(owner_key, "Unassigned"))
        _add_forecast_bucket_amount(owner_bucket, amount=amount, probability=probability, stage_key=stage_key)

        assigned_user = getattr(opportunity, "assigned_user", None)
        user_team_id = getattr(assigned_user, "team_id", None)
        team_key = str(user_team_id) if user_team_id is not None else "__unassigned__"
        if user_team_id is not None:
            team_ids.add(user_team_id)
        team_bucket = team_buckets.setdefault(team_key, _empty_forecast_bucket(team_key, "Unassigned"))
        _add_forecast_bucket_amount(team_bucket, amount=amount, probability=probability, stage_key=stage_key)

        _add_forecast_bucket_amount(totals, amount=amount, probability=probability, stage_key=stage_key)

    owner_labels = _user_labels(db, tenant_id=current_user.tenant_id, user_ids=owner_ids)
    for key, bucket in owner_buckets.items():
        if key != "__unassigned__":
            bucket["label"] = owner_labels.get(int(key), f"User {key}")
    team_labels = _team_labels(db, tenant_id=current_user.tenant_id, team_ids=team_ids)
    for key, bucket in team_buckets.items():
        if key != "__unassigned__":
            bucket["label"] = team_labels.get(int(key), f"Team {key}")

    def bucket_sort(item: dict[str, Any]) -> tuple[Decimal, Decimal, int]:
        return (item["weighted_pipeline_amount"], item["actual_revenue_amount"], item["count"])

    finalized_totals = _finalize_forecast_bucket(totals)
    return {
        "period_start": period_start,
        "period_end": period_end,
        "owner_id": owner_id,
        "team_id": team_id,
        "pipeline_key": pipeline_key,
        "gross_pipeline_amount": finalized_totals["gross_pipeline_amount"],
        "weighted_pipeline_amount": finalized_totals["weighted_pipeline_amount"],
        "commit_amount": finalized_totals["commit_amount"],
        "best_case_amount": finalized_totals["best_case_amount"],
        "actual_revenue_amount": finalized_totals["actual_revenue_amount"],
        "open_opportunity_count": open_count,
        "won_opportunity_count": won_count,
        "by_stage": [_finalize_forecast_bucket(bucket) for bucket in sorted(stage_buckets.values(), key=bucket_sort, reverse=True)],
        "by_owner": [_finalize_forecast_bucket(bucket) for bucket in sorted(owner_buckets.values(), key=bucket_sort, reverse=True)],
        "by_team": [_finalize_forecast_bucket(bucket) for bucket in sorted(team_buckets.values(), key=bucket_sort, reverse=True)],
        "generated_at": datetime.now(timezone.utc),
    }


def create_forecast_snapshot(
    db: Session,
    current_user,
    *,
    period_start: date,
    period_end: date,
    owner_id: int | None = None,
    team_id: int | None = None,
    pipeline_key: str | None = None,
) -> ForecastSnapshot:
    summary = generate_forecast_summary(
        db,
        current_user,
        period_start=period_start,
        period_end=period_end,
        owner_id=owner_id,
        team_id=team_id,
        pipeline_key=pipeline_key,
    )
    snapshot = ForecastSnapshot(
        tenant_id=current_user.tenant_id,
        period_start=period_start,
        period_end=period_end,
        owner_id=owner_id,
        team_id=team_id,
        pipeline_key=pipeline_key,
        gross_pipeline_amount=summary["gross_pipeline_amount"],
        weighted_pipeline_amount=summary["weighted_pipeline_amount"],
        commit_amount=summary["commit_amount"],
        best_case_amount=summary["best_case_amount"],
        snapshot_json=_forecast_json(summary),
    )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def generate_crm_dashboard_summary(db: Session, current_user, *, period_days: int = 30) -> dict[str, Any]:
    tenant_id = current_user.tenant_id
    now = datetime.now(timezone.utc)
    period_days = max(1, min(int(period_days or 30), 365))
    period_start = now - timedelta(days=period_days)
    upcoming_end = now + timedelta(days=7)

    has_leads = _has_module_view_access(db, current_user, "sales_leads")
    has_deals = _has_module_view_access(db, current_user, "sales_opportunities")
    has_quotes = _has_module_view_access(db, current_user, "sales_quotes")
    has_tasks = _has_module_view_access(db, current_user, "tasks")

    lead_status_rows: list[dict[str, Any]] = []
    lead_source_rows: list[dict[str, Any]] = []
    new_leads_count = 0
    if has_leads:
        lead_base = db.query(SalesLead).filter(SalesLead.tenant_id == tenant_id, SalesLead.deleted_at.is_(None))
        lead_status_rows = _bucket_rows(
            lead_base.order_by(None)
            .with_entities(SalesLead.status.label("key"), func.count().label("count"))
            .group_by(SalesLead.status)
            .order_by(func.count().desc())
            .all()
        )
        lead_source_rows = _bucket_rows(
            lead_base.order_by(None)
            .with_entities(SalesLead.source.label("key"), func.count().label("count"))
            .group_by(SalesLead.source)
            .order_by(func.count().desc())
            .limit(8)
            .all()
        )
        new_leads_count = lead_base.filter(SalesLead.created_time >= period_start).count()

    deal_stage_rows: list[dict[str, Any]] = []
    pipeline_value = Decimal("0")
    won_count = 0
    lost_count = 0
    if has_deals:
        deal_base = db.query(SalesOpportunity).filter(SalesOpportunity.tenant_id == tenant_id, SalesOpportunity.deleted_at.is_(None))
        stage_counts: dict[str, int] = {}
        stage_values: dict[str, Decimal] = {}
        for stage, value in deal_base.with_entities(SalesOpportunity.sales_stage, SalesOpportunity.total_cost_of_project).all():
            key = _serialize_bucket_key(stage)
            stage_counts[key] = stage_counts.get(key, 0) + 1
            numeric_value = _parse_decimalish(value)
            stage_values[key] = stage_values.get(key, Decimal("0")) + numeric_value
            if key not in {"closed_won", "closed_lost"}:
                pipeline_value += numeric_value
        deal_stage_rows = [
            {
                "key": key,
                "label": _serialize_bucket_label(key),
                "count": stage_counts[key],
                "value": float(stage_values.get(key, Decimal("0"))),
            }
            for key in sorted(stage_counts, key=lambda item: stage_values.get(item, Decimal("0")), reverse=True)
        ]
        won_count = stage_counts.get("closed_won", 0)
        lost_count = stage_counts.get("closed_lost", 0)
    forecast_summary = None
    if has_deals:
        forecast_start = now.date()
        forecast_end = forecast_start + timedelta(days=period_days)
        forecast_summary = generate_forecast_summary(
            db,
            current_user,
            period_start=forecast_start,
            period_end=forecast_end,
        )

    quote_status_rows: list[dict[str, Any]] = []
    if has_quotes:
        quote_base = db.query(SalesQuote).filter(SalesQuote.tenant_id == tenant_id, SalesQuote.deleted_at.is_(None))
        quote_status_rows = _bucket_rows(
            quote_base.order_by(None)
            .with_entities(SalesQuote.status.label("key"), func.count().label("count"), func.coalesce(func.sum(SalesQuote.total_amount), 0).label("value"))
            .group_by(SalesQuote.status)
            .order_by(func.count().desc())
            .all()
        )

    overdue_follow_ups = 0
    upcoming_tasks = 0
    if has_tasks:
        task_base = tasks_repository.build_task_query(db, tenant_id=tenant_id, current_user=current_user)
        task_base = task_base.filter(Task.source_module_key.in_(CRM_MODULE_KEYS), Task.status != "completed")
        overdue_follow_ups = task_base.filter(Task.due_at.is_not(None), Task.due_at < now).count()
        upcoming_tasks = task_base.filter(Task.due_at.is_not(None), Task.due_at >= now, Task.due_at <= upcoming_end).count()

    owner_totals: dict[int | None, dict[str, Any]] = {}

    def owner_bucket(owner_id: int | None) -> dict[str, Any]:
        if owner_id not in owner_totals:
            owner_totals[owner_id] = {
                "owner_id": owner_id,
                "owner_name": "Unassigned",
                "lead_count": 0,
                "deal_count": 0,
                "won_deal_count": 0,
                "quote_count": 0,
            }
        return owner_totals[owner_id]

    if has_leads:
        rows = (
            db.query(SalesLead.assigned_to.label("owner_id"), func.count().label("count"))
            .filter(SalesLead.tenant_id == tenant_id, SalesLead.deleted_at.is_(None))
            .group_by(SalesLead.assigned_to)
            .all()
        )
        for row in rows:
            owner_bucket(row.owner_id)["lead_count"] = int(row.count or 0)
    if has_deals:
        rows = (
            db.query(
                SalesOpportunity.assigned_to.label("owner_id"),
                func.count().label("count"),
                func.sum(case((SalesOpportunity.sales_stage == "closed_won", 1), else_=0)).label("won_count"),
            )
            .filter(SalesOpportunity.tenant_id == tenant_id, SalesOpportunity.deleted_at.is_(None))
            .group_by(SalesOpportunity.assigned_to)
            .all()
        )
        for row in rows:
            bucket = owner_bucket(row.owner_id)
            bucket["deal_count"] = int(row.count or 0)
            bucket["won_deal_count"] = int(row.won_count or 0)
    if has_quotes:
        rows = (
            db.query(SalesQuote.assigned_to.label("owner_id"), func.count().label("count"))
            .filter(SalesQuote.tenant_id == tenant_id, SalesQuote.deleted_at.is_(None))
            .group_by(SalesQuote.assigned_to)
            .all()
        )
        for row in rows:
            owner_bucket(row.owner_id)["quote_count"] = int(row.count or 0)

    labels = _user_labels(db, tenant_id=tenant_id, user_ids={owner_id for owner_id in owner_totals if owner_id is not None})
    owner_rows = []
    for owner_id, item in owner_totals.items():
        item["owner_name"] = labels.get(owner_id, "Unassigned") if owner_id is not None else "Unassigned"
        item["total_activity"] = item["lead_count"] + item["deal_count"] + item["quote_count"]
        owner_rows.append(item)
    owner_rows.sort(key=lambda item: (item["total_activity"], item["won_deal_count"]), reverse=True)

    return {
        "period_days": period_days,
        "generated_at": now,
        "modules": {
            "sales_leads": has_leads,
            "sales_opportunities": has_deals,
            "sales_quotes": has_quotes,
            "tasks": has_tasks,
        },
        "lead_status": lead_status_rows,
        "lead_sources": lead_source_rows,
        "new_leads": new_leads_count,
        "deal_stages": deal_stage_rows,
        "pipeline_value": float(pipeline_value),
        "forecast_summary": forecast_summary,
        "won_deals": won_count,
        "lost_deals": lost_count,
        "quote_status": quote_status_rows,
        "overdue_follow_ups": overdue_follow_ups,
        "upcoming_tasks": upcoming_tasks,
        "owner_performance": owner_rows[:8],
    }
