from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import re

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.uploads import build_media_url
from app.modules.catalog.models import CatalogCategory


def normalize_catalog_slug(value: str | None, *, fallback: str) -> str | None:
    source = (value or fallback or "").strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", source).strip("-")
    return normalized[:160] or None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_catalog_currency(value) -> str:
    normalized = str(value or "USD").strip().upper()
    if len(normalized) != 3 or not normalized.isalpha():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="currency must be a 3-letter code")
    return normalized


def coerce_catalog_bool(value, *, field_name: str) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int) and value in {0, 1}:
        return int(value)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} must be a boolean")


def catalog_media_payload(record) -> dict:
    media_path = record.media_path
    return {
        "media_url": build_media_url(media_path) if media_path else None,
        "media_content_type": record.media_content_type if media_path else None,
        "media_original_filename": record.media_original_filename if media_path else None,
    }


CATALOG_DETAIL_FIELDS = ("category_id", "cost_price", "unit")


def normalize_catalog_unit(value) -> str:
    normalized = " ".join(str(value or "").split())
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unit cannot be blank")
    if len(normalized) > 40:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unit must be 40 characters or fewer")
    return normalized


def normalize_catalog_cost(value) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        cost = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid cost_price") from exc
    if not cost.is_finite() or cost < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cost_price must be non-negative")
    return cost


def normalize_catalog_category_id(db: Session, *, tenant_id: int, value) -> int | None:
    """A category the record may point at: one in its own tenant."""

    if value is None or value == "":
        return None
    try:
        category_id = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category") from exc
    exists = (
        db.query(CatalogCategory.id)
        .filter(CatalogCategory.tenant_id == tenant_id, CatalogCategory.id == category_id)
        .first()
    )
    if not exists:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Category not found")
    return category_id


def normalize_catalog_detail_fields(db: Session, *, tenant_id: int, payload: dict, partial: bool) -> dict:
    """Category, cost and unit, shared by products and services.

    On a partial update only the keys the caller sent are returned, so an omitted field stays
    as it is. `unit` cannot be cleared; `category_id` and `cost_price` can.
    """

    values: dict = {}
    if not partial or "category_id" in payload:
        values["category_id"] = normalize_catalog_category_id(db, tenant_id=tenant_id, value=payload.get("category_id"))
    if not partial or "cost_price" in payload:
        values["cost_price"] = normalize_catalog_cost(payload.get("cost_price"))
    if not partial or "unit" in payload:
        if partial and payload.get("unit") is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="unit cannot be null")
        values["unit"] = normalize_catalog_unit(payload.get("unit") or "unit")
    return values


def normalize_catalog_code(value) -> str | None:
    """SKU and barcode: trimmed, blank means none."""

    normalized = (str(value) if value is not None else "").strip()
    return normalized or None


def catalog_detail_payload(record) -> dict:
    category = getattr(record, "category", None)
    return {
        "category_id": record.category_id,
        "category_name": category.full_name if category is not None else None,
        "cost_price": record.cost_price,
        "unit": record.unit or "unit",
    }
