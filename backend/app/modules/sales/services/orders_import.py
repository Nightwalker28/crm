"""Sales order import (13c §3.3, owner decision 6).

One CSV row per order line. Rows that share an `order_reference` become one order, created
as a draft through `create_sales_order`, so numbering, totals, catalog links and custom
fields follow the same rules as the order form. An order is all or nothing: one bad row
refuses its whole order (inside a savepoint), and the other orders still import.

The reference is kept as the order's `external_reference` (unique per tenant), so importing
the same file twice skips the orders it already made instead of doubling them.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import date
from decimal import Decimal, InvalidOperation

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.module_csv import build_import_summary, iter_csv_rows_from_bytes, require_csv_headers
from app.core.unit_of_work import savepoint
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.models import SalesContact, SalesOrder, SalesOrganization

ORDER_IMPORT_FIELDS = [
    "order_reference",
    "account",
    "contact_email",
    "currency",
    "delivery_date",
    "notes",
    "item",
    "description",
    "quantity",
    "unit_price",
    "discount_amount",
]
ORDER_IMPORT_REQUIRED = ["order_reference", "item", "quantity"]
ORDER_IMPORT_ALIASES = {
    "order_reference": ["reference", "order ref", "order id", "order number", "external reference"],
    "account": ["customer", "customer name", "company", "organization", "account name"],
    "contact_email": ["contact", "email", "contact e-mail"],
    "item": ["product", "service", "sku", "item name", "product name"],
    "quantity": ["qty", "units"],
    "unit_price": ["price", "rate", "unit cost"],
    "discount_amount": ["discount"],
    "delivery_date": ["delivery", "ship date", "due date"],
}


class _RowError(ValueError):
    pass


def _decimal(value: str | None, field: str, *, default: str | None = None) -> Decimal | None:
    text = (value or "").strip().replace(",", "")
    if not text:
        return Decimal(default) if default is not None else None
    try:
        result = Decimal(text)
    except InvalidOperation as exc:
        raise _RowError(f"{field} must be a number, not '{value}'") from exc
    if not result.is_finite() or result < 0:
        raise _RowError(f"{field} must be zero or more")
    return result


def _date(value: str | None) -> date | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise _RowError(f"delivery_date must be a date as YYYY-MM-DD, not '{value}'") from exc


class _Lookups:
    """Account, contact and catalog matches, cached per import and scoped to the tenant."""

    def __init__(self, db: Session, tenant_id: int):
        self.db, self.tenant_id = db, tenant_id
        self.accounts: dict[str, int] = {}
        self.contacts: dict[str, SalesContact] = {}
        self.items: dict[str, tuple[str, object]] = {}

    def account(self, name: str) -> int:
        key = name.strip().lower()
        if key not in self.accounts:
            rows = self.db.query(SalesOrganization.org_id).filter(
                SalesOrganization.tenant_id == self.tenant_id, SalesOrganization.deleted_at.is_(None),
                func.lower(SalesOrganization.org_name) == key).limit(2).all()
            if not rows:
                raise _RowError(f"No account is named '{name}'")
            if len(rows) > 1:
                raise _RowError(f"More than one account is named '{name}'")
            self.accounts[key] = rows[0][0]
        return self.accounts[key]

    def contact(self, email: str) -> SalesContact:
        key = email.strip().lower()
        if key not in self.contacts:
            row = self.db.query(SalesContact).filter(SalesContact.tenant_id == self.tenant_id, SalesContact.deleted_at.is_(None),
                                                     func.lower(SalesContact.primary_email) == key).first()
            if row is None:
                raise _RowError(f"No contact has the email '{email}'")
            self.contacts[key] = row
        return self.contacts[key]

    def item(self, value: str) -> tuple[str, object]:
        """A product, then a service, by SKU then by name (case-insensitive)."""
        key = value.strip().lower()
        if key not in self.items:
            for kind, model in (("product", CatalogProduct), ("service", CatalogService)):
                row = self.db.query(model).filter(model.tenant_id == self.tenant_id, model.deleted_at.is_(None),
                                                  or_(func.lower(model.sku) == key, func.lower(model.name) == key)).order_by(
                                                  (func.lower(model.sku) == key).desc(), model.id).first()
                if row is not None:
                    self.items[key] = (kind, row)
                    break
            else:
                raise _RowError(f"No product or service has the SKU or name '{value}'")
        return self.items[key]


def _order_payload(rows: list[tuple[int, dict]], lookups: _Lookups) -> dict:
    first = rows[0][1]
    payload: dict = {"status": "draft", "external_reference": first["order_reference"], "items": []}
    for field in ("account", "contact_email", "currency", "delivery_date", "notes"):
        values = {row.get(field) for _, row in rows if row.get(field)}
        if len(values) > 1:
            raise _RowError(f"The rows of this order disagree on {field}")
    if first.get("account"):
        payload["organization_id"] = lookups.account(first["account"])
    if first.get("contact_email"):
        contact = lookups.contact(first["contact_email"])
        if payload.get("organization_id") and contact.organization_id and contact.organization_id != payload["organization_id"]:
            raise _RowError(f"{first['contact_email']} belongs to another account")
        payload["contact_id"] = contact.contact_id
    if first.get("currency"):
        payload["currency"] = first["currency"].upper()
    payload["delivery_date"] = _date(first.get("delivery_date"))
    payload["notes"] = first.get("notes") or None
    for index, (_, row) in enumerate(rows):
        kind, item = lookups.item(row["item"])
        quantity = _decimal(row.get("quantity"), "quantity")
        if not quantity:
            raise _RowError("quantity must be more than zero")
        price = _decimal(row.get("unit_price"), "unit_price")
        if price is None:
            # No price in the file: the item's list price, as the order form fills it.
            price = Decimal(str(item.public_unit_price or 0))
        payload["items"].append({
            "catalog_product_id": item.id if kind == "product" else None,
            "catalog_service_id": item.id if kind == "service" else None,
            "name": item.name,
            "description": row.get("description") or None,
            "quantity": quantity,
            "unit_price": price,
            "discount_amount": _decimal(row.get("discount_amount"), "discount_amount", default="0"),
            "sort_order": index,
        })
    return payload


def import_orders_from_csv(db: Session, file_bytes: bytes, *, current_user) -> dict:
    """Create one draft order per `order_reference`; returns the standard import summary."""
    from app.modules.sales.services.orders_services import create_sales_order

    headers, row_iter = iter_csv_rows_from_bytes(file_bytes)
    require_csv_headers(headers, required=set(ORDER_IMPORT_REQUIRED))
    tenant_id = current_user.tenant_id
    groups: OrderedDict[str, list[tuple[int, dict]]] = OrderedDict()
    failures: list[dict] = []
    total_rows = 0
    for row_number, row in enumerate(row_iter, start=2):
        total_rows += 1
        normalized = {key.strip().lower(): (value.strip() if isinstance(value, str) else value) for key, value in row.items() if key}
        reference = normalized.get("order_reference")
        if not reference:
            failures.append({"row_number": row_number, "record_identifier": None, "reason": "order_reference is required"})
            continue
        if not normalized.get("item"):
            failures.append({"row_number": row_number, "record_identifier": reference, "reason": "item is required"})
            continue
        groups.setdefault(reference, []).append((row_number, normalized))

    lookups = _Lookups(db, tenant_id)
    existing = {value for (value,) in db.query(SalesOrder.external_reference).filter(
        SalesOrder.tenant_id == tenant_id, SalesOrder.external_reference.in_(list(groups)))} if groups else set()
    new_rows = skipped_rows = 0
    for reference, rows in groups.items():
        if reference in existing:
            skipped_rows += len(rows)
            continue
        try:
            # The order and everything its creation staged roll back together (13c §3.3).
            with savepoint(db):
                payload = _order_payload(rows, lookups)
                order = create_sales_order(db, payload, current_user)
                log_activity(db, tenant_id=tenant_id, actor_user_id=current_user.id, module_key="sales_orders", entity_type="sales_order",
                             entity_id=order.id, action="create", description=f"Imported order {order.order_number} ({reference})", commit=False)
            new_rows += len(rows)
        except (_RowError, HTTPException, ValueError) as exc:
            reason = str(exc.detail) if isinstance(exc, HTTPException) else str(exc)
            # The whole order is refused, so every one of its rows is reported.
            failures.extend({"row_number": row_number, "record_identifier": reference, "reason": reason} for row_number, _ in rows)
    db.commit()
    return build_import_summary(total_rows=total_rows, new_rows=new_rows, skipped_rows=skipped_rows, overwritten_rows=0,
                                merged_rows=0, failures=failures)
