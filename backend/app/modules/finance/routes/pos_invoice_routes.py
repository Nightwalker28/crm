from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, get_pagination
from app.core.permissions import require_action_access
from app.core.security import get_current_user
from app.modules.finance.schema import (
    PosInvoiceCreateRequest,
    PosInvoiceListResponse,
    PosInvoiceResponse,
    PosInvoiceUpdateRequest,
)
from app.modules.finance.services import pos_invoice_services

router = APIRouter(tags=["Finance POS"])


@router.get("/pos-invoices", response_model=PosInvoiceListResponse)
def list_pos_invoices(
    pagination: Pagination = Depends(get_pagination),
    search: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_permission=Depends(require_action_access("finance_pos", "view")),
):
    return pos_invoice_services.list_invoices(
        db,
        current_user,
        pagination=pagination,
        search=search,
        status_filter=status_filter,
    )


@router.post("/pos-invoices", response_model=PosInvoiceResponse, status_code=status.HTTP_201_CREATED)
def create_pos_invoice(
    payload: PosInvoiceCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_permission=Depends(require_action_access("finance_pos", "create")),
):
    invoice = pos_invoice_services.create_invoice(db, current_user, payload.model_dump())
    return pos_invoice_services.serialize_invoice(invoice, current_user=current_user)


@router.get("/pos-invoices/{invoice_id}", response_model=PosInvoiceResponse)
def get_pos_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_permission=Depends(require_action_access("finance_pos", "view")),
):
    invoice = pos_invoice_services.get_invoice_or_404(db, current_user, invoice_id)
    return pos_invoice_services.serialize_invoice(invoice, current_user=current_user)


@router.put("/pos-invoices/{invoice_id}", response_model=PosInvoiceResponse)
def update_pos_invoice(
    invoice_id: int,
    payload: PosInvoiceUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_permission=Depends(require_action_access("finance_pos", "edit")),
):
    invoice = pos_invoice_services.update_invoice(
        db,
        current_user,
        invoice_id,
        payload.model_dump(exclude_unset=True),
    )
    return pos_invoice_services.serialize_invoice(invoice, current_user=current_user)


@router.delete("/pos-invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pos_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_permission=Depends(require_action_access("finance_pos", "delete")),
):
    pos_invoice_services.soft_delete_invoice(db, current_user, invoice_id)
