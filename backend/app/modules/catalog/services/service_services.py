from __future__ import annotations

from decimal import Decimal, InvalidOperation

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.uploads import delete_local_media_file, persist_media_file, read_image_upload
from app.modules.catalog.models import CatalogService
from app.modules.catalog.repositories import service_repository
from app.modules.catalog.schema import CatalogServiceResponse
from app.modules.catalog.services.common import (
    catalog_media_payload,
    coerce_catalog_bool,
    normalize_catalog_currency,
    normalize_catalog_slug,
    utc_now,
)
from app.modules.platform.services.activity_logs import log_activity

CATALOG_SERVICES_MODULE = "catalog_services"


def _coerce_nonnegative_decimal(value, *, field_name: str) -> Decimal:
    if value is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} cannot be null")
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {field_name}") from exc
    if not decimal_value.is_finite() or decimal_value < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} must be non-negative")
    return decimal_value


def _ensure_slug_available(
    db: Session,
    *,
    tenant_id: int,
    slug: str | None,
    service_id: int | None = None,
) -> None:
    if not slug:
        return
    if service_repository.slug_exists(db, tenant_id=tenant_id, slug=slug, service_id=service_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Catalog slug already exists.")


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
        **catalog_media_payload(service),
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
    sort_by: str | None = None,
    sort_direction: str | None = None,
) -> tuple[list[CatalogService], int]:
    return service_repository.list_services(
        db,
        tenant_id=tenant_id,
        search=search,
        include_inactive=include_inactive,
        offset=offset,
        limit=limit,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )


def list_services_cursor(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    limit: int = 50,
    cursor: int | None = None,
) -> list[CatalogService]:
    return service_repository.list_services_cursor(
        db,
        tenant_id=tenant_id,
        search=search,
        include_inactive=include_inactive,
        limit=limit,
        cursor=cursor,
    )


def list_deleted_services(
    db: Session,
    *,
    tenant_id: int,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[CatalogService], int]:
    return service_repository.list_deleted_services(db, tenant_id=tenant_id, offset=offset, limit=limit)


def get_service_or_404(
    db: Session,
    *,
    tenant_id: int,
    service_id: int,
    include_deleted: bool = False,
) -> CatalogService:
    service = service_repository.get_service(
        db,
        tenant_id=tenant_id,
        service_id=service_id,
        include_deleted=include_deleted,
    )
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found.")
    return service


def create_service(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> CatalogService:
    slug = normalize_catalog_slug(payload.get("slug"), fallback=payload["name"])
    _ensure_slug_available(db, tenant_id=tenant_id, slug=slug)
    service = CatalogService(
        tenant_id=tenant_id,
        name=str(payload["name"]).strip(),
        slug=slug,
        description=(payload.get("description") or "").strip() or None,
        currency=normalize_catalog_currency(payload.get("currency")),
        public_unit_price=_coerce_nonnegative_decimal(payload.get("public_unit_price", 0), field_name="public_unit_price"),
        is_public=coerce_catalog_bool(payload.get("is_public", False), field_name="is_public"),
        is_active=coerce_catalog_bool(payload.get("is_active", True), field_name="is_active"),
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
            value = normalize_catalog_slug(value, fallback=service.name)
            _ensure_slug_available(db, tenant_id=service.tenant_id, slug=value, service_id=service.id)
        elif field == "description":
            value = (value or "").strip() or None
        elif field == "name" and value is not None:
            value = str(value).strip()
        elif field == "currency" and value is not None:
            value = normalize_catalog_currency(value)
        elif field == "public_unit_price" and value is not None:
            value = _coerce_nonnegative_decimal(value, field_name="public_unit_price")
        elif field in {"is_public", "is_active"} and value is not None:
            value = coerce_catalog_bool(value, field_name=field)
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
    new_media_path = persist_media_file(
        category="catalog-services",
        owner_key=f"tenant-{service.tenant_id}/service-{service.id}",
        extension=extension,
        content=content,
    )
    service.media_path = new_media_path
    service.media_content_type = file.content_type
    service.media_original_filename = (file.filename or "service-image")[:255]
    service.updated_by_user_id = actor_user_id
    db.add(service)
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_local_media_file(new_media_path)
        raise
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
        service.deleted_at = utc_now()
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
        _ensure_slug_available(db, tenant_id=service.tenant_id, slug=service.slug, service_id=service.id)
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
