"""What to buy (12b-erp-purchasing.md §2 item 6): Odoo's Replenishment report, Zoho's *Order now*.

Projected stock is what is on hand, less what confirmed orders need (held or waiting), plus
what is on order. A tracked product whose projected stock is at or below its reorder point
in a warehouse, or below zero there, is suggested. Nothing is ordered until a person asks.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryReservation, InventoryStockLevel, InventoryWarehouse
from app.modules.inventory.services.stock_ledger import line_outstanding, open_order_lines_query
from app.modules.purchasing.models import PurchaseOrder
from app.modules.purchasing.services.purchase_order_services import incoming, save_order


def _waiting(db: Session, *, tenant_id: int, product: CatalogProduct, warehouse: InventoryWarehouse) -> Decimal:
    """Demand on confirmed orders that no hold covers yet (E3 backorders)."""
    held = {row.order_line_id: Decimal(row.quantity) for row in db.query(InventoryReservation).filter(
        InventoryReservation.tenant_id == tenant_id, InventoryReservation.product_id == product.id, InventoryReservation.warehouse_id == warehouse.id)}
    total = Decimal(0)
    for line, order in open_order_lines_query(db, tenant_id=tenant_id, product_id=product.id, warehouse=warehouse):
        total += max(line_outstanding(db, line, order) - held.get(line.id, Decimal(0)), Decimal(0))
    return total


def suggested_quantity(*, projected: Decimal, reorder_point: Decimal, reorder_quantity: Decimal) -> Decimal:
    """The reorder quantity (the lot size), or what brings projected stock back to the point, whichever is larger."""
    return max(reorder_quantity, reorder_point - projected, Decimal(0))


def suggestions(db: Session, *, tenant_id: int, warehouse_id: int | None = None, vendor_id: int | None = None) -> list[dict]:
    query = db.query(InventoryStockLevel, CatalogProduct, InventoryWarehouse).join(
        CatalogProduct, CatalogProduct.id == InventoryStockLevel.product_id).join(
        InventoryWarehouse, InventoryWarehouse.id == InventoryStockLevel.warehouse_id).filter(
        InventoryStockLevel.tenant_id == tenant_id, CatalogProduct.tenant_id == tenant_id, InventoryWarehouse.tenant_id == tenant_id,
        CatalogProduct.track_inventory == 1, CatalogProduct.deleted_at.is_(None), CatalogProduct.is_active == 1,
        InventoryWarehouse.deleted_at.is_(None), InventoryWarehouse.is_active == 1)
    if warehouse_id:
        query = query.filter(InventoryStockLevel.warehouse_id == warehouse_id)
    if vendor_id:
        query = query.filter(CatalogProduct.preferred_vendor_id == vendor_id)
    rows = query.order_by(CatalogProduct.name, CatalogProduct.id, InventoryWarehouse.name).all()
    on_order = incoming(db, tenant_id=tenant_id, product_ids=[product.id for _, product, _ in rows])
    result = []
    for level, product, warehouse in rows:
        reorder_point = Decimal(product.reorder_point or 0)
        available = Decimal(level.on_hand) - Decimal(level.reserved)
        waiting = _waiting(db, tenant_id=tenant_id, product=product, warehouse=warehouse)
        coming = on_order.get((product.id, warehouse.id), Decimal(0))
        projected = available - waiting + coming
        if projected > reorder_point or (reorder_point <= 0 and projected >= 0):
            continue
        result.append({
            "product_id": product.id, "product_name": product.name, "sku": product.sku, "vendor_sku": product.vendor_sku,
            "warehouse_id": warehouse.id, "warehouse_name": warehouse.name,
            "on_hand": level.on_hand, "available": available, "backordered": waiting, "incoming": coming, "projected": projected,
            "reorder_point": reorder_point, "reorder_quantity": product.reorder_quantity,
            "suggested": suggested_quantity(projected=projected, reorder_point=reorder_point, reorder_quantity=Decimal(product.reorder_quantity or 0)),
            "preferred_vendor_id": product.preferred_vendor_id,
            "preferred_vendor_name": product.preferred_vendor.org_name if product.preferred_vendor else None,
            "unit_cost": product.cost_price, "currency": product.currency, "lead_time_days": product.lead_time_days,
        })
    return result


def create_draft_orders(db: Session, *, tenant_id: int, actor_user_id: int | None, rows: list[dict]) -> list[PurchaseOrder]:
    """Selected suggestions → one draft PO per preferred vendor, warehouse and currency. Never commits."""
    if not rows:
        raise HTTPException(status_code=400, detail="Choose at least one product")
    product_ids = {int(row["product_id"]) for row in rows}
    products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id.in_(product_ids),
        CatalogProduct.deleted_at.is_(None))}
    missing = [products[pid].name for pid in product_ids if pid in products and not products[pid].preferred_vendor_id]
    if set(products) != product_ids:
        raise HTTPException(status_code=404, detail="Product not found")
    if missing:
        raise HTTPException(status_code=409, detail=f"Set a preferred vendor first for: {', '.join(sorted(missing))}")
    groups: dict[tuple[int, int, str], list[dict]] = {}
    for row in rows:
        product = products[int(row["product_id"])]
        key = (product.preferred_vendor_id, int(row["warehouse_id"]), product.currency)
        groups.setdefault(key, []).append({"product_id": product.id, "quantity": row["quantity"], "unit_cost": product.cost_price or 0,
            "description": product.vendor_sku and f"Vendor code {product.vendor_sku}"})
    orders = []
    for (vendor_id, warehouse_id, currency), lines in sorted(groups.items()):
        orders.append(save_order(db, tenant_id=tenant_id, actor_user_id=actor_user_id, payload={
            "vendor_id": vendor_id, "warehouse_id": warehouse_id, "currency": currency,
            "notes": "Drafted from reorder suggestions.", "lines": lines,
        }))
    return orders
