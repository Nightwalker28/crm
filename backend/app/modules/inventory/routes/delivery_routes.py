"""Deliveries for sales orders (12a-erp-fulfilment.md §3.4)."""

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.access_control import PermissionPolicy
from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.inventory.models import InventoryDelivery
from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_export_job
from app.modules.inventory.services import delivery_services as service
from app.modules.sales.models import SalesOrder

router = APIRouter(prefix="/inventory", tags=["Inventory"])

MODULE = "inventory_deliveries"


class DeliveryLinePayload(BaseModel):
    order_line_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0)


class DeliveryPayload(BaseModel):
    shipped_on: date | None = None
    carrier: str | None = Field(default=None, max_length=120)
    tracking_number: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    # Omitted on create: one line per stocked order line, shipping what is reserved.
    lines: list[DeliveryLinePayload] | None = Field(default=None, min_length=1)


class DeliveryCreatePayload(DeliveryPayload):
    order_id: int = Field(gt=0)


class CancellationPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=120)


def _require_order_view(db: Session, user) -> None:
    policy = PermissionPolicy(db, user)
    if not (policy.can_view_module("sales_orders") and policy.can_perform_action("sales_orders", "view")):
        raise HTTPException(status_code=403, detail="Order access required")


def _get(db: Session, *, tenant_id: int, delivery_id: int) -> dict:
    doc = service.get_delivery(db, tenant_id=tenant_id, delivery_id=delivery_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return jsonable_encoder(service.serialize_delivery(db, tenant_id=tenant_id, doc=doc))


@router.get("/deliveries")
def deliveries(status: str | None = Query(default=None, pattern="^(draft|posted|cancelled)$"), search: str | None = Query(default=None, max_length=100),
               order_id: int | None = Query(default=None, gt=0), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db),
               user=Depends(require_user), _module=Depends(require_module_access(MODULE)), _view=Depends(require_action_access(MODULE, "view"))):
    query = db.query(InventoryDelivery).options(selectinload(InventoryDelivery.lines)).filter(
        InventoryDelivery.tenant_id == user.tenant_id, InventoryDelivery.deleted_at.is_(None))
    if status:
        query = query.filter(InventoryDelivery.status == status)
    if order_id:
        query = query.filter(InventoryDelivery.order_id == order_id)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.join(SalesOrder, SalesOrder.id == InventoryDelivery.order_id).filter(SalesOrder.tenant_id == user.tenant_id, or_(
            InventoryDelivery.number.ilike(pattern), InventoryDelivery.tracking_number.ilike(pattern), SalesOrder.order_number.ilike(pattern)))
    total = query.count()
    rows = query.order_by(InventoryDelivery.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(jsonable_encoder([service.serialize_delivery(db, tenant_id=user.tenant_id, doc=row, include_lines=False) for row in rows]), total, pagination)


@router.post("/deliveries", status_code=201)
def create_delivery(payload: DeliveryCreatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access(MODULE)), _create=Depends(require_action_access(MODULE, "create"))):
    _require_order_view(db, user)
    doc = service.save_delivery(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(exclude_unset=False))
    db.commit()
    return _get(db, tenant_id=user.tenant_id, delivery_id=doc.id)


@router.get("/deliveries/{delivery_id}")
def get_delivery(delivery_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(MODULE)), _view=Depends(require_action_access(MODULE, "view"))):
    return _get(db, tenant_id=user.tenant_id, delivery_id=delivery_id)


@router.patch("/deliveries/{delivery_id}")
def update_delivery(delivery_id: int, payload: DeliveryPayload, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access(MODULE)), _edit=Depends(require_action_access(MODULE, "edit"))):
    service.save_delivery(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(), delivery_id=delivery_id)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, delivery_id=delivery_id)


@router.post("/deliveries/{delivery_id}/post")
def post_delivery(delivery_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(MODULE)), _edit=Depends(require_action_access(MODULE, "edit"))):
    service.post_delivery(db, tenant_id=user.tenant_id, actor_user_id=user.id, delivery_id=delivery_id)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, delivery_id=delivery_id)


@router.post("/deliveries/{delivery_id}/cancel")
def cancel_delivery(delivery_id: int, payload: CancellationPayload, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access(MODULE)), _edit=Depends(require_action_access(MODULE, "edit"))):
    service.cancel_delivery(db, tenant_id=user.tenant_id, actor_user_id=user.id, delivery_id=delivery_id, reason=payload.reason)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, delivery_id=delivery_id)


@router.delete("/deliveries/{delivery_id}", status_code=204)
def delete_delivery(delivery_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access(MODULE)), _delete=Depends(require_action_access(MODULE, "delete"))):
    service.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, delivery_id=delivery_id)
    db.commit()
    return Response(status_code=204)


@router.post("/deliveries/{delivery_id}/restore")
def restore_delivery(delivery_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                     _module=Depends(require_module_access(MODULE)), _restore=Depends(require_action_access(MODULE, "restore"))):
    service.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, delivery_id=delivery_id)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, delivery_id=delivery_id)


@router.post("/deliveries/export-job", status_code=202)
def export_deliveries(db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access(MODULE)), _export=Depends(require_action_access(MODULE, "export"))):
    job = create_data_transfer_job(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key=MODULE, operation_type="export", payload={})
    enqueue_export_job(job.id)
    return {"job_id": job.id}
