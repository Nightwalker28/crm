from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema import (
    ForecastSnapshotResponse,
    ForecastSummaryResponse,
    ModuleReportModuleListResponse,
    ModuleReportResponse,
    ReportDashboardCreateRequest,
    ReportDashboardListResponse,
    ReportDashboardResponse,
    ReportDashboardUpdateRequest,
    ReportRecordsRequest,
    ReportRecordsResponse,
    ReportRunRequest,
    ReportRunResponse,
    ReportTemplateListResponse,
    SavedModuleReportCreateRequest,
    SavedModuleReportListResponse,
    SavedModuleReportResponse,
    SavedModuleReportUpdateRequest,
)
from app.modules.platform.services import module_reports, report_dashboards, report_engine, report_subscriptions
from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_export_job
from app.modules.platform.services.report_catalog import resolve_source
from pydantic import BaseModel, Field


router = APIRouter(prefix="/reports", tags=["Reports"])


class ReportSubscriptionRequest(BaseModel):
    target_type: str = Field(pattern="^(report|dashboard)$")
    target_id: int = Field(gt=0)
    frequency: str = Field(pattern="^(daily|weekly|monthly)$")
    hour: int = Field(ge=0, le=23)
    minute: int = Field(default=0, ge=0, le=59)
    weekday: int | None = Field(default=None, ge=0, le=6)
    day_of_month: int | None = Field(default=None, ge=1, le=28)
    timezone: str = Field(default="UTC", max_length=100)
    is_active: bool = True


class ReportExportJobRequest(ReportRunRequest):
    format: str = Field(pattern="^(csv|xlsx)$")


@router.post("/run/export-job", status_code=status.HTTP_202_ACCEPTED)
def queue_report_export(
    payload: ReportExportJobRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "export")),
):
    source, fields = resolve_source(db, current_user, payload.module_key)
    normalized = report_engine.normalize_config(db, current_user, source, fields, payload.config)
    job = create_data_transfer_job(
        db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id,
        module_key="reports", operation_type="report_export",
        payload={"source_module_key": payload.module_key, "config": normalized, "format": payload.format},
    )
    enqueue_export_job(job.id)
    return {"job_id": job.id, "status": job.status}


@router.get("/subscriptions")
def list_report_subscriptions(
    target_type: str | None = Query(default=None, pattern="^(report|dashboard)$"),
    target_id: int | None = Query(default=None, gt=0),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return {"results": report_subscriptions.list_subscriptions(db, current_user, target_type=target_type, target_id=target_id)}


@router.put("/subscriptions")
def save_report_subscription(
    payload: ReportSubscriptionRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return report_subscriptions.save_subscription(
        db, current_user, target_type=payload.target_type, target_id=payload.target_id,
        frequency=payload.frequency, hour=payload.hour, minute=payload.minute,
        weekday=payload.weekday, day_of_month=payload.day_of_month,
        timezone_name=payload.timezone, is_active=payload.is_active,
    )


@router.delete("/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report_subscription(
    subscription_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    report_subscriptions.delete_subscription(db, current_user, subscription_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _default_forecast_period() -> tuple:
    from datetime import date, timedelta

    start = date.today()
    return start, start + timedelta(days=90)


def _parse_report_filters(filter_logic: str, filters: str | None, filters_all: str | None, filters_any: str | None):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return all_conditions, any_conditions


@router.get("/modules", response_model=ModuleReportModuleListResponse)
def list_report_modules(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return {"results": module_reports.list_report_modules(db, current_user)}


@router.get("/templates", response_model=ReportTemplateListResponse)
def list_report_templates(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return {"results": module_reports.list_report_templates(db, current_user)}


# Running a report reads and changes nothing. It is a POST only because a definition does
# not fit in a query string, so `apiFetch` never retries it, which is the safe default.
@router.post("/run", response_model=ReportRunResponse)
def run_report(
    payload: ReportRunRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return report_engine.run_report(db, current_user, module_key=payload.module_key, config=payload.config)


@router.post("/run/records", response_model=ReportRecordsResponse)
def run_report_records(
    payload: ReportRecordsRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return report_engine.run_records(
        db,
        current_user,
        module_key=payload.module_key,
        config=payload.config,
        group_keys=payload.group_keys,
        offset=payload.offset,
        limit=payload.limit,
    )


@router.post("/run/export.csv")
def export_report_csv(
    payload: ReportRunRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "export")),
):
    content = report_engine.report_csv_bytes(db, current_user, module_key=payload.module_key, config=payload.config)
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{payload.module_key}-report.csv"'},
    )


@router.post("/run/export.xlsx")
def export_report_xlsx(
    payload: ReportRunRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "export")),
):
    content = report_engine.report_xlsx_bytes(db, current_user, module_key=payload.module_key, config=payload.config)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{payload.module_key}-report.xlsx"'},
    )


@router.get("/dashboards", response_model=ReportDashboardListResponse)
def list_report_dashboards(
    scope: str | None = Query(default=None, pattern="^(mine|shared)$"),
    search: str | None = Query(default=None, max_length=100),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return {"results": report_dashboards.list_dashboards(db, current_user, scope=scope, search=search)}


@router.post("/dashboards", response_model=ReportDashboardResponse, status_code=status.HTTP_201_CREATED)
def create_report_dashboard(
    payload: ReportDashboardCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "create")),
):
    return report_dashboards.create_dashboard(
        db,
        current_user,
        name=payload.name,
        description=payload.description,
        visibility=payload.visibility,
        widgets=[widget.model_dump() for widget in payload.widgets],
        filters=payload.filters.model_dump() if payload.filters else None,
    )


@router.get("/dashboards/{dashboard_id}", response_model=ReportDashboardResponse)
def get_report_dashboard(
    dashboard_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return report_dashboards.get_dashboard(db, current_user, dashboard_id=dashboard_id)


@router.put("/dashboards/{dashboard_id}", response_model=ReportDashboardResponse)
def update_report_dashboard(
    dashboard_id: int,
    payload: ReportDashboardUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "edit")),
):
    return report_dashboards.update_dashboard(
        db,
        current_user,
        dashboard_id=dashboard_id,
        fields_set=payload.model_fields_set,
        name=payload.name,
        description=payload.description,
        visibility=payload.visibility,
        widgets=[widget.model_dump() for widget in payload.widgets] if payload.widgets is not None else None,
        filters=payload.filters.model_dump() if payload.filters else None,
    )


@router.delete("/dashboards/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report_dashboard(
    dashboard_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "delete")),
):
    report_dashboards.delete_dashboard(db, current_user, dashboard_id=dashboard_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/crm-summary")
def get_crm_dashboard_summary(
    period_days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return module_reports.generate_crm_dashboard_summary(db, current_user, period_days=period_days)


@router.get("/forecast", response_model=ForecastSummaryResponse)
def get_forecast_summary(
    period_start: str | None = Query(default=None),
    period_end: str | None = Query(default=None),
    owner_id: int | None = Query(default=None),
    team_id: int | None = Query(default=None),
    pipeline_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
    require_deals_module=Depends(require_module_access("sales_opportunities")),
    require_deals_permission=Depends(require_action_access("sales_opportunities", "view")),
):
    from datetime import date

    default_start, default_end = _default_forecast_period()
    try:
        parsed_start = date.fromisoformat(period_start) if period_start else default_start
        parsed_end = date.fromisoformat(period_end) if period_end else default_end
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Forecast period dates must use YYYY-MM-DD") from exc
    return module_reports.generate_forecast_summary(
        db,
        current_user,
        period_start=parsed_start,
        period_end=parsed_end,
        owner_id=owner_id,
        team_id=team_id,
        pipeline_key=pipeline_key,
    )


@router.post("/forecast/snapshots", response_model=ForecastSnapshotResponse, status_code=status.HTTP_201_CREATED)
def create_forecast_snapshot(
    period_start: str | None = Query(default=None),
    period_end: str | None = Query(default=None),
    owner_id: int | None = Query(default=None),
    team_id: int | None = Query(default=None),
    pipeline_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "create")),
    require_deals_module=Depends(require_module_access("sales_opportunities")),
    require_deals_permission=Depends(require_action_access("sales_opportunities", "view")),
):
    from datetime import date

    default_start, default_end = _default_forecast_period()
    try:
        parsed_start = date.fromisoformat(period_start) if period_start else default_start
        parsed_end = date.fromisoformat(period_end) if period_end else default_end
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Forecast period dates must use YYYY-MM-DD") from exc
    return module_reports.create_forecast_snapshot(
        db,
        current_user,
        period_start=parsed_start,
        period_end=parsed_end,
        owner_id=owner_id,
        team_id=team_id,
        pipeline_key=pipeline_key,
    )


@router.get("/saved", response_model=SavedModuleReportListResponse)
def list_saved_reports(
    module_key: str | None = Query(default=None),
    scope: str | None = Query(default=None, pattern="^(mine|shared)$"),
    search: str | None = Query(default=None, max_length=100),
    sort_by: str | None = Query(default=None),
    sort_direction: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return {
        "results": module_reports.list_saved_reports(
            db,
            current_user,
            module_key=module_key,
            scope=scope,
            search=search,
            sort_by=sort_by,
            sort_direction=sort_direction,
        )
    }


@router.get("/saved/{report_id}", response_model=SavedModuleReportResponse)
def get_saved_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return module_reports.get_saved_report(db, current_user, report_id=report_id)


@router.post("/saved", response_model=SavedModuleReportResponse, status_code=status.HTTP_201_CREATED)
def create_saved_report(
    payload: SavedModuleReportCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "create")),
):
    return module_reports.create_saved_report(
        db,
        current_user,
        module_key=payload.module_key,
        name=payload.name,
        config=payload.config,
        description=payload.description,
        visibility=payload.visibility,
    )


@router.put("/saved/{report_id}", response_model=SavedModuleReportResponse)
def update_saved_report(
    report_id: int,
    payload: SavedModuleReportUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "edit")),
):
    return module_reports.update_saved_report(
        db,
        current_user,
        report_id=report_id,
        name=payload.name,
        config=payload.config,
        description=payload.description,
        visibility=payload.visibility,
        fields_set=payload.model_fields_set,
    )


@router.delete("/saved/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_saved_report(
    report_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "delete")),
):
    module_reports.delete_saved_report(db, current_user, report_id=report_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/modules/{module_key}/export.csv")
def export_module_report_csv(
    module_key: str,
    dimension: str | None = Query(default=None),
    metric: str = Query(default="count"),
    metric_field: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "export")),
):
    all_conditions, any_conditions = _parse_report_filters(filter_logic, filters, filters_all, filters_any)
    report = module_reports.generate_module_report(
        db,
        current_user,
        module_key=module_key,
        dimension_key=dimension,
        metric=metric,
        metric_field_key=metric_field,
        search=search,
        all_conditions=all_conditions,
        any_conditions=any_conditions,
        limit=limit,
    )
    file_name = f"{module_key}-report.csv"
    return Response(
        content=module_reports.module_report_csv_bytes(report),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{file_name}"'},
    )


@router.get("/modules/{module_key}", response_model=ModuleReportResponse)
def generate_module_report(
    module_key: str,
    dimension: str | None = Query(default=None),
    metric: str = Query(default="count"),
    metric_field: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    all_conditions, any_conditions = _parse_report_filters(filter_logic, filters, filters_all, filters_any)
    return module_reports.generate_module_report(
        db,
        current_user,
        module_key=module_key,
        dimension_key=dimension,
        metric=metric,
        metric_field_key=metric_field,
        search=search,
        all_conditions=all_conditions,
        any_conditions=any_conditions,
        limit=limit,
    )
