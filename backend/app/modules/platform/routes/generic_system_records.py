from __future__ import annotations

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.platform.schema_generic_records import (
    GenericSystemRecordCreate,
    GenericSystemRecordResponse,
    GenericSystemRecordUpdate,
)
from app.modules.platform.services import generic_system_records


router = APIRouter(prefix="/generic-system-modules", tags=["Generic System Modules"])


@router.get("/{module_key}", response_model=dict)
def list_generic_system_records(
    module_key: str,
    search: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    generic_system_records.ensure_generic_module_key(module_key)
    require_module_access(module_key)(db=db, current_user=current_user)
    require_action_access(module_key, "view")(db=db, current_user=current_user)
    records, total = generic_system_records.list_records(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        pagination=pagination,
        search=search,
    )
    serialized = [GenericSystemRecordResponse.model_validate(record) for record in records]
    return build_paged_response(serialized, total_count=total, pagination=pagination)


@router.get("/{module_key}/cursor", response_model=dict)
def list_generic_system_records_cursor(
    module_key: str,
    search: str | None = Query(default=None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    generic_system_records.ensure_generic_module_key(module_key)
    require_module_access(module_key)(db=db, current_user=current_user)
    require_action_access(module_key, "view")(db=db, current_user=current_user)
    records = generic_system_records.list_records_cursor(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        limit=pagination.limit,
        cursor=pagination.cursor,
        search=search,
    )
    serialized = [GenericSystemRecordResponse.model_validate(record) for record in records]
    return build_cursor_response(serialized, limit=pagination.limit, id_attr="id")


@router.post("/{module_key}", response_model=GenericSystemRecordResponse, status_code=status.HTTP_201_CREATED)
def create_generic_system_record(
    module_key: str,
    payload: GenericSystemRecordCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    generic_system_records.ensure_generic_module_key(module_key)
    require_module_access(module_key)(db=db, current_user=current_user)
    require_action_access(module_key, "create")(db=db, current_user=current_user)
    return generic_system_records.create_record(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        payload=payload.model_dump(),
        actor_user_id=current_user.id,
    )


@router.get("/{module_key}/{record_id}", response_model=GenericSystemRecordResponse)
def get_generic_system_record(
    module_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    generic_system_records.ensure_generic_module_key(module_key)
    require_module_access(module_key)(db=db, current_user=current_user)
    require_action_access(module_key, "view")(db=db, current_user=current_user)
    return generic_system_records.get_record_or_404(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        record_id=record_id,
    )


@router.put("/{module_key}/{record_id}", response_model=GenericSystemRecordResponse)
def update_generic_system_record(
    module_key: str,
    record_id: int,
    payload: GenericSystemRecordUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    generic_system_records.ensure_generic_module_key(module_key)
    require_module_access(module_key)(db=db, current_user=current_user)
    require_action_access(module_key, "edit")(db=db, current_user=current_user)
    record = generic_system_records.get_record_or_404(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        record_id=record_id,
    )
    return generic_system_records.update_record(
        db,
        record=record,
        payload=payload.model_dump(exclude_unset=True),
        actor_user_id=current_user.id,
    )


@router.delete("/{module_key}/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_generic_system_record(
    module_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    generic_system_records.ensure_generic_module_key(module_key)
    require_module_access(module_key)(db=db, current_user=current_user)
    require_action_access(module_key, "delete")(db=db, current_user=current_user)
    record = generic_system_records.get_record_or_404(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        record_id=record_id,
    )
    generic_system_records.delete_record(db, record=record)


@router.post("/{module_key}/{record_id}/restore", response_model=GenericSystemRecordResponse)
def restore_generic_system_record(
    module_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    generic_system_records.ensure_generic_module_key(module_key)
    require_module_access(module_key)(db=db, current_user=current_user)
    require_action_access(module_key, "restore")(db=db, current_user=current_user)
    record = generic_system_records.get_record_or_404(
        db,
        tenant_id=current_user.tenant_id,
        module_key=module_key,
        record_id=record_id,
        include_deleted=True,
    )
    return generic_system_records.restore_record(db, record=record)
