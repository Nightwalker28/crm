"""Stock valuation, revaluations and order margin (ERP E6, `12d-erp-costing.md` §3).

The stock ledger values every move as it posts (`costing`); this module adds the value-only
changes (a manual *Revalue*, a bill whose price differs from its receipt) and reads value back
out: per product as of any date, totals by warehouse and category, and margin per order line.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogCategory, CatalogProduct
from app.modules.inventory.models import (
    InventoryReturn, InventoryReturnLine, InventoryRevaluation, InventoryStockLevel, InventoryStockMove, InventoryWarehouse,
)
from app.modules.inventory.services.costing import base_currency, load_state, money, rate_for, unit
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number

MODULE = "inventory_valuation"


def _lock_product(db: Session, *, tenant_id: int, product_id: int) -> CatalogProduct:
    product = db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id == product_id,
        CatalogProduct.deleted_at.is_(None)).populate_existing().with_for_update().first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if not product.track_inventory:
        raise HTTPException(status_code=409, detail=f"{product.name} does not track inventory")
    return product


def _record(db: Session, *, product: CatalogProduct, kind: str, on_hand: Decimal, average_before, average_after,
            stock_change: Decimal, cogs_change: Decimal, reason: str, actor_user_id: int | None,
            bill_line_id: int | None = None, reverses_id: int | None = None) -> InventoryRevaluation:
    from app.modules.platform.services.crm_events import stage_standard_crm_event

    row = InventoryRevaluation(tenant_id=product.tenant_id, product_id=product.id, kind=kind,
        number=allocate_business_number(db, tenant_id=product.tenant_id, scope="inventory_revaluations", prefix="REV"),
        bill_line_id=bill_line_id, on_hand=on_hand, average_before=average_before, average_after=average_after,
        stock_change=stock_change, cogs_change=cogs_change, reason=reason[:500], reverses_id=reverses_id, created_by=actor_user_id)
    db.add(row)
    db.flush()
    log_activity(db, tenant_id=product.tenant_id, actor_user_id=actor_user_id, module_key="catalog_products", entity_type="catalog_product",
        entity_id=product.id, action="revalue", commit=False,
        description=f"{row.number}: average cost {average_before if average_before is not None else 'none'} → {average_after}"
                    f" ({'+' if stock_change >= 0 else ''}{stock_change} to stock{f', {cogs_change} to cost of goods' if cogs_change else ''}). {reason}")
    stage_standard_crm_event(db, tenant_id=product.tenant_id, actor_user_id=actor_user_id, event_type="inventory.revalued",
        entity_type="inventory_revaluation", entity_id=row.id,
        payload={"number": row.number, "kind": kind, "product_id": product.id, "product_name": product.name,
                 "average_before": str(average_before) if average_before is not None else None, "average_after": str(average_after),
                 "stock_change": str(stock_change), "cogs_change": str(cogs_change), "reason": reason,
                 "record_label": f"{row.number} · {product.name}", "record_url": f"/dashboard/catalog/products/{product.id}?tab=stock"})
    return row


def revalue(db: Session, *, tenant_id: int, actor_user_id: int | None, product_id: int, average_cost, reason: str) -> InventoryRevaluation:
    """Set a new average for the stock on hand (12d §3.2). With nothing on hand it sets the cost
    the next positive adjustment takes. Never commits."""
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    try:
        new_average = unit(Decimal(str(average_cost)))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid average cost") from exc
    if not new_average.is_finite() or new_average < 0:
        raise HTTPException(status_code=400, detail="The average cost must be zero or more")
    product = _lock_product(db, tenant_id=tenant_id, product_id=product_id)
    state = load_state(db, product)
    before = state.average
    kind = "migration" if state.cost_missing else "manual"
    stock_change = Decimal(0)
    if state.quantity > 0:
        new_value = money(state.quantity * new_average)
        stock_change = new_value - state.value
        product.stock_value = new_value
    elif before is not None and before == new_average:
        raise HTTPException(status_code=400, detail="That is already the average cost")
    if state.quantity > 0 and stock_change == 0 and before == new_average:
        raise HTTPException(status_code=400, detail="That is already the average cost")
    product.cost_price = new_average
    db.add(product)
    return _record(db, product=product, kind=kind, on_hand=state.quantity, average_before=before, average_after=new_average,
                   stock_change=stock_change, cogs_change=Decimal(0), reason=reason, actor_user_id=actor_user_id)


def _split_into_stock(db: Session, product: CatalogProduct, *, difference: Decimal, quantity: Decimal) -> tuple[Decimal, Decimal, object, Decimal]:
    """Share a value change between the stock still on hand and goods already gone."""
    state = load_state(db, product)
    before = state.average
    share = min(quantity, state.quantity) if quantity > 0 else Decimal(0)
    stock_change = money(difference * share / quantity) if quantity > 0 and share > 0 else Decimal(0)
    if state.value + stock_change < 0:
        stock_change = -state.value
    if state.quantity > 0:
        product.stock_value = state.value + stock_change
        product.cost_price = unit(product.stock_value / state.quantity)
    db.add(product)
    return stock_change, difference - stock_change, before, state.quantity


def apply_bill_variance(db: Session, *, bill, actor_user_id: int | None) -> list[InventoryRevaluation]:
    """A posted bill line priced differently from its PO line revalues the stock still on hand
    and charges the rest to cost of goods (12d §5 decision 5). Never commits."""
    from app.modules.purchasing.models import PurchaseOrder

    order = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == bill.tenant_id, PurchaseOrder.id == bill.order_id).first() if bill.order_id else None
    if order is None:
        return []
    rate = rate_for(db, tenant_id=bill.tenant_id, currency=order.currency, exchange_rate=order.exchange_rate) or Decimal(1)
    rows = []
    lines = sorted((line for line in bill.lines if line.order_line_id and line.po_unit_cost is not None
                    and Decimal(line.unit_cost) != Decimal(line.po_unit_cost)), key=lambda line: line.id)
    for line in lines:
        product_id = line.catalog_product_id or next((po_line.product_id for po_line in order.lines if po_line.id == line.order_line_id), None)
        if product_id is None:
            continue
        product = _lock_product(db, tenant_id=bill.tenant_id, product_id=product_id)
        quantity = Decimal(line.quantity)
        difference = money((Decimal(line.unit_cost) - Decimal(line.po_unit_cost)) * quantity * rate)
        if difference == 0:
            continue
        stock_change, cogs_change, before, on_hand = _split_into_stock(db, product, difference=difference, quantity=quantity)
        rows.append(_record(db, product=product, kind="bill_variance", on_hand=on_hand, average_before=before,
            average_after=Decimal(product.cost_price) if product.cost_price is not None else None,
            stock_change=stock_change, cogs_change=cogs_change, bill_line_id=line.id, actor_user_id=actor_user_id,
            reason=f"Bill {bill.number}: {product.name} billed at {line.unit_cost} against {line.po_unit_cost} on {order.number}"))
    return rows


def reverse_bill_variance(db: Session, *, bill, actor_user_id: int | None, reason: str) -> list[InventoryRevaluation]:
    """Voiding a bill undoes its revaluations: what still sits in stock comes out of stock, the
    rest out of cost of goods. Never commits."""
    line_ids = [line.id for line in bill.lines]
    if not line_ids:
        return []
    originals = db.query(InventoryRevaluation).filter(InventoryRevaluation.tenant_id == bill.tenant_id,
        InventoryRevaluation.bill_line_id.in_(line_ids), InventoryRevaluation.reverses_id.is_(None)).order_by(InventoryRevaluation.id).all()
    reversed_ids = {row.reverses_id for row in db.query(InventoryRevaluation.reverses_id).filter(InventoryRevaluation.tenant_id == bill.tenant_id,
        InventoryRevaluation.reverses_id.in_([row.id for row in originals]))} if originals else set()
    rows = []
    for original in originals:
        if original.id in reversed_ids:
            continue
        product = _lock_product(db, tenant_id=bill.tenant_id, product_id=original.product_id)
        state = load_state(db, product)
        total = -(Decimal(original.stock_change) + Decimal(original.cogs_change))
        stock_change = -Decimal(original.stock_change) if state.quantity > 0 else Decimal(0)
        if state.value + stock_change < 0:
            stock_change = -state.value
        before = state.average
        if state.quantity > 0:
            product.stock_value = state.value + stock_change
            product.cost_price = unit(product.stock_value / state.quantity)
        db.add(product)
        rows.append(_record(db, product=product, kind="bill_variance", on_hand=state.quantity, average_before=before,
            average_after=Decimal(product.cost_price) if product.cost_price is not None else None,
            stock_change=stock_change, cogs_change=total - stock_change, bill_line_id=original.bill_line_id, reverses_id=original.id,
            actor_user_id=actor_user_id, reason=f"Bill {bill.number} voided: {reason}"))
    return rows


def serialize_revaluation(row: InventoryRevaluation, *, product: CatalogProduct | None = None, actor_name: str | None = None) -> dict:
    product = product or row.product
    return {"id": row.id, "number": row.number, "kind": row.kind, "product_id": row.product_id,
            "product_name": product.name if product else None, "sku": product.sku if product else None,
            "on_hand": row.on_hand, "average_before": row.average_before, "average_after": row.average_after,
            "stock_change": row.stock_change, "cogs_change": row.cogs_change, "reason": row.reason,
            "bill_line_id": row.bill_line_id, "reverses_id": row.reverses_id, "created_by": row.created_by,
            "actor_name": actor_name, "created_at": row.created_at}


def list_revaluations(db: Session, *, tenant_id: int, product_id: int | None, offset: int, limit: int) -> tuple[list[dict], int]:
    from app.modules.user_management.models import User

    query = db.query(InventoryRevaluation, CatalogProduct).join(CatalogProduct, CatalogProduct.id == InventoryRevaluation.product_id).filter(
        InventoryRevaluation.tenant_id == tenant_id, CatalogProduct.tenant_id == tenant_id)
    if product_id:
        query = query.filter(InventoryRevaluation.product_id == product_id)
    total = query.count()
    rows = query.order_by(InventoryRevaluation.id.desc()).offset(offset).limit(limit).all()
    actor_ids = {row.created_by for row, _ in rows if row.created_by}
    actors = {user.id: " ".join(part for part in (user.first_name, user.last_name) if part).strip() or user.email
              for user in db.query(User).filter(User.tenant_id == tenant_id, User.id.in_(actor_ids))} if actor_ids else {}
    return [serialize_revaluation(row, product=product, actor_name=actors.get(row.created_by)) for row, product in rows], total


def get_revaluation(db: Session, *, tenant_id: int, revaluation_id: int) -> dict:
    row = db.query(InventoryRevaluation).filter(InventoryRevaluation.tenant_id == tenant_id, InventoryRevaluation.id == revaluation_id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Revaluation not found")
    return serialize_revaluation(row)


# --- Valuation ------------------------------------------------------------------------------


def _as_of_end(as_of: date | None) -> datetime | None:
    return datetime.combine(as_of + timedelta(days=1), time.min, tzinfo=timezone.utc) if as_of else None


def product_values(db: Session, *, tenant_id: int, as_of: date | None = None) -> tuple[dict[int, tuple[Decimal, Decimal]], dict[tuple[int, int], Decimal]]:
    """({product: (on hand, value)}, {(product, warehouse): on hand}) now or at the end of a day."""
    end = _as_of_end(as_of)
    by_warehouse: dict[tuple[int, int], Decimal] = {}
    totals: dict[int, list[Decimal]] = defaultdict(lambda: [Decimal(0), Decimal(0)])
    if end is None:
        for level in db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id):
            by_warehouse[(level.product_id, level.warehouse_id)] = Decimal(level.on_hand)
            totals[level.product_id][0] += Decimal(level.on_hand)
        for product_id, value in db.query(CatalogProduct.id, CatalogProduct.stock_value).filter(
                CatalogProduct.tenant_id == tenant_id, CatalogProduct.track_inventory == 1):
            totals[product_id][1] = Decimal(value or 0)
    else:
        moves = db.query(InventoryStockMove.product_id, InventoryStockMove.warehouse_id, func.sum(InventoryStockMove.quantity),
            func.coalesce(func.sum(InventoryStockMove.value), 0)).filter(InventoryStockMove.tenant_id == tenant_id,
            InventoryStockMove.occurred_at < end).group_by(InventoryStockMove.product_id, InventoryStockMove.warehouse_id)
        for product_id, warehouse_id, quantity, value in moves:
            by_warehouse[(product_id, warehouse_id)] = Decimal(quantity or 0)
            totals[product_id][0] += Decimal(quantity or 0)
            totals[product_id][1] += Decimal(value or 0)
        for product_id, change in db.query(InventoryRevaluation.product_id, func.sum(InventoryRevaluation.stock_change)).filter(
                InventoryRevaluation.tenant_id == tenant_id, InventoryRevaluation.created_at < end).group_by(InventoryRevaluation.product_id):
            totals[product_id][1] += Decimal(change or 0)
    return {product_id: (quantity, value) for product_id, (quantity, value) in totals.items()}, by_warehouse


# Revaluations that set the average for everything on hand (`revalue`); a bill variance only
# shifts value, so it leaves uncosted units uncosted.
_FULL_REVALUE_KINDS = ("manual", "migration")


def uncosted_quantities(db: Session, *, tenant_id: int, product_ids=None, as_of: date | None = None) -> dict[int, Decimal]:
    """Units on hand that came in with no cost, per product (13a H8).

    80 units opened with no cost and 3 received at 21 average 0.76: a number, but a wrong
    one. Replays only products that ever received an uncosted unit: an uncosted receipt adds
    its units, an outbound move takes its share, and a *Revalue* or an empty shelf clears them.
    """
    end = _as_of_end(as_of)
    candidates = db.query(InventoryStockMove.product_id).filter(InventoryStockMove.tenant_id == tenant_id,
        InventoryStockMove.cost_source == "missing", InventoryStockMove.quantity > 0)
    if product_ids is not None:
        candidates = candidates.filter(InventoryStockMove.product_id.in_(list(product_ids)))
    if end is not None:
        candidates = candidates.filter(InventoryStockMove.occurred_at < end)
    product_set = {row[0] for row in candidates.distinct()}
    if not product_set:
        return {}
    events: dict[int, list[tuple]] = defaultdict(list)
    moves = db.query(InventoryStockMove.id, InventoryStockMove.product_id, InventoryStockMove.quantity, InventoryStockMove.cost_source,
        InventoryStockMove.reverses_move_id, InventoryStockMove.occurred_at).filter(InventoryStockMove.tenant_id == tenant_id,
        InventoryStockMove.product_id.in_(product_set))
    revaluations = db.query(InventoryRevaluation.id, InventoryRevaluation.product_id, InventoryRevaluation.created_at).filter(
        InventoryRevaluation.tenant_id == tenant_id, InventoryRevaluation.product_id.in_(product_set),
        InventoryRevaluation.kind.in_(_FULL_REVALUE_KINDS), InventoryRevaluation.reverses_id.is_(None))
    if end is not None:
        moves = moves.filter(InventoryStockMove.occurred_at < end)
        revaluations = revaluations.filter(InventoryRevaluation.created_at < end)
    uncosted_moves: set[int] = set()
    for move_id, product_id, quantity, cost_source, reverses_id, occurred_at in moves:
        if cost_source == "missing" and Decimal(quantity) > 0:
            uncosted_moves.add(move_id)
        events[product_id].append((occurred_at, 0, move_id, Decimal(quantity), reverses_id))
    for revaluation_id, product_id, created_at in revaluations:
        events[product_id].append((created_at, 1, revaluation_id, None, None))
    result: dict[int, Decimal] = {}
    for product_id, rows in events.items():
        on_hand = uncosted = Decimal(0)
        for _at, kind, event_id, quantity, reverses_id in sorted(rows, key=lambda row: (row[0], row[1], row[2])):
            if kind == 1:
                uncosted = Decimal(0)
                continue
            if quantity > 0 and event_id in uncosted_moves:
                uncosted += quantity
            elif quantity < 0 and reverses_id in uncosted_moves:
                uncosted = max(uncosted + quantity, Decimal(0))
            elif quantity < 0 and on_hand > 0:
                uncosted = uncosted * max(on_hand + quantity, Decimal(0)) / on_hand
            on_hand += quantity
            if on_hand <= 0:
                uncosted = Decimal(0)
        if uncosted > 0:
            result[product_id] = uncosted.quantize(Decimal("0.0001"))
    return result


def valuation_rows(db: Session, *, tenant_id: int, as_of: date | None = None, warehouse_id: int | None = None,
                   category_id: int | None = None, search: str | None = None, cost_missing: bool | None = None) -> list[dict]:
    totals, by_warehouse = product_values(db, tenant_id=tenant_id, as_of=as_of)
    uncosted = uncosted_quantities(db, tenant_id=tenant_id, as_of=as_of)
    query = db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.track_inventory == 1,
        CatalogProduct.deleted_at.is_(None))
    if category_id:
        query = query.filter(CatalogProduct.category_id == category_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter((CatalogProduct.name.ilike(pattern)) | (CatalogProduct.sku.ilike(pattern)))
    rows = []
    for product in query.order_by(CatalogProduct.name, CatalogProduct.id):
        quantity, value = totals.get(product.id, (Decimal(0), Decimal(0)))
        average = unit(value / quantity) if quantity > 0 else (Decimal(product.cost_price) if product.cost_price is not None and as_of is None else None)
        if warehouse_id:
            here = by_warehouse.get((product.id, warehouse_id), Decimal(0))
            shown_quantity, shown_value = here, (money(value * here / quantity) if quantity > 0 else Decimal(0))
        else:
            shown_quantity, shown_value = quantity, value
        if shown_quantity <= 0:
            continue
        # Partly costed stock is still *Cost missing*; its average and value are partial.
        partial = value > 0 and product.id in uncosted
        missing = value <= 0 or partial
        if cost_missing is not None and missing != cost_missing:
            continue
        rows.append({"product_id": product.id, "product_name": product.name, "sku": product.sku, "unit": product.unit,
            "category_id": product.category_id, "category_name": product.category.full_name if product.category else None,
            "on_hand": shown_quantity, "average_cost": average, "stock_value": shown_value, "cost_missing": missing,
            "cost_partial": partial, "uncosted_quantity": uncosted.get(product.id, Decimal(0))})
    return rows


def valuation_summary(db: Session, *, tenant_id: int, as_of: date | None = None) -> dict:
    totals, by_warehouse = product_values(db, tenant_id=tenant_id, as_of=as_of)
    uncosted = uncosted_quantities(db, tenant_id=tenant_id, as_of=as_of)
    products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id,
        CatalogProduct.track_inventory == 1, CatalogProduct.deleted_at.is_(None))}
    warehouses = {row.id: row.name for row in db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id)}
    total_value, in_stock, missing = Decimal(0), 0, 0
    per_warehouse: dict[int, list[Decimal]] = defaultdict(lambda: [Decimal(0), Decimal(0)])
    per_category: dict[int | None, Decimal] = defaultdict(Decimal)
    for product_id, (quantity, value) in totals.items():
        product = products.get(product_id)
        if product is None or quantity <= 0:
            continue
        in_stock += 1
        missing += value <= 0 or product_id in uncosted
        total_value += value
        per_category[product.category_id] += value
    for (product_id, warehouse_id), here in by_warehouse.items():
        quantity, value = totals.get(product_id, (Decimal(0), Decimal(0)))
        if product_id not in products or here <= 0 or quantity <= 0:
            continue
        per_warehouse[warehouse_id][0] += here
        per_warehouse[warehouse_id][1] += money(value * here / quantity)
    categories = {row.id: row.full_name for row in db.query(CatalogCategory).filter(CatalogCategory.tenant_id == tenant_id)}
    return {
        "base_currency": base_currency(db, tenant_id=tenant_id), "as_of": as_of, "total_value": total_value,
        "products_in_stock": in_stock, "cost_missing": missing,
        "by_warehouse": sorted(({"warehouse_id": warehouse_id, "warehouse_name": warehouses.get(warehouse_id, "Warehouse"),
            "on_hand": values[0], "stock_value": values[1]} for warehouse_id, values in per_warehouse.items()), key=lambda row: row["warehouse_name"]),
        "by_category": sorted(({"category_id": category_id, "category_name": categories.get(category_id) if category_id else None,
            "stock_value": value} for category_id, value in per_category.items()), key=lambda row: -row["stock_value"]),
    }


def product_valuation(db: Session, *, product: CatalogProduct) -> dict:
    """The Stock tab's cost figures for one tracked product."""
    levels = db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == product.tenant_id, InventoryStockLevel.product_id == product.id).all()
    quantity = sum((Decimal(level.on_hand) for level in levels), Decimal(0))
    value = Decimal(product.stock_value or 0)
    uncosted = uncosted_quantities(db, tenant_id=product.tenant_id, product_ids=[product.id]).get(product.id, Decimal(0))
    partial = quantity > 0 and value > 0 and uncosted > 0
    return {
        "base_currency": base_currency(db, tenant_id=product.tenant_id),
        "average_cost": Decimal(product.cost_price) if product.cost_price is not None else None,
        "stock_value": value, "cost_missing": (quantity > 0 and value <= 0) or partial,
        "cost_partial": partial, "uncosted_quantity": uncosted,
        "warehouse_values": {level.warehouse_id: (money(value * Decimal(level.on_hand) / quantity) if quantity > 0 else Decimal(0)) for level in levels},
    }


# --- Margin ---------------------------------------------------------------------------------


def order_margin(db: Session, *, tenant_id: int, order) -> dict:
    """Revenue, cost and margin per order line in the base currency (12d §3.3): the delivered
    part at its actual cost, the rest and anything untracked at an estimate."""
    from app.modules.catalog.models import CatalogService
    from app.modules.inventory.services.stock_ledger import delivered_quantity, line_outstanding

    base = base_currency(db, tenant_id=tenant_id)
    rate = rate_for(db, tenant_id=tenant_id, currency=order.currency, exchange_rate=order.exchange_rate)
    cancelled = order.status == "cancelled"
    lines = sorted(order.items, key=lambda item: (item.sort_order or 0, item.id))
    product_ids = {line.catalog_product_id for line in lines if line.catalog_product_id}
    service_ids = {line.catalog_service_id for line in lines if line.catalog_service_id}
    products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id.in_(product_ids))} if product_ids else {}
    services = {row.id: row for row in db.query(CatalogService).filter(CatalogService.tenant_id == tenant_id, CatalogService.id.in_(service_ids))} if service_ids else {}
    line_ids = [line.id for line in lines]
    cogs = {line_id: -Decimal(value or 0) for line_id, value in db.query(InventoryStockMove.sales_order_item_id, func.sum(InventoryStockMove.value)).filter(
        InventoryStockMove.tenant_id == tenant_id, InventoryStockMove.sales_order_item_id.in_(line_ids)).group_by(InventoryStockMove.sales_order_item_id)} if line_ids else {}
    returned = {line_id: Decimal(quantity or 0) for line_id, quantity in db.query(InventoryReturnLine.order_line_id, func.sum(InventoryReturnLine.quantity)).join(
        InventoryReturn, InventoryReturn.id == InventoryReturnLine.return_id).filter(InventoryReturnLine.tenant_id == tenant_id,
        InventoryReturnLine.order_line_id.in_(line_ids), InventoryReturn.status == "received").group_by(InventoryReturnLine.order_line_id)} if line_ids else {}

    result_lines = []
    totals = {"revenue": Decimal(0), "cost": Decimal(0), "actual_revenue": Decimal(0), "actual_cost": Decimal(0)}
    estimated_any = cost_missing_any = False
    for line in lines:
        quantity = Decimal(line.quantity or 0)
        net = Decimal(line.line_total or 0) - Decimal(line.tax_amount or 0)
        per_unit = net / quantity if quantity else Decimal(0)
        product = products.get(line.catalog_product_id) if line.catalog_product_id else None
        tracked = product is not None and bool(product.track_inventory)
        cost_missing = False
        if tracked:
            delivered = delivered_quantity(db, line) - returned.get(line.id, Decimal(0))
            remaining = Decimal(0) if cancelled else line_outstanding(db, line, order)
            actual_cost = cogs.get(line.id, Decimal(0))
            average = Decimal(product.cost_price) if product.cost_price is not None else None
            estimated_cost = money(remaining * average) if average is not None else Decimal(0)
            cost_missing = (remaining > 0 and average is None) or (delivered > 0 and actual_cost <= 0)
            actual_quantity, estimated_quantity = delivered, remaining
        else:
            cost_price = product.cost_price if product is not None else (services[line.catalog_service_id].cost_price if line.catalog_service_id in services else None)
            estimated_quantity = Decimal(0) if cancelled else quantity
            actual_quantity, actual_cost = Decimal(0), Decimal(0)
            estimated_cost = money(estimated_quantity * Decimal(cost_price)) if cost_price is not None else Decimal(0)
            cost_missing = cost_price is None and estimated_quantity > 0
        actual_revenue = money(per_unit * actual_quantity * rate) if rate is not None else None
        estimated_revenue = money(per_unit * estimated_quantity * rate) if rate is not None else None
        revenue = actual_revenue + estimated_revenue if rate is not None else None
        cost = actual_cost + estimated_cost
        margin = revenue - cost if revenue is not None else None
        estimated_any = estimated_any or estimated_quantity > 0
        cost_missing_any = cost_missing_any or cost_missing
        if rate is not None:
            totals["revenue"] += revenue
            totals["actual_revenue"] += actual_revenue
        totals["cost"] += cost
        totals["actual_cost"] += actual_cost
        result_lines.append({
            "order_line_id": line.id, "name": line.name, "quantity": quantity, "tracked": tracked,
            "delivered": actual_quantity, "estimated_quantity": estimated_quantity,
            "revenue": revenue, "cost": cost, "margin": margin,
            "margin_percent": (money(margin / revenue * 100) if revenue else None) if margin is not None else None,
            "actual_revenue": actual_revenue, "actual_cost": actual_cost, "estimated": estimated_quantity > 0, "cost_missing": cost_missing,
        })
    revenue = totals["revenue"] if rate is not None else None
    margin = revenue - totals["cost"] if revenue is not None else None
    actual_margin = totals["actual_revenue"] - totals["actual_cost"] if rate is not None else None
    return {
        "order_id": order.id, "currency": order.currency, "base_currency": base, "exchange_rate": rate,
        "rate_missing": rate is None, "estimated": estimated_any, "cost_missing": cost_missing_any,
        "revenue": revenue, "cost": totals["cost"], "margin": margin,
        "margin_percent": (money(margin / revenue * 100) if revenue else None) if margin is not None else None,
        "actual_revenue": totals["actual_revenue"] if rate is not None else None, "actual_cost": totals["actual_cost"], "actual_margin": actual_margin,
        "lines": result_lines,
    }
