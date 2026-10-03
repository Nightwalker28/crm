"""Receipts: stock coming in against a purchase order (12b-erp-purchasing.md §3.2).

Posting moves each line in at its PO line's unit cost (the cost E6 values stock with). It is
a positive move, so the ledger reserves it for waiting sales orders at once (E3). Partial
receipts leave the rest on the PO line; cancelling posts the reversal.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.modules.inventory.services.costing import base_currency, rate_for, unit
from app.modules.inventory.models import InventoryReservation
from app.modules.inventory.services.stock_ledger import MoveSpec, post_moves, reverse_moves, stage_inventory_event
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.purchasing.models import PurchaseOrder, PurchaseReceipt, PurchaseReceiptLine
from app.modules.purchasing.services.purchase_order_services import (
    _units, order_or_404, received_by_line, refresh_receipt_status, to_receive,
)


def _quantity(value) -> Decimal:
    try:
        result = Decimal(str(value))
        valid = result.is_finite() and result > 0 and result == result.quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail="Received quantities must be greater than zero, with at most four decimal places")
    return result


def get_receipt(db: Session, *, tenant_id: int, receipt_id: int, include_deleted: bool = False, lock: bool = False) -> PurchaseReceipt | None:
    query = db.query(PurchaseReceipt).options(selectinload(PurchaseReceipt.lines)).filter(PurchaseReceipt.tenant_id == tenant_id, PurchaseReceipt.id == receipt_id)
    if not include_deleted:
        query = query.filter(PurchaseReceipt.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def _receipt_or_404(db: Session, **kwargs) -> PurchaseReceipt:
    receipt = get_receipt(db, **kwargs)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


def _audit(db: Session, *, tenant_id: int, actor_user_id: int | None, receipt: PurchaseReceipt, order: PurchaseOrder, action: str, description: str) -> None:
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="purchase_receipts", entity_type="purchase_receipt",
        entity_id=receipt.id, action=action, description=description, commit=False)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="purchase_orders", entity_type="purchase_order",
        entity_id=order.id, action=f"purchase_order.receipt_{action}", description=description, commit=False)


def _validated_lines(db: Session, *, order: PurchaseOrder, lines: list[dict]):
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one line to receive")
    by_id = {line.id: line for line in order.lines}
    received = received_by_line(db, tenant_id=order.tenant_id, line_ids=list(by_id))
    result, seen = [], set()
    for payload in lines:
        line_id = int(payload["order_line_id"])
        if line_id in seen:
            raise HTTPException(status_code=400, detail="A purchase order line can appear once per receipt")
        seen.add(line_id)
        line = by_id.get(line_id)
        if line is None:
            raise HTTPException(status_code=400, detail="Only this purchase order's lines can be received")
        quantity = _quantity(payload["quantity"])
        left = to_receive(order, line, received.get(line_id, Decimal(0)))
        if quantity > left:
            name = line.product.name if line.product else "This line"
            raise HTTPException(status_code=409, detail=f"{name}: only {_units(left)} left to receive; edit the purchase order to receive more")
        result.append((line, quantity))
    return result


def save_receipt(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, receipt_id: int | None = None) -> PurchaseReceipt:
    if receipt_id is not None:
        receipt = _receipt_or_404(db, tenant_id=tenant_id, receipt_id=receipt_id, lock=True)
        if receipt.status != "draft":
            raise HTTPException(status_code=409, detail="Only a draft receipt can be edited")
        order = order_or_404(db, tenant_id=tenant_id, order_id=receipt.order_id, lock=True)
    else:
        order = order_or_404(db, tenant_id=tenant_id, order_id=int(payload["order_id"]), lock=True)
        receipt = None
    if order.status != "ordered":
        raise HTTPException(status_code=409, detail="Only a placed purchase order can be received")
    raw_lines = payload.get("lines")
    if raw_lines is None:
        received = received_by_line(db, tenant_id=tenant_id, line_ids=[line.id for line in order.lines])
        raw_lines = [{"order_line_id": line.id, "quantity": left} for line in order.lines
                     if (left := to_receive(order, line, received.get(line.id, Decimal(0)))) > 0]
        if not raw_lines:
            raise HTTPException(status_code=409, detail="Everything on this purchase order has been received")
    lines = _validated_lines(db, order=order, lines=raw_lines)
    if receipt is None:
        receipt = PurchaseReceipt(tenant_id=tenant_id, order_id=order.id, warehouse_id=order.warehouse_id,
            number=allocate_business_number(db, tenant_id=tenant_id, scope="purchase_receipts", prefix="RCV"))
    receipt.warehouse_id = order.warehouse_id
    receipt.received_on = payload.get("received_on")
    receipt.vendor_delivery_ref = (payload.get("vendor_delivery_ref") or "").strip() or None
    receipt.notes = (payload.get("notes") or "").strip() or None
    receipt.lines = []
    db.add(receipt)
    db.flush()
    for line, quantity in lines:
        receipt.lines.append(PurchaseReceiptLine(tenant_id=tenant_id, order_line_id=line.id, product_id=line.product_id, quantity=quantity))
    db.flush()
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, receipt=receipt, order=order, action="update" if receipt_id else "create",
        description=f"{'Updated' if receipt_id else 'Created'} receipt {receipt.number} for {order.number}")
    return receipt


def post_receipt(db: Session, *, tenant_id: int, actor_user_id: int | None, receipt_id: int) -> PurchaseReceipt:
    receipt = _receipt_or_404(db, tenant_id=tenant_id, receipt_id=receipt_id, lock=True)
    if receipt.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft receipt can be posted")
    order = order_or_404(db, tenant_id=tenant_id, order_id=receipt.order_id, lock=True)
    if order.status != "ordered":
        raise HTTPException(status_code=409, detail="Only a placed purchase order can be received")
    if receipt.warehouse_id != order.warehouse_id:
        raise HTTPException(status_code=409, detail="The purchase order's warehouse changed since this draft was saved; save it again")
    lines = _validated_lines(db, order=order, lines=[{"order_line_id": line.order_line_id, "quantity": line.quantity} for line in receipt.lines])
    by_order_line = {line.order_line_id: line for line in receipt.lines}
    held_before = _held(db, tenant_id=tenant_id, product_ids={line.product_id for line, _ in lines}, warehouse_id=receipt.warehouse_id)
    # Stock is costed in the base currency at the PO's rate (12d §3.2).
    rate = rate_for(db, tenant_id=tenant_id, currency=order.currency, exchange_rate=order.exchange_rate)
    if rate is None:
        raise HTTPException(status_code=409, detail=f"Set the purchase order's exchange rate from {order.currency} to {base_currency(db, tenant_id=tenant_id)} before receiving")
    post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, moves=[
        MoveSpec(product_id=line.product_id, warehouse_id=receipt.warehouse_id, quantity=quantity, move_type="receipt",
                 source_type="purchase_receipt", source_id=receipt.id, source_line_id=by_order_line[line.id].id,
                 reason=f"Receipt {receipt.number} for {order.number}", unit_cost=unit(Decimal(line.unit_cost) * rate), cost_source="receipt")
        for line, quantity in lines
    ])
    receipt.status, receipt.posted_at, receipt.posted_by = "posted", datetime.now(timezone.utc), actor_user_id
    if receipt.received_on is None:
        receipt.received_on = date.today()
    db.add(receipt)
    db.flush()
    refresh_receipt_status(db, order=order)
    from app.modules.purchasing.services.bill_services import refresh_bill_status

    refresh_bill_status(db, order=order)
    filled = _held(db, tenant_id=tenant_id, product_ids={line.product_id for line, _ in lines}, warehouse_id=receipt.warehouse_id) - held_before
    stage_inventory_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, event_type="purchase.receipt_posted",
        entity_type="purchase_receipt", entity_id=receipt.id,
        payload={"number": receipt.number, "purchase_order_id": order.id, "purchase_order_number": order.number,
                 "vendor_id": order.vendor_id, "vendor_name": order.vendor.org_name if order.vendor else None,
                 "warehouse_id": receipt.warehouse_id, "receipt_status": order.receipt_status, "backorders_filled": str(filled),
                 "record_label": receipt.number, "record_url": f"/dashboard/purchasing/receipts/{receipt.id}"})
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, receipt=receipt, order=order, action="post",
        description=f"Posted receipt {receipt.number} for {order.number}" + (f"; {_units(filled)} went to waiting sales orders" if filled > 0 else ""))
    return receipt


def _held(db: Session, *, tenant_id: int, product_ids, warehouse_id: int) -> Decimal:
    rows = db.query(InventoryReservation.quantity).filter(InventoryReservation.tenant_id == tenant_id,
        InventoryReservation.product_id.in_(list(product_ids) or [0]), InventoryReservation.warehouse_id == warehouse_id)
    return sum((Decimal(row[0]) for row in rows), Decimal(0))


def cancel_receipt(db: Session, *, tenant_id: int, actor_user_id: int | None, receipt_id: int, reason: str) -> PurchaseReceipt:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A cancellation reason is required")
    receipt = _receipt_or_404(db, tenant_id=tenant_id, receipt_id=receipt_id, lock=True)
    if receipt.status != "posted":
        raise HTTPException(status_code=409, detail="Only a posted receipt can be cancelled")
    order = order_or_404(db, tenant_id=tenant_id, order_id=receipt.order_id, lock=True)
    from app.modules.purchasing.services.bill_services import guard_receipt_cancel, refresh_bill_status

    guard_receipt_cancel(db, order=order, receipt=receipt)
    reverse_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, source_type="purchase_receipt", source_id=receipt.id, reason=reason)
    receipt.status, receipt.cancel_reason = "cancelled", reason
    db.add(receipt)
    # What came back off the shelf is to receive again: a closed PO reopens.
    if order.status == "closed":
        order.status, order.closed_at, order.close_reason = "ordered", None, None
    db.flush()
    refresh_receipt_status(db, order=order)
    refresh_bill_status(db, order=order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, receipt=receipt, order=order, action="cancel",
        description=f"Cancelled receipt {receipt.number} for {order.number}: {reason}")
    return receipt


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, receipt_id: int) -> None:
    receipt = _receipt_or_404(db, tenant_id=tenant_id, receipt_id=receipt_id, lock=True)
    if receipt.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft receipt can be removed")
    order = order_or_404(db, tenant_id=tenant_id, order_id=receipt.order_id, include_deleted=True)
    receipt.deleted_at = datetime.now(timezone.utc)
    db.add(receipt)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, receipt=receipt, order=order, action="delete", description=f"Removed draft receipt {receipt.number}")


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, receipt_id: int) -> PurchaseReceipt:
    receipt = get_receipt(db, tenant_id=tenant_id, receipt_id=receipt_id, include_deleted=True, lock=True)
    if receipt is None or receipt.deleted_at is None or receipt.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    order = order_or_404(db, tenant_id=tenant_id, order_id=receipt.order_id, include_deleted=True)
    receipt.deleted_at = None
    db.add(receipt)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, receipt=receipt, order=order, action="restore", description=f"Restored draft receipt {receipt.number}")
    return receipt


def serialize_receipt(db: Session, *, tenant_id: int, receipt: PurchaseReceipt, include_lines: bool = True) -> dict:
    order = db.query(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.id == receipt.order_id).first()
    result = {
        "id": receipt.id, "number": receipt.number, "status": receipt.status, "order_id": receipt.order_id,
        "order_number": order.number if order else None, "vendor_id": order.vendor_id if order else None,
        "vendor_name": order.vendor.org_name if order and order.vendor else None,
        "warehouse_id": receipt.warehouse_id, "warehouse_name": order.warehouse.name if order and order.warehouse else None,
        "received_on": receipt.received_on, "vendor_delivery_ref": receipt.vendor_delivery_ref, "notes": receipt.notes,
        "posted_at": receipt.posted_at, "posted_by": receipt.posted_by, "cancel_reason": receipt.cancel_reason,
        "created_at": receipt.created_at, "is_deleted": receipt.deleted_at is not None, "line_count": len(receipt.lines),
        "total_quantity": sum((Decimal(line.quantity) for line in receipt.lines), Decimal(0)),
    }
    if include_lines and order is not None:
        lines = {line.id: line for line in order.lines}
        received = received_by_line(db, tenant_id=tenant_id, line_ids=list(lines))
        result["lines"] = [{
            "id": line.id, "order_line_id": line.order_line_id, "product_id": line.product_id,
            "product_name": lines[line.order_line_id].product.name if line.order_line_id in lines and lines[line.order_line_id].product else "Product",
            "sku": lines[line.order_line_id].product.sku if line.order_line_id in lines and lines[line.order_line_id].product else None,
            "quantity": line.quantity, "ordered": lines[line.order_line_id].quantity if line.order_line_id in lines else None,
            "unit_cost": lines[line.order_line_id].unit_cost if line.order_line_id in lines else None,
            "to_receive": to_receive(order, lines[line.order_line_id], received.get(line.order_line_id, Decimal(0))) if line.order_line_id in lines else None,
        } for line in receipt.lines]
    return result
