"""Customer returns against a posted delivery (12a-erp-fulfilment.md §3, Phase 3).

A return starts from a delivery and defaults to what it shipped, less what has already come
back. Stock returns on *Receive*, line by line: a line marked not to restock (damaged goods)
is recorded but moves nothing. Cancelling a received return posts the reversal. A return
does not reopen the order: what was delivered stays delivered, and the line shows Returned.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import func, or_
from app.core.list_conditions import apply_list_conditions
from sqlalchemy.orm import Session, selectinload

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryDelivery, InventoryDeliveryLine, InventoryReturn, InventoryReturnLine, InventoryWarehouse
from app.modules.inventory.services.inventory_services import get_warehouse_or_404
from app.modules.inventory.services.stock_ledger import MoveSpec, post_moves, reverse_moves
from app.modules.platform.services.crm_events import stage_standard_crm_event
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.sales.models import SalesOrder, SalesOrderItem
from app.modules.platform.services.custom_fields import load_custom_field_values, sync_custom_fields


def list_field_map() -> dict:
    """The return list's saved-view fields (13c §3.2)."""
    return {
        "number": {"expression": InventoryReturn.number, "type": "text"},
        "status": {"expression": InventoryReturn.status, "type": "text"},
        "reason": {"expression": InventoryReturn.reason, "type": "text"},
        "order_id": {"expression": InventoryReturn.order_id, "type": "number"},
        "warehouse_id": {"expression": InventoryReturn.warehouse_id, "type": "number"},
        "received_at": {"expression": InventoryReturn.received_at, "type": "date"},
        "created_at": {"expression": InventoryReturn.created_at, "type": "date"},
    }

def list_query(db: Session, *, tenant_id: int, status: str | None = None, search: str | None = None, delivery_id: int | None = None, filters_all: list[dict] | None = None, filters_any: list[dict] | None = None):
    """The return list's rows. The list and its export both start here (13a A5)."""
    query = db.query(InventoryReturn).options(selectinload(InventoryReturn.lines)).filter(
        InventoryReturn.tenant_id == tenant_id, InventoryReturn.deleted_at.is_(None))
    if status:
        query = query.filter(InventoryReturn.status == status)
    if delivery_id:
        query = query.filter(InventoryReturn.delivery_id == delivery_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.join(SalesOrder, SalesOrder.id == InventoryReturn.order_id).filter(SalesOrder.tenant_id == tenant_id, or_(
            InventoryReturn.number.ilike(pattern), InventoryReturn.reason.ilike(pattern), SalesOrder.order_number.ilike(pattern)))
    query = apply_list_conditions(query, field_map=list_field_map(), filters_all=filters_all, filters_any=filters_any)
    return query


def _quantity(value) -> Decimal:
    try:
        result = Decimal(str(value))
        valid = result.is_finite() and result > 0 and result == result.quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail="Return quantities must be greater than zero, with at most four decimal places")
    return result


def _units(value: Decimal) -> str:
    text_value = format(Decimal(value).normalize(), "f")
    return f"{text_value} unit" if Decimal(value) == 1 else f"{text_value} units"


def get_return(db: Session, *, tenant_id: int, return_id: int, include_deleted: bool = False, lock: bool = False) -> InventoryReturn | None:
    query = db.query(InventoryReturn).options(selectinload(InventoryReturn.lines)).filter(
        InventoryReturn.tenant_id == tenant_id, InventoryReturn.id == return_id)
    if not include_deleted:
        query = query.filter(InventoryReturn.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def _return_or_404(db: Session, **kwargs) -> InventoryReturn:
    doc = get_return(db, **kwargs)
    if doc is None:
        raise HTTPException(status_code=404, detail="Return not found")
    return doc


def _delivery_or_404(db: Session, *, tenant_id: int, delivery_id: int, lock: bool = False) -> InventoryDelivery:
    query = db.query(InventoryDelivery).options(selectinload(InventoryDelivery.lines)).filter(
        InventoryDelivery.tenant_id == tenant_id, InventoryDelivery.id == delivery_id, InventoryDelivery.deleted_at.is_(None))
    doc = (query.with_for_update() if lock else query).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return doc


def _audit(db: Session, *, tenant_id: int, actor_user_id: int | None, doc: InventoryReturn, action: str, description: str) -> None:
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="inventory_returns", entity_type="inventory_return",
        entity_id=doc.id, action=action, description=description, commit=False)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="sales_orders", entity_type="sales_order",
        entity_id=doc.order_id, action=f"sales_order.return_{action}", description=description, commit=False)


def returned_quantity(db: Session, *, tenant_id: int, delivery_line_ids=None, order_line_id: int | None = None, exclude_return_id: int | None = None) -> dict[int, Decimal]:
    """Received return quantities per delivery line (or for one order line, keyed by its delivery lines)."""
    query = db.query(InventoryReturnLine.delivery_line_id, func.sum(InventoryReturnLine.quantity)).join(
        InventoryReturn, InventoryReturn.id == InventoryReturnLine.return_id).filter(
        InventoryReturnLine.tenant_id == tenant_id, InventoryReturn.status == "received")
    if delivery_line_ids is not None:
        query = query.filter(InventoryReturnLine.delivery_line_id.in_(list(delivery_line_ids) or [0]))
    if order_line_id is not None:
        query = query.filter(InventoryReturnLine.order_line_id == order_line_id)
    if exclude_return_id is not None:
        query = query.filter(InventoryReturn.id != exclude_return_id)
    return {row[0]: Decimal(row[1] or 0) for row in query.group_by(InventoryReturnLine.delivery_line_id)}


def returned_for_order_line(db: Session, line: SalesOrderItem) -> Decimal:
    return sum(returned_quantity(db, tenant_id=line.tenant_id, order_line_id=line.id).values(), Decimal(0))


def returnable(db: Session, *, tenant_id: int, delivery: InventoryDelivery) -> dict[int, Decimal]:
    """What can still come back per delivery line: shipped less already received."""
    back = returned_quantity(db, tenant_id=tenant_id, delivery_line_ids=[line.id for line in delivery.lines])
    return {line.id: Decimal(line.quantity) - back.get(line.id, Decimal(0)) for line in delivery.lines}


def has_open_returns(db: Session, *, tenant_id: int, delivery_id: int) -> bool:
    return db.query(InventoryReturn.id).filter(InventoryReturn.tenant_id == tenant_id, InventoryReturn.delivery_id == delivery_id,
        InventoryReturn.deleted_at.is_(None), InventoryReturn.status.in_(["draft", "received"])).first() is not None


def _validated_lines(db: Session, *, tenant_id: int, delivery: InventoryDelivery, lines: list[dict]) -> list[tuple[InventoryDeliveryLine, Decimal, bool]]:
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one line to return")
    by_id = {line.id: line for line in delivery.lines}
    left = returnable(db, tenant_id=tenant_id, delivery=delivery)
    names = {item.id: item.name for item in db.query(SalesOrderItem).filter(SalesOrderItem.tenant_id == tenant_id,
        SalesOrderItem.id.in_([line.order_line_id for line in delivery.lines] or [0]))}
    result, seen = [], set()
    for payload in lines:
        line_id = int(payload["delivery_line_id"])
        if line_id in seen:
            raise HTTPException(status_code=400, detail="A delivery line can appear once per return")
        seen.add(line_id)
        line = by_id.get(line_id)
        if line is None:
            raise HTTPException(status_code=400, detail="Only lines of this delivery can be returned")
        quantity = _quantity(payload["quantity"])
        if quantity > left[line_id]:
            raise HTTPException(status_code=409, detail=f"{names.get(line.order_line_id, 'This line')}: only {_units(left[line_id])} can still come back")
        result.append((line, quantity, bool(payload.get("restock", True))))
    return result


def save_return(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, return_id: int | None = None) -> InventoryReturn:
    if return_id is not None:
        doc = _return_or_404(db, tenant_id=tenant_id, return_id=return_id, lock=True)
        if doc.status != "draft":
            raise HTTPException(status_code=409, detail="Only a draft return can be edited")
        delivery = _delivery_or_404(db, tenant_id=tenant_id, delivery_id=doc.delivery_id)
    else:
        delivery = _delivery_or_404(db, tenant_id=tenant_id, delivery_id=int(payload["delivery_id"]))
        doc = None
    if delivery.status != "posted":
        raise HTTPException(status_code=409, detail="Only a posted delivery can have returns")
    reason = (payload.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A return reason is required")
    raw_lines = payload.get("lines")
    if raw_lines is None:
        raw_lines = [{"delivery_line_id": line_id, "quantity": left, "restock": True}
                     for line_id, left in returnable(db, tenant_id=tenant_id, delivery=delivery).items() if left > 0]
        if not raw_lines:
            raise HTTPException(status_code=409, detail="Everything on this delivery has already come back")
    lines = _validated_lines(db, tenant_id=tenant_id, delivery=delivery, lines=raw_lines)
    warehouse_id = payload.get("warehouse_id") or (doc.warehouse_id if doc else delivery.warehouse_id)
    warehouse = get_warehouse_or_404(db, tenant_id=tenant_id, warehouse_id=warehouse_id)
    if not warehouse.is_active:
        raise HTTPException(status_code=409, detail=f"{warehouse.name} is inactive")
    if doc is None:
        doc = InventoryReturn(tenant_id=tenant_id, delivery_id=delivery.id, order_id=delivery.order_id,
            number=allocate_business_number(db, tenant_id=tenant_id, scope="inventory_returns", prefix="RET"))
    doc.warehouse_id, doc.reason = warehouse.id, reason
    doc.notes = (payload.get("notes") or "").strip() or None
    doc.lines = []
    db.add(doc)
    db.flush()
    for line, quantity, restock in lines:
        doc.lines.append(InventoryReturnLine(tenant_id=tenant_id, delivery_line_id=line.id, order_line_id=line.order_line_id,
            product_id=line.product_id, quantity=quantity, restock=int(restock)))
    db.flush()
    sync_custom_fields(db, tenant_id=tenant_id, module_key="inventory_returns", record=doc, payload=payload, created=return_id is None,
                       enforce_required="custom_fields" in payload)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, action="update" if return_id else "create",
        description=f"{'Updated' if return_id else 'Created'} return {doc.number} against {delivery.number}")
    return doc


def delivered_costs(db: Session, *, tenant_id: int, delivery) -> dict[int, Decimal]:
    """Unit cost per delivery line: its delivery move, or for a delivery migrated from E2, the
    order's legacy `sales_order` move for that line."""
    from app.modules.inventory.models import InventoryDeliveryLine, InventoryStockMove

    lines = db.query(InventoryDeliveryLine).filter(InventoryDeliveryLine.tenant_id == tenant_id, InventoryDeliveryLine.delivery_id == delivery.id).all()
    moves = {move.source_line_id: move for move in db.query(InventoryStockMove).filter(InventoryStockMove.tenant_id == tenant_id,
        InventoryStockMove.source_type == "inventory_delivery", InventoryStockMove.source_id == delivery.id,
        InventoryStockMove.move_type == "delivery")}
    legacy = {move.source_line_id: move for move in db.query(InventoryStockMove).filter(InventoryStockMove.tenant_id == tenant_id,
        InventoryStockMove.source_type == "sales_order", InventoryStockMove.source_id == delivery.order_id,
        InventoryStockMove.move_type == "sales_order")} if delivery.migrated else {}
    result = {}
    for line in lines:
        move = moves.get(line.id) or legacy.get(line.order_line_id)
        if move is not None and move.unit_cost is not None:
            result[line.id] = Decimal(move.unit_cost)
    return result


def receive_return(db: Session, *, tenant_id: int, actor_user_id: int | None, return_id: int) -> InventoryReturn:
    doc = _return_or_404(db, tenant_id=tenant_id, return_id=return_id, lock=True)
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft return can be received")
    delivery = _delivery_or_404(db, tenant_id=tenant_id, delivery_id=doc.delivery_id, lock=True)
    if delivery.status != "posted":
        raise HTTPException(status_code=409, detail="The delivery is no longer posted")
    _validated_lines(db, tenant_id=tenant_id, delivery=delivery,
        lines=[{"delivery_line_id": line.delivery_line_id, "quantity": line.quantity, "restock": line.restock} for line in doc.lines])
    # Returned goods come back at the cost they left at (12d §5 decision 4).
    costs = delivered_costs(db, tenant_id=tenant_id, delivery=delivery)
    moves = [MoveSpec(product_id=line.product_id, warehouse_id=doc.warehouse_id, quantity=Decimal(line.quantity), move_type="return",
                      source_type="inventory_return", source_id=doc.id, source_line_id=line.id, reason=doc.reason, note=doc.notes,
                      unit_cost=costs.get(line.delivery_line_id), cost_source="return" if costs.get(line.delivery_line_id) is not None else None,
                      sales_order_item_id=line.order_line_id)
             for line in doc.lines if line.restock]
    post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, moves=moves)
    doc.status, doc.received_at, doc.received_by = "received", datetime.now(timezone.utc), actor_user_id
    db.add(doc)
    db.flush()
    order = db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id, SalesOrder.id == doc.order_id).first()
    if order is not None:
        from app.modules.finance.services.invoicing_services import refresh_invoice_status

        refresh_invoice_status(db, order=order)
    stage_standard_crm_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id, event_type="inventory.return_received",
        entity_type="inventory_return", entity_id=doc.id,
        payload={"number": doc.number, "reason": doc.reason, "delivery_id": delivery.id, "delivery_number": delivery.number,
                 "order_id": doc.order_id, "order_number": order.order_number if order else None, "warehouse_id": doc.warehouse_id,
                 "restocked_lines": sum(1 for line in doc.lines if line.restock), "record_label": doc.number,
                 "record_url": f"/dashboard/inventory/returns/{doc.id}"})
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, action="receive",
        description=f"Received return {doc.number} against {delivery.number}: {doc.reason}")
    return doc


def cancel_return(db: Session, *, tenant_id: int, actor_user_id: int | None, return_id: int, reason: str) -> InventoryReturn:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A cancellation reason is required")
    doc = _return_or_404(db, tenant_id=tenant_id, return_id=return_id, lock=True)
    if doc.status != "received":
        raise HTTPException(status_code=409, detail="Only a received return can be cancelled")
    from app.modules.finance.models import FinanceCreditNote

    credited = db.query(FinanceCreditNote.number).filter(FinanceCreditNote.tenant_id == tenant_id, FinanceCreditNote.return_id == doc.id,
        FinanceCreditNote.deleted_at.is_(None), FinanceCreditNote.status == "issued").first()
    if credited is not None:
        raise HTTPException(status_code=409, detail=f"Credit note {credited[0]} was issued for this return; void it first")
    reverse_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, source_type="inventory_return", source_id=doc.id, reason=reason)
    doc.status, doc.cancel_reason = "cancelled", reason
    db.add(doc)
    db.flush()
    from app.modules.finance.services.invoicing_services import refresh_for_order_id

    refresh_for_order_id(db, tenant_id=tenant_id, order_id=doc.order_id)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, action="cancel", description=f"Cancelled return {doc.number}: {reason}")
    return doc


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, return_id: int) -> None:
    doc = _return_or_404(db, tenant_id=tenant_id, return_id=return_id, lock=True)
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft return can be removed")
    doc.deleted_at = datetime.now(timezone.utc)
    db.add(doc)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, action="delete", description=f"Removed draft return {doc.number}")


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, return_id: int) -> InventoryReturn:
    doc = get_return(db, tenant_id=tenant_id, return_id=return_id, include_deleted=True, lock=True)
    if doc is None or doc.deleted_at is None or doc.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    doc.deleted_at = None
    db.add(doc)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, doc=doc, action="restore", description=f"Restored draft return {doc.number}")
    return doc


def serialize_return(db: Session, *, tenant_id: int, doc: InventoryReturn, include_lines: bool = True) -> dict:
    delivery = db.query(InventoryDelivery).options(selectinload(InventoryDelivery.lines)).filter(
        InventoryDelivery.tenant_id == tenant_id, InventoryDelivery.id == doc.delivery_id).first()
    order = db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id, SalesOrder.id == doc.order_id).first()
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.id == doc.warehouse_id).first()
    result = {
        "id": doc.id, "number": doc.number, "status": doc.status, "reason": doc.reason, "notes": doc.notes,
        "delivery_id": doc.delivery_id, "delivery_number": delivery.number if delivery else None,
        "order_id": doc.order_id, "order_number": order.order_number if order else None,
        "customer_name": (order.organization_name or order.contact_name) if order else None,
        "warehouse_id": doc.warehouse_id, "warehouse_name": warehouse.name if warehouse else None,
        "received_at": doc.received_at, "received_by": doc.received_by, "cancel_reason": doc.cancel_reason,
        "created_at": doc.created_at, "is_deleted": doc.deleted_at is not None, "line_count": len(doc.lines),
        "total_quantity": sum((Decimal(line.quantity) for line in doc.lines), Decimal(0)),
    }
    if include_lines:
        items = {item.id: item for item in (order.items if order else [])}
        products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id,
            CatalogProduct.id.in_({line.product_id for line in doc.lines} or {0}))}
        shipped = {line.id: Decimal(line.quantity) for line in (delivery.lines if delivery else [])}
        back = returned_quantity(db, tenant_id=tenant_id, delivery_line_ids=list(shipped), exclude_return_id=doc.id)
        result["lines"] = [{
            "id": line.id, "delivery_line_id": line.delivery_line_id, "order_line_id": line.order_line_id, "product_id": line.product_id,
            "name": items[line.order_line_id].name if line.order_line_id in items else (products[line.product_id].name if line.product_id in products else "Product"),
            "sku": products[line.product_id].sku if line.product_id in products else None,
            "quantity": line.quantity, "restock": bool(line.restock), "shipped": shipped.get(line.delivery_line_id),
            "returnable": shipped.get(line.delivery_line_id, Decimal(0)) - back.get(line.delivery_line_id, Decimal(0)),
        } for line in doc.lines]
    if include_lines:
        result["custom_fields"] = load_custom_field_values(db, tenant_id=tenant_id, module_key="inventory_returns", record_id=doc.id)
    return result


def delivery_returns(db: Session, *, tenant_id: int, delivery_id: int) -> list[dict]:
    rows = db.query(InventoryReturn).options(selectinload(InventoryReturn.lines)).filter(InventoryReturn.tenant_id == tenant_id,
        InventoryReturn.delivery_id == delivery_id, InventoryReturn.deleted_at.is_(None)).order_by(InventoryReturn.id).all()
    return [serialize_return(db, tenant_id=tenant_id, doc=row, include_lines=False) for row in rows]


def order_returns(db: Session, *, tenant_id: int, order_id: int) -> list[dict]:
    rows = db.query(InventoryReturn).options(selectinload(InventoryReturn.lines)).filter(InventoryReturn.tenant_id == tenant_id,
        InventoryReturn.order_id == order_id, InventoryReturn.deleted_at.is_(None)).order_by(InventoryReturn.id).all()
    return [serialize_return(db, tenant_id=tenant_id, doc=row, include_lines=False) for row in rows]
