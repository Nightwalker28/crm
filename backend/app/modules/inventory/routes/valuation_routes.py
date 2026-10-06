"""Inventory → Valuation (ERP E6, `12d-erp-costing.md` §3.4): stock value as of any date,
revaluations, and their exports. Every route needs the `inventory_valuation` module."""

from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.inventory.services import valuation_services as service
from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_export_job

router = APIRouter(prefix="/inventory", tags=["Inventory"])
VALUATION = "inventory_valuation"

SORTS = {
    "product_name": lambda row: (row["product_name"].lower(), row["product_id"]),
    "on_hand": lambda row: (row["on_hand"], row["product_id"]),
    "average_cost": lambda row: (row["average_cost"] if row["average_cost"] is not None else Decimal(-1), row["product_id"]),
    "stock_value": lambda row: (row["stock_value"], row["product_id"]),
}


class RevaluationPayload(BaseModel):
    product_id: int = Field(gt=0)
    average_cost: Decimal = Field(ge=0)
    reason: str = Field(min_length=1, max_length=500)


@router.get("/valuation")
def valuation(as_of: date | None = Query(default=None), warehouse_id: int | None = Query(default=None, gt=0),
              category_id: int | None = Query(default=None, gt=0), search: str | None = Query(default=None, max_length=100),
              cost_missing: bool | None = Query(default=None),
              sort_by: str = Query(default="product_name", pattern="^(product_name|on_hand|average_cost|stock_value)$"),
              sort_order: str = Query(default="asc", pattern="^(asc|desc)$"),
              pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user),
              _module=Depends(require_module_access(VALUATION)), _view=Depends(require_action_access(VALUATION, "view"))):
    rows = service.valuation_rows(db, tenant_id=user.tenant_id, as_of=as_of, warehouse_id=warehouse_id, category_id=category_id,
                                  search=search, cost_missing=cost_missing)
    rows.sort(key=SORTS[sort_by], reverse=sort_order == "desc")
    page = rows[pagination.offset:pagination.offset + pagination.limit]
    return jsonable_encoder(build_paged_response(page, len(rows), pagination))


@router.get("/valuation/summary")
def valuation_summary(as_of: date | None = Query(default=None), db: Session = Depends(get_db), user=Depends(require_user),
                      _module=Depends(require_module_access(VALUATION)), _view=Depends(require_action_access(VALUATION, "view"))):
    return jsonable_encoder(service.valuation_summary(db, tenant_id=user.tenant_id, as_of=as_of))


@router.post("/valuation/export-job", status_code=202)
def export_valuation(kind: str = Query(default="valuation", pattern="^(valuation|revaluations)$"), as_of: date | None = Query(default=None),
                     warehouse_id: int | None = Query(default=None, gt=0), category_id: int | None = Query(default=None, gt=0),
                     cost_missing: bool | None = Query(default=None), db: Session = Depends(get_db), user=Depends(require_user),
                     _module=Depends(require_module_access(VALUATION)), _export=Depends(require_action_access(VALUATION, "export"))):
    job = create_data_transfer_job(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key=VALUATION, operation_type="export",
        payload={"kind": kind, "as_of": as_of.isoformat() if as_of else None, "warehouse_id": warehouse_id, "category_id": category_id,
                 "cost_missing": cost_missing})
    enqueue_export_job(job.id)
    return {"job_id": job.id}


@router.get("/revaluations")
def revaluations(product_id: int | None = Query(default=None, gt=0), pagination: Pagination = Depends(get_pagination),
                 db: Session = Depends(get_db), user=Depends(require_user),
                 _module=Depends(require_module_access(VALUATION)), _view=Depends(require_action_access(VALUATION, "view"))):
    rows, total = service.list_revaluations(db, tenant_id=user.tenant_id, product_id=product_id, offset=pagination.offset, limit=pagination.limit)
    return jsonable_encoder(build_paged_response(rows, total, pagination))


@router.get("/revaluations/{revaluation_id}")
def revaluation(revaluation_id: int, db: Session = Depends(get_db), user=Depends(require_user),
                _module=Depends(require_module_access(VALUATION)), _view=Depends(require_action_access(VALUATION, "view"))):
    return jsonable_encoder(service.get_revaluation(db, tenant_id=user.tenant_id, revaluation_id=revaluation_id))


@router.post("/revaluations", status_code=201)
def create_revaluation(payload: RevaluationPayload, db: Session = Depends(get_db), user=Depends(require_user),
                       _module=Depends(require_module_access(VALUATION)), _edit=Depends(require_action_access(VALUATION, "edit"))):
    row = service.revalue(db, tenant_id=user.tenant_id, actor_user_id=user.id, product_id=payload.product_id,
                          average_cost=payload.average_cost, reason=payload.reason)
    db.commit()
    return jsonable_encoder(service.get_revaluation(db, tenant_id=user.tenant_id, revaluation_id=row.id))
