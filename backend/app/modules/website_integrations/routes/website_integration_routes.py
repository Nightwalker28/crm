from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.modules.website_integrations.schema import (
    PublicWebsiteCatalogItemResponse,
    PublicWebsiteCatalogListResponse,
    PublicWebsiteOrderCreateRequest,
    WebsiteIntegrationApiKeyCreateRequest,
    WebsiteIntegrationApiKeyResponse,
    WebsiteOrderResponse,
)
from app.modules.website_integrations.services.website_integration_services import (
    ORDER_WRITE_SCOPE,
    check_integration_rate_limit,
    create_api_key,
    create_public_order,
    get_api_key_or_404,
    get_public_catalog_item_by_slug_or_404,
    list_api_keys,
    list_catalog_items,
    log_public_api_request,
    resolve_public_api_key,
    revoke_api_key,
    rotate_api_key,
    serialize_api_key,
    serialize_catalog_item,
    serialize_order,
)


MODULE_KEY = "website_integrations"

# CRM-user routes: the module's three access layers (13a B7). Keys are configuration; the
# published catalog is a view. The public API below authenticates by integration key only.
router = APIRouter(
    prefix="/integrations",
    tags=["Website Integrations"],
    dependencies=[Depends(require_module_access(MODULE_KEY))],
)
public_router = APIRouter(prefix="/integrations/public", tags=["Website Integration Public API"])


def _api_key_from_request(request: Request, x_lynk_integration_key: str | None) -> str | None:
    if x_lynk_integration_key:
        return x_lynk_integration_key.strip()
    authorization = request.headers.get("authorization")
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return None


def _check_allowed_origin(request: Request, allowed_origins: list[str]) -> None:
    if not allowed_origins:
        return
    origin = request.headers.get("origin")
    if not origin:
        return
    if origin.rstrip("/") not in allowed_origins:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin is not allowed for this integration key")


def _public_request_metadata(request: Request) -> dict:
    user_agent = request.headers.get("user-agent")
    return {
        "origin": request.headers.get("origin"),
        "user_agent": user_agent[:160] if user_agent else None,
    }


def _public_key_context(
    request: Request,
    x_lynk_integration_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    key = resolve_public_api_key(db, api_key=_api_key_from_request(request, x_lynk_integration_key))
    _check_allowed_origin(request, key.allowed_origins or [])
    check_integration_rate_limit(key, operation="catalog_read")
    return key


def _public_order_key_context(
    request: Request,
    x_lynk_integration_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    key = resolve_public_api_key(
        db,
        api_key=_api_key_from_request(request, x_lynk_integration_key),
        required_scope=ORDER_WRITE_SCOPE,
    )
    _check_allowed_origin(request, key.allowed_origins or [])
    check_integration_rate_limit(key, operation="orders_write")
    return key


@router.get("/api-keys", response_model=list[WebsiteIntegrationApiKeyResponse])
def get_integration_api_keys(
    db: Session = Depends(get_db),
    current_user=Depends(require_action_access(MODULE_KEY, "configure")),
):
    keys = list_api_keys(db, tenant_id=current_user.tenant_id)
    return [WebsiteIntegrationApiKeyResponse.model_validate(serialize_api_key(key)) for key in keys]


@router.post("/api-keys", response_model=WebsiteIntegrationApiKeyResponse, status_code=status.HTTP_201_CREATED)
def create_integration_api_key_route(
    payload: WebsiteIntegrationApiKeyCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_action_access(MODULE_KEY, "configure")),
):
    key, raw_key = create_api_key(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        payload=payload.model_dump(),
    )
    return WebsiteIntegrationApiKeyResponse.model_validate(serialize_api_key(key, api_key=raw_key))


@router.delete("/api-keys/{key_id}", response_model=WebsiteIntegrationApiKeyResponse)
def revoke_integration_api_key_route(
    key_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_action_access(MODULE_KEY, "configure")),
):
    key = get_api_key_or_404(db, tenant_id=current_user.tenant_id, key_id=key_id)
    key = revoke_api_key(db, key=key, actor_user_id=current_user.id)
    return WebsiteIntegrationApiKeyResponse.model_validate(serialize_api_key(key))


@router.post("/api-keys/{key_id}/rotate", response_model=WebsiteIntegrationApiKeyResponse)
def rotate_integration_api_key_route(
    key_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_action_access(MODULE_KEY, "configure")),
):
    key = get_api_key_or_404(db, tenant_id=current_user.tenant_id, key_id=key_id)
    key, raw_key = rotate_api_key(db, key=key, actor_user_id=current_user.id)
    return WebsiteIntegrationApiKeyResponse.model_validate(serialize_api_key(key, api_key=raw_key))


@router.get("/catalog/published", response_model=PublicWebsiteCatalogListResponse)
def get_published_catalog_items(
    search: str | None = Query(default=None, max_length=120),
    item_type: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user=Depends(require_action_access(MODULE_KEY, "view")),
):
    items, total = list_catalog_items(
        db,
        tenant_id=current_user.tenant_id,
        include_private=False,
        search=search,
        item_type=item_type,
        limit=limit,
        offset=offset,
    )
    return PublicWebsiteCatalogListResponse(
        results=[PublicWebsiteCatalogItemResponse.model_validate(serialize_catalog_item(item, public=True)) for item in items],
        total_count=total,
        limit=limit,
        offset=offset,
    )


@public_router.get("/catalog", response_model=PublicWebsiteCatalogListResponse)
def get_public_catalog(
    request: Request,
    search: str | None = Query(default=None, max_length=100),
    item_type: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    key=Depends(_public_key_context),
):
    items, total = list_catalog_items(
        db,
        tenant_id=key.tenant_id,
        include_private=False,
        search=search,
        item_type=item_type,
        limit=limit,
        offset=offset,
    )
    log_public_api_request(
        db,
        key=key,
        operation="catalog_list",
        metadata={**_public_request_metadata(request), "limit": limit, "offset": offset},
    )
    return PublicWebsiteCatalogListResponse(
        results=[PublicWebsiteCatalogItemResponse.model_validate(serialize_catalog_item(item, public=True)) for item in items],
        total_count=total,
        limit=limit,
        offset=offset,
    )


@public_router.get("/catalog/{slug}", response_model=PublicWebsiteCatalogItemResponse)
def get_public_catalog_item(
    request: Request,
    slug: str,
    db: Session = Depends(get_db),
    key=Depends(_public_key_context),
):
    item = get_public_catalog_item_by_slug_or_404(db, tenant_id=key.tenant_id, slug=slug)
    log_public_api_request(
        db,
        key=key,
        operation="catalog_item",
        metadata={**_public_request_metadata(request), "slug": slug},
    )
    return PublicWebsiteCatalogItemResponse.model_validate(serialize_catalog_item(item, public=True))


@public_router.post("/orders", response_model=WebsiteOrderResponse, status_code=status.HTTP_201_CREATED)
def create_public_order_route(
    request: Request,
    payload: PublicWebsiteOrderCreateRequest,
    db: Session = Depends(get_db),
    key=Depends(_public_order_key_context),
):
    order, replayed = create_public_order(db, key=key, payload=payload.model_dump())
    log_public_api_request(
        db,
        key=key,
        operation="order_create",
        metadata={
            **_public_request_metadata(request),
            "external_reference": payload.external_reference,
            "idempotent_replayed": replayed,
        },
    )
    return WebsiteOrderResponse.model_validate(serialize_order(order, idempotent_replayed=replayed))
