"""Recurring invoices (13d §3.6, decision 10).

A profile is a schedule and the invoice to make. The hourly scan makes each due invoice
through the ordinary invoice service (numbering, tax, due date from terms), as a draft or
issued and emailed through the workspace sender. The invoices are ordinary invoices that name
their profile; the profile keeps no copy of them.
"""

from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.finance.models import FinancePosInvoice, FinanceRecurringInvoice
from app.modules.finance.services.document_amounts import money
from app.modules.platform.services.activity_logs import log_activity

logger = logging.getLogger(__name__)

MODULE_KEY = "finance_recurring_invoices"
FREQUENCIES = {"weekly": "week", "monthly": "month", "quarterly": "quarter", "yearly": "year"}
ACTIONS = {"draft", "issue_and_send"}
LINE_FIELDS = ("description", "quantity", "unit_price", "discount_amount", "discount_percent", "tax_rate_id", "tax_manual", "tax_amount",
               "line_type", "unit", "catalog_product_id", "catalog_service_id")


# Schedule ------------------------------------------------------------------------------------

def _add_months(value: date, months: int, anchor_day: int) -> date:
    month_index = value.month - 1 + months
    year, month = value.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(anchor_day, calendar.monthrange(year, month)[1]))


def advance(value: date, *, frequency: str, interval: int, anchor_day: int) -> date:
    """The run after `value`. Months keep the start date's day, clamped to short months, so a
    profile started on the 31st runs on the last day of February and the 31st of March."""
    if frequency == "weekly":
        return value + timedelta(weeks=interval)
    months = {"monthly": 1, "quarterly": 3, "yearly": 12}[frequency] * interval
    return _add_months(value, months, anchor_day)


def first_run_on_or_after(profile: FinanceRecurringInvoice, today: date) -> date:
    """A profile started in the past begins at its next scheduled date, not with a backlog."""
    run = profile.start_date
    while run < today:
        run = advance(run, frequency=profile.frequency, interval=profile.interval_count, anchor_day=profile.start_date.day)
    return run


def _finished(profile: FinanceRecurringInvoice, next_run: date | None) -> bool:
    if profile.max_count and profile.issued_count >= profile.max_count:
        return True
    return bool(next_run and profile.end_date and next_run > profile.end_date)


# Validation ----------------------------------------------------------------------------------

def _clean_lines(lines: Any) -> list[dict]:
    if not isinstance(lines, list) or not lines:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Add at least one line")
    cleaned = []
    for line in lines[:200]:
        if not isinstance(line, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Each line must be an object")
        row = {}
        for key in LINE_FIELDS:
            value = line.get(key)
            if isinstance(value, Decimal):
                value = str(value)
            if value is not None:
                row[key] = value
        cleaned.append(row)
    return cleaned


def _preview_totals(db: Session, profile: FinanceRecurringInvoice) -> dict:
    """Run the lines through the invoice line function on an unsaved invoice: the same checks
    and totals the issued invoices will have."""
    from app.modules.finance.services.pos_invoice_services import _apply_lines

    draft = FinancePosInvoice(tenant_id=profile.tenant_id, tax_mode=profile.tax_mode, customer_organization_id=profile.customer_organization_id,
                              customer_name=profile.customer_name, currency=profile.currency)
    with db.no_autoflush:
        _apply_lines(db, draft, [dict(line) for line in profile.lines or []])
    totals = {"subtotal_amount": money(draft.subtotal_amount), "discount_amount": money(draft.discount_amount),
              "tax_amount": money(draft.tax_amount), "total_amount": money(draft.total_amount)}
    for line in list(draft.lines):
        if line in db:
            db.expunge(line)
    return totals


def _customer(db: Session, profile: FinanceRecurringInvoice, payload: dict) -> None:
    from app.modules.sales.models import SalesContact, SalesOrganization

    if "customer_organization_id" in payload:
        org_id = payload.get("customer_organization_id")
        if org_id is not None and not db.query(SalesOrganization.org_id).filter(
                SalesOrganization.tenant_id == profile.tenant_id, SalesOrganization.org_id == int(org_id), SalesOrganization.deleted_at.is_(None)).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose an account from this workspace")
        profile.customer_organization_id = int(org_id) if org_id is not None else None
    if "customer_contact_id" in payload:
        contact_id = payload.get("customer_contact_id")
        contact = None
        if contact_id is not None:
            contact = db.query(SalesContact).filter(SalesContact.tenant_id == profile.tenant_id, SalesContact.contact_id == int(contact_id),
                                                    SalesContact.deleted_at.is_(None)).first()
            if contact is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose a contact from this workspace")
        profile.customer_contact_id = contact.contact_id if contact else None
        if contact and contact.organization_id and not profile.customer_organization_id:
            profile.customer_organization_id = contact.organization_id
    name = " ".join(str(payload.get("customer_name") or "").split())
    if not name and profile.customer_organization_id:
        name = db.query(SalesOrganization.org_name).filter(SalesOrganization.org_id == profile.customer_organization_id).scalar() or ""
    if name:
        profile.customer_name = name
    if not profile.customer_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose the customer")
    if "customer_email" in payload:
        profile.customer_email = (payload.get("customer_email") or "").strip() or None


def _date(value, field: str) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Enter the {field} as a date") from exc


def save_profile(db: Session, current_user, payload: dict, *, profile: FinanceRecurringInvoice | None = None,
                 today: date | None = None) -> FinanceRecurringInvoice:
    from app.modules.finance.services import tax_rates
    from app.modules.finance.services.pos_invoice_services import _currency

    today = today or date.today()
    creating = profile is None
    profile = profile or FinanceRecurringInvoice(tenant_id=current_user.tenant_id, created_by=current_user.id, issued_count=0, active=True,
                                                 interval_count=1, frequency="monthly", action="draft", lines=[])
    before = serialize_profile(db, profile, include_totals=False) if not creating else None
    if "name" in payload or creating:
        name = " ".join(str(payload.get("name") or "").split())[:200]
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Name the recurring invoice")
        profile.name = name
    _customer(db, profile, payload)
    if "currency" in payload or creating:
        profile.currency = _currency(db, current_user, payload.get("currency"))
    if "tax_mode" in payload or creating:
        profile.tax_mode = tax_rates.normalize_tax_mode(payload.get("tax_mode"), default=tax_rates.default_tax_mode(db, tenant_id=profile.tenant_id))
    for field in ("notes", "payment_terms"):
        if field in payload:
            setattr(profile, field, (payload.get(field) or "").strip() or None)
    if "frequency" in payload:
        if payload["frequency"] not in FREQUENCIES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose weekly, monthly, quarterly or yearly")
        profile.frequency = payload["frequency"]
    if payload.get("interval_count") is not None:
        interval = int(payload["interval_count"])
        if not 1 <= interval <= 52:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Repeat every 1 to 52 periods")
        profile.interval_count = interval
    if "action" in payload:
        if payload["action"] not in ACTIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Choose to save drafts or to issue and send")
        profile.action = payload["action"]
    schedule_changed = creating or any(key in payload for key in ("start_date", "frequency", "interval_count"))
    if "start_date" in payload or creating:
        profile.start_date = _date(payload.get("start_date"), "start date") or today
    if "end_date" in payload:
        profile.end_date = _date(payload.get("end_date"), "end date")
    if "max_count" in payload:
        profile.max_count = int(payload["max_count"]) if payload.get("max_count") not in (None, "") else None
        if profile.max_count is not None and profile.max_count < 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Make at least one invoice")
    if profile.end_date and profile.end_date < profile.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The end date cannot be before the start date")
    if "lines" in payload or creating:
        profile.lines = _clean_lines(payload.get("lines"))
    if "active" in payload and payload["active"] is not None:
        profile.active = bool(payload["active"])
    _preview_totals(db, profile)
    if schedule_changed or (profile.active and profile.next_run_date is None):
        next_run = first_run_on_or_after(profile, today)
        profile.next_run_date = None if _finished(profile, next_run) else next_run
    if profile.next_run_date is None and profile.active and _finished(profile, None):
        profile.active = False
    db.add(profile)
    db.flush()
    log_activity(db, tenant_id=profile.tenant_id, actor_user_id=current_user.id, module_key=MODULE_KEY, entity_type=MODULE_KEY,
                 entity_id=profile.id, action="create" if creating else "update",
                 description=f"{'Created' if creating else 'Updated'} recurring invoice {profile.name}",
                 before_state=before, after_state=serialize_profile(db, profile, include_totals=False), commit=False)
    return profile


# Reading -------------------------------------------------------------------------------------

def get_profile(db: Session, *, tenant_id: int, profile_id: int, include_deleted: bool = False) -> FinanceRecurringInvoice:
    query = db.query(FinanceRecurringInvoice).filter(FinanceRecurringInvoice.tenant_id == tenant_id, FinanceRecurringInvoice.id == profile_id)
    if not include_deleted:
        query = query.filter(FinanceRecurringInvoice.deleted_at.is_(None))
    profile = query.first()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring invoice not found")
    return profile


def schedule_label(profile: FinanceRecurringInvoice) -> str:
    unit = FREQUENCIES.get(profile.frequency, "month")
    if profile.interval_count == 1:
        return profile.frequency.capitalize()
    return f"Every {profile.interval_count} {unit}s"


def serialize_profile(db: Session, profile: FinanceRecurringInvoice, *, include_totals: bool = True, include_invoices: bool = False) -> dict:
    data = {
        "id": profile.id, "name": profile.name, "customer_name": profile.customer_name, "customer_email": profile.customer_email,
        "customer_organization_id": profile.customer_organization_id, "customer_contact_id": profile.customer_contact_id,
        "customer_organization_name": profile.customer_organization.org_name if profile.customer_organization else None,
        "customer_contact_name": (" ".join(part for part in (profile.customer_contact.first_name, profile.customer_contact.last_name) if part)
                                  or profile.customer_contact.primary_email) if profile.customer_contact else None,
        "currency": profile.currency, "tax_mode": profile.tax_mode, "lines": profile.lines or [], "notes": profile.notes,
        "payment_terms": profile.payment_terms, "frequency": profile.frequency, "interval_count": profile.interval_count,
        "schedule": schedule_label(profile), "start_date": profile.start_date, "end_date": profile.end_date, "max_count": profile.max_count,
        "next_run_date": profile.next_run_date, "issued_count": profile.issued_count, "action": profile.action, "active": bool(profile.active),
        "status": "active" if profile.active else ("finished" if profile.next_run_date is None and profile.issued_count else "paused"),
        "last_run_at": profile.last_run_at, "last_error": profile.last_error, "created_at": profile.created_at, "updated_at": profile.updated_at,
        "deleted_at": profile.deleted_at,
    }
    if include_totals:
        try:
            data.update({key: float(value) for key, value in _preview_totals(db, profile).items()})
        except HTTPException as exc:
            # A rate or item removed since: the profile still opens, and says what to fix.
            data["lines_error"] = exc.detail
    if include_invoices and profile.id:
        invoices = db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == profile.tenant_id,
                                                      FinancePosInvoice.recurring_invoice_id == profile.id,
                                                      FinancePosInvoice.deleted_at.is_(None)).order_by(FinancePosInvoice.id.desc()).limit(50).all()
        data["invoices"] = [{"id": invoice.id, "invoice_number": invoice.invoice_number, "status": invoice.status,
                             "payment_status": invoice.payment_status, "issue_date": invoice.issue_date, "total_amount": float(invoice.total_amount),
                             "balance_due": float(invoice.balance_due), "currency": invoice.currency} for invoice in invoices]
    return data


def list_field_map() -> dict:
    """The recurring invoice list's saved-view fields."""
    model = FinanceRecurringInvoice
    return {
        "name": {"expression": model.name, "type": "text"},
        "customer_name": {"expression": model.customer_name, "type": "text"},
        "frequency": {"expression": model.frequency, "type": "text"},
        "action": {"expression": model.action, "type": "text"},
        "currency": {"expression": model.currency, "type": "text"},
        "active": {"expression": model.active, "type": "boolean"},
        "next_run_date": {"expression": model.next_run_date, "type": "date"},
        "start_date": {"expression": model.start_date, "type": "date"},
        "end_date": {"expression": model.end_date, "type": "date"},
        "issued_count": {"expression": model.issued_count, "type": "number"},
        "customer_organization_id": {"expression": model.customer_organization_id, "type": "number"},
        "created_at": {"expression": model.created_at, "type": "date"},
    }


def list_query(db: Session, *, tenant_id: int, search: str | None = None, status_filter: str | None = None,
               filters_all=None, filters_any=None):
    from app.core.list_conditions import apply_list_conditions

    query = db.query(FinanceRecurringInvoice).filter(FinanceRecurringInvoice.tenant_id == tenant_id, FinanceRecurringInvoice.deleted_at.is_(None))
    if search:
        like = f"%{search.strip().lower()}%"
        query = query.filter(func.lower(FinanceRecurringInvoice.name).like(like) | func.lower(FinanceRecurringInvoice.customer_name).like(like))
    if status_filter == "active":
        query = query.filter(FinanceRecurringInvoice.active.is_(True))
    elif status_filter in {"paused", "finished"}:
        query = query.filter(FinanceRecurringInvoice.active.is_(False))
    query = apply_list_conditions(query, field_map=list_field_map(), filters_all=filters_all, filters_any=filters_any)
    return query.order_by(FinanceRecurringInvoice.id.desc())


# Lifecycle -----------------------------------------------------------------------------------

def soft_delete(db: Session, *, profile: FinanceRecurringInvoice, actor_user_id: int | None) -> None:
    profile.deleted_at = datetime.now(timezone.utc)
    profile.active = False
    db.add(profile)
    log_activity(db, tenant_id=profile.tenant_id, actor_user_id=actor_user_id, module_key=MODULE_KEY, entity_type=MODULE_KEY,
                 entity_id=profile.id, action="delete", description=f"Deleted recurring invoice {profile.name}", commit=False)


def restore(db: Session, *, profile: FinanceRecurringInvoice, actor_user_id: int | None) -> FinanceRecurringInvoice:
    """Back from the recycle bin, paused: an admin turns it on again on purpose."""
    profile.deleted_at = None
    profile.active = False
    db.add(profile)
    log_activity(db, tenant_id=profile.tenant_id, actor_user_id=actor_user_id, module_key=MODULE_KEY, entity_type=MODULE_KEY,
                 entity_id=profile.id, action="restore", description=f"Restored recurring invoice {profile.name}", commit=False)
    return profile


def draft_from_invoice(db: Session, current_user, invoice_id: int) -> dict:
    """*Make recurring*: the invoice's customer, lines and terms, as the form's starting values."""
    from app.modules.finance.services import tax_rates
    from app.modules.finance.services.pos_invoice_services import get_invoice_or_404

    invoice = get_invoice_or_404(db, current_user, invoice_id)
    lines = []
    # Order and delivery links are not copied: a repeat bills the item, not the order's quantities.
    for line in invoice.lines:
        lines.append({"description": line.description, "quantity": str(line.quantity), "unit_price": str(line.unit_price),
                      "discount_amount": str(line.discount_amount), "catalog_product_id": line.catalog_product_id,
                      "catalog_service_id": line.catalog_service_id, **{key: (str(value) if isinstance(value, Decimal) else value)
                                                                         for key, value in tax_rates.line_payload(line).items()},
                      "line_type": line.line_type, "unit": line.unit,
                      "discount_percent": str(line.discount_percent) if line.discount_percent is not None else None})
    return {
        "name": f"{invoice.customer_name} — monthly", "customer_name": invoice.customer_name, "customer_email": invoice.customer_email,
        "customer_organization_id": invoice.customer_organization_id, "customer_contact_id": invoice.customer_contact_id,
        "customer_organization_name": invoice.customer_organization.org_name if invoice.customer_organization else None,
        "currency": invoice.currency, "tax_mode": invoice.tax_mode, "notes": invoice.notes, "payment_terms": invoice.payment_terms,
        "frequency": "monthly", "interval_count": 1, "action": "draft", "lines": _clean_lines(lines), "source_invoice_id": invoice.id,
        "source_invoice_number": invoice.invoice_number,
    }


# The scan ------------------------------------------------------------------------------------

def _invoice_payload(profile: FinanceRecurringInvoice, run_date: date) -> dict:
    return {
        "customer_name": profile.customer_name, "customer_email": profile.customer_email,
        "customer_contact_id": profile.customer_contact_id, "customer_organization_id": profile.customer_organization_id,
        "currency": profile.currency, "tax_mode": profile.tax_mode, "lines": [dict(line) for line in profile.lines or []],
        "notes": profile.notes, "payment_terms": profile.payment_terms, "issue_date": run_date.isoformat(), "source": "manual",
        "issue": profile.action == "issue_and_send",
    }


def run_profile(db: Session, profile: FinanceRecurringInvoice, *, today: date | None = None) -> FinancePosInvoice:
    """Make the profile's due invoice and move it to its next date. Raises on failure; the
    caller decides whether that ends the transaction."""
    from app.modules.finance.services import receivables
    from app.modules.finance.services.pos_invoice_services import create_invoice

    run_date = profile.next_run_date or today or date.today()
    actor = receivables.system_actor(profile.tenant_id, profile.created_by)
    invoice = create_invoice(db, actor, _invoice_payload(profile, run_date), commit=False)
    invoice.recurring_invoice_id = profile.id
    db.add(invoice)
    profile.issued_count = (profile.issued_count or 0) + 1
    profile.last_run_at = datetime.now(timezone.utc)
    profile.last_error = None
    next_run = advance(run_date, frequency=profile.frequency, interval=profile.interval_count, anchor_day=profile.start_date.day)
    if _finished(profile, next_run):
        profile.next_run_date, profile.active = None, False
    else:
        profile.next_run_date = next_run
    db.add(profile)
    db.flush()
    label = invoice.invoice_number or "a draft invoice"
    log_activity(db, tenant_id=profile.tenant_id, actor_user_id=None, module_key=MODULE_KEY, entity_type=MODULE_KEY, entity_id=profile.id,
                 action="recurring_invoice.run", description=f"Made {label} for {run_date.isoformat()}",
                 after_state={"invoice_id": invoice.id, "next_run_date": profile.next_run_date.isoformat() if profile.next_run_date else None},
                 commit=False)
    log_activity(db, tenant_id=profile.tenant_id, actor_user_id=None, module_key="finance_pos", entity_type="finance_pos_invoice",
                 entity_id=invoice.id, action="recurring_invoice.created", description=f"Made by recurring invoice {profile.name}", commit=False)
    return invoice


def _send(db: Session, profile: FinanceRecurringInvoice, invoice: FinancePosInvoice) -> None:
    """Email an issued recurring invoice. A send that fails leaves the invoice issued and says
    why on the profile and the invoice; it is not retried."""
    from app.modules.finance.services import receivables

    subject, body = receivables.invoice_template(db, profile.tenant_id)
    try:
        recipient = receivables.send_invoice_email(db, invoice, subject=subject, body=body, attach_pdf=True, reason="recurring send")
    except Exception as exc:  # the sender's message is what the admin needs
        message = str(exc) or exc.__class__.__name__
        profile.last_error = f"{invoice.invoice_number} was issued but not emailed: {message}"[:1000]
        db.add(profile)
        log_activity(db, tenant_id=profile.tenant_id, actor_user_id=None, module_key="finance_pos", entity_type="finance_pos_invoice",
                     entity_id=invoice.id, action="document.send_failed", description=f"Not emailed: {message}"[:500], commit=False)
        if not isinstance(exc, ValueError):
            logger.exception("Recurring invoice email failed", extra={"tenant_id": profile.tenant_id, "profile_id": profile.id})
        return
    log_activity(db, tenant_id=profile.tenant_id, actor_user_id=None, module_key="finance_pos", entity_type="finance_pos_invoice",
                 entity_id=invoice.id, action="document.sent", description=f"Sent invoice {invoice.invoice_number} to {recipient} with its PDF",
                 after_state={"recipients": [recipient], "attached_pdf": True, "automatic": True}, commit=False)


def scan_due(db: Session, *, today: date | None = None) -> dict:
    """The hourly scan: one invoice per due profile per run (a missed day is caught up on the
    next runs, one period at a time)."""
    today = today or date.today()
    result = {"made": 0, "failed": 0}
    ids = [row[0] for row in db.query(FinanceRecurringInvoice.id).filter(
        FinanceRecurringInvoice.active.is_(True), FinanceRecurringInvoice.deleted_at.is_(None),
        FinanceRecurringInvoice.next_run_date.isnot(None), FinanceRecurringInvoice.next_run_date <= today).order_by(FinanceRecurringInvoice.id)]
    for profile_id in ids:
        profile = db.query(FinanceRecurringInvoice).filter(FinanceRecurringInvoice.id == profile_id).with_for_update(skip_locked=True).first()
        if profile is None or not profile.active or profile.next_run_date is None or profile.next_run_date > today:
            db.rollback()
            continue
        try:
            invoice = run_profile(db, profile, today=today)
            db.commit()
        except Exception as exc:
            db.rollback()
            result["failed"] += 1
            profile = db.query(FinanceRecurringInvoice).filter(FinanceRecurringInvoice.id == profile_id).first()
            detail = exc.detail if isinstance(exc, HTTPException) else (str(exc) or exc.__class__.__name__)
            if profile is not None:
                profile.last_error = f"The {profile.next_run_date.isoformat()} invoice could not be made: {detail}"[:1000]
                profile.last_run_at = datetime.now(timezone.utc)
                db.add(profile)
                db.commit()
            logger.warning("Recurring invoice run failed", extra={"profile_id": profile_id, "detail": str(detail)[:200]})
            continue
        result["made"] += 1
        if profile.action == "issue_and_send" and invoice.status == "issued":
            _send(db, profile, invoice)
            db.commit()
    return result
