from decimal import Decimal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.module_filters import apply_filter_conditions, parse_filter_conditions
from app.core.access_control import PermissionPolicy
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.models import InventoryStockLevel, InventoryStockMove, InventoryWarehouse
from app.modules.inventory.services import inventory_services
from app.modules.platform.services.data_transfer_jobs import create_data_transfer_job, enqueue_export_job, enqueue_import_job, persist_job_upload
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


@router.get("/products/search")
def search_tracked_products(query: str = Query(default="", max_length=100), limit: int = Query(default=10, ge=1, le=20), db: Session = Depends(get_db), user=Depends(require_user)):
    policy = PermissionPolicy(db, user)
    allowed = any(policy.can_view_module(module) and policy.can_perform_action(module, action) for module, action in (
        ("inventory_stock", "view"),
        ("inventory_adjustments", "create"), ("inventory_adjustments", "edit"),
        ("inventory_transfers", "create"), ("inventory_transfers", "edit"),
    ))
    if not allowed:
        raise HTTPException(status_code=403, detail="Inventory access required")
    products = db.query(CatalogProduct).filter(CatalogProduct.tenant_id == user.tenant_id,
        CatalogProduct.deleted_at.is_(None), CatalogProduct.is_active == 1, CatalogProduct.track_inventory == 1)
    if query.strip():
        pattern = f"%{query.strip()}%"
        products = products.filter(or_(CatalogProduct.name.ilike(pattern), CatalogProduct.sku.ilike(pattern), CatalogProduct.barcode == query.strip()))
    rows = products.order_by(CatalogProduct.name, CatalogProduct.id).limit(limit).all()
    return {"results": [{"id": row.id, "name": row.name, "sku": row.sku} for row in rows]}


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
def stock(search: str | None = Query(default=None, max_length=100), warehouse_id: int | None = Query(default=None, gt=0), level_filter: str | None = Query(default=None, pattern="^(in_stock|low_stock|out_of_stock)$"), filters_all: str | None = Query(default=None), filters_any: str | None = Query(default=None), pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _action=Depends(require_action_access("inventory_stock", "view"))):
    query = db.query(CatalogProduct, InventoryStockLevel, InventoryWarehouse).join(InventoryStockLevel, InventoryStockLevel.product_id == CatalogProduct.id).join(InventoryWarehouse, InventoryWarehouse.id == InventoryStockLevel.warehouse_id).filter(CatalogProduct.tenant_id == user.tenant_id, InventoryStockLevel.tenant_id == user.tenant_id, InventoryWarehouse.tenant_id == user.tenant_id, CatalogProduct.deleted_at.is_(None), CatalogProduct.track_inventory == 1)
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(CatalogProduct.name.ilike(pattern), CatalogProduct.sku.ilike(pattern)))
    if warehouse_id:
        query = query.filter(InventoryStockLevel.warehouse_id == warehouse_id)
    available = InventoryStockLevel.on_hand - InventoryStockLevel.reserved
    field_map = {"on_hand": {"expression": InventoryStockLevel.on_hand, "type": "number"},
        "available": {"expression": available, "type": "number"},
        "reorder_point": {"expression": CatalogProduct.reorder_point, "type": "number"},
        "low_stock": {"expression": (CatalogProduct.reorder_point > 0) & (available <= CatalogProduct.reorder_point), "type": "boolean"},
        "sku": {"expression": CatalogProduct.sku, "type": "text"},
        "product_name": {"expression": CatalogProduct.name, "type": "text"},
        "warehouse_id": {"expression": InventoryWarehouse.id, "type": "number"}}
    query = apply_filter_conditions(query, conditions=parse_filter_conditions(filters_all), logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=parse_filter_conditions(filters_any), logic="any", field_map=field_map)
    # Per balance row, the same rule as the list's Status column: out of stock at or below
    # zero, low at or below a positive reorder point, otherwise in stock.
    if level_filter == "in_stock":
        query = query.filter(available > 0, or_(CatalogProduct.reorder_point <= 0, available > CatalogProduct.reorder_point))
    elif level_filter == "low_stock":
        query = query.filter(available > 0, CatalogProduct.reorder_point > 0, available <= CatalogProduct.reorder_point)
    elif level_filter == "out_of_stock":
        query = query.filter(available <= 0)
    total = query.count()
    rows = query.order_by(CatalogProduct.name, CatalogProduct.id, InventoryWarehouse.name).offset(pagination.offset).limit(pagination.limit).all()
    return build_paged_response([{"product_id": product.id, "product_name": product.name, "sku": product.sku, "category_name": product.category.full_name if product.category else None, "warehouse_id": warehouse.id, "warehouse_name": warehouse.name, "on_hand": level.on_hand, "reserved": level.reserved, "available": Decimal(level.on_hand) - Decimal(level.reserved), "reorder_point": product.reorder_point, "reorder_quantity": product.reorder_quantity, "stock_status": product.stock_status} for product, level, warehouse in rows], total, pagination)


@router.post("/stock/export-job", status_code=202)
def export_stock(kind: str = Query(pattern="^(levels|movements)$"), db: Session = Depends(get_db), user=Depends(require_user), _module=Depends(require_module_access("inventory_stock")), _export=Depends(require_action_access("inventory_stock", "export"))):
    job = create_data_transfer_job(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key="inventory_stock", operation_type="export", payload={"kind": kind})
    enqueue_export_job(job.id)
    return {"job_id": job.id}


@router.post("/stock/opening-import-job", status_code=202)
async def import_opening_stock(file: UploadFile = File(...), db: Session = Depends(get_db), user=Depends(require_user), _stock=Depends(require_module_access("inventory_stock")), _stock_view=Depends(require_action_access("inventory_stock", "view")), _module=Depends(require_module_access("inventory_adjustments")), _create=Depends(require_action_access("inventory_adjustments", "create")), _edit=Depends(require_action_access("inventory_adjustments", "edit"))):
    content = await file.read(2_000_001)
    if len(content) > 2_000_000 or not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Upload a CSV file no larger than 2 MB")
    job = create_data_transfer_job(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key="inventory_stock", operation_type="import", payload={"filename": file.filename})
    path = persist_job_upload(job_id=job.id, filename="opening-stock.csv", file_bytes=content)
    job.payload = {**(job.payload or {}), "source_file_path": path}
    db.add(job)
    db.commit()
    enqueue_import_job(job.id)
    return {"job_id": job.id}


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
