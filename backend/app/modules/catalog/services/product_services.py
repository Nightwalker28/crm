from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import re

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.uploads import build_media_url, delete_local_media_file, persist_media_file, read_image_upload
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.catalog.repositories import product_repository
from app.modules.catalog.schema import CatalogProductResponse
from app.modules.platform.services.activity_logs import log_activity

CATALOG_PRODUCTS_MODULE = "catalog_products"
PRODUCT_STOCK_STATUSES = {"untracked", "in_stock", "out_of_stock", "preorder"}


def _normalize_slug(value: str | None, *, fallback: str) -> str | None:
    source = (value or fallback or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", source).strip("-")
    return normalized[:160] or None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_currency(value) -> str:
    normalized = str(value or "USD").strip().upper()
    if len(normalized) != 3 or not normalized.isalpha():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="currency must be a 3-letter code")
    return normalized


def _coerce_nonnegative_decimal(value, *, field_name: str, required: bool = True) -> Decimal | None:
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


def _coerce_bool(value, *, field_name: str) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int) and value in {0, 1}:
        return int(value)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} must be a boolean")


def _normalize_stock_status(value) -> str:
    normalized = str(value or "untracked").strip().lower()
    if normalized not in PRODUCT_STOCK_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stock status")
    return normalized


def _ensure_slug_available(
    db: Session,
    *,
    tenant_id: int,
    slug: str | None,
    product_id: int | None = None,
) -> None:
    if not slug:
        return
    if product_repository.slug_exists(db, tenant_id=tenant_id, slug=slug, product_id=product_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Catalog slug already exists.")


def _product_state(product: CatalogProduct) -> dict:
    return CatalogProductResponse.model_validate(serialize_product(product)).model_dump(mode="json")


def serialize_product(product: CatalogProduct) -> dict:
    return {
        "id": product.id,
        "name": product.name,
        "slug": product.slug,
        "description": product.description,
        "sku": product.sku,
        "currency": product.currency,
        "public_unit_price": product.public_unit_price,
        "stock_status": product.stock_status,
        "stock_quantity": product.stock_quantity,
        "is_public": bool(product.is_public),
        "is_active": bool(product.is_active),
        "media_url": build_media_url(product.media_path) if product.media_path else None,
        "media_content_type": product.media_content_type,
        "media_original_filename": product.media_original_filename,
        "created_at": product.created_at,
        "updated_at": product.updated_at,
    }


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
    return product_repository.list_products(
        db,
        tenant_id=tenant_id,
        search=search,
        include_inactive=include_inactive,
        offset=offset,
        limit=limit,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )


def list_products_cursor(
    db: Session,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    limit: int = 50,
    cursor: int | None = None,
) -> list[CatalogProduct]:
    return product_repository.list_products_cursor(
        db,
        tenant_id=tenant_id,
        search=search,
        include_inactive=include_inactive,
        limit=limit,
        cursor=cursor,
    )


def list_deleted_products(
    db: Session,
    *,
    tenant_id: int,
    offset: int = 0,
    limit: int = 50,
) -> tuple[list[CatalogProduct], int]:
    return product_repository.list_deleted_products(db, tenant_id=tenant_id, offset=offset, limit=limit)


def get_product_or_404(
    db: Session,
    *,
    tenant_id: int,
    product_id: int,
    include_deleted: bool = False,
) -> CatalogProduct:
    product = product_repository.get_product(
        db,
        tenant_id=tenant_id,
        product_id=product_id,
        include_deleted=include_deleted,
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found.")
    return product


def create_product(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> CatalogProduct:
    slug = _normalize_slug(payload.get("slug"), fallback=payload["name"])
    _ensure_slug_available(db, tenant_id=tenant_id, slug=slug)
    product = CatalogProduct(
        tenant_id=tenant_id,
        name=str(payload["name"]).strip(),
        slug=slug,
        description=(payload.get("description") or "").strip() or None,
        sku=(payload.get("sku") or "").strip() or None,
        currency=_normalize_currency(payload.get("currency")),
        public_unit_price=_coerce_nonnegative_decimal(payload.get("public_unit_price", 0), field_name="public_unit_price"),
        stock_status=_normalize_stock_status(payload.get("stock_status")),
        stock_quantity=_coerce_nonnegative_decimal(payload.get("stock_quantity"), field_name="stock_quantity", required=False),
        is_public=_coerce_bool(payload.get("is_public", False), field_name="is_public"),
        is_active=_coerce_bool(payload.get("is_active", True), field_name="is_active"),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(product)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Product slug or SKU already exists.") from exc
    db.refresh(product)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=CATALOG_PRODUCTS_MODULE,
        entity_type="catalog_product",
        entity_id=product.id,
        action="create",
        description=f"Created product {product.name}",
        after_state=_product_state(product),
    )
    return product


def update_product(
    db: Session,
    *,
    product: CatalogProduct,
    actor_user_id: int | None,
    payload: dict,
) -> CatalogProduct:
    before_state = _product_state(product)
    required_fields = {"name", "currency", "public_unit_price", "stock_status"}
    for field in [
        "name",
        "slug",
        "description",
        "sku",
        "currency",
        "public_unit_price",
        "stock_status",
        "stock_quantity",
        "is_public",
        "is_active",
    ]:
        if field not in payload:
            continue
        value = payload[field]
        if value is None and field in required_fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} cannot be null")
        if field == "slug":
            value = _normalize_slug(value, fallback=product.name)
            _ensure_slug_available(db, tenant_id=product.tenant_id, slug=value, product_id=product.id)
        elif field in {"description", "sku"}:
            value = (value or "").strip() or None
        elif field == "name" and value is not None:
            value = str(value).strip()
        elif field == "currency" and value is not None:
            value = _normalize_currency(value)
        elif field in {"public_unit_price", "stock_quantity"} and value is not None:
            value = _coerce_nonnegative_decimal(value, field_name=field, required=field in required_fields)
        elif field == "stock_status" and value is not None:
            value = _normalize_stock_status(value)
        elif field in {"is_public", "is_active"} and value is not None:
            value = _coerce_bool(value, field_name=field)
        setattr(product, field, value)
    product.updated_by_user_id = actor_user_id
    db.add(product)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Product slug or SKU already exists.") from exc
    db.refresh(product)
    log_activity(
        db,
        tenant_id=product.tenant_id,
        actor_user_id=actor_user_id,
        module_key=CATALOG_PRODUCTS_MODULE,
        entity_type="catalog_product",
        entity_id=product.id,
        action="update",
        description=f"Updated product {product.name}",
        before_state=before_state,
        after_state=_product_state(product),
    )
    return product


async def upload_product_media(
    db: Session,
    *,
    product: CatalogProduct,
    actor_user_id: int | None,
    file: UploadFile,
) -> CatalogProduct:
    before_state = _product_state(product)
    content, extension = await read_image_upload(file)
    previous_media_path = product.media_path
    new_media_path = persist_media_file(
        category="catalog-products",
        owner_key=f"tenant-{product.tenant_id}/product-{product.id}",
        extension=extension,
        content=content,
    )
    product.media_path = new_media_path
    product.media_content_type = file.content_type
    product.media_original_filename = (file.filename or "product-image")[:255]
    product.updated_by_user_id = actor_user_id
    db.add(product)
    try:
        db.commit()
    except Exception:
        db.rollback()
        delete_local_media_file(new_media_path)
        raise
    db.refresh(product)
    delete_local_media_file(previous_media_path)
    log_activity(
        db,
        tenant_id=product.tenant_id,
        actor_user_id=actor_user_id,
        module_key=CATALOG_PRODUCTS_MODULE,
        entity_type="catalog_product",
        entity_id=product.id,
        action="media.update",
        description=f"Updated product media for {product.name}",
        before_state=before_state,
        after_state=_product_state(product),
    )
    return product


def soft_delete_product(
    db: Session,
    *,
    product: CatalogProduct,
    actor_user_id: int | None,
) -> CatalogProduct:
    if product.deleted_at is None:
        before_state = _product_state(product)
        product.deleted_at = _utcnow()
        product.updated_by_user_id = actor_user_id
        db.add(product)
        db.commit()
        db.refresh(product)
        log_activity(
            db,
            tenant_id=product.tenant_id,
            actor_user_id=actor_user_id,
            module_key=CATALOG_PRODUCTS_MODULE,
            entity_type="catalog_product",
            entity_id=product.id,
            action="soft_delete",
            description=f"Deleted product {product.name}",
            before_state=before_state,
            after_state=_product_state(product),
        )
    return product


def restore_product(
    db: Session,
    *,
    product: CatalogProduct,
    actor_user_id: int | None,
) -> CatalogProduct:
    if product.deleted_at is not None:
        _ensure_slug_available(db, tenant_id=product.tenant_id, slug=product.slug, product_id=product.id)
        product.deleted_at = None
        product.updated_by_user_id = actor_user_id
        db.add(product)
        db.commit()
        db.refresh(product)
        log_activity(
            db,
            tenant_id=product.tenant_id,
            actor_user_id=actor_user_id,
            module_key=CATALOG_PRODUCTS_MODULE,
            entity_type="catalog_product",
            entity_id=product.id,
            action="restore",
            description=f"Restored product {product.name}",
            after_state=_product_state(product),
        )
    return product
