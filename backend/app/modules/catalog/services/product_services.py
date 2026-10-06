"""Catalog products: the shared catalog item implementation, plus stock and purchasing (13a E2).

Everything a service also has lives in `catalog_item_services`. This module defines what only
a product has (stock tracking and its opening balance, reorder levels, barcode, a preferred
vendor) as `PRODUCT` hooks, and keeps the module's public functions.
"""

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct
from app.modules.catalog.repositories.catalog_item_repository import PRODUCT_QUERY
from app.modules.catalog.schema import CatalogProductResponse
from app.modules.catalog.services import catalog_item_services as items
from app.modules.catalog.services.catalog_item_services import CatalogKind, coerce_nonnegative_decimal
from app.modules.catalog.services.common import normalize_catalog_code
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, ensure_product_levels, post_moves

CATALOG_PRODUCTS_MODULE = "catalog_products"
PRODUCT_STOCK_STATUSES = {"untracked", "in_stock", "out_of_stock", "preorder"}


def _normalize_stock_status(value) -> str:
    normalized = str(getattr(value, "value", value) or "untracked").strip().lower()
    if normalized not in PRODUCT_STOCK_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stock status")
    return normalized


def _purchasing_fields(db: Session, *, tenant_id: int, payload: dict, partial: bool) -> dict:
    """Preferred vendor (a vendor-flagged Account in the tenant), vendor SKU and lead time."""
    from app.modules.sales.models import SalesOrganization

    fields: dict = {}
    if "preferred_vendor_id" in payload or not partial:
        vendor_id = payload.get("preferred_vendor_id")
        if vendor_id:
            vendor = db.query(SalesOrganization).filter(SalesOrganization.tenant_id == tenant_id, SalesOrganization.org_id == vendor_id,
                SalesOrganization.deleted_at.is_(None)).first()
            if vendor is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Preferred vendor not found")
            if not vendor.is_vendor:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{vendor.org_name} is not marked as a vendor")
        fields["preferred_vendor_id"] = vendor_id or None
    if "vendor_sku" in payload or not partial:
        fields["vendor_sku"] = (payload.get("vendor_sku") or "").strip() or None
    if "lead_time_days" in payload or not partial:
        days = payload.get("lead_time_days")
        if days is not None and (not isinstance(days, int) or days < 0):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lead time must be a whole number of days")
        fields["lead_time_days"] = days
    return fields


def _post_opening_balance(db: Session, product: CatalogProduct, *, quantity: Decimal | None, actor_user_id: int | None) -> None:
    ensure_product_levels(db, tenant_id=product.tenant_id, product_id=product.id)
    if quantity and quantity > 0:
        warehouse = ensure_default_warehouse(db, tenant_id=product.tenant_id)
        post_moves(db, tenant_id=product.tenant_id, actor_user_id=actor_user_id, moves=[MoveSpec(
            product_id=product.id, warehouse_id=warehouse.id, quantity=quantity,
            move_type="opening", source_type="catalog_product", source_id=product.id,
            source_line_id=product.id, reason="Opening balance",
        )])


def _opening_quantity(payload: dict) -> Decimal | None:
    return coerce_nonnegative_decimal(payload.get("stock_quantity"), field_name="stock_quantity", required=False)


WEIGHT_UNITS = {"kg", "g", "lb", "oz"}
DIMENSION_UNITS = {"cm", "m", "in"}


def _physical_fields(payload: dict, *, partial: bool) -> dict:
    """Weight and dimensions (13a C4); each unit from a small fixed list."""
    values: dict = {}
    for field in ("weight", "length", "width", "height"):
        if not partial or field in payload:
            values[field] = coerce_nonnegative_decimal(payload.get(field), field_name=field, required=False)
    for field, allowed in (("weight_unit", WEIGHT_UNITS), ("dimension_unit", DIMENSION_UNITS)):
        if not partial or field in payload:
            unit = (payload.get(field) or "").strip().lower() or None
            if unit is not None and unit not in allowed:
                raise HTTPException(status_code=422, detail=[{"loc": ["body", field], "msg": f"Choose one of {', '.join(sorted(allowed))}.", "type": "domain"}])
            values[field] = unit
    return values


def _create_fields(db: Session, tenant_id: int, payload: dict) -> dict:
    opening_quantity = _opening_quantity(payload)
    tracked = bool(payload.get("track_inventory")) or opening_quantity is not None
    if payload.get("track_inventory") is False and opening_quantity is not None:
        raise HTTPException(status_code=400, detail="A product with a quantity must track inventory")
    return {
        "barcode": normalize_catalog_code(payload.get("barcode")),
        **_purchasing_fields(db, tenant_id=tenant_id, payload=payload, partial=False),
        "stock_status": "out_of_stock" if tracked else _normalize_stock_status(payload.get("stock_status")),
        "stock_quantity": Decimal("0") if tracked else None,
        "track_inventory": int(tracked),
        "reorder_point": coerce_nonnegative_decimal(payload.get("reorder_point", 0), field_name="reorder_point", required=True),
        "reorder_quantity": coerce_nonnegative_decimal(payload.get("reorder_quantity", 0), field_name="reorder_quantity", required=True),
        **_physical_fields(payload, partial=False),
    }


def _after_create(db: Session, product: CatalogProduct, payload: dict, actor_user_id: int | None) -> None:
    if product.track_inventory:
        _post_opening_balance(db, product, quantity=_opening_quantity(payload), actor_user_id=actor_user_id)


def _prepare_update(db: Session, product: CatalogProduct, payload: dict):
    was_tracked = bool(product.track_inventory)
    requested_tracking = payload.get("track_inventory")
    if was_tracked and requested_tracking is False:
        raise HTTPException(status_code=409, detail="Tracked inventory cannot be disabled after movements exist")
    if was_tracked:
        if "stock_quantity" in payload and payload["stock_quantity"] is not None and Decimal(str(payload["stock_quantity"])) != Decimal(product.stock_quantity or 0):
            raise HTTPException(status_code=409, detail="Use Adjust stock to change a tracked product's quantity")
        if "stock_status" in payload and str(getattr(payload["stock_status"], "value", payload["stock_status"])) != product.stock_status:
            raise HTTPException(status_code=409, detail="Tracked stock status is derived from inventory")
        # A tracked product's cost is its moving average (12d §5 decision 3): Revalue changes it.
        if "cost_price" in payload:
            requested = payload.get("cost_price")
            current = Decimal(product.cost_price) if product.cost_price is not None else None
            if (None if requested in (None, "") else Decimal(str(requested))) != current:
                raise HTTPException(status_code=409, detail="A tracked product's cost is its average cost; use Revalue to change it")
            payload = {key: value for key, value in payload.items() if key != "cost_price"}
    enabling = not was_tracked and (requested_tracking is True or payload.get("stock_quantity") is not None)
    opening_quantity = _opening_quantity(payload) if enabling else None
    if enabling and requested_tracking is False:
        raise HTTPException(status_code=400, detail="A product with a quantity must track inventory")
    if not was_tracked and "stock_status" in payload and not enabling:
        product.stock_status = _normalize_stock_status(payload["stock_status"])
    if enabling:
        product.track_inventory = 1
        product.stock_quantity = Decimal("0")
        product.stock_status = "out_of_stock"

    def after_flush(session: Session) -> None:
        if enabling:
            _post_opening_balance(session, product, quantity=opening_quantity, actor_user_id=product.updated_by_user_id)

    return payload, after_flush


def _required_decimal(field_name: str):
    return lambda value: coerce_nonnegative_decimal(value, field_name=field_name, required=True)


def _serialize_extra(product: CatalogProduct) -> dict:
    return {
        "stock_status": product.stock_status,
        "stock_quantity": product.stock_quantity,
        "track_inventory": bool(product.track_inventory),
        "reorder_point": product.reorder_point,
        "reorder_quantity": product.reorder_quantity,
        "barcode": product.barcode,
        "preferred_vendor_id": product.preferred_vendor_id,
        "preferred_vendor_name": product.preferred_vendor.org_name if product.preferred_vendor else None,
        "vendor_sku": product.vendor_sku,
        "lead_time_days": product.lead_time_days,
        "weight": product.weight,
        "weight_unit": product.weight_unit,
        "length": product.length,
        "width": product.width,
        "height": product.height,
        "dimension_unit": product.dimension_unit,
    }


PRODUCT = CatalogKind(
    key="product",
    label="Product",
    module_key=CATALOG_PRODUCTS_MODULE,
    entity_type="catalog_product",
    query=PRODUCT_QUERY,
    response_model=CatalogProductResponse,
    conflict_detail="Product slug, SKU or barcode already exists.",
    create_fields=_create_fields,
    after_create=_after_create,
    prepare_update=_prepare_update,
    update_fields=("barcode", "reorder_point", "reorder_quantity"),
    update_field_groups=(
        lambda db, tenant_id, payload: _purchasing_fields(db, tenant_id=tenant_id, payload=payload, partial=True),
        lambda db, tenant_id, payload: _physical_fields(payload, partial=True),
    ),
    required_fields=frozenset({"stock_status", "reorder_point", "reorder_quantity"}),
    normalizers={
        "barcode": normalize_catalog_code,
        "reorder_point": _required_decimal("reorder_point"),
        "reorder_quantity": _required_decimal("reorder_quantity"),
    },
    serialize_extra=_serialize_extra,
)


def serialize_product(product: CatalogProduct) -> dict:
    return items.serialize(PRODUCT, product)


def list_products(db: Session, **kwargs) -> tuple[list[CatalogProduct], int]:
    return items.list_items(db, PRODUCT, **kwargs)


def list_products_cursor(db: Session, **kwargs) -> list[CatalogProduct]:
    return items.list_items_cursor(db, PRODUCT, **kwargs)


def list_deleted_products(db: Session, *, tenant_id: int, offset: int = 0, limit: int = 50) -> tuple[list[CatalogProduct], int]:
    return items.list_deleted_items(db, PRODUCT, tenant_id=tenant_id, offset=offset, limit=limit)


def get_product_or_404(db: Session, *, tenant_id: int, product_id: int, include_deleted: bool = False) -> CatalogProduct:
    return items.get_item_or_404(db, PRODUCT, tenant_id=tenant_id, item_id=product_id, include_deleted=include_deleted)


def create_product(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> CatalogProduct:
    return items.create_item(db, PRODUCT, tenant_id=tenant_id, actor_user_id=actor_user_id, payload=payload)


def update_product(db: Session, *, product: CatalogProduct, actor_user_id: int | None, payload: dict) -> CatalogProduct:
    return items.update_item(db, PRODUCT, record=product, actor_user_id=actor_user_id, payload=payload)


async def upload_product_media(db: Session, *, product: CatalogProduct, actor_user_id: int | None, file: UploadFile) -> CatalogProduct:
    return await items.upload_item_media(db, PRODUCT, record=product, actor_user_id=actor_user_id, file=file)


def soft_delete_product(db: Session, *, product: CatalogProduct, actor_user_id: int | None) -> CatalogProduct:
    return items.soft_delete_item(db, PRODUCT, record=product, actor_user_id=actor_user_id)


def restore_product(db: Session, *, product: CatalogProduct, actor_user_id: int | None) -> CatalogProduct:
    return items.restore_item(db, PRODUCT, record=product, actor_user_id=actor_user_id)
