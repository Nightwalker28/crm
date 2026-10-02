"""The sole writer of tracked product stock, levels and immutable movements."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryStockLevel, InventoryStockMove, InventoryWarehouse


@dataclass(frozen=True)
class MoveSpec:
    product_id: int
    warehouse_id: int
    quantity: Decimal
    move_type: str
    source_type: str
    source_id: int
    source_line_id: int | None = None
    reverses_move_id: int | None = None
    reason: str | None = None
    note: str | None = None


def _quantity(value: Decimal) -> Decimal:
    try:
        quantity = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid stock quantity") from exc
    if not quantity.is_finite() or quantity == 0 or quantity != quantity.quantize(Decimal("0.0001")):
        raise HTTPException(status_code=400, detail="Stock change must be nonzero and have at most four decimal places")
    return quantity


def ensure_default_warehouse(db: Session, *, tenant_id: int) -> InventoryWarehouse:
    """Seed the Main warehouse for tenants created after the opening migration."""
    existing = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.is_default == 1, InventoryWarehouse.deleted_at.is_(None)).first()
    if existing:
        return existing
    db.execute(text("""
        INSERT INTO inventory_warehouses (tenant_id, code, name, is_default)
        VALUES (:tenant_id, 'MAIN', 'Main', 1)
        ON CONFLICT (tenant_id, code) DO NOTHING
    """), {"tenant_id": tenant_id})
    db.flush()
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.is_default == 1, InventoryWarehouse.deleted_at.is_(None)).first()
    if warehouse is None:
        raise HTTPException(status_code=409, detail="Default warehouse is unavailable")
    return warehouse


def _level_for_update(db: Session, *, tenant_id: int, product_id: int, warehouse_id: int) -> InventoryStockLevel:
    db.execute(text("""
        INSERT INTO inventory_stock_levels (tenant_id, product_id, warehouse_id, on_hand, reserved)
        VALUES (:tenant_id, :product_id, :warehouse_id, 0, 0)
        ON CONFLICT (tenant_id, product_id, warehouse_id) DO NOTHING
    """), {"tenant_id": tenant_id, "product_id": product_id, "warehouse_id": warehouse_id})
    db.flush()
    return db.query(InventoryStockLevel).filter(
        InventoryStockLevel.tenant_id == tenant_id,
        InventoryStockLevel.product_id == product_id,
        InventoryStockLevel.warehouse_id == warehouse_id,
    ).populate_existing().with_for_update().one()


def ensure_product_levels(db: Session, *, tenant_id: int, product_id: int) -> None:
    """Materialize zero balances so a newly tracked product appears in every warehouse."""
    ensure_default_warehouse(db, tenant_id=tenant_id)
    warehouses = db.query(InventoryWarehouse.id).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_(None)).order_by(InventoryWarehouse.id).all()
    for (warehouse_id,) in warehouses:
        _level_for_update(db, tenant_id=tenant_id, product_id=product_id, warehouse_id=warehouse_id)


def post_moves(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    moves: list[MoveSpec],
    allow_inactive_for_reversal: bool = False,
) -> list[InventoryStockMove]:
    """Post all moves in the caller's transaction; never commit here.

    Products are locked in ID order before levels are created and locked in product/warehouse
    order. This also serializes creation of a missing balance row for the same product.
    """
    if not moves:
        return []
    normalized = [(spec, _quantity(spec.quantity)) for spec in moves]
    product_ids = sorted({spec.product_id for spec, _ in normalized})
    warehouse_ids = sorted({spec.warehouse_id for spec, _ in normalized})
    products = {}
    for product_id in product_ids:
        product = db.query(CatalogProduct).filter(CatalogProduct.id == product_id, CatalogProduct.tenant_id == tenant_id).populate_existing().with_for_update().first()
        if product is None:
            raise HTTPException(status_code=404, detail="Product not found")
        if not product.track_inventory:
            raise HTTPException(status_code=409, detail=f"{product.name} does not track inventory")
        if (not product.is_active or product.deleted_at is not None) and not allow_inactive_for_reversal:
            raise HTTPException(status_code=409, detail=f"{product.name} is inactive")
        products[product_id] = product
    warehouses = {}
    for warehouse_id in warehouse_ids:
        warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.id == warehouse_id, InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_(None)).first()
        if warehouse is None:
            raise HTTPException(status_code=404, detail="Warehouse not found")
        if not warehouse.is_active and not allow_inactive_for_reversal:
            raise HTTPException(status_code=409, detail=f"{warehouse.name} is inactive")
        warehouses[warehouse_id] = warehouse

    levels = {}
    for product_id, warehouse_id in sorted({(spec.product_id, spec.warehouse_id) for spec, _ in normalized}):
        levels[(product_id, warehouse_id)] = _level_for_update(db, tenant_id=tenant_id, product_id=product_id, warehouse_id=warehouse_id)

    posted = []
    touched = set()
    for spec, quantity in normalized:
        if spec.source_line_id is not None:
            existing = db.query(InventoryStockMove).filter(
                InventoryStockMove.tenant_id == tenant_id,
                InventoryStockMove.source_type == spec.source_type,
                InventoryStockMove.source_line_id == spec.source_line_id,
                InventoryStockMove.move_type == spec.move_type,
            ).first()
            if existing is not None:
                if existing.product_id != spec.product_id or existing.warehouse_id != spec.warehouse_id or Decimal(existing.quantity) != quantity:
                    raise HTTPException(status_code=409, detail="Stock movement source line was already posted differently")
                posted.append(existing)
                continue
        if spec.reverses_move_id is not None:
            existing_reversal = db.query(InventoryStockMove).filter(InventoryStockMove.tenant_id == tenant_id, InventoryStockMove.reverses_move_id == spec.reverses_move_id).first()
            if existing_reversal is not None:
                posted.append(existing_reversal)
                continue
        level = levels[(spec.product_id, spec.warehouse_id)]
        after = Decimal(level.on_hand) + quantity
        if after < 0:
            shortage = -after
            raise HTTPException(status_code=409, detail=f"Insufficient stock for {products[spec.product_id].name} in {warehouses[spec.warehouse_id].name}: short by {shortage}")
        level.on_hand = after
        move = InventoryStockMove(
            tenant_id=tenant_id, product_id=spec.product_id, warehouse_id=spec.warehouse_id,
            quantity=quantity, move_type=spec.move_type, source_type=spec.source_type,
            source_id=spec.source_id, source_line_id=spec.source_line_id,
            reverses_move_id=spec.reverses_move_id, unit_cost=products[spec.product_id].cost_price,
            on_hand_after=after, reason=spec.reason, note=spec.note, created_by=actor_user_id,
        )
        db.add(level)
        db.add(move)
        db.flush()
        posted.append(move)
        touched.add(spec.product_id)
    for product_id in touched:
        product = products[product_id]
        total = sum((Decimal(row.on_hand) for row in db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.product_id == product_id)), Decimal("0"))
        product.stock_quantity = total
        product.stock_status = "in_stock" if total > 0 else "out_of_stock"
        db.add(product)
    db.flush()
    return posted


def reverse_moves(db: Session, *, tenant_id: int, actor_user_id: int | None, source_type: str, source_id: int, reason: str) -> list[InventoryStockMove]:
    original = db.query(InventoryStockMove).filter(
        InventoryStockMove.tenant_id == tenant_id,
        InventoryStockMove.source_type == source_type,
        InventoryStockMove.source_id == source_id,
        InventoryStockMove.reverses_move_id.is_(None),
    ).order_by(InventoryStockMove.id).all()
    if not original:
        return []
    return post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, allow_inactive_for_reversal=True, moves=[
        MoveSpec(product_id=move.product_id, warehouse_id=move.warehouse_id, quantity=-Decimal(move.quantity),
                 move_type="reversal", source_type=source_type, source_id=source_id,
                 source_line_id=None, reverses_move_id=move.id, reason=reason)
        for move in original
    ])
