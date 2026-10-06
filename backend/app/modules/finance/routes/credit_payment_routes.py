"""Credit notes and payments (12c-erp-invoicing.md §3.4). Every route clears the three
access layers for its own module; recording money against a document also needs `view` on
that document's module."""

from datetime import date
from decimal import Decimal

from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.pagination import Pagination, get_pagination
from app.core.permissions import require_access, require_action_access, require_module_access
from app.core.security import require_user
from app.modules.finance.services import credit_note_services, payment_services
from app.modules.platform.services.document_exports import start_document_export
from sqlalchemy.orm import Session

router = APIRouter(tags=["Finance credit notes and payments"])

CREDIT_NOTES = "finance_credit_notes"
PAYMENTS = "finance_payments"




class CreditLinePayload(BaseModel):
    invoice_line_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0)
    return_line_id: int | None = Field(default=None, gt=0)


class CreditNotePayload(BaseModel):
    custom_fields: dict[str, Any] | None = None
    reason: str | None = Field(default=None, max_length=500)
    notes: str | None = None
    issue_date: date | None = None
    # Omitted on create: everything still creditable on the invoice.
    lines: list[CreditLinePayload] | None = Field(default=None, min_length=1)


class CreditNoteCreatePayload(CreditNotePayload):
    invoice_id: int = Field(gt=0)
    return_id: int | None = Field(default=None, gt=0)


class ReasonPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class AllocationPayload(BaseModel):
    invoice_id: int | None = Field(default=None, gt=0)
    credit_note_id: int | None = Field(default=None, gt=0)
    bill_id: int | None = Field(default=None, gt=0)
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)


class PaymentPayload(BaseModel):
    custom_fields: dict[str, Any] | None = None
    direction: str = Field(pattern="^(received|made)$")
    kind: str = Field(default="payment", pattern="^(payment|refund)$")
    paid_on: date | None = None
    method: str | None = Field(default=None, max_length=100)
    reference: str | None = Field(default=None, max_length=200)
    notes: str | None = None
    amount: Decimal | None = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    # A list so that one payment over several documents is additive later; one today (12c §5a).
    allocations: list[AllocationPayload] = Field(min_length=1, max_length=1)


def _credit_note(db: Session, user, credit_note_id: int) -> dict:
    return jsonable_encoder(credit_note_services.serialize(db, credit_note_services.get_credit_note(db, user, credit_note_id)))


# Credit notes ------------------------------------------------------------------------------

@router.get("/credit-notes")
def list_credit_notes(status_filter: str | None = Query(default=None, alias="status", pattern="^(draft|issued|void|refund_due)$"),
                      invoice_id: int | None = Query(default=None, gt=0), search: str | None = Query(default=None, max_length=100),
                      pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user),
                      _module=Depends(require_module_access(CREDIT_NOTES)), _view=Depends(require_action_access(CREDIT_NOTES, "view"))):
    return jsonable_encoder(credit_note_services.list_credit_notes(db, user, pagination=pagination, status=status_filter, search=search, invoice_id=invoice_id))


@router.get("/credit-notes/return-candidates")
def credit_note_return_candidates(return_id: int = Query(gt=0), db: Session = Depends(get_db), user=Depends(require_user),
                                  _module=Depends(require_module_access(CREDIT_NOTES)), _create=Depends(require_action_access(CREDIT_NOTES, "create"))):
    """The invoices a return can be credited against, with the quantities to credit."""
    require_access(db, user, "inventory_returns", "view", detail="Crediting a return needs access to returns")
    return jsonable_encoder(credit_note_services.return_candidates(db, user, return_id=return_id))


@router.post("/credit-notes", status_code=201)
def create_credit_note(payload: CreditNoteCreatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                       _module=Depends(require_module_access(CREDIT_NOTES)), _create=Depends(require_action_access(CREDIT_NOTES, "create"))):
    require_access(db, user, "finance_pos", "view", detail="Crediting an invoice needs access to invoices")
    if payload.return_id:
        require_access(db, user, "inventory_returns", "view", detail="Crediting a return needs access to returns")
    data = payload.model_dump()
    if data.get("lines") is None:
        data.pop("lines", None)
    credit_note = credit_note_services.save_draft(db, user, payload=data)
    db.commit()
    return _credit_note(db, user, credit_note.id)


@router.post("/credit-notes/export-job", status_code=202)
def export_credit_notes(status_filter: str | None = Query(default=None, alias="status", pattern="^(draft|issued|void|refund_due)$"),
        invoice_id: int | None = Query(default=None, gt=0), search: str | None = Query(default=None, max_length=100), db: Session = Depends(get_db), user=Depends(require_user),
        _module=Depends(require_module_access(CREDIT_NOTES)), _export=Depends(require_action_access(CREDIT_NOTES, "export"))):
    """Exports what the list shows under the same filters (13a A5)."""
    return start_document_export(db, user, module_key=CREDIT_NOTES, filters={"status": status_filter, "search": search, "invoice_id": invoice_id})


@router.get("/credit-notes/{credit_note_id}")
def get_credit_note(credit_note_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access(CREDIT_NOTES)), _view=Depends(require_action_access(CREDIT_NOTES, "view"))):
    return _credit_note(db, user, credit_note_id)


@router.put("/credit-notes/{credit_note_id}")
def update_credit_note(credit_note_id: int, payload: CreditNotePayload, db: Session = Depends(get_db), user=Depends(require_user),
                       _module=Depends(require_module_access(CREDIT_NOTES)), _edit=Depends(require_action_access(CREDIT_NOTES, "edit"))):
    data = payload.model_dump(exclude_unset=True)
    credit_note_services.save_draft(db, user, payload=data, credit_note_id=credit_note_id)
    db.commit()
    return _credit_note(db, user, credit_note_id)


@router.post("/credit-notes/{credit_note_id}/issue")
def issue_credit_note(credit_note_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                      _module=Depends(require_module_access(CREDIT_NOTES)), _edit=Depends(require_action_access(CREDIT_NOTES, "edit"))):
    credit_note_services.issue(db, user, credit_note_id)
    db.commit()
    return _credit_note(db, user, credit_note_id)


@router.post("/credit-notes/{credit_note_id}/void")
def void_credit_note(credit_note_id: int, payload: ReasonPayload, db: Session = Depends(get_db), user=Depends(require_user),
                     _module=Depends(require_module_access(CREDIT_NOTES)), _edit=Depends(require_action_access(CREDIT_NOTES, "edit"))):
    credit_note_services.void(db, user, credit_note_id, reason=payload.reason)
    db.commit()
    return _credit_note(db, user, credit_note_id)


@router.delete("/credit-notes/{credit_note_id}", status_code=204)
def delete_credit_note(credit_note_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                       _module=Depends(require_module_access(CREDIT_NOTES)), _delete=Depends(require_action_access(CREDIT_NOTES, "delete"))):
    credit_note_services.delete_draft(db, user, credit_note_id)
    db.commit()


@router.post("/credit-notes/{credit_note_id}/restore")
def restore_credit_note(credit_note_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                        _module=Depends(require_module_access(CREDIT_NOTES)), _restore=Depends(require_action_access(CREDIT_NOTES, "restore"))):
    credit_note_services.restore_draft(db, user, credit_note_id)
    db.commit()
    return _credit_note(db, user, credit_note_id)


# Payments ----------------------------------------------------------------------------------

@router.get("/payments")
def list_payments(direction: str | None = Query(default=None, pattern="^(received|made)$"),
                  status_filter: str | None = Query(default=None, alias="status", pattern="^(posted|void)$"),
                  method: str | None = Query(default=None, max_length=100), search: str | None = Query(default=None, max_length=100),
                  date_from: date | None = None, date_to: date | None = None,
                  sort_by: str | None = Query(default=None, max_length=40), sort_direction: str | None = Query(default=None, pattern="^(asc|desc)$"),
                  pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(PAYMENTS)), _view=Depends(require_action_access(PAYMENTS, "view"))):
    return jsonable_encoder(payment_services.list_payments(db, user, pagination=pagination, search=search, direction=direction,
        status=status_filter, method=method, date_from=date_from, date_to=date_to, sort_by=sort_by, sort_direction=sort_direction))


@router.post("/payments", status_code=201)
def record_payment(payload: PaymentPayload, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(PAYMENTS)), _create=Depends(require_action_access(PAYMENTS, "create"))):
    for allocation in payload.allocations:
        if allocation.invoice_id:
            require_access(db, user, "finance_pos", "view", detail="Recording a payment on an invoice needs access to invoices")
        elif allocation.credit_note_id:
            require_access(db, user, CREDIT_NOTES, "view", detail="Recording a refund needs access to credit notes")
        elif allocation.bill_id:
            require_access(db, user, "purchase_bills", "view", detail="Paying a bill needs access to bills")
    payment = payment_services.record_payment(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(), finance_user=user)
    db.commit()
    return jsonable_encoder(payment_services.serialize_payments(db, [payment_services.get_payment(db, user, payment.id)])[0])


@router.post("/payments/export-job", status_code=202)
def export_payments(direction: str | None = Query(default=None, pattern="^(received|made)$"),
        status_filter: str | None = Query(default=None, alias="status", pattern="^(posted|void)$"),
        method: str | None = Query(default=None, max_length=100), search: str | None = Query(default=None, max_length=100),
        date_from: date | None = None, date_to: date | None = None, db: Session = Depends(get_db), user=Depends(require_user),
        _module=Depends(require_module_access(PAYMENTS)), _export=Depends(require_action_access(PAYMENTS, "export"))):
    """Exports what the list shows under the same filters (13a A5)."""
    return start_document_export(db, user, module_key=PAYMENTS, filters={"direction": direction, "status": status_filter, "method": method, "search": search, "date_from": date_from, "date_to": date_to})


@router.get("/payments/{payment_id}")
def get_payment(payment_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(PAYMENTS)), _view=Depends(require_action_access(PAYMENTS, "view"))):
    return jsonable_encoder(payment_services.serialize_payments(db, [payment_services.get_payment(db, user, payment_id)])[0])


@router.post("/payments/{payment_id}/void")
def void_payment(payment_id: int, payload: ReasonPayload, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(PAYMENTS)), _edit=Depends(require_action_access(PAYMENTS, "edit"))):
    payment_services.void_payment(db, user, payment_id, reason=payload.reason)
    db.commit()
    return jsonable_encoder(payment_services.serialize_payments(db, [payment_services.get_payment(db, user, payment_id)])[0])
