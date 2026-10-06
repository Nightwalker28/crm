"""Products and services: one implementation, parameterised by kind (13a E2).

The two used to be copies of each other, about 1,350 lines whose route files differed in 58.
What a product has and a service does not (stock tracking, barcode, reorder levels, a preferred
vendor) is a `CatalogKind` hook; everything else is written once here.

Each action commits once, with its activity row (13a E5).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.uploads import build_media_url, delete_local_media_file, persist_media_file, read_image_upload
from app.modules.catalog.models import CatalogItemImage
from app.modules.platform.services.custom_fields import sync_custom_fields
from app.modules.catalog.repositories import catalog_item_repository as repository
from app.modules.catalog.repositories.catalog_item_repository import CatalogItemQuerySpec
from app.modules.catalog.services.common import (
    catalog_detail_payload,
    catalog_media_payload,
    coerce_catalog_bool,
    normalize_catalog_code,
    normalize_catalog_currency,
    normalize_catalog_detail_fields,
    normalize_catalog_slug,
    utc_now,
)
from app.modules.platform.services.activity_logs import log_activity

#: The fields every kind updates the same way, in the order they are applied.
SHARED_UPDATE_FIELDS = ("name", "slug", "description", "sku", "currency", "public_unit_price", "is_public", "is_active")
SHARED_REQUIRED_FIELDS = frozenset({"name", "currency", "public_unit_price"})


def coerce_nonnegative_decimal(value, *, field_name: str, required: bool = True) -> Decimal | None:
    if value is None:
        if required:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} cannot be null")
        return None
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {field_name}") from exc
    if not decimal_value.is_finite() or decimal_value < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} must be non-negative")
    return decimal_value


#: `(db, record, payload) -> (payload, after_flush)`: validates what only this kind checks, may
#: drop keys from the payload, and returns work to do once the row has an id (or None).
PrepareUpdate = Callable[[Session, Any, dict], tuple[dict, Callable[[Session], None] | None]]


@dataclass(frozen=True)
class CatalogKind:
    key: str  # "product" | "service"
    label: str  # "Product" | "Service", for messages
    module_key: str
    entity_type: str
    query: CatalogItemQuerySpec
    response_model: Any
    #: Unique-constraint message: what a duplicate can be.
    conflict_detail: str
    #: Constructor fields beyond the shared ones, for a new record.
    create_fields: Callable[[Session, int, dict], dict] = lambda db, tenant_id, payload: {}
    #: Runs once the new record is flushed (an opening stock balance).
    after_create: Callable[[Session, Any, dict, int | None], None] = lambda db, record, payload, actor_user_id: None
    prepare_update: PrepareUpdate = lambda db, record, payload: (payload, None)
    #: Fields applied directly from the payload on update, beyond the shared ones.
    update_fields: tuple[str, ...] = ()
    #: Kind fields set from the payload as a group (`(db, tenant_id, payload) -> values`).
    update_field_groups: tuple[Callable[[Session, int, dict], dict], ...] = ()
    required_fields: frozenset[str] = field(default_factory=frozenset)
    #: `field -> normalizer(value)` for this kind's own update fields.
    normalizers: dict[str, Callable[[Any], Any]] = field(default_factory=dict)
    serialize_extra: Callable[[Any], dict] = lambda record: {}

    @property
    def model(self):
        return self.query.model


def serialize(kind: CatalogKind, record) -> dict:
    return {
        "id": record.id,
        "name": record.name,
        "slug": record.slug,
        "description": record.description,
        "sku": record.sku,
        "currency": record.currency,
        "public_unit_price": record.public_unit_price,
        **kind.serialize_extra(record),
        **catalog_detail_payload(record),
        "is_public": bool(record.is_public),
        "is_active": bool(record.is_active),
        **catalog_media_payload(record),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
        "custom_fields": getattr(record, "custom_fields", None),
        "images": getattr(record, "images", None) or [],
    }


def _state(kind: CatalogKind, record) -> dict:
    return kind.response_model.model_validate(serialize(kind, record)).model_dump(mode="json")


def _ensure_slug_available(db: Session, kind: CatalogKind, *, tenant_id: int, slug: str | None, record_id: int | None = None) -> None:
    if slug and repository.slug_exists(db, tenant_id=tenant_id, slug=slug, model=kind.model, record_id=record_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Catalog slug already exists.")


def _log(db: Session, kind: CatalogKind, record, *, actor_user_id: int | None, action: str, description: str,
         before_state: dict | None = None) -> None:
    # Within the transaction, so the row's server-set timestamps are in its after-state.
    db.refresh(record)
    log_activity(
        db,
        tenant_id=record.tenant_id,
        actor_user_id=actor_user_id,
        module_key=kind.module_key,
        entity_type=kind.entity_type,
        entity_id=record.id,
        action=action,
        description=description,
        before_state=before_state,
        after_state=_state(kind, record),
        commit=False,
    )


def _commit(db: Session, kind: CatalogKind) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=kind.conflict_detail) from exc


def list_items(db: Session, kind: CatalogKind, **kwargs) -> tuple[list, int]:
    return repository.list_items(db, kind.query, **kwargs)


def list_items_cursor(db: Session, kind: CatalogKind, **kwargs) -> list:
    return repository.list_items_cursor(db, kind.query, **kwargs)


def list_deleted_items(db: Session, kind: CatalogKind, *, tenant_id: int, offset: int = 0, limit: int = 50) -> tuple[list, int]:
    return repository.list_deleted_items(db, kind.query, tenant_id=tenant_id, offset=offset, limit=limit)


def get_item_or_404(db: Session, kind: CatalogKind, *, tenant_id: int, item_id: int, include_deleted: bool = False):
    record = repository.get_item(db, kind.query, tenant_id=tenant_id, item_id=item_id, include_deleted=include_deleted)
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{kind.label} not found.")
    return record


def create_item(db: Session, kind: CatalogKind, *, tenant_id: int, actor_user_id: int | None, payload: dict):
    slug = normalize_catalog_slug(payload.get("slug"), fallback=payload["name"])
    _ensure_slug_available(db, kind, tenant_id=tenant_id, slug=slug)
    record = kind.model(
        tenant_id=tenant_id,
        name=str(payload["name"]).strip(),
        slug=slug,
        description=(payload.get("description") or "").strip() or None,
        sku=normalize_catalog_code(payload.get("sku")),
        **normalize_catalog_detail_fields(db, tenant_id=tenant_id, payload=payload, partial=False),
        **kind.create_fields(db, tenant_id, payload),
        currency=normalize_catalog_currency(payload.get("currency")),
        public_unit_price=coerce_nonnegative_decimal(payload.get("public_unit_price", 0), field_name="public_unit_price"),
        is_public=coerce_catalog_bool(payload.get("is_public", False), field_name="is_public"),
        is_active=coerce_catalog_bool(payload.get("is_active", True), field_name="is_active"),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(record)
    try:
        db.flush()
        kind.after_create(db, record, payload, actor_user_id)
        db.flush()
        sync_custom_fields(db, tenant_id=tenant_id, module_key=kind.module_key, record=record, payload=payload, created=True,
                           enforce_required="custom_fields" in payload)
        _log(db, kind, record, actor_user_id=actor_user_id, action="create", description=f"Created {kind.key} {record.name}")
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=kind.conflict_detail) from exc
    _commit(db, kind)
    db.refresh(record)
    return record


def update_item(db: Session, kind: CatalogKind, *, record, actor_user_id: int | None, payload: dict):
    before_state = _state(kind, record)
    payload, after_flush = kind.prepare_update(db, record, payload)
    for name, value in normalize_catalog_detail_fields(db, tenant_id=record.tenant_id, payload=payload, partial=True, existing=record).items():
        setattr(record, name, value)
    for group in kind.update_field_groups:
        for name, value in group(db, record.tenant_id, payload).items():
            setattr(record, name, value)
    required = SHARED_REQUIRED_FIELDS | kind.required_fields
    for name in (*SHARED_UPDATE_FIELDS[:4], *kind.update_fields, *SHARED_UPDATE_FIELDS[4:]):
        if name not in payload:
            continue
        value = payload[name]
        if value is None and name in required:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{name} cannot be null")
        if name == "slug":
            value = normalize_catalog_slug(value, fallback=record.name)
            _ensure_slug_available(db, kind, tenant_id=record.tenant_id, slug=value, record_id=record.id)
        elif name == "description":
            value = (value or "").strip() or None
        elif name == "sku":
            value = normalize_catalog_code(value)
        elif name == "name" and value is not None:
            value = str(value).strip()
        elif name == "currency" and value is not None:
            value = normalize_catalog_currency(value)
        elif name == "public_unit_price" and value is not None:
            value = coerce_nonnegative_decimal(value, field_name=name)
        elif name in {"is_public", "is_active"} and value is not None:
            value = coerce_catalog_bool(value, field_name=name)
        elif name in kind.normalizers and value is not None:
            value = kind.normalizers[name](value)
        setattr(record, name, value)
    record.updated_by_user_id = actor_user_id
    db.add(record)
    try:
        db.flush()
        if after_flush is not None:
            after_flush(db)
            db.flush()
        sync_custom_fields(db, tenant_id=record.tenant_id, module_key=kind.module_key, record=record, payload=payload, created=False)
        _log(db, kind, record, actor_user_id=actor_user_id, action="update", description=f"Updated {kind.key} {record.name}",
             before_state=before_state)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=kind.conflict_detail) from exc
    _commit(db, kind)
    db.refresh(record)
    return record


async def upload_item_media(db: Session, kind: CatalogKind, *, record, actor_user_id: int | None, file: UploadFile):
    before_state = _state(kind, record)
    content, extension = await read_image_upload(file)
    previous_media_path = record.media_path
    new_media_path = persist_media_file(
        category=f"catalog-{kind.key}s",
        owner_key=f"tenant-{record.tenant_id}/{kind.key}-{record.id}",
        extension=extension,
        content=content,
    )
    record.media_path = new_media_path
    record.media_content_type = file.content_type
    record.media_original_filename = (file.filename or f"{kind.key}-image")[:255]
    record.updated_by_user_id = actor_user_id
    db.add(record)
    try:
        db.flush()
        _log(db, kind, record, actor_user_id=actor_user_id, action="media.update",
             description=f"Updated {kind.key} media for {record.name}", before_state=before_state)
        db.commit()
    except Exception:
        db.rollback()
        delete_local_media_file(new_media_path)
        raise
    db.refresh(record)
    delete_local_media_file(previous_media_path)
    return record


MAX_GALLERY_IMAGES = 12


def gallery(db: Session, kind: CatalogKind, record) -> list[dict]:
    """The item's other pictures, after its main image (13a C4)."""
    rows = (
        db.query(CatalogItemImage)
        .filter(CatalogItemImage.tenant_id == record.tenant_id, CatalogItemImage.item_kind == kind.key, CatalogItemImage.item_id == record.id)
        .order_by(CatalogItemImage.position, CatalogItemImage.id)
        .all()
    )
    return [
        {"id": row.id, "url": build_media_url(row.media_path), "content_type": row.media_content_type,
         "original_filename": row.media_original_filename, "position": row.position}
        for row in rows
    ]


async def add_gallery_image(db: Session, kind: CatalogKind, *, record, actor_user_id: int | None, file: UploadFile) -> list[dict]:
    existing = gallery(db, kind, record)
    if len(existing) >= MAX_GALLERY_IMAGES:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"An item keeps up to {MAX_GALLERY_IMAGES} more pictures; remove one first")
    content, extension = await read_image_upload(file)
    path = persist_media_file(
        category=f"catalog-{kind.key}s", owner_key=f"tenant-{record.tenant_id}/{kind.key}-{record.id}/gallery",
        extension=extension, content=content,
    )
    try:
        db.add(CatalogItemImage(
            tenant_id=record.tenant_id, item_kind=kind.key, item_id=record.id, media_path=path, media_content_type=file.content_type,
            media_original_filename=(file.filename or f"{kind.key}-image")[:255], position=len(existing),
        ))
        db.flush()
        _log(db, kind, record, actor_user_id=actor_user_id, action="media.update", description=f"Added a picture to {record.name}")
        db.commit()
    except Exception:
        db.rollback()
        delete_local_media_file(path)
        raise
    return gallery(db, kind, record)


def remove_gallery_image(db: Session, kind: CatalogKind, *, record, actor_user_id: int | None, image_id: int) -> list[dict]:
    image = (
        db.query(CatalogItemImage)
        .filter(CatalogItemImage.tenant_id == record.tenant_id, CatalogItemImage.item_kind == kind.key,
                CatalogItemImage.item_id == record.id, CatalogItemImage.id == image_id)
        .first()
    )
    if image is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Picture not found")
    path = image.media_path
    db.delete(image)
    db.flush()
    _log(db, kind, record, actor_user_id=actor_user_id, action="media.update", description=f"Removed a picture from {record.name}")
    db.commit()
    delete_local_media_file(path)
    return gallery(db, kind, record)


def soft_delete_item(db: Session, kind: CatalogKind, *, record, actor_user_id: int | None):
    if record.deleted_at is None:
        before_state = _state(kind, record)
        record.deleted_at = utc_now()
        record.updated_by_user_id = actor_user_id
        db.add(record)
        db.flush()
        _log(db, kind, record, actor_user_id=actor_user_id, action="soft_delete", description=f"Deleted {kind.key} {record.name}",
             before_state=before_state)
        db.commit()
        db.refresh(record)
    return record


def restore_item(db: Session, kind: CatalogKind, *, record, actor_user_id: int | None):
    if record.deleted_at is not None:
        _ensure_slug_available(db, kind, tenant_id=record.tenant_id, slug=record.slug, record_id=record.id)
        record.deleted_at = None
        record.updated_by_user_id = actor_user_id
        db.add(record)
        db.flush()
        _log(db, kind, record, actor_user_id=actor_user_id, action="restore", description=f"Restored {kind.key} {record.name}")
        db.commit()
        db.refresh(record)
    return record
