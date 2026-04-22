from __future__ import annotations

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.core.access_control import require_department_module_access, require_role_module_action_access
from app.core.module_search import apply_ranked_search
from app.core.postgres_search import searchable_text
from app.modules.calendar.models import CalendarEvent, CalendarEventParticipant
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization
from app.modules.tasks.models import Task, TaskAssignee


GLOBAL_SEARCH_MODULES = (
    {
        "module_key": "tasks",
        "module_label": "Tasks",
    },
    {
        "module_key": "calendar",
        "module_label": "Calendar",
    },
    {
        "module_key": "sales_contacts",
        "module_label": "Contacts",
    },
    {
        "module_key": "sales_organizations",
        "module_label": "Organizations",
    },
    {
        "module_key": "sales_opportunities",
        "module_label": "Opportunities",
    },
)


def _task_results(db: Session, *, tenant_id: int, current_user, query: str, limit: int) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(Task)
        .filter(
            Task.tenant_id == tenant_id,
            Task.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(Task.title, Task.description, Task.status, Task.priority),
        default_order_column=Task.created_at,
    )

    visibility_filters = [
        Task.created_by_user_id == current_user.id,
        Task.assignees.any(TaskAssignee.user_id == current_user.id),
    ]
    if getattr(current_user, "team_id", None):
        visibility_filters.append(Task.assignees.any(TaskAssignee.team_id == current_user.team_id))

    items = (
        ranked
        .filter(or_(*visibility_filters))
        .order_by(Task.due_at.is_(None), Task.due_at.asc(), Task.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "module_key": "tasks",
            "module_label": "Tasks",
            "record_id": str(record.id),
            "title": record.title,
            "subtitle": " · ".join(part for part in [record.status.replace("_", " ").title(), record.priority.title()] if part) or None,
            "href": f"/dashboard/tasks?taskId={record.id}",
        }
        for record in items
    ]


def _calendar_results(db: Session, *, tenant_id: int, current_user, query: str, limit: int) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(CalendarEvent)
        .filter(
            CalendarEvent.tenant_id == tenant_id,
            CalendarEvent.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            CalendarEvent.title,
            CalendarEvent.description,
            CalendarEvent.location,
            CalendarEvent.source_label,
        ),
        default_order_column=CalendarEvent.start_at,
    )

    visibility_filters = [
        CalendarEvent.owner_user_id == current_user.id,
        CalendarEvent.participants.any(
            and_(
                CalendarEventParticipant.user_id == current_user.id,
                CalendarEventParticipant.response_status != "declined",
            )
        ),
    ]
    if getattr(current_user, "team_id", None):
        visibility_filters.append(
            CalendarEvent.participants.any(
                and_(
                    CalendarEventParticipant.team_id == current_user.team_id,
                    CalendarEventParticipant.response_status == "shared",
                )
            )
        )

    items = (
        ranked
        .filter(or_(*visibility_filters))
        .order_by(CalendarEvent.start_at.asc(), CalendarEvent.id.asc())
        .limit(limit)
        .all()
    )
    return [
        {
            "module_key": "calendar",
            "module_label": "Calendar",
            "record_id": str(record.id),
            "title": record.title,
            "subtitle": " · ".join(part for part in [record.location, record.source_label] if part) or None,
            "href": f"/dashboard/calendar?eventId={record.id}",
        }
        for record in items
    ]


def _contact_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesContact)
        .outerjoin(SalesOrganization, SalesOrganization.org_id == SalesContact.organization_id)
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            SalesContact.first_name,
            SalesContact.last_name,
            SalesContact.primary_email,
            SalesContact.current_title,
            SalesOrganization.org_name,
        ),
        default_order_column=SalesContact.created_time,
    )
    items = ranked.limit(limit).all()
    results: list[dict] = []
    for record in items:
        title = " ".join(part for part in [record.first_name, record.last_name] if part).strip() or record.primary_email or "Unnamed contact"
        subtitle_parts = [record.current_title, record.organization_name, record.primary_email]
        subtitle = " · ".join(part for part in subtitle_parts if part) or None
        results.append(
            {
                "module_key": "sales_contacts",
                "module_label": "Contacts",
                "record_id": str(record.contact_id),
                "title": title,
                "subtitle": subtitle,
                "href": f"/dashboard/sales/contacts/{record.contact_id}",
            }
        )
    return results


def _organization_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesOrganization).filter(
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            SalesOrganization.org_name,
            SalesOrganization.primary_email,
            SalesOrganization.website,
            SalesOrganization.industry,
            SalesOrganization.billing_country,
        ),
        default_order_column=SalesOrganization.created_time,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "sales_organizations",
            "module_label": "Organizations",
            "record_id": str(record.org_id),
            "title": record.org_name,
            "subtitle": " · ".join(part for part in [record.industry, record.primary_email, record.website] if part) or None,
            "href": f"/dashboard/sales/organizations/{record.org_id}",
        }
        for record in items
    ]


def _opportunity_results(db: Session, *, tenant_id: int, query: str, limit: int, current_user=None) -> list[dict]:
    ranked = apply_ranked_search(
        db.query(SalesOpportunity).filter(
            SalesOpportunity.tenant_id == tenant_id,
            SalesOpportunity.deleted_at.is_(None),
        ),
        search=query,
        document=searchable_text(
            SalesOpportunity.opportunity_name,
            SalesOpportunity.client,
            SalesOpportunity.sales_stage,
            SalesOpportunity.target_geography,
            SalesOpportunity.target_audience,
        ),
        default_order_column=SalesOpportunity.created_time,
    )
    items = ranked.limit(limit).all()
    return [
        {
            "module_key": "sales_opportunities",
            "module_label": "Opportunities",
            "record_id": str(record.opportunity_id),
            "title": record.opportunity_name,
            "subtitle": " · ".join(part for part in [record.client, record.sales_stage, record.target_geography] if part) or None,
            "href": f"/dashboard/sales/opportunities/{record.opportunity_id}",
        }
        for record in items
    ]


SEARCH_BUILDERS = {
    "tasks": _task_results,
    "calendar": _calendar_results,
    "sales_contacts": _contact_results,
    "sales_organizations": _organization_results,
    "sales_opportunities": _opportunity_results,
}


def list_global_search_results(
    db: Session,
    *,
    current_user,
    query: str,
    limit_per_module: int = 5,
) -> list[dict]:
    normalized_query = query.strip()
    if not normalized_query:
        return []

    results: list[dict] = []
    for module in GLOBAL_SEARCH_MODULES:
        module_key = module["module_key"]
        try:
            require_department_module_access(db, user=current_user, module_key=module_key)
            require_role_module_action_access(db, user=current_user, module_key=module_key, action="view")
        except PermissionError:
            continue
        builder = SEARCH_BUILDERS[module_key]
        results.extend(
            builder(
                db,
                tenant_id=current_user.tenant_id,
                current_user=current_user,
                query=normalized_query,
                limit=limit_per_module,
            )
        )
    return results
