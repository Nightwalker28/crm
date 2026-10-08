"""Return to vendor (13c §3.7, D12).

A vendor return starts from a posted receipt and lists what goes back, up to what that receipt
brought in less what earlier returns already sent. *Ship* takes tracked products out of stock
at the receipt's own cost (`costing.OUTBOUND_AT_OWN_COST`), so the stock left keeps its value
and the vendor is asked for exactly what they were paid. Non-stock products ship with no move.

`resolution` (owner decision 3) says what comes back:
- `replace`: the quantity is to receive again on the purchase order (`received_by_line` nets it);
- `credit`: a vendor credit follows (`vendor_credit_services.draft_from_return`).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.list_conditions import apply_list_conditions
from app.modules.inventory.models import InventoryStockMove
from app.modules.inventory.services.stock_ledger import MoveSpec, post_moves, reverse_moves
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.custom_fields import load_custom_field_values, sync_custom_fields
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.purchasing.models import (
    PurchaseOrder,
    PurchaseReceipt,
    PurchaseReceiptLine,
    PurchaseVendorCredit,
    PurchaseVendorReturn,
    PurchaseVendorReturnLine,
)
from app.modules.purchasing.services.purchase_order_services import _units, order_or_404, refresh_receipt_status

MODULE = "purchase_vendor_returns"
RESOLUTIONS = frozenset({"credit", "replace"})


def _audit(db: Session, *, doc: PurchaseVendorReturn, actor_user_id: int | None, action: str, description: str) -> None:
    log_activity(db, tenant_id=doc.tenant_id, actor_user_id=actor_user_id, module_key=MODULE, entity_type="purchase_vendor_return",
        entity_id=doc.id, action=action, description=description, commit=False)
    log_activity(db, tenant_id=doc.tenant_id, actor_user_id=actor_user_id, module_key="purchase_orders", entity_type="purchase_order",
        entity_id=doc.order_id, action=f"vendor_return.{action}", description=description, commit=False)


def _quantity(value) -> Decimal:
    try:
        result = Decimal(str(value))
        valid = result.is_finite() and result > 0 and result == result.quantize(Decimal("0.0001"))
    except (InvalidOperation, ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail="Returned quantities must be greater than zero, with at most four decimal places")
    return result


def get_return(db: Session, *, tenant_id: int, return_id: int, include_deleted: bool = False, lock: bool = False) -> PurchaseVendorReturn | None:
    query = db.query(PurchaseVendorReturn).options(selectinload(PurchaseVendorReturn.lines)).filter(
        PurchaseVendorReturn.tenant_id == tenant_id, PurchaseVendorReturn.id == return_id)
    if not include_deleted:
        query = query.filter(PurchaseVendorReturn.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def return_or_404(db: Session, **kwargs) -> PurchaseVendorReturn:
    doc = get_return(db, **kwargs)
    if doc is None:
        raise HTTPException(status_code=404, detail="Vendor return not found")
    return doc


def _receipt(db: Session, *, tenant_id: int, receipt_id: int, lock: bool = False) -> PurchaseReceipt:
    query = db.query(PurchaseReceipt).options(selectinload(PurchaseReceipt.lines)).filter(
        PurchaseReceipt.tenant_id == tenant_id, PurchaseReceipt.id == receipt_id, PurchaseReceipt.deleted_at.is_(None))
    receipt = (query.with_for_update() if lock else query).first()
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


def returned_by_receipt_line(db: Session, *, tenant_id: int, receipt_line_ids, exclude_return_id: int | None = None,
                             statuses=("draft", "shipped")) -> dict[int, Decimal]:
    """What returns (drafts too, so two drafts cannot both send the same units) hold per receipt line."""
    ids = list(receipt_line_ids)
    if not ids:
        return {}
    query = db.query(PurchaseVendorReturnLine.receipt_line_id, func.sum(PurchaseVendorReturnLine.quantity)).join(
        PurchaseVendorReturn, PurchaseVendorReturn.id == PurchaseVendorReturnLine.return_id).filter(
        PurchaseVendorReturnLine.tenant_id == tenant_id, PurchaseVendorReturnLine.receipt_line_id.in_(ids),
        PurchaseVendorReturn.deleted_at.is_(None), PurchaseVendorReturn.status.in_(list(statuses)))
    if exclude_return_id is not None:
        query = query.filter(PurchaseVendorReturn.id != exclude_return_id)
    return {line_id: Decimal(total or 0) for line_id, total in query.group_by(PurchaseVendorReturnLine.receipt_line_id)}


def receipt_costs(db: Session, *, tenant_id: int, receipt: PurchaseReceipt) -> dict[int, Decimal]:
    """Per receipt line, the base-currency unit cost its stock came in at."""
    rows = db.query(InventoryStockMove.source_line_id, InventoryStockMove.unit_cost).filter(
        InventoryStockMove.tenant_id == tenant_id, InventoryStockMove.source_type == "purchase_receipt",
        InventoryStockMove.source_id == receipt.id, InventoryStockMove.move_type == "receipt",
        InventoryStockMove.reverses_move_id.is_(None))
    return {line_id: Decimal(cost) for line_id, cost in rows if cost is not None}


def returnable(db: Session, *, tenant_id: int, receipt: PurchaseReceipt, exclude_return_id: int | None = None) -> dict[int, Decimal]:
    held = returned_by_receipt_line(db, tenant_id=tenant_id, receipt_line_ids=[line.id for line in receipt.lines],
                                    exclude_return_id=exclude_return_id)
    return {line.id: max(Decimal(line.quantity) - held.get(line.id, Decimal(0)), Decimal(0)) for line in receipt.lines}


def _validated_lines(db: Session, *, tenant_id: int, receipt: PurchaseReceipt, lines: list[dict],
                     exclude_return_id: int | None = None) -> list[tuple[PurchaseReceiptLine, Decimal]]:
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one line to return")
    by_id = {line.id: line for line in receipt.lines}
    left = returnable(db, tenant_id=tenant_id, receipt=receipt, exclude_return_id=exclude_return_id)
    result, seen = [], set()
    for payload in lines:
        line_id = int(payload["receipt_line_id"])
        if line_id in seen:
            raise HTTPException(status_code=400, detail="A receipt line can appear once per return")
        seen.add(line_id)
        line = by_id.get(line_id)
        if line is None:
            raise HTTPException(status_code=400, detail="Only this receipt's lines can be returned")
        quantity = _quantity(payload["quantity"])
        if quantity > left.get(line_id, Decimal(0)):
            raise HTTPException(status_code=409, detail=f"Only {_units(left.get(line_id, Decimal(0)))} of this line is left to return")
        result.append((line, quantity))
    return result


def save_return(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, return_id: int | None = None) -> PurchaseVendorReturn:
    doc = return_or_404(db, tenant_id=tenant_id, return_id=return_id, lock=True) if return_id else None
    if doc is not None and doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft vendor return can be edited")
    receipt = _receipt(db, tenant_id=tenant_id, receipt_id=doc.receipt_id if doc else int(payload["receipt_id"]), lock=True)
    if receipt.status != "posted":
        raise HTTPException(status_code=409, detail="Only a posted receipt's goods can be returned")
    order = order_or_404(db, tenant_id=tenant_id, order_id=receipt.order_id)
    reason = (payload.get("reason") if "reason" in payload else (doc.reason if doc else "")) or ""
    if not reason.strip():
        raise HTTPException(status_code=400, detail="Say why the goods go back")
    resolution = payload.get("resolution") or (doc.resolution if doc else "credit")
    if resolution not in RESOLUTIONS:
        raise HTTPException(status_code=400, detail="Choose a credit or a replacement")
    raw_lines = payload.get("lines")
    if raw_lines is None and doc is None:
        raw_lines = [{"receipt_line_id": line_id, "quantity": quantity}
                     for line_id, quantity in returnable(db, tenant_id=tenant_id, receipt=receipt).items() if quantity > 0]
        if not raw_lines:
            raise HTTPException(status_code=409, detail="Everything on this receipt has been returned")
    lines = _validated_lines(db, tenant_id=tenant_id, receipt=receipt, lines=raw_lines, exclude_return_id=doc.id if doc else None) \
        if raw_lines is not None else None
    if doc is None:
        doc = PurchaseVendorReturn(tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope=MODULE, prefix="VRT"),
            vendor_id=order.vendor_id, order_id=order.id, receipt_id=receipt.id, warehouse_id=receipt.warehouse_id, owner_id=actor_user_id)
        db.add(doc)
        db.flush()
    doc.reason = reason.strip()[:120]
    doc.resolution = resolution
    if "notes" in payload:
        doc.notes = (payload.get("notes") or "").strip() or None
    if lines is not None:
        costs = receipt_costs(db, tenant_id=tenant_id, receipt=receipt)
        doc.lines = [PurchaseVendorReturnLine(tenant_id=tenant_id, receipt_line_id=line.id, order_line_id=line.order_line_id,
                                              product_id=line.product_id, quantity=quantity, unit_cost=costs.get(line.id))
                     for line, quantity in lines]
    db.add(doc)
    db.flush()
    sync_custom_fields(db, tenant_id=tenant_id, module_key=MODULE, record=doc, payload=payload, created=return_id is None,
                       enforce_required="custom_fields" in payload)
    _audit(db, doc=doc, actor_user_id=actor_user_id, action="update" if return_id else "create",
        description=f"{'Updated' if return_id else 'Drafted'} vendor return {doc.number} against {receipt.number}: {doc.reason}")
    return doc


def ship_return(db: Session, *, tenant_id: int, actor_user_id: int | None, return_id: int) -> PurchaseVendorReturn:
    doc = return_or_404(db, tenant_id=tenant_id, return_id=return_id, lock=True)
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft vendor return can be shipped")
    receipt = _receipt(db, tenant_id=tenant_id, receipt_id=doc.receipt_id, lock=True)
    if receipt.status != "posted":
        raise HTTPException(status_code=409, detail="The receipt is no longer posted")
    _validated_lines(db, tenant_id=tenant_id, receipt=receipt, exclude_return_id=doc.id,
                     lines=[{"receipt_line_id": line.receipt_line_id, "quantity": line.quantity} for line in doc.lines])
    # Until F6.9's negative-stock policy, stock that is not there cannot go back.
    post_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, moves=[
        MoveSpec(product_id=line.product_id, warehouse_id=doc.warehouse_id, quantity=-Decimal(line.quantity), move_type="vendor_return",
                 source_type="purchase_vendor_return", source_id=doc.id, source_line_id=line.id, reason=doc.reason, note=doc.notes,
                 unit_cost=line.unit_cost, cost_source="receipt" if line.unit_cost is not None else None)
        for line in doc.lines if line.product is not None and line.product.track_inventory
    ])
    doc.status, doc.shipped_at, doc.shipped_by = "shipped", datetime.now(timezone.utc), actor_user_id
    db.add(doc)
    db.flush()
    _refresh_order(db, tenant_id=tenant_id, order_id=doc.order_id)
    _audit(db, doc=doc, actor_user_id=actor_user_id, action="ship",
        description=f"Shipped vendor return {doc.number} to the vendor; " + (
            "a replacement is expected" if doc.resolution == "replace" else "a credit is expected"))
    return doc


def cancel_return(db: Session, *, tenant_id: int, actor_user_id: int | None, return_id: int, reason: str) -> PurchaseVendorReturn:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A cancellation reason is required")
    doc = return_or_404(db, tenant_id=tenant_id, return_id=return_id, lock=True)
    if doc.status != "shipped":
        raise HTTPException(status_code=409, detail="Only a shipped vendor return can be cancelled; remove a draft instead")
    credited = db.query(PurchaseVendorCredit.number).filter(PurchaseVendorCredit.tenant_id == tenant_id,
        PurchaseVendorCredit.vendor_return_id == doc.id, PurchaseVendorCredit.deleted_at.is_(None), PurchaseVendorCredit.status == "issued").first()
    if credited is not None:
        raise HTTPException(status_code=409, detail=f"Vendor credit {credited[0]} was issued for this return; void it first")
    reverse_moves(db, tenant_id=tenant_id, actor_user_id=actor_user_id, source_type="purchase_vendor_return", source_id=doc.id, reason=reason)
    doc.status, doc.cancel_reason = "cancelled", reason[:120]
    db.add(doc)
    db.flush()
    _refresh_order(db, tenant_id=tenant_id, order_id=doc.order_id)
    _audit(db, doc=doc, actor_user_id=actor_user_id, action="cancel", description=f"Cancelled vendor return {doc.number}: {reason}")
    return doc


def _refresh_order(db: Session, *, tenant_id: int, order_id: int) -> None:
    """A replacement return changes what is to receive and to bill on the order."""
    from app.modules.purchasing.services.bill_services import refresh_bill_status

    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status in {"ordered", "received"}:
        refresh_receipt_status(db, order=order)
    refresh_bill_status(db, order=order)


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, return_id: int) -> None:
    doc = return_or_404(db, tenant_id=tenant_id, return_id=return_id, lock=True)
    if doc.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft vendor return can be removed")
    doc.deleted_at = datetime.now(timezone.utc)
    db.add(doc)
    _audit(db, doc=doc, actor_user_id=actor_user_id, action="delete", description=f"Removed draft vendor return {doc.number}")


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, return_id: int) -> PurchaseVendorReturn:
    doc = get_return(db, tenant_id=tenant_id, return_id=return_id, include_deleted=True, lock=True)
    if doc is None or doc.deleted_at is None or doc.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    doc.deleted_at = None
    db.add(doc)
    _audit(db, doc=doc, actor_user_id=actor_user_id, action="restore", description=f"Restored draft vendor return {doc.number}")
    return doc


def list_field_map() -> dict:
    """The vendor return list's saved-view fields (13c §3.2)."""
    return {
        "number": {"expression": PurchaseVendorReturn.number, "type": "text"},
        "status": {"expression": PurchaseVendorReturn.status, "type": "text"},
        "resolution": {"expression": PurchaseVendorReturn.resolution, "type": "text"},
        "reason": {"expression": PurchaseVendorReturn.reason, "type": "text"},
        "vendor_id": {"expression": PurchaseVendorReturn.vendor_id, "type": "number"},
        "owner_id": {"expression": PurchaseVendorReturn.owner_id, "type": "number"},
        "shipped_at": {"expression": PurchaseVendorReturn.shipped_at, "type": "date"},
        "created_at": {"expression": PurchaseVendorReturn.created_at, "type": "date"},
        # Shipped for a credit that no issued vendor credit covers yet.
        "awaiting_credit": {"expression": (PurchaseVendorReturn.status == "shipped") & (PurchaseVendorReturn.resolution == "credit")
                            & ~PurchaseVendorReturn.id.in_(select(PurchaseVendorCredit.vendor_return_id).where(
                                PurchaseVendorCredit.vendor_return_id.isnot(None), PurchaseVendorCredit.status == "issued")),
                            "type": "boolean"},
    }


def list_query(db: Session, *, tenant_id: int, status: str | None = None, search: str | None = None, receipt_id: int | None = None,
               filters_all: list[dict] | None = None, filters_any: list[dict] | None = None):
    """The vendor return list's rows. The list and its export both start here (13a A5)."""
    from app.modules.sales.models import SalesOrganization

    query = db.query(PurchaseVendorReturn).options(selectinload(PurchaseVendorReturn.lines)).filter(
        PurchaseVendorReturn.tenant_id == tenant_id, PurchaseVendorReturn.deleted_at.is_(None))
    if status:
        query = query.filter(PurchaseVendorReturn.status == status)
    if receipt_id:
        query = query.filter(PurchaseVendorReturn.receipt_id == receipt_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        vendors = db.query(SalesOrganization.org_id).filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_name.ilike(pattern))
        query = query.filter(or_(PurchaseVendorReturn.number.ilike(pattern), PurchaseVendorReturn.reason.ilike(pattern),
                                 PurchaseVendorReturn.vendor_id.in_(vendors)))
    return apply_list_conditions(query, field_map=list_field_map(), filters_all=filters_all, filters_any=filters_any)


def serialize_return(db: Session, *, tenant_id: int, doc: PurchaseVendorReturn, include_lines: bool = True) -> dict:
    order = db.query(PurchaseOrder).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.id == doc.order_id).first()
    receipt = db.query(PurchaseReceipt).filter(PurchaseReceipt.tenant_id == tenant_id, PurchaseReceipt.id == doc.receipt_id).first()
    credits = db.query(PurchaseVendorCredit).filter(PurchaseVendorCredit.tenant_id == tenant_id, PurchaseVendorCredit.vendor_return_id == doc.id,
        PurchaseVendorCredit.deleted_at.is_(None)).order_by(PurchaseVendorCredit.id).all()
    result = {
        "id": doc.id, "number": doc.number, "status": doc.status, "resolution": doc.resolution, "reason": doc.reason, "notes": doc.notes,
        "vendor_id": doc.vendor_id, "vendor_name": doc.vendor.org_name if doc.vendor else None,
        "order_id": doc.order_id, "order_number": order.number if order else None, "currency": order.currency if order else None,
        "receipt_id": doc.receipt_id, "receipt_number": receipt.number if receipt else None, "warehouse_id": doc.warehouse_id,
        "shipped_at": doc.shipped_at, "cancel_reason": doc.cancel_reason, "owner_id": doc.owner_id,
        "created_at": doc.created_at, "updated_at": doc.updated_at, "is_deleted": doc.deleted_at is not None,
        "line_count": len(doc.lines), "total_quantity": sum((Decimal(line.quantity) for line in doc.lines), Decimal(0)),
        "credits": [{"id": credit.id, "number": credit.number, "status": credit.status, "total": credit.total, "currency": credit.currency}
                    for credit in credits],
    }
    if include_lines:
        left = returnable(db, tenant_id=tenant_id, receipt=receipt, exclude_return_id=doc.id) if receipt and doc.status == "draft" else {}
        result["lines"] = [{
            "id": line.id, "receipt_line_id": line.receipt_line_id, "order_line_id": line.order_line_id, "product_id": line.product_id,
            "product_name": line.product.name if line.product else "Product", "sku": line.product.sku if line.product else None,
            "quantity": line.quantity, "unit_cost": line.unit_cost, "returnable": left.get(line.receipt_line_id),
        } for line in doc.lines]
        result["custom_fields"] = load_custom_field_values(db, tenant_id=tenant_id, module_key=MODULE, record_id=doc.id)
    return result


def receipt_returns(db: Session, *, tenant_id: int, receipt_id: int | None = None, order_id: int | None = None) -> list[dict]:
    """The returns against a receipt or a purchase order, for those documents' pages."""
    query = db.query(PurchaseVendorReturn).options(selectinload(PurchaseVendorReturn.lines)).filter(
        PurchaseVendorReturn.tenant_id == tenant_id, PurchaseVendorReturn.deleted_at.is_(None))
    query = query.filter(PurchaseVendorReturn.receipt_id == receipt_id) if receipt_id else query.filter(PurchaseVendorReturn.order_id == order_id)
    return [{"id": doc.id, "number": doc.number, "status": doc.status, "resolution": doc.resolution, "reason": doc.reason,
             "total_quantity": sum((Decimal(line.quantity) for line in doc.lines), Decimal(0))} for doc in query.order_by(PurchaseVendorReturn.id)]
