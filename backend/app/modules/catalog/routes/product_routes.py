from app.modules.catalog.routes.catalog_item_routes import build_catalog_item_router
from app.modules.catalog.schema import CatalogProductCreateRequest, CatalogProductListResponse, CatalogProductUpdateRequest
from app.modules.catalog.services.product_services import PRODUCT

router = build_catalog_item_router(
    PRODUCT,
    prefix="/catalog/products",
    tag="Catalog Products",
    create_request=CatalogProductCreateRequest,
    update_request=CatalogProductUpdateRequest,
    list_response=CatalogProductListResponse,
)
