"""List queries for catalog items, products and services alike (13a E2).

Products and services were two copies of the same repository. They differ only in their model
and in the columns a product has and a service does not (stock, barcode), so one set of
functions takes a `CatalogItemQuerySpec` naming those.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.module_filters import apply_filter_conditions
from app.modules.catalog.models import CatalogCategory, CatalogProduct, CatalogService


@dataclass(frozen=True)
class CatalogItemQuerySpec:
    model: Any
    #: Searched with the name, SKU and description.
    extra_search_columns: tuple[str, ...] = ()
    #: Sortable and filterable beyond the shared columns: `{key: (column, filter type)}`.
    extra_fields: dict[str, tuple[str, str]] = field(default_factory=dict)


PRODUCT_QUERY = CatalogItemQuerySpec(
    model=CatalogProduct,
    extra_search_columns=("barcode",),
    extra_fields={
        "stock_status": ("stock_status", "text"),
        "stock_quantity": ("stock_quantity", "number"),
        "barcode": ("barcode", "text"),
    },
)
SERVICE_QUERY = CatalogItemQuerySpec(model=CatalogService)


def _category_name(model):
    # The category's own name, for filtering and sorting a list without a join.
    return select(CatalogCategory.name).where(CatalogCategory.id == model.category_id).correlate(model).scalar_subquery()


def _fields(spec: CatalogItemQuerySpec) -> dict[str, tuple[Any, str]]:
    model = spec.model
    fields: dict[str, tuple[Any, str]] = {
        "name": (model.name, "text"),
        "slug": (model.slug, "text"),
        "sku": (model.sku, "text"),
        "currency": (model.currency, "text"),
        "public_unit_price": (model.public_unit_price, "number"),
        "category_name": (_category_name(model), "text"),
        "cost_price": (model.cost_price, "number"),
        "unit": (model.unit, "text"),
        "is_public": (model.is_public, "boolean"),
        "is_active": (model.is_active, "boolean"),
        "created_at": (model.created_at, "date"),
        "updated_at": (model.updated_at, "date"),
    }
    for key, (column, kind) in spec.extra_fields.items():
        fields[key] = (getattr(model, column), kind)
    return fields


def sort_fields(spec: CatalogItemQuerySpec) -> dict[str, Any]:
    return {key: column for key, (column, _kind) in _fields(spec).items()}


def apply_sort(spec: CatalogItemQuerySpec, query, sort_by: str | None = None, sort_direction: str | None = None):
    model = spec.model
    column = sort_fields(spec).get((sort_by or "").strip())
    if column is None:
        return query.order_by(model.updated_at.desc(), model.id.desc())
    direction = (sort_direction or "asc").lower()
    primary = column.desc() if direction == "desc" else column.asc()
    secondary = model.id.desc() if direction == "desc" else model.id.asc()
    return query.order_by(primary, secondary)


def slug_exists(db: Session, *, tenant_id: int, slug: str, model, record_id: int | None = None) -> bool:
    """A slug is unique across products and services together: the public catalog shares it."""
    for candidate in (CatalogProduct, CatalogService):
        query = db.query(candidate.id).filter(candidate.tenant_id == tenant_id, candidate.slug == slug, candidate.deleted_at.is_(None))
        if candidate is model and record_id is not None:
            query = query.filter(candidate.id != record_id)
        if query.first():
            return True
    return False


def build_list_query(
    db: Session,
    spec: CatalogItemQuerySpec,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
):
    """The list's rows: the list, its cursor and anything that exports it start here."""
    model = spec.model
    query = db.query(model).filter(model.tenant_id == tenant_id, model.deleted_at.is_(None))
    if not include_inactive:
        query = query.filter(model.is_active == 1)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        columns = [model.name, model.sku, *(getattr(model, name) for name in spec.extra_search_columns), model.description]
        query = query.filter(or_(*(column.ilike(pattern) for column in columns)))
    field_map = {key: {"expression": column, "type": kind} for key, (column, kind) in _fields(spec).items()}
    field_map["category_id"] = {"expression": model.category_id, "type": "number"}
    query = apply_filter_conditions(query, conditions=all_filter_conditions, logic="all", field_map=field_map)
    query = apply_filter_conditions(query, conditions=any_filter_conditions, logic="any", field_map=field_map)
    return query


def list_items(
    db: Session,
    spec: CatalogItemQuerySpec,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    offset: int = 0,
    limit: int = 50,
    sort_by: str | None = None,
    sort_direction: str | None = None,
    all_filter_conditions: list[dict] | None = None,
    any_filter_conditions: list[dict] | None = None,
) -> tuple[list, int]:
    query = build_list_query(
        db,
        spec,
        tenant_id=tenant_id,
        search=search,
        include_inactive=include_inactive,
        all_filter_conditions=all_filter_conditions,
        any_filter_conditions=any_filter_conditions,
    )
    total = query.count()
    return apply_sort(spec, query, sort_by=sort_by, sort_direction=sort_direction).offset(offset).limit(limit).all(), total


def list_items_cursor(
    db: Session,
    spec: CatalogItemQuerySpec,
    *,
    tenant_id: int,
    search: str | None = None,
    include_inactive: bool = True,
    limit: int = 50,
    cursor: int | None = None,
) -> list:
    model = spec.model
    query = build_list_query(db, spec, tenant_id=tenant_id, search=search, include_inactive=include_inactive)
    if cursor is not None:
        query = query.filter(model.id < cursor)
    return query.order_by(None).order_by(model.id.desc()).limit(limit + 1).all()


def list_deleted_items(db: Session, spec: CatalogItemQuerySpec, *, tenant_id: int, offset: int = 0, limit: int = 50) -> tuple[list, int]:
    model = spec.model
    query = db.query(model).filter(model.tenant_id == tenant_id, model.deleted_at.is_not(None))
    total = query.count()
    rows = query.order_by(model.deleted_at.desc(), model.updated_at.desc(), model.id.desc()).offset(offset).limit(limit).all()
    return rows, total


def get_item(db: Session, spec: CatalogItemQuerySpec, *, tenant_id: int, item_id: int, include_deleted: bool = False):
    model = spec.model
    query = db.query(model).filter(model.tenant_id == tenant_id, model.id == item_id)
    if not include_deleted:
        query = query.filter(model.deleted_at.is_(None))
    return query.first()
