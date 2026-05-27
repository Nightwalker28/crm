from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.module_filters import apply_filter_conditions
from app.modules.sales.models import SalesOrder, SalesOrderItem, SalesQuote
from app.modules.sales.repositories import quotes_repository
from app.modules.sales.services.quotes_services import get_quote_or_404


ORDER_STATUSES = {"draft", "confirmed", "fulfilled", "cancelled"}


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
    prefix = f"SO-{datetime.utcnow():%Y%m%d}"
    count = (
        db.query(SalesOrder.id)
        .filter(SalesOrder.tenant_id == tenant_id, SalesOrder.order_number.like(f"{prefix}-%"))
        .count()
    )
    return f"{prefix}-{count + 1:04d}"


def _ensure_linked_records(db: Session, data: dict, *, tenant_id: int) -> None:
    quote_id = data.get("quote_id")
    if quote_id is not None:
        get_quote_or_404(db, quote_id, tenant_id=tenant_id)
    contact_id = data.get("contact_id")
    if contact_id is not None and not quotes_repository.contact_exists(db, tenant_id=tenant_id, contact_id=contact_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Contact not found")
    organization_id = data.get("organization_id")
    if organization_id is not None and not quotes_repository.organization_exists(db, tenant_id=tenant_id, organization_id=organization_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization not found")
    opportunity_id = data.get("opportunity_id")
    if opportunity_id is not None and not quotes_repository.get_opportunity(db, tenant_id=tenant_id, opportunity_id=opportunity_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Opportunity not found")
    owner_id = data.get("owner_id")
    if owner_id is not None and not quotes_repository.user_exists(db, tenant_id=tenant_id, user_id=owner_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Owner not found")


def _normalize_order_payload(db: Session, payload: dict, *, tenant_id: int, current_user, partial: bool = False) -> dict:
    data = dict(payload)
    for field in {"quote_id", "organization_id", "contact_id", "opportunity_id", "owner_id"}:
        if data.get(field) == "":
            data[field] = None
    if "status" in data:
        data["status"] = _validate_status(data["status"])
    elif not partial:
        data["status"] = "confirmed"
    if "currency" in data:
        data["currency"] = (_coerce_optional(data["currency"]) or "USD").upper()[:10]
    elif not partial:
        data["currency"] = "USD"
    for field in {"subtotal", "tax_total", "discount_total", "grand_total"}:
        if field in data:
            data[field] = _coerce_decimal(data[field])
        elif not partial:
            data[field] = Decimal("0")
    if not partial:
        data["order_number"] = _coerce_optional(data.get("order_number")) or _generate_order_number(db, tenant_id=tenant_id)
        data["owner_id"] = data.get("owner_id") or (current_user.id if current_user else None)
        data["created_by_id"] = current_user.id if current_user else None
    _ensure_linked_records(db, data, tenant_id=tenant_id)
    return data


def _normalize_item_payload(item: dict, *, tenant_id: int, sort_order: int) -> SalesOrderItem:
    name = _coerce_optional(item.get("name"))
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order item name is required")
    return SalesOrderItem(
        tenant_id=tenant_id,
        name=name,
        description=_coerce_optional(item.get("description")),
        quantity=_coerce_decimal(item.get("quantity", "1")),
        unit_price=_coerce_decimal(item.get("unit_price")),
        discount_amount=_coerce_decimal(item.get("discount_amount")),
        tax_amount=_coerce_decimal(item.get("tax_amount")),
        line_total=_coerce_decimal(item.get("line_total")),
        sort_order=int(item.get("sort_order", sort_order) or sort_order),
    )


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
        "status": {"expression": SalesOrder.status, "type": "text"},
        "currency": {"expression": SalesOrder.currency, "type": "text"},
        "grand_total": {"expression": SalesOrder.grand_total, "type": "number"},
        "created_at": {"expression": SalesOrder.created_at, "type": "date"},
        "updated_at": {"expression": SalesOrder.updated_at, "type": "date"},
    }
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    if search:
        pattern = f"%{search.strip().lower()}%"
        query = query.outerjoin(SalesQuote, SalesQuote.quote_id == SalesOrder.quote_id).filter(
            or_(
                func.lower(SalesOrder.order_number).like(pattern),
                func.lower(SalesOrder.status).like(pattern),
                func.lower(func.coalesce(SalesQuote.customer_name, "")).like(pattern),
                func.lower(func.coalesce(SalesQuote.quote_number, "")).like(pattern),
            )
        )
    return query


def list_sales_orders(db: Session, *, tenant_id: int, pagination, search: str | None = None, all_filter_conditions: list[dict] | None = None, any_filter_conditions: list[dict] | None = None) -> tuple[Sequence[SalesOrder], int]:
    query = build_orders_query(
        db,
        tenant_id=tenant_id,
        search=search,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total_count = query.count()
    orders = query.order_by(SalesOrder.created_at.desc(), SalesOrder.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
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
    data = _normalize_order_payload(db, payload, tenant_id=current_user.tenant_id, current_user=current_user)
    order = SalesOrder(tenant_id=current_user.tenant_id, **data)
    order.items = [
        _normalize_item_payload(item, tenant_id=current_user.tenant_id, sort_order=index)
        for index, item in enumerate(items_payload)
    ]
    db.add(order)
    try:
        db.commit()
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
        "owner_id": quote.assigned_to or (current_user.id if current_user else None),
        "items": [
            {
                "name": quote.title or f"Quote {quote.quote_number}",
                "description": quote.notes,
                "quantity": Decimal("1"),
                "unit_price": quote.subtotal_amount,
                "discount_amount": quote.discount_amount,
                "tax_amount": quote.tax_amount,
                "line_total": quote.total_amount,
                "sort_order": 0,
            }
        ],
    }
    return create_sales_order(db, payload, current_user)


def update_sales_order(db: Session, order: SalesOrder, payload: dict) -> SalesOrder:
    data = _normalize_order_payload(db, payload, tenant_id=order.tenant_id, current_user=None, partial=True)
    for field, value in data.items():
        setattr(order, field, value)
    db.add(order)
    db.commit()
    db.refresh(order)
    return get_order_or_404(db, tenant_id=order.tenant_id, order_id=order.id)
