from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.module_csv import ImportExecutionResponse, parse_mapping_json, read_upload_bytes, remap_csv_bytes
from app.core.module_export import bytes_download_response
from app.core.pagination import Pagination, get_pagination
from app.core.security import require_admin, require_user
from app.modules.platform.custom_modules_schema import (
    CustomModuleCreate,
    CustomModuleFieldCreate,
    CustomModuleFieldUpdate,
    CustomModuleRecordListResponse,
    CustomModuleRecordRequest,
    CustomModuleRecordResponse,
    CustomModuleResponse,
    CustomModuleUpdate,
)
from app.modules.platform.services import custom_modules

builder_router = APIRouter(prefix="/module-builder", tags=["Module Builder"])
runtime_router = APIRouter(prefix="/custom-modules", tags=["Custom Modules"])


@builder_router.get("", response_model=list[CustomModuleResponse])
def list_custom_modules(
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.list_modules(db, tenant_id=admin.tenant_id, include_deleted=include_deleted)


@builder_router.post("", response_model=CustomModuleResponse, status_code=201)
def create_custom_module(
    payload: CustomModuleCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.create_module(db, tenant_id=admin.tenant_id, actor_user_id=admin.id, payload=payload)


@builder_router.get("/{module_id}", response_model=CustomModuleResponse)
def get_custom_module(
    module_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.get_module(db, tenant_id=admin.tenant_id, module_id=module_id)


@builder_router.put("/{module_id}", response_model=CustomModuleResponse)
def update_custom_module(
    module_id: int,
    payload: CustomModuleUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.update_module(db, tenant_id=admin.tenant_id, module_id=module_id, actor_user_id=admin.id, payload=payload)


@builder_router.delete("/{module_id}", response_model=CustomModuleResponse)
def delete_custom_module(
    module_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.delete_module(db, tenant_id=admin.tenant_id, module_id=module_id, actor_user_id=admin.id)


@builder_router.post("/{module_id}/restore", response_model=CustomModuleResponse)
def restore_custom_module(
    module_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.restore_module(db, tenant_id=admin.tenant_id, module_id=module_id, actor_user_id=admin.id)


@builder_router.post("/{module_id}/fields", response_model=CustomModuleResponse, status_code=201)
def create_custom_module_field(
    module_id: int,
    payload: CustomModuleFieldCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.create_field(db, tenant_id=admin.tenant_id, module_id=module_id, actor_user_id=admin.id, payload=payload)


@builder_router.put("/{module_id}/fields/{field_id}", response_model=CustomModuleResponse)
def update_custom_module_field(
    module_id: int,
    field_id: int,
    payload: CustomModuleFieldUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.update_field(db, tenant_id=admin.tenant_id, module_id=module_id, field_id=field_id, actor_user_id=admin.id, payload=payload)


@builder_router.delete("/{module_id}/fields/{field_id}", response_model=CustomModuleResponse)
def delete_custom_module_field(
    module_id: int,
    field_id: int,
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    return custom_modules.delete_field(db, tenant_id=admin.tenant_id, module_id=module_id, field_id=field_id, actor_user_id=admin.id)


@runtime_router.get("/{module_key}/schema", response_model=CustomModuleResponse)
def get_runtime_schema(
    module_key: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    return custom_modules.get_runtime_schema(db, tenant_id=current_user.tenant_id, module_key=module_key, current_user=current_user)


@runtime_router.get("/{module_key}/records", response_model=CustomModuleRecordListResponse)
def list_custom_module_records(
    module_key: str,
    search: str | None = Query(None),
    sort_by: str | None = Query(default=None),
    sort_direction: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    return custom_modules.list_records(
        db,
        module_key=module_key,
        current_user=current_user,
        pagination=pagination,
        search=search,
        sort_by=sort_by,
        sort_direction=sort_direction,
    )


@runtime_router.get("/{module_key}/records/cursor")
def list_custom_module_records_cursor(
    module_key: str,
    search: str | None = Query(None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    records = custom_modules.list_records_cursor(
        db,
        module_key=module_key,
        current_user=current_user,
        limit=pagination.limit,
        cursor=pagination.cursor,
        search=search,
    )
    return build_cursor_response(records, limit=pagination.limit, id_attr="id")


@runtime_router.post("/{module_key}/records", response_model=CustomModuleRecordResponse, status_code=201)
def create_custom_module_record(
    module_key: str,
    payload: CustomModuleRecordRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    return custom_modules.create_record(db, module_key=module_key, current_user=current_user, payload=payload)


@runtime_router.get("/{module_key}/records/{record_id}", response_model=CustomModuleRecordResponse)
def get_custom_module_record(
    module_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    return custom_modules.get_record(db, module_key=module_key, record_id=record_id, current_user=current_user)


@runtime_router.put("/{module_key}/records/{record_id}", response_model=CustomModuleRecordResponse)
def update_custom_module_record(
    module_key: str,
    record_id: int,
    payload: CustomModuleRecordRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    return custom_modules.update_record(db, module_key=module_key, record_id=record_id, current_user=current_user, payload=payload)


@runtime_router.delete("/{module_key}/records/{record_id}", response_model=CustomModuleRecordResponse)
def delete_custom_module_record(
    module_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    return custom_modules.delete_record(db, module_key=module_key, record_id=record_id, current_user=current_user)


@runtime_router.post("/{module_key}/records/{record_id}/restore", response_model=CustomModuleRecordResponse)
def restore_custom_module_record(
    module_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    return custom_modules.restore_record(db, module_key=module_key, record_id=record_id, current_user=current_user)


@runtime_router.get("/{module_key}/export")
def export_custom_module_records(
    module_key: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    content, filename = custom_modules.export_records(db, module_key=module_key, current_user=current_user)
    return bytes_download_response(content=content, filename=filename, media_type="text/csv")


@runtime_router.post("/{module_key}/import/preview")
async def preview_custom_module_import(
    module_key: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    return custom_modules.preview_import(
        db,
        module_key=module_key,
        current_user=current_user,
        file_bytes=file_bytes,
    )


@runtime_router.post("/{module_key}/import", response_model=ImportExecutionResponse)
async def import_custom_module_records(
    module_key: str,
    file: UploadFile = File(...),
    mapping_json: str | None = Form(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    file_bytes = await read_upload_bytes(file, allowed_extensions={"csv"})
    target_headers = custom_modules.import_target_headers(
        db,
        module_key=module_key,
        current_user=current_user,
    )
    mapping = parse_mapping_json(mapping_json, target_headers=target_headers)
    remapped_bytes = remap_csv_bytes(file_bytes, target_headers=target_headers, mapping=mapping)
    summary = custom_modules.import_records_from_csv_bytes(
        db,
        module_key=module_key,
        current_user=current_user,
        file_bytes=remapped_bytes,
    )
    return ImportExecutionResponse(mode="inline", message=summary["message"], summary=summary)
