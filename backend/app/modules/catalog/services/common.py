from __future__ import annotations

from datetime import datetime, timezone
import re

from fastapi import HTTPException, status

from app.core.uploads import build_media_url


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
