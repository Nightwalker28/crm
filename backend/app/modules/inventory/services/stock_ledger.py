"""The sole writer of tracked product stock, levels and immutable movements."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import hashlib
import logging

from fastapi import HTTPException
from sqlalchemy import and_, case, event, func, or_, text
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import (
    InventoryDelivery, InventoryDeliveryLine, InventoryReservation, InventoryStockLevel, InventoryStockMove, InventoryWarehouse,
)
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.models import SalesOrder, SalesOrderItem
from app.modules.platform.models import CrmEvent
from app.modules.user_management.models import User, UserStatus
from app.core.access_control import PermissionPolicy
from app.modules.platform.services.notifications import create_notification


logger = logging.getLogger(__name__)

# Planned outbound moves take only what no confirmed order holds. An adjustment or count
# records physical reality instead, and releases holds that no longer fit (§3.2 of
# 12a-erp-fulfilment.md).
RESERVATION_RESPECTING_MOVES = {"website_order", "sales_order", "transfer_out", "delivery"}


@event.listens_for(Session, "after_commit")
def _dispatch_inventory_events(session: Session) -> None:
    from app.modules.platform.services.crm_events import enqueue_crm_event_automation

    for event_id in session.info.pop("inventory_automation_event_ids", []):
        try:
            enqueue_crm_event_automation(event_id)
        except Exception:
            logger.exception("Could not dispatch inventory automation", extra={"event_id": event_id})


@event.listens_for(Session, "after_rollback")
def _discard_inventory_events(session: Session) -> None:
    session.info.pop("inventory_automation_event_ids", None)


def stage_inventory_event(db: Session, *, tenant_id: int, actor_user_id: int | None, event_type: str, entity_type: str, entity_id: int, payload: dict) -> None:
    """Persist automation input with the stock transaction; dispatch only after commit."""
    record = CrmEvent(tenant_id=tenant_id, actor_user_id=actor_user_id, event_type=event_type,
        entity_type=entity_type, entity_id=str(entity_id), payload={"entity_type": entity_type, "entity_id": str(entity_id), **payload})
    db.add(record)
    db.flush()
    db.info.setdefault("inventory_automation_event_ids", []).append(record.id)


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
    unit_cost: Decimal | None = None


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
    available_before = {key: Decimal(level.on_hand) - Decimal(level.reserved) for key, level in levels.items()}

    posted = []
    touched = set()
    received = set()
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
        if quantity < 0 and spec.move_type in RESERVATION_RESPECTING_MOVES and after < Decimal(level.reserved):
            shortage = Decimal(level.reserved) - after
            raise HTTPException(status_code=409, detail=f"Insufficient available stock for {products[spec.product_id].name} in {warehouses[spec.warehouse_id].name}: short by {shortage}; the rest is reserved for confirmed orders")
        level.on_hand = after
        move = InventoryStockMove(
            tenant_id=tenant_id, product_id=spec.product_id, warehouse_id=spec.warehouse_id,
            quantity=quantity, move_type=spec.move_type, source_type=spec.source_type,
            source_id=spec.source_id, source_line_id=spec.source_line_id,
            reverses_move_id=spec.reverses_move_id, unit_cost=spec.unit_cost if spec.unit_cost is not None else products[spec.product_id].cost_price,
            on_hand_after=after, reason=spec.reason, note=spec.note, created_by=actor_user_id,
        )
        db.add(level)
        db.add(move)
        db.flush()
        posted.append(move)
        touched.add(spec.product_id)
        if quantity > 0:
            received.add((spec.product_id, spec.warehouse_id))
    for key, level in sorted(levels.items()):
        if key[0] not in touched:
            continue
        if Decimal(level.reserved) > Decimal(level.on_hand):
            _release_excess(db, tenant_id=tenant_id, actor_user_id=actor_user_id, level=level, product=products[key[0]])
        elif key in received:
            _allocate_waiting(db, tenant_id=tenant_id, level=level, warehouse=warehouses[key[1]])
    for product_id in touched:
        product = products[product_id]
        total = sum((Decimal(row.on_hand) for row in db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.product_id == product_id)), Decimal("0"))
        product.stock_quantity = total
        product.stock_status = "in_stock" if total > 0 else "out_of_stock"
        db.add(product)
    for (product_id, warehouse_id), level in levels.items():
        if product_id not in touched:
            continue
        product = products[product_id]
        threshold = Decimal(product.reorder_point or 0)
        available_now = Decimal(level.on_hand) - Decimal(level.reserved)
        if threshold <= 0 or available_before[(product_id, warehouse_id)] <= threshold or available_now > threshold:
            continue
        warehouse = warehouses[warehouse_id]
        for user in db.query(User).filter(User.tenant_id == tenant_id, User.is_active == UserStatus.active).all():
            policy = PermissionPolicy(db, user)
            if policy.can_view_module("inventory_stock") and policy.can_perform_action("inventory_stock", "view"):
                create_notification(db, tenant_id=tenant_id, user_id=user.id, category="inventory_stock_low",
                    title=f"Low stock: {product.name}", message=f"{product.name} has {available_now} available in {warehouse.name}; reorder point {threshold}.",
                    link_url=f"/dashboard/catalog/products/{product.id}?tab=stock",
                    metadata={"product_id": product_id, "warehouse_id": warehouse_id, "available": str(available_now)}, commit=False)
        stage_inventory_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id,
            event_type="inventory.stock_low", entity_type="catalog_product", entity_id=product_id,
            payload={"product_id": product_id, "warehouse_id": warehouse_id, "product_name": product.name,
                "warehouse_name": warehouse.name, "available": str(available_now), "reorder_point": str(threshold),
                "reorder_quantity": str(product.reorder_quantity or 0), "record_label": product.name,
                "record_url": f"/dashboard/catalog/products/{product_id}?tab=stock"})
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



# --- Reservations -------------------------------------------------------------------
#
# A reservation holds stock for a confirmed order line without moving it. Holds and the
# cached `inventory_stock_levels.reserved` change only here, under the same locks as
# `post_moves`: products by ID, then levels by product and warehouse.


def delivered_quantity(db: Session, line: SalesOrderItem) -> Decimal:
    """What posted deliveries have taken out for one order line."""
    value = db.query(func.coalesce(func.sum(InventoryDeliveryLine.quantity), 0)).join(
        InventoryDelivery, InventoryDelivery.id == InventoryDeliveryLine.delivery_id).filter(
        InventoryDeliveryLine.tenant_id == line.tenant_id, InventoryDeliveryLine.order_line_id == line.id,
        InventoryDelivery.status == "posted").scalar()
    return Decimal(value or 0)


def line_outstanding(db: Session, line: SalesOrderItem, order: SalesOrder) -> Decimal:
    """To deliver: ordered less delivered, or nothing once the order's remainder is closed."""
    if order.remaining_closed_at is not None:
        return Decimal(0)
    return max(Decimal(line.quantity) - delivered_quantity(db, line), Decimal(0))


def order_warehouse_id(db: Session, order: SalesOrder) -> int:
    return order.warehouse_id or ensure_default_warehouse(db, tenant_id=order.tenant_id).id


def _lock_products(db: Session, *, tenant_id: int, product_ids) -> dict[int, CatalogProduct]:
    products = {}
    for product_id in sorted(set(product_ids)):
        product = db.query(CatalogProduct).filter(CatalogProduct.id == product_id, CatalogProduct.tenant_id == tenant_id).populate_existing().with_for_update().first()
        if product is not None:
            products[product_id] = product
    return products


def _lock_levels(db: Session, *, tenant_id: int, keys) -> dict[tuple[int, int], InventoryStockLevel]:
    return {key: _level_for_update(db, tenant_id=tenant_id, product_id=key[0], warehouse_id=key[1]) for key in sorted(set(keys))}


def _set_hold(db: Session, *, level: InventoryStockLevel, row: InventoryReservation | None, quantity: Decimal,
              order_id: int, order_line_id: int, actor_user_id: int | None, manual: bool | None = None) -> InventoryReservation | None:
    """Set one line's hold in one warehouse and keep the level's cached total in step."""
    current = Decimal(row.quantity) if row is not None else Decimal(0)
    if quantity == current and (manual is None or row is None or bool(row.manual) == manual):
        return row
    level.reserved = Decimal(level.reserved) + quantity - current
    db.add(level)
    if quantity <= 0:
        if row is not None:
            db.delete(row)
        return None
    if row is None:
        row = InventoryReservation(tenant_id=level.tenant_id, order_id=order_id, order_line_id=order_line_id,
            product_id=level.product_id, warehouse_id=level.warehouse_id, quantity=quantity, manual=int(bool(manual)))
    else:
        row.quantity = quantity
        if manual is not None:
            row.manual = int(manual)
    row.updated_by = actor_user_id
    db.add(row)
    return row


def _tracked_lines(db: Session, order: SalesOrder) -> list[SalesOrderItem]:
    product_ids = {line.catalog_product_id for line in order.items if line.catalog_product_id is not None}
    if not product_ids:
        return []
    tracked = {row.id for row in db.query(CatalogProduct.id).filter(CatalogProduct.tenant_id == order.tenant_id,
        CatalogProduct.id.in_(product_ids), CatalogProduct.track_inventory == 1, CatalogProduct.deleted_at.is_(None))}
    return sorted((line for line in order.items if line.catalog_product_id in tracked), key=lambda line: (line.sort_order, line.id))


def reserve_for_order(db: Session, *, tenant_id: int, order: SalesOrder, actor_user_id: int | None = None) -> None:
    """Bring a confirmed order's holds in line with what each line still needs.

    Holds that no longer apply (a removed or changed line, another warehouse) go first;
    then each line takes what is free, up to its outstanding quantity. A shortfall is not
    an error: the line waits for stock. Never commits.
    """
    if order.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "confirmed":
        release_for_order(db, tenant_id=tenant_id, order=order, actor_user_id=actor_user_id)
        return
    db.flush()
    warehouse_id = order_warehouse_id(db, order)
    lines = _tracked_lines(db, order)
    rows = db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id, InventoryReservation.order_id == order.id).all()
    keys = {(row.product_id, row.warehouse_id) for row in rows} | {(line.catalog_product_id, warehouse_id) for line in lines}
    if not keys:
        return
    _lock_products(db, tenant_id=tenant_id, product_ids=[key[0] for key in keys])
    levels = _lock_levels(db, tenant_id=tenant_id, keys=keys)
    line_by_id = {line.id: line for line in lines}
    held: dict[int, InventoryReservation] = {}
    for row in rows:
        line = line_by_id.get(row.order_line_id)
        if line is None or row.warehouse_id != warehouse_id or row.product_id != line.catalog_product_id:
            _set_hold(db, level=levels[(row.product_id, row.warehouse_id)], row=row, quantity=Decimal(0), order_id=order.id, order_line_id=row.order_line_id, actor_user_id=actor_user_id)
        else:
            held[row.order_line_id] = row
    for line in lines:
        level = levels[(line.catalog_product_id, warehouse_id)]
        row = held.get(line.id)
        current = Decimal(row.quantity) if row is not None else Decimal(0)
        needed = line_outstanding(db, line, order)
        if current > needed:
            _set_hold(db, level=level, row=row, quantity=needed, order_id=order.id, order_line_id=line.id, actor_user_id=actor_user_id)
            continue
        take = min(needed - current, Decimal(level.on_hand) - Decimal(level.reserved))
        if take > 0:
            _set_hold(db, level=level, row=row, quantity=current + take, order_id=order.id, order_line_id=line.id, actor_user_id=actor_user_id)
    db.flush()


def release_for_order(db: Session, *, tenant_id: int, order: SalesOrder, line_ids=None, actor_user_id: int | None = None) -> None:
    """Drop an order's holds (all, or those of `line_ids`) before a cancel, close or line removal."""
    query = db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id, InventoryReservation.order_id == order.id)
    if line_ids is not None:
        line_ids = list(line_ids)
        if not line_ids:
            return
        query = query.filter(InventoryReservation.order_line_id.in_(line_ids))
    rows = query.all()
    if not rows:
        return
    _lock_products(db, tenant_id=tenant_id, product_ids=[row.product_id for row in rows])
    levels = _lock_levels(db, tenant_id=tenant_id, keys=[(row.product_id, row.warehouse_id) for row in rows])
    for row in rows:
        _set_hold(db, level=levels[(row.product_id, row.warehouse_id)], row=row, quantity=Decimal(0), order_id=order.id, order_line_id=row.order_line_id, actor_user_id=actor_user_id)
    db.flush()


def priority_rank():
    """Urgent before high before normal: the order arriving stock is offered in."""
    return case((SalesOrder.priority == "urgent", 0), (SalesOrder.priority == "high", 1), else_=2)


def open_order_lines_query(db: Session, *, tenant_id: int, product_id: int, warehouse: InventoryWarehouse):
    in_warehouse = SalesOrder.warehouse_id == warehouse.id
    if warehouse.is_default:
        in_warehouse = or_(in_warehouse, SalesOrder.warehouse_id.is_(None))
    return db.query(SalesOrderItem, SalesOrder).join(SalesOrder, and_(SalesOrder.id == SalesOrderItem.order_id, SalesOrder.tenant_id == tenant_id)).filter(
        SalesOrderItem.tenant_id == tenant_id, SalesOrderItem.catalog_product_id == product_id, SalesOrder.status == "confirmed", in_warehouse,
    ).order_by(priority_rank(), SalesOrder.created_at, SalesOrder.id, SalesOrderItem.sort_order, SalesOrderItem.id)


def _allocate_waiting(db: Session, *, tenant_id: int, level: InventoryStockLevel, warehouse: InventoryWarehouse) -> None:
    """Offer free stock to waiting lines of confirmed orders: highest priority, then oldest."""
    free = Decimal(level.on_hand) - Decimal(level.reserved)
    if free <= 0:
        return
    held = {row.order_line_id: row for row in db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id,
        InventoryReservation.product_id == level.product_id, InventoryReservation.warehouse_id == level.warehouse_id)}
    topped_up: dict[int, SalesOrder] = {}
    for line, order in open_order_lines_query(db, tenant_id=tenant_id, product_id=level.product_id, warehouse=warehouse):
        row = held.get(line.id)
        current = Decimal(row.quantity) if row is not None else Decimal(0)
        take = min(line_outstanding(db, line, order) - current, free)
        if take <= 0:
            continue
        _set_hold(db, level=level, row=row, quantity=current + take, order_id=order.id, order_line_id=line.id, actor_user_id=None)
        topped_up[order.id] = order
        free -= take
        if free <= 0:
            break
    db.flush()
    for order in topped_up.values():
        if _fully_reserved(db, order=order):
            _tell_order_owner(db, order=order, actor_user_id=None, title=f"Ready to deliver: {order.order_number}",
                message=f"Stock arrived, and everything {order.order_number} still needs is now reserved.")


def _fully_reserved(db: Session, *, order: SalesOrder) -> bool:
    held: dict[int, Decimal] = {}
    for row in db.query(InventoryReservation).filter(InventoryReservation.tenant_id == order.tenant_id, InventoryReservation.order_id == order.id):
        held[row.order_line_id] = held.get(row.order_line_id, Decimal(0)) + Decimal(row.quantity)
    return all(held.get(line.id, Decimal(0)) >= line_outstanding(db, line, order) for line in _tracked_lines(db, order))


def _release_excess(db: Session, *, tenant_id: int, actor_user_id: int | None, level: InventoryStockLevel, product: CatalogProduct) -> None:
    """Stock fell below what is held: release automatic holds before manual ones, and within
    each the lowest priority, newest order first."""
    excess = Decimal(level.reserved) - Decimal(level.on_hand)
    rows = db.query(InventoryReservation, SalesOrder).join(SalesOrder, SalesOrder.id == InventoryReservation.order_id).filter(
        InventoryReservation.tenant_id == tenant_id, InventoryReservation.product_id == level.product_id, InventoryReservation.warehouse_id == level.warehouse_id,
    ).order_by(InventoryReservation.manual, priority_rank().desc(), SalesOrder.created_at.desc(), SalesOrder.id.desc(), InventoryReservation.id.desc()).all()
    for row, order in rows:
        if excess <= 0:
            break
        released = min(Decimal(row.quantity), excess)
        _set_hold(db, level=level, row=row, quantity=Decimal(row.quantity) - released, order_id=order.id, order_line_id=row.order_line_id, actor_user_id=actor_user_id)
        excess -= released
        _tell_order_owner(db, order=order, actor_user_id=actor_user_id, title=f"Stock no longer reserved: {order.order_number}",
            message=f"{_quantity_text(released)} of {product.name} {'is' if released == 1 else 'are'} no longer reserved for {order.order_number}; stock on hand fell below what was held.")
    db.flush()


def _quantity_text(value: Decimal) -> str:
    text_value = format(Decimal(value).normalize(), "f")
    return f"{text_value} unit" if Decimal(value) == 1 else f"{text_value} units"


def _tell_order_owner(db: Session, *, order: SalesOrder, actor_user_id: int | None, title: str, message: str) -> None:
    log_activity(db, tenant_id=order.tenant_id, actor_user_id=actor_user_id, module_key="sales_orders", entity_type="sales_order",
        entity_id=order.id, action="sales_order.reservation_changed", description=message, commit=False)
    if order.owner_id and order.owner_id != actor_user_id:
        create_notification(db, tenant_id=order.tenant_id, user_id=order.owner_id, category="sales_order_reservation",
            title=title, message=message, link_url=f"/dashboard/sales/orders/{order.id}?tab=fulfilment",
            metadata={"order_id": order.id}, commit=False)


def reservation_version(db: Session, *, tenant_id: int, product_id: int, warehouse_id: int) -> str:
    """A token for one product's holds in one warehouse; any change to stock or holds changes it."""
    level = db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.product_id == product_id,
        InventoryStockLevel.warehouse_id == warehouse_id).first()
    rows = db.query(InventoryReservation.order_line_id, InventoryReservation.quantity).filter(InventoryReservation.tenant_id == tenant_id,
        InventoryReservation.product_id == product_id, InventoryReservation.warehouse_id == warehouse_id).order_by(InventoryReservation.order_line_id).all()
    on_hand = Decimal(level.on_hand) if level is not None else Decimal(0)
    raw = f"{on_hand.normalize()}|" + ";".join(f"{line_id}:{Decimal(quantity).normalize()}" for line_id, quantity in rows)
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def set_reservations(db: Session, *, tenant_id: int, actor_user_id: int | None, product_id: int, warehouse_id: int,
                     holds: list[tuple[int, Decimal]], expected_version: str) -> None:
    """Apply a user's edit of one product's holds in one warehouse, atomically.

    `holds` maps confirmed order lines to their new reserved quantity; lines not named are
    unchanged. Every hold changed here becomes manual. Never commits.
    """
    products = _lock_products(db, tenant_id=tenant_id, product_ids=[product_id])
    product = products.get(product_id)
    if product is None or product.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.track_inventory:
        raise HTTPException(status_code=409, detail=f"{product.name} does not track inventory")
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.id == warehouse_id, InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_(None)).first()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    level = _lock_levels(db, tenant_id=tenant_id, keys=[(product_id, warehouse_id)])[(product_id, warehouse_id)]
    if reservation_version(db, tenant_id=tenant_id, product_id=product_id, warehouse_id=warehouse_id) != expected_version:
        raise HTTPException(status_code=409, detail="Stock or reservations changed since you opened this; reload and try again")
    requested: dict[int, Decimal] = {}
    for line_id, quantity in holds:
        quantity = Decimal(str(quantity))
        if line_id in requested:
            raise HTTPException(status_code=400, detail="Each order line can appear once")
        if not quantity.is_finite() or quantity < 0 or quantity != quantity.quantize(Decimal("0.0001")):
            raise HTTPException(status_code=400, detail="Reserved quantities must be zero or more, with at most four decimal places")
        requested[line_id] = quantity
    eligible = {line.id: (line, order) for line, order in open_order_lines_query(db, tenant_id=tenant_id, product_id=product_id, warehouse=warehouse).filter(SalesOrderItem.id.in_(list(requested) or [0]))}
    rows = {row.order_line_id: row for row in db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id,
        InventoryReservation.product_id == product_id, InventoryReservation.warehouse_id == warehouse_id)}
    total = Decimal(level.reserved)
    for line_id, quantity in requested.items():
        if line_id not in eligible:
            raise HTTPException(status_code=404, detail="Order line not found among confirmed orders for this product and warehouse")
        line, order = eligible[line_id]
        needed = line_outstanding(db, line, order)
        if quantity > needed:
            raise HTTPException(status_code=409, detail=f"{order.order_number} needs only {_quantity_text(needed)} of {product.name}")
        total += quantity - (Decimal(rows[line_id].quantity) if line_id in rows else Decimal(0))
    if total > Decimal(level.on_hand):
        raise HTTPException(status_code=409, detail=f"Reservations would exceed the {_quantity_text(level.on_hand)} of {product.name} on hand in {warehouse.name}")
    for line_id, quantity in requested.items():
        line, order = eligible[line_id]
        row = rows.get(line_id)
        before = Decimal(row.quantity) if row is not None else Decimal(0)
        if quantity == before:
            continue
        _set_hold(db, level=level, row=row, quantity=quantity, order_id=order.id, order_line_id=line_id, actor_user_id=actor_user_id, manual=True)
        change = quantity - before
        verb = "gains" if change > 0 else "loses"
        message = f"{order.order_number} {verb} {_quantity_text(abs(change))} of {product.name} reserved in {warehouse.name}; now {_quantity_text(quantity)}."
        if change < 0:
            _tell_order_owner(db, order=order, actor_user_id=actor_user_id, title=f"Reservation changed: {order.order_number}", message=message)
        else:
            log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="sales_orders", entity_type="sales_order",
                entity_id=order.id, action="sales_order.reservation_changed", description=message, commit=False)
    db.flush()


def rebuild_reservations(db: Session, *, tenant_id: int) -> None:
    """Re-validate holds after a restore: drop what no longer applies, then clamp to stock.

    Holds are derived state, so they are not backed up. Each kept row must still belong to
    a confirmed order line for the same product, in the order's warehouse, within what the
    line needs; levels' cached totals are recomputed, and any level holding more than it
    has releases automatic holds first, newest order first. Never commits.
    """
    default_id = ensure_default_warehouse(db, tenant_id=tenant_id).id
    pairs = db.query(InventoryReservation, SalesOrderItem, SalesOrder).outerjoin(SalesOrderItem, SalesOrderItem.id == InventoryReservation.order_line_id).outerjoin(
        SalesOrder, SalesOrder.id == InventoryReservation.order_id).filter(InventoryReservation.tenant_id == tenant_id).all()
    for row, line, order in pairs:
        valid = line is not None and order is not None and order.tenant_id == tenant_id and line.order_id == order.id \
            and order.status == "confirmed" and line.catalog_product_id == row.product_id and (order.warehouse_id or default_id) == row.warehouse_id
        if not valid:
            db.delete(row)
        elif Decimal(row.quantity) > line_outstanding(db, line, order):
            needed = line_outstanding(db, line, order)
            if needed <= 0:
                db.delete(row)
            else:
                row.quantity = needed
                db.add(row)
    db.flush()
    totals: dict[tuple[int, int], Decimal] = {}
    for row in db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id):
        key = (row.product_id, row.warehouse_id)
        totals[key] = totals.get(key, Decimal(0)) + Decimal(row.quantity)
    levels = db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id).all()
    products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id)}
    for level in levels:
        level.reserved = totals.pop((level.product_id, level.warehouse_id), Decimal(0))
        db.add(level)
    for (product_id, warehouse_id), _quantity in totals.items():
        db.query(InventoryReservation).filter(InventoryReservation.tenant_id == tenant_id, InventoryReservation.product_id == product_id,
            InventoryReservation.warehouse_id == warehouse_id).delete(synchronize_session=False)
    db.flush()
    for level in levels:
        if Decimal(level.reserved) > Decimal(level.on_hand):
            _release_excess(db, tenant_id=tenant_id, actor_user_id=None, level=level, product=products[level.product_id])
