from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import secrets

from fastapi.encoders import jsonable_encoder
from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.cache import cache_get_json, cache_set_json
from app.core.config import settings
from app.modules.platform.services.activity_logs import log_activity
from app.modules.website_integrations.models import (
    WebsiteCatalogItem,
    WebsiteIntegrationApiKey,
    WebsiteIntegrationOrder,
    WebsiteIntegrationOrderLine,
)


INTEGRATION_KEY_PREFIX = "lynk_live_"
DEFAULT_CATALOG_READ_SCOPE = "catalog:read"
ORDER_WRITE_SCOPE = "orders:write"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_api_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _hash_payload(value: dict) -> str:
    encoded = jsonable_encoder(value)
    return hashlib.sha256(json.dumps(encoded, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _new_api_key() -> str:
    return f"{INTEGRATION_KEY_PREFIX}{secrets.token_urlsafe(32)}"


def _key_prefix(value: str) -> str:
    return value[:20]


def _normalize_scopes(value: list[str] | None) -> list[str]:
    scopes = sorted({str(item).strip().lower() for item in value or [] if str(item).strip()})
    return scopes or [DEFAULT_CATALOG_READ_SCOPE]


def _normalize_origins(value: list[str] | None) -> list[str]:
    return sorted({str(item).strip().rstrip("/") for item in value or [] if str(item).strip()})


def _bool(value) -> bool:
    return bool(value)


def _item_state(item: WebsiteCatalogItem) -> dict:
    return {
        "id": item.id,
        "slug": item.slug,
        "sku": item.sku,
        "name": item.name,
        "item_type": item.item_type,
        "currency": item.currency,
        "public_unit_price": item.public_unit_price,
        "stock_status": item.stock_status,
        "stock_quantity": item.stock_quantity,
        "is_public": bool(item.is_public),
        "is_active": bool(item.is_active),
    }


def _order_state(order: WebsiteIntegrationOrder) -> dict:
    return {
        "id": order.id,
        "external_reference": order.external_reference,
        "source_platform": order.source_platform,
        "status": order.status,
        "customer_email": order.customer_email,
        "currency": order.currency,
        "subtotal_amount": order.subtotal_amount,
        "line_count": len(getattr(order, "line_items", []) or []),
    }


def serialize_api_key(key: WebsiteIntegrationApiKey, *, api_key: str | None = None) -> dict:
    return {
        "id": key.id,
        "name": key.name,
        "key_prefix": key.key_prefix,
        "scopes": _normalize_scopes(key.scopes),
        "allowed_origins": _normalize_origins(key.allowed_origins),
        "status": key.status,
        "last_used_at": key.last_used_at,
        "created_at": key.created_at,
        "updated_at": key.updated_at,
        "api_key": api_key,
    }


def serialize_catalog_item(item: WebsiteCatalogItem, *, public: bool = False) -> dict:
    payload = {
        "id": item.id,
        "item_type": item.item_type,
        "slug": item.slug,
        "sku": item.sku,
        "name": item.name,
        "description": item.description,
        "currency": item.currency,
        "public_unit_price": item.public_unit_price,
        "stock_status": item.stock_status,
        "stock_quantity": item.stock_quantity,
        "media_url": item.media_url,
        "metadata": item.metadata_json,
        "updated_at": item.updated_at,
    }
    if not public:
        payload.update(
            {
                "is_public": bool(item.is_public),
                "is_active": bool(item.is_active),
                "created_at": item.created_at,
            }
        )
    return payload


def serialize_order(order: WebsiteIntegrationOrder, *, idempotent_replayed: bool = False) -> dict:
    return {
        "id": order.id,
        "external_reference": order.external_reference,
        "source_platform": order.source_platform,
        "status": order.status,
        "customer_name": order.customer_name,
        "customer_email": order.customer_email,
        "customer_phone": order.customer_phone,
        "currency": order.currency,
        "subtotal_amount": order.subtotal_amount,
        "metadata": order.metadata_json,
        "created_at": order.created_at,
        "idempotent_replayed": idempotent_replayed,
        "line_items": [
            {
                "id": line.id,
                "catalog_item_id": line.catalog_item_id,
                "slug": line.slug,
                "sku": line.sku,
                "name": line.name,
                "quantity": line.quantity,
                "currency": line.currency,
                "unit_price_snapshot": line.unit_price_snapshot,
                "line_total": line.line_total,
                "stock_quantity_before": line.stock_quantity_before,
                "stock_quantity_after": line.stock_quantity_after,
            }
            for line in getattr(order, "line_items", []) or []
        ],
    }


def create_api_key(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> tuple[WebsiteIntegrationApiKey, str]:
    raw_key = _new_api_key()
    record = WebsiteIntegrationApiKey(
        tenant_id=tenant_id,
        name=str(payload["name"]).strip(),
        key_prefix=_key_prefix(raw_key),
        key_hash=_hash_api_key(raw_key),
        scopes=_normalize_scopes(payload.get("scopes")),
        allowed_origins=_normalize_origins(payload.get("allowed_origins")),
        created_by_user_id=actor_user_id,
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Integration API key name already exists") from exc
    db.refresh(record)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="website_integrations",
        entity_type="integration_api_key",
        entity_id=record.id,
        action="integration_api_key.create",
        description=f"Created website integration API key {record.name}",
        after_state=serialize_api_key(record, api_key=None),
    )
    return record, raw_key


def list_api_keys(db: Session, *, tenant_id: int) -> list[WebsiteIntegrationApiKey]:
    return (
        db.query(WebsiteIntegrationApiKey)
        .filter(WebsiteIntegrationApiKey.tenant_id == tenant_id)
        .order_by(WebsiteIntegrationApiKey.created_at.desc(), WebsiteIntegrationApiKey.id.desc())
        .all()
    )


def get_api_key_or_404(db: Session, *, tenant_id: int, key_id: int) -> WebsiteIntegrationApiKey:
    record = (
        db.query(WebsiteIntegrationApiKey)
        .filter(WebsiteIntegrationApiKey.tenant_id == tenant_id, WebsiteIntegrationApiKey.id == key_id)
        .first()
    )
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration API key not found")
    return record


def revoke_api_key(db: Session, *, key: WebsiteIntegrationApiKey, actor_user_id: int | None) -> WebsiteIntegrationApiKey:
    before_state = serialize_api_key(key)
    key.status = "revoked"
    key.revoked_by_user_id = actor_user_id
    key.revoked_at = _utcnow()
    db.add(key)
    db.commit()
    db.refresh(key)
    log_activity(
        db,
        tenant_id=key.tenant_id,
        actor_user_id=actor_user_id,
        module_key="website_integrations",
        entity_type="integration_api_key",
        entity_id=key.id,
        action="integration_api_key.revoke",
        description=f"Revoked website integration API key {key.name}",
        before_state=before_state,
        after_state=serialize_api_key(key),
    )
    return key


def resolve_public_api_key(db: Session, *, api_key: str | None, required_scope: str = DEFAULT_CATALOG_READ_SCOPE) -> WebsiteIntegrationApiKey:
    if not api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing integration API key")
    key_hash = _hash_api_key(api_key.strip())
    record = db.query(WebsiteIntegrationApiKey).filter(WebsiteIntegrationApiKey.key_hash == key_hash).first()
    if not record or record.status != "active":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid integration API key")
    if required_scope not in _normalize_scopes(record.scopes):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Integration API key scope is not allowed")
    record.last_used_at = _utcnow()
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def check_integration_rate_limit(key: WebsiteIntegrationApiKey, *, operation: str) -> None:
    limit = max(int(settings.WEBSITE_INTEGRATION_RATE_LIMIT_COUNT), 1)
    window_seconds = max(int(settings.WEBSITE_INTEGRATION_RATE_LIMIT_WINDOW_SECONDS), 1)
    cache_key = f"website_integrations:rate:{key.id}:{operation}"
    payload = cache_get_json(cache_key) or {"count": 0}
    count = int(payload.get("count") or 0)
    if count >= limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Integration API rate limit exceeded",
        )
    cache_set_json(cache_key, {"count": count + 1}, ttl_seconds=window_seconds)


def list_catalog_items(
    db: Session,
    *,
    tenant_id: int,
    include_private: bool = True,
    search: str | None = None,
    item_type: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[WebsiteCatalogItem], int]:
    query = db.query(WebsiteCatalogItem).filter(WebsiteCatalogItem.tenant_id == tenant_id)
    if not include_private:
        query = query.filter(WebsiteCatalogItem.is_public == 1, WebsiteCatalogItem.is_active == 1)
    if item_type:
        query = query.filter(WebsiteCatalogItem.item_type == item_type)
    if search:
        value = f"%{search.strip()}%"
        query = query.filter(
            or_(
                WebsiteCatalogItem.name.ilike(value),
                WebsiteCatalogItem.slug.ilike(value),
                WebsiteCatalogItem.sku.ilike(value),
            )
        )
    total = query.count()
    query = query.order_by(WebsiteCatalogItem.updated_at.desc(), WebsiteCatalogItem.id.desc())
    if offset:
        query = query.offset(offset)
    if limit is not None:
        query = query.limit(limit)
    return query.all(), total


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


def _existing_order_by_reference(db: Session, *, tenant_id: int, external_reference: str) -> WebsiteIntegrationOrder | None:
    return (
        db.query(WebsiteIntegrationOrder)
        .options(selectinload(WebsiteIntegrationOrder.line_items))
        .filter(
            WebsiteIntegrationOrder.tenant_id == tenant_id,
            WebsiteIntegrationOrder.external_reference == external_reference,
        )
        .first()
    )


def _resolve_public_catalog_item_for_order(db: Session, *, tenant_id: int, line: dict) -> WebsiteCatalogItem:
    query = db.query(WebsiteCatalogItem).filter(
        WebsiteCatalogItem.tenant_id == tenant_id,
        WebsiteCatalogItem.is_public == 1,
        WebsiteCatalogItem.is_active == 1,
    )
    if line.get("catalog_item_id"):
        query = query.filter(WebsiteCatalogItem.id == line["catalog_item_id"])
    elif line.get("slug"):
        query = query.filter(WebsiteCatalogItem.slug == str(line["slug"]).strip().lower())
    elif line.get("sku"):
        query = query.filter(WebsiteCatalogItem.sku == str(line["sku"]).strip())
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order line requires catalog_item_id, slug, or sku")
    item = query.with_for_update().first()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog item not found for order line")
    if item.stock_status == "out_of_stock":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{item.name} is out of stock")
    return item


def _apply_stock_decrement(item: WebsiteCatalogItem, quantity: Decimal) -> tuple[Decimal | None, Decimal | None]:
    before = Decimal(str(item.stock_quantity)) if item.stock_quantity is not None else None
    if before is None:
        return None, None
    if before < quantity:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Insufficient stock for {item.name}")
    after = before - quantity
    item.stock_quantity = after
    if after <= 0:
        item.stock_status = "out_of_stock"
    elif item.stock_status == "out_of_stock":
        item.stock_status = "in_stock"
    return before, after


def create_public_order(
    db: Session,
    *,
    tenant_id: int,
    api_key_id: int | None,
    payload: dict,
) -> tuple[WebsiteIntegrationOrder, bool]:
    external_reference = str(payload["external_reference"]).strip()
    request_hash = _hash_payload(payload)
    existing = _existing_order_by_reference(db, tenant_id=tenant_id, external_reference=external_reference)
    if existing:
        if existing.request_hash != request_hash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Order external_reference already exists with different payload",
            )
        return existing, True

    subtotal = Decimal("0")
    currency = (payload.get("currency") or "").strip().upper() if payload.get("currency") else None
    order = WebsiteIntegrationOrder(
        tenant_id=tenant_id,
        api_key_id=api_key_id,
        external_reference=external_reference,
        source_platform=(payload.get("source_platform") or "").strip() or None,
        status="confirmed",
        request_hash=request_hash,
        customer_name=(payload.get("customer_name") or "").strip() or None,
        customer_email=(payload.get("customer_email") or "").strip().lower() or None,
        customer_phone=(payload.get("customer_phone") or "").strip() or None,
        currency=currency or "USD",
        subtotal_amount=Decimal("0"),
        metadata_json=payload.get("metadata"),
        raw_payload=jsonable_encoder(payload),
    )
    db.add(order)
    db.flush()

    for raw_line in payload.get("line_items") or []:
        quantity = Decimal(str(raw_line["quantity"]))
        item = _resolve_public_catalog_item_for_order(db, tenant_id=tenant_id, line=raw_line)
        line_currency = item.currency
        if currency is None:
            currency = line_currency
            order.currency = line_currency
        if line_currency != order.currency:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order lines must use one currency")
        before, after = _apply_stock_decrement(item, quantity)
        unit_price = Decimal(str(item.public_unit_price))
        line_total = unit_price * quantity
        subtotal += line_total
        db.add(item)
        db.add(
            WebsiteIntegrationOrderLine(
                tenant_id=tenant_id,
                order_id=order.id,
                catalog_item_id=item.id,
                slug=item.slug,
                sku=item.sku,
                name=item.name,
                quantity=quantity,
                currency=line_currency,
                unit_price_snapshot=unit_price,
                line_total=line_total,
                stock_quantity_before=before,
                stock_quantity_after=after,
            )
        )

    order.subtotal_amount = subtotal
    db.add(order)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing = _existing_order_by_reference(db, tenant_id=tenant_id, external_reference=external_reference)
        if existing and existing.request_hash == request_hash:
            return existing, True
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order external_reference already exists") from exc
    db.refresh(order)
    order = _existing_order_by_reference(db, tenant_id=tenant_id, external_reference=external_reference) or order
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=None,
        module_key="website_integrations",
        entity_type="website_order",
        entity_id=order.id,
        action="website_order.confirmed",
        description=f"Website order confirmed from {order.source_platform or 'external site'}",
        after_state=_order_state(order),
    )
    return order, False


def get_catalog_item_or_404(db: Session, *, tenant_id: int, item_id: int) -> WebsiteCatalogItem:
    item = (
        db.query(WebsiteCatalogItem)
        .filter(WebsiteCatalogItem.tenant_id == tenant_id, WebsiteCatalogItem.id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog item not found")
    return item


def get_public_catalog_item_by_slug_or_404(db: Session, *, tenant_id: int, slug: str) -> WebsiteCatalogItem:
    item = (
        db.query(WebsiteCatalogItem)
        .filter(
            WebsiteCatalogItem.tenant_id == tenant_id,
            WebsiteCatalogItem.slug == slug.strip().lower(),
            WebsiteCatalogItem.is_public == 1,
            WebsiteCatalogItem.is_active == 1,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog item not found")
    return item


def create_catalog_item(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> WebsiteCatalogItem:
    item = WebsiteCatalogItem(
        tenant_id=tenant_id,
        item_type=payload.get("item_type") or "product",
        slug=str(payload["slug"]).strip().lower(),
        sku=(payload.get("sku") or "").strip() or None,
        name=str(payload["name"]).strip(),
        description=(payload.get("description") or "").strip() or None,
        currency=str(payload.get("currency") or "USD").strip().upper(),
        public_unit_price=Decimal(str(payload["public_unit_price"])),
        stock_status=payload.get("stock_status") or "untracked",
        stock_quantity=Decimal(str(payload["stock_quantity"])) if payload.get("stock_quantity") is not None else None,
        media_url=(payload.get("media_url") or "").strip() or None,
        metadata_json=payload.get("metadata"),
        is_public=1 if _bool(payload.get("is_public")) else 0,
        is_active=1 if payload.get("is_active", True) else 0,
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Catalog item slug or SKU already exists") from exc
    db.refresh(item)
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="website_integrations",
        entity_type="website_catalog_item",
        entity_id=item.id,
        action="website_catalog_item.create",
        description=f"Created website catalog item {item.name}",
        after_state=_item_state(item),
    )
    return item


def update_catalog_item(db: Session, *, item: WebsiteCatalogItem, actor_user_id: int | None, payload: dict) -> WebsiteCatalogItem:
    before_state = _item_state(item)
    required_fields = {"item_type", "slug", "name", "currency", "public_unit_price", "stock_status"}
    for field in [
        "item_type",
        "slug",
        "sku",
        "name",
        "description",
        "currency",
        "public_unit_price",
        "stock_status",
        "stock_quantity",
        "media_url",
        "is_public",
        "is_active",
    ]:
        if field not in payload:
            continue
        value = payload[field]
        if value is None and field in required_fields:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field} cannot be null")
        if field == "slug" and value is not None:
            value = str(value).strip().lower()
        elif field in {"sku", "description", "media_url"}:
            value = (value or "").strip() or None
        elif field == "name" and value is not None:
            value = str(value).strip()
        elif field == "currency" and value is not None:
            value = str(value).strip().upper()
        elif field == "public_unit_price" and value is not None:
            value = Decimal(str(value))
        elif field == "stock_quantity" and value is not None:
            value = Decimal(str(value))
        elif field in {"is_public", "is_active"} and value is not None:
            value = 1 if value else 0
        setattr(item, field, value)
    if "metadata" in payload:
        item.metadata_json = payload.get("metadata")
    item.updated_by_user_id = actor_user_id
    db.add(item)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Catalog item slug or SKU already exists") from exc
    db.refresh(item)
    log_activity(
        db,
        tenant_id=item.tenant_id,
        actor_user_id=actor_user_id,
        module_key="website_integrations",
        entity_type="website_catalog_item",
        entity_id=item.id,
        action="website_catalog_item.update",
        description=f"Updated website catalog item {item.name}",
        before_state=before_state,
        after_state=_item_state(item),
    )
    return item
