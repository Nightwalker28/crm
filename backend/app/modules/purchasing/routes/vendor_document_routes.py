"""Vendor returns and vendor credits (13c §3.6–3.7). Every route clears the three access layers."""

from datetime import date
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.list_conditions import ListConditions, list_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_access, require_action_access, require_module_access
from app.core.security import require_user
from app.core.unit_of_work import unit_of_work
from app.modules.platform.services.document_exports import start_document_export
from app.modules.platform.services.write_rules import apply_user_write_rules
from app.modules.purchasing.models import PurchaseVendorCredit, PurchaseVendorReturn
from app.modules.purchasing.services import vendor_credit_services as credits
from app.modules.purchasing.services import vendor_return_services as returns

router = APIRouter(prefix="/purchasing", tags=["Purchasing vendor documents"])

RETURNS = "purchase_vendor_returns"
CREDITS = "purchase_vendor_credits"


class ReasonPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


# --- Vendor returns -------------------------------------------------------------------------


class ReturnLinePayload(BaseModel):
    receipt_line_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0)


class ReturnPayload(BaseModel):
    custom_fields: dict[str, Any] | None = None
    reason: str | None = Field(default=None, max_length=120)
    resolution: Literal["credit", "replace"] | None = None
    notes: str | None = None
    # Omitted on create: everything the receipt brought in that is not yet returned.
    lines: list[ReturnLinePayload] | None = Field(default=None, min_length=1)


class ReturnCreatePayload(ReturnPayload):
    receipt_id: int = Field(gt=0)


def _return(db: Session, tenant_id: int, return_id: int) -> dict:
    return jsonable_encoder(returns.serialize_return(db, tenant_id=tenant_id, doc=returns.return_or_404(db, tenant_id=tenant_id, return_id=return_id)))


@router.get("/vendor-returns")
def list_returns(status: str | None = Query(default=None, pattern="^(draft|shipped|cancelled)$"), receipt_id: int | None = Query(default=None, gt=0),
                 search: str | None = Query(default=None, max_length=100), conditions: ListConditions = Depends(list_conditions),
                 pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(RETURNS)), _view=Depends(require_action_access(RETURNS, "view"))):
    query = returns.list_query(db, tenant_id=user.tenant_id, status=status, receipt_id=receipt_id, search=search, **conditions.as_filters())
    total = query.count()
    rows = query.order_by(PurchaseVendorReturn.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(jsonable_encoder([returns.serialize_return(db, tenant_id=user.tenant_id, doc=row, include_lines=False) for row in rows]),
                                total, pagination)


@router.post("/vendor-returns", status_code=201)
def create_return(payload: ReturnCreatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(RETURNS)), _create=Depends(require_action_access(RETURNS, "create"))):
    require_access(db, user, "purchase_receipts", "view", detail="Returning goods needs access to their receipt")
    data = apply_user_write_rules(db, tenant_id=user.tenant_id, module_key=RETURNS, payload=payload.model_dump())
    if data.get("lines") is None:
        data.pop("lines", None)
    with unit_of_work(db):
        doc = returns.save_return(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=data)
    return _return(db, user.tenant_id, doc.id)


@router.post("/vendor-returns/export-job", status_code=202)
def export_returns(status: str | None = Query(default=None, pattern="^(draft|shipped|cancelled)$"), receipt_id: int | None = Query(default=None, gt=0),
                   search: str | None = Query(default=None, max_length=100), conditions: ListConditions = Depends(list_conditions),
                   db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(RETURNS)), _export=Depends(require_action_access(RETURNS, "export"))):
    return start_document_export(db, user, module_key=RETURNS, filters={"status": status, "receipt_id": receipt_id, "search": search,
                                                                       **conditions.as_filters()})


@router.get("/vendor-returns/{return_id}")
def get_return(return_id: int, db: Session = Depends(get_db), user=Depends(require_user),
               _module=Depends(require_module_access(RETURNS)), _view=Depends(require_action_access(RETURNS, "view"))):
    return _return(db, user.tenant_id, return_id)


@router.patch("/vendor-returns/{return_id}")
def update_return(return_id: int, payload: ReturnPayload, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(RETURNS)), _edit=Depends(require_action_access(RETURNS, "edit"))):
    data = apply_user_write_rules(db, tenant_id=user.tenant_id, module_key=RETURNS, payload=payload.model_dump(exclude_unset=True), record_id=return_id)
    with unit_of_work(db):
        returns.save_return(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=data, return_id=return_id)
    return _return(db, user.tenant_id, return_id)


@router.post("/vendor-returns/{return_id}/ship")
def ship_return(return_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(RETURNS)), _edit=Depends(require_action_access(RETURNS, "edit"))):
    with unit_of_work(db):
        returns.ship_return(db, tenant_id=user.tenant_id, actor_user_id=user.id, return_id=return_id)
    return _return(db, user.tenant_id, return_id)


@router.post("/vendor-returns/{return_id}/cancel")
def cancel_return(return_id: int, payload: ReasonPayload, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(RETURNS)), _edit=Depends(require_action_access(RETURNS, "edit"))):
    with unit_of_work(db):
        returns.cancel_return(db, tenant_id=user.tenant_id, actor_user_id=user.id, return_id=return_id, reason=payload.reason)
    return _return(db, user.tenant_id, return_id)


@router.delete("/vendor-returns/{return_id}", status_code=204)
def delete_return(return_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(RETURNS)), _delete=Depends(require_action_access(RETURNS, "delete"))):
    with unit_of_work(db):
        returns.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, return_id=return_id)


@router.post("/vendor-returns/{return_id}/restore")
def restore_return(return_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(RETURNS)), _restore=Depends(require_action_access(RETURNS, "restore"))):
    with unit_of_work(db):
        returns.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, return_id=return_id)
    return _return(db, user.tenant_id, return_id)


@router.get("/receipts/{receipt_id}/vendor-returns")
def receipt_returns(receipt_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access("purchase_receipts")), _view=Depends(require_action_access("purchase_receipts", "view"))):
    """The returns against a receipt, for its page; empty without access to vendor returns."""
    from app.core.permissions import can_access

    if not can_access(db, user, RETURNS, "view"):
        return {"results": []}
    return {"results": jsonable_encoder(returns.receipt_returns(db, tenant_id=user.tenant_id, receipt_id=receipt_id))}


# --- Vendor credits -------------------------------------------------------------------------


class CreditLinePayload(BaseModel):
    bill_line_id: int | None = Field(default=None, gt=0)
    vendor_return_line_id: int | None = Field(default=None, gt=0)
    catalog_product_id: int | None = Field(default=None, gt=0)
    catalog_service_id: int | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, max_length=2000)
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    tax_amount: Decimal | None = Field(default=None, ge=0)
    # 13d §3.1: a rate, or `tax_manual` to keep the typed tax (0 = no tax); neither = the default.
    tax_rate_id: int | None = Field(default=None, gt=0)
    tax_manual: bool = False


class CreditPayload(BaseModel):
    custom_fields: dict[str, Any] | None = None
    vendor_id: int | None = Field(default=None, gt=0)
    vendor_reference: str | None = Field(default=None, max_length=120)
    credit_date: date | None = None
    currency: str | None = Field(default=None, max_length=10)
    reason: str | None = Field(default=None, max_length=500)
    notes: str | None = None
    # Omitted on create from a bill or a return: what is left to credit on it.
    lines: list[CreditLinePayload] | None = Field(default=None, min_length=1)


class CreditCreatePayload(CreditPayload):
    bill_id: int | None = Field(default=None, gt=0)
    vendor_return_id: int | None = Field(default=None, gt=0)


class ApplicationPayload(BaseModel):
    bill_id: int = Field(gt=0)
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)


class ApplyPayload(BaseModel):
    allocations: list[ApplicationPayload] = Field(min_length=1, max_length=50)


def _credit(db: Session, tenant_id: int, credit_id: int) -> dict:
    return jsonable_encoder(credits.serialize_credit(db, tenant_id=tenant_id, credit=credits.credit_or_404(db, tenant_id=tenant_id, credit_id=credit_id)))


@router.get("/vendor-credits")
def list_credits(status: str | None = Query(default=None, pattern="^(draft|issued|void|open)$"), bill_id: int | None = Query(default=None, gt=0),
                 vendor_id: int | None = Query(default=None, gt=0), search: str | None = Query(default=None, max_length=100),
                 conditions: ListConditions = Depends(list_conditions), pagination: Pagination = Depends(get_pagination),
                 db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(CREDITS)), _view=Depends(require_action_access(CREDITS, "view"))):
    query = credits.list_query(db, tenant_id=user.tenant_id, status=status, bill_id=bill_id, vendor_id=vendor_id, search=search, **conditions.as_filters())
    total = query.count()
    rows = query.order_by(PurchaseVendorCredit.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(jsonable_encoder([credits.serialize_credit(db, tenant_id=user.tenant_id, credit=row, include_lines=False) for row in rows]),
                                total, pagination)


@router.post("/vendor-credits", status_code=201)
def create_credit(payload: CreditCreatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(CREDITS)), _create=Depends(require_action_access(CREDITS, "create"))):
    if payload.bill_id:
        require_access(db, user, "purchase_bills", "view", detail="Crediting a bill needs access to bills")
    if payload.vendor_return_id:
        require_access(db, user, RETURNS, "view", detail="Crediting a return needs access to vendor returns")
    data = apply_user_write_rules(db, tenant_id=user.tenant_id, module_key=CREDITS, payload=payload.model_dump())
    if data.get("lines") is None:
        data.pop("lines", None)
    with unit_of_work(db):
        credit = credits.save_credit(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=data)
    return _credit(db, user.tenant_id, credit.id)


@router.post("/vendor-credits/export-job", status_code=202)
def export_credits(status: str | None = Query(default=None, pattern="^(draft|issued|void|open)$"), bill_id: int | None = Query(default=None, gt=0),
                   vendor_id: int | None = Query(default=None, gt=0), search: str | None = Query(default=None, max_length=100),
                   conditions: ListConditions = Depends(list_conditions), db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(CREDITS)), _export=Depends(require_action_access(CREDITS, "export"))):
    return start_document_export(db, user, module_key=CREDITS, filters={"status": status, "bill_id": bill_id, "vendor_id": vendor_id,
                                                                       "search": search, **conditions.as_filters()})


@router.get("/vendor-credits/{credit_id}")
def get_credit(credit_id: int, db: Session = Depends(get_db), user=Depends(require_user),
               _module=Depends(require_module_access(CREDITS)), _view=Depends(require_action_access(CREDITS, "view"))):
    return _credit(db, user.tenant_id, credit_id)


@router.patch("/vendor-credits/{credit_id}")
def update_credit(credit_id: int, payload: CreditPayload, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(CREDITS)), _edit=Depends(require_action_access(CREDITS, "edit"))):
    data = apply_user_write_rules(db, tenant_id=user.tenant_id, module_key=CREDITS, payload=payload.model_dump(exclude_unset=True), record_id=credit_id)
    with unit_of_work(db):
        credits.save_credit(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=data, credit_id=credit_id)
    return _credit(db, user.tenant_id, credit_id)


@router.post("/vendor-credits/{credit_id}/issue")
def issue_credit(credit_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(CREDITS)), _edit=Depends(require_action_access(CREDITS, "edit"))):
    with unit_of_work(db):
        credits.issue_credit(db, tenant_id=user.tenant_id, actor_user_id=user.id, credit_id=credit_id)
    return _credit(db, user.tenant_id, credit_id)


@router.post("/vendor-credits/{credit_id}/apply")
def apply_credit(credit_id: int, payload: ApplyPayload, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(CREDITS)), _edit=Depends(require_action_access(CREDITS, "edit"))):
    """*Apply to bills*: split what is left over the vendor's open bills (13c §3.6)."""
    require_access(db, user, "purchase_bills", "view", detail="Applying a credit needs access to bills")
    with unit_of_work(db):
        credits.apply_to_bills(db, tenant_id=user.tenant_id, actor_user_id=user.id, credit_id=credit_id,
                               allocations=[row.model_dump() for row in payload.allocations])
    return _credit(db, user.tenant_id, credit_id)


@router.post("/vendor-credits/{credit_id}/void")
def void_credit(credit_id: int, payload: ReasonPayload, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(CREDITS)), _edit=Depends(require_action_access(CREDITS, "edit"))):
    with unit_of_work(db):
        credits.void_credit(db, tenant_id=user.tenant_id, actor_user_id=user.id, credit_id=credit_id, reason=payload.reason)
    return _credit(db, user.tenant_id, credit_id)


@router.delete("/vendor-credits/{credit_id}", status_code=204)
def delete_credit(credit_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(CREDITS)), _delete=Depends(require_action_access(CREDITS, "delete"))):
    with unit_of_work(db):
        credits.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, credit_id=credit_id)


@router.post("/vendor-credits/{credit_id}/restore")
def restore_credit(credit_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(CREDITS)), _restore=Depends(require_action_access(CREDITS, "restore"))):
    with unit_of_work(db):
        credits.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, credit_id=credit_id)
    return _credit(db, user.tenant_id, credit_id)
