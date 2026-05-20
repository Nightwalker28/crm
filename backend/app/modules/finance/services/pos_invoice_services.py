from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from app.core.access_control import get_finance_user_scope
from app.core.module_search import apply_ranked_search
from app.core.pagination import Pagination, build_paged_response
from app.core.postgres_search import searchable_text
from app.modules.finance.models import FinancePosInvoice, FinancePosInvoiceLine
from app.modules.finance.repositories import pos_invoice_repository
from app.modules.finance.services.io_search_services import _normalize_allowed_currency, parse_human_date
from app.modules.platform.services.activity_logs import log_activity
from app.modules.sales.models import SalesContact, SalesOrganization

POS_INVOICE_PREFIX = "POS"
POS_INVOICE_PAD = 6
POS_MODULE_KEY = "finance_pos"
VALID_STATUSES = {"draft", "issued", "paid", "void"}
VALID_PAYMENT_STATUSES = {"unpaid", "partial", "paid", "refunded"}
VALID_TEMPLATES = {"modern", "classic", "compact"}


def _normalize_text(value: Any) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _to_decimal(value: Any, *, default: Decimal = Decimal("0")) -> Decimal:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value).strip() or "0")
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=400, detail="Invalid numeric value")


def _money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _date_to_iso(value: date | datetime | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    return value.isoformat()


def _next_invoice_number(db: Session, tenant_id: int) -> str:
    if db.bind and db.bind.dialect.name == "sqlite":
        max_id = db.query(func.coalesce(func.max(FinancePosInvoice.id), 0)).scalar() or 0
        return f"{POS_INVOICE_PREFIX}{int(max_id) + 1:0{POS_INVOICE_PAD}d}"
    value = db.execute(text("SELECT nextval('finance_pos_invoice_number_seq')")).scalar()
    return f"{POS_INVOICE_PREFIX}{int(value or 0):0{POS_INVOICE_PAD}d}"


def _assign_sqlite_test_ids(db: Session, invoice: FinancePosInvoice) -> None:
    if not db.bind or db.bind.dialect.name != "sqlite":
        return
    invoice.id = int(db.query(func.coalesce(func.max(FinancePosInvoice.id), 0)).scalar() or 0) + 1
    next_line_id = int(db.query(func.coalesce(func.max(FinancePosInvoiceLine.id), 0)).scalar() or 0) + 1
    for offset, line in enumerate(invoice.lines):
        line.id = next_line_id + offset


def _validate_invoice_number(db: Session, tenant_id: int, invoice_number: str, invoice_id: int | None = None) -> str:
    normalized = _normalize_text(invoice_number)
    if not normalized:
        raise HTTPException(status_code=400, detail="invoice_number is required")
    query = db.query(FinancePosInvoice).filter(
        FinancePosInvoice.tenant_id == tenant_id,
        func.lower(FinancePosInvoice.invoice_number) == normalized.lower(),
    )
    if invoice_id is not None:
        query = query.filter(FinancePosInvoice.id != invoice_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invoice number already exists")
    return normalized


def _resolve_contact(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    customer_contact_id: int | None,
    customer_name: str | None,
    customer_email: str | None,
    create_if_missing: bool,
) -> SalesContact | None:
    if customer_contact_id is not None:
        contact = db.query(SalesContact).filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.contact_id == customer_contact_id,
            SalesContact.deleted_at.is_(None),
        ).first()
        if not contact:
            raise HTTPException(status_code=400, detail="Linked customer contact was not found")
        return contact

    normalized_email = _normalize_text(customer_email)
    if normalized_email:
        contact = db.query(SalesContact).filter(
            SalesContact.tenant_id == tenant_id,
            func.lower(SalesContact.primary_email) == normalized_email.lower(),
            SalesContact.deleted_at.is_(None),
        ).first()
        if contact:
            return contact

    if not create_if_missing:
        return None
    if not normalized_email:
        raise HTTPException(status_code=400, detail="customer_email is required when creating a customer")
    parts = (_normalize_text(customer_name) or normalized_email).split()
    contact = SalesContact(
        tenant_id=tenant_id,
        first_name=parts[0] if parts else normalized_email,
        last_name=" ".join(parts[1:]) or None,
        primary_email=normalized_email,
        assigned_to=actor_user_id,
    )
    db.add(contact)
    db.flush()
    return contact


def _resolve_organization(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int | None,
    customer_organization_id: int | None,
    customer_name: str | None,
    create_if_missing: bool,
) -> SalesOrganization | None:
    if customer_organization_id is not None:
        organization = db.query(SalesOrganization).filter(
            SalesOrganization.tenant_id == tenant_id,
            SalesOrganization.org_id == customer_organization_id,
            SalesOrganization.deleted_at.is_(None),
        ).first()
        if not organization:
            raise HTTPException(status_code=400, detail="Linked customer organization was not found")
        return organization

    normalized_name = _normalize_text(customer_name)
    if not normalized_name:
        return None
    existing = db.query(SalesOrganization).filter(
        SalesOrganization.tenant_id == tenant_id,
        func.lower(SalesOrganization.org_name) == normalized_name.lower(),
        SalesOrganization.deleted_at.is_(None),
    ).first()
    if existing or not create_if_missing:
        return existing
    organization = SalesOrganization(
        tenant_id=tenant_id,
        org_name=normalized_name,
        assigned_to=actor_user_id,
    )
    db.add(organization)
    db.flush()
    return organization


def _apply_lines(invoice: FinancePosInvoice, lines: list[dict[str, Any]]) -> Decimal:
    if not lines:
        raise HTTPException(status_code=400, detail="At least one line item is required")
    invoice.lines = []
    subtotal = Decimal("0")
    for index, line in enumerate(lines):
        description = _normalize_text(line.get("description"))
        if not description:
            raise HTTPException(status_code=400, detail="Line item description is required")
        quantity = _to_decimal(line.get("quantity"))
        unit_price = _to_decimal(line.get("unit_price"))
        if quantity <= 0:
            raise HTTPException(status_code=400, detail="Line quantity must be greater than zero")
        if unit_price < 0:
            raise HTTPException(status_code=400, detail="Line unit price cannot be negative")
        line_total = _money(quantity * unit_price)
        subtotal += line_total
        invoice.lines.append(
            FinancePosInvoiceLine(
                catalog_product_id=line.get("catalog_product_id"),
                catalog_service_id=line.get("catalog_service_id"),
                description=description,
                quantity=quantity,
                unit_price=unit_price,
                line_total=line_total,
                sort_order=index,
            )
        )
    return _money(subtotal)


def _apply_totals(invoice: FinancePosInvoice, subtotal: Decimal, data: dict[str, Any]) -> None:
    discount = _money(max(Decimal("0"), _to_decimal(data.get("discount_amount"))))
    tax_rate = max(Decimal("0"), _to_decimal(data.get("tax_rate")))
    taxable = max(Decimal("0"), subtotal - discount)
    tax = _money(taxable * tax_rate / Decimal("100"))
    total = _money(taxable + tax)
    amount_paid = _money(max(Decimal("0"), _to_decimal(data.get("amount_paid"))))
    invoice.subtotal_amount = subtotal
    invoice.discount_amount = discount
    invoice.tax_rate = tax_rate
    invoice.tax_amount = tax
    invoice.total_amount = total
    invoice.amount_paid = amount_paid


def _serialize_line(line: FinancePosInvoiceLine) -> dict[str, Any]:
    return {
        "id": line.id,
        "catalog_product_id": line.catalog_product_id,
        "catalog_service_id": line.catalog_service_id,
        "description": line.description,
        "quantity": float(line.quantity),
        "unit_price": float(line.unit_price),
        "line_total": float(line.line_total),
        "sort_order": int(line.sort_order or 0),
    }


def serialize_invoice(invoice: FinancePosInvoice, *, current_user=None, include_lines: bool = True) -> dict[str, Any]:
    user_name = None
    if current_user and invoice.user_id == current_user.id:
        user_name = "You"
    elif getattr(invoice, "assigned_user", None):
        user_name = " ".join(
            part for part in (invoice.assigned_user.first_name, invoice.assigned_user.last_name) if part
        ) or invoice.assigned_user.email
    total = _to_decimal(invoice.total_amount)
    paid = _to_decimal(invoice.amount_paid)
    data = {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "mode": invoice.mode,
        "status": invoice.status,
        "payment_status": invoice.payment_status,
        "payment_method": invoice.payment_method,
        "template_id": invoice.template_id,
        "accent_color": invoice.accent_color,
        "customer_name": invoice.customer_name,
        "customer_email": invoice.customer_email,
        "customer_address": invoice.customer_address,
        "customer_contact_id": invoice.customer_contact_id,
        "customer_organization_id": invoice.customer_organization_id,
        "issue_date": _date_to_iso(invoice.issue_date),
        "due_date": _date_to_iso(invoice.due_date),
        "currency": invoice.currency,
        "subtotal_amount": float(invoice.subtotal_amount),
        "discount_amount": float(invoice.discount_amount),
        "tax_rate": float(invoice.tax_rate),
        "tax_amount": float(invoice.tax_amount),
        "total_amount": float(total),
        "amount_paid": float(paid),
        "balance_due": float(_money(max(Decimal("0"), total - paid))),
        "payment_terms": invoice.payment_terms,
        "notes": invoice.notes,
        "user_name": user_name,
        "updated_at": _date_to_iso(invoice.updated_at),
    }
    if include_lines:
        data["lines"] = [_serialize_line(line) for line in invoice.lines]
    return data


def _query_invoices(db: Session, current_user, *, search: str | None = None, status_filter: str | None = None):
    scope = get_finance_user_scope(db, current_user)
    query = db.query(FinancePosInvoice).filter(
        FinancePosInvoice.tenant_id == current_user.tenant_id,
        FinancePosInvoice.deleted_at.is_(None),
    )
    if scope.user_id_filter is not None:
        query = query.filter(FinancePosInvoice.user_id == scope.user_id_filter)
    if status_filter and status_filter != "all":
        query = query.filter(func.lower(FinancePosInvoice.status) == status_filter.strip().lower())
    query = apply_ranked_search(
        query,
        search=search,
        document=searchable_text(
            FinancePosInvoice.invoice_number,
            FinancePosInvoice.customer_name,
            FinancePosInvoice.customer_email,
            FinancePosInvoice.status,
            FinancePosInvoice.payment_status,
            FinancePosInvoice.payment_method,
            FinancePosInvoice.notes,
        ),
        default_order_column=FinancePosInvoice.updated_at,
    )
    return query


def list_invoices(db: Session, current_user, *, pagination: Pagination, search: str | None = None, status_filter: str | None = None):
    records, total_count = pos_invoice_repository.list_invoices(
        db,
        current_user,
        pagination=pagination,
        search=search,
        status_filter=status_filter,
    )
    return build_paged_response(
        [serialize_invoice(record, current_user=current_user, include_lines=False) for record in records],
        total_count,
        pagination,
    )


def get_invoice_or_404(db: Session, current_user, invoice_id: int) -> FinancePosInvoice:
    invoice = pos_invoice_repository.get_invoice(db, current_user, invoice_id=invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="POS invoice not found")
    return invoice


def create_invoice(db: Session, current_user, payload: dict[str, Any]) -> FinancePosInvoice:
    invoice_number = _validate_invoice_number(
        db,
        current_user.tenant_id,
        payload.get("invoice_number") or _next_invoice_number(db, current_user.tenant_id),
    )
    customer_name = _normalize_text(payload.get("customer_name"))
    if not customer_name:
        raise HTTPException(status_code=400, detail="customer_name is required")
    contact = _resolve_contact(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        customer_contact_id=payload.get("customer_contact_id"),
        customer_name=customer_name,
        customer_email=payload.get("customer_email"),
        create_if_missing=bool(payload.get("create_customer_if_missing")),
    )
    organization = _resolve_organization(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        customer_organization_id=contact.organization_id if contact and contact.organization_id else payload.get("customer_organization_id"),
        customer_name=None if contact else customer_name,
        create_if_missing=bool(payload.get("create_customer_if_missing")),
    )
    status_value = _normalize_text(payload.get("status")) or "issued"
    payment_status_value = _normalize_text(payload.get("payment_status")) or "unpaid"
    template = _normalize_text(payload.get("template_id")) or "modern"
    if status_value not in VALID_STATUSES or payment_status_value not in VALID_PAYMENT_STATUSES or template not in VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="Invalid invoice status, payment status, or template")

    invoice = FinancePosInvoice(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id if current_user else None,
        customer_contact_id=contact.contact_id if contact else None,
        customer_organization_id=organization.org_id if organization else None,
        invoice_number=invoice_number,
        status=status_value,
        payment_status=payment_status_value,
        payment_method=_normalize_text(payload.get("payment_method")),
        template_id=template,
        accent_color=_normalize_text(payload.get("accent_color")) or "#14b8a6",
        customer_name=customer_name,
        customer_email=_normalize_text(payload.get("customer_email")),
        customer_address=_normalize_text(payload.get("customer_address")),
        issue_date=parse_human_date(payload["issue_date"]) if payload.get("issue_date") else datetime.utcnow().date(),
        due_date=parse_human_date(payload["due_date"]) if payload.get("due_date") else None,
        currency=_normalize_allowed_currency(db, current_user, payload.get("currency")),
        payment_terms=_normalize_text(payload.get("payment_terms")),
        notes=_normalize_text(payload.get("notes")),
    )
    subtotal = _apply_lines(invoice, payload.get("lines") or [])
    _apply_totals(invoice, subtotal, payload)
    _assign_sqlite_test_ids(db, invoice)
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key=POS_MODULE_KEY,
        entity_type="finance_pos_invoice",
        entity_id=invoice.id,
        action="create",
        description=f"Created POS invoice {invoice.invoice_number}",
        after_state=serialize_invoice(invoice, current_user=current_user),
    )
    return invoice


def update_invoice(db: Session, current_user, invoice_id: int, payload: dict[str, Any]) -> FinancePosInvoice:
    invoice = get_invoice_or_404(db, current_user, invoice_id)
    before_state = serialize_invoice(invoice, current_user=current_user)
    if "customer_name" in payload:
        customer_name = _normalize_text(payload.get("customer_name"))
        if not customer_name:
            raise HTTPException(status_code=400, detail="customer_name is required")
        invoice.customer_name = customer_name
    if any(key in payload for key in {"customer_contact_id", "customer_organization_id", "customer_email", "create_customer_if_missing"}):
        contact = _resolve_contact(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            customer_contact_id=payload.get("customer_contact_id"),
            customer_name=payload.get("customer_name", invoice.customer_name),
            customer_email=payload.get("customer_email", invoice.customer_email),
            create_if_missing=bool(payload.get("create_customer_if_missing")),
        )
        organization = _resolve_organization(
            db,
            tenant_id=current_user.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            customer_organization_id=contact.organization_id if contact and contact.organization_id else payload.get("customer_organization_id"),
            customer_name=None if contact else payload.get("customer_name", invoice.customer_name),
            create_if_missing=bool(payload.get("create_customer_if_missing")),
        )
        invoice.customer_contact_id = contact.contact_id if contact else None
        invoice.customer_organization_id = organization.org_id if organization else None
    for key in {"customer_email", "customer_address", "payment_method", "payment_terms", "notes", "accent_color"}:
        if key in payload:
            setattr(invoice, key, _normalize_text(payload.get(key)))
    for key, valid in {"status": VALID_STATUSES, "payment_status": VALID_PAYMENT_STATUSES, "template_id": VALID_TEMPLATES}.items():
        if key in payload:
            value = _normalize_text(payload.get(key))
            if value not in valid:
                raise HTTPException(status_code=400, detail=f"Invalid {key}")
            setattr(invoice, key, value)
    for key in {"issue_date", "due_date"}:
        if key in payload:
            setattr(invoice, key, parse_human_date(payload[key]) if payload.get(key) else None)
    if "currency" in payload:
        invoice.currency = _normalize_allowed_currency(db, current_user, payload.get("currency"))
    subtotal = _money(sum((line.line_total for line in invoice.lines), Decimal("0")))
    if "lines" in payload:
        subtotal = _apply_lines(invoice, payload.get("lines") or [])
    total_payload = {
        "discount_amount": invoice.discount_amount,
        "tax_rate": invoice.tax_rate,
        "amount_paid": invoice.amount_paid,
        **payload,
    }
    _apply_totals(invoice, subtotal, total_payload)
    if db.bind and db.bind.dialect.name == "sqlite":
        next_line_id = int(db.query(func.coalesce(func.max(FinancePosInvoiceLine.id), 0)).scalar() or 0) + 1
        for offset, line in enumerate(invoice.lines):
            if line.id is None:
                line.id = next_line_id + offset
    db.add(invoice)
    db.commit()
    db.refresh(invoice)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key=POS_MODULE_KEY,
        entity_type="finance_pos_invoice",
        entity_id=invoice.id,
        action="update",
        description=f"Updated POS invoice {invoice.invoice_number}",
        before_state=before_state,
        after_state=serialize_invoice(invoice, current_user=current_user),
    )
    return invoice


def soft_delete_invoice(db: Session, current_user, invoice_id: int) -> None:
    invoice = get_invoice_or_404(db, current_user, invoice_id)
    before_state = serialize_invoice(invoice, current_user=current_user)
    invoice.deleted_at = datetime.utcnow()
    db.add(invoice)
    db.commit()
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key=POS_MODULE_KEY,
        entity_type="finance_pos_invoice",
        entity_id=invoice.id,
        action="soft_delete",
        description=f"Moved POS invoice {invoice.invoice_number} to recycle bin",
        before_state=before_state,
    )
