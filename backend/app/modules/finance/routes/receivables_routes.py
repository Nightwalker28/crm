"""Receivables (13d §3.6): recurring invoices, payment reminders, statements and write-offs.

Recurring invoices clear the three access layers on their own module; reminder rules are a
workspace setting (admins, like Settings → Taxes); statements need invoice view access and the
account; a write-off needs invoice edit access, and *configure* above the company's limit.
"""

from datetime import date
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.list_conditions import ListConditions, list_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import can_access, require_access, require_action_access, require_module_access
from app.core.security import require_admin, require_user
from app.core.unit_of_work import unit_of_work
from app.modules.catalog.services.line_links import require_catalog_line_link_access
from app.modules.finance.services import receivables
from app.modules.finance.services import recurring_invoices as recurring

router = APIRouter(tags=["Finance receivables"])

RECURRING = recurring.MODULE_KEY
INVOICES = "finance_pos"


# --- Recurring invoices ---------------------------------------------------------------------


class RecurringPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(default=None, max_length=200)
    customer_name: str | None = Field(default=None, max_length=300)
    customer_email: str | None = Field(default=None, max_length=320)
    customer_organization_id: int | None = Field(default=None, gt=0)
    customer_contact_id: int | None = Field(default=None, gt=0)
    currency: str | None = Field(default=None, max_length=10)
    tax_mode: Literal["exclusive", "inclusive"] | None = None
    lines: list[dict[str, Any]] | None = Field(default=None, max_length=200)
    notes: str | None = None
    payment_terms: str | None = Field(default=None, max_length=500)
    frequency: Literal["weekly", "monthly", "quarterly", "yearly"] | None = None
    interval_count: int | None = Field(default=None, ge=1, le=52)
    start_date: date | None = None
    end_date: date | None = None
    max_count: int | None = Field(default=None, ge=1, le=1000)
    action: Literal["draft", "issue_and_send"] | None = None
    active: bool | None = None


def _profile(db: Session, tenant_id: int, profile_id: int) -> dict:
    profile = recurring.get_profile(db, tenant_id=tenant_id, profile_id=profile_id)
    return jsonable_encoder(recurring.serialize_profile(db, profile, include_invoices=True))


def _check_issue_rights(db: Session, user, payload: dict) -> None:
    require_access(db, user, INVOICES, "create", detail="Recurring invoices make invoices, which needs access to create invoices")
    if payload.get("action") == "issue_and_send":
        require_access(db, user, INVOICES, "edit", detail="Issuing invoices automatically needs edit access to invoices")
    if payload.get("lines"):
        require_catalog_line_link_access(db, user=user, lines=payload["lines"])


@router.get("/recurring-invoices")
def list_recurring(status_filter: str | None = Query(default=None, alias="status", pattern="^(active|paused|finished)$"),
                   search: str | None = Query(default=None, max_length=100), conditions: ListConditions = Depends(list_conditions),
                   pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(RECURRING)), _view=Depends(require_action_access(RECURRING, "view"))):
    query = recurring.list_query(db, tenant_id=user.tenant_id, search=search, status_filter=status_filter, **conditions.as_filters())
    total = query.count()
    rows = query.offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(jsonable_encoder([recurring.serialize_profile(db, row, include_totals=False) for row in rows]), total, pagination)


@router.get("/recurring-invoices/from-invoice/{invoice_id}")
def recurring_from_invoice(invoice_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                           _module=Depends(require_module_access(RECURRING)), _create=Depends(require_action_access(RECURRING, "create"))):
    """*Make recurring*: the form's starting values, copied from the invoice."""
    require_access(db, user, INVOICES, "view", detail="Copying an invoice needs access to invoices")
    return jsonable_encoder(recurring.draft_from_invoice(db, user, invoice_id))


@router.post("/recurring-invoices", status_code=status.HTTP_201_CREATED)
def create_recurring(payload: RecurringPayload, db: Session = Depends(get_db), user=Depends(require_user),
                     _module=Depends(require_module_access(RECURRING)), _create=Depends(require_action_access(RECURRING, "create"))):
    data = payload.model_dump(exclude_unset=True)
    _check_issue_rights(db, user, data)
    with unit_of_work(db):
        profile = recurring.save_profile(db, user, data)
    return _profile(db, user.tenant_id, profile.id)


@router.get("/recurring-invoices/{profile_id}")
def get_recurring(profile_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(RECURRING)), _view=Depends(require_action_access(RECURRING, "view"))):
    return _profile(db, user.tenant_id, profile_id)


@router.patch("/recurring-invoices/{profile_id}")
def update_recurring(profile_id: int, payload: RecurringPayload, db: Session = Depends(get_db), user=Depends(require_user),
                     _module=Depends(require_module_access(RECURRING)), _edit=Depends(require_action_access(RECURRING, "edit"))):
    data = payload.model_dump(exclude_unset=True)
    _check_issue_rights(db, user, data)
    with unit_of_work(db):
        profile = recurring.get_profile(db, tenant_id=user.tenant_id, profile_id=profile_id)
        recurring.save_profile(db, user, data, profile=profile)
    return _profile(db, user.tenant_id, profile_id)


@router.post("/recurring-invoices/{profile_id}/run")
def run_recurring_now(profile_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                      _module=Depends(require_module_access(RECURRING)), _edit=Depends(require_action_access(RECURRING, "edit"))):
    """*Make the next invoice now*: the due run, early. The schedule moves on as if it ran."""
    with unit_of_work(db):
        profile = recurring.get_profile(db, tenant_id=user.tenant_id, profile_id=profile_id)
        _check_issue_rights(db, user, {"action": profile.action})
        if not profile.active or profile.next_run_date is None:
            raise HTTPException(status_code=409, detail="This recurring invoice is paused or finished; turn it on first")
        invoice = recurring.run_profile(db, profile)
    if profile.action == "issue_and_send" and invoice.status == "issued":
        recurring._send(db, profile, invoice)
        db.commit()
    return {"invoice_id": invoice.id, "invoice_number": invoice.invoice_number, "profile": _profile(db, user.tenant_id, profile_id)}


@router.delete("/recurring-invoices/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring(profile_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                     _module=Depends(require_module_access(RECURRING)), _delete=Depends(require_action_access(RECURRING, "delete"))):
    with unit_of_work(db):
        recurring.soft_delete(db, profile=recurring.get_profile(db, tenant_id=user.tenant_id, profile_id=profile_id), actor_user_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/recurring-invoices/{profile_id}/restore")
def restore_recurring(profile_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                      _module=Depends(require_module_access(RECURRING)), _restore=Depends(require_action_access(RECURRING, "restore"))):
    with unit_of_work(db):
        recurring.restore(db, profile=recurring.get_profile(db, tenant_id=user.tenant_id, profile_id=profile_id, include_deleted=True),
                          actor_user_id=user.id)
    return _profile(db, user.tenant_id, profile_id)


# --- Reminder rules -------------------------------------------------------------------------


class ReminderRulePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    days_offset: int | None = Field(default=None, ge=-60, le=365)
    subject: str | None = Field(default=None, min_length=1, max_length=300)
    body: str | None = Field(default=None, min_length=1, max_length=10_000)
    attach_pdf: bool | None = None
    active: bool | None = None


@router.get("/reminder-rules")
def list_reminder_rules(db: Session = Depends(get_db), user=Depends(require_admin)):
    with unit_of_work(db):
        receivables.ensure_default_reminder_rules(db, user.tenant_id)
    return {"items": jsonable_encoder(receivables.list_rules(db, tenant_id=user.tenant_id))}


@router.post("/reminder-rules", status_code=status.HTTP_201_CREATED)
def create_reminder_rule(payload: ReminderRulePayload, db: Session = Depends(get_db), user=Depends(require_admin)):
    with unit_of_work(db):
        rule = receivables.save_rule(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(exclude_unset=True))
    return jsonable_encoder(receivables.serialize_rule(rule))


@router.patch("/reminder-rules/{rule_id}")
def update_reminder_rule(rule_id: int, payload: ReminderRulePayload, db: Session = Depends(get_db), user=Depends(require_admin)):
    with unit_of_work(db):
        rule = receivables.save_rule(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(exclude_unset=True),
                                     rule_id=rule_id)
    return jsonable_encoder(receivables.serialize_rule(rule))


@router.delete("/reminder-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_reminder_rule(rule_id: int, db: Session = Depends(get_db), user=Depends(require_admin)):
    with unit_of_work(db):
        receivables.delete_rule(db, tenant_id=user.tenant_id, actor_user_id=user.id, rule_id=rule_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- Statements -----------------------------------------------------------------------------


def _statement_access(db: Session, user) -> None:
    require_access(db, user, INVOICES, "view", detail="A statement needs access to invoices")
    require_access(db, user, "sales_organizations", "view", detail="A statement needs access to accounts")


def _statement(db: Session, user, org_id: int, start: date | None, end: date | None, kind: str, currency: str | None) -> dict:
    _statement_access(db, user)
    return receivables.customer_statement(db, tenant_id=user.tenant_id, org_id=org_id, start=start, end=end, kind=kind, currency=currency)


@router.get("/statements/{org_id}")
def get_statement(org_id: int, start: date | None = Query(default=None, alias="from"), end: date | None = Query(default=None, alias="to"),
                  kind: Literal["activity", "open"] = Query(default="activity"), currency: str | None = Query(default=None, max_length=10),
                  db: Session = Depends(get_db), user=Depends(require_user)):
    statement = _statement(db, user, org_id, start, end, kind, currency)
    return jsonable_encoder({**statement, "balances": receivables.account_balance(db, tenant_id=user.tenant_id, org_id=org_id)})


@router.get("/statements/{org_id}/preview")
def preview_statement(org_id: int, start: date | None = Query(default=None, alias="from"), end: date | None = Query(default=None, alias="to"),
                      kind: Literal["activity", "open"] = Query(default="activity"), currency: str | None = Query(default=None, max_length=10),
                      db: Session = Depends(get_db), user=Depends(require_user)):
    statement = _statement(db, user, org_id, start, end, kind, currency)
    html = receivables.statement_html(db, tenant_id=user.tenant_id, statement=statement)
    return Response(content=html, media_type="text/html",
                    headers={"Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'", "Cache-Control": "private, no-store"})


@router.get("/statements/{org_id}/pdf")
def download_statement(org_id: int, start: date | None = Query(default=None, alias="from"), end: date | None = Query(default=None, alias="to"),
                       kind: Literal["activity", "open"] = Query(default="activity"), currency: str | None = Query(default=None, max_length=10),
                       db: Session = Depends(get_db), user=Depends(require_user)):
    statement = _statement(db, user, org_id, start, end, kind, currency)
    try:
        content, filename = receivables.statement_pdf(db, tenant_id=user.tenant_id, statement=statement)
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="PDFs are not available right now") from exc
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "private, no-store"})


# --- Write-off ------------------------------------------------------------------------------


class WriteOffPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.post("/invoices/{invoice_id}/write-off")
def write_off(invoice_id: int, payload: WriteOffPayload, db: Session = Depends(get_db), user=Depends(require_user),
              _module=Depends(require_module_access(INVOICES)), _edit=Depends(require_action_access(INVOICES, "edit"))):
    from app.modules.finance.services.pos_invoice_services import get_invoice_or_404

    with unit_of_work(db):
        invoice = get_invoice_or_404(db, user, invoice_id, lock=True)
        receivables.write_off_invoice(db, invoice=invoice, actor_user_id=user.id, reason=payload.reason,
                                      may_exceed_limit=can_access(db, user, INVOICES, "configure"))
    return {"invoice_id": invoice_id, "balance_due": float(invoice.balance_due), "payment_status": invoice.payment_status,
            "amount_written_off": float(Decimal(invoice.amount_written_off or 0))}


@router.delete("/invoices/{invoice_id}/write-offs/{write_off_id}", status_code=status.HTTP_204_NO_CONTENT)
def reverse_write_off(invoice_id: int, write_off_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                      _module=Depends(require_module_access(INVOICES)), _configure=Depends(require_action_access(INVOICES, "configure"))):
    """Reopen a written-off balance; finance administrators only."""
    from app.modules.finance.services.pos_invoice_services import get_invoice_or_404

    with unit_of_work(db):
        invoice = get_invoice_or_404(db, user, invoice_id, lock=True)
        receivables.reverse_write_off(db, invoice=invoice, write_off_id=write_off_id, actor_user_id=user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
