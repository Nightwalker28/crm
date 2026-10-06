"""Products and services read together: the line-item picker and each item's sales.

Both read paths answer only for the catalog modules the caller can view, and the sales list
only shows quotes and orders the caller can open. Tenant scoping is explicit in every query.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.sales.models import SalesOrder, SalesOrderItem, SalesQuote, SalesQuoteItem

SEARCH_LIMIT_MAX = 20
SALES_LINES_LIMIT = 50
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _sort_moment(value: datetime | None) -> datetime:
    """Quotes and orders merged newest first; SQLite hands back naive datetimes."""

    if value is None:
        return _EPOCH
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _option(record, *, kind: str) -> dict:
    category = getattr(record, "category", None)
    return {
        "kind": kind,
        "id": record.id,
        "name": record.name,
        "description": record.description,
        "sku": record.sku,
        "barcode": getattr(record, "barcode", None),
        "unit": record.unit or "unit",
        "currency": record.currency,
        # Lines start from the list price; the website price is the public feed's (13a C4).
        "unit_price": record.list_price if record.list_price is not None else record.public_unit_price,
        "category_name": category.full_name if category is not None else None,
    }


def _search(db: Session, model, *, tenant_id: int, query: str, currency: str | None, limit: int):
    statement = db.query(model).filter(
        model.tenant_id == tenant_id,
        model.deleted_at.is_(None),
        model.is_active == 1,
    )
    if currency:
        statement = statement.filter(model.currency == currency)
    normalized = query.strip()
    if normalized:
        pattern = f"%{normalized}%"
        columns = [model.name.ilike(pattern), model.sku.ilike(pattern)]
        if model is CatalogProduct:
            columns.append(CatalogProduct.barcode == normalized)
        statement = statement.filter(or_(*columns))
    return statement.order_by(func.lower(model.name).asc(), model.id.asc()).limit(limit).all()


def search_catalog_items(
    db: Session,
    *,
    tenant_id: int,
    query: str,
    currency: str | None,
    include_products: bool,
    include_services: bool,
    limit: int = 10,
) -> list[dict]:
    """Active items matching name, SKU or an exact barcode, products first then services.

    An exact barcode or SKU match is listed first, so a scanner (which types the code and
    presses Enter) lands on the item it scanned.
    """

    limit = max(1, min(limit, SEARCH_LIMIT_MAX))
    results: list[dict] = []
    if include_products:
        results.extend(_option(row, kind="product") for row in _search(db, CatalogProduct, tenant_id=tenant_id, query=query, currency=currency, limit=limit))
    if include_services:
        results.extend(_option(row, kind="service") for row in _search(db, CatalogService, tenant_id=tenant_id, query=query, currency=currency, limit=limit))
    code = query.strip().lower()
    if code:
        results.sort(key=lambda option: 0 if code in {(option["sku"] or "").lower(), (option["barcode"] or "").lower()} else 1)
    return results[:limit]


def _quote_lines(db: Session, *, tenant_id: int, link_column):
    return (
        db.query(SalesQuoteItem, SalesQuote)
        .join(SalesQuote, (SalesQuote.quote_id == SalesQuoteItem.quote_id) & (SalesQuote.tenant_id == SalesQuoteItem.tenant_id))
        .filter(SalesQuoteItem.tenant_id == tenant_id, link_column, SalesQuote.deleted_at.is_(None))
    )


def _order_lines(db: Session, *, tenant_id: int, link_column):
    return (
        db.query(SalesOrderItem, SalesOrder)
        .join(SalesOrder, (SalesOrder.id == SalesOrderItem.order_id) & (SalesOrder.tenant_id == SalesOrderItem.tenant_id))
        .filter(SalesOrderItem.tenant_id == tenant_id, link_column)
    )


def list_catalog_item_sales(
    db: Session,
    *,
    tenant_id: int,
    kind: str,
    item_id: int,
    include_quotes: bool,
    include_orders: bool,
) -> dict:
    """The newest quote and order lines that use one catalog item, with counts.

    `ordered_quantity` sums every non-cancelled order line: what Odoo calls *Sold*.
    """

    quote_link = SalesQuoteItem.catalog_product_id == item_id if kind == "product" else SalesQuoteItem.catalog_service_id == item_id
    order_link = SalesOrderItem.catalog_product_id == item_id if kind == "product" else SalesOrderItem.catalog_service_id == item_id

    lines: list[dict] = []
    quote_count = 0
    order_count = 0
    ordered_quantity = Decimal("0")
    if include_quotes:
        base = _quote_lines(db, tenant_id=tenant_id, link_column=quote_link)
        quote_count = base.count()
        for item, quote in base.order_by(SalesQuote.created_time.desc(), SalesQuoteItem.id.desc()).limit(SALES_LINES_LIMIT).all():
            lines.append(
                {
                    "document_type": "quote",
                    "document_id": quote.quote_id,
                    "document_number": quote.quote_number or f"Quote {quote.quote_id}",
                    "customer_name": quote.customer_name,
                    "status": quote.status,
                    "currency": quote.currency or "USD",
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "line_total": item.line_total,
                    "document_date": quote.created_time,
                }
            )
    if include_orders:
        base = _order_lines(db, tenant_id=tenant_id, link_column=order_link)
        order_count = base.count()
        ordered_quantity = (
            base.filter(SalesOrder.status != "cancelled").with_entities(func.coalesce(func.sum(SalesOrderItem.quantity), 0)).scalar()
        ) or Decimal("0")
        for item, order in base.order_by(SalesOrder.created_at.desc(), SalesOrderItem.id.desc()).limit(SALES_LINES_LIMIT).all():
            lines.append(
                {
                    "document_type": "order",
                    "document_id": order.id,
                    "document_number": order.order_number,
                    "customer_name": order.organization_name or order.contact_name,
                    "status": order.status,
                    "currency": order.currency or "USD",
                    "quantity": item.quantity,
                    "unit_price": item.unit_price,
                    "line_total": item.line_total,
                    "document_date": order.created_at,
                }
            )
    lines.sort(key=lambda line: _sort_moment(line["document_date"]), reverse=True)
    return {
        "results": lines[:SALES_LINES_LIMIT],
        "quote_line_count": quote_count,
        "order_line_count": order_count,
        "ordered_quantity": Decimal(str(ordered_quantity)),
        "can_view_quotes": include_quotes,
        "can_view_orders": include_orders,
    }
