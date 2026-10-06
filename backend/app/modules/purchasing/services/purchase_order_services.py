"""Purchase orders (12b-erp-purchasing.md §3): draft → ordered → received, closed or cancelled.

An ordered PO is *incoming* stock until receipts bring it in (`receipt_services.py`). The
remainder of a line stays on it as To receive; *Close remaining* drops it on purpose.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.modules.inventory.services.costing import base_currency, clean_rate, default_exchange_rate, rate_for
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryWarehouse
from app.modules.inventory.services.stock_ledger import ensure_default_warehouse
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.purchasing.models import PurchaseOrder, PurchaseOrderLine, PurchaseReceipt, PurchaseReceiptLine
from app.modules.sales.models import SalesOrganization
from app.modules.platform.services.custom_fields import load_custom_field_values, sync_custom_fields


def list_query(db: Session, *, tenant_id: int, status: str | None = None, vendor_id: int | None = None, search: str | None = None):
    """The purchase order list's rows. The list and its export both start here (13a A5)."""
    query = db.query(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.deleted_at.is_(None))
    if status == "open":
        query = query.filter(PurchaseOrder.status.in_(["draft", "ordered"]))
    elif status:
        query = query.filter(PurchaseOrder.status == status)
    if vendor_id:
        query = query.filter(PurchaseOrder.vendor_id == vendor_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.join(SalesOrganization, SalesOrganization.org_id == PurchaseOrder.vendor_id).filter(or_(
            PurchaseOrder.number.ilike(pattern), PurchaseOrder.vendor_reference.ilike(pattern), SalesOrganization.org_name.ilike(pattern)))
    return query


def _decimal(value, *, field: str, positive: bool = False) -> Decimal:
    try:
        result = Decimal(str(value))
        valid = result.is_finite() and result == result.quantize(Decimal("0.0001")) and (result > 0 if positive else result >= 0)
    except (InvalidOperation, ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail=f"{field} must be {'greater than zero' if positive else 'zero or more'}, with at most four decimal places")
    return result


def _units(value: Decimal) -> str:
    text_value = format(Decimal(value).normalize(), "f")
    return f"{text_value} unit" if Decimal(value) == 1 else f"{text_value} units"


def get_vendor(db: Session, *, tenant_id: int, vendor_id: int) -> SalesOrganization:
    vendor = db.query(SalesOrganization).filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == vendor_id,
        SalesOrganization.deleted_at.is_(None)).first()
    if vendor is None:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if not vendor.is_vendor:
        raise HTTPException(status_code=400, detail=f"{vendor.org_name} is not marked as a vendor")
    return vendor


def get_order(db: Session, *, tenant_id: int, order_id: int, include_deleted: bool = False, lock: bool = False) -> PurchaseOrder | None:
    query = db.query(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.id == order_id)
    if not include_deleted:
        query = query.filter(PurchaseOrder.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def order_or_404(db: Session, **kwargs) -> PurchaseOrder:
    order = get_order(db, **kwargs)
    if order is None:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return order


def _audit(db: Session, *, tenant_id: int, actor_user_id: int | None, order: PurchaseOrder, action: str, description: str) -> None:
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="purchase_orders", entity_type="purchase_order",
        entity_id=order.id, action=action, description=description, commit=False)


def received_by_line(db: Session, *, tenant_id: int, line_ids) -> dict[int, Decimal]:
    """What posted receipts have brought in, per PO line."""
    line_ids = list(line_ids)
    if not line_ids:
        return {}
    rows = db.query(PurchaseReceiptLine.order_line_id, func.sum(PurchaseReceiptLine.quantity)).join(
        PurchaseReceipt, PurchaseReceipt.id == PurchaseReceiptLine.receipt_id).filter(
        PurchaseReceiptLine.tenant_id == tenant_id, PurchaseReceiptLine.order_line_id.in_(line_ids), PurchaseReceipt.status == "posted",
    ).group_by(PurchaseReceiptLine.order_line_id)
    return {line_id: Decimal(total or 0) for line_id, total in rows}


def to_receive(order: PurchaseOrder, line: PurchaseOrderLine, received: Decimal) -> Decimal:
    """Ordered less received while the PO is open; nothing once it is received, closed or cancelled."""
    if order.status != "ordered":
        return Decimal(0)
    return max(Decimal(line.quantity) - received, Decimal(0))


def incoming(db: Session, *, tenant_id: int, product_ids=None, warehouse_id: int | None = None) -> dict[tuple[int, int], Decimal]:
    """To receive on ordered POs, per (product, warehouse)."""
    query = db.query(PurchaseOrderLine, PurchaseOrder).join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.order_id).filter(
        PurchaseOrder.tenant_id == tenant_id, PurchaseOrderLine.tenant_id == tenant_id, PurchaseOrder.status == "ordered", PurchaseOrder.deleted_at.is_(None))
    if product_ids is not None:
        product_ids = list(product_ids)
        if not product_ids:
            return {}
        query = query.filter(PurchaseOrderLine.product_id.in_(product_ids))
    if warehouse_id is not None:
        query = query.filter(PurchaseOrder.warehouse_id == warehouse_id)
    rows = query.all()
    received = received_by_line(db, tenant_id=tenant_id, line_ids=[line.id for line, _ in rows])
    result: dict[tuple[int, int], Decimal] = {}
    for line, order in rows:
        left = to_receive(order, line, received.get(line.id, Decimal(0)))
        if left > 0:
            key = (line.product_id, order.warehouse_id)
            result[key] = result.get(key, Decimal(0)) + left
    return result


def _normalize_lines(db: Session, *, tenant_id: int, lines: list[dict]) -> list[PurchaseOrderLine]:
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one product")
    product_ids = {int(line["product_id"]) for line in lines}
    products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id.in_(product_ids),
        CatalogProduct.deleted_at.is_(None))}
    result = []
    for index, line in enumerate(lines):
        product = products.get(int(line["product_id"]))
        if product is None:
            raise HTTPException(status_code=404, detail="Product not found")
        if not product.track_inventory:
            raise HTTPException(status_code=400, detail=f"{product.name} does not track inventory; only stocked products are bought on purchase orders")
        quantity = _decimal(line.get("quantity"), field="Quantity", positive=True)
        unit_cost = _decimal(line.get("unit_cost", product.cost_price or 0), field="Unit cost")
        result.append(PurchaseOrderLine(tenant_id=tenant_id, product_id=product.id, description=(line.get("description") or "").strip() or None,
            quantity=quantity, unit_cost=unit_cost, line_total=(quantity * unit_cost).quantize(Decimal("0.01")), sort_order=index))
    return result


def save_order(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, order_id: int | None = None) -> PurchaseOrder:
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True) if order_id else None
    if order is not None and order.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft purchase order can be edited")
    vendor_id = payload.get("vendor_id") or (order.vendor_id if order else None)
    if not vendor_id:
        raise HTTPException(status_code=400, detail="Choose a vendor")
    vendor = get_vendor(db, tenant_id=tenant_id, vendor_id=int(vendor_id))
    warehouse_id = payload.get("warehouse_id") or (order.warehouse_id if order else None) or ensure_default_warehouse(db, tenant_id=tenant_id).id
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.id == warehouse_id,
        InventoryWarehouse.deleted_at.is_(None)).first()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    if not warehouse.is_active:
        raise HTTPException(status_code=409, detail=f"{warehouse.name} is inactive")
    lines = _normalize_lines(db, tenant_id=tenant_id, lines=payload.get("lines") or [])
    if order is None:
        order = PurchaseOrder(tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope="purchase_orders", prefix="PO"),
            owner_id=actor_user_id)
    order.vendor_id, order.warehouse_id = vendor.org_id, warehouse.id
    order.currency = (payload.get("currency") or order.currency or "USD").strip().upper()[:10]
    if "exchange_rate" in payload:
        order.exchange_rate = clean_rate(payload.get("exchange_rate"))
    if order.currency == base_currency(db, tenant_id=tenant_id):
        order.exchange_rate = None
    order.expected_date = payload.get("expected_date")
    order.vendor_reference = (payload.get("vendor_reference") or "").strip() or None
    order.notes = (payload.get("notes") or "").strip() or None
    order.lines = lines
    order.subtotal = sum((line.line_total for line in lines), Decimal(0))
    db.add(order)
    db.flush()
    sync_custom_fields(db, tenant_id=tenant_id, module_key="purchase_orders", record=order, payload=payload, created=order_id is None,
                       enforce_required="custom_fields" in payload)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="update" if order_id else "create",
        description=f"{'Updated' if order_id else 'Created'} purchase order {order.number} for {vendor.org_name}")
    return order


def mark_ordered(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int) -> PurchaseOrder:
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft purchase order can be placed")
    if not order.lines:
        raise HTTPException(status_code=400, detail="Add at least one product")
    get_vendor(db, tenant_id=tenant_id, vendor_id=order.vendor_id)
    if rate_for(db, tenant_id=tenant_id, currency=order.currency, exchange_rate=order.exchange_rate) is None:
        raise HTTPException(status_code=409, detail=f"Enter the exchange rate from {order.currency} to {base_currency(db, tenant_id=tenant_id)} before placing this order")
    order.status, order.ordered_at, order.ordered_by = "ordered", datetime.now(timezone.utc), actor_user_id
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="order", description=f"Placed purchase order {order.number}")
    return order


def set_exchange_rate(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int, exchange_rate) -> PurchaseOrder:
    """Change the rate on a draft or placed order. Receipts already posted keep the cost they
    were received at; a bill's price difference uses the rate at posting."""
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status not in {"draft", "ordered"}:
        raise HTTPException(status_code=409, detail="Only a draft or placed purchase order's exchange rate can change")
    if order.currency == base_currency(db, tenant_id=tenant_id):
        raise HTTPException(status_code=409, detail="This order is in the base currency")
    rate = clean_rate(exchange_rate)
    if rate is None:
        raise HTTPException(status_code=400, detail="Enter an exchange rate")
    order.exchange_rate = rate
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="update",
        description=f"Set the exchange rate on {order.number} to {rate} {base_currency(db, tenant_id=tenant_id)} per {order.currency}")
    return order


def has_receipts(db: Session, *, tenant_id: int, order_id: int, statuses) -> bool:
    return db.query(PurchaseReceipt.id).filter(PurchaseReceipt.tenant_id == tenant_id, PurchaseReceipt.order_id == order_id,
        PurchaseReceipt.deleted_at.is_(None), PurchaseReceipt.status.in_(list(statuses))).first() is not None


def refresh_receipt_status(db: Session, *, order: PurchaseOrder) -> str:
    received = received_by_line(db, tenant_id=order.tenant_id, line_ids=[line.id for line in order.lines])
    amounts = [received.get(line.id, Decimal(0)) for line in order.lines]
    if order.lines and all(amount >= Decimal(line.quantity) for amount, line in zip(amounts, order.lines)):
        value = "received"
    elif any(amount > 0 for amount in amounts):
        value = "partial"
    else:
        value = "none"
    order.receipt_status = value
    if order.status == "ordered" and value == "received":
        order.status = "received"
    elif order.status == "received" and value != "received":
        order.status = "ordered"
    db.add(order)
    return value


def close_remaining(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int, reason: str) -> PurchaseOrder:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status != "ordered":
        raise HTTPException(status_code=409, detail="Only a placed purchase order can be closed")
    if not has_receipts(db, tenant_id=tenant_id, order_id=order.id, statuses=["posted"]):
        raise HTTPException(status_code=409, detail="Nothing has been received yet; cancel the purchase order instead")
    if has_receipts(db, tenant_id=tenant_id, order_id=order.id, statuses=["draft"]):
        raise HTTPException(status_code=409, detail="Post or remove the draft receipts first")
    order.status, order.closed_at, order.close_reason = "closed", datetime.now(timezone.utc), reason
    db.add(order)
    db.flush()
    from app.modules.purchasing.services.bill_services import refresh_bill_status

    refresh_bill_status(db, order=order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="close", description=f"Closed the rest of {order.number}: {reason}")
    return order


def cancel_order(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int, reason: str) -> PurchaseOrder:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A cancellation reason is required")
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status not in {"draft", "ordered"}:
        raise HTTPException(status_code=409, detail="Only a draft or placed purchase order can be cancelled")
    if has_receipts(db, tenant_id=tenant_id, order_id=order.id, statuses=["posted"]):
        raise HTTPException(status_code=409, detail="Stock has been received on this purchase order; cancel its receipts or close the rest instead")
    if has_receipts(db, tenant_id=tenant_id, order_id=order.id, statuses=["draft"]):
        raise HTTPException(status_code=409, detail="Remove the draft receipts first")
    order.status, order.cancel_reason = "cancelled", reason
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="cancel", description=f"Cancelled purchase order {order.number}: {reason}")
    return order


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int) -> None:
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft purchase order can be removed")
    order.deleted_at = datetime.now(timezone.utc)
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="delete", description=f"Removed draft purchase order {order.number}")


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int) -> PurchaseOrder:
    order = get_order(db, tenant_id=tenant_id, order_id=order_id, include_deleted=True, lock=True)
    if order is None or order.deleted_at is None or order.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    order.deleted_at = None
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="restore", description=f"Restored draft purchase order {order.number}")
    return order


def serialize_order(db: Session, *, tenant_id: int, order: PurchaseOrder, include_lines: bool = True) -> dict:
    result = {
        "id": order.id, "number": order.number, "status": order.status, "receipt_status": order.receipt_status,
        "bill_status": order.bill_status,
        "vendor_id": order.vendor_id, "vendor_name": order.vendor.org_name if order.vendor else None,
        "vendor_email": order.vendor.primary_email if order.vendor else None,
        "vendor_address": "\n".join(part for part in ((order.vendor.billing_address, order.vendor.billing_city, order.vendor.billing_state,
            order.vendor.billing_postal_code, order.vendor.billing_country) if order.vendor else ()) if part) or None,
        "warehouse_id": order.warehouse_id, "warehouse_name": order.warehouse.name if order.warehouse else None,
        "currency": order.currency, "exchange_rate": order.exchange_rate, "base_currency": base_currency(db, tenant_id=tenant_id),
        "suggested_exchange_rate": default_exchange_rate(db, tenant_id=tenant_id, currency=order.currency) if order.exchange_rate is None else None,
        "expected_date": order.expected_date, "vendor_reference": order.vendor_reference, "notes": order.notes,
        "subtotal": order.subtotal, "ordered_at": order.ordered_at, "ordered_by": order.ordered_by, "closed_at": order.closed_at,
        "close_reason": order.close_reason, "cancel_reason": order.cancel_reason, "owner_id": order.owner_id,
        "created_at": order.created_at, "updated_at": order.updated_at, "is_deleted": order.deleted_at is not None,
        "line_count": len(order.lines), "total_quantity": sum((Decimal(line.quantity) for line in order.lines), Decimal(0)),
    }
    if include_lines:
        from app.modules.purchasing.services.bill_services import billing_lines, order_bills

        billing = billing_lines(db, order=order)
        received = received_by_line(db, tenant_id=tenant_id, line_ids=[line.id for line in order.lines])
        result["lines"] = [{
            "id": line.id, "product_id": line.product_id, "product_name": line.product.name if line.product else "Product",
            "sku": line.product.sku if line.product else None, "vendor_sku": line.product.vendor_sku if line.product else None,
            "description": line.description, "quantity": line.quantity, "unit_cost": line.unit_cost, "line_total": line.line_total,
            "received": received.get(line.id, Decimal(0)), "to_receive": to_receive(order, line, received.get(line.id, Decimal(0))),
            "billed": billing[line.id]["billed"], "to_bill": billing[line.id]["to_bill"],
        } for line in order.lines]
        result["bills"] = order_bills(db, tenant_id=tenant_id, order_id=order.id)
        receipts = db.query(PurchaseReceipt).options(selectinload(PurchaseReceipt.lines)).filter(PurchaseReceipt.tenant_id == tenant_id,
            PurchaseReceipt.order_id == order.id, PurchaseReceipt.deleted_at.is_(None)).order_by(PurchaseReceipt.id).all()
        result["receipts"] = [{"id": receipt.id, "number": receipt.number, "status": receipt.status, "received_on": receipt.received_on,
            "vendor_delivery_ref": receipt.vendor_delivery_ref, "total_quantity": sum((Decimal(line.quantity) for line in receipt.lines), Decimal(0))}
            for receipt in receipts]
    if include_lines:
        result["custom_fields"] = load_custom_field_values(db, tenant_id=tenant_id, module_key="purchase_orders", record_id=order.id)
    return result
