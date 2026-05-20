from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.catalog.schema import (
    CatalogProductCreateRequest,
    CatalogProductListResponse,
    CatalogProductResponse,
    CatalogProductUpdateRequest,
)
from app.modules.catalog.services.product_services import (
    CATALOG_PRODUCTS_MODULE,
    create_product,
    get_product_or_404,
    list_deleted_products,
    list_products_cursor,
    list_products,
    restore_product,
    serialize_product,
    soft_delete_product,
    update_product,
    upload_product_media,
)

router = APIRouter(prefix="/catalog/products", tags=["Catalog Products"])


def _response(product) -> CatalogProductResponse:
    return CatalogProductResponse.model_validate(serialize_product(product))


@router.get("", response_model=CatalogProductListResponse)
def get_products(
    search: str | None = Query(default=None, max_length=100),
    include_inactive: bool = Query(default=True),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "view")),
):
    products, total = list_products(
        db,
        tenant_id=current_user.tenant_id,
        search=search,
        include_inactive=include_inactive,
        offset=pagination.offset,
        limit=pagination.limit,
    )
    return build_paged_response([_response(product) for product in products], total_count=total, pagination=pagination)


@router.get("/cursor")
def get_products_cursor(
    search: str | None = Query(default=None, max_length=100),
    include_inactive: bool = Query(default=True),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "view")),
):
    products = list_products_cursor(
        db,
        tenant_id=current_user.tenant_id,
        search=search,
        include_inactive=include_inactive,
        limit=pagination.limit,
        cursor=pagination.cursor,
    )
    return build_cursor_response([_response(product) for product in products], limit=pagination.limit, id_attr="id")


@router.get("/recycle", response_model=CatalogProductListResponse)
def get_deleted_products(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "restore")),
):
    products, total = list_deleted_products(
        db,
        tenant_id=current_user.tenant_id,
        offset=pagination.offset,
        limit=pagination.limit,
    )
    return build_paged_response([_response(product) for product in products], total_count=total, pagination=pagination)


@router.post("", response_model=CatalogProductResponse, status_code=status.HTTP_201_CREATED)
def create_product_route(
    payload: CatalogProductCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "create")),
):
    product = create_product(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        payload=payload.model_dump(),
    )
    return _response(product)


@router.get("/{product_id}", response_model=CatalogProductResponse)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "view")),
):
    product = get_product_or_404(db, tenant_id=current_user.tenant_id, product_id=product_id)
    return _response(product)


@router.put("/{product_id}", response_model=CatalogProductResponse)
def update_product_route(
    product_id: int,
    payload: CatalogProductUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "edit")),
):
    product = get_product_or_404(db, tenant_id=current_user.tenant_id, product_id=product_id)
    product = update_product(
        db,
        product=product,
        actor_user_id=current_user.id,
        payload=payload.model_dump(exclude_unset=True),
    )
    return _response(product)


@router.put("/{product_id}/media", response_model=CatalogProductResponse)
async def upload_product_media_route(
    product_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "edit")),
):
    product = get_product_or_404(db, tenant_id=current_user.tenant_id, product_id=product_id)
    product = await upload_product_media(db, product=product, actor_user_id=current_user.id, file=file)
    return _response(product)


@router.delete("/{product_id}", response_model=CatalogProductResponse)
def delete_product_route(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "delete")),
):
    product = get_product_or_404(db, tenant_id=current_user.tenant_id, product_id=product_id)
    product = soft_delete_product(db, product=product, actor_user_id=current_user.id)
    return _response(product)


@router.post("/{product_id}/restore", response_model=CatalogProductResponse)
def restore_product_route(
    product_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_PRODUCTS_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_PRODUCTS_MODULE, "restore")),
):
    product = get_product_or_404(
        db,
        tenant_id=current_user.tenant_id,
        product_id=product_id,
        include_deleted=True,
    )
    product = restore_product(db, product=product, actor_user_id=current_user.id)
    return _response(product)
