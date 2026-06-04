from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.module_filters import apply_filter_conditions
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.support.models import SupportCase, SupportCaseComment, SupportCaseEvent
from app.modules.user_management.models import User


CASE_STATUSES = {"new", "open", "pending", "resolved", "closed"}
CASE_PRIORITIES = {"low", "medium", "high", "urgent"}
CLOSED_STATUSES = {"resolved", "closed"}
SUPPORT_CASE_SORT_FIELDS = {
    "case_number": SupportCase.case_number,
    "subject": SupportCase.subject,
    "status": SupportCase.status,
    "priority": SupportCase.priority,
    "source": SupportCase.source,
    "contact_id": SupportCase.contact_id,
    "organization_id": SupportCase.organization_id,
    "opportunity_id": SupportCase.opportunity_id,
    "quote_id": SupportCase.quote_id,
    "order_id": SupportCase.order_id,
    "assigned_to_id": SupportCase.assigned_to_id,
    "sla_due_at": SupportCase.sla_due_at,
    "first_response_at": SupportCase.first_response_at,
    "resolved_at": SupportCase.resolved_at,
    "closed_at": SupportCase.closed_at,
    "created_at": SupportCase.created_at,
    "updated_at": SupportCase.updated_at,
}


def _clean_text(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _validate_choice(value: str | None, allowed: set[str], *, default: str, detail: str) -> str:
    normalized = (value or default).strip().lower()
    if normalized not in allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    return normalized


def _linked_exists(db: Session, model, id_attr: str, *, tenant_id: int, record_id: int) -> bool:
    return (
        db.query(getattr(model, id_attr))
        .filter(getattr(model, id_attr) == record_id, model.tenant_id == tenant_id)
        .first()
        is not None
    )


def _ensure_user(db: Session, *, tenant_id: int, user_id: int | None) -> None:
    if user_id is None:
        return
    exists = db.query(User.id).filter(User.id == user_id, User.tenant_id == tenant_id).first()
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user not found")


def _ensure_linked_records(db: Session, data: dict, *, tenant_id: int) -> None:
    linked_checks = (
        ("contact_id", SalesContact, "contact_id", "Contact not found"),
        ("organization_id", SalesOrganization, "org_id", "Organization not found"),
        ("opportunity_id", SalesOpportunity, "opportunity_id", "Opportunity not found"),
        ("quote_id", SalesQuote, "quote_id", "Quote not found"),
        ("order_id", SalesOrder, "id", "Order not found"),
    )
    for field, model, id_attr, detail in linked_checks:
        record_id = data.get(field)
        if record_id is not None and not _linked_exists(db, model, id_attr, tenant_id=tenant_id, record_id=record_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
    _ensure_user(db, tenant_id=tenant_id, user_id=data.get("assigned_to_id"))


def _normalize_payload(db: Session, payload: dict, *, tenant_id: int, current_user, partial: bool = False) -> dict:
    data = dict(payload)
    for field in {"contact_id", "organization_id", "opportunity_id", "quote_id", "order_id", "assigned_to_id"}:
        if data.get(field) == "":
            data[field] = None
    if "subject" in data:
        data["subject"] = _clean_text(data["subject"])
        if not data["subject"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subject is required")
    elif not partial:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Subject is required")
    for field in {"description", "source"}:
        if field in data:
            data[field] = _clean_text(data[field])
    if "status" in data:
        data["status"] = _validate_choice(data["status"], CASE_STATUSES, default="new", detail="Invalid case status")
    elif not partial:
        data["status"] = "new"
    if "priority" in data:
        data["priority"] = _validate_choice(data["priority"], CASE_PRIORITIES, default="medium", detail="Invalid case priority")
    elif not partial:
        data["priority"] = "medium"
    if not partial:
        data["case_number"] = data.get("case_number") or _generate_case_number(db, tenant_id=tenant_id)
        data["created_by_id"] = current_user.id if current_user else None
    _ensure_linked_records(db, data, tenant_id=tenant_id)
    return data


def _generate_case_number(db: Session, *, tenant_id: int) -> str:
    prefix = f"CASE-{datetime.now(timezone.utc):%Y%m%d}"
    count = (
        db.query(SupportCase.id)
        .filter(SupportCase.tenant_id == tenant_id, SupportCase.case_number.like(f"{prefix}-%"))
        .count()
    )
    return f"{prefix}-{count + 1:04d}"


def _record_event(db: Session, case: SupportCase, *, event_type: str, current_user, payload: dict | None = None) -> SupportCaseEvent:
    event = SupportCaseEvent(
        tenant_id=case.tenant_id,
        case_id=case.id,
        event_type=event_type,
        payload_json=payload or {},
        created_by_id=current_user.id if current_user else None,
    )
    db.add(event)
    return event


def build_cases_query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(SupportCase).filter(SupportCase.tenant_id == tenant_id)
    field_map = {
        "case_number": {"expression": SupportCase.case_number, "type": "text"},
        "subject": {"expression": SupportCase.subject, "type": "text"},
        "status": {"expression": SupportCase.status, "type": "text"},
        "priority": {"expression": SupportCase.priority, "type": "text"},
        "source": {"expression": SupportCase.source, "type": "text"},
        "contact_id": {"expression": SupportCase.contact_id, "type": "number"},
        "organization_id": {"expression": SupportCase.organization_id, "type": "number"},
        "opportunity_id": {"expression": SupportCase.opportunity_id, "type": "number"},
        "quote_id": {"expression": SupportCase.quote_id, "type": "number"},
        "order_id": {"expression": SupportCase.order_id, "type": "number"},
        "assigned_to_id": {"expression": SupportCase.assigned_to_id, "type": "number"},
        "sla_due_at": {"expression": SupportCase.sla_due_at, "type": "date"},
        "created_at": {"expression": SupportCase.created_at, "type": "date"},
        "updated_at": {"expression": SupportCase.updated_at, "type": "date"},
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.filter(
            or_(
                func.lower(SupportCase.case_number).like(pattern),
                func.lower(SupportCase.subject).like(pattern),
                func.lower(func.coalesce(SupportCase.description, "")).like(pattern),
                func.lower(func.coalesce(SupportCase.source, "")).like(pattern),
            )
        )
    return query


def apply_support_case_sort(query, sort_by: str | None = None, sort_direction: str | None = None):
    column = SUPPORT_CASE_SORT_FIELDS.get((sort_by or "").strip())
    if column is None:
        return query.order_by(SupportCase.updated_at.desc(), SupportCase.id.desc())
    direction = (sort_direction or "asc").lower()
    primary = column.desc() if direction == "desc" else column.asc()
    secondary = SupportCase.id.desc() if direction == "desc" else SupportCase.id.asc()
    return query.order_by(primary, secondary)


def list_support_cases(
    db: Session,
    *,
    tenant_id: int,
    pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[Sequence[SupportCase], int]:
    query = build_cases_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    cases = apply_support_case_sort(query, sort_by=sort_by, sort_direction=sort_direction).offset(pagination.offset).limit(pagination.limit).all()
    return cases, total_count


def get_case_or_404(db: Session, *, tenant_id: int, case_id: int) -> SupportCase:
    item = (
        db.query(SupportCase)
        .options(selectinload(SupportCase.comments), selectinload(SupportCase.events))
        .filter(SupportCase.id == case_id, SupportCase.tenant_id == tenant_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Support case not found")
    return item


def create_support_case(db: Session, payload: dict, current_user) -> SupportCase:
    data = _normalize_payload(db, payload, tenant_id=current_user.tenant_id, current_user=current_user)
    item = SupportCase(tenant_id=current_user.tenant_id, **data)
    db.add(item)
    db.flush()
    _record_event(db, item, event_type="created", current_user=current_user)
    case_id = item.id
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Support case could not be created") from exc
    return get_case_or_404(db, tenant_id=current_user.tenant_id, case_id=case_id)


def update_support_case(db: Session, case: SupportCase, payload: dict, current_user) -> SupportCase:
    data = _normalize_payload(db, payload, tenant_id=case.tenant_id, current_user=current_user, partial=True)
    before_status = case.status
    now = datetime.now(timezone.utc)
    for key, value in data.items():
        setattr(case, key, value)
    if "status" in data and data["status"] != before_status:
        if data["status"] == "resolved" and case.resolved_at is None:
            case.resolved_at = now
        if data["status"] == "closed" and case.closed_at is None:
            case.closed_at = now
        if data["status"] not in CLOSED_STATUSES:
            case.resolved_at = None
            case.closed_at = None
        _record_event(db, case, event_type="status_changed", current_user=current_user, payload={"from": before_status, "to": data["status"]})
    else:
        _record_event(db, case, event_type="updated", current_user=current_user, payload={"fields": sorted(data)})
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Support case could not be updated") from exc
    return get_case_or_404(db, tenant_id=case.tenant_id, case_id=case.id)


def add_case_comment(db: Session, case: SupportCase, payload: dict, current_user) -> SupportCaseComment:
    body = _clean_text(payload.get("body"))
    if not body:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Comment body is required")
    comment = SupportCaseComment(
        tenant_id=case.tenant_id,
        case_id=case.id,
        author_id=current_user.id if current_user else None,
        body=body,
        is_internal=bool(payload.get("is_internal")),
    )
    db.add(comment)
    if case.first_response_at is None:
        case.first_response_at = datetime.now(timezone.utc)
    _record_event(db, case, event_type="commented", current_user=current_user, payload={"is_internal": bool(comment.is_internal)})
    db.commit()
    db.refresh(comment)
    return comment


def get_case_summary(db: Session, *, tenant_id: int) -> dict:
    now = datetime.now(timezone.utc)
    rows = (
        db.query(SupportCase.status, func.count(SupportCase.id))
        .filter(SupportCase.tenant_id == tenant_id)
        .group_by(SupportCase.status)
        .all()
    )
    by_status = {status: int(count) for status, count in rows}
    total_open = sum(count for status, count in by_status.items() if status not in CLOSED_STATUSES)
    urgent_open = (
        db.query(SupportCase.id)
        .filter(SupportCase.tenant_id == tenant_id, SupportCase.priority == "urgent", SupportCase.status.notin_(CLOSED_STATUSES))
        .count()
    )
    overdue = (
        db.query(SupportCase.id)
        .filter(SupportCase.tenant_id == tenant_id, SupportCase.sla_due_at.isnot(None), SupportCase.sla_due_at < now, SupportCase.status.notin_(CLOSED_STATUSES))
        .count()
    )
    return {"total_open": total_open, "urgent_open": urgent_open, "overdue": overdue, "by_status": by_status}
