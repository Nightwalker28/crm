from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.website_integrations.models import WebsiteIntegrationApiKey, WebsiteIntegrationOrder


def list_api_keys(db: Session, *, tenant_id: int) -> list[WebsiteIntegrationApiKey]:
    return (
        db.query(WebsiteIntegrationApiKey)
        .filter(WebsiteIntegrationApiKey.tenant_id == tenant_id)
        .order_by(WebsiteIntegrationApiKey.created_at.desc(), WebsiteIntegrationApiKey.id.desc())
        .all()
    )


def get_api_key(db: Session, *, tenant_id: int, key_id: int) -> WebsiteIntegrationApiKey | None:
    return (
        db.query(WebsiteIntegrationApiKey)
        .filter(WebsiteIntegrationApiKey.tenant_id == tenant_id, WebsiteIntegrationApiKey.id == key_id)
        .first()
    )


def get_api_key_by_hash(db: Session, *, key_hash: str) -> WebsiteIntegrationApiKey | None:
    return db.query(WebsiteIntegrationApiKey).filter(WebsiteIntegrationApiKey.key_hash == key_hash).first()


def build_public_product_query(db: Session, *, tenant_id: int, for_update: bool = False):
    query = db.query(CatalogProduct).filter(
        CatalogProduct.tenant_id == tenant_id,
        CatalogProduct.is_public == 1,
        CatalogProduct.is_active == 1,
        CatalogProduct.deleted_at.is_(None),
    )
    return query.with_for_update() if for_update else query


def build_public_service_query(db: Session, *, tenant_id: int):
    return db.query(CatalogService).filter(
        CatalogService.tenant_id == tenant_id,
        CatalogService.is_public == 1,
        CatalogService.is_active == 1,
        CatalogService.deleted_at.is_(None),
    )


def build_catalog_queries(
    db: Session,
    *,
    tenant_id: int,
    include_private: bool,
    search: str | None = None,
    item_type: str | None = None,
):
    product_query = db.query(CatalogProduct).filter(
        CatalogProduct.tenant_id == tenant_id,
        CatalogProduct.deleted_at.is_(None),
        CatalogProduct.slug.is_not(None),
    )
    service_query = db.query(CatalogService).filter(
        CatalogService.tenant_id == tenant_id,
        CatalogService.deleted_at.is_(None),
        CatalogService.slug.is_not(None),
    )
    if not include_private:
        product_query = product_query.filter(CatalogProduct.is_public == 1, CatalogProduct.is_active == 1)
        service_query = service_query.filter(CatalogService.is_public == 1, CatalogService.is_active == 1)
    if item_type:
        normalized_type = item_type.strip().lower()
        if normalized_type == "product":
            service_query = service_query.filter(False)
        elif normalized_type == "service":
            product_query = product_query.filter(False)
        else:
            product_query = product_query.filter(False)
            service_query = service_query.filter(False)
    if search:
        value = f"%{search.strip()}%"
        product_query = product_query.filter(
            or_(
                CatalogProduct.name.ilike(value),
                CatalogProduct.slug.ilike(value),
                CatalogProduct.sku.ilike(value),
            )
        )
        service_query = service_query.filter(
            or_(
                CatalogService.name.ilike(value),
                CatalogService.slug.ilike(value),
            )
        )
    return product_query, service_query


def list_orders(db: Session, *, tenant_id: int, limit: int | None = None, offset: int = 0) -> tuple[list[WebsiteIntegrationOrder], int]:
    query = (
        db.query(WebsiteIntegrationOrder)
        .options(selectinload(WebsiteIntegrationOrder.line_items))
        .filter(WebsiteIntegrationOrder.tenant_id == tenant_id)
    )
    total = query.count()
    query = query.order_by(WebsiteIntegrationOrder.created_at.desc(), WebsiteIntegrationOrder.id.desc())
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return query.all(), total


def list_orders_cursor(db: Session, *, tenant_id: int, limit: int, cursor: int | None = None) -> list[WebsiteIntegrationOrder]:
    query = (
        db.query(WebsiteIntegrationOrder)
        .options(selectinload(WebsiteIntegrationOrder.line_items))
        .filter(WebsiteIntegrationOrder.tenant_id == tenant_id)
    )
    if cursor is not None:
        query = query.filter(WebsiteIntegrationOrder.id < cursor)
    return query.order_by(None).order_by(WebsiteIntegrationOrder.id.desc()).limit(limit + 1).all()


def get_order(db: Session, *, tenant_id: int, order_id: int) -> WebsiteIntegrationOrder | None:
    return (
        db.query(WebsiteIntegrationOrder)
        .options(selectinload(WebsiteIntegrationOrder.line_items))
        .filter(WebsiteIntegrationOrder.tenant_id == tenant_id, WebsiteIntegrationOrder.id == order_id)
        .first()
    )


def get_order_by_reference(db: Session, *, tenant_id: int, external_reference: str) -> WebsiteIntegrationOrder | None:
    return (
        db.query(WebsiteIntegrationOrder)
        .options(selectinload(WebsiteIntegrationOrder.line_items))
        .filter(
            WebsiteIntegrationOrder.tenant_id == tenant_id,
            WebsiteIntegrationOrder.external_reference == external_reference,
        )
        .first()
    )


def get_public_product_by_slug(db: Session, *, tenant_id: int, slug: str) -> CatalogProduct | None:
    return build_public_product_query(db, tenant_id=tenant_id).filter(CatalogProduct.slug == slug).first()


def get_public_service_by_slug(db: Session, *, tenant_id: int, slug: str) -> CatalogService | None:
    return build_public_service_query(db, tenant_id=tenant_id).filter(CatalogService.slug == slug).first()


def get_public_product_for_stock_update(db: Session, *, product: CatalogProduct) -> CatalogProduct | None:
    return (
        db.query(CatalogProduct)
        .filter(
            CatalogProduct.tenant_id == product.tenant_id,
            CatalogProduct.id == product.id,
            CatalogProduct.is_public == 1,
            CatalogProduct.is_active == 1,
            CatalogProduct.deleted_at.is_(None),
        )
        .populate_existing()
        .with_for_update()
        .first()
    )
