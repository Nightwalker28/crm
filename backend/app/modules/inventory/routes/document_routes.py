"""Inventory adjustment and transfer documents."""

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.inventory.repositories import document_repository as repo
from app.modules.inventory.services import document_services as service

router = APIRouter(prefix="/inventory", tags=["Inventory"])


class AdjustmentLinePayload(BaseModel):
    product_id: int = Field(gt=0)
    counted: Decimal | None = None
    delta: Decimal | None = None
    unit_cost: Decimal | None = Field(default=None, ge=0)


class AdjustmentPayload(BaseModel):
    warehouse_id: int = Field(gt=0)
    mode: str
    reason: str = Field(min_length=1, max_length=120)
    notes: str | None = None
    lines: list[AdjustmentLinePayload] = Field(min_length=1)


class TransferLinePayload(BaseModel):
    product_id: int = Field(gt=0)
    quantity: Decimal


class TransferPayload(BaseModel):
    from_warehouse_id: int = Field(gt=0)
    to_warehouse_id: int = Field(gt=0)
    notes: str | None = None
    lines: list[TransferLinePayload] = Field(min_length=1)


class CancellationPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=120)


def _list(db: Session, *, tenant_id: int, kind: str, status: str | None, include_deleted: bool, pagination: Pagination):
    if status and status not in {"draft", "posted", "cancelled"}:
        raise HTTPException(status_code=400, detail="Invalid document status")
    query = (repo.adjustment_list if kind == "adjustments" else repo.transfer_list)(db, tenant_id=tenant_id, include_deleted=include_deleted)
    if status:
        model = query.column_descriptions[0]["entity"]
        query = query.filter(model.status == status)
    total = query.count()
    rows = query.order_by(query.column_descriptions[0]["entity"].id.desc()).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response([service.serialize_document(db, tenant_id=tenant_id, kind=kind, doc=row, include_lines=False) for row in rows], total, pagination)


def _get(db: Session, *, tenant_id: int, kind: str, document_id: int, include_deleted: bool = False):
    doc = (repo.adjustment if kind == "adjustments" else repo.transfer)(db, tenant_id=tenant_id, document_id=document_id, include_deleted=include_deleted)
    if doc is None:
        raise HTTPException(status_code=404, detail="Inventory document not found")
    return service.serialize_document(db, tenant_id=tenant_id, kind=kind, doc=doc)


@router.get("/adjustments")
def adjustments(status: str | None = None, include_deleted: bool = Query(default=False), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _view=Depends(require_action_access("inventory_adjustments", "view"))):
    if include_deleted:
        from app.core.access_control import PermissionPolicy
        if not PermissionPolicy(db, user).can_perform_action("inventory_adjustments", "restore"):
            raise HTTPException(status_code=403, detail="Restore access required")
    return _list(db, tenant_id=user.tenant_id, kind="adjustments", status=status, include_deleted=include_deleted, pagination=pagination)


@router.post("/adjustments", status_code=201)
def create_adjustment(payload: AdjustmentPayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _create=Depends(require_action_access("inventory_adjustments", "create"))):
    doc = service.save_adjustment(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump())
    return _get(db, tenant_id=user.tenant_id, kind="adjustments", document_id=doc.id)


@router.get("/adjustments/{document_id}")
def get_adjustment(document_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _view=Depends(require_action_access("inventory_adjustments", "view"))):
    return _get(db, tenant_id=user.tenant_id, kind="adjustments", document_id=document_id)


@router.put("/adjustments/{document_id}")
def update_adjustment(document_id: int, payload: AdjustmentPayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _edit=Depends(require_action_access("inventory_adjustments", "edit"))):
    service.save_adjustment(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(), document_id=document_id)
    return _get(db, tenant_id=user.tenant_id, kind="adjustments", document_id=document_id)


@router.post("/adjustments/{document_id}/post")
def post_adjustment(document_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _edit=Depends(require_action_access("inventory_adjustments", "edit"))):
    service.post_adjustment(db, tenant_id=user.tenant_id, actor_user_id=user.id, document_id=document_id)
    return _get(db, tenant_id=user.tenant_id, kind="adjustments", document_id=document_id)


@router.post("/adjustments/{document_id}/cancel")
def cancel_adjustment(document_id: int, payload: CancellationPayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _edit=Depends(require_action_access("inventory_adjustments", "edit"))):
    service.cancel_document(db, tenant_id=user.tenant_id, actor_user_id=user.id, kind="adjustments", document_id=document_id, reason=payload.reason)
    return _get(db, tenant_id=user.tenant_id, kind="adjustments", document_id=document_id)


@router.delete("/adjustments/{document_id}", status_code=204)
def delete_adjustment(document_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _delete=Depends(require_action_access("inventory_adjustments", "delete"))):
    service.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, kind="adjustments", document_id=document_id)
    return Response(status_code=204)


@router.post("/adjustments/{document_id}/restore")
def restore_adjustment(document_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _restore=Depends(require_action_access("inventory_adjustments", "restore"))):
    service.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, kind="adjustments", document_id=document_id)
    return _get(db, tenant_id=user.tenant_id, kind="adjustments", document_id=document_id)


@router.get("/transfers")
def transfers(status: str | None = None, include_deleted: bool = Query(default=False), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_transfers")), _view=Depends(require_action_access("inventory_transfers", "view"))):
    if include_deleted:
        from app.core.access_control import PermissionPolicy
        if not PermissionPolicy(db, user).can_perform_action("inventory_transfers", "restore"):
            raise HTTPException(status_code=403, detail="Restore access required")
    return _list(db, tenant_id=user.tenant_id, kind="transfers", status=status, include_deleted=include_deleted, pagination=pagination)


@router.post("/transfers", status_code=201)
def create_transfer(payload: TransferPayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_transfers")), _create=Depends(require_action_access("inventory_transfers", "create"))):
    doc = service.save_transfer(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump())
    return _get(db, tenant_id=user.tenant_id, kind="transfers", document_id=doc.id)


@router.get("/transfers/{document_id}")
def get_transfer(document_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_transfers")), _view=Depends(require_action_access("inventory_transfers", "view"))):
    return _get(db, tenant_id=user.tenant_id, kind="transfers", document_id=document_id)


@router.put("/transfers/{document_id}")
def update_transfer(document_id: int, payload: TransferPayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_transfers")), _edit=Depends(require_action_access("inventory_transfers", "edit"))):
    service.save_transfer(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(), document_id=document_id)
    return _get(db, tenant_id=user.tenant_id, kind="transfers", document_id=document_id)


@router.post("/transfers/{document_id}/post")
def post_transfer(document_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_transfers")), _edit=Depends(require_action_access("inventory_transfers", "edit"))):
    service.post_transfer(db, tenant_id=user.tenant_id, actor_user_id=user.id, document_id=document_id)
    return _get(db, tenant_id=user.tenant_id, kind="transfers", document_id=document_id)


@router.post("/transfers/{document_id}/cancel")
def cancel_transfer(document_id: int, payload: CancellationPayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_transfers")), _edit=Depends(require_action_access("inventory_transfers", "edit"))):
    service.cancel_document(db, tenant_id=user.tenant_id, actor_user_id=user.id, kind="transfers", document_id=document_id, reason=payload.reason)
    return _get(db, tenant_id=user.tenant_id, kind="transfers", document_id=document_id)


@router.delete("/transfers/{document_id}", status_code=204)
def delete_transfer(document_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_transfers")), _delete=Depends(require_action_access("inventory_transfers", "delete"))):
    service.delete_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, kind="transfers", document_id=document_id)
    return Response(status_code=204)


@router.post("/transfers/{document_id}/restore")
def restore_transfer(document_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_transfers")), _restore=Depends(require_action_access("inventory_transfers", "restore"))):
    service.restore_draft(db, tenant_id=user.tenant_id, actor_user_id=user.id, kind="transfers", document_id=document_id)
    return _get(db, tenant_id=user.tenant_id, kind="transfers", document_id=document_id)
