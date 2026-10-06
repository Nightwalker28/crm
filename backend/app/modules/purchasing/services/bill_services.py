"""Vendor bills (12c-erp-invoicing.md §3.3): draft → posted → void.

A bill line linked to a purchase order line is billed against what was received (Odoo's
bill control on received quantities): more is refused, a different price is allowed and
flagged as a variance. Stock cost is not changed here; valuation is E6. Lines without a PO
are services and expenses.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.pagination import Pagination, build_paged_response
from app.modules.catalog.services.line_links import PRODUCT_LINK_FIELD, SERVICE_LINK_FIELD, normalize_catalog_line_links
from app.modules.finance.services.document_amounts import ZERO, decimal_input, line_amounts, money, units
from app.modules.finance.services.invoice_balances import default_due_date, is_overdue, payment_status_for
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.purchasing.models import PurchaseBill, PurchaseBillLine, PurchaseOrder, PurchaseOrderLine, PurchaseReceipt, PurchaseReceiptLine
from app.modules.purchasing.services.purchase_order_services import get_vendor, received_by_line
from app.modules.platform.services.custom_fields import load_custom_field_values, sync_custom_fields

MODULE = "purchase_bills"


def _audit(db: Session, *, bill: PurchaseBill, actor_user_id: int | None, action: str, description: str) -> None:
    log_activity(db, tenant_id=bill.tenant_id, actor_user_id=actor_user_id, module_key=MODULE, entity_type="purchase_bill",
        entity_id=bill.id, action=action, description=description, commit=False)
    if bill.order_id:
        log_activity(db, tenant_id=bill.tenant_id, actor_user_id=actor_user_id, module_key="purchase_orders", entity_type="purchase_order",
            entity_id=bill.order_id, action=f"bill_{action}", description=description, commit=False)


def get_bill(db: Session, *, tenant_id: int, bill_id: int, include_deleted: bool = False, lock: bool = False) -> PurchaseBill | None:
    query = db.query(PurchaseBill).options(selectinload(PurchaseBill.lines)).filter(PurchaseBill.tenant_id == tenant_id, PurchaseBill.id == bill_id)
    if not include_deleted:
        query = query.filter(PurchaseBill.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def bill_or_404(db: Session, **kwargs) -> PurchaseBill:
    bill = get_bill(db, **kwargs)
    if bill is None:
        raise HTTPException(status_code=404, detail="Bill not found")
    return bill


def billed_by_line(db: Session, *, tenant_id: int, line_ids, statuses=("posted",), exclude_bill_id: int | None = None) -> dict[int, Decimal]:
    line_ids = [line_id for line_id in line_ids if line_id is not None]
    if not line_ids:
        return {}
    query = db.query(PurchaseBillLine.order_line_id, func.sum(PurchaseBillLine.quantity)).join(
        PurchaseBill, PurchaseBill.id == PurchaseBillLine.bill_id).filter(
        PurchaseBill.tenant_id == tenant_id, PurchaseBill.deleted_at.is_(None), PurchaseBill.status.in_(list(statuses)),
        PurchaseBillLine.order_line_id.in_(line_ids))
    if exclude_bill_id is not None:
        query = query.filter(PurchaseBill.id != exclude_bill_id)
    return {line_id: Decimal(total or 0) for line_id, total in query.group_by(PurchaseBillLine.order_line_id)}


def billing_lines(db: Session, *, order: PurchaseOrder, exclude_bill_id: int | None = None) -> dict[int, dict]:
    """Per PO line: received, billed (posted), on draft bills, to bill."""
    line_ids = [line.id for line in order.lines]
    received = received_by_line(db, tenant_id=order.tenant_id, line_ids=line_ids)
    billed = billed_by_line(db, tenant_id=order.tenant_id, line_ids=line_ids, exclude_bill_id=exclude_bill_id)
    drafts = billed_by_line(db, tenant_id=order.tenant_id, line_ids=line_ids, statuses=("draft",), exclude_bill_id=exclude_bill_id)
    return {line.id: {"received": received.get(line.id, ZERO), "billed": billed.get(line.id, ZERO), "on_drafts": drafts.get(line.id, ZERO),
                      "to_bill": max(received.get(line.id, ZERO) - billed.get(line.id, ZERO), ZERO)} for line in order.lines}


def refresh_bill_status(db: Session, *, order: PurchaseOrder) -> str:
    rows = billing_lines(db, order=order)
    billed_any = any(row["billed"] > 0 for row in rows.values())
    if not rows or (order.status in {"draft", "cancelled"} and not billed_any):
        value = "none"
    elif any(row["to_bill"] > 0 for row in rows.values()):
        value = "to_bill"
    else:
        # What the PO will come to: everything ordered while it is open, what arrived once it is done.
        final = {line.id: (Decimal(line.quantity) if order.status == "ordered" else rows[line.id]["received"]) for line in order.lines}
        if billed_any and all(rows[line_id]["billed"] >= quantity for line_id, quantity in final.items()):
            value = "billed"
        elif billed_any:
            value = "partial"
        else:
            value = "none"
    order.bill_status = value
    db.add(order)
    return value


def refresh_bill_balance(db: Session, bill: PurchaseBill) -> PurchaseBill:
    from app.modules.finance.models import FinancePayment, FinancePaymentAllocation

    if bill.status != "posted":
        bill.amount_paid, bill.balance_due, bill.payment_status = ZERO, ZERO, "unpaid"
    else:
        paid = money(db.query(func.coalesce(func.sum(FinancePaymentAllocation.amount), 0)).join(
            FinancePayment, FinancePayment.id == FinancePaymentAllocation.payment_id).filter(
            FinancePaymentAllocation.tenant_id == bill.tenant_id, FinancePaymentAllocation.bill_id == bill.id,
            FinancePayment.status == "posted").scalar())
        total = money(bill.total)
        bill.amount_paid, bill.balance_due = paid, max(total - paid, ZERO)
        bill.payment_status = payment_status_for(total=total, settled=paid, balance=bill.balance_due)
    db.add(bill)
    return bill


def _order(db: Session, *, tenant_id: int, order_id: int, lock: bool = False) -> PurchaseOrder:
    query = db.query(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).filter(PurchaseOrder.tenant_id == tenant_id,
        PurchaseOrder.id == order_id, PurchaseOrder.deleted_at.is_(None))
    order = (query.with_for_update() if lock else query).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return order


def _default_lines(db: Session, *, order: PurchaseOrder, receipt_id: int | None) -> list[dict]:
    rows = billing_lines(db, order=order)
    if receipt_id:
        receipt = db.query(PurchaseReceipt).filter(PurchaseReceipt.tenant_id == order.tenant_id, PurchaseReceipt.id == receipt_id,
            PurchaseReceipt.order_id == order.id, PurchaseReceipt.deleted_at.is_(None)).first()
        if receipt is None:
            raise HTTPException(status_code=404, detail="Receipt not found")
        if receipt.status != "posted":
            raise HTTPException(status_code=409, detail="Only a posted receipt can be billed")
        left = {line_id: max(row["to_bill"] - row["on_drafts"], ZERO) for line_id, row in rows.items()}
        lines = []
        for receipt_line in db.query(PurchaseReceiptLine).filter(PurchaseReceiptLine.receipt_id == receipt.id).order_by(PurchaseReceiptLine.id):
            quantity = min(Decimal(receipt_line.quantity), left.get(receipt_line.order_line_id, ZERO))
            if quantity > 0:
                left[receipt_line.order_line_id] -= quantity
                lines.append({"order_line_id": receipt_line.order_line_id, "receipt_line_id": receipt_line.id, "quantity": quantity})
    else:
        lines = [{"order_line_id": line_id, "quantity": max(row["to_bill"] - row["on_drafts"], ZERO)} for line_id, row in rows.items()]
        lines = [line for line in lines if line["quantity"] > 0]
    if not lines:
        raise HTTPException(status_code=409, detail="Nothing received on this purchase order is left to bill")
    return lines


def _apply_lines(db: Session, *, bill: PurchaseBill, order: PurchaseOrder | None, lines: list[dict], posting: bool = False) -> None:
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one line")
    po_lines = {line.id: line for line in order.lines} if order else {}
    rows = billing_lines(db, order=order, exclude_bill_id=bill.id) if order else {}
    links = normalize_catalog_line_links(db, tenant_id=bill.tenant_id, lines=[
        {PRODUCT_LINK_FIELD: line.get("catalog_product_id"), SERVICE_LINK_FIELD: line.get("catalog_service_id")} for line in lines])
    requested: dict[int, Decimal] = {}
    result = []
    for index, payload in enumerate(lines):
        quantity = decimal_input(payload.get("quantity"), field="Quantity", positive=True)
        order_line_id = payload.get("order_line_id")
        po_line = None
        if order_line_id:
            po_line = po_lines.get(int(order_line_id))
            if po_line is None:
                raise HTTPException(status_code=400, detail="Only this purchase order's lines can be billed against it")
            requested[po_line.id] = requested.get(po_line.id, ZERO) + quantity
        unit_cost = decimal_input(payload.get("unit_cost", po_line.unit_cost if po_line else None), field="Unit cost")
        tax = money(decimal_input(payload.get("tax_amount") or 0, field="Tax", places=2))
        description = (payload.get("description") or "").strip() or (po_line.description if po_line and po_line.description else None) \
            or (po_line.product.name if po_line and po_line.product else None)
        if not description:
            raise HTTPException(status_code=400, detail="Describe every line")
        _net, total = line_amounts(quantity=quantity, unit_price=unit_cost, tax=tax, label=description)
        result.append(PurchaseBillLine(
            tenant_id=bill.tenant_id, order_line_id=po_line.id if po_line else None,
            receipt_line_id=payload.get("receipt_line_id") if po_line else None,
            catalog_product_id=po_line.product_id if po_line else links[index][PRODUCT_LINK_FIELD],
            catalog_service_id=None if po_line else links[index][SERVICE_LINK_FIELD],
            description=description, quantity=quantity, unit_cost=unit_cost, po_unit_cost=po_line.unit_cost if po_line else None,
            tax_amount=tax, line_total=total, sort_order=index))
    for line_id, quantity in requested.items():
        left = rows[line_id]["to_bill"]
        if quantity > left:
            name = po_lines[line_id].product.name if po_lines[line_id].product else "This line"
            raise HTTPException(status_code=409, detail=f"{name}: only {units(left)} received and not yet billed")
    bill.lines = result
    bill.subtotal = sum((money(Decimal(line.quantity) * Decimal(line.unit_cost)) for line in result), ZERO)
    bill.tax_total = sum((money(line.tax_amount) for line in result), ZERO)
    bill.total = bill.subtotal + bill.tax_total
    variance = any(line.po_unit_cost is not None and Decimal(line.unit_cost) != Decimal(line.po_unit_cost) for line in result)
    bill.match_status = "variance" if variance else ("matched" if any(line.order_line_id for line in result) else "none")


def _check_duplicate(db: Session, *, bill: PurchaseBill) -> None:
    clash = db.query(PurchaseBill.number).filter(PurchaseBill.tenant_id == bill.tenant_id, PurchaseBill.vendor_id == bill.vendor_id,
        PurchaseBill.deleted_at.is_(None), PurchaseBill.status != "void", PurchaseBill.id != bill.id,
        func.lower(PurchaseBill.vendor_invoice_number) == bill.vendor_invoice_number.lower()).first()
    if clash is not None:
        raise HTTPException(status_code=409, detail=f"This vendor's invoice {bill.vendor_invoice_number} is already on {clash[0]}")


def save_bill(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, bill_id: int | None = None) -> PurchaseBill:
    bill = bill_or_404(db, tenant_id=tenant_id, bill_id=bill_id, lock=True) if bill_id else None
    if bill is not None and bill.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft bill can be edited")
    order_id = bill.order_id if bill else payload.get("order_id")
    order = _order(db, tenant_id=tenant_id, order_id=int(order_id)) if order_id else None
    if order is not None and order.status in {"draft", "cancelled"}:
        raise HTTPException(status_code=409, detail="Only a placed purchase order can be billed")
    vendor_id = order.vendor_id if order else (payload.get("vendor_id") or (bill.vendor_id if bill else None))
    if not vendor_id:
        raise HTTPException(status_code=400, detail="Choose a vendor")
    vendor = get_vendor(db, tenant_id=tenant_id, vendor_id=int(vendor_id))
    reference = (payload.get("vendor_invoice_number") or (bill.vendor_invoice_number if bill else "") or "").strip()
    if not reference:
        raise HTTPException(status_code=400, detail="Enter the vendor's invoice number")
    if bill is None:
        bill = PurchaseBill(tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope=MODULE, prefix="BILL"),
            owner_id=actor_user_id, order_id=order.id if order else None, receipt_id=payload.get("receipt_id") if order else None,
            status="draft", payment_status="unpaid", amount_paid=ZERO, balance_due=ZERO, vendor_id=vendor.org_id,
            vendor_invoice_number=reference[:120], bill_date=payload.get("bill_date") or date.today())
        db.add(bill)
        db.flush()
    bill.vendor_id = vendor.org_id
    bill.vendor_invoice_number = reference[:120]
    bill.bill_date = payload.get("bill_date") or bill.bill_date or date.today()
    if "due_date" in payload or bill.due_date is None:
        bill.due_date = payload.get("due_date") or default_due_date(db, tenant_id=tenant_id, organization_id=vendor.org_id, from_date=bill.bill_date)
    if bill.due_date is not None and bill.due_date < bill.bill_date:
        raise HTTPException(status_code=400, detail="The due date cannot be before the bill date")
    bill.currency = order.currency if order else (payload.get("currency") or bill.currency or "USD").strip().upper()[:10]
    if "notes" in payload:
        bill.notes = (payload.get("notes") or "").strip() or None
    lines = payload.get("lines")
    if lines is None and not bill_id:
        if order is None:
            raise HTTPException(status_code=400, detail="Add at least one line")
        lines = _default_lines(db, order=order, receipt_id=bill.receipt_id)
    if lines is not None:
        _apply_lines(db, bill=bill, order=order, lines=lines)
    _check_duplicate(db, bill=bill)
    db.add(bill)
    db.flush()
    sync_custom_fields(db, tenant_id=tenant_id, module_key="purchase_bills", record=bill, payload=payload, created=bill_id is None,
                       enforce_required="custom_fields" in payload)
    _audit(db, bill=bill, actor_user_id=actor_user_id, action="update" if bill_id else "create",
        description=f"{'Updated' if bill_id else 'Drafted'} bill {bill.number} ({bill.vendor_invoice_number}) from {vendor.org_name}")
    return bill


def post_bill(db: Session, *, tenant_id: int, actor_user_id: int | None, bill_id: int) -> PurchaseBill:
    bill = bill_or_404(db, tenant_id=tenant_id, bill_id=bill_id, lock=True)
    if bill.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft bill can be posted")
    order = _order(db, tenant_id=tenant_id, order_id=bill.order_id, lock=True) if bill.order_id else None
    get_vendor(db, tenant_id=tenant_id, vendor_id=bill.vendor_id)
    _check_duplicate(db, bill=bill)
    # Re-check against bills posted since this draft was saved, with the PO locked.
    _apply_lines(db, bill=bill, order=order, lines=[{
        "order_line_id": line.order_line_id, "receipt_line_id": line.receipt_line_id, "catalog_product_id": None if line.order_line_id else line.catalog_product_id,
        "catalog_service_id": line.catalog_service_id, "description": line.description, "quantity": line.quantity,
        "unit_cost": line.unit_cost, "tax_amount": line.tax_amount} for line in bill.lines], posting=True)
    bill.status, bill.posted_at, bill.posted_by = "posted", datetime.now(timezone.utc), actor_user_id
    db.flush()
    from app.modules.inventory.services.valuation_services import apply_bill_variance

    apply_bill_variance(db, bill=bill, actor_user_id=actor_user_id)
    refresh_bill_balance(db, bill)
    if order is not None:
        refresh_bill_status(db, order=order)
    _audit(db, bill=bill, actor_user_id=actor_user_id, action="post",
        description=f"Posted bill {bill.number} ({bill.vendor_invoice_number}) for {bill.total} {bill.currency}"
        + ("; prices differ from the purchase order" if bill.match_status == "variance" else ""))
    from app.modules.platform.services.crm_events import stage_standard_crm_event

    stage_standard_crm_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, event_type="purchase.bill_posted", entity_type="purchase_bill",
        entity_id=bill.id, payload={"number": bill.number, "vendor_invoice_number": bill.vendor_invoice_number,
        "vendor_name": bill.vendor.org_name if bill.vendor else None, "total": str(bill.total), "currency": bill.currency,
        "match_status": bill.match_status, "purchase_order_id": bill.order_id})
    return bill


def void_bill(db: Session, *, tenant_id: int, actor_user_id: int | None, bill_id: int, reason: str) -> PurchaseBill:
    from app.modules.finance.services.payment_services import has_posted_payments

    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    bill = bill_or_404(db, tenant_id=tenant_id, bill_id=bill_id, lock=True)
    if bill.status != "posted":
        raise HTTPException(status_code=409, detail="Only a posted bill can be voided; remove a draft instead")
    if has_posted_payments(db, tenant_id=tenant_id, bill_id=bill.id):
        raise HTTPException(status_code=409, detail="Payments are recorded against this bill; void them first")
    order = _order(db, tenant_id=tenant_id, order_id=bill.order_id, lock=True) if bill.order_id else None
    bill.status, bill.voided_at, bill.void_reason = "void", datetime.now(timezone.utc), reason[:500]
    db.flush()
    from app.modules.inventory.services.valuation_services import reverse_bill_variance

    reverse_bill_variance(db, bill=bill, actor_user_id=actor_user_id, reason=reason)
    refresh_bill_balance(db, bill)
    if order is not None:
        refresh_bill_status(db, order=order)
    _audit(db, bill=bill, actor_user_id=actor_user_id, action="void", description=f"Voided bill {bill.number}: {reason}")
    return bill


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, bill_id: int) -> None:
    bill = bill_or_404(db, tenant_id=tenant_id, bill_id=bill_id, lock=True)
    if bill.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft bill can be removed; void a posted one instead")
    bill.deleted_at = datetime.now(timezone.utc)
    db.add(bill)
    _audit(db, bill=bill, actor_user_id=actor_user_id, action="delete", description=f"Removed draft bill {bill.number}")


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, bill_id: int) -> PurchaseBill:
    bill = get_bill(db, tenant_id=tenant_id, bill_id=bill_id, include_deleted=True, lock=True)
    if bill is None or bill.deleted_at is None or bill.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    bill.deleted_at = None
    db.add(bill)
    _audit(db, bill=bill, actor_user_id=actor_user_id, action="restore", description=f"Restored draft bill {bill.number}")
    return bill


def serialize_bill(db: Session, *, tenant_id: int, bill: PurchaseBill, include_lines: bool = True) -> dict:
    result = {
        "id": bill.id, "number": bill.number, "status": bill.status, "payment_status": bill.payment_status, "match_status": bill.match_status,
        "is_overdue": is_overdue(status=bill.status, balance_due=bill.balance_due, due_date=bill.due_date),
        "vendor_id": bill.vendor_id, "vendor_name": bill.vendor.org_name if bill.vendor else None,
        "order_id": bill.order_id, "order_number": bill.order.number if bill.order else None, "receipt_id": bill.receipt_id,
        "vendor_invoice_number": bill.vendor_invoice_number, "bill_date": bill.bill_date, "due_date": bill.due_date,
        "currency": bill.currency, "subtotal": bill.subtotal, "tax_total": bill.tax_total, "total": bill.total,
        "amount_paid": bill.amount_paid, "balance_due": bill.balance_due, "notes": bill.notes, "posted_at": bill.posted_at,
        "voided_at": bill.voided_at, "void_reason": bill.void_reason, "owner_id": bill.owner_id,
        "created_at": bill.created_at, "updated_at": bill.updated_at, "is_deleted": bill.deleted_at is not None,
    }
    if include_lines:
        from app.modules.finance.services.payment_services import payments_for

        from app.modules.inventory.models import InventoryRevaluation

        order = bill.order
        rows = billing_lines(db, order=order, exclude_bill_id=bill.id) if order else {}
        # What each price difference did to stock value and cost of goods (12d §3.5), net of a void.
        variance: dict[int, list[Decimal]] = {}
        line_ids = [line.id for line in bill.lines]
        for revaluation in (db.query(InventoryRevaluation).filter(InventoryRevaluation.tenant_id == tenant_id,
                InventoryRevaluation.bill_line_id.in_(line_ids)).all() if line_ids else []):
            if revaluation.reverses_id is None:
                variance[revaluation.bill_line_id] = [Decimal(revaluation.stock_change), Decimal(revaluation.cogs_change)]
        result["lines"] = [{
            "id": line.id, "order_line_id": line.order_line_id, "receipt_line_id": line.receipt_line_id,
            "catalog_product_id": line.catalog_product_id, "catalog_service_id": line.catalog_service_id,
            "description": line.description, "quantity": line.quantity, "unit_cost": line.unit_cost, "po_unit_cost": line.po_unit_cost,
            "tax_amount": line.tax_amount, "line_total": line.line_total,
            "price_variance": line.po_unit_cost is not None and Decimal(line.unit_cost) != Decimal(line.po_unit_cost),
            "variance_stock_change": variance[line.id][0] if line.id in variance else None,
            "variance_cogs_change": variance[line.id][1] if line.id in variance else None,
            "received": rows.get(line.order_line_id, {}).get("received") if line.order_line_id else None,
            "billable": rows.get(line.order_line_id, {}).get("to_bill") if line.order_line_id else None,
        } for line in bill.lines]
        result["payments"] = payments_for(db, tenant_id=tenant_id, bill_id=bill.id)
    if include_lines:
        result["custom_fields"] = load_custom_field_values(db, tenant_id=tenant_id, module_key="purchase_bills", record_id=bill.id)
    return result


BILL_SORT_FIELDS = {"number": PurchaseBill.number, "bill_date": PurchaseBill.bill_date, "due_date": PurchaseBill.due_date,
                    "total": PurchaseBill.total, "balance_due": PurchaseBill.balance_due, "status": PurchaseBill.status}


def list_query(db: Session, *, tenant_id: int, status: str | None = None, vendor_id: int | None = None, order_id: int | None = None,
               search: str | None = None):
    """The bill list's rows. The list and its export both start here (13a A5)."""
    from app.modules.sales.models import SalesOrganization

    query = db.query(PurchaseBill).filter(PurchaseBill.tenant_id == tenant_id, PurchaseBill.deleted_at.is_(None))
    if status in {"draft", "posted", "void"}:
        query = query.filter(PurchaseBill.status == status)
    elif status == "unpaid":
        query = query.filter(PurchaseBill.status == "posted", PurchaseBill.balance_due > 0)
    elif status == "overdue":
        query = query.filter(PurchaseBill.status == "posted", PurchaseBill.balance_due > 0, PurchaseBill.due_date < date.today())
    elif status == "variance":
        query = query.filter(PurchaseBill.match_status == "variance", PurchaseBill.status != "void")
    if vendor_id:
        query = query.filter(PurchaseBill.vendor_id == vendor_id)
    if order_id:
        query = query.filter(PurchaseBill.order_id == order_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.join(SalesOrganization, SalesOrganization.org_id == PurchaseBill.vendor_id).filter(or_(
            PurchaseBill.number.ilike(pattern), PurchaseBill.vendor_invoice_number.ilike(pattern), SalesOrganization.org_name.ilike(pattern)))
    return query


def list_bills(db: Session, *, tenant_id: int, pagination: Pagination, status: str | None = None, vendor_id: int | None = None,
               order_id: int | None = None, search: str | None = None, sort_by: str | None = None, sort_direction: str | None = None) -> dict:
    query = list_query(db, tenant_id=tenant_id, status=status, vendor_id=vendor_id, order_id=order_id, search=search)
    total = query.count()
    column = BILL_SORT_FIELDS.get((sort_by or "").strip())
    if column is not None:
        query = query.order_by(column.desc() if (sort_direction or "").lower() == "desc" else column.asc(), PurchaseBill.id.desc())
    else:
        query = query.order_by(PurchaseBill.id.desc())
    rows = query.offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response([serialize_bill(db, tenant_id=tenant_id, bill=row, include_lines=False) for row in rows], total, pagination)


def order_bills(db: Session, *, tenant_id: int, order_id: int) -> list[dict]:
    rows = db.query(PurchaseBill).filter(PurchaseBill.tenant_id == tenant_id, PurchaseBill.order_id == order_id,
        PurchaseBill.deleted_at.is_(None)).order_by(PurchaseBill.id).all()
    return [serialize_bill(db, tenant_id=tenant_id, bill=row, include_lines=False) for row in rows]


def guard_receipt_cancel(db: Session, *, order: PurchaseOrder, receipt: PurchaseReceipt) -> None:
    """Stock a posted bill already charged for cannot be taken back off the PO."""
    rows = billing_lines(db, order=order)
    taking: dict[int, Decimal] = {}
    for line in db.query(PurchaseReceiptLine).filter(PurchaseReceiptLine.receipt_id == receipt.id):
        taking[line.order_line_id] = taking.get(line.order_line_id, ZERO) + Decimal(line.quantity)
    for line_id, quantity in taking.items():
        row = rows.get(line_id)
        if row and row["billed"] > row["received"] - quantity:
            raise HTTPException(status_code=409, detail="Posted bills already charge for this stock; void them first")
