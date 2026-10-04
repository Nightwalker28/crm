"""Credit notes (12c-erp-invoicing.md §3.3): draft → issued → void, always against one
issued invoice, never for more than it invoiced.

Issuing applies the credit to its invoice through a credit allocation; whatever exceeds the
invoice's balance at that moment is *refund due*, settled by a refund payment. Allocations,
not a column on the invoice, carry the credit, so applying it elsewhere later is additive.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from app.core.access_control import get_finance_user_scope
from app.core.pagination import Pagination, build_paged_response
from app.modules.finance.models import (
    FinanceCreditAllocation,
    FinanceCreditNote,
    FinanceCreditNoteLine,
    FinancePosInvoice,
    FinancePosInvoiceLine,
)
from app.modules.finance.services.document_amounts import ZERO, decimal_input, line_amounts, money, pro_rata, units
from app.modules.finance.services.invoice_balances import refresh_credit_note_balance, refresh_invoice_balance
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.numbering import allocate_business_number

MODULE = "finance_credit_notes"


def _audit(db: Session, *, credit_note: FinanceCreditNote, actor_user_id: int | None, action: str, description: str) -> None:
    log_activity(db, tenant_id=credit_note.tenant_id, actor_user_id=actor_user_id, module_key=MODULE, entity_type="finance_credit_note",
        entity_id=credit_note.id, action=action, description=description, commit=False)
    log_activity(db, tenant_id=credit_note.tenant_id, actor_user_id=actor_user_id, module_key="finance_pos", entity_type="finance_pos_invoice",
        entity_id=credit_note.invoice_id, action=f"credit_note.{action}", description=description, commit=False)


def label(credit_note: FinanceCreditNote) -> str:
    return credit_note.number or f"draft credit note #{credit_note.id}"


def _scoped(query, db: Session, user):
    scope = get_finance_user_scope(db, user)
    if scope.user_id_filter is not None:
        query = query.join(FinancePosInvoice, FinancePosInvoice.id == FinanceCreditNote.invoice_id).filter(
            or_(FinanceCreditNote.created_by == scope.user_id_filter, FinancePosInvoice.user_id == scope.user_id_filter))
    return query


def get_credit_note(db: Session, user, credit_note_id: int, *, lock: bool = False, include_deleted: bool = False) -> FinanceCreditNote:
    query = db.query(FinanceCreditNote).options(selectinload(FinanceCreditNote.lines)).filter(
        FinanceCreditNote.tenant_id == user.tenant_id, FinanceCreditNote.id == credit_note_id)
    if not include_deleted:
        query = query.filter(FinanceCreditNote.deleted_at.is_(None))
    query = _scoped(query, db, user)
    credit_note = (query.with_for_update(of=FinanceCreditNote) if lock else query).first()
    if credit_note is None:
        raise HTTPException(status_code=404, detail="Credit note not found")
    return credit_note


def credited_by_invoice_line(db: Session, *, tenant_id: int, invoice_line_ids, exclude_credit_note_id: int | None = None) -> dict[int, Decimal]:
    """Quantities on issued credit notes, per invoice line."""
    ids = list(invoice_line_ids)
    if not ids:
        return {}
    query = db.query(FinanceCreditNoteLine.invoice_line_id, func.sum(FinanceCreditNoteLine.quantity)).join(
        FinanceCreditNote, FinanceCreditNote.id == FinanceCreditNoteLine.credit_note_id).filter(
        FinanceCreditNote.tenant_id == tenant_id, FinanceCreditNote.status == "issued", FinanceCreditNoteLine.invoice_line_id.in_(ids))
    if exclude_credit_note_id is not None:
        query = query.filter(FinanceCreditNote.id != exclude_credit_note_id)
    return {line_id: Decimal(total or 0) for line_id, total in query.group_by(FinanceCreditNoteLine.invoice_line_id)}


def creditable(db: Session, *, invoice: FinancePosInvoice, exclude_credit_note_id: int | None = None) -> dict[int, Decimal]:
    """Invoiced less already credited, per invoice line."""
    credited = credited_by_invoice_line(db, tenant_id=invoice.tenant_id, invoice_line_ids=[line.id for line in invoice.lines],
        exclude_credit_note_id=exclude_credit_note_id)
    return {line.id: max(Decimal(line.quantity) - credited.get(line.id, ZERO), ZERO) for line in invoice.lines}


def _issued_invoice(db: Session, user, invoice_id: int, *, lock: bool = False) -> FinancePosInvoice:
    from app.modules.finance.services.pos_invoice_services import get_invoice_or_404

    invoice = get_invoice_or_404(db, user, invoice_id, lock=lock)
    if invoice.status != "issued":
        raise HTTPException(status_code=409, detail="Credit notes are made against issued invoices only")
    return invoice


def _apply_lines(db: Session, *, credit_note: FinanceCreditNote, invoice: FinancePosInvoice, lines: list[dict]) -> None:
    """Quantities come from the payload; prices, discount and tax from the invoice line, pro rata."""
    if not lines:
        raise HTTPException(status_code=400, detail="Credit at least one line")
    invoice_lines = {line.id: line for line in invoice.lines}
    left = creditable(db, invoice=invoice, exclude_credit_note_id=credit_note.id)
    seen: set[int] = set()
    result = []
    for index, payload in enumerate(lines):
        line_id = int(payload["invoice_line_id"])
        if line_id in seen:
            raise HTTPException(status_code=400, detail="An invoice line can appear once per credit note")
        seen.add(line_id)
        invoice_line = invoice_lines.get(line_id)
        if invoice_line is None:
            raise HTTPException(status_code=400, detail="Only this invoice's lines can be credited")
        quantity = decimal_input(payload.get("quantity"), field="Quantity", positive=True)
        if quantity > left.get(line_id, ZERO):
            raise HTTPException(status_code=409, detail=f"{invoice_line.description}: only {units(left.get(line_id, ZERO))} left to credit")
        discount = pro_rata(invoice_line.discount_amount or 0, quantity, invoice_line.quantity)
        tax = pro_rata(invoice_line.tax_amount or 0, quantity, invoice_line.quantity)
        _net, total = line_amounts(quantity=quantity, unit_price=Decimal(invoice_line.unit_price), discount=discount, tax=tax, label=invoice_line.description)
        result.append(FinanceCreditNoteLine(tenant_id=credit_note.tenant_id, invoice_line_id=line_id,
            return_line_id=payload.get("return_line_id"), description=invoice_line.description, quantity=quantity,
            unit_price=invoice_line.unit_price, discount_amount=discount, tax_amount=tax, line_total=total, sort_order=index))
    credit_note.lines = result
    _apply_totals(credit_note, invoice)


def _apply_totals(credit_note: FinanceCreditNote, invoice: FinancePosInvoice) -> None:
    """Lines, plus the invoice's header discount and tax rate in the same proportion."""
    subtotal = sum((money(Decimal(line.quantity) * Decimal(line.unit_price)) - money(line.discount_amount) for line in credit_note.lines), ZERO)
    line_tax = sum((money(line.tax_amount) for line in credit_note.lines), ZERO)
    discount = pro_rata(invoice.discount_amount or 0, subtotal, invoice.subtotal_amount or 0) if money(invoice.discount_amount) > 0 else ZERO
    taxable = max(subtotal - discount, ZERO)
    tax = line_tax + money(taxable * Decimal(invoice.tax_rate or 0) / Decimal(100))
    credit_note.subtotal_amount, credit_note.discount_amount, credit_note.tax_amount = subtotal, discount, tax
    credit_note.total_amount = money(taxable + tax)


def save_draft(db: Session, user, *, payload: dict, credit_note_id: int | None = None) -> FinanceCreditNote:
    if credit_note_id is not None:
        credit_note = get_credit_note(db, user, credit_note_id, lock=True)
        if credit_note.status != "draft":
            raise HTTPException(status_code=409, detail="Only a draft credit note can be edited")
        invoice = _issued_invoice(db, user, credit_note.invoice_id)
    else:
        invoice = _issued_invoice(db, user, int(payload["invoice_id"]))
        credit_note = FinanceCreditNote(tenant_id=user.tenant_id, invoice_id=invoice.id, status="draft", currency=invoice.currency,
            created_by=user.id)
        return_id = payload.get("return_id")
        if return_id:
            credit_note.return_id = _check_return(db, tenant_id=user.tenant_id, return_id=int(return_id), invoice=invoice)
        db.add(credit_note)
        db.flush()
    credit_note.reason = (payload.get("reason") or "").strip()[:500] or credit_note.reason
    if "notes" in payload:
        credit_note.notes = (payload.get("notes") or "").strip() or None
    if payload.get("issue_date"):
        credit_note.issue_date = payload["issue_date"] if isinstance(payload["issue_date"], date) else date.fromisoformat(str(payload["issue_date"]))
    lines = payload.get("lines")
    if lines is None and credit_note_id is None:
        lines = [{"invoice_line_id": line_id, "quantity": quantity} for line_id, quantity in creditable(db, invoice=invoice).items() if quantity > 0]
    if lines is not None:
        _apply_lines(db, credit_note=credit_note, invoice=invoice, lines=lines)
    db.add(credit_note)
    db.flush()
    _audit(db, credit_note=credit_note, actor_user_id=user.id, action="update" if credit_note_id else "create",
        description=f"{'Updated' if credit_note_id else 'Drafted'} {label(credit_note)} against {invoice.invoice_number}")
    return credit_note


def _check_return(db: Session, *, tenant_id: int, return_id: int, invoice: FinancePosInvoice) -> int:
    from app.modules.inventory.models import InventoryReturn

    doc = db.query(InventoryReturn).filter(InventoryReturn.tenant_id == tenant_id, InventoryReturn.id == return_id,
        InventoryReturn.deleted_at.is_(None)).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Return not found")
    if doc.status != "received":
        raise HTTPException(status_code=409, detail="Only a received return can be credited")
    return doc.id


def return_candidates(db: Session, user, *, return_id: int) -> dict:
    """The issued invoices that invoiced a return's order lines, with what each can credit."""
    from app.modules.inventory.models import InventoryReturn

    doc = db.query(InventoryReturn).filter(InventoryReturn.tenant_id == user.tenant_id, InventoryReturn.id == return_id,
        InventoryReturn.deleted_at.is_(None)).first()
    if doc is None:
        raise HTTPException(status_code=404, detail="Return not found")
    returned: dict[int, Decimal] = defaultdict(Decimal)
    return_line_by_item: dict[int, int] = {}
    for line in doc.lines:
        returned[line.order_line_id] += Decimal(line.quantity)
        return_line_by_item.setdefault(line.order_line_id, line.id)
    from app.modules.finance.repositories.pos_invoice_repository import build_invoice_query

    invoices = build_invoice_query(db, user).filter(FinancePosInvoice.status == "issued", FinancePosInvoice.id.in_(
        db.query(FinancePosInvoiceLine.invoice_id).filter(FinancePosInvoiceLine.sales_order_item_id.in_(list(returned) or [0])))).order_by(FinancePosInvoice.id).all()
    candidates = []
    for invoice in invoices:
        left = creditable(db, invoice=invoice)
        lines = []
        for line in invoice.lines:
            wanted = min(returned.get(line.sales_order_item_id, ZERO), left.get(line.id, ZERO)) if line.sales_order_item_id else ZERO
            if wanted > 0:
                lines.append({"invoice_line_id": line.id, "description": line.description, "quantity": wanted,
                              "return_line_id": return_line_by_item.get(line.sales_order_item_id)})
        if lines:
            candidates.append({"invoice_id": invoice.id, "invoice_number": invoice.invoice_number, "lines": lines})
    return {"return_id": doc.id, "return_number": doc.number, "status": doc.status, "candidates": candidates}


def issue(db: Session, user, credit_note_id: int) -> FinanceCreditNote:
    credit_note = get_credit_note(db, user, credit_note_id, lock=True)
    if credit_note.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft credit note can be issued")
    invoice = _issued_invoice(db, user, credit_note.invoice_id, lock=True)
    # Re-check against what other credit notes issued since this draft was saved.
    _apply_lines(db, credit_note=credit_note, invoice=invoice,
                 lines=[{"invoice_line_id": line.invoice_line_id, "quantity": line.quantity, "return_line_id": line.return_line_id} for line in credit_note.lines])
    already = money(sum((Decimal(note.total_amount) for note in db.query(FinanceCreditNote).filter(
        FinanceCreditNote.tenant_id == invoice.tenant_id, FinanceCreditNote.invoice_id == invoice.id, FinanceCreditNote.status == "issued")), ZERO))
    room = max(money(invoice.total_amount) - already, ZERO)
    remaining = creditable(db, invoice=invoice)
    fully_credited = all(remaining.get(line.invoice_line_id, ZERO) <= Decimal(line.quantity) for line in credit_note.lines) and \
        all(remaining.get(line.id, ZERO) <= 0 for line in invoice.lines if line.id not in {row.invoice_line_id for row in credit_note.lines})
    if fully_credited or money(credit_note.total_amount) > room:
        # The last credit takes exactly what is left, so rounding never leaves a cent.
        credit_note.total_amount = room
    if money(credit_note.total_amount) <= 0:
        raise HTTPException(status_code=409, detail=f"{invoice.invoice_number} has already been credited in full")
    refresh_invoice_balance(db, invoice)
    credit_note.number = allocate_business_number(db, tenant_id=credit_note.tenant_id, scope=MODULE, prefix="CN")
    credit_note.status = "issued"
    credit_note.issue_date = credit_note.issue_date or date.today()
    credit_note.issued_at, credit_note.issued_by = datetime.now(timezone.utc), user.id
    applied = min(money(credit_note.total_amount), money(invoice.balance_due))
    if applied > 0:
        db.add(FinanceCreditAllocation(tenant_id=credit_note.tenant_id, credit_note_id=credit_note.id, invoice_id=invoice.id, amount=applied))
    db.flush()
    refresh_invoice_balance(db, invoice)
    refresh_credit_note_balance(db, credit_note)
    _audit(db, credit_note=credit_note, actor_user_id=user.id, action="issue",
        description=f"Issued credit note {credit_note.number} for {credit_note.total_amount} {credit_note.currency} against {invoice.invoice_number}"
        + (f"; {credit_note.refund_due} to refund" if money(credit_note.refund_due) > 0 else ""))
    from app.modules.platform.services.crm_events import stage_standard_crm_event

    stage_standard_crm_event(db, tenant_id=credit_note.tenant_id, actor_user_id=user.id, event_type="finance.credit_note_issued",
        entity_type="finance_credit_note", entity_id=credit_note.id, payload={"number": credit_note.number,
        "invoice_number": invoice.invoice_number, "total_amount": str(credit_note.total_amount), "currency": credit_note.currency,
        "refund_due": str(credit_note.refund_due)})
    return credit_note


def void(db: Session, user, credit_note_id: int, *, reason: str) -> FinanceCreditNote:
    from app.modules.finance.services.payment_services import has_posted_payments

    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    credit_note = get_credit_note(db, user, credit_note_id, lock=True)
    if credit_note.status != "issued":
        raise HTTPException(status_code=409, detail="Only an issued credit note can be voided; remove a draft instead")
    if has_posted_payments(db, tenant_id=credit_note.tenant_id, credit_note_id=credit_note.id):
        raise HTTPException(status_code=409, detail="A refund is recorded against this credit note; void the refund first")
    invoice = db.query(FinancePosInvoice).filter(FinancePosInvoice.id == credit_note.invoice_id).with_for_update().one()
    db.query(FinanceCreditAllocation).filter(FinanceCreditAllocation.credit_note_id == credit_note.id).delete(synchronize_session=False)
    credit_note.status, credit_note.voided_at, credit_note.void_reason = "void", datetime.now(timezone.utc), reason[:500]
    db.flush()
    refresh_invoice_balance(db, invoice)
    refresh_credit_note_balance(db, credit_note)
    _audit(db, credit_note=credit_note, actor_user_id=user.id, action="void", description=f"Voided credit note {credit_note.number}: {reason}")
    return credit_note


def delete_draft(db: Session, user, credit_note_id: int) -> None:
    credit_note = get_credit_note(db, user, credit_note_id, lock=True)
    if credit_note.status != "draft":
        raise HTTPException(status_code=409, detail="Only a draft credit note can be removed; void an issued one instead")
    credit_note.deleted_at = datetime.now(timezone.utc)
    db.add(credit_note)
    _audit(db, credit_note=credit_note, actor_user_id=user.id, action="delete", description=f"Removed {label(credit_note)}")


def restore_draft(db: Session, user, credit_note_id: int) -> FinanceCreditNote:
    credit_note = get_credit_note(db, user, credit_note_id, lock=True, include_deleted=True)
    if credit_note.deleted_at is None or credit_note.status != "draft":
        raise HTTPException(status_code=404, detail="Removed draft credit note not found")
    credit_note.deleted_at = None
    db.add(credit_note)
    _audit(db, credit_note=credit_note, actor_user_id=user.id, action="restore", description=f"Restored {label(credit_note)}")
    return credit_note


def serialize(db: Session, credit_note: FinanceCreditNote, *, include_lines: bool = True) -> dict:
    invoice = credit_note.invoice
    result = {
        "id": credit_note.id, "number": credit_note.number, "status": credit_note.status, "invoice_id": credit_note.invoice_id,
        "invoice_number": invoice.invoice_number if invoice else None, "customer_name": invoice.customer_name if invoice else None,
        "customer_organization_id": invoice.customer_organization_id if invoice else None,
        "customer_contact_id": invoice.customer_contact_id if invoice else None,
        "return_id": credit_note.return_id, "reason": credit_note.reason, "issue_date": credit_note.issue_date,
        "currency": credit_note.currency, "subtotal_amount": credit_note.subtotal_amount, "discount_amount": credit_note.discount_amount,
        "tax_amount": credit_note.tax_amount, "total_amount": credit_note.total_amount, "refund_due": credit_note.refund_due,
        "applied_amount": None, "notes": credit_note.notes, "issued_at": credit_note.issued_at, "voided_at": credit_note.voided_at,
        "void_reason": credit_note.void_reason, "created_at": credit_note.created_at, "updated_at": credit_note.updated_at,
        "is_deleted": credit_note.deleted_at is not None,
    }
    if include_lines:
        from app.modules.finance.services.invoice_balances import credit_applied
        from app.modules.finance.services.payment_services import payments_for

        result["applied_amount"] = credit_applied(db, tenant_id=credit_note.tenant_id, credit_note_id=credit_note.id)
        left = creditable(db, invoice=invoice, exclude_credit_note_id=credit_note.id) if invoice else {}
        result["lines"] = [{"id": line.id, "invoice_line_id": line.invoice_line_id, "return_line_id": line.return_line_id,
                            "description": line.description, "quantity": line.quantity, "unit_price": line.unit_price,
                            "discount_amount": line.discount_amount, "tax_amount": line.tax_amount, "line_total": line.line_total,
                            "creditable": left.get(line.invoice_line_id, ZERO)} for line in credit_note.lines]
        result["refunds"] = payments_for(db, tenant_id=credit_note.tenant_id, credit_note_id=credit_note.id)
    return result


def invoice_credit_notes(db: Session, *, tenant_id: int, invoice_id: int) -> list[dict]:
    rows = db.query(FinanceCreditNote).filter(FinanceCreditNote.tenant_id == tenant_id, FinanceCreditNote.invoice_id == invoice_id,
        FinanceCreditNote.deleted_at.is_(None)).order_by(FinanceCreditNote.id).all()
    return [serialize(db, row, include_lines=False) for row in rows]


def list_query(db: Session, user, *, status: str | None = None, search: str | None = None, invoice_id: int | None = None):
    """The credit note list's rows, in the finance scope. The list and its export both start here (13a A5)."""
    query = _scoped(db.query(FinanceCreditNote).filter(FinanceCreditNote.tenant_id == user.tenant_id, FinanceCreditNote.deleted_at.is_(None)), db, user)
    if status in {"draft", "issued", "void"}:
        query = query.filter(FinanceCreditNote.status == status)
    elif status == "refund_due":
        query = query.filter(FinanceCreditNote.status == "issued", FinanceCreditNote.refund_due > 0)
    if invoice_id:
        query = query.filter(FinanceCreditNote.invoice_id == invoice_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        matching = db.query(FinancePosInvoice.id).filter(FinancePosInvoice.tenant_id == user.tenant_id, or_(
            FinancePosInvoice.invoice_number.ilike(pattern), FinancePosInvoice.customer_name.ilike(pattern)))
        query = query.filter(or_(FinanceCreditNote.number.ilike(pattern), FinanceCreditNote.reason.ilike(pattern),
            FinanceCreditNote.invoice_id.in_(matching)))
    return query


def list_credit_notes(db: Session, user, *, pagination: Pagination, status: str | None = None, search: str | None = None,
                      invoice_id: int | None = None) -> dict:
    query = list_query(db, user, status=status, search=search, invoice_id=invoice_id)
    total = query.count()
    rows = query.order_by(FinanceCreditNote.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response([serialize(db, row, include_lines=False) for row in rows], total, pagination)
