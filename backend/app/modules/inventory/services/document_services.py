"""Draft, post and reversal rules for inventory documents."""

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import (
    InventoryAdjustment, InventoryAdjustmentLine, InventoryStockLevel,
    InventoryTransfer, InventoryTransferLine, InventoryWarehouse,
)
from app.modules.inventory.repositories import document_repository as repo
from app.modules.inventory.services.inventory_services import get_warehouse_or_404
from app.modules.inventory.services.stock_ledger import MoveSpec, post_moves, reverse_moves
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number


def _decimal(value, *, positive: bool = False, nonnegative: bool = False) -> Decimal:
    try:
        result = Decimal(str(value))
        valid = result.is_finite() and result == result.quantize(Decimal("0.0001"))
    except (ValueError, TypeError, ArithmeticError):
        valid = False
    if not valid or (positive and result <= 0) or (nonnegative and result < 0):
        raise HTTPException(status_code=400, detail="Quantity must have at most four decimal places and be valid for this document")
    return result


def _products(db: Session, *, tenant_id: int, product_ids: set[int]) -> dict[int, CatalogProduct]:
    products = {row.id: row for row in db.query(CatalogProduct).filter(
        CatalogProduct.tenant_id == tenant_id, CatalogProduct.id.in_(product_ids),
        CatalogProduct.deleted_at.is_(None), CatalogProduct.is_active == 1, CatalogProduct.track_inventory == 1,
    )} if product_ids else {}
    if set(products) != product_ids:
        raise HTTPException(status_code=404, detail="Tracked product not found")
    return products


def _warehouse(db: Session, *, tenant_id: int, warehouse_id: int) -> InventoryWarehouse:
    warehouse = get_warehouse_or_404(db, tenant_id=tenant_id, warehouse_id=warehouse_id)
    if not warehouse.is_active:
        raise HTTPException(status_code=409, detail=f"{warehouse.name} is inactive")
    return warehouse


def _audit(db: Session, *, tenant_id: int, actor_user_id: int, kind: str, doc, action: str, detail: str = "") -> None:
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id,
                 module_key=f"inventory_{kind}", entity_type=f"inventory_{kind[:-1]}",
                 entity_id=doc.id, action=action,
                 description=f"{action.capitalize()} {kind[:-1].replace('_', ' ')} {doc.number}{detail}", commit=False)


def _unique_lines(lines: list[dict]) -> set[int]:
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one product")
    product_ids = [int(line["product_id"]) for line in lines]
    if len(product_ids) != len(set(product_ids)):
        raise HTTPException(status_code=400, detail="A product can appear only once")
    return set(product_ids)


def save_adjustment(db: Session, *, tenant_id: int, actor_user_id: int, payload: dict, document_id: int | None = None) -> InventoryAdjustment:
    doc = repo.adjustment(db, tenant_id=tenant_id, document_id=document_id, lock=True) if document_id else None
    if document_id and doc is None:
        raise HTTPException(status_code=404, detail="Adjustment not found")
    if doc and doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft adjustment can be edited")
    warehouse = _warehouse(db, tenant_id=tenant_id, warehouse_id=payload["warehouse_id"])
    mode, reason = payload["mode"], payload["reason"].strip()
    if mode not in {"quantity", "count"} or not reason:
        raise HTTPException(status_code=400, detail="Adjustment mode and reason are required")
    lines = payload["lines"]
    product_ids = _unique_lines(lines)
    _products(db, tenant_id=tenant_id, product_ids=product_ids)
    # Every save snapshots the current balance as the expected quantity, so a count that went
    # stale while it was a draft is refreshed by saving it again rather than abandoned.
    levels = {row.product_id: Decimal(row.on_hand) for row in db.query(InventoryStockLevel).filter(
        InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.warehouse_id == warehouse.id,
        InventoryStockLevel.product_id.in_(product_ids),
    )}
    if doc is None:
        doc = InventoryAdjustment(tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope="inventory_adjustments", prefix="ADJ"))
    doc.warehouse_id, doc.mode, doc.reason = warehouse.id, mode, reason
    doc.notes = payload.get("notes")
    doc.lines = []
    db.add(doc)
    db.flush()
    for line in lines:
        product_id = int(line["product_id"])
        expected = levels.get(product_id, Decimal(0))
        if mode == "count":
            counted = _decimal(line.get("counted"), nonnegative=True)
            delta = counted - expected
        else:
            counted = None
            delta = _decimal(line.get("delta"))
            if delta == 0:
                raise HTTPException(status_code=400, detail="A quantity adjustment cannot be zero")
        doc.lines.append(InventoryAdjustmentLine(tenant_id=tenant_id, product_id=product_id, expected=expected, counted=counted, delta=delta))
    db.flush()
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, kind="adjustments", doc=doc, action="update" if document_id else "create")
    db.commit(); db.refresh(doc)
    return doc


def post_adjustment(db: Session, *, tenant_id: int, actor_user_id: int, document_id: int) -> InventoryAdjustment:
    doc = repo.adjustment(db, tenant_id=tenant_id, document_id=document_id, lock=True)
    if doc is None:
        raise HTTPException(status_code=404, detail="Adjustment not found")
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft adjustment can be posted")
    warehouse = _warehouse(db, tenant_id=tenant_id, warehouse_id=doc.warehouse_id)
    product_ids = sorted({line.product_id for line in doc.lines})
    _products(db, tenant_id=tenant_id, product_ids=set(product_ids))
    if not product_ids:
        raise HTTPException(status_code=400, detail="Add at least one product")
    # The same product lock order as post_moves keeps count validation and posting atomic.
    for product_id in product_ids:
        db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id == product_id).with_for_update().one()
    if doc.mode == "count":
        levels = {row.product_id: Decimal(row.on_hand) for row in db.query(InventoryStockLevel).filter(
            InventoryStockLevel.tenant_id == tenant_id, InventoryStockLevel.warehouse_id == warehouse.id,
            InventoryStockLevel.product_id.in_(product_ids),
        )}
        for line in doc.lines:
            if levels.get(line.product_id, Decimal(0)) != Decimal(line.expected):
                raise HTTPException(status_code=409, detail="Stock changed since this count was saved; save the draft again to refresh expected quantities, then recount any that changed")
    moves = [MoveSpec(product_id=line.product_id, warehouse_id=warehouse.id, quantity=Decimal(line.delta),
                      move_type="count" if doc.mode == "count" else "adjustment",
                      source_type="inventory_adjustment", source_id=doc.id, source_line_id=line.id,
                      reason=doc.reason, note=doc.notes) for line in doc.lines if Decimal(line.delta) != 0]
    post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, moves=moves)
    from app.modules.inventory.services.stock_ledger import stage_inventory_event
    stage_inventory_event(db, tenant_id=tenant_id, actor_user_id=actor_user_id,
        event_type="inventory.adjustment_posted", entity_type="inventory_adjustment", entity_id=doc.id,
        payload={"number": doc.number, "mode": doc.mode, "warehouse_id": warehouse.id,
            "record_label": doc.number, "record_url": f"/dashboard/inventory/adjustments/{doc.id}"})
    doc.status, doc.posted_at, doc.posted_by = "posted", datetime.now(timezone.utc), actor_user_id
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, kind="adjustments", doc=doc, action="post")
    db.commit(); db.refresh(doc)
    return doc


def save_transfer(db: Session, *, tenant_id: int, actor_user_id: int, payload: dict, document_id: int | None = None) -> InventoryTransfer:
    doc = repo.transfer(db, tenant_id=tenant_id, document_id=document_id, lock=True) if document_id else None
    if document_id and doc is None:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if doc and doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft transfer can be edited")
    source = _warehouse(db, tenant_id=tenant_id, warehouse_id=payload["from_warehouse_id"])
    target = _warehouse(db, tenant_id=tenant_id, warehouse_id=payload["to_warehouse_id"])
    if source.id == target.id:
        raise HTTPException(status_code=400, detail="Choose two different warehouses")
    lines = payload["lines"]
    _products(db, tenant_id=tenant_id, product_ids=_unique_lines(lines))
    if doc is None:
        doc = InventoryTransfer(tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope="inventory_transfers", prefix="TRF"))
    doc.from_warehouse_id, doc.to_warehouse_id, doc.notes = source.id, target.id, payload.get("notes")
    doc.lines = []
    db.add(doc); db.flush()
    for line in lines:
        doc.lines.append(InventoryTransferLine(tenant_id=tenant_id, product_id=int(line["product_id"]), quantity=_decimal(line["quantity"], positive=True)))
    db.flush()
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, kind="transfers", doc=doc, action="update" if document_id else "create")
    db.commit(); db.refresh(doc)
    return doc


def post_transfer(db: Session, *, tenant_id: int, actor_user_id: int, document_id: int) -> InventoryTransfer:
    doc = repo.transfer(db, tenant_id=tenant_id, document_id=document_id, lock=True)
    if doc is None:
        raise HTTPException(status_code=404, detail="Transfer not found")
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft transfer can be posted")
    _warehouse(db, tenant_id=tenant_id, warehouse_id=doc.from_warehouse_id)
    _warehouse(db, tenant_id=tenant_id, warehouse_id=doc.to_warehouse_id)
    lines = sorted(doc.lines, key=lambda line: line.product_id)
    _products(db, tenant_id=tenant_id, product_ids={line.product_id for line in lines})
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one product")
    moves = [MoveSpec(product_id=line.product_id, warehouse_id=doc.from_warehouse_id, quantity=-Decimal(line.quantity),
                      move_type="transfer_out", source_type="inventory_transfer", source_id=doc.id, source_line_id=line.id,
                      reason="Warehouse transfer") for line in lines]
    moves += [MoveSpec(product_id=line.product_id, warehouse_id=doc.to_warehouse_id, quantity=Decimal(line.quantity),
                       move_type="transfer_in", source_type="inventory_transfer", source_id=doc.id, source_line_id=line.id,
                       reason="Warehouse transfer") for line in lines]
    post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, moves=moves)
    doc.status, doc.posted_at, doc.posted_by = "posted", datetime.now(timezone.utc), actor_user_id
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, kind="transfers", doc=doc, action="post")
    db.commit(); db.refresh(doc)
    return doc


def cancel_document(db: Session, *, tenant_id: int, actor_user_id: int, kind: str, document_id: int, reason: str):
    if not reason.strip():
        raise HTTPException(status_code=400, detail="A cancellation reason is required")
    finder = repo.adjustment if kind == "adjustments" else repo.transfer
    doc = finder(db, tenant_id=tenant_id, document_id=document_id, lock=True)
    if doc is None:
        raise HTTPException(status_code=404, detail="Inventory document not found")
    if doc.status != "posted":
        raise HTTPException(status_code=409, detail="Only a posted document can be cancelled")
    reverse_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id,
                  source_type="inventory_adjustment" if kind == "adjustments" else "inventory_transfer",
                  source_id=doc.id, reason=reason.strip())
    doc.status = "cancelled"
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, kind=kind, doc=doc, action="cancel", detail=f": {reason.strip()}")
    db.commit(); db.refresh(doc)
    return doc


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int, kind: str, document_id: int) -> None:
    finder = repo.adjustment if kind == "adjustments" else repo.transfer
    doc = finder(db, tenant_id=tenant_id, document_id=document_id, lock=True)
    if doc is None:
        raise HTTPException(status_code=404, detail="Inventory document not found")
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft document can be removed")
    doc.deleted_at = datetime.now(timezone.utc)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, kind=kind, doc=doc, action="delete")
    db.commit()


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int, kind: str, document_id: int):
    finder = repo.adjustment if kind == "adjustments" else repo.transfer
    doc = finder(db, tenant_id=tenant_id, document_id=document_id, include_deleted=True, lock=True)
    if doc is None or doc.deleted_at is None or doc.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    doc.deleted_at = None
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, kind=kind, doc=doc, action="restore")
    db.commit(); db.refresh(doc)
    return doc


def serialize_document(db: Session, *, tenant_id: int, kind: str, doc, include_lines: bool = True) -> dict:
    warehouse_ids = {doc.warehouse_id} if kind == "adjustments" else {doc.from_warehouse_id, doc.to_warehouse_id}
    warehouses = {row.id: row.name for row in db.query(InventoryWarehouse).filter(
        InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.id.in_(warehouse_ids),
    )}
    result = {"id": doc.id, "number": doc.number, "status": doc.status,
              "notes": doc.notes, "posted_at": doc.posted_at, "posted_by": doc.posted_by,
              "created_at": doc.created_at, "is_deleted": doc.deleted_at is not None,
              "line_count": len(doc.lines)}
    if kind == "adjustments":
        result.update(warehouse_id=doc.warehouse_id, warehouse_name=warehouses.get(doc.warehouse_id, "Warehouse"),
                      mode=doc.mode, reason=doc.reason)
    else:
        result.update(from_warehouse_id=doc.from_warehouse_id, to_warehouse_id=doc.to_warehouse_id,
                      from_warehouse_name=warehouses.get(doc.from_warehouse_id, "Warehouse"),
                      to_warehouse_name=warehouses.get(doc.to_warehouse_id, "Warehouse"))
    if include_lines:
        product_ids = {line.product_id for line in doc.lines}
        products = {row.id: (row.name, row.sku) for row in db.query(CatalogProduct).filter(
            CatalogProduct.tenant_id == tenant_id, CatalogProduct.id.in_(product_ids),
        )} if product_ids else {}
        result["lines"] = [
            {"id": line.id, "product_id": line.product_id,
             "product_name": products.get(line.product_id, ("Product", None))[0],
             "sku": products.get(line.product_id, ("Product", None))[1],
             **({"expected": line.expected, "counted": line.counted, "delta": line.delta}
                if kind == "adjustments" else {"quantity": line.quantity})}
            for line in sorted(doc.lines, key=lambda item: item.id)
        ]
    return result
