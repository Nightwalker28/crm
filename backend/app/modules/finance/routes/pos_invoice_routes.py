from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import get_current_user
from app.modules.catalog.services.line_links import catalog_links_of, require_catalog_line_link_access
from app.core.access_control import PermissionPolicy
from app.modules.finance.schema import (
    InvoiceFromSourcesRequest,
    PosInvoiceCreateRequest,
    PosInvoiceListResponse,
    PosInvoicePaymentRequest,
    PosInvoiceResponse,
    PosInvoiceUpdateRequest,
    ReasonRequest,
)
from app.modules.finance.services import credit_note_services, invoicing_services, payment_services, pos_invoice_services

router = APIRouter(tags=["Finance POS"])

INVOICES = "finance_pos"


def _require(db: Session, user, module: str, action: str, message: str) -> None:
    """A second module's permission, checked in the route (all three layers via the policy)."""
    policy = PermissionPolicy(db, user)
    if not (policy.can_view_module(module) and policy.can_perform_action(module, action)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=message)


def _detail(db: Session, current_user, invoice) -> dict:
    data = pos_invoice_services.serialize_invoice(invoice, current_user=current_user)
    policy = PermissionPolicy(db, current_user)
    if policy.can_view_module("finance_payments") and policy.can_perform_action("finance_payments", "view"):
        data["payments"] = jsonable_encoder(payment_services.payments_for(db, tenant_id=current_user.tenant_id, invoice_id=invoice.id))
    if policy.can_view_module("finance_credit_notes") and policy.can_perform_action("finance_credit_notes", "view"):
        data["credit_notes"] = jsonable_encoder(credit_note_services.invoice_credit_notes(db, tenant_id=current_user.tenant_id, invoice_id=invoice.id))
        if invoice.status == "issued":
            left = credit_note_services.creditable(db, invoice=invoice)
            for line in data.get("lines", []):
                line["creditable"] = float(left.get(line["id"], 0))
    if invoice.sales_order_id:
        from app.modules.sales.models import SalesOrder

        data["sales_order_number"] = db.query(SalesOrder.order_number).filter(SalesOrder.tenant_id == current_user.tenant_id,
            SalesOrder.id == invoice.sales_order_id).scalar()
    return data


@router.get("/pos-invoices", response_model=PosInvoiceListResponse)
def list_pos_invoices(
    pagination: Pagination = Depends(get_pagination),
    search: str | None = Query(default=None, max_length=100),
    status_filter: str | None = Query(default=None, alias="status"),
    payment_status_filter: str | None = Query(default=None, alias="payment_status"),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    sort_by: str | None = Query(default=None),
    sort_direction: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access("finance_pos")),
    require_permission=Depends(require_action_access("finance_pos", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return pos_invoice_services.list_invoices(
        db,
        current_user,
        pagination=pagination,
        search=search,
        status_filter=status_filter,
        payment_status_filter=payment_status_filter,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )


@router.get("/pos-invoices/cursor")
def list_pos_invoices_cursor(
    pagination: CursorPagination = Depends(get_cursor_pagination),
    search: str | None = Query(default=None, max_length=100),
    status_filter: str | None = Query(default=None, alias="status"),
    payment_status_filter: str | None = Query(default=None, alias="payment_status"),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access("finance_pos")),
    require_permission=Depends(require_action_access("finance_pos", "view")),
):
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    invoices = pos_invoice_services.list_invoices_cursor(
        db,
        current_user,
        limit=pagination.limit,
        cursor=pagination.cursor,
        search=search,
        status_filter=status_filter,
        payment_status_filter=payment_status_filter,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    return build_cursor_response(
        invoices,
        limit=pagination.limit,
        id_attr="id",
        serializer=lambda invoice: pos_invoice_services.serialize_invoice(invoice, current_user=current_user, include_lines=False),
    )


@router.post("/pos-invoices", response_model=PosInvoiceResponse, status_code=status.HTTP_201_CREATED)
def create_pos_invoice(
    payload: PosInvoiceCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "create")),
):
    invoice_payload = payload.model_dump()
    require_catalog_line_link_access(db, user=current_user, lines=invoice_payload.get("lines"))
    if invoice_payload.get("issue") or invoice_payload.get("paid_now"):
        _require(db, current_user, INVOICES, "edit", "Issuing an invoice needs edit access to invoices")
    if invoice_payload.get("paid_now"):
        _require(db, current_user, "finance_payments", "create", "Recording a payment needs access to payments")
    invoice = pos_invoice_services.create_invoice(db, current_user, invoice_payload)
    return _detail(db, current_user, invoice)


@router.post("/pos-invoices/from-order", response_model=PosInvoiceResponse, status_code=status.HTTP_201_CREATED)
def create_invoice_from_order(
    payload: InvoiceFromSourcesRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "create")),
):
    """A draft with what is left to invoice on an order, or on one of its deliveries."""
    _require(db, current_user, "sales_orders", "view", "Invoicing an order needs access to orders")
    if any(source.delivery_id for source in payload.sources):
        _require(db, current_user, "inventory_deliveries", "view", "Invoicing a delivery needs access to deliveries")
    invoice = invoicing_services.draft_from_sources(db, current_user, sources=[source.model_dump() for source in payload.sources])
    return _detail(db, current_user, invoice)


@router.post("/pos-invoices/export-job", status_code=status.HTTP_202_ACCEPTED)
def export_pos_invoices(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "export")),
):
    from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_export_job

    job = create_data_transfer_job(db, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, module_key=INVOICES, operation_type="export", payload={})
    enqueue_export_job(job.id)
    return {"job_id": job.id}


@router.get("/pos-invoices/{invoice_id}", response_model=PosInvoiceResponse)
def get_pos_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "view")),
):
    invoice = pos_invoice_services.get_invoice_or_404(db, current_user, invoice_id)
    return _detail(db, current_user, invoice)


@router.put("/pos-invoices/{invoice_id}", response_model=PosInvoiceResponse)
def update_pos_invoice(
    invoice_id: int,
    payload: PosInvoiceUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "edit")),
):
    update_payload = payload.model_dump(exclude_unset=True)
    if update_payload.get("lines") is not None:
        existing = pos_invoice_services.get_invoice_or_404(db, current_user, invoice_id)
        require_catalog_line_link_access(db, user=current_user, lines=update_payload["lines"], existing_links=catalog_links_of(existing.lines))
    invoice = pos_invoice_services.update_invoice(db, current_user, invoice_id, update_payload)
    return _detail(db, current_user, invoice)


@router.post("/pos-invoices/{invoice_id}/issue", response_model=PosInvoiceResponse)
def issue_pos_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "edit")),
):
    invoice = pos_invoice_services.issue_invoice(db, current_user, invoice_id)
    return _detail(db, current_user, invoice)


@router.post("/pos-invoices/{invoice_id}/void", response_model=PosInvoiceResponse)
def void_pos_invoice(
    invoice_id: int,
    payload: ReasonRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "edit")),
):
    invoice = pos_invoice_services.void_invoice(db, current_user, invoice_id, reason=payload.reason)
    return _detail(db, current_user, invoice)


@router.post("/pos-invoices/{invoice_id}/void-and-copy", response_model=PosInvoiceResponse, status_code=status.HTTP_201_CREATED)
def void_and_copy_pos_invoice(
    invoice_id: int,
    payload: ReasonRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "edit")),
):
    """Void, then open a draft copy to correct (returns the copy)."""
    _require(db, current_user, INVOICES, "create", "Opening a corrected copy needs create access to invoices")
    copy = pos_invoice_services.void_and_copy(db, current_user, invoice_id, reason=payload.reason)
    return _detail(db, current_user, copy)


@router.post("/pos-invoices/{invoice_id}/payments", response_model=PosInvoiceResponse)
def record_pos_invoice_payment(
    invoice_id: int,
    payload: PosInvoicePaymentRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "view")),
):
    """Kept from before E5: records one payment against this invoice."""
    _require(db, current_user, "finance_payments", "create", "Recording a payment needs access to payments")
    invoice = pos_invoice_services.record_invoice_payment(
        db,
        current_user,
        invoice_id,
        amount=payload.amount,
        payment_method=payload.payment_method,
        paid_on=payload.paid_on,
        reference=payload.reference,
    )
    return _detail(db, current_user, invoice)


@router.delete("/pos-invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pos_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    require_module=Depends(require_module_access(INVOICES)),
    require_permission=Depends(require_action_access(INVOICES, "delete")),
):
    pos_invoice_services.soft_delete_invoice(db, current_user, invoice_id)
