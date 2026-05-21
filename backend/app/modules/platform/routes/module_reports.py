from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.security import require_user
from app.modules.platform.schema import ModuleReportModuleListResponse, ModuleReportResponse
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
):
    return {"results": module_reports.list_report_modules(db, current_user)}


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
