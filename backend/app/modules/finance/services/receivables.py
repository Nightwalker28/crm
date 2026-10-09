"""Receivables (13d §3.6): payment reminders, customer statements and write-offs, and the
automatic mail that recurring invoices and reminders send.

Automatic mail goes through the workspace SMTP sender (decision 6), never a user's mailbox.
Reminders are opt-in (decision 12): the seeded rules start inactive.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.finance.models import (
    FinanceCreditNote,
    FinancePayment,
    FinancePaymentAllocation,
    FinancePosInvoice,
    FinanceReminderRule,
    FinanceReminderSend,
    FinanceWriteOff,
)
from app.modules.finance.services.document_amounts import ZERO, money
from app.modules.finance.services.invoice_balances import refresh_invoice_balance
from app.modules.platform.services.activity_logs import log_activity

logger = logging.getLogger(__name__)

INVOICES = "finance_pos"
AGEING_BUCKETS = (("current", "Current"), ("1_30", "1–30 days"), ("31_60", "31–60 days"), ("61_90", "61–90 days"), ("90_plus", "Over 90 days"))
TOKEN = re.compile(r"\{\{\s*([a-z_]+)\.([a-z_]+)\s*\}\}")


# Automatic mail ------------------------------------------------------------------------------

def render_tokens(text: str, values: dict[str, dict[str, str]]) -> str:
    """`{{document.number}}`-style tokens from `values`; an unknown token renders empty."""
    return TOKEN.sub(lambda match: str(values.get(match.group(1), {}).get(match.group(2), "") or ""), text or "")


def invoice_recipient(invoice: FinancePosInvoice) -> str | None:
    """Where an invoice's automatic mail goes: its own address, its contact's, its account's."""
    for value in (invoice.customer_email, getattr(invoice.customer_contact, "primary_email", None),
                  getattr(invoice.customer_organization, "primary_email", None)):
        if value and "@" in value:
            return value.strip()
    return None


def invoice_tokens(db: Session, invoice: FinancePosInvoice) -> dict[str, dict[str, str]]:
    from app.modules.platform.services import document_pdfs
    from app.modules.platform.services.document_send import token_values

    kind = document_pdfs.kind_for(INVOICES)
    company = document_pdfs._company(db, invoice.tenant_id)
    contact = invoice.customer_contact
    days_overdue = (date.today() - invoice.due_date).days if invoice.due_date else 0
    return {
        "document": {**token_values(invoice, kind), "days_overdue": str(max(days_overdue, 0))},
        "contact": {"first_name": (contact.first_name if contact else None) or invoice.customer_name, "last_name": (contact.last_name if contact else "") or ""},
        "customer": {"name": invoice.customer_name},
        "company": {"name": company["name"]},
        # The sender of automatic mail is the company, not a person.
        "user": {"full_name": company["name"], "first_name": company["name"]},
    }


def system_actor(tenant_id: int, user_id: int | None = None) -> SimpleNamespace:
    return SimpleNamespace(id=user_id, tenant_id=tenant_id, first_name=None, last_name=None, email=None)


def invoice_pdf_attachment(db: Session, invoice: FinancePosInvoice, *, reason: str) -> tuple[str, bytes, str] | None:
    """The invoice's PDF for an automatic message, or None when PDFs cannot be made here."""
    from app.modules.platform.services.document_pdfs import document_pdf

    try:
        content, filename = document_pdf(db, system_actor(invoice.tenant_id), INVOICES, invoice.id, reason=reason, as_issued=True)
    except ImportError:
        logger.warning("PDF renderer unavailable; sending without the invoice PDF", extra={"tenant_id": invoice.tenant_id})
        return None
    return filename, content, "application/pdf"


def send_invoice_email(db: Session, invoice: FinancePosInvoice, *, subject: str, body: str, attach_pdf: bool, reason: str) -> str:
    """Send to the invoice's customer through the workspace sender. Returns the address; raises
    ValueError with what is missing."""
    from app.modules.mail.services.tenant_mail import send_system_message

    recipient = invoice_recipient(invoice)
    if not recipient:
        raise ValueError("The customer has no email address")
    tokens = invoice_tokens(db, invoice)
    attachment = invoice_pdf_attachment(db, invoice, reason=reason) if attach_pdf else None
    send_system_message(db, tenant_id=invoice.tenant_id, recipient=recipient, subject=render_tokens(subject, tokens),
                        body=render_tokens(body, tokens), attachment=attachment)
    return recipient


def invoice_template(db: Session, tenant_id: int) -> tuple[str, str]:
    """The invoice type's email template (Settings → Documents), else the built-in one."""
    from app.modules.platform.models import DocumentSetting, MessageTemplate
    from app.modules.platform.services.document_send import DEFAULT_TEMPLATES

    subject = "Invoice {{document.number}} from {{company.name}}"
    body = DEFAULT_TEMPLATES["invoice"][1]
    setting = db.query(DocumentSetting).filter(DocumentSetting.tenant_id == tenant_id, DocumentSetting.kind == "invoice").first()
    if setting and setting.email_template_id:
        template = db.query(MessageTemplate).filter(MessageTemplate.tenant_id == tenant_id, MessageTemplate.id == setting.email_template_id,
                                                    MessageTemplate.is_active.is_(True)).first()
        if template is not None:
            body = template.body or body
            subject = getattr(template, "subject", None) or subject
    return subject, body


# Reminder rules ------------------------------------------------------------------------------

DEFAULT_REMINDER_RULES = (
    ("Before the due date", -3, "Invoice {{document.number}} is due on {{document.due_date}}",
     "Hello {{contact.first_name}},\n\nA friendly reminder that invoice {{document.number}} for {{document.currency}} "
     "{{document.balance_due}} is due on {{document.due_date}}. The invoice is attached.\n\nIf you have already paid, "
     "thank you, and please ignore this message.\n\nKind regards,\n{{company.name}}"),
    ("A day overdue", 1, "Invoice {{document.number}} is now overdue",
     "Hello {{contact.first_name}},\n\nInvoice {{document.number}} for {{document.currency}} {{document.balance_due}} was due on "
     "{{document.due_date}} and is still open. The invoice is attached.\n\nIf you have already paid, thank you, and please ignore "
     "this message.\n\nKind regards,\n{{company.name}}"),
    ("A week overdue", 7, "Second reminder: invoice {{document.number}}",
     "Hello {{contact.first_name}},\n\nInvoice {{document.number}} for {{document.currency}} {{document.balance_due}} is "
     "{{document.days_overdue}} days overdue. Please arrange payment, or reply if something is wrong with it.\n\n"
     "Kind regards,\n{{company.name}}"),
)


def ensure_default_reminder_rules(db: Session, tenant_id: int) -> None:
    """Three rules, inactive (decision 12), for a workspace that has none."""
    if db.query(FinanceReminderRule.id).filter(FinanceReminderRule.tenant_id == tenant_id).first():
        return
    for name, offset, subject, body in DEFAULT_REMINDER_RULES:
        db.add(FinanceReminderRule(tenant_id=tenant_id, name=name, days_offset=offset, subject=subject, body=body, attach_pdf=True, active=False))
    db.flush()


def serialize_rule(rule: FinanceReminderRule) -> dict:
    return {"id": rule.id, "name": rule.name, "days_offset": rule.days_offset, "subject": rule.subject, "body": rule.body,
            "attach_pdf": bool(rule.attach_pdf), "active": bool(rule.active), "updated_at": rule.updated_at}


def list_rules(db: Session, *, tenant_id: int) -> list[dict]:
    rows = db.query(FinanceReminderRule).filter(FinanceReminderRule.tenant_id == tenant_id).order_by(
        FinanceReminderRule.days_offset, FinanceReminderRule.id).all()
    return [serialize_rule(rule) for rule in rows]


def _rule_or_404(db: Session, *, tenant_id: int, rule_id: int) -> FinanceReminderRule:
    rule = db.query(FinanceReminderRule).filter(FinanceReminderRule.tenant_id == tenant_id, FinanceReminderRule.id == rule_id).first()
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reminder not found")
    return rule


def save_rule(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, rule_id: int | None = None) -> FinanceReminderRule:
    rule = _rule_or_404(db, tenant_id=tenant_id, rule_id=rule_id) if rule_id else FinanceReminderRule(tenant_id=tenant_id, active=False, attach_pdf=True)
    for field in ("name", "subject", "body"):
        if field in payload and payload[field] is not None:
            value = str(payload[field]).strip()
            if not value:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Enter the reminder's {field}")
            setattr(rule, field, value)
    if payload.get("days_offset") is not None:
        rule.days_offset = int(payload["days_offset"])
    for field in ("active", "attach_pdf"):
        if payload.get(field) is not None:
            setattr(rule, field, bool(payload[field]))
    if not (rule.name and rule.subject and rule.body) or rule.days_offset is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A reminder needs a name, a day, a subject and a message")
    db.add(rule)
    db.flush()
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key=INVOICES, entity_type="finance_reminder_rule",
                 entity_id=rule.id, action="reminder_rule.saved", description=f"Saved payment reminder {rule.name}",
                 after_state=serialize_rule(rule), commit=False)
    return rule


def delete_rule(db: Session, *, tenant_id: int, actor_user_id: int | None, rule_id: int) -> None:
    rule = _rule_or_404(db, tenant_id=tenant_id, rule_id=rule_id)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key=INVOICES, entity_type="finance_reminder_rule",
                 entity_id=rule.id, action="reminder_rule.deleted", description=f"Deleted payment reminder {rule.name}", commit=False)
    db.delete(rule)
    db.flush()


# Reminder scan -------------------------------------------------------------------------------

REMINDER_CATCH_UP_DAYS = 6


def _due_invoices(db: Session, rule: FinanceReminderRule, today: date):
    """Open invoices this rule speaks to today: due `days_offset` days ago, with a few days'
    catch-up if a scan was missed. A before-due rule never reaches an invoice already due."""
    from app.modules.sales.models import SalesOrganization

    latest = today - timedelta(days=rule.days_offset)
    earliest = latest - timedelta(days=REMINDER_CATCH_UP_DAYS)
    if rule.days_offset < 0:
        earliest = max(earliest, today)
    sent = db.query(FinanceReminderSend.invoice_id).filter(FinanceReminderSend.rule_id == rule.id)
    return (
        db.query(FinancePosInvoice)
        .outerjoin(SalesOrganization, SalesOrganization.org_id == FinancePosInvoice.customer_organization_id)
        .filter(
            FinancePosInvoice.tenant_id == rule.tenant_id, FinancePosInvoice.status == "issued", FinancePosInvoice.deleted_at.is_(None),
            FinancePosInvoice.balance_due > 0, FinancePosInvoice.due_date.isnot(None),
            FinancePosInvoice.due_date >= earliest, FinancePosInvoice.due_date <= latest,
            ~FinancePosInvoice.id.in_(sent),
            (SalesOrganization.org_id.is_(None)) | (SalesOrganization.no_reminders.is_(False)),
        )
        .order_by(FinancePosInvoice.id)
        .all()
    )


def scan_reminders(db: Session, *, today: date | None = None) -> dict:
    """The daily scan: one email per active rule per open invoice, through the workspace sender.
    A workspace with no sender is skipped and tried again tomorrow; an invoice whose customer has
    no address is marked skipped for that rule, so it is not retried."""
    from app.modules.mail.services.tenant_mail import get_settings

    today = today or date.today()
    result = {"sent": 0, "skipped": 0, "failed": 0}
    rules = db.query(FinanceReminderRule).filter(FinanceReminderRule.active.is_(True)).order_by(FinanceReminderRule.tenant_id, FinanceReminderRule.id).all()
    senders: dict[int, bool] = {}
    for rule in rules:
        if rule.tenant_id not in senders:
            senders[rule.tenant_id] = get_settings(db, rule.tenant_id) is not None
        if not senders[rule.tenant_id]:
            continue
        for invoice in _due_invoices(db, rule, today):
            savepoint = db.begin_nested()
            record = FinanceReminderSend(tenant_id=rule.tenant_id, rule_id=rule.id, invoice_id=invoice.id, sent_at=datetime.now(timezone.utc))
            db.add(record)
            try:
                db.flush()
                record.recipient = send_invoice_email(db, invoice, subject=rule.subject, body=rule.body, attach_pdf=bool(rule.attach_pdf),
                                                      reason="payment reminder")
                record.outcome = "sent"
                log_activity(db, tenant_id=rule.tenant_id, actor_user_id=None, module_key=INVOICES, entity_type="finance_pos_invoice",
                             entity_id=invoice.id, action="invoice.reminder_sent",
                             description=f"Payment reminder “{rule.name}” sent to {record.recipient}",
                             after_state={"rule_id": rule.id, "recipient": record.recipient}, commit=False)
                savepoint.commit()
                result["sent"] += 1
            except ValueError as exc:
                # Nothing to send to: noted once, so the scan does not try every day.
                record.outcome, record.detail = "skipped", str(exc)[:500]
                savepoint.commit()
                result["skipped"] += 1
            except Exception:
                savepoint.rollback()
                result["failed"] += 1
                logger.exception("Payment reminder failed", extra={"tenant_id": rule.tenant_id, "invoice_id": invoice.id, "rule_id": rule.id})
            db.commit()
    return result


def invoice_reminders(db: Session, *, tenant_id: int, invoice_id: int) -> list[dict]:
    rows = (
        db.query(FinanceReminderSend, FinanceReminderRule.name)
        .join(FinanceReminderRule, FinanceReminderRule.id == FinanceReminderSend.rule_id)
        .filter(FinanceReminderSend.tenant_id == tenant_id, FinanceReminderSend.invoice_id == invoice_id)
        .order_by(FinanceReminderSend.sent_at)
        .all()
    )
    return [{"rule_name": name, "recipient": row.recipient, "outcome": row.outcome, "detail": row.detail, "sent_at": row.sent_at} for row, name in rows]


# Write-offs ----------------------------------------------------------------------------------

def write_off_limit(db: Session, *, tenant_id: int) -> Decimal:
    from app.modules.user_management.models import CompanyProfile

    value = db.query(CompanyProfile.write_off_limit).filter(CompanyProfile.tenant_id == tenant_id).order_by(CompanyProfile.id).scalar()
    return money(value or 0)


def write_off_invoice(db: Session, *, invoice: FinancePosInvoice, actor_user_id: int | None, reason: str, may_exceed_limit: bool) -> FinanceWriteOff:
    """*Write off balance* (decision 11): the whole open balance, as a tracked adjustment."""
    reason = " ".join((reason or "").split())[:500]
    if not reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Give a reason for the write-off")
    if invoice.status != "issued":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only an issued invoice's balance can be written off")
    refresh_invoice_balance(db, invoice)
    balance = money(invoice.balance_due)
    if balance <= 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This invoice has no balance to write off")
    limit = write_off_limit(db, tenant_id=invoice.tenant_id)
    if balance > limit and not may_exceed_limit:
        detail = ("Write-offs are off for this workspace; a finance administrator can write off a balance" if limit <= 0
                  else f"The balance is above the write-off limit of {limit:,.2f}; a finance administrator can write it off")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    row = FinanceWriteOff(tenant_id=invoice.tenant_id, invoice_id=invoice.id, amount=balance, reason=reason, created_by=actor_user_id,
                          created_at=datetime.now(timezone.utc))
    db.add(row)
    db.flush()
    refresh_invoice_balance(db, invoice)
    log_activity(db, tenant_id=invoice.tenant_id, actor_user_id=actor_user_id, module_key=INVOICES, entity_type="finance_pos_invoice",
                 entity_id=invoice.id, action="invoice.written_off",
                 description=f"Wrote off {invoice.currency} {balance:,.2f}: {reason}", after_state={"amount": str(balance), "reason": reason},
                 commit=False)
    return row


def reverse_write_off(db: Session, *, invoice: FinancePosInvoice, write_off_id: int, actor_user_id: int | None) -> None:
    """Undo a write-off (the customer paid after all, or it was a mistake): the balance reopens."""
    row = db.query(FinanceWriteOff).filter(FinanceWriteOff.tenant_id == invoice.tenant_id, FinanceWriteOff.invoice_id == invoice.id,
                                           FinanceWriteOff.id == write_off_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Write-off not found")
    amount = money(row.amount)
    db.delete(row)
    db.flush()
    refresh_invoice_balance(db, invoice)
    log_activity(db, tenant_id=invoice.tenant_id, actor_user_id=actor_user_id, module_key=INVOICES, entity_type="finance_pos_invoice",
                 entity_id=invoice.id, action="invoice.write_off_reversed", description=f"Reversed a write-off of {invoice.currency} {amount:,.2f}",
                 before_state={"amount": str(amount), "reason": row.reason}, commit=False)


def invoice_write_offs(db: Session, *, tenant_id: int, invoice_id: int) -> list[dict]:
    from app.modules.user_management.models import User

    rows = (
        db.query(FinanceWriteOff, User.first_name, User.last_name, User.email)
        .outerjoin(User, User.id == FinanceWriteOff.created_by)
        .filter(FinanceWriteOff.tenant_id == tenant_id, FinanceWriteOff.invoice_id == invoice_id)
        .order_by(FinanceWriteOff.id)
        .all()
    )
    return [{"id": row.id, "amount": float(row.amount), "reason": row.reason, "created_at": row.created_at,
             "created_by_name": " ".join(part for part in (first, last) if part) or email} for row, first, last, email in rows]


# Statements ----------------------------------------------------------------------------------

def _org_or_404(db: Session, *, tenant_id: int, org_id: int):
    from app.modules.sales.models import SalesOrganization

    organization = db.query(SalesOrganization).filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == org_id,
                                                      SalesOrganization.deleted_at.is_(None)).first()
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return organization


def _base_currency(db: Session, tenant_id: int) -> str:
    from app.modules.user_management.models import CompanyProfile

    return db.query(CompanyProfile.base_currency).filter(CompanyProfile.tenant_id == tenant_id).order_by(CompanyProfile.id).scalar() or "USD"


def _ledger_entries(db: Session, *, tenant_id: int, org_id: int, currency: str) -> list[dict]:
    """Every movement on the account's receivable, in one currency: invoices and refunds raise
    it; payments, credit notes and write-offs lower it."""
    invoices = db.query(FinancePosInvoice).filter(
        FinancePosInvoice.tenant_id == tenant_id, FinancePosInvoice.customer_organization_id == org_id,
        FinancePosInvoice.status == "issued", FinancePosInvoice.deleted_at.is_(None), FinancePosInvoice.currency == currency).all()
    by_id = {invoice.id: invoice for invoice in invoices}
    entries = [{"date": invoice.issue_date or (invoice.issued_at.date() if invoice.issued_at else date.today()), "type": "Invoice",
                "number": invoice.invoice_number, "detail": f"Due {invoice.due_date.isoformat()}" if invoice.due_date else None,
                "debit": money(invoice.total_amount), "credit": ZERO, "order": 0} for invoice in invoices]
    if not by_id:
        return entries
    ids = list(by_id)
    for allocation, payment in (
        db.query(FinancePaymentAllocation, FinancePayment).join(FinancePayment, FinancePayment.id == FinancePaymentAllocation.payment_id)
        .filter(FinancePaymentAllocation.tenant_id == tenant_id, FinancePaymentAllocation.invoice_id.in_(ids),
                FinancePayment.status == "posted", FinancePayment.kind == "payment")
    ):
        entries.append({"date": payment.paid_on, "type": "Payment", "number": payment.number,
                        "detail": f"For {by_id[allocation.invoice_id].invoice_number}" + (f" · {payment.method}" if payment.method else ""),
                        "debit": ZERO, "credit": money(allocation.amount), "order": 1})
    notes = db.query(FinanceCreditNote).filter(FinanceCreditNote.tenant_id == tenant_id, FinanceCreditNote.invoice_id.in_(ids),
                                               FinanceCreditNote.status == "issued").all()
    for note in notes:
        entries.append({"date": note.issue_date or (note.issued_at.date() if note.issued_at else date.today()), "type": "Credit note",
                        "number": note.number, "detail": f"Against {by_id[note.invoice_id].invoice_number}",
                        "debit": ZERO, "credit": money(note.total_amount), "order": 2})
    if notes:
        for allocation, payment in (
            db.query(FinancePaymentAllocation, FinancePayment).join(FinancePayment, FinancePayment.id == FinancePaymentAllocation.payment_id)
            .filter(FinancePaymentAllocation.tenant_id == tenant_id, FinancePaymentAllocation.credit_note_id.in_([note.id for note in notes]),
                    FinancePayment.status == "posted", FinancePayment.kind == "refund")
        ):
            entries.append({"date": payment.paid_on, "type": "Refund", "number": payment.number, "detail": None,
                            "debit": money(allocation.amount), "credit": ZERO, "order": 3})
    for row in db.query(FinanceWriteOff).filter(FinanceWriteOff.tenant_id == tenant_id, FinanceWriteOff.invoice_id.in_(ids)):
        entries.append({"date": row.created_at.date() if row.created_at else date.today(), "type": "Write-off",
                        "number": by_id[row.invoice_id].invoice_number, "detail": row.reason, "debit": ZERO, "credit": money(row.amount), "order": 4})
    return entries


def _ageing(invoices: list[FinancePosInvoice], as_of: date) -> list[dict]:
    totals = {key: ZERO for key, _label in AGEING_BUCKETS}
    for invoice in invoices:
        days = (as_of - invoice.due_date).days if invoice.due_date else 0
        key = "current" if days <= 0 else "1_30" if days <= 30 else "31_60" if days <= 60 else "61_90" if days <= 90 else "90_plus"
        totals[key] += money(invoice.balance_due)
    return [{"key": key, "label": label, "amount": totals[key]} for key, label in AGEING_BUCKETS]


def customer_statement(db: Session, *, tenant_id: int, org_id: int, start: date | None = None, end: date | None = None,
                       kind: str = "activity", currency: str | None = None) -> dict:
    """The account's statement (13d §3.6). `activity`: the opening balance, every movement in
    the period with a running balance, the closing balance. `open`: the invoices still unpaid.
    Both carry the ageing of today's open balances."""
    if kind not in {"activity", "open"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="kind must be activity or open")
    organization = _org_or_404(db, tenant_id=tenant_id, org_id=org_id)
    end = end or date.today()
    start = start or end.replace(day=1)
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The start date cannot be after the end date")
    currencies = sorted({row[0] for row in db.query(FinancePosInvoice.currency).filter(
        FinancePosInvoice.tenant_id == tenant_id, FinancePosInvoice.customer_organization_id == org_id,
        FinancePosInvoice.status == "issued", FinancePosInvoice.deleted_at.is_(None)).distinct()})
    currency = (currency or "").upper() or (currencies[0] if len(currencies) == 1 else _base_currency(db, tenant_id))
    open_invoices = db.query(FinancePosInvoice).filter(
        FinancePosInvoice.tenant_id == tenant_id, FinancePosInvoice.customer_organization_id == org_id, FinancePosInvoice.status == "issued",
        FinancePosInvoice.deleted_at.is_(None), FinancePosInvoice.currency == currency, FinancePosInvoice.balance_due > 0,
    ).order_by(FinancePosInvoice.due_date.is_(None), FinancePosInvoice.due_date, FinancePosInvoice.id).all()
    result = {
        "organization": {"org_id": organization.org_id, "name": organization.org_name, "email": organization.primary_email},
        "kind": kind, "start": start, "end": end, "currency": currency, "currencies": currencies or [currency],
        "ageing": _ageing(open_invoices, date.today()),
    }
    if kind == "open":
        today = date.today()
        result["invoices"] = [{
            "id": invoice.id, "number": invoice.invoice_number, "issue_date": invoice.issue_date, "due_date": invoice.due_date,
            "total": money(invoice.total_amount), "balance_due": money(invoice.balance_due),
            "days_overdue": max((today - invoice.due_date).days, 0) if invoice.due_date else 0,
        } for invoice in open_invoices]
        result["closing_balance"] = sum((row["balance_due"] for row in result["invoices"]), ZERO)
        return result
    entries = sorted(_ledger_entries(db, tenant_id=tenant_id, org_id=org_id, currency=currency), key=lambda row: (row["date"], row["order"]))
    opening = sum((row["debit"] - row["credit"] for row in entries if row["date"] < start), ZERO)
    running = opening
    rows = []
    for row in entries:
        if start <= row["date"] <= end:
            running += row["debit"] - row["credit"]
            rows.append({key: row[key] for key in ("date", "type", "number", "detail", "debit", "credit")} | {"balance": running})
    result.update({
        "opening_balance": opening, "entries": rows, "closing_balance": running,
        "invoiced": sum((row["debit"] for row in rows), ZERO), "received": sum((row["credit"] for row in rows), ZERO),
    })
    return result


def statement_context(db: Session, *, tenant_id: int, statement: dict) -> dict:
    """The statement in the document template's terms (13d §3.3), as a `ledger` document."""
    from app.modules.platform.services import document_pdfs

    company = document_pdfs._company(db, tenant_id)
    organization = _org_or_404(db, tenant_id=tenant_id, org_id=statement["organization"]["org_id"])
    is_open = statement["kind"] == "open"
    if is_open:
        ledger = {"columns": ["Date", "Invoice", "Due", "Total", "Balance"], "rows": [
            [row["issue_date"], row["number"], row["due_date"], row["total"], row["balance_due"]] for row in statement["invoices"]],
            "money_from": 3}
        totals = [{"label": "Balance due", "amount": statement["closing_balance"], "strong": True}]
    else:
        ledger = {"columns": ["Date", "Transaction", "Details", "Amount", "Payments", "Balance"],
                  "rows": [[None, "Opening balance", None, None, None, statement["opening_balance"]]] + [
                      [row["date"], f"{row['type']} {row['number'] or ''}".strip(), row["detail"], row["debit"] or None, row["credit"] or None,
                       row["balance"]] for row in statement["entries"]],
                  "money_from": 3}
        totals = [{"label": "Opening balance", "amount": statement["opening_balance"], "strong": False},
                  {"label": "Invoiced", "amount": statement["invoiced"], "strong": False},
                  {"label": "Received", "amount": -statement["received"] if statement["received"] else ZERO, "strong": False},
                  {"label": "Balance due", "amount": statement["closing_balance"], "strong": True}]
    return {
        "document": {"title": "Statement of account", "number": organization.org_name, "subject": None,
                     "facts": [{"label": "From", "value": statement["start"]}, {"label": "To", "value": statement["end"]}] if not is_open
                     else [{"label": "As of", "value": date.today()}],
                     "currency": statement["currency"], "inclusive": False},
        "parties": [document_pdfs._party("Account", organization.org_name, document_pdfs._address(organization, "billing"))],
        "lines": [], "columns": {}, "ledger": ledger, "ageing": statement["ageing"], "tax_summary": [], "totals": totals,
        "terms": None, "notes": None, "payment": company["bank_details"], "company": company, "layout": company["layout"], "draft": False,
    }


def statement_pdf(db: Session, *, tenant_id: int, statement: dict) -> tuple[bytes, str]:
    from app.core.document_pdf import render_pdf

    context = statement_context(db, tenant_id=tenant_id, statement=statement)
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", f"Statement-{statement['organization']['name']}-{statement['end'].isoformat()}").strip("-")
    return render_pdf("document.html", context), f"{name}.pdf"


def statement_html(db: Session, *, tenant_id: int, statement: dict) -> str:
    from app.core.document_pdf import render_html

    return render_html("document.html", statement_context(db, tenant_id=tenant_id, statement=statement))


def account_balance(db: Session, *, tenant_id: int, org_id: int) -> list[dict]:
    """Open balance per currency, for the account page's receivables summary."""
    rows = db.query(FinancePosInvoice.currency, func.coalesce(func.sum(FinancePosInvoice.balance_due), 0), func.count(FinancePosInvoice.id)).filter(
        FinancePosInvoice.tenant_id == tenant_id, FinancePosInvoice.customer_organization_id == org_id, FinancePosInvoice.status == "issued",
        FinancePosInvoice.deleted_at.is_(None), FinancePosInvoice.balance_due > 0).group_by(FinancePosInvoice.currency).all()
    return [{"currency": currency, "balance_due": money(amount), "open_invoices": count} for currency, amount, count in rows]


__all__ = [
    "AGEING_BUCKETS", "account_balance", "customer_statement", "delete_rule", "ensure_default_reminder_rules", "invoice_reminders",
    "invoice_template", "invoice_write_offs", "list_rules", "render_tokens", "save_rule", "scan_reminders", "send_invoice_email",
    "statement_html", "statement_pdf", "system_actor", "write_off_invoice", "write_off_limit",
]
