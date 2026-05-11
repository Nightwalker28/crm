from __future__ import annotations

from datetime import datetime
from decimal import Decimal
import re

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.uploads import build_media_url, delete_local_media_file, persist_media_file, read_image_upload
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.catalog.schema import CatalogServiceResponse
from app.modules.platform.services.activity_logs import log_activity

CATALOG_SERVICES_MODULE = "catalog_services"


def _normalize_slug(value: str | None, *, fallback: str) -> str | None:
    source = (value or fallback or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", source).strip("-")
    return normalized[:160] or None


def _ensure_slug_available(
    db: Session,
    *,
    tenant_id: int,
    slug: str | None,
    service_id: int | None = None,
) -> None:
    if not slug:
        return
    service_query = db.query(CatalogService).filter(
        CatalogService.tenant_id == tenant_id,
        CatalogService.slug == slug,
    )
    if service_id is not None:
        service_query = service_query.filter(CatalogService.id != service_id)
    if service_query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Service slug already exists.")
    if db.query(CatalogProduct).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.slug == slug).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Catalog slug already exists on a product.")


def _service_state(service: CatalogService) -> dict:
    return CatalogServiceResponse.model_validate(serialize_service(service)).model_dump(mode="json")


def serialize_service(service: CatalogService) -> dict:
    return {
        "id": service.id,
        "name": service.name,
        "slug": service.slug,
        "description": service.description,
        "currency": service.currency,
        "public_unit_price": service.public_unit_price,
        "is_public": bool(service.is_public),
        "is_active": bool(service.is_active),
        "media_url": build_media_url(service.media_path) if service.media_path else None,
        "media_content_type": service.media_content_type,
        "media_original_filename": service.media_original_filename,
        "created_at": service.created_at,
        "updated_at": service.updated_at,
    }


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
        query = query.filter(
            or_(
                CatalogService.name.ilike(pattern),
                CatalogService.description.ilike(pattern),
            )
        )
    total = query.count()
    services = (
        query.order_by(CatalogService.updated_at.desc(), CatalogService.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
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


def get_service_or_404(
    db: Session,
    *,
    tenant_id: int,
    service_id: int,
    include_deleted: bool = False,
) -> CatalogService:
    query = db.query(CatalogService).filter(
        CatalogService.tenant_id == tenant_id,
        CatalogService.id == service_id,
    )
    if not include_deleted:
        query = query.filter(CatalogService.deleted_at.is_(None))
    service = query.first()
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")
    return service


def create_service(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> CatalogService:
    slug = _normalize_slug(payload.get("slug"), fallback=payload["name"])
    _ensure_slug_available(db, tenant_id=tenant_id, slug=slug)
    service = CatalogService(
        tenant_id=tenant_id,
        name=str(payload["name"]).strip(),
        slug=slug,
        description=(payload.get("description") or "").strip() or None,
        currency=str(payload.get("currency") or "USD").strip().upper(),
        public_unit_price=Decimal(str(payload.get("public_unit_price", 0))),
        is_public=1 if payload.get("is_public", False) else 0,
        is_active=1 if payload.get("is_active", True) else 0,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(service)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Service slug already exists.") from exc
    db.refresh(service)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=CATALOG_SERVICES_MODULE,
        entity_type="catalog_service",
        entity_id=service.id,
        action="create",
        description=f"Created service {service.name}",
        after_state=_service_state(service),
    )
    return service


def update_service(
    db: Session,
    *,
    service: CatalogService,
    actor_user_id: int | None,
    payload: dict,
) -> CatalogService:
    before_state = _service_state(service)
    required_fields = {"name", "currency", "public_unit_price"}
    for field in ["name", "slug", "description", "currency", "public_unit_price", "is_public", "is_active"]:
        if field not in payload:
            continue
        value = payload[field]
        if value is None and field in required_fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} cannot be null")
        if field == "slug":
            value = _normalize_slug(value, fallback=service.name)
            _ensure_slug_available(db, tenant_id=service.tenant_id, slug=value, service_id=service.id)
        elif field == "description":
            value = (value or "").strip() or None
        elif field == "name" and value is not None:
            value = str(value).strip()
        elif field == "currency" and value is not None:
            value = str(value).strip().upper()
        elif field == "public_unit_price" and value is not None:
            value = Decimal(str(value))
        elif field in {"is_public", "is_active"} and value is not None:
            value = 1 if value else 0
        setattr(service, field, value)
    service.updated_by_user_id = actor_user_id
    db.add(service)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Service slug already exists.") from exc
    db.refresh(service)
    log_activity(
        db,
        tenant_id=service.tenant_id,
        actor_user_id=actor_user_id,
        module_key=CATALOG_SERVICES_MODULE,
        entity_type="catalog_service",
        entity_id=service.id,
        action="update",
        description=f"Updated service {service.name}",
        before_state=before_state,
        after_state=_service_state(service),
    )
    return service


async def upload_service_media(
    db: Session,
    *,
    service: CatalogService,
    actor_user_id: int | None,
    file: UploadFile,
) -> CatalogService:
    before_state = _service_state(service)
    content, extension = await read_image_upload(file)
    previous_media_path = service.media_path
    service.media_path = persist_media_file(
        category="catalog-services",
        owner_key=f"tenant-{service.tenant_id}/service-{service.id}",
        extension=extension,
        content=content,
    )
    service.media_content_type = file.content_type
    service.media_original_filename = (file.filename or "service-image")[:255]
    service.updated_by_user_id = actor_user_id
    db.add(service)
    db.commit()
    db.refresh(service)
    delete_local_media_file(previous_media_path)
    log_activity(
        db,
        tenant_id=service.tenant_id,
        actor_user_id=actor_user_id,
        module_key=CATALOG_SERVICES_MODULE,
        entity_type="catalog_service",
        entity_id=service.id,
        action="media.update",
        description=f"Updated service media for {service.name}",
        before_state=before_state,
        after_state=_service_state(service),
    )
    return service


def soft_delete_service(
    db: Session,
    *,
    service: CatalogService,
    actor_user_id: int | None,
) -> CatalogService:
    if service.deleted_at is None:
        before_state = _service_state(service)
        service.deleted_at = datetime.utcnow()
        service.updated_by_user_id = actor_user_id
        db.add(service)
        db.commit()
        db.refresh(service)
        log_activity(
            db,
            tenant_id=service.tenant_id,
            actor_user_id=actor_user_id,
            module_key=CATALOG_SERVICES_MODULE,
            entity_type="catalog_service",
            entity_id=service.id,
            action="soft_delete",
            description=f"Deleted service {service.name}",
            before_state=before_state,
            after_state=_service_state(service),
        )
    return service


def restore_service(
    db: Session,
    *,
    service: CatalogService,
    actor_user_id: int | None,
) -> CatalogService:
    if service.deleted_at is not None:
        service.deleted_at = None
        service.updated_by_user_id = actor_user_id
        db.add(service)
        db.commit()
        db.refresh(service)
        log_activity(
            db,
            tenant_id=service.tenant_id,
            actor_user_id=actor_user_id,
            module_key=CATALOG_SERVICES_MODULE,
            entity_type="catalog_service",
            entity_id=service.id,
            action="restore",
            description=f"Restored service {service.name}",
            after_state=_service_state(service),
        )
    return service
