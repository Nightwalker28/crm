"""Vendor credits (13c §3.6, D12; owner decision 5).

A vendor credit is what a vendor owes back, the mirror of a bill. It starts from a posted bill
(lines limited to what was billed less what earlier credits took), from a vendor return (at the
bill's cost when billed, else the receipt's), or blank. *Issue* numbers it and, when it came
from a bill with something still owed, applies itself there first, as a customer credit note
does to its invoice. What is left is applied to other open bills of the vendor in the same
currency, or refunded through a `received` payment of kind `refund`.

A credit never moves stock: a return does. A price-only credit on tracked goods (from a bill,
no return) revalues them through the bill-variance path, so the share on stock still held
lowers its value and the rest lowers cost of goods.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.list_conditions import apply_list_conditions
from app.modules.catalog.services.line_links import PRODUCT_LINK_FIELD, SERVICE_LINK_FIELD, normalize_catalog_line_links
from app.modules.finance.services import tax_rates
from app.modules.finance.services.document_amounts import ZERO, decimal_input, money, units
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.custom_fields import load_custom_field_values, sync_custom_fields
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.purchasing.models import (
    PurchaseBill,
    PurchaseBillLine,
    PurchaseVendorCredit,
    PurchaseVendorCreditAllocation,
    PurchaseVendorCreditLine,
    PurchaseVendorReturn,
)
from app.modules.purchasing.services.purchase_order_services import get_vendor

MODULE = "purchase_vendor_credits"


def _audit(db: Session, *, credit: PurchaseVendorCredit, actor_user_id: int | None, action: str, description: str) -> None:
    log_activity(db, tenant_id=credit.tenant_id, actor_user_id=actor_user_id, module_key=MODULE, entity_type="purchase_vendor_credit",
        entity_id=credit.id, action=action, description=description, commit=False)


def _bill_audit(db: Session, *, bill: PurchaseBill, actor_user_id: int | None, action: str, description: str) -> None:
    log_activity(db, tenant_id=bill.tenant_id, actor_user_id=actor_user_id, module_key="purchase_bills", entity_type="purchase_bill",
        entity_id=bill.id, action=action, description=description, commit=False)


def label(credit: PurchaseVendorCredit) -> str:
    return credit.number or f"Draft vendor credit {credit.id}"


def get_credit(db: Session, *, tenant_id: int, credit_id: int, include_deleted: bool = False, lock: bool = False) -> PurchaseVendorCredit | None:
    query = db.query(PurchaseVendorCredit).options(selectinload(PurchaseVendorCredit.lines)).filter(
        PurchaseVendorCredit.tenant_id == tenant_id, PurchaseVendorCredit.id == credit_id)
    if not include_deleted:
        query = query.filter(PurchaseVendorCredit.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def credit_or_404(db: Session, **kwargs) -> PurchaseVendorCredit:
    credit = get_credit(db, **kwargs)
    if credit is None:
        raise HTTPException(status_code=404, detail="Vendor credit not found")
    return credit


# --- Balances ------------------------------------------------------------------------------


def applied_to_bills(db: Session, *, tenant_id: int, credit_id: int | None = None, bill_id: int | None = None) -> Decimal:
    query = db.query(func.coalesce(func.sum(PurchaseVendorCreditAllocation.amount), 0)).join(
        PurchaseVendorCredit, PurchaseVendorCredit.id == PurchaseVendorCreditAllocation.credit_id).filter(
        PurchaseVendorCreditAllocation.tenant_id == tenant_id, PurchaseVendorCredit.status == "issued")
    if credit_id is not None:
        query = query.filter(PurchaseVendorCreditAllocation.credit_id == credit_id)
    if bill_id is not None:
        query = query.filter(PurchaseVendorCreditAllocation.bill_id == bill_id)
    return money(query.scalar())


def refunded(db: Session, *, tenant_id: int, credit_id: int) -> Decimal:
    from app.modules.finance.models import FinancePayment, FinancePaymentAllocation

    return money(db.query(func.coalesce(func.sum(FinancePaymentAllocation.amount), 0)).join(
        FinancePayment, FinancePayment.id == FinancePaymentAllocation.payment_id).filter(
        FinancePaymentAllocation.tenant_id == tenant_id, FinancePaymentAllocation.vendor_credit_id == credit_id,
        FinancePayment.status == "posted").scalar())


def refresh_vendor_credit_balance(db: Session, credit: PurchaseVendorCredit) -> PurchaseVendorCredit:
    if credit.status != "issued":
        credit.credit_remaining = ZERO
    else:
        used = applied_to_bills(db, tenant_id=credit.tenant_id, credit_id=credit.id) + refunded(db, tenant_id=credit.tenant_id, credit_id=credit.id)
        credit.credit_remaining = max(money(credit.total) - used, ZERO)
    db.add(credit)
    return credit


def credited_by_bill_line(db: Session, *, tenant_id: int, bill_line_ids, exclude_credit_id: int | None = None) -> dict[int, Decimal]:
    """What issued (and draft, so two drafts cannot double-credit) credits hold per bill line."""
    ids = [line_id for line_id in bill_line_ids if line_id is not None]
    if not ids:
        return {}
    query = db.query(PurchaseVendorCreditLine.bill_line_id, func.sum(PurchaseVendorCreditLine.quantity)).join(
        PurchaseVendorCredit, PurchaseVendorCredit.id == PurchaseVendorCreditLine.credit_id).filter(
        PurchaseVendorCreditLine.tenant_id == tenant_id, PurchaseVendorCreditLine.bill_line_id.in_(ids),
        PurchaseVendorCredit.deleted_at.is_(None), PurchaseVendorCredit.status.in_(["draft", "issued"]))
    if exclude_credit_id is not None:
        query = query.filter(PurchaseVendorCredit.id != exclude_credit_id)
    return {line_id: Decimal(total or 0) for line_id, total in query.group_by(PurchaseVendorCreditLine.bill_line_id)}


# --- Drafting ------------------------------------------------------------------------------


def _bill(db: Session, *, tenant_id: int, bill_id: int, lock: bool = False) -> PurchaseBill:
    query = db.query(PurchaseBill).options(selectinload(PurchaseBill.lines)).filter(PurchaseBill.tenant_id == tenant_id,
        PurchaseBill.id == bill_id, PurchaseBill.deleted_at.is_(None))
    bill = (query.with_for_update() if lock else query).first()
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


def _lines_from_bill(db: Session, *, credit: PurchaseVendorCredit | None, bill: PurchaseBill) -> list[dict]:
    held = credited_by_bill_line(db, tenant_id=bill.tenant_id, bill_line_ids=[line.id for line in bill.lines],
                                 exclude_credit_id=credit.id if credit else None)
    return [{"bill_line_id": line.id, "quantity": left, "unit_cost": line.unit_cost}
            for line in bill.lines if (left := Decimal(line.quantity) - held.get(line.id, ZERO)) > 0]


def _lines_from_return(db: Session, *, doc: PurchaseVendorReturn) -> tuple[PurchaseBill | None, list[dict]]:
    """A return's lines at the bill's cost where its goods were billed, else the PO line's."""
    from app.modules.purchasing.models import PurchaseOrderLine

    bill_lines = {row.order_line_id: (bill, row) for row, bill in db.query(PurchaseBillLine, PurchaseBill).join(
        PurchaseBill, PurchaseBill.id == PurchaseBillLine.bill_id).filter(PurchaseBill.tenant_id == doc.tenant_id,
        PurchaseBill.status == "posted", PurchaseBillLine.order_line_id.in_([line.order_line_id for line in doc.lines])
        ).order_by(PurchaseBill.id)}
    po_lines = {row.id: row for row in db.query(PurchaseOrderLine).filter(PurchaseOrderLine.tenant_id == doc.tenant_id,
        PurchaseOrderLine.id.in_([line.order_line_id for line in doc.lines]))}
    bills = {bill.id for bill, _ in bill_lines.values()}
    lines = []
    for line in doc.lines:
        billed = bill_lines.get(line.order_line_id)
        lines.append({
            "vendor_return_line_id": line.id, "bill_line_id": billed[1].id if billed and len(bills) == 1 else None,
            "catalog_product_id": line.product_id, "description": line.product.name if line.product else "Returned goods",
            "quantity": line.quantity,
            "unit_cost": billed[1].unit_cost if billed else (po_lines[line.order_line_id].net_unit_cost if line.order_line_id in po_lines else ZERO),
        })
    bill = db.query(PurchaseBill).filter(PurchaseBill.id == bills.pop()).first() if len(bills) == 1 else None
    return bill, lines


def _apply_lines(db: Session, *, credit: PurchaseVendorCredit, bill: PurchaseBill | None, lines: list[dict]) -> None:
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one line")
    bill_lines = {line.id: line for line in bill.lines} if bill else {}
    held = credited_by_bill_line(db, tenant_id=credit.tenant_id, bill_line_ids=list(bill_lines), exclude_credit_id=credit.id) if bill else {}
    links = normalize_catalog_line_links(db, tenant_id=credit.tenant_id, lines=[
        {PRODUCT_LINK_FIELD: line.get("catalog_product_id"), SERVICE_LINK_FIELD: line.get("catalog_service_id")} for line in lines])
    resolver = tax_rates.TaxResolver(db, tenant_id=credit.tenant_id, side="purchases",
                                     allowed_inactive=tax_rates.used_rate_ids(credit.lines) | tax_rates.used_rate_ids(bill_lines.values()))
    requested: dict[int, Decimal] = {}
    result = []
    for index, payload in enumerate(lines):
        quantity = decimal_input(payload.get("quantity"), field="Quantity", positive=True)
        bill_line = None
        if payload.get("bill_line_id"):
            bill_line = bill_lines.get(int(payload["bill_line_id"]))
            if bill_line is None:
                raise HTTPException(status_code=400, detail="Only this bill's lines can be credited against it")
            requested[bill_line.id] = requested.get(bill_line.id, ZERO) + quantity
        raw_cost = payload.get("unit_cost")
        unit_cost = decimal_input(raw_cost if raw_cost is not None else (bill_line.unit_cost if bill_line else None), field="Unit cost")
        decimal_input(payload.get("tax_amount") or 0, field="Tax", places=2)
        if bill_line is not None and payload.get("tax_amount") is None and not payload.get("tax_rate_id") and Decimal(bill_line.quantity):
            # The bill's tax on the credited share, under its rate, so a full credit nets the bill to zero.
            payload = {**payload, "tax_rate_id": bill_line.tax_rate_id, "tax_manual": True,
                       "tax_amount": money(Decimal(bill_line.tax_amount) * quantity / Decimal(bill_line.quantity))}
        description = (payload.get("description") or "").strip() or (bill_line.description if bill_line else None)
        if not description:
            raise HTTPException(status_code=400, detail="Describe every line")
        link = {PRODUCT_LINK_FIELD: bill_line.catalog_product_id if bill_line else (payload.get("catalog_product_id") or links[index][PRODUCT_LINK_FIELD]),
                SERVICE_LINK_FIELD: bill_line.catalog_service_id if bill_line else links[index][SERVICE_LINK_FIELD]}
        choice, amounts = tax_rates.compute_payload_line(resolver, payload, link, quantity=quantity, unit_price=unit_cost, label=description)
        tax, total = amounts.tax, amounts.total
        result.append(PurchaseVendorCreditLine(
            tenant_id=credit.tenant_id, bill_line_id=bill_line.id if bill_line else None,
            vendor_return_line_id=payload.get("vendor_return_line_id"),
            catalog_product_id=bill_line.catalog_product_id if bill_line else (payload.get("catalog_product_id") or links[index][PRODUCT_LINK_FIELD]),
            catalog_service_id=bill_line.catalog_service_id if bill_line else links[index][SERVICE_LINK_FIELD],
            description=description, quantity=quantity, unit_cost=unit_cost, tax_amount=tax, tax_rate_id=choice.rate_id,
            tax_manual=choice.manual, line_total=total, sort_order=index))
    for line_id, quantity in requested.items():
        left = Decimal(bill_lines[line_id].quantity) - held.get(line_id, ZERO)
        if quantity > left:
            raise HTTPException(status_code=409, detail=f"{bill_lines[line_id].description}: only {units(left)} billed and not yet credited")
    credit.lines = result
    credit.subtotal = sum((money(Decimal(line.quantity) * Decimal(line.unit_cost)) for line in result), ZERO)
    credit.tax_total = sum((money(line.tax_amount) for line in result), ZERO)
    credit.total = credit.subtotal + credit.tax_total


def save_credit(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, credit_id: int | None = None) -> PurchaseVendorCredit:
    credit = credit_or_404(db, tenant_id=tenant_id, credit_id=credit_id, lock=True) if credit_id else None
    if credit is not None and credit.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft vendor credit can be edited")
    bill = None
    doc = None
    if credit is None and payload.get("vendor_return_id"):
        doc = db.query(PurchaseVendorReturn).options(selectinload(PurchaseVendorReturn.lines)).filter(
            PurchaseVendorReturn.tenant_id == tenant_id, PurchaseVendorReturn.id == int(payload["vendor_return_id"]),
            PurchaseVendorReturn.deleted_at.is_(None)).first()
        if doc is None:
            raise HTTPException(status_code=404, detail="Vendor return not found")
        if doc.status != "shipped" or doc.resolution != "credit":
            raise HTTPException(status_code=409, detail="Only a shipped return awaiting a credit can be credited")
        bill, default_lines = _lines_from_return(db, doc=doc)
    elif (bill_id := payload.get("bill_id") or (credit.bill_id if credit else None)):
        bill = _bill(db, tenant_id=tenant_id, bill_id=int(bill_id), lock=True)
        if bill.status != "posted":
            raise HTTPException(status_code=409, detail="Only a posted bill can be credited")
        default_lines = None
    else:
        default_lines = None
    vendor_id = doc.vendor_id if doc else (bill.vendor_id if bill else (payload.get("vendor_id") or (credit.vendor_id if credit else None)))
    if not vendor_id:
        raise HTTPException(status_code=400, detail="Choose a vendor")
    vendor = get_vendor(db, tenant_id=tenant_id, vendor_id=int(vendor_id))
    if credit is None:
        credit = PurchaseVendorCredit(tenant_id=tenant_id, vendor_id=vendor.org_id, bill_id=bill.id if bill else None,
            vendor_return_id=doc.id if doc else None, status="draft", owner_id=actor_user_id,
            currency=bill.currency if bill else (payload.get("currency") or "USD").strip().upper()[:10],
            credit_date=payload.get("credit_date") or date.today())
        if doc is not None and bill is None:
            from app.modules.purchasing.models import PurchaseOrder

            credit.currency = db.query(PurchaseOrder.currency).filter(PurchaseOrder.id == doc.order_id).scalar() or credit.currency
        db.add(credit)
        db.flush()
    credit.vendor_id = vendor.org_id
    credit.credit_date = payload.get("credit_date") or credit.credit_date or date.today()
    if not bill and "currency" in payload and payload.get("currency"):
        credit.currency = payload["currency"].strip().upper()[:10]
    for field in ("reason", "notes", "vendor_reference"):
        if field in payload:
            setattr(credit, field, (payload.get(field) or "").strip() or None)
    lines = payload.get("lines")
    if lines is None and credit_id is None:
        lines = default_lines if default_lines is not None else (_lines_from_bill(db, credit=None, bill=bill) if bill else None)
        if lines is not None and not lines:
            raise HTTPException(status_code=409, detail="Everything on this bill has been credited")
    if lines is not None:
        _apply_lines(db, credit=credit, bill=bill if not doc or credit.bill_id else None, lines=lines)
    db.add(credit)
    db.flush()
    sync_custom_fields(db, tenant_id=tenant_id, module_key=MODULE, record=credit, payload=payload, created=credit_id is None,
                       enforce_required="custom_fields" in payload)
    source = f" against {bill.number}" if bill else (f" for return {doc.number}" if doc else "")
    _audit(db, credit=credit, actor_user_id=actor_user_id, action="update" if credit_id else "create",
        description=f"{'Updated' if credit_id else 'Drafted'} vendor credit from {vendor.org_name}{source}")
    return credit


# --- Issue, apply, void --------------------------------------------------------------------


def issue_credit(db: Session, *, tenant_id: int, actor_user_id: int | None, credit_id: int) -> PurchaseVendorCredit:
    from app.modules.purchasing.services.bill_services import refresh_bill_balance

    credit = credit_or_404(db, tenant_id=tenant_id, credit_id=credit_id, lock=True)
    if credit.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft vendor credit can be issued")
    bill = _bill(db, tenant_id=tenant_id, bill_id=credit.bill_id, lock=True) if credit.bill_id else None
    # Re-check the bill's lines with it locked, against credits issued since this draft.
    if bill is not None:
        _apply_lines(db, credit=credit, bill=bill, lines=[{
            "bill_line_id": line.bill_line_id, "vendor_return_line_id": line.vendor_return_line_id, "description": line.description,
            "quantity": line.quantity, "unit_cost": line.unit_cost, "tax_amount": line.tax_amount, **tax_rates.line_tax_fields(line),
            "catalog_product_id": line.catalog_product_id, "catalog_service_id": line.catalog_service_id} for line in credit.lines])
    if money(credit.total) <= 0:
        raise HTTPException(status_code=400, detail="A vendor credit must be for more than zero")
    credit.number = allocate_business_number(db, tenant_id=tenant_id, scope=MODULE, prefix="VC")
    credit.status, credit.issued_at, credit.issued_by = "issued", datetime.now(timezone.utc), actor_user_id
    db.flush()
    refresh_vendor_credit_balance(db, credit)
    if bill is not None:
        refresh_bill_balance(db, bill)
        if money(bill.balance_due) > 0:
            _allocate(db, credit=credit, bill=bill, amount=min(money(bill.balance_due), money(credit.credit_remaining)), actor_user_id=actor_user_id)
    if credit.vendor_return_id is None and bill is not None:
        _revalue_price_credit(db, credit=credit, bill=bill, actor_user_id=actor_user_id)
    _audit(db, credit=credit, actor_user_id=actor_user_id, action="issue", description=f"Issued vendor credit {credit.number} for {credit.total} {credit.currency}")
    if bill is not None:
        _bill_audit(db, bill=bill, actor_user_id=actor_user_id, action="vendor_credit.issue",
            description=f"Vendor credit {credit.number} for {credit.total} {credit.currency}")
    return credit


def _allocate(db: Session, *, credit: PurchaseVendorCredit, bill: PurchaseBill, amount: Decimal, actor_user_id: int | None) -> None:
    from app.modules.purchasing.services.bill_services import refresh_bill_balance

    if amount <= 0:
        return
    db.add(PurchaseVendorCreditAllocation(tenant_id=credit.tenant_id, credit_id=credit.id, bill_id=bill.id, amount=amount, created_by=actor_user_id))
    db.flush()
    refresh_vendor_credit_balance(db, credit)
    refresh_bill_balance(db, bill)
    _audit(db, credit=credit, actor_user_id=actor_user_id, action="apply", description=f"Applied {amount} {credit.currency} to bill {bill.number}")
    _bill_audit(db, bill=bill, actor_user_id=actor_user_id, action="vendor_credit.apply",
        description=f"Vendor credit {credit.number} applied: {amount} {credit.currency}")


def apply_to_bills(db: Session, *, tenant_id: int, actor_user_id: int | None, credit_id: int, allocations: list[dict]) -> PurchaseVendorCredit:
    """Split what is left of the credit over the vendor's open bills in its currency (Zoho's *Apply to bills*)."""
    from app.modules.purchasing.services.bill_services import refresh_bill_balance

    credit = credit_or_404(db, tenant_id=tenant_id, credit_id=credit_id, lock=True)
    if credit.status != "issued":
        raise HTTPException(status_code=409, detail="Only an issued vendor credit can be applied")
    if not allocations:
        raise HTTPException(status_code=400, detail="Choose at least one bill")
    refresh_vendor_credit_balance(db, credit)
    left = money(credit.credit_remaining)
    seen: set[int] = set()
    planned = []
    for allocation in allocations:
        bill_id = int(allocation["bill_id"])
        if bill_id in seen:
            raise HTTPException(status_code=400, detail="A bill can appear once")
        seen.add(bill_id)
        amount = money(decimal_input(allocation.get("amount"), field="Amount", positive=True, places=2))
        bill = _bill(db, tenant_id=tenant_id, bill_id=bill_id, lock=True)
        if bill.vendor_id != credit.vendor_id:
            raise HTTPException(status_code=400, detail=f"{bill.number} is another vendor's bill")
        if bill.currency != credit.currency:
            raise HTTPException(status_code=400, detail=f"{bill.number} is in {bill.currency}; this credit is in {credit.currency}")
        if bill.status != "posted":
            raise HTTPException(status_code=409, detail=f"{bill.number} is not posted")
        refresh_bill_balance(db, bill)
        if amount > money(bill.balance_due):
            raise HTTPException(status_code=400, detail=f"{bill.number} has only {bill.balance_due} {bill.currency} owed")
        planned.append((bill, amount))
    if sum((amount for _bill_row, amount in planned), ZERO) > left:
        raise HTTPException(status_code=400, detail=f"Only {left} {credit.currency} of this credit is left")
    for bill, amount in planned:
        _allocate(db, credit=credit, bill=bill, amount=amount, actor_user_id=actor_user_id)
    return credit


def void_credit(db: Session, *, tenant_id: int, actor_user_id: int | None, credit_id: int, reason: str) -> PurchaseVendorCredit:
    """Only while nothing of it is refunded; its bill applications are undone with it."""
    from app.modules.purchasing.services.bill_services import refresh_bill_balance

    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    credit = credit_or_404(db, tenant_id=tenant_id, credit_id=credit_id, lock=True)
    if credit.status != "issued":
        raise HTTPException(status_code=409, detail="Only an issued vendor credit can be voided")
    if refunded(db, tenant_id=tenant_id, credit_id=credit.id) > 0:
        raise HTTPException(status_code=409, detail="The vendor has refunded part of this credit; void the refund first")
    allocations = db.query(PurchaseVendorCreditAllocation).filter(PurchaseVendorCreditAllocation.tenant_id == tenant_id,
        PurchaseVendorCreditAllocation.credit_id == credit.id).all()
    bill_ids = {row.bill_id for row in allocations}
    for row in allocations:
        db.delete(row)
    credit.status, credit.voided_at, credit.void_reason = "void", datetime.now(timezone.utc), reason[:500]
    db.flush()
    refresh_vendor_credit_balance(db, credit)
    for bill_id in sorted(bill_ids):
        bill = _bill(db, tenant_id=tenant_id, bill_id=bill_id, lock=True)
        refresh_bill_balance(db, bill)
        _bill_audit(db, bill=bill, actor_user_id=actor_user_id, action="vendor_credit.void",
            description=f"Vendor credit {credit.number} voided: {reason}")
    if credit.vendor_return_id is None and credit.bill_id:
        _reverse_price_credit(db, credit=credit, actor_user_id=actor_user_id, reason=reason)
    _audit(db, credit=credit, actor_user_id=actor_user_id, action="void", description=f"Voided vendor credit {credit.number}: {reason}")
    return credit


def _revalue_price_credit(db: Session, *, credit: PurchaseVendorCredit, bill: PurchaseBill, actor_user_id: int | None) -> None:
    """A credit on billed goods with no return is a price correction (owner decision 5)."""
    from app.modules.inventory.services.valuation_services import apply_vendor_credit
    from app.modules.purchasing.models import PurchaseOrder

    order = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == credit.tenant_id, PurchaseOrder.id == bill.order_id).first() if bill.order_id else None
    apply_vendor_credit(db, credit=credit, order=order, actor_user_id=actor_user_id)


def _reverse_price_credit(db: Session, *, credit: PurchaseVendorCredit, actor_user_id: int | None, reason: str) -> None:
    from app.modules.inventory.services.valuation_services import reverse_vendor_credit

    reverse_vendor_credit(db, credit=credit, actor_user_id=actor_user_id, reason=reason)


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, credit_id: int) -> None:
    credit = credit_or_404(db, tenant_id=tenant_id, credit_id=credit_id, lock=True)
    if credit.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft vendor credit can be removed")
    credit.deleted_at = datetime.now(timezone.utc)
    db.add(credit)
    _audit(db, credit=credit, actor_user_id=actor_user_id, action="delete", description="Removed a draft vendor credit")


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, credit_id: int) -> PurchaseVendorCredit:
    credit = get_credit(db, tenant_id=tenant_id, credit_id=credit_id, include_deleted=True, lock=True)
    if credit is None or credit.deleted_at is None or credit.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    credit.deleted_at = None
    db.add(credit)
    _audit(db, credit=credit, actor_user_id=actor_user_id, action="restore", description="Restored a draft vendor credit")
    return credit


# --- Lists and serialization ---------------------------------------------------------------


def list_field_map() -> dict:
    """The vendor credit list's saved-view fields (13c §3.2)."""
    return {
        "number": {"expression": PurchaseVendorCredit.number, "type": "text"},
        "status": {"expression": PurchaseVendorCredit.status, "type": "text"},
        "vendor_id": {"expression": PurchaseVendorCredit.vendor_id, "type": "number"},
        "vendor_reference": {"expression": PurchaseVendorCredit.vendor_reference, "type": "text"},
        "reason": {"expression": PurchaseVendorCredit.reason, "type": "text"},
        "owner_id": {"expression": PurchaseVendorCredit.owner_id, "type": "number"},
        "currency": {"expression": PurchaseVendorCredit.currency, "type": "text"},
        "total": {"expression": PurchaseVendorCredit.total, "type": "number"},
        "credit_remaining": {"expression": PurchaseVendorCredit.credit_remaining, "type": "number"},
        "credit_date": {"expression": PurchaseVendorCredit.credit_date, "type": "date"},
        "created_at": {"expression": PurchaseVendorCredit.created_at, "type": "date"},
        "open_credit": {"expression": (PurchaseVendorCredit.status == "issued") & (PurchaseVendorCredit.credit_remaining > 0), "type": "boolean"},
    }


def list_query(db: Session, *, tenant_id: int, status: str | None = None, search: str | None = None, bill_id: int | None = None,
               vendor_id: int | None = None, filters_all: list[dict] | None = None, filters_any: list[dict] | None = None):
    """The vendor credit list's rows. The list and its export both start here (13a A5)."""
    from app.modules.sales.models import SalesOrganization

    query = db.query(PurchaseVendorCredit).filter(PurchaseVendorCredit.tenant_id == tenant_id, PurchaseVendorCredit.deleted_at.is_(None))
    if status in {"draft", "issued", "void"}:
        query = query.filter(PurchaseVendorCredit.status == status)
    elif status == "open":
        query = query.filter(PurchaseVendorCredit.status == "issued", PurchaseVendorCredit.credit_remaining > 0)
    if bill_id:
        query = query.filter(PurchaseVendorCredit.bill_id == bill_id)
    if vendor_id:
        query = query.filter(PurchaseVendorCredit.vendor_id == vendor_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        vendors = db.query(SalesOrganization.org_id).filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_name.ilike(pattern))
        query = query.filter(or_(PurchaseVendorCredit.number.ilike(pattern), PurchaseVendorCredit.vendor_reference.ilike(pattern),
                                 PurchaseVendorCredit.reason.ilike(pattern), PurchaseVendorCredit.vendor_id.in_(vendors)))
    return apply_list_conditions(query, field_map=list_field_map(), filters_all=filters_all, filters_any=filters_any)


def open_bills(db: Session, *, credit: PurchaseVendorCredit) -> list[dict]:
    """The vendor's posted bills with something owed, in the credit's currency, for *Apply to bills*."""
    rows = db.query(PurchaseBill).filter(PurchaseBill.tenant_id == credit.tenant_id, PurchaseBill.vendor_id == credit.vendor_id,
        PurchaseBill.currency == credit.currency, PurchaseBill.status == "posted", PurchaseBill.balance_due > 0,
        PurchaseBill.deleted_at.is_(None)).order_by(PurchaseBill.due_date.is_(None), PurchaseBill.due_date, PurchaseBill.id).limit(50).all()
    return [{"id": row.id, "number": row.number, "vendor_invoice_number": row.vendor_invoice_number, "due_date": row.due_date,
             "balance_due": row.balance_due, "currency": row.currency} for row in rows]


def serialize_credit(db: Session, *, tenant_id: int, credit: PurchaseVendorCredit, include_lines: bool = True) -> dict:
    bill = db.query(PurchaseBill.number).filter(PurchaseBill.id == credit.bill_id).scalar() if credit.bill_id else None
    doc = db.query(PurchaseVendorReturn.number).filter(PurchaseVendorReturn.id == credit.vendor_return_id).scalar() if credit.vendor_return_id else None
    result = {
        "id": credit.id, "number": credit.number, "status": credit.status, "vendor_id": credit.vendor_id,
        "vendor_name": credit.vendor.org_name if credit.vendor else None, "bill_id": credit.bill_id, "bill_number": bill,
        "vendor_return_id": credit.vendor_return_id, "vendor_return_number": doc, "vendor_reference": credit.vendor_reference,
        "credit_date": credit.credit_date, "currency": credit.currency, "subtotal": credit.subtotal, "tax_total": credit.tax_total,
        "total": credit.total, "credit_remaining": credit.credit_remaining, "reason": credit.reason, "notes": credit.notes,
        "issued_at": credit.issued_at, "voided_at": credit.voided_at, "void_reason": credit.void_reason, "owner_id": credit.owner_id,
        "created_at": credit.created_at, "updated_at": credit.updated_at, "is_deleted": credit.deleted_at is not None,
    }
    if include_lines:
        from app.modules.finance.services.payment_services import payments_for

        result["lines"] = [{"id": line.id, "bill_line_id": line.bill_line_id, "vendor_return_line_id": line.vendor_return_line_id,
                            "catalog_product_id": line.catalog_product_id, "catalog_service_id": line.catalog_service_id,
                            "description": line.description, "quantity": line.quantity, "unit_cost": line.unit_cost,
                            "tax_amount": line.tax_amount, "tax_rate_id": line.tax_rate_id, "tax_manual": bool(line.tax_manual),
                            "line_total": line.line_total} for line in credit.lines]
        result["tax_summary"] = credit.tax_summary
        allocations = db.query(PurchaseVendorCreditAllocation, PurchaseBill).join(PurchaseBill, PurchaseBill.id == PurchaseVendorCreditAllocation.bill_id).filter(
            PurchaseVendorCreditAllocation.tenant_id == tenant_id, PurchaseVendorCreditAllocation.credit_id == credit.id).order_by(
            PurchaseVendorCreditAllocation.id).all()
        result["applications"] = [{"id": row.id, "bill_id": bill_row.id, "bill_number": bill_row.number, "amount": row.amount,
                                   "created_at": row.created_at} for row, bill_row in allocations]
        result["refunds"] = payments_for(db, tenant_id=tenant_id, vendor_credit_id=credit.id)
        result["open_bills"] = open_bills(db, credit=credit) if credit.status == "issued" and money(credit.credit_remaining) > 0 else []
        result["custom_fields"] = load_custom_field_values(db, tenant_id=tenant_id, module_key=MODULE, record_id=credit.id)
    return result


def bill_credits(db: Session, *, tenant_id: int, bill_id: int) -> list[dict]:
    """The vendor credits applied to or drawn from a bill, for the bill's page."""
    applied = {row.credit_id: row.amount for row in db.query(PurchaseVendorCreditAllocation).filter(
        PurchaseVendorCreditAllocation.tenant_id == tenant_id, PurchaseVendorCreditAllocation.bill_id == bill_id)}
    rows = db.query(PurchaseVendorCredit).filter(PurchaseVendorCredit.tenant_id == tenant_id, PurchaseVendorCredit.deleted_at.is_(None),
        or_(PurchaseVendorCredit.bill_id == bill_id, PurchaseVendorCredit.id.in_(list(applied) or [0]))).order_by(PurchaseVendorCredit.id).all()
    return [{"id": row.id, "number": row.number, "status": row.status, "total": row.total, "currency": row.currency,
             "applied": applied.get(row.id, ZERO)} for row in rows]
