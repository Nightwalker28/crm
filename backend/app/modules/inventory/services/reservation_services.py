"""Read models for stock holds: an order's fulfilment figures and one product's holds.

Writes go through `stock_ledger.py` (`reserve_for_order`, `set_reservations`).
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryReservation, InventoryStockLevel, InventoryWarehouse
from app.modules.inventory.services.return_services import returned_for_order_line
from app.modules.inventory.services.stock_ledger import (
    delivered_quantity, ensure_default_warehouse, line_outstanding, open_order_lines_query, order_warehouse_id, reservation_version,
)
from app.modules.sales.models import SalesOrder


def _availability(to_deliver: Decimal, reserved: Decimal) -> str | None:
    if to_deliver <= 0:
        return None
    if reserved >= to_deliver:
        return "reserved"
    return "partly_reserved" if reserved > 0 else "waiting"


def order_fulfilment(db: Session, *, tenant_id: int, order: SalesOrder) -> dict:
    """Per line: ordered, reserved, to deliver and waiting, plus what is free in the warehouse."""
    warehouse_id = order_warehouse_id(db, order)
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.id == warehouse_id, InventoryWarehouse.tenant_id == tenant_id).first()
    product_ids = {line.catalog_product_id for line in order.items if line.catalog_product_id is not None}
    tracked = {row.id for row in db.query(CatalogProduct.id).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id.in_(product_ids),
        CatalogProduct.track_inventory == 1, CatalogProduct.deleted_at.is_(None))} if product_ids else set()
    held: dict[int, Decimal] = {}
    for row in db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id, InventoryReservation.order_id == order.id):
        held[row.order_line_id] = held.get(row.order_line_id, Decimal(0)) + Decimal(row.quantity)
    levels = {row.product_id: row for row in db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id,
        InventoryStockLevel.warehouse_id == warehouse_id, InventoryStockLevel.product_id.in_(tracked))} if tracked else {}
    open_order = order.status == "confirmed"
    lines = []
    for line in order.items:
        is_tracked = line.catalog_product_id in tracked
        ordered = Decimal(line.quantity)
        reserved = held.get(line.id, Decimal(0))
        to_deliver = line_outstanding(db, line, order) if is_tracked and open_order else Decimal(0)
        level = levels.get(line.catalog_product_id)
        lines.append({
            "order_line_id": line.id, "name": line.name, "product_id": line.catalog_product_id, "tracked": is_tracked,
            "ordered": ordered, "delivered": delivered_quantity(db, line) if is_tracked else Decimal(0),
            "returned": returned_for_order_line(db, line) if is_tracked else Decimal(0),
            "reserved": reserved, "to_deliver": to_deliver,
            "waiting": max(to_deliver - reserved, Decimal(0)),
            "available": (Decimal(level.on_hand) - Decimal(level.reserved)) if level is not None else (Decimal(0) if is_tracked else None),
            "availability": _availability(to_deliver, reserved) if is_tracked and open_order else None,
        })
    tracked_open = [line for line in lines if line["tracked"] and line["to_deliver"] > 0]
    from app.modules.inventory.services.delivery_services import order_deliveries
    from app.modules.inventory.services.return_services import order_returns

    return {
        "order_id": order.id, "order_number": order.order_number, "status": order.status, "delivery_status": order.delivery_status,
        "remaining_closed_at": order.remaining_closed_at, "remaining_close_reason": order.remaining_close_reason,
        "deliveries": order_deliveries(db, tenant_id=tenant_id, order_id=order.id),
        "returns": order_returns(db, tenant_id=tenant_id, order_id=order.id),
        "warehouse_id": warehouse_id, "warehouse_name": warehouse.name if warehouse else None,
        "availability": (None if not tracked_open else
            "reserved" if all(line["availability"] == "reserved" for line in tracked_open) else
            "waiting" if all(line["availability"] == "waiting" for line in tracked_open) else "partly_reserved"),
        "lines": lines,
    }


def product_reservations(db: Session, *, tenant_id: int, product_id: int, warehouse_id: int | None) -> dict:
    """Every open order line for one product in one warehouse, oldest first, with its hold."""
    product = db.query(CatalogProduct).filter(CatalogProduct.id == product_id, CatalogProduct.tenant_id == tenant_id, CatalogProduct.deleted_at.is_(None)).first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.track_inventory:
        raise HTTPException(status_code=409, detail=f"{product.name} does not track inventory")
    if warehouse_id is None:
        warehouse = ensure_default_warehouse(db, tenant_id=tenant_id)
    else:
        warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.id == warehouse_id, InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_(None)).first()
        if warehouse is None:
            raise HTTPException(status_code=404, detail="Warehouse not found")
    level = db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.product_id == product_id,
        InventoryStockLevel.warehouse_id == warehouse.id).first()
    rows = {row.order_line_id: row for row in db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id,
        InventoryReservation.product_id == product_id, InventoryReservation.warehouse_id == warehouse.id)}
    lines = []
    for line, order in open_order_lines_query(db, tenant_id=tenant_id, product_id=product_id, warehouse=warehouse):
        to_deliver = line_outstanding(db, line, order)
        if to_deliver <= 0:
            continue
        row = rows.get(line.id)
        lines.append({
            "order_line_id": line.id, "order_id": order.id, "order_number": order.order_number,
            "customer_name": order.organization_name or order.contact_name, "confirmed_at": order.created_at, "priority": order.priority,
            "delivery_date": order.delivery_date, "to_deliver": to_deliver,
            "reserved": Decimal(row.quantity) if row is not None else Decimal(0), "manual": bool(row.manual) if row is not None else False,
        })
    warehouses = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_(None)).order_by(
        InventoryWarehouse.is_default.desc(), InventoryWarehouse.name).all()
    on_hand = Decimal(level.on_hand) if level is not None else Decimal(0)
    reserved = Decimal(level.reserved) if level is not None else Decimal(0)
    return {
        "product_id": product.id, "product_name": product.name, "sku": product.sku,
        "warehouse_id": warehouse.id, "warehouse_name": warehouse.name,
        "warehouses": [{"id": row.id, "name": row.name} for row in warehouses],
        "on_hand": on_hand, "reserved": reserved, "available": on_hand - reserved,
        "version": reservation_version(db, tenant_id=tenant_id, product_id=product_id, warehouse_id=warehouse.id),
        "lines": lines,
    }
