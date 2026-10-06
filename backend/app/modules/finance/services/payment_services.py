"""Payments as records (12c-erp-invoicing.md §3.1, §5a).

A payment is money received from a customer or paid to a vendor; its allocations say what
it settles: an invoice, a vendor bill, or (a refund) a credit note. E5's routes send exactly
one allocation for the whole amount, but `record_payment` takes a list and checks each one,
so one payment over several documents, or an unapplied balance, is additive later.

Voiding a payment never deletes it: the documents it settled get their balance back.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.access_control import get_finance_user_scope
from app.core.pagination import Pagination, build_paged_response
from app.modules.platform.services.custom_fields import load_custom_field_values_bulk, sync_custom_fields
from app.modules.platform.services.picklists import PicklistResolver
from app.modules.finance.models import FinanceCreditNote, FinancePayment, FinancePaymentAllocation, FinancePosInvoice
from app.modules.finance.services.document_amounts import ZERO, decimal_input, money
from app.modules.finance.services.invoice_balances import refresh_credit_note_balance, refresh_invoice_balance
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number

PAYMENTS_MODULE = "finance_payments"
DIRECTIONS = {"received", "made"}
KINDS = {"payment", "refund"}


def _audit(db: Session, *, tenant_id: int, actor_user_id: int | None, module_key: str, entity_type: str, entity_id: int, action: str, description: str) -> None:
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key=module_key, entity_type=entity_type,
        entity_id=entity_id, action=action, description=description, commit=False)


def has_posted_payments(db: Session, *, tenant_id: int, invoice_id: int | None = None, bill_id: int | None = None, credit_note_id: int | None = None) -> bool:
    query = db.query(FinancePaymentAllocation.id).join(FinancePayment, FinancePayment.id == FinancePaymentAllocation.payment_id).filter(
        FinancePaymentAllocation.tenant_id == tenant_id, FinancePayment.status == "posted")
    if invoice_id is not None:
        query = query.filter(FinancePaymentAllocation.invoice_id == invoice_id)
    if bill_id is not None:
        query = query.filter(FinancePaymentAllocation.bill_id == bill_id)
    if credit_note_id is not None:
        query = query.filter(FinancePaymentAllocation.credit_note_id == credit_note_id)
    return query.first() is not None


def _lock_invoice(db: Session, *, tenant_id: int, invoice_id: int, finance_user=None) -> FinancePosInvoice:
    if finance_user is not None:
        from app.modules.finance.repositories import pos_invoice_repository

        invoice = pos_invoice_repository.get_invoice_for_update(db, finance_user, invoice_id=invoice_id)
    else:
        invoice = db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == tenant_id, FinancePosInvoice.id == invoice_id,
            FinancePosInvoice.deleted_at.is_(None)).with_for_update().first()
    if invoice is None:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


def _lock_credit_note(db: Session, *, tenant_id: int, credit_note_id: int) -> FinanceCreditNote:
    credit_note = db.query(FinanceCreditNote).filter(FinanceCreditNote.tenant_id == tenant_id, FinanceCreditNote.id == credit_note_id,
        FinanceCreditNote.deleted_at.is_(None)).with_for_update().first()
    if credit_note is None:
        raise HTTPException(status_code=404, detail="Credit note not found")
    return credit_note


def _lock_bill(db: Session, *, tenant_id: int, bill_id: int):
    from app.modules.purchasing.models import PurchaseBill

    bill = db.query(PurchaseBill).filter(PurchaseBill.tenant_id == tenant_id, PurchaseBill.id == bill_id,
        PurchaseBill.deleted_at.is_(None)).with_for_update().first()
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


def _target(allocation: dict) -> tuple[str, int]:
    targets = [(key, allocation.get(key)) for key in ("invoice_id", "credit_note_id", "bill_id") if allocation.get(key)]
    if len(targets) != 1:
        raise HTTPException(status_code=400, detail="Each allocation names exactly one invoice, credit note or bill")
    return targets[0][0], int(targets[0][1])


def record_payment(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, finance_user=None) -> FinancePayment:
    """Never commits. `finance_user` applies the finance visibility scope to invoices."""
    direction = (payload.get("direction") or "").strip()
    kind = (payload.get("kind") or "payment").strip()
    if direction not in DIRECTIONS or kind not in KINDS:
        raise HTTPException(status_code=400, detail="Invalid payment direction or kind")
    allocations = payload.get("allocations") or []
    if not allocations:
        raise HTTPException(status_code=400, detail="Say what this payment settles")
    paid_on = payload.get("paid_on") or date.today()
    if isinstance(paid_on, str):
        paid_on = date.fromisoformat(paid_on)
    # A day of slack: "today" in a timezone ahead of the server's is tomorrow here.
    if paid_on > date.today() + timedelta(days=1):
        raise HTTPException(status_code=400, detail="A payment cannot be dated in the future")

    resolved = []
    seen: set[tuple[str, int]] = set()
    for allocation in allocations:
        key, document_id = _target(allocation)
        if (key, document_id) in seen:
            raise HTTPException(status_code=400, detail="A document can appear once per payment")
        seen.add((key, document_id))
        amount = money(decimal_input(allocation.get("amount"), field="Amount", positive=True, places=2))
        if key == "invoice_id":
            document = _lock_invoice(db, tenant_id=tenant_id, invoice_id=document_id, finance_user=finance_user)
            if direction != "received" or kind != "payment":
                raise HTTPException(status_code=400, detail="An invoice is settled by a payment received")
            if document.status != "issued":
                raise HTTPException(status_code=409, detail="Payments are recorded against issued invoices only")
            refresh_invoice_balance(db, document)
            outstanding, currency, label = money(document.balance_due), document.currency, document.invoice_number
            party = (document.customer_organization_id, document.customer_contact_id, document.customer_name)
        elif key == "credit_note_id":
            document = _lock_credit_note(db, tenant_id=tenant_id, credit_note_id=document_id)
            if direction != "made" or kind != "refund":
                raise HTTPException(status_code=400, detail="A credit note is settled by a refund paid to the customer")
            if document.status != "issued":
                raise HTTPException(status_code=409, detail="Refunds are recorded against issued credit notes only")
            refresh_credit_note_balance(db, document)
            invoice = document.invoice
            outstanding, currency, label = money(document.refund_due), document.currency, document.number
            party = (invoice.customer_organization_id, invoice.customer_contact_id, invoice.customer_name) if invoice else (None, None, None)
        else:
            from app.modules.purchasing.services.bill_services import refresh_bill_balance

            document = _lock_bill(db, tenant_id=tenant_id, bill_id=document_id)
            if direction != "made" or kind != "payment":
                raise HTTPException(status_code=400, detail="A bill is settled by a payment made to the vendor")
            if document.status != "posted":
                raise HTTPException(status_code=409, detail="Payments are recorded against posted bills only")
            refresh_bill_balance(db, document)
            outstanding, currency, label = money(document.balance_due), document.currency, document.number
            party = (document.vendor_id, None, document.vendor.org_name if document.vendor else None)
        if outstanding <= 0:
            raise HTTPException(status_code=409, detail=f"{label} has nothing outstanding")
        if amount > outstanding:
            raise HTTPException(status_code=400, detail=f"The amount cannot exceed what is outstanding on {label} ({outstanding})")
        resolved.append((key, document, amount, currency, party, label))

    currencies = {row[3] for row in resolved}
    if len(currencies) != 1:
        raise HTTPException(status_code=400, detail="Every document a payment settles must be in the same currency")
    total = sum((row[2] for row in resolved), ZERO)
    if payload.get("amount") is not None and money(decimal_input(payload["amount"], field="Amount", positive=True, places=2)) != total:
        raise HTTPException(status_code=400, detail="The payment amount must equal what it settles; unapplied amounts are not supported yet")
    organization_id, contact_id, party_name = resolved[0][4]
    payment = FinancePayment(
        tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope=PAYMENTS_MODULE, prefix="PAY"),
        direction=direction, kind=kind, status="posted", organization_id=organization_id, contact_id=contact_id, party_name=party_name,
        amount=total, currency=currencies.pop(), paid_on=paid_on, method=PicklistResolver(db, tenant_id).resolve("payment_method", payload.get("method"), field_key="method", field_label="Payment method"),
        reference=(payload.get("reference") or "").strip()[:200] or None, notes=(payload.get("notes") or "").strip() or None,
        created_by=actor_user_id,
    )
    payment.allocations = [FinancePaymentAllocation(tenant_id=tenant_id, amount=amount, **{key: document.id})
                           for key, document, amount, _currency, _party, _label in resolved]
    db.add(payment)
    db.flush()
    for key, document, amount, currency, _party, label in resolved:
        what = "Refunded" if kind == "refund" else ("Received" if direction == "received" else "Paid")
        if key == "invoice_id":
            refresh_invoice_balance(db, document)
            if payment.method:
                document.payment_method = payment.method
            _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="finance_pos", entity_type="finance_pos_invoice",
                entity_id=document.id, action="payment.record", description=f"{what} {amount} {currency} ({payment.number})")
        elif key == "credit_note_id":
            refresh_credit_note_balance(db, document)
            _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="finance_credit_notes", entity_type="finance_credit_note",
                entity_id=document.id, action="refund.record", description=f"{what} {amount} {currency} ({payment.number})")
        else:
            from app.modules.purchasing.services.bill_services import refresh_bill_balance

            refresh_bill_balance(db, document)
            _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="purchase_bills", entity_type="purchase_bill",
                entity_id=document.id, action="payment.record", description=f"{what} {amount} {currency} ({payment.number})")
    # Required custom fields bind the payment form, not a payment another flow records (13b §5 decision 9).
    sync_custom_fields(db, tenant_id=tenant_id, module_key=PAYMENTS_MODULE, record=payment, payload=payload, created=True,
                       enforce_required="custom_fields" in payload)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key=PAYMENTS_MODULE, entity_type="finance_payment",
        entity_id=payment.id, action="create", description=f"Recorded {payment.number}: {total} {payment.currency} for "
        + ", ".join(row[5] or "document" for row in resolved))
    from app.modules.platform.services.crm_events import stage_standard_crm_event

    stage_standard_crm_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, event_type="finance.payment_recorded",
        entity_type="finance_payment", entity_id=payment.id, payload={"number": payment.number, "direction": direction, "kind": kind,
        "amount": str(total), "currency": payment.currency, "party_name": party_name,
        "documents": [row[5] for row in resolved]})
    return payment


def _scoped(query, db: Session, user):
    scope = get_finance_user_scope(db, user)
    if scope.user_id_filter is not None:
        query = query.filter(FinancePayment.created_by == scope.user_id_filter)
    return query


def get_payment(db: Session, user, payment_id: int, *, lock: bool = False) -> FinancePayment:
    query = _scoped(db.query(FinancePayment).filter(FinancePayment.tenant_id == user.tenant_id, FinancePayment.id == payment_id), db, user)
    payment = (query.with_for_update() if lock else query).first()
    if payment is None:
        raise HTTPException(status_code=404, detail="Payment not found")
    return payment


def void_payment(db: Session, user, payment_id: int, *, reason: str) -> FinancePayment:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    payment = get_payment(db, user, payment_id, lock=True)
    if payment.status != "posted":
        raise HTTPException(status_code=409, detail="This payment is already void")
    payment.status, payment.voided_at, payment.void_reason = "void", datetime.now(timezone.utc), reason[:500]
    db.add(payment)
    db.flush()
    for allocation in payment.allocations:
        if allocation.invoice_id:
            refresh_invoice_balance(db, _lock_invoice(db, tenant_id=payment.tenant_id, invoice_id=allocation.invoice_id))
            _audit(db, tenant_id=payment.tenant_id, actor_user_id=user.id, module_key="finance_pos", entity_type="finance_pos_invoice",
                entity_id=allocation.invoice_id, action="payment.void", description=f"Voided payment {payment.number}: {reason}")
        elif allocation.credit_note_id:
            refresh_credit_note_balance(db, _lock_credit_note(db, tenant_id=payment.tenant_id, credit_note_id=allocation.credit_note_id))
            _audit(db, tenant_id=payment.tenant_id, actor_user_id=user.id, module_key="finance_credit_notes", entity_type="finance_credit_note",
                entity_id=allocation.credit_note_id, action="refund.void", description=f"Voided refund {payment.number}: {reason}")
        elif allocation.bill_id:
            from app.modules.purchasing.services.bill_services import refresh_bill_balance

            refresh_bill_balance(db, _lock_bill(db, tenant_id=payment.tenant_id, bill_id=allocation.bill_id))
            _audit(db, tenant_id=payment.tenant_id, actor_user_id=user.id, module_key="purchase_bills", entity_type="purchase_bill",
                entity_id=allocation.bill_id, action="payment.void", description=f"Voided payment {payment.number}: {reason}")
    _audit(db, tenant_id=payment.tenant_id, actor_user_id=user.id, module_key=PAYMENTS_MODULE, entity_type="finance_payment",
        entity_id=payment.id, action="void", description=f"Voided {payment.number}: {reason}")
    return payment


def _document_labels(db: Session, payments: list[FinancePayment]) -> dict[tuple[str, int], str]:
    from app.modules.purchasing.models import PurchaseBill

    invoice_ids, credit_ids, bill_ids = set(), set(), set()
    for payment in payments:
        for allocation in payment.allocations:
            if allocation.invoice_id:
                invoice_ids.add(allocation.invoice_id)
            elif allocation.credit_note_id:
                credit_ids.add(allocation.credit_note_id)
            elif allocation.bill_id:
                bill_ids.add(allocation.bill_id)
    labels: dict[tuple[str, int], str] = {}
    if invoice_ids:
        labels.update({("invoice", row.id): row.invoice_number or "Draft invoice" for row in db.query(FinancePosInvoice.id, FinancePosInvoice.invoice_number).filter(FinancePosInvoice.id.in_(invoice_ids))})
    if credit_ids:
        labels.update({("credit_note", row.id): row.number or "Draft credit note" for row in db.query(FinanceCreditNote.id, FinanceCreditNote.number).filter(FinanceCreditNote.id.in_(credit_ids))})
    if bill_ids:
        labels.update({("bill", row.id): f"{row.number} ({row.vendor_invoice_number})" for row in db.query(PurchaseBill.id, PurchaseBill.number, PurchaseBill.vendor_invoice_number).filter(PurchaseBill.id.in_(bill_ids))})
    return labels


def serialize_payment(payment: FinancePayment, labels: dict[tuple[str, int], str] | None = None) -> dict:
    labels = labels or {}
    allocations = []
    for allocation in payment.allocations:
        if allocation.invoice_id:
            kind, document_id = "invoice", allocation.invoice_id
        elif allocation.credit_note_id:
            kind, document_id = "credit_note", allocation.credit_note_id
        else:
            kind, document_id = "bill", allocation.bill_id
        allocations.append({"id": allocation.id, "document_type": kind, "document_id": document_id,
                            "document_label": labels.get((kind, document_id)), "amount": allocation.amount})
    return {
        "id": payment.id, "number": payment.number, "direction": payment.direction, "kind": payment.kind, "status": payment.status,
        "organization_id": payment.organization_id, "contact_id": payment.contact_id, "party_name": payment.party_name,
        "amount": payment.amount, "currency": payment.currency, "paid_on": payment.paid_on, "method": payment.method,
        "reference": payment.reference, "notes": payment.notes, "voided_at": payment.voided_at, "void_reason": payment.void_reason,
        "created_by": payment.created_by, "created_at": payment.created_at,
        "allocated": sum((Decimal(allocation.amount) for allocation in payment.allocations), ZERO),
        "allocations": allocations,
    }


def serialize_payments(db: Session, payments: list[FinancePayment]) -> list[dict]:
    labels = _document_labels(db, payments)
    custom = load_custom_field_values_bulk(
        db, tenant_id=payments[0].tenant_id, module_key=PAYMENTS_MODULE, record_ids=[payment.id for payment in payments]
    ) if payments else {}
    return [{**serialize_payment(payment, labels), "custom_fields": custom.get(payment.id) or None} for payment in payments]


def payments_for(db: Session, *, tenant_id: int, invoice_id: int | None = None, bill_id: int | None = None, credit_note_id: int | None = None) -> list[dict]:
    query = db.query(FinancePayment).options(selectinload(FinancePayment.allocations)).join(
        FinancePaymentAllocation, FinancePaymentAllocation.payment_id == FinancePayment.id).filter(FinancePayment.tenant_id == tenant_id)
    if invoice_id is not None:
        query = query.filter(FinancePaymentAllocation.invoice_id == invoice_id)
    if bill_id is not None:
        query = query.filter(FinancePaymentAllocation.bill_id == bill_id)
    if credit_note_id is not None:
        query = query.filter(FinancePaymentAllocation.credit_note_id == credit_note_id)
    return serialize_payments(db, query.order_by(FinancePayment.paid_on, FinancePayment.id).distinct().all())


PAYMENT_SORT_FIELDS = {
    "number": FinancePayment.number, "paid_on": FinancePayment.paid_on, "amount": FinancePayment.amount,
    "party_name": FinancePayment.party_name, "method": FinancePayment.method, "status": FinancePayment.status,
    "created_at": FinancePayment.created_at,
}


def list_query(db: Session, user, *, search: str | None = None, direction: str | None = None, status: str | None = None,
               method: str | None = None, date_from: date | None = None, date_to: date | None = None):
    """The payment list's rows, in the finance scope. The list and its export both start here (13a A5)."""
    query = _scoped(db.query(FinancePayment).options(selectinload(FinancePayment.allocations)).filter(FinancePayment.tenant_id == user.tenant_id), db, user)
    if direction in DIRECTIONS:
        query = query.filter(FinancePayment.direction == direction)
    if status in {"posted", "void"}:
        query = query.filter(FinancePayment.status == status)
    if method and method.strip():
        query = query.filter(FinancePayment.method.ilike(f"%{method.strip()}%"))
    if date_from:
        query = query.filter(FinancePayment.paid_on >= date_from)
    if date_to:
        query = query.filter(FinancePayment.paid_on <= date_to)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        invoice_hits = db.query(FinancePaymentAllocation.payment_id).join(FinancePosInvoice, FinancePosInvoice.id == FinancePaymentAllocation.invoice_id).filter(
            FinancePaymentAllocation.tenant_id == user.tenant_id, FinancePosInvoice.invoice_number.ilike(pattern))
        query = query.filter(or_(FinancePayment.number.ilike(pattern), FinancePayment.party_name.ilike(pattern),
            FinancePayment.reference.ilike(pattern), FinancePayment.method.ilike(pattern), FinancePayment.id.in_(invoice_hits)))
    return query


def list_payments(db: Session, user, *, pagination: Pagination, search: str | None = None, direction: str | None = None,
                  status: str | None = None, method: str | None = None, date_from: date | None = None, date_to: date | None = None,
                  sort_by: str | None = None, sort_direction: str | None = None) -> dict:
    query = list_query(db, user, search=search, direction=direction, status=status, method=method, date_from=date_from, date_to=date_to)
    total = query.count()
    column = PAYMENT_SORT_FIELDS.get((sort_by or "").strip())
    if column is not None:
        ordered = column.desc() if (sort_direction or "").lower() == "desc" else column.asc()
        query = query.order_by(ordered, FinancePayment.id.desc())
    else:
        query = query.order_by(FinancePayment.paid_on.desc(), FinancePayment.id.desc())
    rows = query.offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(serialize_payments(db, rows), total, pagination)
