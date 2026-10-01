from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import csv
from io import StringIO
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.access_control import require_role_module_action_access
from app.modules.platform.models import ForecastSnapshot, UserModuleReport
from app.modules.platform.services import report_catalog, report_engine
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.report_templates import REPORT_TEMPLATES
from app.modules.sales.models import SalesLead, SalesOpportunity, SalesQuote
from app.modules.sales.repositories import pipelines_repository
from app.modules.sales.services import pipelines_services
from app.modules.tasks.models import Task
from app.modules.tasks.repositories import tasks_repository
from app.modules.user_management.models import Team, User


MAX_REPORT_BUCKETS = 50
SAVED_REPORT_VISIBILITIES = {"private", "everyone"}
SAVED_REPORT_SORT_FIELDS = {
    "name": UserModuleReport.name,
    "module_key": UserModuleReport.module_key,
    "created_at": UserModuleReport.created_at,
    "updated_at": UserModuleReport.updated_at,
}
CRM_MODULE_KEYS = {"sales_leads", "sales_contacts", "sales_organizations", "sales_opportunities", "sales_quotes", "tasks"}
FORECAST_COMMIT_THRESHOLD = Decimal("75")
FORECAST_BEST_CASE_THRESHOLD = Decimal("50")


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


def _forecast_probability(opportunity: SalesOpportunity, facts: pipelines_services.OpportunityStageFacts) -> Decimal:
    explicit = getattr(opportunity, "probability_percent", None)
    if explicit is not None:
        return max(Decimal("0"), min(Decimal(str(explicit)), Decimal("100")))
    return facts.probability


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


def _add_forecast_bucket_amount(
    bucket: dict[str, Any],
    *,
    amount: Decimal,
    probability: Decimal,
    facts: pipelines_services.OpportunityStageFacts,
) -> None:
    bucket["count"] += 1
    if facts.is_won:
        bucket["actual_revenue_amount"] += amount
        return
    if facts.is_lost:
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


# ------------------------------------------------------------------- report catalogue


def list_report_modules(db: Session, current_user) -> list[dict[str, Any]]:
    return [
        report_catalog.source_payload(source, fields, db, current_user.tenant_id)
        for source, fields in report_catalog.list_sources(db, current_user)
    ]


def list_report_templates(db: Session, current_user) -> list[dict[str, Any]]:
    """Templates whose module the viewer can report on, with fields their tenant turned
    off dropped by the same normalization a saved report gets."""
    available = {source.module_key: (source, fields) for source, fields in report_catalog.list_sources(db, current_user)}
    results = []
    for template in REPORT_TEMPLATES:
        entry = available.get(template["module_key"])
        if not entry:
            continue
        source, fields = entry
        try:
            config = report_engine.normalize_config(db, current_user, source, fields, template["config"])
        except HTTPException:
            continue
        results.append({**template, "module_label": source.label, "config": config})
    return results


# ---------------------------------------------------------------------- saved reports


def validate_report_config(db: Session, current_user, *, module_key: str, config: dict[str, Any]) -> dict[str, Any]:
    source, fields = report_catalog.resolve_source(db, current_user, module_key)
    return report_engine.normalize_config(db, current_user, source, fields, config)


def _owner_name(user: User | None) -> str | None:
    if user is None:
        return None
    full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return full_name or user.email


def _serialize_saved_report(report: UserModuleReport, current_user=None, module_label: str | None = None) -> dict[str, Any]:
    return {
        "id": report.id,
        "module_key": report.module_key,
        "module_label": module_label,
        "name": report.name,
        "description": report.description,
        "visibility": report.visibility or "private",
        "owner_id": report.user_id,
        "owner_name": _owner_name(getattr(report, "user", None)),
        "can_edit": current_user is not None and report.user_id == current_user.id,
        "config": report.config or {},
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }


def apply_saved_report_sort(query, *, sort_by: str | None = None, sort_direction: str | None = None):
    sort_column = SAVED_REPORT_SORT_FIELDS.get((sort_by or "").strip())
    default_direction = "asc"
    if sort_column is None:
        sort_column = UserModuleReport.updated_at
        default_direction = "desc"
    direction = (sort_direction or default_direction).strip().lower()
    ordered = sort_column.desc() if direction == "desc" else sort_column.asc()
    return query.order_by(None).order_by(ordered.nullslast(), UserModuleReport.id.desc())


def _visible_reports_query(db: Session, current_user):
    """Mine, plus everyone's shared reports in the same tenant."""
    return db.query(UserModuleReport).filter(
        UserModuleReport.tenant_id == current_user.tenant_id,
        or_(UserModuleReport.user_id == current_user.id, UserModuleReport.visibility == "everyone"),
    )


def list_saved_reports(
    db: Session,
    current_user,
    *,
    module_key: str | None = None,
    scope: str | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> list[dict[str, Any]]:
    query = _visible_reports_query(db, current_user)
    if scope == "mine":
        query = query.filter(UserModuleReport.user_id == current_user.id)
    elif scope == "shared":
        query = query.filter(UserModuleReport.user_id != current_user.id)
    if module_key:
        query = query.filter(UserModuleReport.module_key == module_key)
    if search and search.strip():
        query = query.filter(UserModuleReport.name.ilike(f"%{search.strip()[:100]}%"))
    reports = apply_saved_report_sort(query, sort_by=sort_by, sort_direction=sort_direction).all()

    # A report on a module the viewer cannot see is not listed, shared or not: opening it
    # would only fail. Each module is checked once.
    labels: dict[str, str | None] = {}
    results = []
    for report in reports:
        if report.module_key not in labels:
            try:
                source, _fields = report_catalog.resolve_source(db, current_user, report.module_key)
                labels[report.module_key] = source.label
            except HTTPException:
                labels[report.module_key] = None
        if labels[report.module_key] is None:
            continue
        results.append(_serialize_saved_report(report, current_user, labels[report.module_key]))
    return results


def _get_visible_report_or_404(db: Session, current_user, report_id: int) -> UserModuleReport:
    report = _visible_reports_query(db, current_user).filter(UserModuleReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved report not found")
    return report


def _get_saved_report_or_404(db: Session, current_user, report_id: int) -> UserModuleReport:
    """The caller's own report. Someone else's shared report is a 403, not a 404: the
    viewer can see it exists, they just cannot change it."""
    report = _get_visible_report_or_404(db, current_user, report_id)
    if report.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the report's owner can change it")
    return report


def get_saved_report(db: Session, current_user, *, report_id: int) -> dict[str, Any]:
    report = _get_visible_report_or_404(db, current_user, report_id)
    try:
        source, _fields = report_catalog.resolve_source(db, current_user, report.module_key)
    except HTTPException as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved report not found") from exc
    return _serialize_saved_report(report, current_user, source.label)


def _normalize_visibility(visibility: str | None) -> str:
    value = (visibility or "private").strip().lower()
    if value not in SAVED_REPORT_VISIBILITIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported report visibility")
    return value


def _audit_state(report: UserModuleReport) -> dict[str, Any]:
    return {"name": report.name, "module_key": report.module_key, "visibility": report.visibility, "description": report.description}


def create_saved_report(
    db: Session,
    current_user,
    *,
    module_key: str,
    name: str,
    config: dict[str, Any],
    description: str | None = None,
    visibility: str | None = None,
) -> dict[str, Any]:
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
        description=(description or "").strip() or None,
        visibility=_normalize_visibility(visibility),
        config=normalized_config,
    )
    db.add(report)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A saved report with this name already exists") from exc
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="reports",
        entity_type="saved_report",
        entity_id=report.id,
        action="create",
        description=f"Created report {report.name}",
        after_state=_audit_state(report),
        commit=False,
    )
    db.commit()
    db.refresh(report)
    return get_saved_report(db, current_user, report_id=report.id)


def update_saved_report(
    db: Session,
    current_user,
    *,
    report_id: int,
    name: str | None = None,
    config: dict[str, Any] | None = None,
    description: str | None = None,
    visibility: str | None = None,
    fields_set: set[str] | None = None,
) -> dict[str, Any]:
    report = _get_saved_report_or_404(db, current_user, report_id)
    before = _audit_state(report)
    fields_set = fields_set or set()
    if name is not None:
        normalized_name = name.strip()
        if not normalized_name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Report name is required")
        report.name = normalized_name
    if config is not None:
        report.config = validate_report_config(db, current_user, module_key=report.module_key, config=config)
    if "description" in fields_set or description is not None:
        report.description = (description or "").strip() or None
    if visibility is not None:
        report.visibility = _normalize_visibility(visibility)
    db.add(report)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A saved report with this name already exists") from exc
    after = _audit_state(report)
    if after != before or config is not None:
        shared_changed = before["visibility"] != after["visibility"]
        log_activity(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id,
            module_key="reports",
            entity_type="saved_report",
            entity_id=report.id,
            action="update",
            description=(
                f"Shared report {report.name} with everyone" if shared_changed and after["visibility"] == "everyone"
                else f"Made report {report.name} private" if shared_changed
                else f"Updated report {report.name}"
            ),
            before_state=before,
            after_state=after,
            commit=False,
        )
    db.commit()
    db.refresh(report)
    return get_saved_report(db, current_user, report_id=report.id)


def delete_saved_report(db: Session, current_user, *, report_id: int) -> None:
    report = _get_saved_report_or_404(db, current_user, report_id)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="reports",
        entity_type="saved_report",
        entity_id=report.id,
        action="delete",
        description=f"Deleted report {report.name}",
        before_state=_audit_state(report),
        commit=False,
    )
    db.delete(report)
    db.commit()


# ---------------------------------------------------------- version 1 report endpoint


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
    """`GET /reports/modules/{key}`: one grouping, one measure, on the version 2 engine."""
    normalized_metric = _normalize_metric(metric)
    source, fields = report_catalog.resolve_source(db, current_user, module_key)
    dimensions = [item for item in fields if item.can_group]
    if not dimensions:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This module does not have report dimensions")
    dimension = next((item for item in dimensions if item.key == source.aliases.get(dimension_key or "", dimension_key)), dimensions[0])
    metric_field = None
    if normalized_metric == "sum":
        metric_field = next((item for item in fields if item.can_measure and item.key == metric_field_key), None)
        if not metric_field:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select a numeric field for sum reports")

    config = {
        "version": report_engine.CONFIG_VERSION,
        "format": "summary",
        # Version 1 grouped dates by day, and its callers expect that.
        "groupings": [{"field": dimension.key, "granularity": "day"}],
        "measures": [{"aggregate": "sum", "field": metric_field.key}] if metric_field else [{"aggregate": "count"}],
        "filters": {"search": search or "", "all_conditions": all_conditions, "any_conditions": any_conditions},
        "sort": {"by": "value", "direction": "desc"},
        "limit": _normalize_limit(limit),
    }
    result = report_engine.run_report(db, current_user, module_key=module_key, config=config)
    rows = []
    for row in result["rows"]:
        rows.append({"key": row["keys"][0], "label": row["labels"][0], "count": row["count"], "value": float(row["values"][0] or 0)})
    return {
        "module_key": module_key,
        "label": source.label,
        "dimension": report_catalog.legacy_field_payload(dimension),
        "metric": normalized_metric,
        "metric_field": report_catalog.legacy_field_payload(metric_field) if metric_field else None,
        "total_count": result["totals"]["count"],
        "rows": rows,
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
        facts = pipelines_services.opportunity_stage_facts(opportunity)
        amount = _parse_decimalish(opportunity.total_cost_of_project)
        probability = _forecast_probability(opportunity, facts)
        if not facts.is_closed:
            open_count += 1
        if facts.is_won:
            won_count += 1

        stage_bucket = stage_buckets.setdefault(facts.key, _empty_forecast_bucket(facts.key, facts.label))
        _add_forecast_bucket_amount(stage_bucket, amount=amount, probability=probability, facts=facts)

        owner_key = str(opportunity.assigned_to) if opportunity.assigned_to is not None else "__unassigned__"
        if opportunity.assigned_to is not None:
            owner_ids.add(opportunity.assigned_to)
        owner_bucket = owner_buckets.setdefault(owner_key, _empty_forecast_bucket(owner_key, "Unassigned"))
        _add_forecast_bucket_amount(owner_bucket, amount=amount, probability=probability, facts=facts)

        assigned_user = getattr(opportunity, "assigned_user", None)
        user_team_id = getattr(assigned_user, "team_id", None)
        team_key = str(user_team_id) if user_team_id is not None else "__unassigned__"
        if user_team_id is not None:
            team_ids.add(user_team_id)
        team_bucket = team_buckets.setdefault(team_key, _empty_forecast_bucket(team_key, "Unassigned"))
        _add_forecast_bucket_amount(team_bucket, amount=amount, probability=probability, facts=facts)

        _add_forecast_bucket_amount(totals, amount=amount, probability=probability, facts=facts)

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
        stage_labels: dict[str, str] = {}
        stage_semantics: dict[str, str] = {}
        rows = deal_base.with_entities(
            SalesOpportunity.sales_stage,
            SalesOpportunity.pipeline_stage_id,
            SalesOpportunity.total_cost_of_project,
        ).all()
        stages_by_id = {
            stage.id: pipelines_services.stage_facts(stage)
            for stage in pipelines_repository.list_stages_by_ids(
                db,
                tenant_id=tenant_id,
                stage_ids={row.pipeline_stage_id for row in rows if row.pipeline_stage_id is not None},
            )
        }
        for sales_stage, stage_id, value in rows:
            facts = stages_by_id.get(stage_id) or pipelines_services.legacy_stage_facts(sales_stage)
            key = facts.key
            stage_labels[key] = facts.label
            stage_semantics[key] = facts.semantic_type
            stage_counts[key] = stage_counts.get(key, 0) + 1
            numeric_value = _parse_decimalish(value)
            stage_values[key] = stage_values.get(key, Decimal("0")) + numeric_value
            if facts.is_won:
                won_count += 1
            elif facts.is_lost:
                lost_count += 1
            else:
                pipeline_value += numeric_value
        deal_stage_rows = [
            {
                "key": key,
                "label": stage_labels[key],
                # So a chart can leave out lost deals by meaning, not by key.
                "semantic_type": stage_semantics[key],
                "count": stage_counts[key],
                "value": float(stage_values.get(key, Decimal("0"))),
            }
            for key in sorted(stage_counts, key=lambda item: stage_values.get(item, Decimal("0")), reverse=True)
        ]
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
                func.sum(case((pipelines_repository.opportunity_won_clause(), 1), else_=0)).label("won_count"),
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
