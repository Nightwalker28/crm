from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable

from fastapi import HTTPException, status
from sqlalchemy import Date, Numeric, String, cast, func, select
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope, require_role_module_action_access
from app.core.module_filters import apply_filter_conditions
from app.modules.finance.models import FinanceIO
from app.modules.finance.repositories import io_repository
from app.modules.finance.services.io_search_services import get_finance_module_id
from app.modules.platform.models import CustomFieldValue, CustomModuleDefinition, CustomModuleRecord, CustomModuleRecordValue
from app.modules.platform.services import custom_modules
from app.modules.platform.services.custom_fields import CUSTOM_FIELD_FILTER_PREFIX, list_custom_field_definitions
from app.modules.platform.services.module_fields import module_field_enabled_map, sanitize_disabled_filter_conditions
from app.modules.sales.models import SalesContact, SalesLead, SalesOpportunity, SalesOrganization
from app.modules.sales.repositories import contacts_repository, leads_repository, opportunities_repository, organizations_repository
from app.modules.tasks.models import Task
from app.modules.tasks.repositories import tasks_repository


MAX_REPORT_BUCKETS = 50


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
        ReportField("source", "Source", "text", SalesLead.source),
        ReportField("company", "Company", "text", SalesLead.company),
        ReportField("title", "Job Title", "text", SalesLead.title),
        ReportField("created_time", "Created Date", "date", cast(SalesLead.created_time, Date)),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_leads", record_id_expression=SalesLead.lead_id),
    ])


def _contact_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="sales_contacts", fields=[
        ReportField("organization_name", "Account", "text", SalesOrganization.org_name),
        ReportField("current_title", "Job Title", "text", SalesContact.current_title),
        ReportField("region", "Region", "text", SalesContact.region),
        ReportField("country", "Country", "text", SalesContact.country),
        ReportField("created_time", "Created Date", "date", cast(SalesContact.created_time, Date)),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_contacts", record_id_expression=SalesContact.contact_id),
    ])


def _organization_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="sales_organizations", fields=[
        ReportField("industry", "Industry", "text", SalesOrganization.industry),
        ReportField("billing_country", "Country", "text", SalesOrganization.billing_country),
        ReportField("created_time", "Created Date", "date", cast(SalesOrganization.created_time, Date)),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_organizations", record_id_expression=SalesOrganization.org_id),
    ])


def _opportunity_fields(db: Session, tenant_id: int) -> list[ReportField]:
    return _enabled_fields(db, tenant_id=tenant_id, module_key="sales_opportunities", fields=[
        ReportField("sales_stage", "Stage", "select", SalesOpportunity.sales_stage),
        ReportField("client", "Client", "text", SalesOpportunity.client),
        ReportField("currency_type", "Currency", "text", SalesOpportunity.currency_type),
        ReportField("target_geography", "Target Geography", "text", SalesOpportunity.target_geography),
        ReportField("expected_close_date", "Expected Close", "date", SalesOpportunity.expected_close_date),
        ReportField("created_time", "Created Date", "date", cast(SalesOpportunity.created_time, Date)),
        *_custom_field_report_fields(db, tenant_id=tenant_id, module_key="sales_opportunities", record_id_expression=SalesOpportunity.opportunity_id),
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
