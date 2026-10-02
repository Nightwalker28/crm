"""Deliveries: goods leaving a warehouse for a sales order (12a-erp-fulfilment.md §3.3).

A delivery may ship part of an order; the rest stays on the order line as *To deliver*.
Posting takes stock out through the ledger, consuming the order line's own hold first;
cancelling a posted delivery posts the reversal. The order's `delivery_status` and, when
everything has shipped, its *Fulfilled* status follow from its deliveries.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryDelivery, InventoryDeliveryLine, InventoryReservation, InventoryWarehouse
from app.modules.inventory.services.stock_ledger import (
    MoveSpec, _lock_levels, _lock_products, _set_hold, _tracked_lines, delivered_quantity, line_outstanding,
    order_warehouse_id, post_moves, release_for_order, reserve_for_order, reverse_moves, stage_inventory_event,
)
from app.modules.inventory.services.return_services import delivery_returns, has_open_returns, returned_quantity
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.sales.models import SalesOrder, SalesOrderItem


def _quantity(value) -> Decimal:
    try:
        result = Decimal(str(value))
        valid = result.is_finite() and result > 0 and result == result.quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail="Delivery quantities must be greater than zero, with at most four decimal places")
    return result


def _units(value: Decimal) -> str:
    text_value = format(Decimal(value).normalize(), "f")
    return f"{text_value} unit" if Decimal(value) == 1 else f"{text_value} units"


def get_delivery(db: Session, *, tenant_id: int, delivery_id: int, include_deleted: bool = False, lock: bool = False) -> InventoryDelivery | None:
    query = db.query(InventoryDelivery).options(selectinload(InventoryDelivery.lines)).filter(
        InventoryDelivery.tenant_id == tenant_id, InventoryDelivery.id == delivery_id)
    if not include_deleted:
        query = query.filter(InventoryDelivery.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def _delivery_or_404(db: Session, **kwargs) -> InventoryDelivery:
    doc = get_delivery(db, **kwargs)
    if doc is None:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return doc


def _order_or_404(db: Session, *, tenant_id: int, order_id: int, lock: bool = False) -> SalesOrder:
    query = db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id, SalesOrder.id == order_id)
    order = (query.with_for_update() if lock else query).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _audit(db: Session, *, tenant_id: int, actor_user_id: int | None, doc: InventoryDelivery, order: SalesOrder, action: str, description: str) -> None:
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="inventory_deliveries", entity_type="inventory_delivery",
        entity_id=doc.id, action=action, description=description, commit=False)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="sales_orders", entity_type="sales_order",
        entity_id=order.id, action=f"sales_order.delivery_{action}", description=description, commit=False)


def has_live_deliveries(db: Session, *, tenant_id: int, order_id: int, posted_only: bool = False) -> bool:
    statuses = ["posted"] if posted_only else ["draft", "posted"]
    return db.query(InventoryDelivery.id).filter(InventoryDelivery.tenant_id == tenant_id, InventoryDelivery.order_id == order_id,
        InventoryDelivery.deleted_at.is_(None), InventoryDelivery.status.in_(statuses)).first() is not None


def delivered_line_ids(db: Session, *, tenant_id: int, line_ids) -> set[int]:
    """Order lines that appear on any delivery, in any state; their identity is now history."""
    line_ids = list(line_ids)
    if not line_ids:
        return set()
    return {row[0] for row in db.query(InventoryDeliveryLine.order_line_id).filter(
        InventoryDeliveryLine.tenant_id == tenant_id, InventoryDeliveryLine.order_line_id.in_(line_ids))}


def refresh_delivery_status(db: Session, *, order: SalesOrder) -> str:
    """none · pending · partial · delivered · closed, by the rule the migration backfilled."""
    lines = _tracked_lines(db, order)
    if not lines or order.status == "cancelled":
        value = "none"
    elif order.remaining_closed_at is not None:
        value = "closed"
    else:
        delivered = [delivered_quantity(db, line) for line in lines]
        if all(amount >= Decimal(line.quantity) for amount, line in zip(delivered, lines)):
            value = "delivered"
        elif any(amount > 0 for amount in delivered):
            value = "partial"
        else:
            value = "pending"
    order.delivery_status = value
    db.add(order)
    return value


def _validated_lines(db: Session, *, order: SalesOrder, lines: list[dict]) -> list[tuple[SalesOrderItem, Decimal]]:
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one line to deliver")
    tracked = {line.id: line for line in _tracked_lines(db, order)}
    result = []
    seen: set[int] = set()
    for payload in lines:
        line_id = int(payload["order_line_id"])
        if line_id in seen:
            raise HTTPException(status_code=400, detail="An order line can appear once per delivery")
        seen.add(line_id)
        line = tracked.get(line_id)
        if line is None:
            raise HTTPException(status_code=400, detail="Only this order's stocked product lines can be delivered")
        quantity = _quantity(payload["quantity"])
        outstanding = line_outstanding(db, line, order)
        if quantity > outstanding:
            raise HTTPException(status_code=409, detail=f"{line.name}: only {_units(outstanding)} left to deliver")
        result.append((line, quantity))
    return result


def _default_lines(db: Session, *, order: SalesOrder) -> list[dict]:
    """A new delivery ships what is reserved for each line."""
    held = {row.order_line_id: Decimal(row.quantity) for row in db.query(InventoryReservation).filter(
        InventoryReservation.tenant_id == order.tenant_id, InventoryReservation.order_id == order.id)}
    lines = [{"order_line_id": line.id, "quantity": min(held.get(line.id, Decimal(0)), line_outstanding(db, line, order))}
             for line in _tracked_lines(db, order)]
    lines = [line for line in lines if line["quantity"] > 0]
    if not lines:
        raise HTTPException(status_code=409, detail="Nothing is reserved for this order yet; enter the quantities to ship or check availability first")
    return lines


def save_delivery(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, delivery_id: int | None = None) -> InventoryDelivery:
    if delivery_id is not None:
        doc = _delivery_or_404(db, tenant_id=tenant_id, delivery_id=delivery_id, lock=True)
        if doc.status != "draft":
            raise HTTPException(status_code=409, detail="Only a draft delivery can be edited")
        order = _order_or_404(db, tenant_id=tenant_id, order_id=doc.order_id, lock=True)
    else:
        order = _order_or_404(db, tenant_id=tenant_id, order_id=int(payload["order_id"]), lock=True)
        doc = None
    if order.status != "confirmed":
        raise HTTPException(status_code=409, detail="Only a confirmed order can be delivered")
    lines = _validated_lines(db, order=order, lines=payload.get("lines") or _default_lines(db, order=order))
    if doc is None:
        doc = InventoryDelivery(tenant_id=tenant_id, order_id=order.id,
            number=allocate_business_number(db, tenant_id=tenant_id, scope="inventory_deliveries", prefix="DEL"))
    doc.warehouse_id = order_warehouse_id(db, order)
    doc.shipped_on = payload.get("shipped_on")
    doc.carrier = (payload.get("carrier") or "").strip() or None
    doc.tracking_number = (payload.get("tracking_number") or "").strip() or None
    doc.notes = (payload.get("notes") or "").strip() or None
    doc.lines = []
    db.add(doc)
    db.flush()
    for line, quantity in lines:
        doc.lines.append(InventoryDeliveryLine(tenant_id=tenant_id, order_line_id=line.id, product_id=line.catalog_product_id, quantity=quantity))
    db.flush()
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, order=order, action="update" if delivery_id else "create",
        description=f"{'Updated' if delivery_id else 'Created'} delivery {doc.number} for {order.order_number}")
    return doc


def _post(db: Session, *, tenant_id: int, actor_user_id: int | None, doc: InventoryDelivery, order: SalesOrder) -> None:
    """Take a delivery's stock out, consuming the order's own holds first. Never commits."""
    lines = _validated_lines(db, order=order, lines=[{"order_line_id": line.order_line_id, "quantity": line.quantity} for line in doc.lines])
    if doc.warehouse_id != order_warehouse_id(db, order):
        raise HTTPException(status_code=409, detail="The order's warehouse changed since this draft was saved; save it again")
    _lock_products(db, tenant_id=tenant_id, product_ids=[line.catalog_product_id for line, _ in lines])
    levels = _lock_levels(db, tenant_id=tenant_id, keys=[(line.catalog_product_id, doc.warehouse_id) for line, _ in lines])
    holds = {row.order_line_id: row for row in db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id,
        InventoryReservation.order_id == order.id, InventoryReservation.warehouse_id == doc.warehouse_id)}
    for line, quantity in lines:
        row = holds.get(line.id)
        if row is not None:
            consumed = min(Decimal(row.quantity), quantity)
            _set_hold(db, level=levels[(line.catalog_product_id, doc.warehouse_id)], row=row, quantity=Decimal(row.quantity) - consumed,
                order_id=order.id, order_line_id=line.id, actor_user_id=actor_user_id)
    db.flush()
    by_line = {line.order_line_id: line for line in doc.lines}
    post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, moves=[
        MoveSpec(product_id=line.catalog_product_id, warehouse_id=doc.warehouse_id, quantity=-quantity, move_type="delivery",
                 source_type="inventory_delivery", source_id=doc.id, source_line_id=by_line[line.id].id,
                 reason=f"Delivery {doc.number} for {order.order_number}")
        for line, quantity in lines
    ])
    doc.status, doc.posted_at, doc.posted_by = "posted", datetime.now(timezone.utc), actor_user_id
    if doc.shipped_on is None:
        doc.shipped_on = date.today()
    db.add(doc)
    db.flush()
    if refresh_delivery_status(db, order=order) == "delivered":
        order.status = "fulfilled"
    reserve_for_order(db, tenant_id=tenant_id, order=order, actor_user_id=actor_user_id)
    stage_inventory_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, event_type="inventory.delivery_posted",
        entity_type="inventory_delivery", entity_id=doc.id,
        payload={"number": doc.number, "order_id": order.id, "order_number": order.order_number, "warehouse_id": doc.warehouse_id,
                 "delivery_status": order.delivery_status, "record_label": doc.number, "record_url": f"/dashboard/inventory/deliveries/{doc.id}"})
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, order=order, action="post",
        description=f"Posted delivery {doc.number} for {order.order_number}")


def post_delivery(db: Session, *, tenant_id: int, actor_user_id: int | None, delivery_id: int) -> InventoryDelivery:
    doc = _delivery_or_404(db, tenant_id=tenant_id, delivery_id=delivery_id, lock=True)
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft delivery can be posted")
    order = _order_or_404(db, tenant_id=tenant_id, order_id=doc.order_id, lock=True)
    if order.status != "confirmed":
        raise HTTPException(status_code=409, detail="Only a confirmed order can be delivered")
    _post(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, order=order)
    return doc


def cancel_delivery(db: Session, *, tenant_id: int, actor_user_id: int | None, delivery_id: int, reason: str) -> InventoryDelivery:
    """Undo a posted delivery (a mistake, not goods coming back: that is a return)."""
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A cancellation reason is required")
    doc = _delivery_or_404(db, tenant_id=tenant_id, delivery_id=delivery_id, lock=True)
    if doc.status != "posted":
        raise HTTPException(status_code=409, detail="Only a posted delivery can be cancelled")
    order = _order_or_404(db, tenant_id=tenant_id, order_id=doc.order_id, lock=True)
    if order.status == "cancelled":
        raise HTTPException(status_code=409, detail="The order is cancelled")
    if has_open_returns(db, tenant_id=tenant_id, delivery_id=doc.id):
        raise HTTPException(status_code=409, detail="This delivery has returns; cancel or remove them first")
    if doc.migrated:
        reverse_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, source_type="sales_order", source_id=order.id, reason=reason)
    else:
        reverse_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, source_type="inventory_delivery", source_id=doc.id, reason=reason)
    doc.status, doc.cancel_reason = "cancelled", reason
    db.add(doc)
    # The quantity is to deliver again: the order reopens and holds what it can.
    if order.status == "fulfilled":
        order.status = "confirmed"
    order.remaining_closed_at = None
    order.remaining_close_reason = None
    db.flush()
    refresh_delivery_status(db, order=order)
    reserve_for_order(db, tenant_id=tenant_id, order=order, actor_user_id=actor_user_id)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, order=order, action="cancel",
        description=f"Cancelled delivery {doc.number} for {order.order_number}: {reason}")
    return doc


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, delivery_id: int) -> None:
    doc = _delivery_or_404(db, tenant_id=tenant_id, delivery_id=delivery_id, lock=True)
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft delivery can be removed")
    order = _order_or_404(db, tenant_id=tenant_id, order_id=doc.order_id)
    doc.deleted_at = datetime.now(timezone.utc)
    db.add(doc)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, order=order, action="delete", description=f"Removed draft delivery {doc.number}")


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, delivery_id: int) -> InventoryDelivery:
    doc = get_delivery(db, tenant_id=tenant_id, delivery_id=delivery_id, include_deleted=True, lock=True)
    if doc is None or doc.deleted_at is None or doc.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    order = _order_or_404(db, tenant_id=tenant_id, order_id=doc.order_id)
    doc.deleted_at = None
    db.add(doc)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, order=order, action="restore", description=f"Restored draft delivery {doc.number}")
    return doc


def deliver_remaining(db: Session, *, tenant_id: int, actor_user_id: int | None, order: SalesOrder) -> InventoryDelivery | None:
    """The *Fulfilled* shortcut: one delivery for everything left, posted now. Never commits.

    Refused, with the product and shortfall named, when stock is short.
    """
    db.flush()
    lines = [{"order_line_id": line.id, "quantity": line_outstanding(db, line, order)} for line in _tracked_lines(db, order)]
    lines = [line for line in lines if line["quantity"] > 0]
    if not lines:
        return None
    status = order.status
    order.status = "confirmed"
    doc = InventoryDelivery(tenant_id=tenant_id, order_id=order.id, warehouse_id=order_warehouse_id(db, order),
        number=allocate_business_number(db, tenant_id=tenant_id, scope="inventory_deliveries", prefix="DEL"),
        notes="Created when the order was marked fulfilled")
    db.add(doc)
    db.flush()
    for line in lines:
        product_id = next(item.catalog_product_id for item in order.items if item.id == line["order_line_id"])
        doc.lines.append(InventoryDeliveryLine(tenant_id=tenant_id, order_line_id=line["order_line_id"], product_id=product_id, quantity=line["quantity"]))
    db.flush()
    _post(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, order=order)
    if order.status != "fulfilled":
        order.status = status
    return doc


def close_remaining(db: Session, *, tenant_id: int, actor_user_id: int | None, order: SalesOrder, reason: str) -> SalesOrder:
    """Finish an order without shipping the rest: holds go, To deliver becomes zero. Never commits."""
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    if order.status != "confirmed":
        raise HTTPException(status_code=409, detail="Only a confirmed order can be closed")
    if not has_live_deliveries(db, tenant_id=tenant_id, order_id=order.id, posted_only=True):
        raise HTTPException(status_code=409, detail="Nothing has been delivered yet; cancel the order instead")
    if has_draft_delivery(db, tenant_id=tenant_id, order_id=order.id):
        raise HTTPException(status_code=409, detail="Post or remove the order's draft deliveries first")
    release_for_order(db, tenant_id=tenant_id, order=order, actor_user_id=actor_user_id)
    order.remaining_closed_at = datetime.now(timezone.utc)
    order.remaining_close_reason = reason
    order.status = "fulfilled"
    db.flush()
    refresh_delivery_status(db, order=order)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="sales_orders", entity_type="sales_order",
        entity_id=order.id, action="sales_order.remaining_closed", description=f"Closed the rest of {order.order_number} without delivering it: {reason}", commit=False)
    return order


def has_draft_delivery(db: Session, *, tenant_id: int, order_id: int) -> bool:
    return db.query(InventoryDelivery.id).filter(InventoryDelivery.tenant_id == tenant_id, InventoryDelivery.order_id == order_id,
        InventoryDelivery.deleted_at.is_(None), InventoryDelivery.status == "draft").first() is not None


def serialize_delivery(db: Session, *, tenant_id: int, doc: InventoryDelivery, include_lines: bool = True) -> dict:
    order = db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id, SalesOrder.id == doc.order_id).first()
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.id == doc.warehouse_id).first()
    result = {
        "id": doc.id, "number": doc.number, "status": doc.status, "order_id": doc.order_id,
        "order_number": order.order_number if order else None,
        "customer_name": (order.organization_name or order.contact_name) if order else None,
        "contact_name": order.contact_name if order else None,
        "delivery_address": order.delivery_address if order else None,
        "warehouse_id": doc.warehouse_id, "warehouse_name": warehouse.name if warehouse else None,
        "shipped_on": doc.shipped_on, "carrier": doc.carrier, "tracking_number": doc.tracking_number, "notes": doc.notes,
        "posted_at": doc.posted_at, "posted_by": doc.posted_by, "cancel_reason": doc.cancel_reason,
        "migrated": bool(doc.migrated), "created_at": doc.created_at, "is_deleted": doc.deleted_at is not None,
        "line_count": len(doc.lines), "total_quantity": sum((Decimal(line.quantity) for line in doc.lines), Decimal(0)),
    }
    if include_lines:
        items = {item.id: item for item in (order.items if order else [])}
        products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id,
            CatalogProduct.id.in_({line.product_id for line in doc.lines}))} if doc.lines else {}
        back = returned_quantity(db, tenant_id=tenant_id, delivery_line_ids=[line.id for line in doc.lines])
        result["returns"] = delivery_returns(db, tenant_id=tenant_id, delivery_id=doc.id)
        result["lines"] = []
        for line in doc.lines:
            item = items.get(line.order_line_id)
            product = products.get(line.product_id)
            result["lines"].append({
                "id": line.id, "order_line_id": line.order_line_id, "product_id": line.product_id,
                "name": item.name if item else (product.name if product else "Product"), "sku": product.sku if product else None,
                "quantity": line.quantity, "ordered": item.quantity if item else None,
                "returned": back.get(line.id, Decimal(0)),
                "to_deliver": line_outstanding(db, item, order) if item is not None and order is not None else None,
            })
    return result


def order_deliveries(db: Session, *, tenant_id: int, order_id: int) -> list[dict]:
    rows = db.query(InventoryDelivery).options(selectinload(InventoryDelivery.lines)).filter(InventoryDelivery.tenant_id == tenant_id,
        InventoryDelivery.order_id == order_id, InventoryDelivery.deleted_at.is_(None)).order_by(InventoryDelivery.id).all()
    return [serialize_delivery(db, tenant_id=tenant_id, doc=row, include_lines=False) for row in rows]
