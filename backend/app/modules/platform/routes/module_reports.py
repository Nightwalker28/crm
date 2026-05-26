from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema import (
    ModuleReportModuleListResponse,
    ModuleReportResponse,
    SavedModuleReportCreateRequest,
    SavedModuleReportListResponse,
    SavedModuleReportResponse,
    SavedModuleReportUpdateRequest,
)
from app.modules.platform.services import module_reports


router = APIRouter(prefix="/reports", tags=["Reports"])


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


@router.get("/crm-summary")
def get_crm_dashboard_summary(
    period_days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return module_reports.generate_crm_dashboard_summary(db, current_user, period_days=period_days)


@router.get("/saved", response_model=SavedModuleReportListResponse)
def list_saved_reports(
    module_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("reports")),
    require_permission=Depends(require_action_access("reports", "view")),
):
    return {"results": module_reports.list_saved_reports(db, current_user, module_key=module_key)}


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
    search: str | None = Query(default=None),
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
    search: str | None = Query(default=None),
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
