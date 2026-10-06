"""Catalog services: the shared catalog item implementation with no kind-specific fields (13a E2)."""

from __future__ import annotations

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogService
from app.modules.catalog.repositories.catalog_item_repository import SERVICE_QUERY
from app.modules.catalog.schema import CatalogServiceResponse
from app.modules.catalog.services import catalog_item_services as items
from app.modules.catalog.services.catalog_item_services import CatalogKind

CATALOG_SERVICES_MODULE = "catalog_services"

SERVICE = CatalogKind(
    key="service",
    label="Service",
    module_key=CATALOG_SERVICES_MODULE,
    entity_type="catalog_service",
    query=SERVICE_QUERY,
    response_model=CatalogServiceResponse,
    conflict_detail="Service slug or SKU already exists.",
)


def serialize_service(service: CatalogService) -> dict:
    return items.serialize(SERVICE, service)


def list_services(db: Session, **kwargs) -> tuple[list[CatalogService], int]:
    return items.list_items(db, SERVICE, **kwargs)


def list_services_cursor(db: Session, **kwargs) -> list[CatalogService]:
    return items.list_items_cursor(db, SERVICE, **kwargs)


def list_deleted_services(db: Session, *, tenant_id: int, offset: int = 0, limit: int = 50) -> tuple[list[CatalogService], int]:
    return items.list_deleted_items(db, SERVICE, tenant_id=tenant_id, offset=offset, limit=limit)


def get_service_or_404(db: Session, *, tenant_id: int, service_id: int, include_deleted: bool = False) -> CatalogService:
    return items.get_item_or_404(db, SERVICE, tenant_id=tenant_id, item_id=service_id, include_deleted=include_deleted)


def create_service(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> CatalogService:
    return items.create_item(db, SERVICE, tenant_id=tenant_id, actor_user_id=actor_user_id, payload=payload)


def update_service(db: Session, *, service: CatalogService, actor_user_id: int | None, payload: dict) -> CatalogService:
    return items.update_item(db, SERVICE, record=service, actor_user_id=actor_user_id, payload=payload)


async def upload_service_media(db: Session, *, service: CatalogService, actor_user_id: int | None, file: UploadFile) -> CatalogService:
    return await items.upload_item_media(db, SERVICE, record=service, actor_user_id=actor_user_id, file=file)


def soft_delete_service(db: Session, *, service: CatalogService, actor_user_id: int | None) -> CatalogService:
    return items.soft_delete_item(db, SERVICE, record=service, actor_user_id=actor_user_id)


def restore_service(db: Session, *, service: CatalogService, actor_user_id: int | None) -> CatalogService:
    return items.restore_item(db, SERVICE, record=service, actor_user_id=actor_user_id)
