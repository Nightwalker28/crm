"""Routes that span products and services: categories, the line-item picker, item sales.

Products and services are separate modules with separate permissions, so these routes ask
which of the two the caller can use rather than mounting under one of them. Each still runs
all three access layers per module through `PermissionPolicy`.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.access_control import PermissionPolicy
from app.core.database import get_db
from app.core.security import require_user
from app.modules.catalog.schema import (
    CatalogCategoryListResponse,
    CatalogCategoryRequest,
    CatalogCategoryResponse,
    CatalogItemSalesResponse,
    CatalogItemSearchResponse,
)
from app.modules.catalog.services import category_services, item_services
from app.modules.catalog.services.product_services import CATALOG_PRODUCTS_MODULE, get_product_or_404
from app.modules.catalog.services.service_services import CATALOG_SERVICES_MODULE, get_service_or_404

router = APIRouter(prefix="/catalog", tags=["Catalog"])

CATALOG_MODULES = (CATALOG_PRODUCTS_MODULE, CATALOG_SERVICES_MODULE)


def _allowed(db: Session, user, module_key: str, action: str) -> bool:
    policy = PermissionPolicy(db, user)
    return policy.can_view_module(module_key) and policy.can_perform_action(module_key, action)


def _require_any_catalog(db: Session, user, action: str) -> None:
    if not any(_allowed(db, user, module_key, action) for module_key in CATALOG_MODULES):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to the catalog.")


def require_catalog_view(db: Session = Depends(get_db), current_user=Depends(require_user)):
    _require_any_catalog(db, current_user, "view")
    return current_user


def require_catalog_configure(db: Session = Depends(get_db), current_user=Depends(require_user)):
    _require_any_catalog(db, current_user, "configure")
    return current_user


@router.get("/categories", response_model=CatalogCategoryListResponse)
def get_categories(db: Session = Depends(get_db), current_user=Depends(require_catalog_view)):
    return {"results": category_services.list_categories(db, tenant_id=current_user.tenant_id)}


@router.post("/categories", response_model=CatalogCategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(payload: CatalogCategoryRequest, db: Session = Depends(get_db), current_user=Depends(require_catalog_configure)):
    return category_services.create_category(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        payload=payload.model_dump(),
    )


@router.put("/categories/{category_id}", response_model=CatalogCategoryResponse)
def update_category(
    category_id: int,
    payload: CatalogCategoryRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_catalog_configure),
):
    category = category_services.get_category_or_404(db, tenant_id=current_user.tenant_id, category_id=category_id)
    return category_services.update_category(db, category=category, actor_user_id=current_user.id, payload=payload.model_dump())


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(category_id: int, db: Session = Depends(get_db), current_user=Depends(require_catalog_configure)):
    category = category_services.get_category_or_404(db, tenant_id=current_user.tenant_id, category_id=category_id)
    category_services.delete_category(db, category=category, actor_user_id=current_user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/items/search", response_model=CatalogItemSearchResponse)
def search_items(
    query: str = Query(default="", max_length=100),
    currency: str | None = Query(default=None, min_length=3, max_length=3),
    limit: int = Query(default=10, ge=1, le=item_services.SEARCH_LIMIT_MAX),
    db: Session = Depends(get_db),
    current_user=Depends(require_catalog_view),
):
    return {
        "results": item_services.search_catalog_items(
            db,
            tenant_id=current_user.tenant_id,
            query=query,
            currency=currency.upper() if currency else None,
            include_products=_allowed(db, current_user, CATALOG_PRODUCTS_MODULE, "view"),
            include_services=_allowed(db, current_user, CATALOG_SERVICES_MODULE, "view"),
            limit=limit,
        )
    }


def _item_sales(db: Session, current_user, *, kind: str, item_id: int) -> dict:
    return item_services.list_catalog_item_sales(
        db,
        tenant_id=current_user.tenant_id,
        kind=kind,
        item_id=item_id,
        include_quotes=_allowed(db, current_user, "sales_quotes", "view"),
        include_orders=_allowed(db, current_user, "sales_orders", "view"),
    )


@router.get("/products/{product_id}/sales", response_model=CatalogItemSalesResponse)
def get_product_sales(product_id: int, db: Session = Depends(get_db), current_user=Depends(require_user)):
    if not _allowed(db, current_user, CATALOG_PRODUCTS_MODULE, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to products.")
    get_product_or_404(db, tenant_id=current_user.tenant_id, product_id=product_id)
    return _item_sales(db, current_user, kind="product", item_id=product_id)


@router.get("/services/{service_id}/sales", response_model=CatalogItemSalesResponse)
def get_service_sales(service_id: int, db: Session = Depends(get_db), current_user=Depends(require_user)):
    if not _allowed(db, current_user, CATALOG_SERVICES_MODULE, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to services.")
    get_service_or_404(db, tenant_id=current_user.tenant_id, service_id=service_id)
    return _item_sales(db, current_user, kind="service", item_id=service_id)
