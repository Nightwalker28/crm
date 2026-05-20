from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct, CatalogService


def slug_exists(
    db: Session,
    *,
    tenant_id: int,
    slug: str,
    product_id: int | None = None,
) -> bool:
    query = db.query(CatalogProduct.id).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.slug == slug)
    if product_id is not None:
        query = query.filter(CatalogProduct.id != product_id)
    if query.first():
        return True
    return bool(db.query(CatalogService.id).filter(CatalogService.tenant_id == tenant_id, CatalogService.slug == slug).first())


def list_products(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    offset: int = 0,
    limit: int = 50,
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
    products = query.order_by(CatalogProduct.updated_at.desc(), CatalogProduct.id.desc()).offset(offset).limit(limit).all()
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
