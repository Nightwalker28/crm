"""Customer returns against posted deliveries (12a-erp-fulfilment.md §3.4)."""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_access, require_action_access, require_module_access
from app.core.security import require_user
from app.modules.inventory.models import InventoryReturn
from app.modules.inventory.services import return_services as service
from app.modules.platform.services.document_exports import start_document_export

router = APIRouter(prefix="/inventory", tags=["Inventory"])

MODULE = "inventory_returns"


class ReturnLinePayload(BaseModel):
    delivery_line_id: int = Field(gt=0)
    quantity: Decimal = Field(gt=0)
    restock: bool = True


class ReturnPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=120)
    warehouse_id: int | None = Field(default=None, gt=0)
    notes: str | None = None
    # Omitted on create: everything the delivery shipped that has not come back, restocked.
    lines: list[ReturnLinePayload] | None = Field(default=None, min_length=1)


class ReturnCreatePayload(ReturnPayload):
    delivery_id: int = Field(gt=0)


class CancellationPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=120)


def _get(db: Session, *, tenant_id: int, return_id: int) -> dict:
    doc = service.get_return(db, tenant_id=tenant_id, return_id=return_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Return not found")
    return jsonable_encoder(service.serialize_return(db, tenant_id=tenant_id, doc=doc))


@router.get("/returns")
def returns(status: str | None = Query(default=None, pattern="^(draft|received|cancelled)$"), search: str | None = Query(default=None, max_length=100),
            delivery_id: int | None = Query(default=None, gt=0), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db),
            user=Depends(require_user), _module=Depends(require_module_access(MODULE)), _view=Depends(require_action_access(MODULE, "view"))):
    query = service.list_query(db, tenant_id=user.tenant_id, status=status, search=search, delivery_id=delivery_id)
    total = query.count()
    rows = query.order_by(InventoryReturn.id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response(jsonable_encoder([service.serialize_return(db, tenant_id=user.tenant_id, doc=row, include_lines=False) for row in rows]), total, pagination)


@router.post("/returns", status_code=201)
def create_return(payload: ReturnCreatePayload, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(MODULE)), _create=Depends(require_action_access(MODULE, "create"))):
    require_access(db, user, "inventory_deliveries", "view", detail="Delivery access required")
    doc = service.save_return(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump())
    db.commit()
    return _get(db, tenant_id=user.tenant_id, return_id=doc.id)


@router.get("/returns/{return_id}")
def get_return(return_id: int, db: Session = Depends(get_db), user=Depends(require_user),
               _module=Depends(require_module_access(MODULE)), _view=Depends(require_action_access(MODULE, "view"))):
    return _get(db, tenant_id=user.tenant_id, return_id=return_id)


@router.patch("/returns/{return_id}")
def update_return(return_id: int, payload: ReturnPayload, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(MODULE)), _edit=Depends(require_action_access(MODULE, "edit"))):
    service.save_return(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(), return_id=return_id)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, return_id=return_id)


@router.post("/returns/{return_id}/receive")
def receive_return(return_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(MODULE)), _edit=Depends(require_action_access(MODULE, "edit"))):
    service.receive_return(db, tenant_id=user.tenant_id, actor_user_id=user.id, return_id=return_id)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, return_id=return_id)


@router.post("/returns/{return_id}/cancel")
def cancel_return(return_id: int, payload: CancellationPayload, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(MODULE)), _edit=Depends(require_action_access(MODULE, "edit"))):
    service.cancel_return(db, tenant_id=user.tenant_id, actor_user_id=user.id, return_id=return_id, reason=payload.reason)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, return_id=return_id)


@router.delete("/returns/{return_id}", status_code=204)
def delete_return(return_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                  _module=Depends(require_module_access(MODULE)), _delete=Depends(require_action_access(MODULE, "delete"))):
    service.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, return_id=return_id)
    db.commit()
    return Response(status_code=204)


@router.post("/returns/{return_id}/restore")
def restore_return(return_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                   _module=Depends(require_module_access(MODULE)), _restore=Depends(require_action_access(MODULE, "restore"))):
    service.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, return_id=return_id)
    db.commit()
    return _get(db, tenant_id=user.tenant_id, return_id=return_id)


@router.post("/returns/export-job", status_code=202)
def export_returns(status: str | None = Query(default=None, pattern="^(draft|received|cancelled)$"), search: str | None = Query(default=None, max_length=100),
        delivery_id: int | None = Query(default=None, gt=0), db: Session = Depends(get_db), user=Depends(require_user),
        _module=Depends(require_module_access(MODULE)), _export=Depends(require_action_access(MODULE, "export"))):
    """Exports what the list shows under the same filters (13a A5)."""
    return start_document_export(db, user, module_key=MODULE, filters={"status": status, "search": search, "delivery_id": delivery_id})
