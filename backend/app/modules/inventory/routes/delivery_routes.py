"""Deliveries for sales orders (12a-erp-fulfilment.md §3.4)."""

from datetime import date
from decimal import Decimal

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_access, require_action_access, require_module_access
from app.core.security import require_user
from app.modules.inventory.models import InventoryDelivery
from app.modules.inventory.services import delivery_services as service
from app.modules.platform.services.write_rules import apply_user_write_rules
from app.modules.platform.services.document_exports import start_document_export

router = APIRouter(prefix="/inventory", tags=["Inventory"])

MODULE = "inventory_deliveries"


class DeliveryLinePayload(BaseModel):
    order_line_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0)


class DeliveryPayload(BaseModel):
    custom_fields: dict[str, Any] | None = None
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




def _get(db: Session, *, tenant_id: int, delivery_id: int) -> dict:
    doc = service.get_delivery(db, tenant_id=tenant_id, delivery_id=delivery_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return jsonable_encoder(service.serialize_delivery(db, tenant_id=tenant_id, doc=doc))


@router.get("/deliveries")
def deliveries(status: str | None = Query(default=None, pattern="^(draft|posted|cancelled)$"), search: str | None = Query(default=None, max_length=100),
               order_id: int | None = Query(default=None, gt=0), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db),
               user=Depends(require_user), _module=Depends(require_module_access(MODULE)), _view=Depends(require_action_access(MODULE, "view"))):
    query = service.list_query(db, tenant_id=user.tenant_id, status=status, search=search, order_id=order_id)
    total = query.count()
    rows = query.order_by(InventoryDelivery.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(jsonable_encoder([service.serialize_delivery(db, tenant_id=user.tenant_id, doc=row, include_lines=False) for row in rows]), total, pagination)


@router.post("/deliveries", status_code=201)
def create_delivery(payload: DeliveryCreatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access(MODULE)), _create=Depends(require_action_access(MODULE, "create"))):
    require_access(db, user, "sales_orders", "view", detail="Order access required")
    data = apply_user_write_rules(db, tenant_id=user.tenant_id, module_key=MODULE, payload=payload.model_dump(exclude_unset=False))
    doc = service.save_delivery(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=data)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, delivery_id=doc.id)


@router.get("/deliveries/{delivery_id}")
def get_delivery(delivery_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(MODULE)), _view=Depends(require_action_access(MODULE, "view"))):
    return _get(db, tenant_id=user.tenant_id, delivery_id=delivery_id)


@router.patch("/deliveries/{delivery_id}")
def update_delivery(delivery_id: int, payload: DeliveryPayload, db: Session = Depends(get_db), user=Depends(require_user),
                    _module=Depends(require_module_access(MODULE)), _edit=Depends(require_action_access(MODULE, "edit"))):
    data = apply_user_write_rules(
        db, tenant_id=user.tenant_id, module_key=MODULE, payload=payload.model_dump(),
        record_id=delivery_id, submitted_keys=payload.model_fields_set,
    )
    service.save_delivery(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=data, delivery_id=delivery_id)
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
def export_deliveries(status: str | None = Query(default=None, pattern="^(draft|posted|cancelled)$"), search: str | None = Query(default=None, max_length=100),
        order_id: int | None = Query(default=None, gt=0), db: Session = Depends(get_db), user=Depends(require_user),
        _module=Depends(require_module_access(MODULE)), _export=Depends(require_action_access(MODULE, "export"))):
    """Exports what the list shows under the same filters (13a A5)."""
    return start_document_export(db, user, module_key=MODULE, filters={"status": status, "search": search, "order_id": order_id})
