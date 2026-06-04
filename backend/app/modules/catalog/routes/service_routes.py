from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.catalog.schema import (
    CatalogServiceCreateRequest,
    CatalogServiceListResponse,
    CatalogServiceResponse,
    CatalogServiceUpdateRequest,
)
from app.modules.catalog.services.service_services import (
    CATALOG_SERVICES_MODULE,
    create_service,
    get_service_or_404,
    list_deleted_services,
    list_services_cursor,
    list_services,
    restore_service,
    serialize_service,
    soft_delete_service,
    update_service,
    upload_service_media,
)

router = APIRouter(prefix="/catalog/services", tags=["Catalog Services"])


def _response(service) -> CatalogServiceResponse:
    return CatalogServiceResponse.model_validate(serialize_service(service))


@router.get("", response_model=CatalogServiceListResponse)
def get_services(
    search: str | None = Query(default=None, max_length=100),
    include_inactive: bool = Query(default=True),
    sort_by: str | None = Query(default=None, max_length=80),
    sort_direction: str | None = Query(default=None, pattern="^(asc|desc)$"),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "view")),
):
    services, total = list_services(
        db,
        tenant_id=current_user.tenant_id,
        search=search,
        include_inactive=include_inactive,
        offset=pagination.offset,
        limit=pagination.limit,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )
    return build_paged_response([_response(service) for service in services], total_count=total, pagination=pagination)


@router.get("/cursor")
def get_services_cursor(
    search: str | None = Query(default=None, max_length=100),
    include_inactive: bool = Query(default=True),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "view")),
):
    services = list_services_cursor(
        db,
        tenant_id=current_user.tenant_id,
        search=search,
        include_inactive=include_inactive,
        limit=pagination.limit,
        cursor=pagination.cursor,
    )
    return build_cursor_response([_response(service) for service in services], limit=pagination.limit, id_attr="id")


@router.get("/recycle", response_model=CatalogServiceListResponse)
def get_deleted_services(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "restore")),
):
    services, total = list_deleted_services(
        db,
        tenant_id=current_user.tenant_id,
        offset=pagination.offset,
        limit=pagination.limit,
    )
    return build_paged_response([_response(service) for service in services], total_count=total, pagination=pagination)


@router.post("", response_model=CatalogServiceResponse, status_code=status.HTTP_201_CREATED)
def create_service_route(
    payload: CatalogServiceCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "create")),
):
    service = create_service(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        payload=payload.model_dump(),
    )
    return _response(service)


@router.get("/{service_id}", response_model=CatalogServiceResponse)
def get_service(
    service_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "view")),
):
    service = get_service_or_404(db, tenant_id=current_user.tenant_id, service_id=service_id)
    return _response(service)


@router.put("/{service_id}", response_model=CatalogServiceResponse)
def update_service_route(
    service_id: int,
    payload: CatalogServiceUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "edit")),
):
    service = get_service_or_404(db, tenant_id=current_user.tenant_id, service_id=service_id)
    service = update_service(
        db,
        service=service,
        actor_user_id=current_user.id,
        payload=payload.model_dump(exclude_unset=True),
    )
    return _response(service)


@router.put("/{service_id}/media", response_model=CatalogServiceResponse)
async def upload_service_media_route(
    service_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "edit")),
):
    service = get_service_or_404(db, tenant_id=current_user.tenant_id, service_id=service_id)
    service = await upload_service_media(db, service=service, actor_user_id=current_user.id, file=file)
    return _response(service)


@router.delete("/{service_id}", response_model=CatalogServiceResponse)
def delete_service_route(
    service_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "delete")),
):
    service = get_service_or_404(db, tenant_id=current_user.tenant_id, service_id=service_id)
    service = soft_delete_service(db, service=service, actor_user_id=current_user.id)
    return _response(service)


@router.post("/{service_id}/restore", response_model=CatalogServiceResponse)
def restore_service_route(
    service_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access(CATALOG_SERVICES_MODULE)),
    require_permission=Depends(require_action_access(CATALOG_SERVICES_MODULE, "restore")),
):
    service = get_service_or_404(
        db,
        tenant_id=current_user.tenant_id,
        service_id=service_id,
        include_deleted=True,
    )
    service = restore_service(db, service=service, actor_user_id=current_user.id)
    return _response(service)
