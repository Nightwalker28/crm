from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import secrets

from fastapi.encoders import jsonable_encoder
from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.cache import cache_get_json, cache_set_json
from app.core.config import settings
from app.core.uploads import build_media_url
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.finance.services import pos_invoice_services
from app.modules.platform.services.activity_logs import log_activity
from app.modules.website_integrations.repositories import website_integration_repository
from app.modules.website_integrations.models import (
    WebsiteCatalogItem,
    WebsiteIntegrationApiKey,
    WebsiteIntegrationOrder,
    WebsiteIntegrationOrderLine,
)


INTEGRATION_KEY_PREFIX = "lynk_live_"
DEFAULT_CATALOG_READ_SCOPE = "catalog:read"
ORDER_WRITE_SCOPE = "orders:write"


@dataclass(frozen=True)
class PublicCatalogItem:
    id: int
    item_type: str
    slug: str | None
    sku: str | None
    name: str
    description: str | None
    currency: str
    public_unit_price: Decimal
    stock_status: str
    stock_quantity: Decimal | None
    media_url: str | None
    metadata_json: dict | None
    is_public: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime
    product: CatalogProduct | None = None
    service: CatalogService | None = None


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _hash_api_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _payload_for_hash(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _payload_for_hash(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_payload_for_hash(item) for item in value]
    return jsonable_encoder(value)


def _hash_payload(value: dict) -> str:
    encoded = _payload_for_hash(value)
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


def serialize_catalog_item(item: PublicCatalogItem | WebsiteCatalogItem, *, public: bool = False) -> dict:
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
        "pos_invoice_id": order.pos_invoice_id,
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
                "catalog_product_id": line.catalog_product_id,
                "catalog_service_id": line.catalog_service_id,
                "item_type": line.item_type,
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
    return website_integration_repository.list_api_keys(db, tenant_id=tenant_id)


def get_api_key_or_404(db: Session, *, tenant_id: int, key_id: int) -> WebsiteIntegrationApiKey:
    record = website_integration_repository.get_api_key(db, tenant_id=tenant_id, key_id=key_id)
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
    record = website_integration_repository.get_api_key_by_hash(db, key_hash=key_hash)
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


def _public_item_from_product(product: CatalogProduct) -> PublicCatalogItem:
    return PublicCatalogItem(
        id=product.id,
        item_type="product",
        slug=product.slug,
        sku=product.sku,
        name=product.name,
        description=product.description,
        currency=product.currency,
        public_unit_price=product.public_unit_price,
        stock_status=product.stock_status,
        stock_quantity=product.stock_quantity,
        media_url=build_media_url(product.media_path) if product.media_path else None,
        metadata_json=None,
        is_public=bool(product.is_public),
        is_active=bool(product.is_active),
        created_at=product.created_at,
        updated_at=product.updated_at,
        product=product,
    )


def _public_item_from_service(service: CatalogService) -> PublicCatalogItem:
    return PublicCatalogItem(
        id=service.id,
        item_type="service",
        slug=service.slug,
        sku=None,
        name=service.name,
        description=service.description,
        currency=service.currency,
        public_unit_price=service.public_unit_price,
        stock_status="untracked",
        stock_quantity=None,
        media_url=build_media_url(service.media_path) if service.media_path else None,
        metadata_json=None,
        is_public=bool(service.is_public),
        is_active=bool(service.is_active),
        created_at=service.created_at,
        updated_at=service.updated_at,
        service=service,
    )


def list_catalog_items(
    db: Session,
    *,
    tenant_id: int,
    include_private: bool = True,
    search: str | None = None,
    item_type: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list[PublicCatalogItem], int]:
    product_query, service_query = website_integration_repository.build_catalog_queries(
        db,
        tenant_id=tenant_id,
        include_private=include_private,
        search=search,
        item_type=item_type,
    )
    product_total = product_query.count()
    service_total = service_query.count()
    page_limit = (offset + limit) if limit is not None else None
    product_query = product_query.order_by(CatalogProduct.updated_at.desc(), CatalogProduct.id.desc())
    service_query = service_query.order_by(CatalogService.updated_at.desc(), CatalogService.id.desc())
    if page_limit is not None:
        product_query = product_query.limit(page_limit)
        service_query = service_query.limit(page_limit)
    products = [_public_item_from_product(product) for product in product_query.all()]
    services = [_public_item_from_service(service) for service in service_query.all()]
    items = sorted([*products, *services], key=lambda item: (item.updated_at, item.id), reverse=True)
    total = product_total + service_total
    if offset:
        items = items[offset:]
    if limit is not None:
        items = items[:limit]
    return items, total


def list_orders(db: Session, *, tenant_id: int, limit: int | None = None, offset: int = 0) -> tuple[list[WebsiteIntegrationOrder], int]:
    return website_integration_repository.list_orders(db, tenant_id=tenant_id, limit=limit, offset=offset)


def get_order_or_404(db: Session, *, tenant_id: int, order_id: int) -> WebsiteIntegrationOrder:
    order = website_integration_repository.get_order(db, tenant_id=tenant_id, order_id=order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Website order not found")
    return order


def create_pos_invoice_for_order(db: Session, *, current_user, order_id: int):
    order = get_order_or_404(db, tenant_id=current_user.tenant_id, order_id=order_id)
    if order.pos_invoice_id:
        invoice = pos_invoice_services.get_invoice_or_404(db, current_user, order.pos_invoice_id)
        return invoice, True
    payload = {
        "customer_name": order.customer_name or order.customer_email or f"Website order {order.external_reference}",
        "customer_email": order.customer_email,
        "customer_address": None,
        "status": "issued",
        "payment_status": "unpaid",
        "payment_method": order.source_platform,
        "template_id": "modern",
        "accent_color": "#14b8a6",
        "currency": order.currency,
        "discount_amount": 0,
        "tax_rate": 0,
        "amount_paid": 0,
        "payment_terms": "Generated from website order.",
        "notes": f"Source order: {order.external_reference}",
        "lines": [
            {
                "catalog_product_id": line.catalog_product_id,
                "catalog_service_id": line.catalog_service_id,
                "description": line.name,
                "quantity": line.quantity,
                "unit_price": line.unit_price_snapshot,
            }
            for line in order.line_items
        ],
    }
    invoice = pos_invoice_services.create_invoice(db, current_user, payload)
    order.pos_invoice_id = invoice.id
    db.add(order)
    db.commit()
    db.refresh(order)
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        module_key="website_integrations",
        entity_type="website_order",
        entity_id=order.id,
        action="website_order.convert_to_pos_invoice",
        description=f"Created POS invoice {invoice.invoice_number} from website order {order.external_reference}",
        after_state={"order_id": order.id, "pos_invoice_id": invoice.id, "invoice_number": invoice.invoice_number},
    )
    return invoice, False


def _existing_order_by_reference(db: Session, *, tenant_id: int, external_reference: str) -> WebsiteIntegrationOrder | None:
    return website_integration_repository.get_order_by_reference(db, tenant_id=tenant_id, external_reference=external_reference)


def _resolve_public_catalog_item_for_order(db: Session, *, tenant_id: int, line: dict) -> PublicCatalogItem:
    item_type = (line.get("item_type") or "").strip().lower() or None
    product_query = website_integration_repository.build_public_product_query(db, tenant_id=tenant_id, for_update=True)
    service_query = website_integration_repository.build_public_service_query(db, tenant_id=tenant_id)
    if line.get("catalog_product_id"):
        product = product_query.filter(CatalogProduct.id == line["catalog_product_id"]).with_for_update().first()
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog product not found for order line")
        item = _public_item_from_product(product)
    elif line.get("catalog_service_id"):
        service = service_query.filter(CatalogService.id == line["catalog_service_id"]).first()
        if not service:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog service not found for order line")
        item = _public_item_from_service(service)
    elif line.get("catalog_item_id") and item_type in {"product", "service"}:
        if item_type == "product":
            product = product_query.filter(CatalogProduct.id == line["catalog_item_id"]).with_for_update().first()
            if not product:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog product not found for order line")
            item = _public_item_from_product(product)
        else:
            service = service_query.filter(CatalogService.id == line["catalog_item_id"]).first()
            if not service:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog service not found for order line")
            item = _public_item_from_service(service)
    elif line.get("slug"):
        slug = str(line["slug"]).strip().lower()
        product = None
        service = None
        if item_type in {None, "product"}:
            product = product_query.filter(CatalogProduct.slug == slug).with_for_update().first()
        if item_type in {None, "service"}:
            service = service_query.filter(CatalogService.slug == slug).first()
        if product and service:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Order line slug matches multiple catalog item types")
        if product:
            item = _public_item_from_product(product)
        elif service:
            item = _public_item_from_service(service)
        else:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog item not found for order line")
    elif line.get("sku"):
        product = product_query.filter(CatalogProduct.sku == str(line["sku"]).strip()).with_for_update().first()
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog product not found for order line")
        item = _public_item_from_product(product)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Order line requires product, service, slug, or sku lookup")
    if item.stock_status == "out_of_stock":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{item.name} is out of stock")
    return item


def _apply_stock_decrement(db: Session, item: PublicCatalogItem, quantity: Decimal) -> tuple[Decimal | None, Decimal | None]:
    if item.product is None:
        return None, None
    product = website_integration_repository.get_public_product_for_stock_update(db, product=item.product)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog product not found for order line")
    if product.stock_status == "out_of_stock":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{item.name} is out of stock")
    before = Decimal(str(product.stock_quantity)) if product.stock_quantity is not None else None
    if before is None:
        return None, None
    if before < quantity:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Insufficient stock for {item.name}")
    after = before - quantity
    product.stock_quantity = after
    if after <= 0:
        product.stock_status = "out_of_stock"
    elif product.stock_status == "out_of_stock":
        product.stock_status = "in_stock"
    db.add(product)
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
        before, after = _apply_stock_decrement(db, item, quantity)
        unit_price = Decimal(str(item.public_unit_price))
        line_total = unit_price * quantity
        subtotal += line_total
        if item.product is not None:
            db.add(item.product)
        db.add(
            WebsiteIntegrationOrderLine(
                tenant_id=tenant_id,
                order_id=order.id,
                catalog_product_id=item.product.id if item.product else None,
                catalog_service_id=item.service.id if item.service else None,
                item_type=item.item_type,
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

def get_public_catalog_item_by_slug_or_404(db: Session, *, tenant_id: int, slug: str) -> PublicCatalogItem:
    normalized = slug.strip().lower()
    product = website_integration_repository.get_public_product_by_slug(db, tenant_id=tenant_id, slug=normalized)
    service = website_integration_repository.get_public_service_by_slug(db, tenant_id=tenant_id, slug=normalized)
    if product and service:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Catalog slug matches multiple item types")
    if product:
        return _public_item_from_product(product)
    if service:
        return _public_item_from_service(service)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Catalog item not found")
