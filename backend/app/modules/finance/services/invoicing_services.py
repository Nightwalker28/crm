"""Invoicing sales orders (12c-erp-invoicing.md §3.2–3.3).

Per order line: what can be invoiced (ordered, or delivered less returned for tracked
products under the *delivered* policy), what issued invoices already cover, and what is
left. `invoicing_lines` is the single place those quantities are computed; a policy such as
"a credit note reopens the quantity" would change it here only (12c §5a).

Every invoice line names its own order line, so an invoice over several orders later is a
change to `draft_from_sources`' limit, not to the data.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.finance.models import FinancePosInvoice, FinancePosInvoiceLine
from app.modules.finance.services.document_amounts import ZERO, money, pro_rata, units
from app.modules.inventory.models import InventoryDelivery, InventoryDeliveryLine
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.models import SalesOrder, SalesOrderItem

POLICIES = {"delivered", "ordered"}
INVOICEABLE_ORDER_STATUSES = {"confirmed", "fulfilled"}


def invoicing_policy(db: Session, *, tenant_id: int) -> str:
    from app.modules.user_management.models import CompanyProfile

    value = db.query(CompanyProfile.invoicing_policy).filter(CompanyProfile.tenant_id == tenant_id).scalar()
    return value if value in POLICIES else "delivered"


def log_order_activity(db: Session, *, order: SalesOrder, actor_user_id: int | None, action: str, description: str) -> None:
    log_activity(db, tenant_id=order.tenant_id, actor_user_id=actor_user_id, module_key="sales_orders", entity_type="sales_order",
        entity_id=order.id, action=action, description=description, commit=False)


def _invoice_line_sums(db: Session, *, tenant_id: int, item_ids, statuses, exclude_invoice_id: int | None = None, by=FinancePosInvoiceLine.sales_order_item_id):
    """{key: (quantity, discount, tax)} over invoice lines of invoices in `statuses`."""
    item_ids = [item_id for item_id in item_ids if item_id is not None]
    if not item_ids:
        return {}
    query = db.query(by, func.sum(FinancePosInvoiceLine.quantity), func.sum(FinancePosInvoiceLine.discount_amount),
                     func.sum(FinancePosInvoiceLine.tax_amount)).join(
        FinancePosInvoice, FinancePosInvoice.id == FinancePosInvoiceLine.invoice_id).filter(
        FinancePosInvoice.tenant_id == tenant_id, FinancePosInvoice.deleted_at.is_(None), FinancePosInvoice.status.in_(list(statuses)),
        by.in_(item_ids))
    if exclude_invoice_id is not None:
        query = query.filter(FinancePosInvoice.id != exclude_invoice_id)
    return {key: (Decimal(qty or 0), Decimal(disc or 0), Decimal(tax or 0)) for key, qty, disc, tax in query.group_by(by)}


def invoicing_lines(db: Session, *, order: SalesOrder, policy: str | None = None, exclude_invoice_id: int | None = None) -> list[dict]:
    """Per order line: ordered, basis, delivered, returned, invoiceable, final, invoiced,
    on drafts, to invoice. `final` is what the line will come to once delivery is done."""
    from app.modules.inventory.services.return_services import returned_for_order_line
    from app.modules.inventory.services.stock_ledger import _tracked_lines, delivered_quantity

    policy = policy or invoicing_policy(db, tenant_id=order.tenant_id)
    tracked = {line.id for line in _tracked_lines(db, order)}
    item_ids = [item.id for item in order.items]
    issued = _invoice_line_sums(db, tenant_id=order.tenant_id, item_ids=item_ids, statuses=["issued"], exclude_invoice_id=exclude_invoice_id)
    drafts = _invoice_line_sums(db, tenant_id=order.tenant_id, item_ids=item_ids, statuses=["draft"], exclude_invoice_id=exclude_invoice_id)
    closed = order.remaining_closed_at is not None
    open_order = order.status in INVOICEABLE_ORDER_STATUSES
    result = []
    for item in sorted(order.items, key=lambda row: (row.sort_order or 0, row.id or 0)):
        ordered = Decimal(item.quantity or 0)
        is_tracked = item.id in tracked
        delivered = delivered_quantity(db, item) if is_tracked else ZERO
        returned = returned_for_order_line(db, item) if is_tracked else ZERO
        if is_tracked and policy == "delivered":
            basis = "delivered"
            invoiceable = max(delivered - returned, ZERO)
            done = closed or order.delivery_status in {"delivered", "closed"} or order.status == "fulfilled"
            final = invoiceable if done else ordered
        else:
            basis = "ordered"
            invoiceable = min(ordered, delivered) if (is_tracked and closed) else ordered
            final = invoiceable
        if not open_order:
            invoiceable = ZERO
        invoiced = issued.get(item.id, (ZERO, ZERO, ZERO))[0]
        on_drafts = drafts.get(item.id, (ZERO, ZERO, ZERO))[0]
        result.append({
            "order_line_id": item.id, "name": item.name, "catalog_product_id": item.catalog_product_id,
            "catalog_service_id": item.catalog_service_id, "tracked": is_tracked, "basis": basis,
            "ordered": ordered, "delivered": delivered, "returned": returned, "invoiceable": invoiceable,
            "final": final, "invoiced": invoiced, "on_drafts": on_drafts,
            "to_invoice": max(invoiceable - invoiced, ZERO), "unit_price": Decimal(item.unit_price or 0),
            "issued_discount": issued.get(item.id, (ZERO, ZERO, ZERO))[1], "issued_tax": issued.get(item.id, (ZERO, ZERO, ZERO))[2],
        })
    return result


def refresh_invoice_status(db: Session, *, order: SalesOrder, policy: str | None = None) -> str:
    lines = invoicing_lines(db, order=order, policy=policy)
    invoiced_any = any(line["invoiced"] > 0 for line in lines)
    if not lines or (order.status not in INVOICEABLE_ORDER_STATUSES and not invoiced_any):
        value = "none"
    elif any(line["to_invoice"] > 0 for line in lines):
        value = "to_invoice"
    elif any(line["final"] > 0 for line in lines) and all(line["invoiced"] >= line["final"] for line in lines):
        value = "invoiced"
    elif invoiced_any:
        value = "partial"
    elif all(line["final"] <= 0 for line in lines):
        value = "none"
    else:
        value = "pending"
    order.invoice_status = value
    db.add(order)
    return value


def refresh_for_order_id(db: Session, *, tenant_id: int, order_id: int | None) -> None:
    """For callers outside finance (deliveries, returns, the order itself)."""
    if not order_id:
        return
    order = db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id, SalesOrder.id == order_id).first()
    if order is not None:
        refresh_invoice_status(db, order=order)


def recompute_tenant(db: Session, *, tenant_id: int) -> int:
    """After the policy changes: every order's cached status, under the new policy."""
    policy = invoicing_policy(db, tenant_id=tenant_id)
    count = 0
    for order in db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id).yield_per(200):
        refresh_invoice_status(db, order=order, policy=policy)
        count += 1
    return count


def orders_of(db: Session, *, invoice: FinancePosInvoice, lock: bool = False) -> list[SalesOrder]:
    item_ids = {line.sales_order_item_id for line in invoice.lines if line.sales_order_item_id}
    order_ids = set()
    if item_ids:
        order_ids |= {row[0] for row in db.query(SalesOrderItem.order_id).filter(
            SalesOrderItem.tenant_id == invoice.tenant_id, SalesOrderItem.id.in_(item_ids))}
    if invoice.sales_order_id:
        order_ids.add(invoice.sales_order_id)
    if not order_ids:
        return []
    query = db.query(SalesOrder).filter(SalesOrder.tenant_id == invoice.tenant_id, SalesOrder.id.in_(sorted(order_ids))).order_by(SalesOrder.id)
    return (query.with_for_update() if lock else query).all()


def check_order_lines(db: Session, *, invoice: FinancePosInvoice, issuing: bool) -> list[SalesOrder]:
    """Order-linked lines may not exceed what is left to invoice. At issue the orders are
    locked first, so two invoices cannot both take the same remainder."""
    orders = orders_of(db, invoice=invoice, lock=issuing)
    if not orders:
        return []
    requested: dict[int, Decimal] = defaultdict(Decimal)
    for line in invoice.lines:
        if line.sales_order_item_id:
            requested[line.sales_order_item_id] += Decimal(line.quantity)
    available: dict[int, dict] = {}
    for order in orders:
        if issuing and order.status not in INVOICEABLE_ORDER_STATUSES:
            raise HTTPException(status_code=409, detail=f"Order {order.order_number} is {order.status}; only a confirmed or fulfilled order can be invoiced")
        for row in invoicing_lines(db, order=order, exclude_invoice_id=invoice.id):
            available[row["order_line_id"]] = row
    for item_id, quantity in requested.items():
        row = available.get(item_id)
        if row is None:
            raise HTTPException(status_code=400, detail="An invoice line points at an order line that no longer exists")
        left = max(row["invoiceable"] - row["invoiced"], ZERO)
        if quantity > left:
            what = "delivered and not yet invoiced" if row["basis"] == "delivered" else "left to invoice"
            raise HTTPException(status_code=409, detail=f"{row['name']}: only {units(left)} {what}")
    return orders


def _order_or_404(db: Session, *, tenant_id: int, order_id: int) -> SalesOrder:
    order = db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id, SalesOrder.id == order_id).first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


def _customer_payload(order: SalesOrder) -> dict:
    organization, contact = order.organization, order.contact
    contact_name = " ".join(part for part in ((contact.first_name, contact.last_name) if contact else ()) if part).strip() or None
    address = None
    if organization is not None:
        address = "\n".join(part for part in (organization.billing_address, organization.billing_city, organization.billing_state,
            organization.billing_postal_code, organization.billing_country) if part) or None
    return {
        "customer_name": (organization.org_name if organization else None) or contact_name or (contact.primary_email if contact else None)
                         or f"Order {order.order_number}",
        "customer_email": (contact.primary_email if contact else None) or (organization.primary_email if organization else None),
        "customer_address": order.delivery_address if address is None else address,
        "customer_contact_id": order.contact_id,
        "customer_organization_id": order.organization_id,
    }


def _line_amounts_for(row: dict, item: SalesOrderItem, quantity: Decimal) -> tuple[Decimal, Decimal]:
    """The order line's discount and tax for `quantity`, pro rata; the invoice that completes
    the line takes what is left, so rounding never drifts from the order's figures."""
    ordered = Decimal(item.quantity or 0)
    if row["invoiced"] + quantity >= ordered:
        return (max(money(item.discount_amount) - money(row["issued_discount"]), ZERO),
                max(money(item.tax_amount) - money(row["issued_tax"]), ZERO))
    return pro_rata(item.discount_amount or 0, quantity, ordered), pro_rata(item.tax_amount or 0, quantity, ordered)


def _guard_website_invoice(db: Session, *, order: SalesOrder) -> None:
    """A website order invoiced on its own before it became this sales order already billed
    the customer; invoicing the order too would bill them twice (13a A3)."""
    from app.modules.website_integrations.models import WebsiteIntegrationOrder

    earlier = (
        db.query(FinancePosInvoice.invoice_number)
        .join(WebsiteIntegrationOrder, WebsiteIntegrationOrder.pos_invoice_id == FinancePosInvoice.id)
        .filter(
            WebsiteIntegrationOrder.tenant_id == order.tenant_id,
            WebsiteIntegrationOrder.sales_order_id == order.id,
            FinancePosInvoice.tenant_id == order.tenant_id,
            or_(FinancePosInvoice.sales_order_id.is_(None), FinancePosInvoice.sales_order_id != order.id),
            FinancePosInvoice.status != "void",
            FinancePosInvoice.deleted_at.is_(None),
        )
        .first()
    )
    if earlier is not None:
        raise HTTPException(status_code=409, detail=f"This order was already invoiced from its website order as "
                            f"{earlier[0] or 'a draft invoice'}; void that invoice before invoicing the order")


def draft_from_sources(db: Session, current_user, *, sources: list[dict]) -> FinancePosInvoice:
    """A draft invoice with what is left to invoice. Each source is an order, or an order's
    delivery. E5 takes one source; the lines already carry their own order lines."""
    from app.modules.finance.services import pos_invoice_services

    if len(sources) != 1:
        raise HTTPException(status_code=400, detail="Invoice one order or one delivery at a time")
    source = sources[0]
    tenant_id = current_user.tenant_id
    order = _order_or_404(db, tenant_id=tenant_id, order_id=int(source["order_id"]))
    if order.status not in INVOICEABLE_ORDER_STATUSES:
        raise HTTPException(status_code=409, detail="Only a confirmed or fulfilled order can be invoiced")
    _guard_website_invoice(db, order=order)
    rows = {row["order_line_id"]: row for row in invoicing_lines(db, order=order)}
    items = {item.id: item for item in order.items}
    wanted: list[tuple[SalesOrderItem, Decimal, int | None]] = []
    delivery_id = source.get("delivery_id")
    if delivery_id:
        delivery = db.query(InventoryDelivery).filter(InventoryDelivery.tenant_id == tenant_id, InventoryDelivery.id == int(delivery_id),
            InventoryDelivery.order_id == order.id, InventoryDelivery.deleted_at.is_(None)).first()
        if delivery is None:
            raise HTTPException(status_code=404, detail="Delivery not found")
        if delivery.status != "posted":
            raise HTTPException(status_code=409, detail="Only a posted delivery can be invoiced")
        delivery_lines = db.query(InventoryDeliveryLine).filter(InventoryDeliveryLine.tenant_id == tenant_id,
            InventoryDeliveryLine.delivery_id == delivery.id).order_by(InventoryDeliveryLine.id).all()
        on_delivery = _invoice_line_sums(db, tenant_id=tenant_id, item_ids=[line.id for line in delivery_lines],
            statuses=["issued", "draft"], by=FinancePosInvoiceLine.delivery_line_id)
        left_by_item = {item_id: max(row["to_invoice"] - row["on_drafts"], ZERO) for item_id, row in rows.items()}
        for line in delivery_lines:
            item = items.get(line.order_line_id)
            if item is None:
                continue
            quantity = min(Decimal(line.quantity) - on_delivery.get(line.id, (ZERO,))[0], left_by_item.get(item.id, ZERO))
            if quantity > 0:
                left_by_item[item.id] -= quantity
                wanted.append((item, quantity, line.id))
    else:
        for item_id, row in rows.items():
            quantity = max(row["to_invoice"] - row["on_drafts"], ZERO)
            if quantity > 0:
                wanted.append((items[item_id], quantity, None))
    if not wanted:
        pending_drafts = any(row["on_drafts"] > 0 for row in rows.values())
        raise HTTPException(status_code=409, detail="Everything invoiceable is already on a draft invoice; open it from the order"
                            if pending_drafts else "Nothing is left to invoice on this order yet")
    lines = []
    for item, quantity, _delivery_line_id in wanted:
        discount, tax = _line_amounts_for(rows[item.id], item, quantity)
        lines.append({"description": item.name, "quantity": quantity, "unit_price": item.unit_price or 0, "discount_amount": discount,
                      "tax_amount": tax, "catalog_product_id": item.catalog_product_id, "catalog_service_id": item.catalog_service_id})
    payload = {**_customer_payload(order), "currency": order.currency, "payment_terms": order.payment_terms,
               "source": "sales_order", "notes": None, "lines": lines}
    invoice = pos_invoice_services.create_invoice(db, current_user, payload, commit=False)
    for invoice_line, (item, _quantity, delivery_line_id) in zip(invoice.lines, wanted):
        invoice_line.sales_order_item_id = item.id
        invoice_line.delivery_line_id = delivery_line_id
    invoice.sales_order_id = order.id
    db.add(invoice)
    db.flush()
    check_order_lines(db, invoice=invoice, issuing=False)
    log_order_activity(db, order=order, actor_user_id=current_user.id, action="sales_order.invoice_drafted",
        description=f"Drafted an invoice for {len(lines)} line{'s' if len(lines) != 1 else ''}")
    db.commit()
    db.refresh(invoice)
    return invoice


def order_invoicing_summary(db: Session, *, order: SalesOrder) -> dict:
    """The order's *Invoicing* tab: lines with their quantities, and its invoices."""
    lines = invoicing_lines(db, order=order)
    item_ids = [item.id for item in order.items]
    invoice_ids = {row[0] for row in db.query(FinancePosInvoiceLine.invoice_id).filter(FinancePosInvoiceLine.sales_order_item_id.in_(item_ids or [0]))}
    invoices = db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == order.tenant_id, FinancePosInvoice.deleted_at.is_(None),
        (FinancePosInvoice.sales_order_id == order.id) | FinancePosInvoice.id.in_(invoice_ids or {0})).order_by(FinancePosInvoice.id).all()
    return {
        "order_id": order.id, "status": order.status, "invoice_status": order.invoice_status, "currency": order.currency,
        "policy": invoicing_policy(db, tenant_id=order.tenant_id),
        "lines": [{key: value for key, value in row.items() if key not in {"issued_discount", "issued_tax"}} for row in lines],
        "invoices": [{"id": invoice.id, "invoice_number": invoice.invoice_number, "status": invoice.status,
                      "payment_status": invoice.payment_status, "issue_date": invoice.issue_date, "due_date": invoice.due_date,
                      "total_amount": invoice.total_amount, "balance_due": invoice.balance_due, "currency": invoice.currency}
                     for invoice in invoices],
    }


def guard_order_cancel(db: Session, *, order: SalesOrder) -> None:
    """An order whose issued invoices are not fully credited cannot be cancelled (12c §3.3)."""
    item_ids = [item.id for item in order.items]
    query = db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == order.tenant_id, FinancePosInvoice.deleted_at.is_(None),
        FinancePosInvoice.status == "issued")
    linked = query.filter((FinancePosInvoice.sales_order_id == order.id) | FinancePosInvoice.id.in_(
        db.query(FinancePosInvoiceLine.invoice_id).filter(FinancePosInvoiceLine.sales_order_item_id.in_(item_ids or [0])))).all()
    open_invoices = [invoice for invoice in linked if money(invoice.amount_credited) < money(invoice.total_amount)]
    if open_invoices:
        numbers = ", ".join(invoice.invoice_number or "draft" for invoice in open_invoices[:3])
        raise HTTPException(status_code=409, detail=f"This order has issued invoices ({numbers}); credit them in full before cancelling the order")


def guard_delivery_cancel(db: Session, *, order: SalesOrder, delivery: InventoryDelivery) -> None:
    """Under the *delivered* policy, goods an issued invoice charged for cannot be un-shipped."""
    rows = {row["order_line_id"]: row for row in invoicing_lines(db, order=order)}
    for line in db.query(InventoryDeliveryLine).filter(InventoryDeliveryLine.delivery_id == delivery.id):
        row = rows.get(line.order_line_id)
        if row and row["basis"] == "delivered" and row["invoiced"] > row["invoiceable"] - Decimal(line.quantity):
            raise HTTPException(status_code=409, detail=f"{row['name']}: an issued invoice charges for these goods; void it before cancelling the delivery")


def invoiced_line_quantities(db: Session, *, order: SalesOrder) -> dict[int, Decimal]:
    """Issued quantities per order line."""
    sums = _invoice_line_sums(db, tenant_id=order.tenant_id, item_ids=[item.id for item in order.items], statuses=["issued"])
    return {item_id: values[0] for item_id, values in sums.items()}


def invoice_line_links(db: Session, *, order: SalesOrder) -> set[int]:
    """Order lines any draft or issued invoice line points at."""
    sums = _invoice_line_sums(db, tenant_id=order.tenant_id, item_ids=[item.id for item in order.items], statuses=["draft", "issued"])
    return set(sums)
