from app.modules.catalog.routes.catalog_item_routes import build_catalog_item_router
from app.modules.catalog.schema import CatalogServiceCreateRequest, CatalogServiceListResponse, CatalogServiceUpdateRequest
from app.modules.catalog.services.service_services import SERVICE

router = build_catalog_item_router(
    SERVICE,
    prefix="/catalog/services",
    tag="Catalog Services",
    create_request=CatalogServiceCreateRequest,
    update_request=CatalogServiceUpdateRequest,
    list_response=CatalogServiceListResponse,
)
