"""Catalog categories: one level of nesting, shared by products and services.

Benchmarked in docs/crm-evolution/12-erp-inventory.md §4.1 (Odoo product categories,
Dynamics product families, Salesforce Product Family). A category is configuration, not an
operational record, so deleting one is permanent and is refused while anything uses it or
while it has subcategories. Every write is in the activity log.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.catalog.models import CatalogCategory, CatalogProduct, CatalogService
from app.modules.platform.services.activity_logs import log_activity

CATALOG_CATEGORY_ACTIVITY_MODULE = "catalog_products"
CATALOG_CATEGORY_ENTITY = "catalog_category"


def _usage_counts(db: Session, *, tenant_id: int) -> tuple[dict[int, int], dict[int, int]]:
    def counts(model) -> dict[int, int]:
        rows = (
            db.query(model.category_id, func.count(model.id))
            .filter(model.tenant_id == tenant_id, model.category_id.is_not(None), model.deleted_at.is_(None))
            .group_by(model.category_id)
            .all()
        )
        return {category_id: count for category_id, count in rows}

    return counts(CatalogProduct), counts(CatalogService)


def serialize_category(category: CatalogCategory, *, product_count: int = 0, service_count: int = 0) -> dict:
    return {
        "id": category.id,
        "name": category.name,
        "full_name": category.full_name,
        "parent_id": category.parent_id,
        "description": category.description,
        "sort_order": category.sort_order,
        "product_count": product_count,
        "service_count": service_count,
        "created_at": category.created_at,
        "updated_at": category.updated_at,
    }


def list_categories(db: Session, *, tenant_id: int) -> list[dict]:
    """Every category, each parent followed by its children, in sort order then name."""

    categories = (
        db.query(CatalogCategory)
        .filter(CatalogCategory.tenant_id == tenant_id)
        .order_by(CatalogCategory.sort_order.asc(), func.lower(CatalogCategory.name).asc(), CatalogCategory.id.asc())
        .all()
    )
    product_counts, service_counts = _usage_counts(db, tenant_id=tenant_id)
    children: dict[int, list[CatalogCategory]] = {}
    for category in categories:
        if category.parent_id is not None:
            children.setdefault(category.parent_id, []).append(category)
    ordered: list[CatalogCategory] = []
    for category in categories:
        if category.parent_id is None:
            ordered.append(category)
            ordered.extend(children.get(category.id, []))
    return [
        serialize_category(
            category,
            product_count=product_counts.get(category.id, 0),
            service_count=service_counts.get(category.id, 0),
        )
        for category in ordered
    ]


def get_category_or_404(db: Session, *, tenant_id: int, category_id: int) -> CatalogCategory:
    category = (
        db.query(CatalogCategory)
        .filter(CatalogCategory.tenant_id == tenant_id, CatalogCategory.id == category_id)
        .first()
    )
    if not category:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found.")
    return category


def _validate_parent(db: Session, *, tenant_id: int, parent_id: int | None, category: CatalogCategory | None) -> int | None:
    if parent_id is None:
        return None
    if category is not None and parent_id == category.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A category cannot be its own parent.")
    parent = (
        db.query(CatalogCategory)
        .filter(CatalogCategory.tenant_id == tenant_id, CatalogCategory.id == parent_id)
        .first()
    )
    if not parent:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Parent category not found.")
    if parent.parent_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Choose a top-level category as the parent. Categories nest one level deep.",
        )
    if category is not None:
        has_children = (
            db.query(CatalogCategory.id)
            .filter(CatalogCategory.tenant_id == tenant_id, CatalogCategory.parent_id == category.id)
            .first()
        )
        if has_children:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This category has subcategories, so it cannot become one. Move them first.",
            )
    return parent_id


def _ensure_name_available(
    db: Session, *, tenant_id: int, name: str, parent_id: int | None, category_id: int | None = None
) -> None:
    query = db.query(CatalogCategory.id).filter(
        CatalogCategory.tenant_id == tenant_id,
        func.lower(CatalogCategory.name) == name.lower(),
    )
    query = query.filter(CatalogCategory.parent_id.is_(None) if parent_id is None else CatalogCategory.parent_id == parent_id)
    if category_id is not None:
        query = query.filter(CatalogCategory.id != category_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f'A category named "{name}" already exists here.')


def _log(db: Session, *, category: CatalogCategory, actor_user_id: int | None, action: str, description: str, before=None, after=None) -> None:
    log_activity(
        db,
        tenant_id=category.tenant_id,
        actor_user_id=actor_user_id,
        module_key=CATALOG_CATEGORY_ACTIVITY_MODULE,
        entity_type=CATALOG_CATEGORY_ENTITY,
        entity_id=category.id,
        action=action,
        description=description,
        before_state=before,
        after_state=after,
    )


def _state(category: CatalogCategory) -> dict:
    return {
        "name": category.name,
        "parent_id": category.parent_id,
        "description": category.description,
        "sort_order": category.sort_order,
    }


def create_category(db: Session, *, tenant_id: int, actor_user_id: int | None, payload: dict) -> dict:
    name = payload["name"].strip()
    parent_id = _validate_parent(db, tenant_id=tenant_id, parent_id=payload.get("parent_id"), category=None)
    _ensure_name_available(db, tenant_id=tenant_id, name=name, parent_id=parent_id)
    category = CatalogCategory(
        tenant_id=tenant_id,
        parent_id=parent_id,
        name=name,
        description=(payload.get("description") or "").strip() or None,
        sort_order=int(payload.get("sort_order") or 0),
        created_by_user_id=actor_user_id,
        updated_by_user_id=actor_user_id,
    )
    db.add(category)
    db.commit()
    db.refresh(category)
    _log(db, category=category, actor_user_id=actor_user_id, action="create", description=f"Created catalog category {category.full_name}", after=_state(category))
    return serialize_category(category)


def update_category(db: Session, *, category: CatalogCategory, actor_user_id: int | None, payload: dict) -> dict:
    before = _state(category)
    name = payload["name"].strip()
    parent_id = _validate_parent(db, tenant_id=category.tenant_id, parent_id=payload.get("parent_id"), category=category)
    _ensure_name_available(db, tenant_id=category.tenant_id, name=name, parent_id=parent_id, category_id=category.id)
    category.name = name
    category.parent_id = parent_id
    category.description = (payload.get("description") or "").strip() or None
    category.sort_order = int(payload.get("sort_order") or 0)
    category.updated_by_user_id = actor_user_id
    db.add(category)
    db.commit()
    db.refresh(category)
    _log(db, category=category, actor_user_id=actor_user_id, action="update", description=f"Updated catalog category {category.full_name}", before=before, after=_state(category))
    product_counts, service_counts = _usage_counts(db, tenant_id=category.tenant_id)
    return serialize_category(category, product_count=product_counts.get(category.id, 0), service_count=service_counts.get(category.id, 0))


def delete_category(db: Session, *, category: CatalogCategory, actor_user_id: int | None) -> None:
    tenant_id = category.tenant_id
    if db.query(CatalogCategory.id).filter(CatalogCategory.tenant_id == tenant_id, CatalogCategory.parent_id == category.id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Delete or move this category's subcategories first.")
    # Binned items count too: restoring one must not bring back a dangling category.
    in_use = sum(
        db.query(func.count(model.id)).filter(model.tenant_id == tenant_id, model.category_id == category.id).scalar() or 0
        for model in (CatalogProduct, CatalogService)
    )
    if in_use:
        noun = "item uses" if in_use == 1 else "items use"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{in_use} catalog {noun} this category, including any in the recycle bin. Move them to another category first.",
        )
    before = _state(category)
    full_name = category.full_name
    category_id = category.id
    db.delete(category)
    db.commit()
    log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key=CATALOG_CATEGORY_ACTIVITY_MODULE,
        entity_type=CATALOG_CATEGORY_ENTITY,
        entity_id=category_id,
        action="delete",
        description=f"Deleted catalog category {full_name}",
        before_state=before,
    )
