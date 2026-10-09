"""What is owed on an invoice and on a credit note (12c §3.2).

Balances are derived from allocation rows and cached on the document. Nothing else writes
`amount_paid`, `amount_credited`, `amount_written_off`, `balance_due`, `payment_status` or `refund_due`.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.finance.models import (
    FinanceCreditAllocation,
    FinanceCreditNote,
    FinancePayment,
    FinancePaymentAllocation,
    FinancePosInvoice,
    FinanceWriteOff,
)
from app.modules.finance.services.document_amounts import ZERO, money


def _payments_to(db: Session, *, tenant_id: int, column, document_id: int, kind: str) -> Decimal:
    value = db.query(func.coalesce(func.sum(FinancePaymentAllocation.amount), 0)).join(
        FinancePayment, FinancePayment.id == FinancePaymentAllocation.payment_id).filter(
        FinancePaymentAllocation.tenant_id == tenant_id, column == document_id,
        FinancePayment.status == "posted", FinancePayment.kind == kind).scalar()
    return money(value)


def credited_to_invoice(db: Session, *, tenant_id: int, invoice_id: int) -> Decimal:
    value = db.query(func.coalesce(func.sum(FinanceCreditAllocation.amount), 0)).join(
        FinanceCreditNote, FinanceCreditNote.id == FinanceCreditAllocation.credit_note_id).filter(
        FinanceCreditAllocation.tenant_id == tenant_id, FinanceCreditAllocation.invoice_id == invoice_id,
        FinanceCreditNote.status == "issued").scalar()
    return money(value)


def payment_status_for(*, total: Decimal, settled: Decimal, balance: Decimal) -> str:
    if total > 0 and balance <= 0:
        return "paid"
    if total <= 0:
        return "paid"
    return "partial" if settled > 0 else "unpaid"


def written_off(db: Session, *, tenant_id: int, invoice_id: int) -> Decimal:
    value = db.query(func.coalesce(func.sum(FinanceWriteOff.amount), 0)).filter(
        FinanceWriteOff.tenant_id == tenant_id, FinanceWriteOff.invoice_id == invoice_id).scalar()
    return money(value)


def refresh_invoice_balance(db: Session, invoice: FinancePosInvoice) -> FinancePosInvoice:
    if invoice.status != "issued":
        invoice.amount_paid = ZERO
        invoice.amount_credited = ZERO
        invoice.amount_written_off = ZERO
        invoice.balance_due = ZERO
        invoice.payment_status = "unpaid"
        db.add(invoice)
        return invoice
    paid = _payments_to(db, tenant_id=invoice.tenant_id, column=FinancePaymentAllocation.invoice_id, document_id=invoice.id, kind="payment")
    credited = credited_to_invoice(db, tenant_id=invoice.tenant_id, invoice_id=invoice.id)
    off = written_off(db, tenant_id=invoice.tenant_id, invoice_id=invoice.id)
    total = money(invoice.total_amount)
    balance = max(total - paid - credited - off, ZERO)
    invoice.amount_paid, invoice.amount_credited, invoice.amount_written_off, invoice.balance_due = paid, credited, off, balance
    invoice.payment_status = payment_status_for(total=total, settled=paid + credited + off, balance=balance)
    db.add(invoice)
    return invoice


def credit_applied(db: Session, *, tenant_id: int, credit_note_id: int) -> Decimal:
    value = db.query(func.coalesce(func.sum(FinanceCreditAllocation.amount), 0)).filter(
        FinanceCreditAllocation.tenant_id == tenant_id, FinanceCreditAllocation.credit_note_id == credit_note_id).scalar()
    return money(value)


def refunded(db: Session, *, tenant_id: int, credit_note_id: int) -> Decimal:
    return _payments_to(db, tenant_id=tenant_id, column=FinancePaymentAllocation.credit_note_id, document_id=credit_note_id, kind="refund")


def refresh_credit_note_balance(db: Session, credit_note: FinanceCreditNote) -> FinanceCreditNote:
    if credit_note.status != "issued":
        credit_note.refund_due = ZERO
    else:
        applied = credit_applied(db, tenant_id=credit_note.tenant_id, credit_note_id=credit_note.id)
        back = refunded(db, tenant_id=credit_note.tenant_id, credit_note_id=credit_note.id)
        credit_note.refund_due = max(money(credit_note.total_amount) - applied - back, ZERO)
    db.add(credit_note)
    return credit_note


def is_overdue(*, status: str, balance_due, due_date: date | None, today: date | None = None) -> bool:
    return status in {"issued", "posted"} and money(balance_due) > 0 and due_date is not None and due_date < (today or date.today())


def payment_terms_days(db: Session, *, tenant_id: int, organization_id: int | None) -> int | None:
    """The Account's terms, else the company default; none means no due date is set."""
    from app.modules.sales.models import SalesOrganization
    from app.modules.user_management.models import CompanyProfile

    if organization_id:
        days = db.query(SalesOrganization.payment_terms_days).filter(
            SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == organization_id).scalar()
        if days is not None:
            return int(days)
    days = db.query(CompanyProfile.default_payment_terms_days).filter(CompanyProfile.tenant_id == tenant_id).scalar()
    return int(days) if days is not None else None


def default_due_date(db: Session, *, tenant_id: int, organization_id: int | None, from_date: date) -> date | None:
    days = payment_terms_days(db, tenant_id=tenant_id, organization_id=organization_id)
    return from_date + timedelta(days=days) if days is not None else None
