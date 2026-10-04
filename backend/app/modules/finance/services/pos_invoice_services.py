"""Invoices (12c-erp-invoicing.md §3): draft → issued → void.

An issued invoice is final: only its due date, notes, payment terms text and presentation
change. Money against it is recorded as payments (`payment_services`) and credit notes
(`credit_note_services`); its balance is derived from them (`invoice_balances`).
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.pagination import Pagination, build_paged_response
from app.modules.catalog.services.line_links import PRODUCT_LINK_FIELD, SERVICE_LINK_FIELD, normalize_catalog_line_links
from app.modules.finance.models import FinancePosInvoice, FinancePosInvoiceLine
from app.modules.finance.repositories import pos_invoice_repository
from app.modules.finance.services.common import finance_date_to_iso, finance_datetime_to_iso
from app.modules.finance.services.document_amounts import ZERO, line_amounts, money
from app.modules.finance.services.invoice_balances import default_due_date, is_overdue, refresh_invoice_balance
from app.modules.finance.services.io_search_services import _normalize_allowed_currency, parse_human_date
from app.modules.platform.models import ActivityLog
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.sales.models import SalesContact, SalesOrganization

POS_MODULE_KEY = "finance_pos"
INVOICE_NUMBER_SCOPE = "finance_invoices"
INVOICE_NUMBER_PREFIX = "INV"
VALID_TEMPLATES = {"modern", "classic", "compact"}
VALID_SOURCES = {"manual", "pos", "sales_order", "website_order"}
MAX_TAX_RATE = Decimal("100")
# What an issued invoice still lets you change (12c §3.3 decision 3).
ISSUED_EDITABLE_FIELDS = {"due_date", "notes", "payment_terms", "template_id", "accent_color"}


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
    return money(value)


def _currency(db: Session, current_user, value) -> str:
    try:
        return _normalize_allowed_currency(db, current_user, value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _assign_sqlite_test_ids(db: Session, invoice: FinancePosInvoice) -> None:
    if not db.bind or db.bind.dialect.name != "sqlite":
        return
    if invoice.id is None:
        invoice.id = int(db.query(func.coalesce(func.max(FinancePosInvoice.id), 0)).scalar() or 0) + 1
    next_line_id = int(db.query(func.coalesce(func.max(FinancePosInvoiceLine.id), 0)).scalar() or 0) + 1
    for line in invoice.lines:
        if line.id is None:
            line.id = next_line_id
            next_line_id += 1


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


def _apply_lines(db: Session, invoice: FinancePosInvoice, lines: list[dict[str, Any]]) -> Decimal:
    """Replace the lines; returns the subtotal net of line discounts, before tax.

    A line sent with an existing `id` keeps its order and delivery links; links are never
    taken from the payload, so a client cannot attach another order's line.
    """
    if not lines:
        raise HTTPException(status_code=400, detail="At least one line item is required")
    catalog_links = normalize_catalog_line_links(db, tenant_id=invoice.tenant_id, lines=lines)
    existing_by_id = {line.id: line for line in invoice.lines if line.id is not None}
    updated_lines: list[FinancePosInvoiceLine] = []
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
        discount = _to_decimal(line.get("discount_amount"))
        tax = _to_decimal(line.get("tax_amount"))
        if discount < 0 or tax < 0:
            raise HTTPException(status_code=400, detail="Line discount and tax cannot be negative")
        net, line_total = line_amounts(quantity=quantity, unit_price=unit_price, discount=discount, tax=tax, label=description)
        subtotal += net
        line_id = line.get("id")
        invoice_line = existing_by_id.pop(int(line_id), None) if line_id is not None else None
        if invoice_line is None:
            invoice_line = FinancePosInvoiceLine(tenant_id=invoice.tenant_id)
        invoice_line.catalog_product_id = catalog_links[index][PRODUCT_LINK_FIELD]
        invoice_line.catalog_service_id = catalog_links[index][SERVICE_LINK_FIELD]
        invoice_line.description = description
        invoice_line.quantity = quantity
        invoice_line.unit_price = unit_price
        invoice_line.discount_amount = _money(discount)
        invoice_line.tax_amount = _money(tax)
        invoice_line.line_total = line_total
        invoice_line.sort_order = index
        updated_lines.append(invoice_line)
    invoice.lines = updated_lines
    return _money(subtotal)


def _apply_totals(invoice: FinancePosInvoice, subtotal: Decimal, data: dict[str, Any]) -> None:
    """Header discount and tax rate on top of the lines' own (kept for POS and older invoices)."""
    discount = _money(max(Decimal("0"), _to_decimal(data.get("discount_amount"))))
    tax_rate = max(Decimal("0"), _to_decimal(data.get("tax_rate")))
    if tax_rate > MAX_TAX_RATE:
        raise HTTPException(status_code=400, detail="Tax rate cannot exceed 100")
    taxable = max(Decimal("0"), subtotal - discount)
    line_tax = sum((_money(_to_decimal(line.tax_amount)) for line in invoice.lines), Decimal("0"))
    tax = _money(taxable * tax_rate / Decimal("100")) + line_tax
    invoice.subtotal_amount = subtotal
    invoice.discount_amount = discount
    invoice.tax_rate = tax_rate
    invoice.tax_amount = tax
    invoice.total_amount = _money(taxable + tax)


def _add_invoice_activity(
    db: Session,
    *,
    current_user,
    invoice: FinancePosInvoice,
    action: str,
    description: str,
    before_state: dict[str, Any] | None = None,
    after_state: dict[str, Any] | None = None,
) -> None:
    db.add(
        ActivityLog(
            tenant_id=invoice.tenant_id,
            actor_user_id=current_user.id if current_user else None,
            module_key=POS_MODULE_KEY,
            entity_type="finance_pos_invoice",
            entity_id=invoice.id,
            action=action,
            description=description,
            before_state=before_state,
            after_state=after_state,
        )
    )


def invoice_label(invoice: FinancePosInvoice) -> str:
    return invoice.invoice_number or f"draft invoice #{invoice.id}"


def _serialize_line(line: FinancePosInvoiceLine) -> dict[str, Any]:
    return {
        "id": line.id,
        "catalog_product_id": line.catalog_product_id,
        "catalog_service_id": line.catalog_service_id,
        "sales_order_item_id": line.sales_order_item_id,
        "delivery_line_id": line.delivery_line_id,
        "description": line.description,
        "quantity": float(line.quantity),
        "unit_price": float(line.unit_price),
        "discount_amount": float(line.discount_amount or 0),
        "tax_amount": float(line.tax_amount or 0),
        "line_total": float(line.line_total),
        "sort_order": int(line.sort_order or 0),
    }


def serialize_invoice(invoice: FinancePosInvoice, *, current_user=None, include_lines: bool = True) -> dict[str, Any]:
    """The invoice as every surface sees it (the record, print, and later the portal)."""
    user_name = None
    if current_user and invoice.user_id == current_user.id:
        user_name = "You"
    elif getattr(invoice, "assigned_user", None):
        user_name = " ".join(
            part for part in (invoice.assigned_user.first_name, invoice.assigned_user.last_name) if part
        ) or invoice.assigned_user.email
    contact = getattr(invoice, "customer_contact", None)
    organization = getattr(invoice, "customer_organization", None)
    contact_name = None
    if contact:
        contact_name = " ".join(part for part in (contact.first_name, contact.last_name) if part).strip() or contact.primary_email
    status_value = invoice.status or "draft"
    balance = _to_decimal(invoice.balance_due)
    data = {
        "id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "mode": invoice.mode,
        "source": invoice.source or "manual",
        "sales_order_id": invoice.sales_order_id,
        "status": status_value,
        "payment_status": invoice.payment_status,
        "is_overdue": is_overdue(status=status_value, balance_due=balance, due_date=invoice.due_date),
        "payment_method": invoice.payment_method,
        "template_id": invoice.template_id,
        "accent_color": invoice.accent_color,
        "customer_name": invoice.customer_name,
        "customer_email": invoice.customer_email,
        "customer_address": invoice.customer_address,
        "customer_contact_id": invoice.customer_contact_id,
        "customer_organization_id": invoice.customer_organization_id,
        "customer_contact_name": contact_name,
        "customer_organization_name": organization.org_name if organization else None,
        "issue_date": finance_date_to_iso(invoice.issue_date),
        "due_date": finance_date_to_iso(invoice.due_date),
        "currency": invoice.currency,
        "subtotal_amount": float(_to_decimal(invoice.subtotal_amount)),
        "discount_amount": float(_to_decimal(invoice.discount_amount)),
        "tax_rate": float(_to_decimal(invoice.tax_rate)),
        "tax_amount": float(_to_decimal(invoice.tax_amount)),
        "total_amount": float(_to_decimal(invoice.total_amount)),
        "amount_paid": float(_to_decimal(invoice.amount_paid)),
        "amount_credited": float(_to_decimal(invoice.amount_credited)),
        "balance_due": float(balance),
        "payment_terms": invoice.payment_terms,
        "notes": invoice.notes,
        "issued_at": finance_datetime_to_iso(invoice.issued_at),
        "voided_at": finance_datetime_to_iso(invoice.voided_at),
        "void_reason": invoice.void_reason,
        "user_name": user_name,
        "created_at": finance_datetime_to_iso(invoice.created_at),
        "updated_at": finance_datetime_to_iso(invoice.updated_at),
    }
    if include_lines:
        data["lines"] = [_serialize_line(line) for line in invoice.lines]
    return data


def list_invoices(
    db: Session,
    current_user,
    *,
    pagination: Pagination,
    search: str | None = None,
    status_filter: str | None = None,
    payment_status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
    sort_by: str | None = None,
    sort_direction: str | None = None,
):
    records, total_count = pos_invoice_repository.list_invoices(
        db,
        current_user,
        pagination=pagination,
        search=search,
        status_filter=status_filter,
        payment_status_filter=payment_status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    return build_paged_response(
        [serialize_invoice(record, current_user=current_user, include_lines=False) for record in records],
        total_count,
        pagination,
    )


def list_invoices_cursor(
    db: Session,
    current_user,
    *,
    limit: int,
    cursor: int | None = None,
    search: str | None = None,
    status_filter: str | None = None,
    payment_status_filter: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    return pos_invoice_repository.list_invoices_cursor(
        db,
        current_user,
        limit=limit,
        cursor=cursor,
        search=search,
        status_filter=status_filter,
        payment_status_filter=payment_status_filter,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )


def get_invoice_or_404(db: Session, current_user, invoice_id: int, *, lock: bool = False) -> FinancePosInvoice:
    getter = pos_invoice_repository.get_invoice_for_update if lock else pos_invoice_repository.get_invoice
    invoice = getter(db, current_user, invoice_id=invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return invoice


def _apply_customer(db: Session, current_user, invoice: FinancePosInvoice, payload: dict[str, Any], *, customer_name: str) -> None:
    contact = _resolve_contact(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        customer_contact_id=payload.get("customer_contact_id"),
        customer_name=customer_name,
        customer_email=payload.get("customer_email", invoice.customer_email),
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
    invoice.customer_contact_id = contact.contact_id if contact else None
    invoice.customer_organization_id = organization.org_id if organization else None


def create_invoice(db: Session, current_user, payload: dict[str, Any], *, commit: bool = True) -> FinancePosInvoice:
    """A draft, or (`issue`) an issued invoice. `paid_now` records a payment in the same step,
    the POS fast path (12c §3.3)."""
    customer_name = _normalize_text(payload.get("customer_name"))
    if not customer_name:
        raise HTTPException(status_code=400, detail="customer_name is required")
    template = _normalize_text(payload.get("template_id")) or "modern"
    if template not in VALID_TEMPLATES:
        raise HTTPException(status_code=400, detail="Invalid invoice template")
    source = _normalize_text(payload.get("source")) or "manual"
    if source not in VALID_SOURCES:
        raise HTTPException(status_code=400, detail="Invalid invoice source")

    invoice = FinancePosInvoice(
        tenant_id=current_user.tenant_id,
        user_id=current_user.id if current_user else None,
        invoice_number=None,
        status="draft",
        payment_status="unpaid",
        source=source,
        payment_method=_normalize_text(payload.get("payment_method")),
        template_id=template,
        accent_color=_normalize_text(payload.get("accent_color")) or "#14b8a6",
        customer_name=customer_name,
        customer_email=_normalize_text(payload.get("customer_email")),
        customer_address=_normalize_text(payload.get("customer_address")),
        issue_date=parse_human_date(payload["issue_date"]) if payload.get("issue_date") else None,
        due_date=parse_human_date(payload["due_date"]) if payload.get("due_date") else None,
        currency=_currency(db, current_user, payload.get("currency")),
        payment_terms=_normalize_text(payload.get("payment_terms")),
        notes=_normalize_text(payload.get("notes")),
        amount_paid=ZERO,
        amount_credited=ZERO,
        balance_due=ZERO,
    )
    _apply_customer(db, current_user, invoice, payload, customer_name=customer_name)
    subtotal = _apply_lines(db, invoice, payload.get("lines") or [])
    _apply_totals(invoice, subtotal, payload)
    _assign_sqlite_test_ids(db, invoice)
    db.add(invoice)
    db.flush()
    _add_invoice_activity(
        db,
        current_user=current_user,
        invoice=invoice,
        action="create",
        description=f"Created {invoice_label(invoice)} for {invoice.customer_name}",
        after_state=serialize_invoice(invoice, current_user=current_user),
    )
    if payload.get("issue") or payload.get("paid_now"):
        _issue(db, current_user, invoice)
    paid_now = payload.get("paid_now")
    if paid_now:
        from app.modules.finance.services import payment_services

        amount = paid_now.get("amount")
        payment_services.record_payment(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, payload={
            "direction": "received", "kind": "payment", "method": paid_now.get("method") or invoice.payment_method,
            "reference": paid_now.get("reference"), "paid_on": paid_now.get("paid_on"),
            "allocations": [{"invoice_id": invoice.id, "amount": amount if amount is not None else invoice.balance_due}],
        }, finance_user=current_user)
    if commit:
        db.commit()
        db.refresh(invoice)
    return invoice


def update_invoice(db: Session, current_user, invoice_id: int, payload: dict[str, Any]) -> FinancePosInvoice:
    invoice = get_invoice_or_404(db, current_user, invoice_id, lock=True)
    if invoice.status == "void":
        raise HTTPException(status_code=409, detail="A void invoice cannot be changed")
    if invoice.status == "issued":
        locked = sorted(key for key in payload if key not in ISSUED_EDITABLE_FIELDS and key != "create_customer_if_missing")
        if locked:
            raise HTTPException(status_code=409, detail="An issued invoice is final: only its due date, notes, payment terms and template can change. Create a credit note, or void it and issue a corrected copy.")
    before_state = serialize_invoice(invoice, current_user=current_user)
    if "customer_name" in payload:
        customer_name = _normalize_text(payload.get("customer_name"))
        if not customer_name:
            raise HTTPException(status_code=400, detail="customer_name is required")
        invoice.customer_name = customer_name
    if any(key in payload for key in {"customer_contact_id", "customer_organization_id", "customer_email", "create_customer_if_missing"}) and invoice.status == "draft":
        _apply_customer(db, current_user, invoice, payload, customer_name=payload.get("customer_name", invoice.customer_name))
    for key in {"customer_email", "customer_address", "payment_method", "payment_terms", "notes", "accent_color"}:
        if key in payload:
            setattr(invoice, key, _normalize_text(payload.get(key)))
    if "template_id" in payload:
        template = _normalize_text(payload.get("template_id"))
        if template not in VALID_TEMPLATES:
            raise HTTPException(status_code=400, detail="Invalid template_id")
        invoice.template_id = template
    for key in {"issue_date", "due_date"}:
        if key in payload:
            setattr(invoice, key, parse_human_date(payload[key]) if payload.get(key) else None)
    if "currency" in payload:
        invoice.currency = _currency(db, current_user, payload.get("currency"))
    if invoice.status == "draft":
        if "lines" in payload:
            subtotal = _apply_lines(db, invoice, payload.get("lines") or [])
        else:
            subtotal = _money(sum((_to_decimal(line.line_total) - _to_decimal(line.tax_amount) for line in invoice.lines), Decimal("0")))
        _apply_totals(invoice, subtotal, {"discount_amount": invoice.discount_amount, "tax_rate": invoice.tax_rate, **payload})
        _assign_sqlite_test_ids(db, invoice)
    db.add(invoice)
    db.flush()
    if invoice.sales_order_id and invoice.status == "draft":
        from app.modules.finance.services import invoicing_services

        invoicing_services.check_order_lines(db, invoice=invoice, issuing=False)
    if invoice.status == "issued":
        refresh_invoice_balance(db, invoice)
    _add_invoice_activity(
        db,
        current_user=current_user,
        invoice=invoice,
        action="update",
        description=f"Updated {invoice_label(invoice)}",
        before_state=before_state,
        after_state=serialize_invoice(invoice, current_user=current_user),
    )
    db.commit()
    db.refresh(invoice)
    return invoice


def _issue(db: Session, current_user, invoice: FinancePosInvoice) -> None:
    if invoice.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft invoice can be issued")
    if not invoice.lines:
        raise HTTPException(status_code=400, detail="Add at least one line before issuing")
    from app.modules.finance.services import invoicing_services

    orders = invoicing_services.check_order_lines(db, invoice=invoice, issuing=True)
    today = date.today()
    invoice.issue_date = invoice.issue_date or today
    if invoice.due_date is None:
        invoice.due_date = default_due_date(db, tenant_id=invoice.tenant_id, organization_id=invoice.customer_organization_id, from_date=invoice.issue_date)
    if invoice.due_date is not None and invoice.due_date < invoice.issue_date:
        raise HTTPException(status_code=400, detail="The due date cannot be before the issue date")
    invoice.invoice_number = invoice.invoice_number or allocate_business_number(
        db, tenant_id=invoice.tenant_id, scope=INVOICE_NUMBER_SCOPE, prefix=INVOICE_NUMBER_PREFIX)
    invoice.status = "issued"
    invoice.issued_at = datetime.now(timezone.utc)
    invoice.issued_by = current_user.id if current_user else None
    refresh_invoice_balance(db, invoice)
    db.flush()
    for order in orders:
        invoicing_services.refresh_invoice_status(db, order=order)
        invoicing_services.log_order_activity(db, order=order, actor_user_id=invoice.issued_by, action="sales_order.invoice_issued",
            description=f"Issued invoice {invoice.invoice_number}")
    _add_invoice_activity(db, current_user=current_user, invoice=invoice, action="issue",
        description=f"Issued invoice {invoice.invoice_number} for {invoice.customer_name}")
    from app.modules.inventory.services.stock_ledger import stage_inventory_event

    # Staged with the transaction and dispatched to automation after commit.
    stage_inventory_event(db, tenant_id=invoice.tenant_id, actor_user_id=invoice.issued_by, event_type="finance.invoice_issued",
        entity_type="finance_pos_invoice", entity_id=invoice.id, payload={"invoice_number": invoice.invoice_number,
        "customer_name": invoice.customer_name, "total_amount": str(invoice.total_amount), "currency": invoice.currency,
        "sales_order_id": invoice.sales_order_id})


def issue_invoice(db: Session, current_user, invoice_id: int) -> FinancePosInvoice:
    invoice = get_invoice_or_404(db, current_user, invoice_id, lock=True)
    _issue(db, current_user, invoice)
    db.commit()
    db.refresh(invoice)
    return invoice


def _void(db: Session, current_user, invoice: FinancePosInvoice, reason: str) -> None:
    from app.modules.finance.services import invoicing_services
    from app.modules.finance.services.payment_services import has_posted_payments
    from app.modules.finance.models import FinanceCreditNote

    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    if invoice.status != "issued":
        raise HTTPException(status_code=409, detail="Only an issued invoice can be voided; remove a draft instead")
    if has_posted_payments(db, tenant_id=invoice.tenant_id, invoice_id=invoice.id):
        raise HTTPException(status_code=409, detail="Payments are recorded against this invoice; void them first, or create a credit note")
    if db.query(FinanceCreditNote.id).filter(FinanceCreditNote.tenant_id == invoice.tenant_id, FinanceCreditNote.invoice_id == invoice.id,
            FinanceCreditNote.deleted_at.is_(None), FinanceCreditNote.status.in_(["draft", "issued"])).first() is not None:
        raise HTTPException(status_code=409, detail="This invoice has credit notes; void or remove them first")
    orders = invoicing_services.orders_of(db, invoice=invoice, lock=True)
    invoice.status = "void"
    invoice.voided_at = datetime.now(timezone.utc)
    invoice.void_reason = reason[:500]
    refresh_invoice_balance(db, invoice)
    db.flush()
    for order in orders:
        invoicing_services.refresh_invoice_status(db, order=order)
        invoicing_services.log_order_activity(db, order=order, actor_user_id=current_user.id if current_user else None,
            action="sales_order.invoice_voided", description=f"Voided invoice {invoice.invoice_number}: {reason}")
    _add_invoice_activity(db, current_user=current_user, invoice=invoice, action="void",
        description=f"Voided invoice {invoice.invoice_number}: {reason}")


def void_invoice(db: Session, current_user, invoice_id: int, *, reason: str) -> FinancePosInvoice:
    invoice = get_invoice_or_404(db, current_user, invoice_id, lock=True)
    _void(db, current_user, invoice, reason)
    db.commit()
    db.refresh(invoice)
    return invoice


def void_and_copy(db: Session, current_user, invoice_id: int, *, reason: str) -> FinancePosInvoice:
    """Business Central's *Correct*: void the invoice and open a draft copy to fix."""
    invoice = get_invoice_or_404(db, current_user, invoice_id, lock=True)
    _void(db, current_user, invoice, reason)
    copy = FinancePosInvoice(
        tenant_id=invoice.tenant_id, user_id=current_user.id if current_user else invoice.user_id,
        customer_contact_id=invoice.customer_contact_id, customer_organization_id=invoice.customer_organization_id,
        invoice_number=None, mode=invoice.mode, source=invoice.source, sales_order_id=invoice.sales_order_id,
        status="draft", payment_status="unpaid", payment_method=invoice.payment_method, template_id=invoice.template_id,
        accent_color=invoice.accent_color, customer_name=invoice.customer_name, customer_email=invoice.customer_email,
        customer_address=invoice.customer_address, issue_date=None, due_date=None, currency=invoice.currency,
        payment_terms=invoice.payment_terms, notes=invoice.notes, discount_amount=invoice.discount_amount,
        tax_rate=invoice.tax_rate, amount_paid=ZERO, amount_credited=ZERO, balance_due=ZERO,
    )
    copy.lines = [FinancePosInvoiceLine(
        tenant_id=invoice.tenant_id, catalog_product_id=line.catalog_product_id, catalog_service_id=line.catalog_service_id,
        sales_order_item_id=line.sales_order_item_id, delivery_line_id=line.delivery_line_id, description=line.description,
        quantity=line.quantity, unit_price=line.unit_price, discount_amount=line.discount_amount, tax_amount=line.tax_amount,
        line_total=line.line_total, sort_order=line.sort_order) for line in invoice.lines]
    copy.subtotal_amount, copy.tax_amount, copy.total_amount = invoice.subtotal_amount, invoice.tax_amount, invoice.total_amount
    _assign_sqlite_test_ids(db, copy)
    db.add(copy)
    db.flush()
    _add_invoice_activity(db, current_user=current_user, invoice=copy, action="create",
        description=f"Opened a corrected copy of {invoice.invoice_number}")
    db.commit()
    db.refresh(copy)
    return copy


def record_invoice_payment(
    db: Session,
    current_user,
    invoice_id: int,
    *,
    amount: Decimal,
    payment_method: str | None = None,
    paid_on: date | None = None,
    reference: str | None = None,
) -> FinancePosInvoice:
    """The pre-E5 route, kept as a thin wrapper: one payment record for this invoice."""
    from app.modules.finance.services import payment_services

    invoice = get_invoice_or_404(db, current_user, invoice_id)
    payment_services.record_payment(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, payload={
        "direction": "received", "kind": "payment", "method": payment_method, "paid_on": paid_on, "reference": reference,
        "allocations": [{"invoice_id": invoice.id, "amount": amount}],
    }, finance_user=current_user)
    db.commit()
    db.refresh(invoice)
    return invoice


def soft_delete_invoice(db: Session, current_user, invoice_id: int) -> None:
    invoice = get_invoice_or_404(db, current_user, invoice_id, lock=True)
    if invoice.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft invoice can be removed; void an issued invoice instead")
    before_state = serialize_invoice(invoice, current_user=current_user)
    invoice.deleted_at = datetime.now(timezone.utc)
    db.add(invoice)
    _add_invoice_activity(
        db,
        current_user=current_user,
        invoice=invoice,
        action="soft_delete",
        description=f"Moved {invoice_label(invoice)} to the recycle bin",
        before_state=before_state,
    )
    db.commit()


def restore_draft(db: Session, current_user, invoice_id: int) -> FinancePosInvoice:
    invoice = db.query(FinancePosInvoice).filter(FinancePosInvoice.tenant_id == current_user.tenant_id, FinancePosInvoice.id == invoice_id,
        FinancePosInvoice.deleted_at.isnot(None)).with_for_update().first()
    if invoice is None or invoice.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft invoice not found")
    invoice.deleted_at = None
    db.add(invoice)
    _add_invoice_activity(db, current_user=current_user, invoice=invoice, action="restore", description=f"Restored {invoice_label(invoice)}")
    return invoice
