from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct, CatalogService


PRODUCT_SORT_FIELDS = {
    "name": CatalogProduct.name,
    "slug": CatalogProduct.slug,
    "sku": CatalogProduct.sku,
    "currency": CatalogProduct.currency,
    "public_unit_price": CatalogProduct.public_unit_price,
    "stock_status": CatalogProduct.stock_status,
    "stock_quantity": CatalogProduct.stock_quantity,
    "is_public": CatalogProduct.is_public,
    "is_active": CatalogProduct.is_active,
    "created_at": CatalogProduct.created_at,
    "updated_at": CatalogProduct.updated_at,
}


def apply_product_sort(query, sort_by: str | None = None, sort_direction: str | None = None):
    column = PRODUCT_SORT_FIELDS.get((sort_by or "").strip())
    if column is None:
        return query.order_by(CatalogProduct.updated_at.desc(), CatalogProduct.id.desc())
    direction = (sort_direction or "asc").lower()
    primary = column.desc() if direction == "desc" else column.asc()
    secondary = CatalogProduct.id.desc() if direction == "desc" else CatalogProduct.id.asc()
    return query.order_by(primary, secondary)


def slug_exists(
    db: Session,
    *,
    tenant_id: int,
    slug: str,
    product_id: int | None = None,
) -> bool:
    query = db.query(CatalogProduct.id).filter(
        CatalogProduct.tenant_id == tenant_id,
        CatalogProduct.slug == slug,
        CatalogProduct.deleted_at.is_(None),
    )
    if product_id is not None:
        query = query.filter(CatalogProduct.id != product_id)
    if query.first():
        return True
    return bool(
        db.query(CatalogService.id)
        .filter(
            CatalogService.tenant_id == tenant_id,
            CatalogService.slug == slug,
            CatalogService.deleted_at.is_(None),
        )
        .first()
    )


def list_products(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    offset: int = 0,
    limit: int = 50,
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[CatalogProduct], int]:
    query = db.query(CatalogProduct).filter(
        CatalogProduct.tenant_id == tenant_id,
        CatalogProduct.deleted_at.is_(None),
    )
    if not include_inactive:
        query = query.filter(CatalogProduct.is_active == 1)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                CatalogProduct.name.ilike(pattern),
                CatalogProduct.sku.ilike(pattern),
                CatalogProduct.description.ilike(pattern),
            )
        )
    total = query.count()
    products = apply_product_sort(query, sort_by=sort_by, sort_direction=sort_direction).offset(offset).limit(limit).all()
    return products, total


def list_products_cursor(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    limit: int = 50,
    cursor: int | None = None,
) -> list[CatalogProduct]:
    query = db.query(CatalogProduct).filter(
        CatalogProduct.tenant_id == tenant_id,
        CatalogProduct.deleted_at.is_(None),
    )
    if not include_inactive:
        query = query.filter(CatalogProduct.is_active == 1)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                CatalogProduct.name.ilike(pattern),
                CatalogProduct.sku.ilike(pattern),
                CatalogProduct.description.ilike(pattern),
            )
        )
    if cursor is not None:
        query = query.filter(CatalogProduct.id < cursor)
    return query.order_by(None).order_by(CatalogProduct.id.desc()).limit(limit + 1).all()


def list_deleted_products(
    db: Session,
    *,
    tenant_id: int,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[CatalogProduct], int]:
    query = db.query(CatalogProduct).filter(
        CatalogProduct.tenant_id == tenant_id,
        CatalogProduct.deleted_at.is_not(None),
    )
    total = query.count()
    products = (
        query.order_by(CatalogProduct.deleted_at.desc(), CatalogProduct.updated_at.desc(), CatalogProduct.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return products, total


def get_product(
    db: Session,
    *,
    tenant_id: int,
    product_id: int,
    include_deleted: bool = False,
) -> CatalogProduct | None:
    query = db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id == product_id)
    if not include_deleted:
        query = query.filter(CatalogProduct.deleted_at.is_(None))
    return query.first()
