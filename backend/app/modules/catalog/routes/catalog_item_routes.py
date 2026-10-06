"""One route factory for products and services (13a E2).

The two route files were copies that differed only in names. `build_catalog_item_router` makes
both from their `CatalogKind`; each route checks the kind's own module and action.

No `from __future__ import annotations` here: FastAPI reads the request and response models from
the closures' annotations when the routes are declared, so they must be real classes.
"""

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.module_filters import parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.services.custom_fields import load_custom_field_values
from app.modules.catalog.services import catalog_item_services as items
from app.modules.catalog.services.catalog_item_services import CatalogKind


def build_catalog_item_router(
    kind: CatalogKind,
    *,
    prefix: str,
    tag: str,
    create_request: type,
    update_request: type,
    list_response: type,
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])
    module = kind.module_key
    response = kind.response_model

    def _response(record):
        return response.model_validate(items.serialize(kind, record))

    @router.get("", response_model=list_response)
    def list_records(
        search: str | None = Query(default=None, max_length=100),
        include_inactive: bool = Query(default=True),
        sort_by: str | None = Query(default=None, max_length=80),
        sort_direction: str | None = Query(default=None, pattern="^(asc|desc)$"),
        filters_all: str | None = Query(default=None),
        filters_any: str | None = Query(default=None),
        pagination: Pagination = Depends(get_pagination),
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "view")),
    ):
        try:
            records, total = items.list_items(
                db,
                kind,
                tenant_id=current_user.tenant_id,
                search=search,
                include_inactive=include_inactive,
                offset=pagination.offset,
                limit=pagination.limit,
                sort_by=sort_by,
                sort_direction=sort_direction,
                all_filter_conditions=parse_filter_conditions(filters_all),
                any_filter_conditions=parse_filter_conditions(filters_any),
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        return build_paged_response([_response(record) for record in records], total_count=total, pagination=pagination)

    @router.get("/cursor")
    def list_records_cursor(
        search: str | None = Query(default=None, max_length=100),
        include_inactive: bool = Query(default=True),
        pagination: CursorPagination = Depends(get_cursor_pagination),
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "view")),
    ):
        records = items.list_items_cursor(
            db,
            kind,
            tenant_id=current_user.tenant_id,
            search=search,
            include_inactive=include_inactive,
            limit=pagination.limit,
            cursor=pagination.cursor,
        )
        return build_cursor_response(records, limit=pagination.limit, id_attr="id", serializer=_response)

    @router.get("/recycle", response_model=list_response)
    def list_deleted_records(
        pagination: Pagination = Depends(get_pagination),
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "restore")),
    ):
        records, total = items.list_deleted_items(db, kind, tenant_id=current_user.tenant_id, offset=pagination.offset, limit=pagination.limit)
        return build_paged_response([_response(record) for record in records], total_count=total, pagination=pagination)

    @router.post("", response_model=response, status_code=status.HTTP_201_CREATED)
    def create_record(
        payload: create_request,
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "create")),
    ):
        record = items.create_item(db, kind, tenant_id=current_user.tenant_id, actor_user_id=current_user.id, payload=payload.model_dump())
        return _response(record)

    @router.get("/{item_id}", response_model=response)
    def get_record(
        item_id: int,
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "view")),
    ):
        record = items.get_item_or_404(db, kind, tenant_id=current_user.tenant_id, item_id=item_id)
        record.custom_fields = load_custom_field_values(db, tenant_id=current_user.tenant_id, module_key=kind.module_key, record_id=record.id) or None
        record.images = items.gallery(db, kind, record)
        return _response(record)

    @router.put("/{item_id}", response_model=response)
    def update_record(
        item_id: int,
        payload: update_request,
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "edit")),
    ):
        record = items.get_item_or_404(db, kind, tenant_id=current_user.tenant_id, item_id=item_id)
        record = items.update_item(db, kind, record=record, actor_user_id=current_user.id, payload=payload.model_dump(exclude_unset=True))
        return _response(record)

    @router.post("/{item_id}/images")
    async def add_record_image(
        item_id: int,
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "edit")),
    ):
        """Another picture, after the main image (13a C4)."""
        record = items.get_item_or_404(db, kind, tenant_id=current_user.tenant_id, item_id=item_id)
        return {"results": await items.add_gallery_image(db, kind, record=record, actor_user_id=current_user.id, file=file)}

    @router.delete("/{item_id}/images/{image_id}")
    def remove_record_image(
        item_id: int,
        image_id: int,
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "edit")),
    ):
        record = items.get_item_or_404(db, kind, tenant_id=current_user.tenant_id, item_id=item_id)
        return {"results": items.remove_gallery_image(db, kind, record=record, actor_user_id=current_user.id, image_id=image_id)}

    @router.put("/{item_id}/media", response_model=response)
    async def upload_record_media(
        item_id: int,
        file: UploadFile = File(...),
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "edit")),
    ):
        record = items.get_item_or_404(db, kind, tenant_id=current_user.tenant_id, item_id=item_id)
        record = await items.upload_item_media(db, kind, record=record, actor_user_id=current_user.id, file=file)
        return _response(record)

    @router.delete("/{item_id}", response_model=response)
    def delete_record(
        item_id: int,
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "delete")),
    ):
        record = items.get_item_or_404(db, kind, tenant_id=current_user.tenant_id, item_id=item_id)
        return _response(items.soft_delete_item(db, kind, record=record, actor_user_id=current_user.id))

    @router.post("/{item_id}/restore", response_model=response)
    def restore_record(
        item_id: int,
        db: Session = Depends(get_db),
        current_user=Depends(require_user),
        require_module=Depends(require_module_access(module)),
        require_permission=Depends(require_action_access(module, "restore")),
    ):
        record = items.get_item_or_404(db, kind, tenant_id=current_user.tenant_id, item_id=item_id, include_deleted=True)
        return _response(items.restore_item(db, kind, record=record, actor_user_id=current_user.id))

    return router
