"""Audit or rebuild cached inventory levels from the immutable movement ledger.

Run without --apply to print drift. --apply locks tracked products in ID order and fixes
levels and product totals in one transaction; stop posting while running a full rebuild.
"""

import argparse
from decimal import Decimal

from sqlalchemy import func

from app.core.database import SessionLocal
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryStockLevel, InventoryStockMove
from app.modules.inventory.services.stock_ledger import ensure_product_levels


def rebuild(*, tenant_id: int | None, apply: bool) -> int:
    db = SessionLocal()
    changed = 0
    try:
        products = db.query(CatalogProduct).filter(CatalogProduct.track_inventory == 1)
        if tenant_id is not None:
            products = products.filter(CatalogProduct.tenant_id == tenant_id)
        products = products.order_by(CatalogProduct.id).with_for_update().all()
        for product in products:
            expected = {
                warehouse_id: Decimal(quantity)
                for warehouse_id, quantity in db.query(InventoryStockMove.warehouse_id, func.sum(InventoryStockMove.quantity)).filter(
                    InventoryStockMove.tenant_id == product.tenant_id,
                    InventoryStockMove.product_id == product.id,
                ).group_by(InventoryStockMove.warehouse_id)
            }
            if any(quantity < 0 for quantity in expected.values()):
                raise RuntimeError(f"Negative ledger balance for tenant {product.tenant_id}, product {product.id}")
            if apply:
                ensure_product_levels(db, tenant_id=product.tenant_id, product_id=product.id)
            levels = db.query(InventoryStockLevel).filter(InventoryStockLevel.tenant_id == product.tenant_id, InventoryStockLevel.product_id == product.id).order_by(InventoryStockLevel.warehouse_id).with_for_update().all()
            present = {level.warehouse_id for level in levels}
            for warehouse_id in sorted(set(expected) - present):
                print(f"tenant={product.tenant_id} product={product.id} warehouse={warehouse_id}: missing level -> {expected[warehouse_id]}")
                changed += 1
                if apply:
                    level = InventoryStockLevel(tenant_id=product.tenant_id, product_id=product.id, warehouse_id=warehouse_id, on_hand=expected[warehouse_id], reserved=0)
                    db.add(level)
            for level in levels:
                correct = expected.get(level.warehouse_id, Decimal(0))
                if Decimal(level.on_hand) != correct:
                    print(f"tenant={product.tenant_id} product={product.id} warehouse={level.warehouse_id}: {level.on_hand} -> {correct}")
                    changed += 1
                    if apply:
                        level.on_hand = correct
            correct_total = sum(expected.values(), Decimal(0))
            correct_status = "in_stock" if correct_total > 0 else "out_of_stock"
            if Decimal(product.stock_quantity or 0) != correct_total or product.stock_status != correct_status:
                print(f"tenant={product.tenant_id} product={product.id}: total {product.stock_quantity} -> {correct_total}, status {product.stock_status} -> {correct_status}")
                changed += 1
                if apply:
                    product.stock_quantity = correct_total
                    product.stock_status = correct_status
        if apply:
            db.commit()
        else:
            db.rollback()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return changed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tenant-id", type=int)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    drift = rebuild(tenant_id=args.tenant_id, apply=args.apply)
    print(f"{drift} discrepancies {'fixed' if args.apply else 'found'}")
