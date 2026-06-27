from __future__ import annotations

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogProduct, CatalogService


SERVICE_SORT_FIELDS = {
    "name": CatalogService.name,
    "slug": CatalogService.slug,
    "currency": CatalogService.currency,
    "public_unit_price": CatalogService.public_unit_price,
    "is_public": CatalogService.is_public,
    "is_active": CatalogService.is_active,
    "created_at": CatalogService.created_at,
    "updated_at": CatalogService.updated_at,
}


def apply_service_sort(query, sort_by: str | None = None, sort_direction: str | None = None):
    column = SERVICE_SORT_FIELDS.get((sort_by or "").strip())
    if column is None:
        return query.order_by(CatalogService.updated_at.desc(), CatalogService.id.desc())
    direction = (sort_direction or "asc").lower()
    primary = column.desc() if direction == "desc" else column.asc()
    secondary = CatalogService.id.desc() if direction == "desc" else CatalogService.id.asc()
    return query.order_by(primary, secondary)


def slug_exists(
    db: Session,
    *,
    tenant_id: int,
    slug: str,
    service_id: int | None = None,
) -> bool:
    query = db.query(CatalogService.id).filter(
        CatalogService.tenant_id == tenant_id,
        CatalogService.slug == slug,
        CatalogService.deleted_at.is_(None),
    )
    if service_id is not None:
        query = query.filter(CatalogService.id != service_id)
    if query.first():
        return True
    return bool(
        db.query(CatalogProduct.id)
        .filter(
            CatalogProduct.tenant_id == tenant_id,
            CatalogProduct.slug == slug,
            CatalogProduct.deleted_at.is_(None),
        )
        .first()
    )


def list_services(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    offset: int = 0,
    limit: int = 50,
    sort_by: str | None = None,
    sort_direction: str | None = None,
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
    services = apply_service_sort(query, sort_by=sort_by, sort_direction=sort_direction).offset(offset).limit(limit).all()
    return services, total


def list_services_cursor(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    limit: int = 50,
    cursor: int | None = None,
) -> list[CatalogService]:
    query = db.query(CatalogService).filter(
        CatalogService.tenant_id == tenant_id,
        CatalogService.deleted_at.is_(None),
    )
    if not include_inactive:
        query = query.filter(CatalogService.is_active == 1)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(or_(CatalogService.name.ilike(pattern), CatalogService.description.ilike(pattern)))
    if cursor is not None:
        query = query.filter(CatalogService.id < cursor)
    return query.order_by(None).order_by(CatalogService.id.desc()).limit(limit + 1).all()


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
