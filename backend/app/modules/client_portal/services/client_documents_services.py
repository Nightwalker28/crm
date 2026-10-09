"""What a client sees of their account's sales documents (13d §3.7): every confirmed order
and issued invoice of their account (or, for a contact-only account, their contact), plus the
requests they made themselves, each with its PDF.

Every query is scoped by the client account's tenant and its account or contact; nothing here
takes an id from the client without that scope.
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.modules.client_portal.models import ClientAccount
from app.modules.finance.models import FinancePosInvoice
from app.modules.sales.models import SalesOrder


def _order_scope(account: ClientAccount):
    """The account's orders past draft, and the client's own requests (drafts included)."""
    mine = SalesOrder.client_account_id == account.id
    if account.organization_id is not None:
        theirs = SalesOrder.organization_id == account.organization_id
    elif account.contact_id is not None:
        theirs = SalesOrder.contact_id == account.contact_id
    else:
        return mine
    return or_(mine, (theirs & (SalesOrder.status != "draft")))


def list_orders(db: Session, *, account: ClientAccount) -> list[SalesOrder]:
    return (
        db.query(SalesOrder).options(selectinload(SalesOrder.items))
        .filter(SalesOrder.tenant_id == account.tenant_id, _order_scope(account))
        .order_by(SalesOrder.created_at.desc(), SalesOrder.id.desc())
        .limit(200)
        .all()
    )


def get_order(db: Session, *, account: ClientAccount, order_id: int) -> SalesOrder:
    order = (
        db.query(SalesOrder).options(selectinload(SalesOrder.items))
        .filter(SalesOrder.tenant_id == account.tenant_id, SalesOrder.id == order_id, _order_scope(account))
        .first()
    )
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def _invoice_scope(account: ClientAccount):
    if account.organization_id is not None:
        return FinancePosInvoice.customer_organization_id == account.organization_id
    if account.contact_id is not None:
        return FinancePosInvoice.customer_contact_id == account.contact_id
    return None


def list_invoices(db: Session, *, account: ClientAccount) -> list[FinancePosInvoice]:
    scope = _invoice_scope(account)
    if scope is None:
        return []
    return (
        db.query(FinancePosInvoice)
        .filter(FinancePosInvoice.tenant_id == account.tenant_id, FinancePosInvoice.deleted_at.is_(None),
                FinancePosInvoice.status.in_(["issued", "void"]), scope)
        .order_by(FinancePosInvoice.issue_date.desc(), FinancePosInvoice.id.desc())
        .limit(200)
        .all()
    )


def get_invoice(db: Session, *, account: ClientAccount, invoice_id: int) -> FinancePosInvoice:
    scope = _invoice_scope(account)
    invoice = None
    if scope is not None:
        invoice = db.query(FinancePosInvoice).filter(
            FinancePosInvoice.tenant_id == account.tenant_id, FinancePosInvoice.id == invoice_id, FinancePosInvoice.deleted_at.is_(None),
            FinancePosInvoice.status.in_(["issued", "void"]), scope).first()
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return invoice


def serialize_invoice(invoice: FinancePosInvoice) -> dict:
    today = date.today()
    overdue = invoice.status == "issued" and invoice.balance_due and invoice.balance_due > 0 and invoice.due_date and invoice.due_date < today
    return {
        "id": invoice.id, "invoice_number": invoice.invoice_number, "status": invoice.status, "payment_status": invoice.payment_status,
        "is_overdue": bool(overdue), "issue_date": invoice.issue_date, "due_date": invoice.due_date, "currency": invoice.currency,
        "total_amount": invoice.total_amount, "amount_paid": invoice.amount_paid, "balance_due": invoice.balance_due,
    }


def document_pdf(db: Session, *, account: ClientAccount, module_key: str, record_id: int) -> tuple[bytes, str]:
    """The issued document's PDF, as the team would send it. The record is checked against the
    client's scope first; the PDF service then loads it by tenant."""
    from app.modules.platform.services.document_pdfs import document_pdf as render

    if module_key == "sales_orders":
        order = get_order(db, account=account, order_id=record_id)
        if order.status == "draft":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This request is not confirmed yet, so it has no document")
    elif module_key == "finance_pos":
        get_invoice(db, account=account, invoice_id=record_id)
    elif module_key == "sales_quotes":
        from app.modules.sales.services.quotes_services import get_client_quote_or_404

        get_client_quote_or_404(db, tenant_id=account.tenant_id, contact_id=account.contact_id, organization_id=account.organization_id,
                                quote_id=record_id)
    else:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    try:
        return render(db, SimpleNamespace(id=None, tenant_id=account.tenant_id), module_key, record_id, reason="client portal", as_issued=True)
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="The PDF is not available right now") from exc
