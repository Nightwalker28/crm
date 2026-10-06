"""`finance.invoice_overdue` and `purchase.bill_overdue` (12c-erp-invoicing.md §3.6).

Shaped like `scan_overdue_tasks`: once per document and due date, within a look-back window,
so a worker that was down catches up and a first run does not announce every old invoice.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.finance.models import FinancePosInvoice
from app.modules.platform.models import CrmEvent
from app.modules.platform.services.crm_events import safe_emit_crm_event

OVERDUE_LOOKBACK = timedelta(days=30)


def _announced(db: Session, *, event_type: str, entity_type: str, ids: list[int]) -> dict[tuple[int, str], datetime]:
    if not ids:
        return {}
    rows = db.query(CrmEvent.tenant_id, CrmEvent.entity_id, func.max(CrmEvent.created_at)).filter(
        CrmEvent.event_type == event_type, CrmEvent.entity_type == entity_type, CrmEvent.entity_id.in_([str(value) for value in ids]),
    ).group_by(CrmEvent.tenant_id, CrmEvent.entity_id).all()
    result = {}
    for tenant_id, entity_id, created_at in rows:
        if created_at is not None and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        result[(tenant_id, entity_id)] = created_at
    return result


def _already(announced: dict, *, tenant_id: int, entity_id: int, due: date) -> bool:
    seen = announced.get((tenant_id, str(entity_id)))
    return seen is not None and seen >= datetime.combine(due, time.min, tzinfo=timezone.utc)


def scan_overdue_documents(db: Session, *, today: date | None = None) -> dict:
    from app.modules.purchasing.models import PurchaseBill

    today = today or date.today()
    oldest = today - OVERDUE_LOOKBACK
    invoices = db.query(FinancePosInvoice).filter(FinancePosInvoice.deleted_at.is_(None), FinancePosInvoice.status == "issued",
        FinancePosInvoice.balance_due > 0, FinancePosInvoice.due_date < today, FinancePosInvoice.due_date >= oldest).all()
    bills = db.query(PurchaseBill).filter(PurchaseBill.deleted_at.is_(None), PurchaseBill.status == "posted",
        PurchaseBill.balance_due > 0, PurchaseBill.due_date < today, PurchaseBill.due_date >= oldest).all()
    seen_invoices = _announced(db, event_type="finance.invoice_overdue", entity_type="finance_pos_invoice", ids=[row.id for row in invoices])
    seen_bills = _announced(db, event_type="purchase.bill_overdue", entity_type="purchase_bill", ids=[row.id for row in bills])
    created = 0
    for invoice in invoices:
        if _already(seen_invoices, tenant_id=invoice.tenant_id, entity_id=invoice.id, due=invoice.due_date):
            continue
        if safe_emit_crm_event(db, tenant_id=invoice.tenant_id, actor_user_id=None, event_type="finance.invoice_overdue",
                entity_type="finance_pos_invoice", entity_id=invoice.id, payload={
                    "entity_type": "finance_pos_invoice", "entity_id": str(invoice.id), "invoice_number": invoice.invoice_number,
                    "customer_name": invoice.customer_name, "due_date": invoice.due_date.isoformat(),
                    "balance_due": str(invoice.balance_due), "currency": invoice.currency,
                    "record_label": invoice.invoice_number, "record_url": f"/dashboard/finance/invoices/{invoice.id}"}) is not None:
            created += 1
    for bill in bills:
        if _already(seen_bills, tenant_id=bill.tenant_id, entity_id=bill.id, due=bill.due_date):
            continue
        if safe_emit_crm_event(db, tenant_id=bill.tenant_id, actor_user_id=None, event_type="purchase.bill_overdue",
                entity_type="purchase_bill", entity_id=bill.id, payload={
                    "entity_type": "purchase_bill", "entity_id": str(bill.id), "number": bill.number,
                    "vendor_invoice_number": bill.vendor_invoice_number, "due_date": bill.due_date.isoformat(),
                    "balance_due": str(bill.balance_due), "currency": bill.currency,
                    "record_label": bill.number, "record_url": f"/dashboard/purchasing/bills/{bill.id}"}) is not None:
            created += 1
    return {"overdue_invoices": len(invoices), "overdue_bills": len(bills), "events_created": created}
