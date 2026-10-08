"""Purchase orders (12b-erp-purchasing.md §3): draft → ordered → received, closed or cancelled.

An ordered PO is *incoming* stock until receipts bring it in (`receipt_services.py`). The
remainder of a line stays on it as To receive; *Close remaining* drops it on purpose.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import and_, func, or_
from app.core.list_conditions import apply_list_conditions
from sqlalchemy.orm import Session, selectinload

from app.modules.inventory.services.costing import base_currency, clean_rate, default_exchange_rate, rate_for
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.inventory.models import InventoryWarehouse
from app.modules.inventory.services.stock_ledger import ensure_default_warehouse
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.purchasing.models import PurchaseOrder, PurchaseOrderLine, PurchaseReceipt, PurchaseReceiptLine
from app.modules.sales.models import SalesOrganization
from app.modules.platform.services.custom_fields import load_custom_field_values, sync_custom_fields


def list_field_map() -> dict:
    """The purchase order list's saved-view fields (13c §3.2)."""
    return {
        "number": {"expression": PurchaseOrder.number, "type": "text"},
        "status": {"expression": PurchaseOrder.status, "type": "text"},
        "receipt_status": {"expression": PurchaseOrder.receipt_status, "type": "text"},
        "bill_status": {"expression": PurchaseOrder.bill_status, "type": "text"},
        "vendor_id": {"expression": PurchaseOrder.vendor_id, "type": "number"},
        "warehouse_id": {"expression": PurchaseOrder.warehouse_id, "type": "number"},
        "owner_id": {"expression": PurchaseOrder.owner_id, "type": "number"},
        "vendor_reference": {"expression": PurchaseOrder.vendor_reference, "type": "text"},
        "currency": {"expression": PurchaseOrder.currency, "type": "text"},
        "subtotal": {"expression": PurchaseOrder.subtotal, "type": "number"},
        "expected_date": {"expression": PurchaseOrder.expected_date, "type": "date"},
        "ordered_at": {"expression": PurchaseOrder.ordered_at, "type": "date"},
        "created_at": {"expression": PurchaseOrder.created_at, "type": "date"},
        # Placed, and something still to arrive.
        "to_receive": {"expression": and_(PurchaseOrder.status == "ordered", PurchaseOrder.receipt_status != "received"), "type": "boolean"},
    }

def list_query(db: Session, *, tenant_id: int, status: str | None = None, vendor_id: int | None = None, search: str | None = None, filters_all: list[dict] | None = None, filters_any: list[dict] | None = None):
    """The purchase order list's rows. The list and its export both start here (13a A5)."""
    query = db.query(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.deleted_at.is_(None))
    if status == "open":
        query = query.filter(PurchaseOrder.status.in_(["draft", "sent", "ordered"]))
    elif status:
        query = query.filter(PurchaseOrder.status == status)
    if vendor_id:
        query = query.filter(PurchaseOrder.vendor_id == vendor_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.join(SalesOrganization, SalesOrganization.org_id == PurchaseOrder.vendor_id).filter(or_(
            PurchaseOrder.number.ilike(pattern), PurchaseOrder.vendor_reference.ilike(pattern), SalesOrganization.org_name.ilike(pattern)))
    query = apply_list_conditions(query, field_map=list_field_map(), filters_all=filters_all, filters_any=filters_any)
    return query


def _decimal(value, *, field: str, positive: bool = False) -> Decimal:
    try:
        result = Decimal(str(value))
        valid = result.is_finite() and result == result.quantize(Decimal("0.0001")) and (result > 0 if positive else result >= 0)
    except (InvalidOperation, ValueError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(status_code=400, detail=f"{field} must be {'greater than zero' if positive else 'zero or more'}, with at most four decimal places")
    return result


def _units(value: Decimal) -> str:
    text_value = format(Decimal(value).normalize(), "f")
    return f"{text_value} unit" if Decimal(value) == 1 else f"{text_value} units"


def get_vendor(db: Session, *, tenant_id: int, vendor_id: int) -> SalesOrganization:
    vendor = db.query(SalesOrganization).filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == vendor_id,
        SalesOrganization.deleted_at.is_(None)).first()
    if vendor is None:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if not vendor.is_vendor:
        raise HTTPException(status_code=400, detail=f"{vendor.org_name} is not marked as a vendor")
    return vendor


def get_order(db: Session, *, tenant_id: int, order_id: int, include_deleted: bool = False, lock: bool = False) -> PurchaseOrder | None:
    query = db.query(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).filter(PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.id == order_id)
    if not include_deleted:
        query = query.filter(PurchaseOrder.deleted_at.is_(None))
    return (query.with_for_update() if lock else query).first()


def order_or_404(db: Session, **kwargs) -> PurchaseOrder:
    order = get_order(db, **kwargs)
    if order is None:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    return order


def _audit(db: Session, *, tenant_id: int, actor_user_id: int | None, order: PurchaseOrder, action: str, description: str) -> None:
    log_activity(db, tenant_id=tenant_id, actor_user_id=actor_user_id, module_key="purchase_orders", entity_type="purchase_order",
        entity_id=order.id, action=action, description=description, commit=False)


def received_by_line(db: Session, *, tenant_id: int, line_ids) -> dict[int, Decimal]:
    """What posted receipts have brought in, per PO line, less what went back to the vendor
    to be replaced (13c §3.7): that quantity is to receive again."""
    from app.modules.purchasing.models import PurchaseVendorReturn, PurchaseVendorReturnLine

    line_ids = list(line_ids)
    if not line_ids:
        return {}
    rows = db.query(PurchaseReceiptLine.order_line_id, func.sum(PurchaseReceiptLine.quantity)).join(
        PurchaseReceipt, PurchaseReceipt.id == PurchaseReceiptLine.receipt_id).filter(
        PurchaseReceiptLine.tenant_id == tenant_id, PurchaseReceiptLine.order_line_id.in_(line_ids), PurchaseReceipt.status == "posted",
    ).group_by(PurchaseReceiptLine.order_line_id)
    received = {line_id: Decimal(total or 0) for line_id, total in rows}
    replaced = db.query(PurchaseVendorReturnLine.order_line_id, func.sum(PurchaseVendorReturnLine.quantity)).join(
        PurchaseVendorReturn, PurchaseVendorReturn.id == PurchaseVendorReturnLine.return_id).filter(
        PurchaseVendorReturnLine.tenant_id == tenant_id, PurchaseVendorReturnLine.order_line_id.in_(line_ids),
        PurchaseVendorReturn.status == "shipped", PurchaseVendorReturn.resolution == "replace",
    ).group_by(PurchaseVendorReturnLine.order_line_id)
    for line_id, total in replaced:
        received[line_id] = max(received.get(line_id, Decimal(0)) - Decimal(total or 0), Decimal(0))
    return received


def to_receive(order: PurchaseOrder, line: PurchaseOrderLine, received: Decimal) -> Decimal:
    """Ordered less received while the PO is open; nothing once it is received, closed or
    cancelled, and never for a service (13c §3.5)."""
    if order.status != "ordered" or not line.needs_receipt:
        return Decimal(0)
    return max(Decimal(line.quantity) - received, Decimal(0))


def incoming(db: Session, *, tenant_id: int, product_ids=None, warehouse_id: int | None = None) -> dict[tuple[int, int], Decimal]:
    """To receive on ordered POs, per (product, warehouse)."""
    query = db.query(PurchaseOrderLine, PurchaseOrder).join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.order_id).filter(
        PurchaseOrder.tenant_id == tenant_id, PurchaseOrderLine.tenant_id == tenant_id, PurchaseOrder.status == "ordered", PurchaseOrder.deleted_at.is_(None),
        PurchaseOrderLine.product_id.isnot(None))
    if product_ids is not None:
        product_ids = list(product_ids)
        if not product_ids:
            return {}
        query = query.filter(PurchaseOrderLine.product_id.in_(product_ids))
    if warehouse_id is not None:
        query = query.filter(PurchaseOrder.warehouse_id == warehouse_id)
    rows = query.all()
    received = received_by_line(db, tenant_id=tenant_id, line_ids=[line.id for line, _ in rows])
    result: dict[tuple[int, int], Decimal] = {}
    for line, order in rows:
        left = to_receive(order, line, received.get(line.id, Decimal(0)))
        if left > 0:
            key = (line.product_id, order.warehouse_id)
            result[key] = result.get(key, Decimal(0)) + left
    return result


def _normalize_lines(db: Session, *, tenant_id: int, vendor_id: int, lines: list[dict]) -> list[PurchaseOrderLine]:
    """Products (tracked or not) and services, each with an optional discount (13c §3.5)."""
    if not lines:
        raise HTTPException(status_code=400, detail="Add at least one line")
    product_ids = {int(line["product_id"]) for line in lines if line.get("product_id")}
    service_ids = {int(line["catalog_service_id"]) for line in lines if line.get("catalog_service_id")}
    products = {row.id: row for row in db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id.in_(product_ids),
        CatalogProduct.deleted_at.is_(None))} if product_ids else {}
    services = {row.id: row for row in db.query(CatalogService).filter(CatalogService.tenant_id == tenant_id, CatalogService.id.in_(service_ids),
        CatalogService.deleted_at.is_(None))} if service_ids else {}
    result = []
    for index, line in enumerate(lines):
        if bool(line.get("product_id")) == bool(line.get("catalog_service_id")):
            raise HTTPException(status_code=400, detail="Each line is one product or one service")
        product = products.get(int(line["product_id"])) if line.get("product_id") else None
        service = services.get(int(line["catalog_service_id"])) if line.get("catalog_service_id") else None
        item = product or service
        if item is None:
            raise HTTPException(status_code=404, detail="Product not found" if line.get("product_id") else "Service not found")
        quantity = _decimal(line.get("quantity"), field="Quantity", positive=True)
        default_cost = line_cost_default(db, tenant_id=tenant_id, vendor_id=vendor_id, product_id=product.id if product else None,
                                         service_id=service.id if service else None)
        raw_cost = line.get("unit_cost")
        unit_cost = _decimal(raw_cost if raw_cost is not None else (default_cost or 0), field="Unit cost")
        gross = (quantity * unit_cost).quantize(Decimal("0.01"))
        discount = _decimal(line.get("discount_amount") or 0, field="Discount").quantize(Decimal("0.01"))
        if discount > gross:
            raise HTTPException(status_code=400, detail=f"{item.name}: the discount is more than the line")
        result.append(PurchaseOrderLine(tenant_id=tenant_id, product_id=product.id if product else None,
            catalog_service_id=service.id if service else None, description=(line.get("description") or "").strip() or None,
            quantity=quantity, unit_cost=unit_cost, discount_amount=discount, line_total=gross - discount, sort_order=index))
    return result


def recent_vendor_ids(db: Session, *, tenant_id: int, limit: int = 5) -> list[int]:
    """Vendors on the tenant's latest purchase orders and bills, most recent first."""
    from app.modules.purchasing.models import PurchaseBill

    seen: list[int] = []
    rows = [(row.created_at, row.vendor_id) for row in db.query(PurchaseOrder.created_at, PurchaseOrder.vendor_id).filter(
        PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.deleted_at.is_(None)).order_by(PurchaseOrder.id.desc()).limit(limit * 4)]
    rows += [(row.created_at, row.vendor_id) for row in db.query(PurchaseBill.created_at, PurchaseBill.vendor_id).filter(
        PurchaseBill.tenant_id == tenant_id, PurchaseBill.deleted_at.is_(None)).order_by(PurchaseBill.id.desc()).limit(limit * 4)]
    # ISO text sorts like the timestamp and never trips over a naive/aware mix between drivers.
    for _created, vendor_id in sorted(rows, key=lambda row: str(row[0] or ""), reverse=True):
        if vendor_id not in seen:
            seen.append(vendor_id)
        if len(seen) == limit:
            break
    return seen


def line_cost_default(db: Session, *, tenant_id: int, vendor_id: int | None, product_id: int | None = None,
                      service_id: int | None = None) -> Decimal | None:
    """What a new PO line costs before anyone types (13c §5 decision 7): the last price this
    vendor billed for the item, then the last price on one of the vendor's purchase orders,
    then the item's own cost. In the document's currency as entered; None when nothing is known."""
    from app.modules.purchasing.models import PurchaseBill, PurchaseBillLine

    if vendor_id and (product_id or service_id):
        billed = db.query(PurchaseBillLine.unit_cost).join(PurchaseBill, PurchaseBill.id == PurchaseBillLine.bill_id).filter(
            PurchaseBill.tenant_id == tenant_id, PurchaseBill.vendor_id == vendor_id, PurchaseBill.status == "posted",
            PurchaseBillLine.catalog_product_id == product_id if product_id else PurchaseBillLine.catalog_service_id == service_id,
        ).order_by(PurchaseBill.bill_date.desc(), PurchaseBillLine.id.desc()).first()
        if billed is not None:
            return Decimal(billed[0])
        ordered = db.query(PurchaseOrderLine.unit_cost).join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.order_id).filter(
            PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.vendor_id == vendor_id, PurchaseOrder.deleted_at.is_(None),
            PurchaseOrder.status != "cancelled",
            PurchaseOrderLine.product_id == product_id if product_id else PurchaseOrderLine.catalog_service_id == service_id,
        ).order_by(PurchaseOrder.id.desc(), PurchaseOrderLine.id.desc()).first()
        if ordered is not None:
            return Decimal(ordered[0])
    model, item_id = (CatalogProduct, product_id) if product_id else (CatalogService, service_id)
    if not item_id:
        return None
    cost = db.query(model.cost_price).filter(model.tenant_id == tenant_id, model.id == item_id).scalar()
    return Decimal(cost) if cost is not None else None


# A purchase order before it is placed is a request for quotation (13c §3.8, owner decision 4):
# `draft` while it is prepared, `sent` once the vendor has it. Both can be edited, compared
# with their alternatives, and placed.
RFQ_STATUSES = frozenset({"draft", "sent"})


def save_order(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict, order_id: int | None = None) -> PurchaseOrder:
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True) if order_id else None
    if order is not None and order.status not in RFQ_STATUSES:
        raise HTTPException(status_code=409, detail="Only a request for quotation can be edited; a placed order is locked")
    vendor_id = payload.get("vendor_id") or (order.vendor_id if order else None)
    if not vendor_id:
        raise HTTPException(status_code=400, detail="Choose a vendor")
    vendor = get_vendor(db, tenant_id=tenant_id, vendor_id=int(vendor_id))
    warehouse_id = payload.get("warehouse_id") or (order.warehouse_id if order else None) or ensure_default_warehouse(db, tenant_id=tenant_id).id
    warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.id == warehouse_id,
        InventoryWarehouse.deleted_at.is_(None)).first()
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    if not warehouse.is_active:
        raise HTTPException(status_code=409, detail=f"{warehouse.name} is inactive")
    lines = _normalize_lines(db, tenant_id=tenant_id, vendor_id=vendor.org_id, lines=payload.get("lines") or [])
    if order is None:
        order = PurchaseOrder(tenant_id=tenant_id, number=allocate_business_number(db, tenant_id=tenant_id, scope="purchase_orders", prefix="PO"),
            owner_id=actor_user_id)
    order.vendor_id, order.warehouse_id = vendor.org_id, warehouse.id
    order.currency = (payload.get("currency") or order.currency or "USD").strip().upper()[:10]
    if "exchange_rate" in payload:
        order.exchange_rate = clean_rate(payload.get("exchange_rate"))
    if order.currency == base_currency(db, tenant_id=tenant_id):
        order.exchange_rate = None
    order.expected_date = payload.get("expected_date")
    order.vendor_reference = (payload.get("vendor_reference") or "").strip() or None
    order.notes = (payload.get("notes") or "").strip() or None
    order.lines = lines
    order.subtotal = sum((line.line_total for line in lines), Decimal(0))
    db.add(order)
    db.flush()
    sync_custom_fields(db, tenant_id=tenant_id, module_key="purchase_orders", record=order, payload=payload, created=order_id is None,
                       enforce_required="custom_fields" in payload)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="update" if order_id else "create",
        description=f"{'Updated' if order_id else 'Created'} purchase order {order.number} for {vendor.org_name}")
    return order


def mark_ordered(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int) -> PurchaseOrder:
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status not in RFQ_STATUSES:
        raise HTTPException(status_code=409, detail="Only a request for quotation can be placed")
    if not order.lines:
        raise HTTPException(status_code=400, detail="Add at least one line")
    get_vendor(db, tenant_id=tenant_id, vendor_id=order.vendor_id)
    if rate_for(db, tenant_id=tenant_id, currency=order.currency, exchange_rate=order.exchange_rate) is None:
        raise HTTPException(status_code=409, detail=f"Enter the exchange rate from {order.currency} to {base_currency(db, tenant_id=tenant_id)} before placing this order")
    order.status, order.ordered_at, order.ordered_by = "ordered", datetime.now(timezone.utc), actor_user_id
    db.add(order)
    if any(not line.needs_receipt for line in order.lines):
        # Services are billable once ordered (13c §3.5).
        from app.modules.purchasing.services.bill_services import refresh_bill_status

        db.flush()
        refresh_bill_status(db, order=order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="order", description=f"Placed purchase order {order.number}")
    _cancel_alternatives(db, tenant_id=tenant_id, actor_user_id=actor_user_id, chosen=order)
    return order


def set_exchange_rate(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int, exchange_rate) -> PurchaseOrder:
    """Change the rate on a draft or placed order. Receipts already posted keep the cost they
    were received at; a bill's price difference uses the rate at posting."""
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status not in {*RFQ_STATUSES, "ordered"}:
        raise HTTPException(status_code=409, detail="Only a request for quotation's or placed purchase order's exchange rate can change")
    if order.currency == base_currency(db, tenant_id=tenant_id):
        raise HTTPException(status_code=409, detail="This order is in the base currency")
    rate = clean_rate(exchange_rate)
    if rate is None:
        raise HTTPException(status_code=400, detail="Enter an exchange rate")
    order.exchange_rate = rate
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="update",
        description=f"Set the exchange rate on {order.number} to {rate} {base_currency(db, tenant_id=tenant_id)} per {order.currency}")
    return order


def mark_sent(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int) -> PurchaseOrder:
    """The RFQ went to the vendor. F5's *Send* emails it and calls this."""
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status not in RFQ_STATUSES:
        raise HTTPException(status_code=409, detail="Only a request for quotation can be sent")
    if not order.lines:
        raise HTTPException(status_code=400, detail="Add at least one line")
    first = order.status == "draft"
    order.status, order.sent_at, order.sent_by = "sent", datetime.now(timezone.utc), actor_user_id
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="send",
        description=f"{'Sent' if first else 'Sent again'} request for quotation {order.number} to {order.vendor.org_name if order.vendor else 'the vendor'}")
    return order


def create_alternative(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int, vendor_id: int) -> PurchaseOrder:
    """The same request asked of another vendor (13c §3.8): a new draft in the same group."""
    source = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if source.status not in RFQ_STATUSES:
        raise HTTPException(status_code=409, detail="Alternatives are asked for before an order is placed")
    vendor = get_vendor(db, tenant_id=tenant_id, vendor_id=vendor_id)
    group_id = source.rfq_group_id or source.id
    if any(row.vendor_id == vendor.org_id for row in rfq_group(db, tenant_id=tenant_id, group_id=group_id) if row.status in RFQ_STATUSES):
        raise HTTPException(status_code=409, detail=f"{vendor.org_name} already has a request in this comparison")
    source.rfq_group_id = group_id
    alternative = save_order(db, tenant_id=tenant_id, actor_user_id=actor_user_id, payload={
        "vendor_id": vendor.org_id, "warehouse_id": source.warehouse_id, "currency": source.currency,
        "expected_date": source.expected_date, "notes": source.notes,
        "lines": [{"product_id": line.product_id, "catalog_service_id": line.catalog_service_id, "description": line.description,
                   "quantity": line.quantity} for line in source.lines],
    })
    alternative.rfq_group_id = group_id
    db.add_all([source, alternative])
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=source, action="alternative",
        description=f"Asked {vendor.org_name} for the same request as {alternative.number}")
    return alternative


def rfq_group(db: Session, *, tenant_id: int, group_id: int) -> list[PurchaseOrder]:
    return db.query(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).filter(
        PurchaseOrder.tenant_id == tenant_id, PurchaseOrder.deleted_at.is_(None),
        or_(PurchaseOrder.id == group_id, PurchaseOrder.rfq_group_id == group_id)).order_by(PurchaseOrder.id).all()


def compare_group(db: Session, *, tenant_id: int, order_id: int) -> dict:
    """Every alternative side by side (13c §3.8): per item, each vendor's net unit cost, line
    total and the lowest; per vendor, the total and expected date."""
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id)
    members = rfq_group(db, tenant_id=tenant_id, group_id=order.rfq_group_id or order.id)
    members = [row for row in members if row.status != "cancelled" or row.id == order.id]
    items: dict[tuple, dict] = {}
    for member in members:
        for line in member.lines:
            key = ("product", line.product_id) if line.product_id else ("service", line.catalog_service_id)
            row = items.setdefault(key, {"kind": key[0], "item_id": key[1], "name": line.item_name, "offers": {}})
            offer = row["offers"].setdefault(member.id, {"quantity": Decimal(0), "line_total": Decimal(0)})
            offer["quantity"] += Decimal(line.quantity)
            offer["line_total"] += Decimal(line.line_total)
    for row in items.values():
        for offer in row["offers"].values():
            offer["unit_cost"] = (offer["line_total"] / offer["quantity"]).quantize(Decimal("0.0001")) if offer["quantity"] else None
        priced = [offer["unit_cost"] for offer in row["offers"].values() if offer["unit_cost"] is not None]
        row["lowest_unit_cost"] = min(priced) if priced else None
    totals = [Decimal(member.subtotal) for member in members if member.status in RFQ_STATUSES]
    return {
        "group_id": order.rfq_group_id or order.id,
        "vendors": [{"order_id": member.id, "number": member.number, "status": member.status, "vendor_id": member.vendor_id,
                     "vendor_name": member.vendor.org_name if member.vendor else None, "currency": member.currency,
                     "subtotal": member.subtotal, "expected_date": member.expected_date, "sent_at": member.sent_at,
                     "is_lowest": member.status in RFQ_STATUSES and bool(totals) and Decimal(member.subtotal) == min(totals)}
                    for member in members],
        "items": [{**row, "offers": [{"order_id": order_id, **offer} for order_id, offer in row["offers"].items()]} for row in items.values()],
    }


def _cancel_alternatives(db: Session, *, tenant_id: int, actor_user_id: int | None, chosen: PurchaseOrder) -> None:
    """Placing one RFQ of a group closes the others (13c §3.8), each with its own history entry."""
    if not chosen.rfq_group_id:
        return
    for member in rfq_group(db, tenant_id=tenant_id, group_id=chosen.rfq_group_id):
        if member.id == chosen.id or member.status not in RFQ_STATUSES:
            continue
        member.status, member.cancel_reason = "cancelled", f"Another vendor chosen ({chosen.number})"
        db.add(member)
        _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=member, action="cancel",
            description=f"Cancelled request for quotation {member.number}: {chosen.vendor.org_name if chosen.vendor else 'another vendor'} was chosen on {chosen.number}")


def has_receipts(db: Session, *, tenant_id: int, order_id: int, statuses) -> bool:
    return db.query(PurchaseReceipt.id).filter(PurchaseReceipt.tenant_id == tenant_id, PurchaseReceipt.order_id == order_id,
        PurchaseReceipt.deleted_at.is_(None), PurchaseReceipt.status.in_(list(statuses))).first() is not None


def refresh_receipt_status(db: Session, *, order: PurchaseOrder) -> str:
    # Only products are received (13c §3.5); a services-only order stays "none".
    receivable = [line for line in order.lines if line.needs_receipt]
    received = received_by_line(db, tenant_id=order.tenant_id, line_ids=[line.id for line in receivable])
    amounts = [received.get(line.id, Decimal(0)) for line in receivable]
    if receivable and all(amount >= Decimal(line.quantity) for amount, line in zip(amounts, receivable)):
        value = "received"
    elif any(amount > 0 for amount in amounts):
        value = "partial"
    else:
        value = "none"
    order.receipt_status = value
    if order.status == "ordered" and value == "received":
        order.status = "received"
    elif order.status == "received" and value != "received":
        order.status = "ordered"
    db.add(order)
    return value


def close_remaining(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int, reason: str) -> PurchaseOrder:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status != "ordered":
        raise HTTPException(status_code=409, detail="Only a placed purchase order can be closed")
    if not has_receipts(db, tenant_id=tenant_id, order_id=order.id, statuses=["posted"]):
        raise HTTPException(status_code=409, detail="Nothing has been received yet; cancel the purchase order instead")
    if has_receipts(db, tenant_id=tenant_id, order_id=order.id, statuses=["draft"]):
        raise HTTPException(status_code=409, detail="Post or remove the draft receipts first")
    order.status, order.closed_at, order.close_reason = "closed", datetime.now(timezone.utc), reason
    db.add(order)
    db.flush()
    from app.modules.purchasing.services.bill_services import refresh_bill_status

    refresh_bill_status(db, order=order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="close", description=f"Closed the rest of {order.number}: {reason}")
    return order


def cancel_order(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int, reason: str) -> PurchaseOrder:
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A cancellation reason is required")
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status not in {*RFQ_STATUSES, "ordered"}:
        raise HTTPException(status_code=409, detail="Only a request for quotation or a placed purchase order can be cancelled")
    if has_receipts(db, tenant_id=tenant_id, order_id=order.id, statuses=["posted"]):
        raise HTTPException(status_code=409, detail="Stock has been received on this purchase order; cancel its receipts or close the rest instead")
    if has_receipts(db, tenant_id=tenant_id, order_id=order.id, statuses=["draft"]):
        raise HTTPException(status_code=409, detail="Remove the draft receipts first")
    order.status, order.cancel_reason = "cancelled", reason
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="cancel", description=f"Cancelled purchase order {order.number}: {reason}")
    return order


def delete_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int) -> None:
    order = order_or_404(db, tenant_id=tenant_id, order_id=order_id, lock=True)
    if order.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft purchase order can be removed")
    order.deleted_at = datetime.now(timezone.utc)
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="delete", description=f"Removed draft purchase order {order.number}")


def restore_draft(db: Session, *, tenant_id: int, actor_user_id: int | None, order_id: int) -> PurchaseOrder:
    order = get_order(db, tenant_id=tenant_id, order_id=order_id, include_deleted=True, lock=True)
    if order is None or order.deleted_at is None or order.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft not found")
    order.deleted_at = None
    db.add(order)
    _audit(db, tenant_id=tenant_id, actor_user_id=actor_user_id, order=order, action="restore", description=f"Restored draft purchase order {order.number}")
    return order


def serialize_order(db: Session, *, tenant_id: int, order: PurchaseOrder, include_lines: bool = True) -> dict:
    result = {
        "id": order.id, "number": order.number, "status": order.status, "receipt_status": order.receipt_status,
        "bill_status": order.bill_status,
        "vendor_id": order.vendor_id, "vendor_name": order.vendor.org_name if order.vendor else None,
        "vendor_email": order.vendor.primary_email if order.vendor else None,
        "vendor_address": "\n".join(part for part in ((order.vendor.billing_address, order.vendor.billing_city, order.vendor.billing_state,
            order.vendor.billing_postal_code, order.vendor.billing_country) if order.vendor else ()) if part) or None,
        "warehouse_id": order.warehouse_id, "warehouse_name": order.warehouse.name if order.warehouse else None,
        "currency": order.currency, "exchange_rate": order.exchange_rate, "base_currency": base_currency(db, tenant_id=tenant_id),
        "suggested_exchange_rate": default_exchange_rate(db, tenant_id=tenant_id, currency=order.currency) if order.exchange_rate is None else None,
        "expected_date": order.expected_date, "vendor_reference": order.vendor_reference, "notes": order.notes,
        "subtotal": order.subtotal, "ordered_at": order.ordered_at, "ordered_by": order.ordered_by, "closed_at": order.closed_at,
        "sent_at": order.sent_at, "rfq_group_id": order.rfq_group_id,
        "close_reason": order.close_reason, "cancel_reason": order.cancel_reason, "owner_id": order.owner_id,
        "created_at": order.created_at, "updated_at": order.updated_at, "is_deleted": order.deleted_at is not None,
        "line_count": len(order.lines), "total_quantity": sum((Decimal(line.quantity) for line in order.lines), Decimal(0)),
    }
    if include_lines:
        from app.modules.purchasing.services.bill_services import billing_lines, order_bills

        billing = billing_lines(db, order=order)
        received = received_by_line(db, tenant_id=tenant_id, line_ids=[line.id for line in order.lines])
        result["lines"] = [{
            "id": line.id, "product_id": line.product_id, "catalog_service_id": line.catalog_service_id,
            "kind": "product" if line.product_id else "service", "product_name": line.item_name,
            "track_inventory": bool(line.product.track_inventory) if line.product else False, "needs_receipt": line.needs_receipt,
            "sku": (line.product or line.service).sku if (line.product or line.service) else None,
            "vendor_sku": line.product.vendor_sku if line.product else None,
            "description": line.description, "quantity": line.quantity, "unit_cost": line.unit_cost,
            "discount_amount": line.discount_amount, "net_unit_cost": line.net_unit_cost, "line_total": line.line_total,
            "received": received.get(line.id, Decimal(0)), "to_receive": to_receive(order, line, received.get(line.id, Decimal(0))),
            "billed": billing[line.id]["billed"], "to_bill": billing[line.id]["to_bill"],
        } for line in order.lines]
        result["bills"] = order_bills(db, tenant_id=tenant_id, order_id=order.id)
        from app.modules.purchasing.services.vendor_return_services import receipt_returns

        result["vendor_returns"] = receipt_returns(db, tenant_id=tenant_id, order_id=order.id)
        # The same request asked of other vendors (13c §3.8).
        result["alternatives"] = [{"id": member.id, "number": member.number, "status": member.status, "vendor_name": member.vendor.org_name
                                   if member.vendor else None, "subtotal": member.subtotal, "currency": member.currency}
                                  for member in rfq_group(db, tenant_id=tenant_id, group_id=order.rfq_group_id)
                                  if member.id != order.id] if order.rfq_group_id else []
        receipts = db.query(PurchaseReceipt).options(selectinload(PurchaseReceipt.lines)).filter(PurchaseReceipt.tenant_id == tenant_id,
            PurchaseReceipt.order_id == order.id, PurchaseReceipt.deleted_at.is_(None)).order_by(PurchaseReceipt.id).all()
        result["receipts"] = [{"id": receipt.id, "number": receipt.number, "status": receipt.status, "received_on": receipt.received_on,
            "vendor_delivery_ref": receipt.vendor_delivery_ref, "total_quantity": sum((Decimal(line.quantity) for line in receipt.lines), Decimal(0))}
            for receipt in receipts]
    if include_lines:
        result["custom_fields"] = load_custom_field_values(db, tenant_id=tenant_id, module_key="purchase_orders", record_id=order.id)
    return result
