"""Report dashboards (docs/crm-evolution/11-reports.md Phase 2).

A dashboard is a page of saved reports: a chart, a table or a single figure each, with
dashboard-wide filters (a date range and "Show me") that override every report on it,
the way HubSpot and Salesforce dashboard filters do.

Sharing follows saved reports: `private` or `everyone` in the tenant, with the owner the
only editor. A widget only ever carries a report ID. Opening a dashboard resolves each
widget for the person looking at it: a report they cannot see (private to someone else,
deleted, or on a module they cannot view) comes back unavailable, with the reason, never
with its definition. Nothing here runs a report; the page runs each one through the engine
as its viewer.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.platform.models import ReportDashboard, UserModuleReport
from app.modules.platform.services import module_reports, report_catalog, report_engine
from app.modules.platform.services.activity_logs import log_activity


MAX_WIDGETS = 24
WIDGET_TYPES = {"chart", "table", "kpi"}
WIDGET_SIZES = {"small", "medium", "large", "wide"}
VISIBILITIES = {"private", "everyone"}
# "report" keeps each report's own setting; anything else overrides every report.
DATE_RANGE_FILTERS = {"report"} | (report_engine.DATE_RANGES - {"custom"})
SCOPE_FILTERS = {"report"} | report_engine.SCOPES
_WIDGET_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _visible_query(db: Session, current_user):
    return db.query(ReportDashboard).filter(
        ReportDashboard.tenant_id == current_user.tenant_id,
        or_(ReportDashboard.user_id == current_user.id, ReportDashboard.visibility == "everyone"),
    )


def _get_visible_or_404(db: Session, current_user, dashboard_id: int) -> ReportDashboard:
    dashboard = _visible_query(db, current_user).filter(ReportDashboard.id == dashboard_id).first()
    if not dashboard:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    return dashboard


def _get_own_or_error(db: Session, current_user, dashboard_id: int) -> ReportDashboard:
    dashboard = _get_visible_or_404(db, current_user, dashboard_id)
    if dashboard.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the dashboard's owner can change it")
    return dashboard


# --------------------------------------------------------------------------- validation


def normalize_filters(filters: dict[str, Any] | None) -> dict[str, str]:
    filters = filters if isinstance(filters, dict) else {}
    date_range = str(filters.get("date_range") or "report").lower()
    scope = str(filters.get("scope") or "report").lower()
    if date_range not in DATE_RANGE_FILTERS:
        raise _bad_request("Unsupported dashboard date range")
    if scope not in SCOPE_FILTERS:
        raise _bad_request("Unsupported dashboard owner filter")
    return {"date_range": date_range, "scope": scope}


def _visible_report_ids(db: Session, current_user, report_ids: set[int]) -> set[int]:
    if not report_ids:
        return set()
    rows = (
        db.query(UserModuleReport.id)
        .filter(
            UserModuleReport.tenant_id == current_user.tenant_id,
            UserModuleReport.id.in_(report_ids),
            or_(UserModuleReport.user_id == current_user.id, UserModuleReport.visibility == "everyone"),
        )
        .all()
    )
    return {row[0] for row in rows}


def normalize_widgets(db: Session, current_user, widgets: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Every widget must point at a report its owner can see when the layout is saved. A
    report someone else later makes private, or deletes, is handled when the page opens."""
    if not isinstance(widgets, list):
        raise _bad_request("Widgets must be a list")
    if len(widgets) > MAX_WIDGETS:
        raise _bad_request(f"A dashboard holds at most {MAX_WIDGETS} widgets")
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in widgets:
        if not isinstance(raw, dict):
            raise _bad_request("Each widget must be an object")
        widget_id = str(raw.get("id") or "")
        if not _WIDGET_ID.match(widget_id) or widget_id in seen:
            raise _bad_request("Each widget needs a unique ID")
        seen.add(widget_id)
        widget_type = str(raw.get("type") or "chart")
        size = str(raw.get("size") or "medium")
        if widget_type not in WIDGET_TYPES:
            raise _bad_request("Unsupported widget type")
        if size not in WIDGET_SIZES:
            raise _bad_request("Unsupported widget size")
        try:
            report_id = int(raw.get("report_id"))
        except (TypeError, ValueError) as exc:
            raise _bad_request("Each widget needs a saved report") from exc
        chart_type = raw.get("chart_type")
        if chart_type is not None and chart_type not in report_engine.CHART_TYPES - {"metric"}:
            raise _bad_request("Unsupported chart type")
        target = raw.get("target")
        if target is not None:
            try:
                target = float(target)
            except (TypeError, ValueError) as exc:
                raise _bad_request("A target must be a number") from exc
            if target <= 0:
                raise _bad_request("A target must be greater than zero")
        title = str(raw.get("title") or "").strip()[:150] or None
        normalized.append({
            "id": widget_id,
            "type": widget_type,
            "size": size,
            "report_id": report_id,
            "title": title,
            "chart_type": chart_type if widget_type == "chart" else None,
            "target": target if widget_type == "kpi" else None,
        })
    requested = {widget["report_id"] for widget in normalized}
    missing = requested - _visible_report_ids(db, current_user, requested)
    if missing:
        raise _bad_request("A widget points at a report you cannot see")
    return normalized


# -------------------------------------------------------------------------- serializers


def _summary(dashboard: ReportDashboard, current_user) -> dict[str, Any]:
    return {
        "id": dashboard.id,
        "name": dashboard.name,
        "description": dashboard.description,
        "visibility": dashboard.visibility or "private",
        "owner_id": dashboard.user_id,
        "owner_name": module_reports._owner_name(getattr(dashboard, "user", None)),
        "can_edit": dashboard.user_id == current_user.id,
        "widget_count": len(dashboard.widgets or []),
        "filters": normalize_filters(dashboard.filters),
        "created_at": dashboard.created_at,
        "updated_at": dashboard.updated_at,
    }


def _resolve_widgets(db: Session, current_user, dashboard: ReportDashboard) -> list[dict[str, Any]]:
    widgets = list(dashboard.widgets or [])
    report_ids = {int(widget["report_id"]) for widget in widgets if widget.get("report_id") is not None}
    reports = {
        report.id: report
        for report in db.query(UserModuleReport).filter(
            UserModuleReport.tenant_id == current_user.tenant_id,
            UserModuleReport.id.in_(report_ids),
        )
    } if report_ids else {}

    module_labels: dict[str, str | None] = {}
    resolved = []
    for widget in widgets:
        report = reports.get(int(widget.get("report_id") or 0))
        payload, reason = None, None
        if report is None:
            reason = "missing"
        elif report.user_id != current_user.id and report.visibility != "everyone":
            reason = "not_shared"
        else:
            if report.module_key not in module_labels:
                try:
                    source, _fields = report_catalog.resolve_source(db, current_user, report.module_key)
                    module_labels[report.module_key] = source.label
                except HTTPException:
                    module_labels[report.module_key] = None
            if module_labels[report.module_key] is None:
                reason = "no_access"
            else:
                payload = module_reports._serialize_saved_report(report, current_user, module_labels[report.module_key])
        resolved.append({**widget, "report": payload, "unavailable_reason": reason})
    return resolved


def _detail(db: Session, current_user, dashboard: ReportDashboard) -> dict[str, Any]:
    return {**_summary(dashboard, current_user), "widgets": _resolve_widgets(db, current_user, dashboard)}


def _audit(dashboard: ReportDashboard) -> dict[str, Any]:
    return {
        "name": dashboard.name,
        "visibility": dashboard.visibility,
        "description": dashboard.description,
        "widget_count": len(dashboard.widgets or []),
    }


def _log(db: Session, current_user, dashboard: ReportDashboard, action: str, description: str, before=None, after=None) -> None:
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="reports",
        entity_type="report_dashboard",
        entity_id=dashboard.id,
        action=action,
        description=description,
        before_state=before,
        after_state=after,
        commit=False,
    )


# ------------------------------------------------------------------------------ actions


def list_dashboards(db: Session, current_user, *, scope: str | None = None, search: str | None = None) -> list[dict[str, Any]]:
    query = _visible_query(db, current_user)
    if scope == "mine":
        query = query.filter(ReportDashboard.user_id == current_user.id)
    elif scope == "shared":
        query = query.filter(ReportDashboard.user_id != current_user.id)
    if search and search.strip():
        query = query.filter(ReportDashboard.name.ilike(f"%{search.strip()[:100]}%"))
    dashboards = query.order_by(ReportDashboard.updated_at.desc(), ReportDashboard.id.desc()).all()
    return [_summary(dashboard, current_user) for dashboard in dashboards]


def get_dashboard(db: Session, current_user, *, dashboard_id: int) -> dict[str, Any]:
    return _detail(db, current_user, _get_visible_or_404(db, current_user, dashboard_id))


def _name(name: str | None) -> str:
    normalized = (name or "").strip()
    if not normalized:
        raise _bad_request("Dashboard name is required")
    return normalized[:150]


def _visibility(value: str | None) -> str:
    normalized = (value or "private").strip().lower()
    if normalized not in VISIBILITIES:
        raise _bad_request("Unsupported dashboard visibility")
    return normalized


def _commit_or_conflict(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="You already have a dashboard with this name") from exc


def create_dashboard(
    db: Session,
    current_user,
    *,
    name: str,
    description: str | None = None,
    visibility: str | None = None,
    widgets: list[dict[str, Any]] | None = None,
    filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    dashboard = ReportDashboard(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        name=_name(name),
        description=(description or "").strip() or None,
        visibility=_visibility(visibility),
        widgets=normalize_widgets(db, current_user, widgets or []),
        filters=normalize_filters(filters),
    )
    db.add(dashboard)
    _commit_or_conflict(db)
    _log(db, current_user, dashboard, "create", f"Created dashboard {dashboard.name}", after=_audit(dashboard))
    db.commit()
    db.refresh(dashboard)
    return _detail(db, current_user, dashboard)


def update_dashboard(
    db: Session,
    current_user,
    *,
    dashboard_id: int,
    fields_set: set[str],
    name: str | None = None,
    description: str | None = None,
    visibility: str | None = None,
    widgets: list[dict[str, Any]] | None = None,
    filters: dict[str, Any] | None = None,
) -> dict[str, Any]:
    dashboard = _get_own_or_error(db, current_user, dashboard_id)
    before = _audit(dashboard)
    if name is not None:
        dashboard.name = _name(name)
    if "description" in fields_set:
        dashboard.description = (description or "").strip() or None
    if visibility is not None:
        dashboard.visibility = _visibility(visibility)
    if widgets is not None:
        dashboard.widgets = normalize_widgets(db, current_user, widgets)
    if filters is not None:
        dashboard.filters = normalize_filters(filters)
    _commit_or_conflict(db)
    after = _audit(dashboard)
    shared_changed = before["visibility"] != after["visibility"]
    description_text = (
        f"Shared dashboard {dashboard.name} with everyone" if shared_changed and after["visibility"] == "everyone"
        else f"Made dashboard {dashboard.name} private" if shared_changed
        else f"Updated dashboard {dashboard.name}"
    )
    _log(db, current_user, dashboard, "update", description_text, before=before, after=after)
    db.commit()
    db.refresh(dashboard)
    return _detail(db, current_user, dashboard)


def delete_dashboard(db: Session, current_user, *, dashboard_id: int) -> None:
    dashboard = _get_own_or_error(db, current_user, dashboard_id)
    _log(db, current_user, dashboard, "delete", f"Deleted dashboard {dashboard.name}", before=_audit(dashboard))
    db.delete(dashboard)
    db.commit()
