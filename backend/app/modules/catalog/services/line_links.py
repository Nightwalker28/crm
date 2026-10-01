"""The catalog link on a transaction line: quote items, order items and invoice lines.

A line may point at one product or one service, or at neither (a free-text line, HubSpot's
custom line item). The line keeps its own name and price either way, so a catalog change never
rewrites a document that was already sent.

Two separate checks, kept apart on purpose:

- `normalize_catalog_line_links` is tenant integrity. Every write path runs it, including
  quote-to-order conversion and tests that call services directly. A linked id must belong to
  the document's tenant. A deactivated or binned item still qualifies, so re-saving an old
  quote whose product has since been retired does not fail.
- `require_catalog_line_link_access` is authorization, run by routes. Linking exposes the
  item, so a *new* link needs `view` on its catalog module (`require_linked_record_access`).
  A link the document already carries is not re-authorized: a user without catalog access can
  still edit a quote someone else built from the catalog.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.permissions import require_linked_record_access
from app.modules.catalog.models import CatalogProduct, CatalogService

PRODUCT_LINK_FIELD = "catalog_product_id"
SERVICE_LINK_FIELD = "catalog_service_id"
CATALOG_LINK_MODULES = {PRODUCT_LINK_FIELD: "catalog_products", SERVICE_LINK_FIELD: "catalog_services"}

CatalogLink = tuple[str, int]


def _coerce_link_id(value: Any, *, line_number: int) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Line {line_number}: invalid catalog item")
    try:
        link_id = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Line {line_number}: invalid catalog item") from exc
    if link_id <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Line {line_number}: invalid catalog item")
    return link_id


def _line_value(line: Any, field: str) -> Any:
    return line.get(field) if isinstance(line, dict) else getattr(line, field, None)


def catalog_links_of(lines: Iterable[Any] | None) -> set[CatalogLink]:
    """The links a set of lines carries, from payload dicts or persisted rows."""

    links: set[CatalogLink] = set()
    for line in lines or []:
        for field in CATALOG_LINK_MODULES:
            value = _line_value(line, field)
            if value is not None and value != "":
                try:
                    links.add((field, int(value)))
                except (TypeError, ValueError):
                    continue
    return links


def normalize_catalog_line_links(db: Session, *, tenant_id: int, lines: list[dict] | None) -> list[dict[str, int | None]]:
    """Validate each line's catalog link inside `tenant_id` and return them, in line order.

    Raises 400 naming the line when a line carries both links, or an id that is not in the
    tenant. One query per kind, however many lines there are.
    """

    normalized: list[dict[str, int | None]] = []
    for index, line in enumerate(lines or [], start=1):
        product_id = _coerce_link_id(_line_value(line, PRODUCT_LINK_FIELD), line_number=index)
        service_id = _coerce_link_id(_line_value(line, SERVICE_LINK_FIELD), line_number=index)
        if product_id is not None and service_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Line {index}: a line links to a product or a service, not both",
            )
        normalized.append({PRODUCT_LINK_FIELD: product_id, SERVICE_LINK_FIELD: service_id})

    product_ids = {link[PRODUCT_LINK_FIELD] for link in normalized if link[PRODUCT_LINK_FIELD] is not None}
    service_ids = {link[SERVICE_LINK_FIELD] for link in normalized if link[SERVICE_LINK_FIELD] is not None}
    found_products = (
        {row.id for row in db.query(CatalogProduct.id).filter(CatalogProduct.tenant_id == tenant_id, CatalogProduct.id.in_(product_ids))}
        if product_ids
        else set()
    )
    found_services = (
        {row.id for row in db.query(CatalogService.id).filter(CatalogService.tenant_id == tenant_id, CatalogService.id.in_(service_ids))}
        if service_ids
        else set()
    )
    for index, link in enumerate(normalized, start=1):
        if link[PRODUCT_LINK_FIELD] is not None and link[PRODUCT_LINK_FIELD] not in found_products:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Line {index}: product not found")
        if link[SERVICE_LINK_FIELD] is not None and link[SERVICE_LINK_FIELD] not in found_services:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Line {index}: service not found")
    return normalized


def require_catalog_line_link_access(
    db: Session,
    *,
    user,
    lines: list[dict] | None,
    existing_links: set[CatalogLink] | None = None,
) -> None:
    """Require catalog `view` for every link the write adds that the document did not have."""

    added = catalog_links_of(lines) - (existing_links or set())
    for module_key in sorted({CATALOG_LINK_MODULES[field] for field, _ in added}):
        require_linked_record_access(db, user=user, module_key=module_key)
