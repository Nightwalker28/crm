"""Vendor bills (12c-erp-invoicing.md §3.4). Every route clears the three access layers."""

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.access_control import PermissionPolicy
from app.core.database import get_db
from app.core.pagination import Pagination, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_export_job
from app.modules.purchasing.services import bill_services as bills

router = APIRouter(prefix="/purchasing", tags=["Purchasing bills"])

BILLS = "purchase_bills"


class BillLinePayload(BaseModel):
    order_line_id: int | None = Field(default=None, gt=0)
    receipt_line_id: int | None = Field(default=None, gt=0)
    catalog_product_id: int | None = Field(default=None, gt=0)
    catalog_service_id: int | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, max_length=2000)
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    tax_amount: Decimal = Field(default=Decimal(0), ge=0)


class BillPayload(BaseModel):
    vendor_id: int | None = Field(default=None, gt=0)
    vendor_invoice_number: str | None = Field(default=None, max_length=120)
    bill_date: date | None = None
    due_date: date | None = None
    currency: str | None = Field(default=None, max_length=10)
    notes: str | None = None
    # Omitted on create from a PO or receipt: everything received and not yet billed.
    lines: list[BillLinePayload] | None = Field(default=None, min_length=1)


class BillCreatePayload(BillPayload):
    order_id: int | None = Field(default=None, gt=0)
    receipt_id: int | None = Field(default=None, gt=0)


class ReasonPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _bill(db: Session, tenant_id: int, bill_id: int) -> dict:
    return jsonable_encoder(bills.serialize_bill(db, tenant_id=tenant_id, bill=bills.bill_or_404(db, tenant_id=tenant_id, bill_id=bill_id)))


def _require(db: Session, user, module: str, action: str, message: str) -> None:
    policy = PermissionPolicy(db, user)
    if not (policy.can_view_module(module) and policy.can_perform_action(module, action)):
        raise HTTPException(status_code=403, detail=message)


@router.get("/bills")
def list_bills(status: str | None = Query(default=None, pattern="^(draft|posted|void|unpaid|overdue|variance)$"),
               vendor_id: int | None = Query(default=None, gt=0), order_id: int | None = Query(default=None, gt=0),
               search: str | None = Query(default=None, max_length=100), sort_by: str | None = Query(default=None, max_length=40),
               sort_direction: str | None = Query(default=None, pattern="^(asc|desc)$"),
               pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user),
               _module=Depends(require_module_access(BILLS)), _view=Depends(require_action_access(BILLS, "view"))):
    return jsonable_encoder(bills.list_bills(db, tenant_id=user.tenant_id, pagination=pagination, status=status, vendor_id=vendor_id,
        order_id=order_id, search=search, sort_by=sort_by, sort_direction=sort_direction))


@router.post("/bills", status_code=201)
def create_bill(payload: BillCreatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(BILLS)), _create=Depends(require_action_access(BILLS, "create"))):
    if payload.order_id:
        _require(db, user, "purchase_orders", "view", "Billing a purchase order needs access to purchase orders")
    data = payload.model_dump()
    if data.get("lines") is None:
        data.pop("lines", None)
    else:
        data["lines"] = [line for line in data["lines"]]
    bill = bills.save_bill(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=data)
    db.commit()
    return _bill(db, user.tenant_id, bill.id)


@router.post("/bills/export-job", status_code=202)
def export_bills(db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(BILLS)), _export=Depends(require_action_access(BILLS, "export"))):
    job = create_data_transfer_job(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key=BILLS, operation_type="export", payload={})
    enqueue_export_job(job.id)
    return {"job_id": job.id}


@router.get("/bills/{bill_id}")
def get_bill(bill_id: int, db: Session = Depends(get_db), user=Depends(require_user),
             _module=Depends(require_module_access(BILLS)), _view=Depends(require_action_access(BILLS, "view"))):
    return _bill(db, user.tenant_id, bill_id)


@router.patch("/bills/{bill_id}")
def update_bill(bill_id: int, payload: BillPayload, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(BILLS)), _edit=Depends(require_action_access(BILLS, "edit"))):
    bills.save_bill(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(exclude_unset=True), bill_id=bill_id)
    db.commit()
    return _bill(db, user.tenant_id, bill_id)


@router.post("/bills/{bill_id}/post")
def post_bill(bill_id: int, db: Session = Depends(get_db), user=Depends(require_user),
              _module=Depends(require_module_access(BILLS)), _edit=Depends(require_action_access(BILLS, "edit"))):
    bills.post_bill(db, tenant_id=user.tenant_id, actor_user_id=user.id, bill_id=bill_id)
    db.commit()
    return _bill(db, user.tenant_id, bill_id)


@router.post("/bills/{bill_id}/void")
def void_bill(bill_id: int, payload: ReasonPayload, db: Session = Depends(get_db), user=Depends(require_user),
              _module=Depends(require_module_access(BILLS)), _edit=Depends(require_action_access(BILLS, "edit"))):
    bills.void_bill(db, tenant_id=user.tenant_id, actor_user_id=user.id, bill_id=bill_id, reason=payload.reason)
    db.commit()
    return _bill(db, user.tenant_id, bill_id)


@router.delete("/bills/{bill_id}", status_code=204)
def delete_bill(bill_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(BILLS)), _delete=Depends(require_action_access(BILLS, "delete"))):
    bills.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, bill_id=bill_id)
    db.commit()


@router.post("/bills/{bill_id}/restore")
def restore_bill(bill_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(BILLS)), _restore=Depends(require_action_access(BILLS, "restore"))):
    bills.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, bill_id=bill_id)
    db.commit()
    return _bill(db, user.tenant_id, bill_id)
