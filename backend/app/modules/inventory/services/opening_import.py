"""CSV opening stock import through a persisted data-transfer job."""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryAdjustment, InventoryAdjustmentLine, InventoryStockLevel, InventoryWarehouse
from app.modules.inventory.services.stock_ledger import MoveSpec, post_moves, stage_inventory_event
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number


def _amount(raw: str, *, line: int, field: str, positive: bool = False) -> Decimal:
    try:
        value = Decimal(raw.strip())
    except (InvalidOperation, AttributeError) as exc:
        raise HTTPException(status_code=400, detail=f"Row {line}: invalid {field}") from exc
    if not value.is_finite() or value < 0 or (positive and value == 0) or value != value.quantize(Decimal("0.0001")):
        raise HTTPException(status_code=400, detail=f"Row {line}: invalid {field}")
    return value


def import_opening_stock(db: Session, *, tenant_id: int, actor_user_id: int, file_bytes: bytes, job_id: int) -> dict:
    if len(file_bytes) > 2_000_000:
        raise HTTPException(status_code=400, detail="Opening stock CSV exceeds 2 MB")
    try:
        reader = csv.DictReader(io.StringIO(file_bytes.decode("utf-8-sig", errors="strict")))
        if reader.fieldnames:
            reader.fieldnames = [name.strip().lower().replace(" ", "_") for name in reader.fieldnames]
        if not reader.fieldnames or not {"sku", "warehouse_code", "quantity", "unit_cost"}.issubset(set(reader.fieldnames)):
            raise HTTPException(status_code=400, detail="CSV needs SKU, warehouse_code, quantity and unit_cost columns")
        rows = list(reader)
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="Opening stock CSV must be UTF-8") from exc
    if not rows or len(rows) > 10_000:
        raise HTTPException(status_code=400, detail="Opening stock CSV needs 1 to 10,000 rows")

    products = {row.sku: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.deleted_at.is_(None), CatalogProduct.is_active == 1, CatalogProduct.track_inventory == 1, CatalogProduct.sku.isnot(None)).all()}
    warehouses = {row.code: row for row in db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_(None), InventoryWarehouse.is_active == 1).all()}
    grouped: dict[int, list[tuple[CatalogProduct, Decimal, Decimal]]] = defaultdict(list)
    seen = set()
    for line, row in enumerate(rows, 2):
        sku = (row.get("sku") or "").strip()
        code = (row.get("warehouse_code") or "").strip()
        product, warehouse = products.get(sku), warehouses.get(code)
        if product is None or warehouse is None:
            raise HTTPException(status_code=400, detail=f"Row {line}: unknown tracked SKU or active warehouse code")
        key = (product.id, warehouse.id)
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Row {line}: duplicate SKU and warehouse")
        seen.add(key)
        quantity = _amount(row.get("quantity") or "", line=line, field="quantity", positive=True)
        unit_cost = _amount(row.get("unit_cost") or "", line=line, field="unit_cost")
        grouped[warehouse.id].append((product, quantity, unit_cost))

    # Posting locks levels and refuses negative stock. Opening import also refuses a
    # nonzero existing balance so a replay cannot silently add to live stock.
    for product_id in sorted({product.id for items in grouped.values() for product, _, _ in items}):
        db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id == product_id).with_for_update().one()
    codes = {warehouse.id: code for code, warehouse in warehouses.items()}
    for warehouse_id, items in grouped.items():
        for product, _, _ in items:
            balance = db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.product_id == product.id, InventoryStockLevel.warehouse_id == warehouse_id).first()
            if balance is not None and Decimal(balance.on_hand) != 0:
                raise HTTPException(status_code=409, detail=f"Opening stock already exists for {product.name} in warehouse {codes[warehouse_id]}")

    numbers = []
    for warehouse_id, items in grouped.items():
        doc = InventoryAdjustment(tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope="inventory_adjustments", prefix="ADJ"),
            warehouse_id=warehouse_id, mode="quantity", reason="Opening stock import", status="posted",
            posted_at=datetime.now(timezone.utc), posted_by=actor_user_id, notes=f"Data transfer job {job_id}")
        db.add(doc)
        db.flush()
        moves = []
        for product, quantity, unit_cost in items:
            line = InventoryAdjustmentLine(tenant_id=tenant_id, adjustment_id=doc.id, product_id=product.id,
                expected=Decimal(0), delta=quantity)
            db.add(line)
            db.flush()
            moves.append(MoveSpec(product_id=product.id, warehouse_id=warehouse_id, quantity=quantity,
                move_type="opening", source_type="inventory_adjustment", source_id=doc.id, source_line_id=line.id,
                reason="Opening stock import", unit_cost=unit_cost))
        post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, moves=moves)
        stage_inventory_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id,
            event_type="inventory.adjustment_posted", entity_type="inventory_adjustment", entity_id=doc.id,
            payload={"number": doc.number, "mode": "quantity", "warehouse_id": warehouse_id,
                "record_label": doc.number, "record_url": f"/dashboard/inventory/adjustments/{doc.id}"})
        log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="inventory_adjustments",
            entity_type="inventory_adjustment", entity_id=doc.id, action="post",
            description=f"Imported opening stock in {doc.number}", commit=False)
        numbers.append(doc.number)
    return {"rows": len(rows), "adjustments": numbers}
