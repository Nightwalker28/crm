from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import or_, text
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryAdjustment, InventoryAdjustmentLine, InventoryStockLevel, InventoryStockMove, InventoryTransfer, InventoryWarehouse
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, post_moves, stage_inventory_event
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.user_management.models import User


def list_warehouses(db: Session, *, tenant_id: int, include_deleted: bool = False) -> list[InventoryWarehouse]:
    ensure_default_warehouse(db, tenant_id=tenant_id)
    query = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id)
    if not include_deleted:
        query = query.filter(InventoryWarehouse.deleted_at.is_(None))
    return query.order_by(InventoryWarehouse.is_default.desc(), InventoryWarehouse.name, InventoryWarehouse.id).all()


def get_warehouse_or_404(db: Session, *, tenant_id: int, warehouse_id: int) -> InventoryWarehouse:
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.id == warehouse_id, InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_(None)).first()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return warehouse


def save_warehouse(db: Session, *, tenant_id: int, actor_user_id: int, payload: dict, warehouse_id: int | None = None) -> InventoryWarehouse:
    ensure_default_warehouse(db, tenant_id=tenant_id)
    code = str(payload.get("code") or "").strip().upper()
    name = str(payload.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(status_code=400, detail="Warehouse code and name are required")
    existing = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.code == code).first()
    if existing is not None and existing.id != warehouse_id:
        raise HTTPException(status_code=409, detail="Warehouse code already exists")
    warehouse = get_warehouse_or_404(db, tenant_id=tenant_id, warehouse_id=warehouse_id) if warehouse_id is not None else InventoryWarehouse(tenant_id=tenant_id)
    if warehouse.is_default and code != "MAIN":
        raise HTTPException(status_code=409, detail="The default warehouse code must stay MAIN")
    if warehouse.is_default and payload.get("is_active") is False:
        raise HTTPException(status_code=409, detail="The default warehouse must stay active")
    if warehouse_id is not None and payload.get("is_active") is False:
        has_balance = db.query(InventoryStockLevel.id).filter(
            InventoryStockLevel.tenant_id == tenant_id,
            InventoryStockLevel.warehouse_id == warehouse_id,
            InventoryStockLevel.on_hand != 0,
        ).first() is not None
        if has_balance:
            raise HTTPException(status_code=409, detail="Move or adjust the remaining stock before deactivating this warehouse")
    warehouse.code = code
    warehouse.name = name
    warehouse.address = str(payload.get("address") or "").strip() or None
    warehouse.is_active = int(payload.get("is_active", True))
    db.add(warehouse)
    db.flush()
    if warehouse_id is None:
        db.execute(text("""
            INSERT INTO inventory_stock_levels (tenant_id, product_id, warehouse_id, on_hand, reserved)
            SELECT :tenant_id, id, :warehouse_id, 0, 0 FROM catalog_products
            WHERE tenant_id = :tenant_id AND track_inventory = 1
            ON CONFLICT (tenant_id, product_id, warehouse_id) DO NOTHING
        """), {"tenant_id": tenant_id, "warehouse_id": warehouse.id})
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="inventory_stock", entity_type="inventory_warehouse", entity_id=warehouse.id, action="update" if warehouse_id else "create", description=f"Saved warehouse {warehouse.name}", commit=False)
    db.commit()
    db.refresh(warehouse)
    return warehouse


def delete_warehouse(db: Session, *, tenant_id: int, actor_user_id: int, warehouse_id: int) -> None:
    warehouse = get_warehouse_or_404(db, tenant_id=tenant_id, warehouse_id=warehouse_id)
    if warehouse.is_default:
        raise HTTPException(status_code=409, detail="The default warehouse cannot be removed")
    # A warehouse with history remains addressable for audit and cannot be removed.
    has_history = db.query(InventoryStockMove.id).filter(InventoryStockMove.tenant_id == tenant_id, InventoryStockMove.warehouse_id == warehouse_id).first() is not None
    has_balance = db.query(InventoryStockLevel.id).filter(InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.warehouse_id == warehouse_id, InventoryStockLevel.on_hand != 0).first() is not None
    if has_history or has_balance:
        raise HTTPException(status_code=409, detail="A warehouse with stock or movement history cannot be removed; deactivate it instead")
    # A removed warehouse is unreachable, so a live draft pointing at it could never be posted.
    has_draft = db.query(InventoryAdjustment.id).filter(InventoryAdjustment.tenant_id == tenant_id, InventoryAdjustment.deleted_at.is_(None), InventoryAdjustment.status == "draft", InventoryAdjustment.warehouse_id == warehouse_id).first() is not None \
        or db.query(InventoryTransfer.id).filter(InventoryTransfer.tenant_id == tenant_id, InventoryTransfer.deleted_at.is_(None), InventoryTransfer.status == "draft", or_(InventoryTransfer.from_warehouse_id == warehouse_id, InventoryTransfer.to_warehouse_id == warehouse_id)).first() is not None
    if has_draft:
        raise HTTPException(status_code=409, detail="A draft adjustment or transfer uses this warehouse; post or remove it first")
    warehouse.deleted_at = datetime.now(timezone.utc)
    db.add(warehouse)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="inventory_stock", entity_type="inventory_warehouse", entity_id=warehouse.id, action="delete", description=f"Removed warehouse {warehouse.name}", commit=False)
    db.commit()


def restore_warehouse(db: Session, *, tenant_id: int, actor_user_id: int, warehouse_id: int) -> InventoryWarehouse:
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.id == warehouse_id, InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_not(None)).first()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Removed warehouse not found")
    warehouse.deleted_at = None
    warehouse.is_active = 1
    db.add(warehouse)
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="inventory_stock", entity_type="inventory_warehouse", entity_id=warehouse.id, action="restore", description=f"Restored warehouse {warehouse.name}", commit=False)
    db.commit()
    db.refresh(warehouse)
    return warehouse


def quick_adjust(db: Session, *, tenant_id: int, actor_user_id: int, product_id: int, warehouse_id: int | None, quantity: Decimal | None, change: Decimal | None, reason: str, note: str | None) -> InventoryAdjustment:
    reason = reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    if (quantity is None) == (change is None):
        raise HTTPException(status_code=400, detail="Provide either a new quantity or a change")
    if (quantity is not None and (not quantity.is_finite() or quantity < 0)) or (change is not None and not change.is_finite()):
        raise HTTPException(status_code=400, detail="Invalid stock quantity")
    warehouse = get_warehouse_or_404(db, tenant_id=tenant_id, warehouse_id=warehouse_id) if warehouse_id else ensure_default_warehouse(db, tenant_id=tenant_id)
    product = db.query(CatalogProduct).filter(CatalogProduct.id == product_id, CatalogProduct.tenant_id == tenant_id, CatalogProduct.deleted_at.is_(None)).with_for_update().first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.track_inventory:
        raise HTTPException(status_code=409, detail="This product does not track inventory")
    level = db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.product_id == product_id, InventoryStockLevel.warehouse_id == warehouse.id).first()
    before = Decimal(level.on_hand) if level is not None else Decimal("0")
    delta = (Decimal(quantity) - before) if quantity is not None else Decimal(change)
    if delta == 0:
        raise HTTPException(status_code=400, detail="The adjustment does not change stock")
    adjustment = InventoryAdjustment(tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope="inventory_adjustments", prefix="ADJ"), warehouse_id=warehouse.id, mode="quantity", reason=reason, status="posted", posted_at=datetime.now(timezone.utc), posted_by=actor_user_id, notes=note)
    db.add(adjustment)
    db.flush()
    line = InventoryAdjustmentLine(tenant_id=tenant_id, adjustment_id=adjustment.id, product_id=product_id, expected=before, counted=quantity, delta=delta)
    db.add(line)
    db.flush()
    post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, moves=[MoveSpec(product_id=product_id, warehouse_id=warehouse.id, quantity=delta, move_type="adjustment", source_type="inventory_adjustment", source_id=adjustment.id, source_line_id=line.id, reason=reason, note=note)])
    stage_inventory_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        event_type="inventory.adjustment_posted", entity_type="inventory_adjustment", entity_id=adjustment.id,
        payload={"number": adjustment.number, "mode": "quantity", "warehouse_id": warehouse.id,
            "record_label": adjustment.number, "record_url": f"/dashboard/inventory/adjustments/{adjustment.id}"})
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="inventory_adjustments", entity_type="inventory_adjustment", entity_id=adjustment.id, action="post", description=f"Posted stock adjustment {adjustment.number}", commit=False)
    db.commit()
    db.refresh(adjustment)
    return adjustment


def product_stock(db: Session, *, tenant_id: int, product_id: int) -> dict:
    product = db.query(CatalogProduct).filter(CatalogProduct.id == product_id, CatalogProduct.tenant_id == tenant_id, CatalogProduct.deleted_at.is_(None)).first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    levels = db.query(InventoryStockLevel, InventoryWarehouse).join(InventoryWarehouse, InventoryWarehouse.id == InventoryStockLevel.warehouse_id).filter(InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.product_id == product_id).order_by(InventoryWarehouse.name).all()
    moves = db.query(InventoryStockMove).filter(InventoryStockMove.tenant_id == tenant_id, InventoryStockMove.product_id == product_id).order_by(InventoryStockMove.id.desc()).limit(10).all()
    actor_ids = {move.created_by for move in moves if move.created_by is not None}
    actors = {user.id: " ".join(part for part in (user.first_name, user.last_name) if part).strip() or user.email for user in db.query(User).filter(User.tenant_id == tenant_id, User.id.in_(actor_ids))} if actor_ids else {}
    return {
        "product_id": product.id, "track_inventory": bool(product.track_inventory),
        "on_hand": product.stock_quantity if product.track_inventory else None,
        "available": product.stock_quantity if product.track_inventory else None,
        "warehouses": [{"id": warehouse.id, "name": warehouse.name, "code": warehouse.code, "on_hand": level.on_hand, "reserved": level.reserved, "available": Decimal(level.on_hand) - Decimal(level.reserved)} for level, warehouse in levels],
        "movements": [serialize_move(move, product_name=product.name, warehouse_name=next((warehouse.name for level, warehouse in levels if warehouse.id == move.warehouse_id), "Warehouse"), actor_name=actors.get(move.created_by)) for move in moves],
    }


def serialize_move(move: InventoryStockMove, *, product_name: str, warehouse_name: str, actor_name: str | None = None) -> dict:
    actor_label = actor_name or ("Website integration" if move.source_type == "website_order" else "System")
    return {"id": move.id, "product_id": move.product_id, "product_name": product_name, "warehouse_id": move.warehouse_id, "warehouse_name": warehouse_name, "quantity": move.quantity, "on_hand_after": move.on_hand_after, "move_type": move.move_type, "source_type": move.source_type, "source_id": move.source_id, "reason": move.reason, "note": move.note, "created_by": move.created_by, "actor_label": actor_label, "occurred_at": move.occurred_at}
