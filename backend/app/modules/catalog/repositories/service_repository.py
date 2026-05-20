from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct, CatalogService


def slug_exists(
    db: Session,
    *,
    tenant_id: int,
    slug: str,
    service_id: int | None = None,
) -> bool:
    query = db.query(CatalogService.id).filter(CatalogService.tenant_id == tenant_id, CatalogService.slug == slug)
    if service_id is not None:
        query = query.filter(CatalogService.id != service_id)
    if query.first():
        return True
    return bool(db.query(CatalogProduct.id).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.slug == slug).first())


def list_services(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[CatalogService], int]:
    query = db.query(CatalogService).filter(
        CatalogService.tenant_id == tenant_id,
        CatalogService.deleted_at.is_(None),
    )
    if not include_inactive:
        query = query.filter(CatalogService.is_active == 1)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(CatalogService.name.ilike(pattern), CatalogService.description.ilike(pattern)))
    total = query.count()
    services = query.order_by(CatalogService.updated_at.desc(), CatalogService.id.desc()).offset(offset).limit(limit).all()
    return services, total


def list_deleted_services(
    db: Session,
    *,
    tenant_id: int,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[CatalogService], int]:
    query = db.query(CatalogService).filter(
        CatalogService.tenant_id == tenant_id,
        CatalogService.deleted_at.is_not(None),
    )
    total = query.count()
    services = (
        query.order_by(CatalogService.deleted_at.desc(), CatalogService.updated_at.desc(), CatalogService.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return services, total


def get_service(
    db: Session,
    *,
    tenant_id: int,
    service_id: int,
    include_deleted: bool = False,
) -> CatalogService | None:
    query = db.query(CatalogService).filter(CatalogService.tenant_id == tenant_id, CatalogService.id == service_id)
    if not include_deleted:
        query = query.filter(CatalogService.deleted_at.is_(None))
    return query.first()

