from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.module_filters import normalize_filter_logic, parse_filter_conditions
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.__area__.schema import __Module__CreateRequest, __Module__ListItem, __Module__ListResponse, __Module__Response, __Module__UpdateRequest
from app.modules.__area__.services.__modules___services import (
    create___module__,
    delete___module__,
    get___module___or_404,
    list_deleted___modules__,
    list___modules__,
    list___modules___cursor,
    restore___module__,
    update___module__,
)
from app.modules.platform.services.activity_logs import log_activity
from app.modules.platform.services.module_fields import (
    enabled_module_fields,
    reject_disabled_field_writes,
    sanitize_disabled_field_payload,
    sanitize_disabled_filter_conditions,
)

router = APIRouter(prefix="/__modules__", tags=["__Modules__"])

__MODULE_CONST___LIST_FIELDS = {"name", "description", "status", "assigned_to", "created_time"}


def _parse_list_fields(raw_fields: str | None, allowed_fields: set[str]) -> set[str]:
    if not raw_fields:
        return allowed_fields
    requested = {field.strip() for field in raw_fields.split(",") if field.strip()}
    valid = requested & allowed_fields
    return valid or allowed_fields


def _enabled_list_fields(db: Session, tenant_id: int) -> set[str]:
    return enabled_module_fields(db, tenant_id=tenant_id, module_key="__MODULE_KEY__", field_keys=__MODULE_CONST___LIST_FIELDS)


def _serialize_list_item(record, fields: set[str]) -> __Module__ListItem:
    payload = {"__id_field__": record.__id_field__}
    for field in fields:
        payload[field] = getattr(record, field, None)
    payload["custom_fields"] = getattr(record, "custom_data", None)
    return __Module__ListItem.model_validate(payload)


def _parse_filters(filter_logic: str, filters: str | None, filters_all: str | None, filters_any: str | None) -> tuple[list[dict], list[dict]]:
    try:
        all_conditions = parse_filter_conditions(filters_all or (filters if normalize_filter_logic(filter_logic) != "any" else None))
        any_conditions = parse_filter_conditions(filters_any or (filters if normalize_filter_logic(filter_logic) == "any" else None))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return all_conditions, any_conditions


@router.get("", response_model=__Module__ListResponse)
def list_records(
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "view")),
):
    all_conditions, any_conditions = _parse_filters(filter_logic, filters, filters_all, filters_any)
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", conditions=any_conditions)
    records, total_count = list___modules__(
        db,
        current_user.tenant_id,
        pagination,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields, _enabled_list_fields(db, current_user.tenant_id))
    return build_paged_response([_serialize_list_item(record, selected_fields) for record in records], total_count, pagination)


@router.get("/cursor")
def list_records_cursor(
    fields: str | None = Query(default=None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "view")),
):
    records = list___modules___cursor(db, current_user.tenant_id, limit=pagination.limit, cursor=pagination.cursor)
    selected_fields = _parse_list_fields(fields, _enabled_list_fields(db, current_user.tenant_id))
    return build_cursor_response([_serialize_list_item(record, selected_fields) for record in records], limit=pagination.limit, id_attr="__id_field__")


@router.get("/search", response_model=__Module__ListResponse)
def search_records(
    query: str = Query(..., min_length=1),
    fields: str | None = Query(default=None),
    filter_logic: str = Query(default="all"),
    filters: str | None = Query(default=None),
    filters_all: str | None = Query(default=None),
    filters_any: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "view")),
):
    all_conditions, any_conditions = _parse_filters(filter_logic, filters, filters_all, filters_any)
    all_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", conditions=all_conditions)
    any_conditions = sanitize_disabled_filter_conditions(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", conditions=any_conditions)
    records, total_count = list___modules__(
        db,
        current_user.tenant_id,
        pagination,
        search=query,
        all_filter_conditions=all_conditions,
        any_filter_conditions=any_conditions,
    )
    selected_fields = _parse_list_fields(fields, _enabled_list_fields(db, current_user.tenant_id))
    return build_paged_response([_serialize_list_item(record, selected_fields) for record in records], total_count, pagination)


@router.post("", response_model=__Module__Response, status_code=status.HTTP_201_CREATED)
def create_record(
    payload: __Module__CreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "create")),
):
    submitted_fields = set(payload.model_fields_set) - {"custom_fields"}
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", field_keys=submitted_fields)
    sanitized_payload = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", payload=payload.model_dump())
    record = create___module__(db, sanitized_payload, current_user)
    log_activity(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", action="create", entity_id=record.__id_field__, actor_user_id=current_user.id)
    return record


@router.get("/{__id_field__}", response_model=__Module__Response)
def get_record(
    __id_field__: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "view")),
):
    return get___module___or_404(db, __id_field__, tenant_id=current_user.tenant_id)


@router.put("/{__id_field__}", response_model=__Module__Response)
def update_record(
    __id_field__: int,
    payload: __Module__UpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "edit")),
):
    record = get___module___or_404(db, __id_field__, tenant_id=current_user.tenant_id)
    update_data = payload.model_dump(exclude_unset=True)
    reject_disabled_field_writes(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", field_keys=set(update_data) - {"custom_fields"})
    update_data = sanitize_disabled_field_payload(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", payload=update_data)
    updated = update___module__(db, record, update_data)
    log_activity(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", action="update", entity_id=updated.__id_field__, actor_user_id=current_user.id)
    return updated


@router.delete("/{__id_field__}", status_code=status.HTTP_204_NO_CONTENT)
def delete_record(
    __id_field__: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "delete")),
):
    record = get___module___or_404(db, __id_field__, tenant_id=current_user.tenant_id)
    delete___module__(db, record)
    log_activity(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", action="delete", entity_id=__id_field__, actor_user_id=current_user.id)
    return None


@router.get("/deleted", response_model=__Module__ListResponse)
def list_deleted_records(
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "restore")),
):
    records, total_count = list_deleted___modules__(db, current_user.tenant_id, pagination)
    return build_paged_response([__Module__ListItem.model_validate(record) for record in records], total_count, pagination)


@router.post("/{__id_field__}/restore", response_model=__Module__Response)
def restore_record(
    __id_field__: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("__MODULE_KEY__")),
    require_permission=Depends(require_action_access("__MODULE_KEY__", "restore")),
):
    record = get___module___or_404(db, __id_field__, tenant_id=current_user.tenant_id, include_deleted=True)
    restored = restore___module__(db, record)
    log_activity(db, tenant_id=current_user.tenant_id, module_key="__MODULE_KEY__", action="restore", entity_id=restored.__id_field__, actor_user_id=current_user.id)
    return restored
