from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.access_control import PermissionPolicy
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryStockLevel, InventoryStockMove, InventoryWarehouse
from app.modules.inventory.services import inventory_services
from app.modules.user_management.models import User

router = APIRouter(prefix="/inventory", tags=["Inventory"])


class WarehousePayload(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    address: str | None = None
    is_active: bool = True


class QuickAdjustmentPayload(BaseModel):
    warehouse_id: int | None = Field(default=None, gt=0)
    quantity: Decimal | None = Field(default=None, ge=0)
    change: Decimal | None = None
    reason: str = Field(min_length=1, max_length=120)
    note: str | None = None

    @model_validator(mode="after")
    def one_quantity(self):
        if (self.quantity is None) == (self.change is None):
            raise ValueError("Provide either a new quantity or a change")
        return self


def _warehouse(row: InventoryWarehouse) -> dict:
    return {"id": row.id, "code": row.code, "name": row.name, "address": row.address, "is_default": bool(row.is_default), "is_active": bool(row.is_active), "is_deleted": row.deleted_at is not None}


@router.get("/warehouses")
def warehouses(include_deleted: bool = Query(default=False), db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "view"))):
    if include_deleted:
        if not PermissionPolicy(db, user).can_perform_action("inventory_stock", "configure"):
            raise HTTPException(status_code=403, detail="Warehouse configuration access required")
    return {"results": [_warehouse(row) for row in inventory_services.list_warehouses(db, tenant_id=user.tenant_id, include_deleted=include_deleted)]}


@router.post("/warehouses", status_code=201)
def create_warehouse(payload: WarehousePayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "configure"))):
    return _warehouse(inventory_services.save_warehouse(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump()))


@router.put("/warehouses/{warehouse_id}")
def update_warehouse(warehouse_id: int, payload: WarehousePayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "configure"))):
    return _warehouse(inventory_services.save_warehouse(db, tenant_id=user.tenant_id, actor_user_id=user.id, payload=payload.model_dump(), warehouse_id=warehouse_id))


@router.delete("/warehouses/{warehouse_id}", status_code=204)
def delete_warehouse(warehouse_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "configure"))):
    inventory_services.delete_warehouse(db, tenant_id=user.tenant_id, actor_user_id=user.id, warehouse_id=warehouse_id)
    return Response(status_code=204)


@router.post("/warehouses/{warehouse_id}/restore")
def restore_warehouse(warehouse_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "configure"))):
    return _warehouse(inventory_services.restore_warehouse(db, tenant_id=user.tenant_id, actor_user_id=user.id, warehouse_id=warehouse_id))


@router.get("/stock")
def stock(search: str | None = Query(default=None, max_length=100), warehouse_id: int | None = Query(default=None, gt=0), stock_status: str | None = Query(default=None), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "view"))):
    query = db.query(CatalogProduct, InventoryStockLevel, InventoryWarehouse).join(InventoryStockLevel, InventoryStockLevel.product_id == CatalogProduct.id).join(InventoryWarehouse, InventoryWarehouse.id == InventoryStockLevel.warehouse_id).filter(CatalogProduct.tenant_id == user.tenant_id, InventoryStockLevel.tenant_id == user.tenant_id, InventoryWarehouse.tenant_id == user.tenant_id, CatalogProduct.deleted_at.is_(None), CatalogProduct.track_inventory == 1)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(CatalogProduct.name.ilike(pattern), CatalogProduct.sku.ilike(pattern)))
    if warehouse_id:
        query = query.filter(InventoryStockLevel.warehouse_id == warehouse_id)
    if stock_status:
        if stock_status not in {"in_stock", "out_of_stock"}:
            raise HTTPException(status_code=400, detail="Invalid stock status")
        query = query.filter(CatalogProduct.stock_status == stock_status)
    total = query.count()
    rows = query.order_by(CatalogProduct.name, CatalogProduct.id, InventoryWarehouse.name).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response([{"product_id": product.id, "product_name": product.name, "sku": product.sku, "warehouse_id": warehouse.id, "warehouse_name": warehouse.name, "on_hand": level.on_hand, "reserved": level.reserved, "available": Decimal(level.on_hand) - Decimal(level.reserved), "stock_status": product.stock_status} for product, level, warehouse in rows], total, pagination)


@router.get("/movements")
def movements(product_id: int | None = Query(default=None, gt=0), warehouse_id: int | None = Query(default=None, gt=0), move_type: str | None = Query(default=None, max_length=30), pagination: CursorPagination = Depends(get_cursor_pagination), db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "view"))):
    query = db.query(InventoryStockMove, CatalogProduct, InventoryWarehouse).join(CatalogProduct, CatalogProduct.id == InventoryStockMove.product_id).join(InventoryWarehouse, InventoryWarehouse.id == InventoryStockMove.warehouse_id).filter(InventoryStockMove.tenant_id == user.tenant_id, CatalogProduct.tenant_id == user.tenant_id, InventoryWarehouse.tenant_id == user.tenant_id)
    if product_id:
        query = query.filter(InventoryStockMove.product_id == product_id)
    if warehouse_id:
        query = query.filter(InventoryStockMove.warehouse_id == warehouse_id)
    if move_type:
        query = query.filter(InventoryStockMove.move_type == move_type)
    if pagination.cursor:
        query = query.filter(InventoryStockMove.id < pagination.cursor)
    rows = query.order_by(None).order_by(InventoryStockMove.id.desc()).limit(pagination.limit + 1).all()
    actor_ids = {move.created_by for move, _, _ in rows if move.created_by is not None}
    actors = {actor.id: " ".join(part for part in (actor.first_name, actor.last_name) if part).strip() or actor.email for actor in db.query(User).filter(User.tenant_id == user.tenant_id, User.id.in_(actor_ids))} if actor_ids else {}
    return build_cursor_response([inventory_services.serialize_move(move, product_name=product.name, warehouse_name=warehouse.name, actor_name=actors.get(move.created_by)) for move, product, warehouse in rows], limit=pagination.limit, id_attr="id")


@router.get("/products/{product_id}/stock")
def product_stock(product_id: int, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "view"))):
    return inventory_services.product_stock(db, tenant_id=user.tenant_id, product_id=product_id)


@router.post("/products/{product_id}/adjust", status_code=201)
def quick_adjust(product_id: int, payload: QuickAdjustmentPayload, db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_adjustments")), _create=Depends(require_action_access("inventory_adjustments", "create")), _post=Depends(require_action_access("inventory_adjustments", "edit"))):
    adjustment = inventory_services.quick_adjust(db, tenant_id=user.tenant_id, actor_user_id=user.id, product_id=product_id, **payload.model_dump())
    return {"id": adjustment.id, "number": adjustment.number, "status": adjustment.status}
