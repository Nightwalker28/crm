from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.module_filters import apply_filter_conditions
from app.modules.platform.services.custom_fields import sync_custom_fields
from app.modules.sales.services.document_fields import carried_fields, fill_addresses_from_account, normalize_document_fields
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.catalog.services.line_links import normalize_catalog_line_links
from app.modules.finance.services import tax_rates
from app.modules.finance.services.document_amounts import document_totals, money
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryDelivery, InventoryDeliveryLine, InventoryReservation, InventoryWarehouse
from app.modules.inventory.services.delivery_services import (
    deliver_remaining, delivered_line_ids, has_live_deliveries, refresh_delivery_status,
)
from app.modules.inventory.services.stock_ledger import (
    _tracked_lines, delivered_quantity, ensure_default_warehouse, line_outstanding, release_for_order, reserve_for_order,
)
from app.modules.sales.models import SalesOrder, SalesOrderItem, SalesQuote
from app.modules.sales.repositories import quotes_repository
from app.modules.sales.services.opportunity_contacts_services import ensure_contact_on_opportunity
from app.modules.sales.services.quotes_services import get_quote_or_404


ORDER_STATUSES = {"draft", "confirmed", "fulfilled", "cancelled"}
ORDER_PRIORITIES = {"urgent", "high", "normal"}

ORDER_SORT_FIELDS = {
    "order_number": SalesOrder.order_number,
    "quote_id": SalesOrder.quote_id,
    "organization_id": SalesOrder.organization_id,
    "contact_id": SalesOrder.contact_id,
    "opportunity_id": SalesOrder.opportunity_id,
    "owner_id": SalesOrder.owner_id,
    "status": SalesOrder.status,
    "delivery_status": SalesOrder.delivery_status,
    "invoice_status": SalesOrder.invoice_status,
    "priority": SalesOrder.priority,
    "source": SalesOrder.source,
    "currency": SalesOrder.currency,
    "subtotal": SalesOrder.subtotal,
    "tax_total": SalesOrder.tax_total,
    "discount_total": SalesOrder.discount_total,
    "grand_total": SalesOrder.grand_total,
    "created_at": SalesOrder.created_at,
    "updated_at": SalesOrder.updated_at,
}


def _coerce_optional(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _coerce_decimal(value) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid amount") from exc


def _validate_status(value: str | None) -> str:
    normalized = (value or "confirmed").strip().lower()
    if normalized not in ORDER_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid order status")
    return normalized


def _generate_order_number(db: Session, *, tenant_id: int) -> str:
    return allocate_business_number(db, tenant_id=tenant_id, scope="sales_orders", prefix="SO")


def _ensure_linked_records(db: Session, data: dict, *, tenant_id: int) -> None:
    quote_id = data.get("quote_id")
    quote = None
    if quote_id is not None:
        quote = get_quote_or_404(db, quote_id, tenant_id=tenant_id)
        for field in {"contact_id", "organization_id", "opportunity_id"}:
            submitted = data.get(field)
            linked = getattr(quote, field, None)
            if submitted is not None and linked is not None and submitted != linked:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Order {field.removesuffix('_id')} must match the linked quote")
            if submitted is None and linked is not None:
                data[field] = linked
    contact_id = data.get("contact_id")
    if contact_id is not None and not quotes_repository.contact_exists(db, tenant_id=tenant_id, contact_id=contact_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact not found")
    organization_id = data.get("organization_id")
    if organization_id is not None and not quotes_repository.organization_exists(db, tenant_id=tenant_id, organization_id=organization_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization not found")
    opportunity_id = data.get("opportunity_id")
    opportunity = None
    if opportunity_id is not None:
        opportunity = quotes_repository.get_opportunity(db, tenant_id=tenant_id, opportunity_id=opportunity_id)
        if not opportunity:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Opportunity not found")
    if opportunity is not None:
        ensure_contact_on_opportunity(db, opportunity=opportunity, contact_id=contact_id, record_label="Order")
        submitted_organization = data.get("organization_id")
        if submitted_organization is not None and opportunity.organization_id is not None and submitted_organization != opportunity.organization_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order organization must match the linked opportunity")
        for field in {"contact_id", "organization_id"}:
            linked = getattr(opportunity, field, None)
            if data.get(field) is None and linked is not None:
                data[field] = linked
    owner_id = data.get("owner_id")
    if owner_id is not None and not quotes_repository.user_exists(db, tenant_id=tenant_id, user_id=owner_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner not found")


def _normalize_order_payload(db: Session, payload: dict, *, tenant_id: int, current_user, partial: bool = False, existing: SalesOrder | None = None) -> dict:
    data = dict(payload)
    normalize_document_fields(db, data, tenant_id=tenant_id, module_key="sales_orders", existing=existing)
    if "order_number" in data:
        data["order_number"] = _coerce_optional(data["order_number"])
        if not data["order_number"]:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order number is required")
    for field in {"payment_terms", "notes"}:
        if field in data:
            data[field] = _coerce_optional(data[field])
    for field in {"quote_id", "organization_id", "contact_id", "opportunity_id", "owner_id"}:
        if data.get(field) == "":
            data[field] = None
    if "priority" in data:
        priority = (data["priority"] or "normal").strip().lower()
        if priority not in ORDER_PRIORITIES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Priority must be urgent, high or normal")
        data["priority"] = priority
    if "status" in data:
        data["status"] = _validate_status(data["status"])
    elif not partial:
        data["status"] = "confirmed"
    if "currency" in data:
        data["currency"] = (_coerce_optional(data["currency"]) or "USD").upper()[:10]
    elif not partial:
        data["currency"] = "USD"
    if "exchange_rate" in data:
        from app.modules.inventory.services.costing import clean_rate

        data["exchange_rate"] = clean_rate(data["exchange_rate"])
    for field in {"subtotal", "tax_total", "discount_total", "grand_total"}:
        if field in data:
            data[field] = _coerce_decimal(data[field])
        elif not partial:
            data[field] = Decimal("0")
    if not partial:
        data["order_number"] = _coerce_optional(data.get("order_number")) or _generate_order_number(db, tenant_id=tenant_id)
        data["owner_id"] = data.get("owner_id") or (current_user.id if current_user else None)
        data["created_by_id"] = current_user.id if current_user else None
        data["warehouse_id"] = data.get("warehouse_id") or ensure_default_warehouse(db, tenant_id=tenant_id).id
    elif "warehouse_id" in data and not data["warehouse_id"]:
        data.pop("warehouse_id")
    _ensure_linked_records(db, data, tenant_id=tenant_id)
    fill_addresses_from_account(db, data, tenant_id=tenant_id, existing=existing)
    if data.get("warehouse_id"):
        warehouse = db.query(InventoryWarehouse).filter(InventoryWarehouse.id == data["warehouse_id"], InventoryWarehouse.tenant_id == tenant_id, InventoryWarehouse.deleted_at.is_(None)).first()
        if warehouse is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Warehouse not found")
        if not warehouse.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{warehouse.name} is inactive")
    return data


def _refresh_total(order: SalesOrder) -> None:
    """Lines plus the shipping charge (13b §5 decision 8)."""
    order.grand_total = money(order.subtotal) - money(order.discount_total) + money(order.tax_total) + money(order.shipping_charge)


def _tax_context(db: Session, *, tenant_id: int, organization_id: int | None, tax_mode: str, order: SalesOrder | None = None):
    resolver = tax_rates.TaxResolver(db, tenant_id=tenant_id, side="sales",
                                     exempt=tax_rates.account_is_exempt(db, tenant_id=tenant_id, organization_id=organization_id),
                                     allowed_inactive=tax_rates.used_rate_ids(order.items) if order is not None else ())
    return resolver, tax_mode == "inclusive"


def _normalize_items(db: Session, items: list[dict], *, tenant_id: int, organization_id: int | None = None, tax_mode: str = "exclusive",
                     order: SalesOrder | None = None) -> tuple[list[SalesOrderItem], dict[str, Decimal]]:
    """The submitted lines, computed through the shared line function (13d §3.1), and the
    order's line totals."""
    catalog_links = normalize_catalog_line_links(db, tenant_id=tenant_id, lines=items)
    resolver, inclusive = _tax_context(db, tenant_id=tenant_id, organization_id=organization_id, tax_mode=tax_mode, order=order)
    lines, amounts = [], []
    for index, item in enumerate(items):
        line, line_amounts = _normalize_item_payload(item, tenant_id=tenant_id, sort_order=index, catalog_link=catalog_links[index],
                                                     resolver=resolver, inclusive=inclusive)
        lines.append(line)
        amounts.append(line_amounts)
    totals = document_totals(amounts)
    return lines, {"subtotal": totals["subtotal"], "discount_total": totals["discount"], "tax_total": totals["tax"], "grand_total": totals["total"]}


def _apply_items(db: Session, order: SalesOrder, items: list[dict], *, organization_id: int | None, tax_mode: str) -> tuple[list[SalesOrderItem], list[int], dict[str, Decimal]]:
    """Merge submitted lines into the order: a line with an `id` is updated in place, so it
    keeps its identity (stock holds and movements point at it); the rest are new.

    Returns the order's new lines, the IDs of the lines that were removed, and the totals.
    """
    existing = {line.id: line for line in order.items}
    normalized, totals = _normalize_items(db, items, tenant_id=order.tenant_id, organization_id=organization_id, tax_mode=tax_mode, order=order)
    result: list[SalesOrderItem] = []
    kept: set[int] = set()
    for payload, fresh in zip(items, normalized):
        line_id = payload.get("id")
        if not line_id:
            result.append(fresh)
            continue
        line = existing.get(line_id)
        if line is None or line_id in kept:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order line not found")
        kept.add(line_id)
        if line.line_type != fresh.line_type:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A line cannot change between an item, a section and a note")
        for field in ("catalog_product_id", "catalog_service_id", "name", "description", "quantity", "unit_price", "discount_amount",
                      "discount_percent", "unit", "tax_amount", "tax_rate_id", "tax_manual", "line_total", "sort_order"):
            setattr(line, field, getattr(fresh, field))
        result.append(line)
    return result, [line_id for line_id in existing if line_id not in kept], totals


def _existing_item_payload(item: SalesOrderItem) -> dict:
    return {"id": item.id, "catalog_product_id": item.catalog_product_id, "catalog_service_id": item.catalog_service_id, "name": item.name,
            "description": item.description, "quantity": item.quantity, "unit_price": item.unit_price,
            "discount_amount": item.discount_amount, **tax_rates.line_payload(item)}


def _normalize_item_payload(item: dict, *, tenant_id: int, sort_order: int, catalog_link: dict[str, int | None], resolver, inclusive: bool):
    name = _coerce_optional(item.get("name"))
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order item name is required")
    quantity = _coerce_decimal(item.get("quantity", "1"))
    unit_price = _coerce_decimal(item.get("unit_price"))
    discount = _coerce_decimal(item.get("discount_amount"))
    is_item = (item.get("line_type") or "item") == "item"
    if is_item and quantity <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order item quantity must be greater than zero")
    if is_item and min(unit_price, discount, _coerce_decimal(item.get("tax_amount"))) < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order item amounts cannot be negative")
    line = tax_rates.compute_sales_line(resolver, item, catalog_link, quantity=quantity, unit_price=unit_price, discount=discount,
                                        inclusive=inclusive, label=name)
    links = catalog_link if line.line_type == "item" else {key: None for key in catalog_link}
    return SalesOrderItem(
        tenant_id=tenant_id,
        **links,
        name=name,
        description=_coerce_optional(item.get("description")) if line.line_type == "item" else None,
        **tax_rates.sales_line_fields(line),
        sort_order=sort_order,
    ), line.amounts

def _waiting_for_stock_expression():
    """A confirmed order with a stocked line that needs more than is delivered and held."""
    delivered = (
        select(func.coalesce(func.sum(InventoryDeliveryLine.quantity), 0))
        .join(InventoryDelivery, InventoryDelivery.id == InventoryDeliveryLine.delivery_id)
        .where(InventoryDeliveryLine.order_line_id == SalesOrderItem.id, InventoryDelivery.status == "posted")
        .scalar_subquery()
    )
    held = (
        select(func.coalesce(func.sum(InventoryReservation.quantity), 0))
        .where(InventoryReservation.order_line_id == SalesOrderItem.id)
        .scalar_subquery()
    )
    waiting_line = (
        select(SalesOrderItem.id)
        .join(CatalogProduct, and_(CatalogProduct.id == SalesOrderItem.catalog_product_id, CatalogProduct.tenant_id == SalesOrderItem.tenant_id))
        .where(SalesOrderItem.order_id == SalesOrder.id, CatalogProduct.track_inventory == 1, CatalogProduct.deleted_at.is_(None),
               SalesOrderItem.quantity > delivered + held)
        .exists()
    )
    return and_(SalesOrder.status == "confirmed", SalesOrder.remaining_closed_at.is_(None), waiting_line)


def build_orders_query(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    query = db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id)
    field_map = {
        "order_number": {"expression": SalesOrder.order_number, "type": "text"},
        "quote_id": {"expression": SalesOrder.quote_id, "type": "number"},
        "organization_id": {"expression": SalesOrder.organization_id, "type": "number"},
        "contact_id": {"expression": SalesOrder.contact_id, "type": "number"},
        "opportunity_id": {"expression": SalesOrder.opportunity_id, "type": "number"},
        "owner_id": {"expression": SalesOrder.owner_id, "type": "number"},
        "status": {"expression": SalesOrder.status, "type": "text"},
        "currency": {"expression": SalesOrder.currency, "type": "text"},
        "grand_total": {"expression": SalesOrder.grand_total, "type": "number"},
        "created_at": {"expression": SalesOrder.created_at, "type": "date"},
        "updated_at": {"expression": SalesOrder.updated_at, "type": "date"},
        "delivery_status": {"expression": SalesOrder.delivery_status, "type": "text"},
        "invoice_status": {"expression": SalesOrder.invoice_status, "type": "text"},
        "priority": {"expression": SalesOrder.priority, "type": "text"},
        "source": {"expression": SalesOrder.source, "type": "text"},
        "channel": {"expression": SalesOrder.channel, "type": "text"},
        "external_reference": {"expression": SalesOrder.external_reference, "type": "text"},
        "waiting_for_stock": {"expression": _waiting_for_stock_expression(), "type": "boolean"},
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.outerjoin(SalesQuote, SalesQuote.quote_id == SalesOrder.quote_id).filter(
            or_(
                func.lower(SalesOrder.order_number).like(pattern),
                func.lower(SalesOrder.status).like(pattern),
                func.lower(func.coalesce(SalesOrder.external_reference, "")).like(pattern),
                func.lower(func.coalesce(SalesQuote.customer_name, "")).like(pattern),
                func.lower(func.coalesce(SalesQuote.quote_number, "")).like(pattern),
            )
        )
    return query


def apply_order_sort(query, *, sort_by: str | None = None, sort_direction: str | None = None):
    sort_column = ORDER_SORT_FIELDS.get((sort_by or "").strip())
    if sort_column is None:
        return query.order_by(None).order_by(SalesOrder.created_at.desc(), SalesOrder.id.desc())

    direction = (sort_direction or "asc").strip().lower()
    ordered = sort_column.desc() if direction == "desc" else sort_column.asc()
    return query.order_by(None).order_by(ordered.nullslast(), SalesOrder.id.desc())


def list_sales_orders(
    db: Session,
    *,
    tenant_id: int,
    pagination,
    search: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[Sequence[SalesOrder], int]:
    query = build_orders_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    orders = (
        apply_order_sort(query, sort_by=sort_by, sort_direction=sort_direction)
        .offset(pagination.offset)
        .limit(pagination.limit)
        .all()
    )
    return orders, total_count


def get_order_or_404(db: Session, *, tenant_id: int, order_id: int) -> SalesOrder:
    order = (
        db.query(SalesOrder)
        .options(selectinload(SalesOrder.items))
        .filter(SalesOrder.id == order_id, SalesOrder.tenant_id == tenant_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return order


def get_order_by_quote(db: Session, *, tenant_id: int, quote_id: int) -> SalesOrder | None:
    return db.query(SalesOrder).filter(SalesOrder.tenant_id == tenant_id, SalesOrder.quote_id == quote_id).first()


def create_sales_order(db: Session, payload: dict, current_user) -> SalesOrder:
    items_payload = payload.pop("items", []) or []
    # Quote conversion, the portal and website orders send none: required custom fields bind
    # the order form only (13b §5 decision 9).
    custom_payload = {"custom_fields": payload.pop("custom_fields")} if "custom_fields" in payload else {}
    data = _normalize_order_payload(db, payload, tenant_id=current_user.tenant_id, current_user=current_user)
    data["tax_mode"] = tax_rates.normalize_tax_mode(data.get("tax_mode"), default=tax_rates.default_tax_mode(db, tenant_id=current_user.tenant_id))
    if not data.get("quote_id"):
        # A converted order carries its quote's texts; a new one starts with the defaults (13d §3.3).
        from app.modules.sales.services.quotes_services import _apply_default_texts

        _apply_default_texts(db, data, tenant_id=current_user.tenant_id, kind="sales_order")
    normalized_items, item_totals = _normalize_items(db, items_payload, tenant_id=current_user.tenant_id,
                                                     organization_id=data.get("organization_id"), tax_mode=data["tax_mode"])
    if normalized_items:
        data.update(item_totals)
    order = SalesOrder(tenant_id=current_user.tenant_id, **data)
    order.items = normalized_items
    _refresh_total(order)
    db.add(order)
    try:
        db.flush()
        actor_user_id = current_user.id if current_user else None
        if order.status == "fulfilled":
            deliver_remaining(db, tenant_id=order.tenant_id, actor_user_id=actor_user_id, order=order)
        reserve_for_order(db, tenant_id=order.tenant_id, order=order, actor_user_id=actor_user_id)
        refresh_delivery_status(db, order=order)
        sync_custom_fields(db, tenant_id=order.tenant_id, module_key="sales_orders", record=order, payload=custom_payload,
                           created=True, enforce_required=bool(custom_payload))
        # The caller commits (13a E5): the route's unit of work, quote conversion, the portal.
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order could not be created") from exc
    db.refresh(order)
    return get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order.id)


def convert_quote_to_order(db: Session, quote: SalesQuote, current_user, *, allow_duplicate: bool = False) -> SalesOrder:
    if quote.status != "accepted":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only accepted quotes can be converted to orders")
    existing = get_order_by_quote(db, tenant_id=quote.tenant_id, quote_id=quote.quote_id)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Quote has already been converted to an order")
    if allow_duplicate:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate quote conversion is not enabled")
    payload = {
        "quote_id": quote.quote_id,
        "organization_id": quote.organization_id,
        "contact_id": quote.contact_id,
        "opportunity_id": quote.opportunity_id,
        "status": "confirmed",
        "currency": quote.currency,
        "subtotal": quote.subtotal_amount,
        "tax_total": quote.tax_amount,
        "discount_total": quote.discount_amount,
        "grand_total": quote.total_amount,
        "tax_mode": quote.tax_mode,
        **carried_fields(quote),
        "owner_id": quote.assigned_to or (current_user.id if current_user else None),
        "items": [
            {
                "catalog_product_id": item.catalog_product_id,
                "catalog_service_id": item.catalog_service_id,
                "name": item.name,
                "description": item.description,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "discount_amount": item.discount_amount,
                "discount_percent": item.discount_percent,
                "unit": item.unit,
                "line_type": item.line_type,
                "tax_amount": item.tax_amount,
                # The quote's tax as computed, not the item's rate today (13d §3.1).
                "tax_rate_id": item.tax_rate_id,
                "tax_manual": True,
                "line_total": item.line_total,
                "sort_order": item.sort_order,
            }
            # Optional lines the customer did not take stay on the quote (13d §3.2).
            for item in quote.items if not item.is_optional
        ] if quote.items else [
            {
                "name": quote.title or f"Quote {quote.quote_number}",
                "description": quote.notes,
                "quantity": Decimal("1"),
                "unit_price": quote.subtotal_amount,
                "discount_amount": quote.discount_amount,
                "tax_amount": quote.tax_amount,
                "tax_manual": True,
                "line_total": quote.total_amount,
                "sort_order": 0,
            }
        ],
    }
    return create_sales_order(db, payload, current_user)


def update_sales_order(db: Session, order: SalesOrder, payload: dict, *, actor_user_id: int | None = None) -> SalesOrder:
    custom_payload = {"custom_fields": payload.pop("custom_fields")} if "custom_fields" in payload else {}
    previous_status = order.status
    next_status = payload.get("status", previous_status)
    if previous_status == "cancelled" and next_status != "cancelled":
        raise HTTPException(status_code=409, detail="A cancelled order cannot be reopened")
    if previous_status == "fulfilled" and next_status not in {"fulfilled", "cancelled"}:
        raise HTTPException(status_code=409, detail="A fulfilled order can only be cancelled; to ship more, cancel one of its deliveries")
    if previous_status == "fulfilled" and payload.get("items") is not None:
        raise HTTPException(status_code=409, detail="Fulfilled order lines cannot be edited")
    shipped = has_live_deliveries(db, tenant_id=order.tenant_id, order_id=order.id, posted_only=True)
    if next_status == "cancelled" and previous_status != "cancelled" and shipped:
        raise HTTPException(status_code=409, detail="This order has posted deliveries; cancel them or return the goods before cancelling the order")
    if next_status == "draft" and previous_status != "draft" and shipped:
        raise HTTPException(status_code=409, detail="A partly delivered order cannot go back to draft")
    from app.modules.finance.services import invoicing_services

    if next_status == "cancelled" and previous_status != "cancelled":
        invoicing_services.guard_order_cancel(db, order=order)
    invoiced_lines = invoicing_services.invoiced_line_quantities(db, order=order)
    if next_status == "draft" and previous_status != "draft" and any(quantity > 0 for quantity in invoiced_lines.values()):
        raise HTTPException(status_code=409, detail="An invoiced order cannot go back to draft")
    if payload.get("warehouse_id") and payload["warehouse_id"] != order.warehouse_id and has_live_deliveries(db, tenant_id=order.tenant_id, order_id=order.id):
        raise HTTPException(status_code=409, detail="The warehouse cannot change once the order has deliveries")
    items_payload = payload.pop("items", None)
    data = _normalize_order_payload(db, payload, tenant_id=order.tenant_id, current_user=None, partial=True, existing=order)
    if "tax_mode" in data:
        data["tax_mode"] = tax_rates.normalize_tax_mode(data["tax_mode"], default=order.tax_mode)
        if items_payload is None and data["tax_mode"] != order.tax_mode and order.items:
            # The lines are recomputed in the new mode (13d §3.1).
            items_payload = [_existing_item_payload(item) for item in order.items]
    normalized_items = None
    removed_line_ids: list[int] = []
    if items_payload is not None:
        products_before = {line.id: line.catalog_product_id for line in order.items}
        history = delivered_line_ids(db, tenant_id=order.tenant_id, line_ids=products_before)
        normalized_items, removed_line_ids, item_totals = _apply_items(
            db, order, items_payload, organization_id=data["organization_id"] if "organization_id" in data else order.organization_id,
            tax_mode=data.get("tax_mode") or order.tax_mode)
        # A line a delivery points at is history: it keeps its product and cannot go.
        if history & set(removed_line_ids):
            raise HTTPException(status_code=409, detail="A line that has been on a delivery cannot be removed")
        # A line an invoice points at is billed history too (12c §3.3).
        on_invoices = invoicing_services.invoice_line_links(db, order=order)
        if on_invoices & set(removed_line_ids):
            raise HTTPException(status_code=409, detail="A line that is on an invoice cannot be removed")
        for line in normalized_items:
            if line.id in on_invoices and line.catalog_product_id != products_before.get(line.id):
                raise HTTPException(status_code=409, detail=f"{line.name} is on an invoice, so its product cannot change")
            if Decimal(line.quantity) < invoiced_lines.get(line.id, Decimal(0)):
                raise HTTPException(status_code=409, detail=f"{line.name}: {invoiced_lines[line.id].normalize():f} already invoiced, so the quantity cannot be lower")
            if line.id in history:
                if line.catalog_product_id != products_before[line.id]:
                    raise HTTPException(status_code=409, detail=f"{line.name} has been on a delivery, so its product cannot change")
                delivered = delivered_quantity(db, line)
                if Decimal(line.quantity) < delivered:
                    raise HTTPException(status_code=409, detail=f"{line.name}: {delivered.normalize():f} already delivered, so the quantity cannot be lower")
        data.update(item_totals)
    # Holds on removed lines go before the lines do, so the cached totals stay in step.
    release_for_order(db, tenant_id=order.tenant_id, order=order, line_ids=removed_line_ids, actor_user_id=actor_user_id)
    for field, value in data.items():
        setattr(order, field, value)
    if normalized_items is not None:
        order.items = normalized_items
    _refresh_total(order)
    db.add(order)
    try:
        db.flush()
        if previous_status != "fulfilled" and order.status == "fulfilled":
            # The one-click path: everything left ships now, through a delivery.
            deliver_remaining(db, tenant_id=order.tenant_id, actor_user_id=actor_user_id, order=order)
        # Confirmed: hold what each line needs. Draft, fulfilled or cancelled: release everything.
        reserve_for_order(db, tenant_id=order.tenant_id, order=order, actor_user_id=actor_user_id)
        refresh_delivery_status(db, order=order)
        sync_custom_fields(db, tenant_id=order.tenant_id, module_key="sales_orders", record=order, payload=custom_payload, created=False)
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order could not be updated") from exc
    db.refresh(order)
    return get_order_or_404(db, tenant_id=order.tenant_id, order_id=order.id)


def order_needs_delivery(db: Session, order: SalesOrder) -> bool:
    """Whether marking the order fulfilled would ship stock (and so needs delivery access)."""
    return any(line_outstanding(db, line, order) > 0 for line in _tracked_lines(db, order))
