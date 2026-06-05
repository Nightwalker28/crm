from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_user
from app.modules.platform.schema import DataTransferJobListResponse, DataTransferJobResponse
from app.modules.platform.services.data_transfer_jobs import (
    data_transfer_download_action,
    get_data_transfer_job_or_404,
    get_job_result_path,
    list_data_transfer_jobs,
    list_data_transfer_jobs_cursor,
    require_data_transfer_job_access,
    require_data_transfer_module_access,
)

router = APIRouter(prefix="/jobs/data-transfer", tags=["Data Transfer Jobs"])


@router.get("", response_model=DataTransferJobListResponse)
def get_data_transfer_jobs(
    module_key: str | None = Query(default=None),
    operation_type: str | None = Query(default=None),
    pagination: Pagination = Depends(get_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    if module_key:
        require_data_transfer_module_access(db, current_user=current_user, module_key=module_key, action="view")
    items, total = list_data_transfer_jobs(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        pagination=pagination,
        module_key=module_key,
        operation_type=operation_type,
    )
    serialized = [DataTransferJobResponse.model_validate(item) for item in items]
    return build_paged_response(serialized, total_count=total, pagination=pagination)


@router.get("/cursor", response_model=dict)
def get_data_transfer_jobs_cursor(
    module_key: str | None = Query(default=None),
    operation_type: str | None = Query(default=None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    if module_key:
        require_data_transfer_module_access(db, current_user=current_user, module_key=module_key, action="view")
    items = list_data_transfer_jobs_cursor(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
        limit=pagination.limit,
        cursor=pagination.cursor,
        module_key=module_key,
        operation_type=operation_type,
    )
    serialized = [DataTransferJobResponse.model_validate(item).model_dump(mode="json") for item in items]
    return build_cursor_response(serialized, limit=pagination.limit, id_attr="id")


@router.get("/{job_id}", response_model=DataTransferJobResponse)
def get_data_transfer_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    job = get_data_transfer_job_or_404(
        db,
        job_id=job_id,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
    )
    require_data_transfer_job_access(db, current_user=current_user, job=job, action="view")
    return DataTransferJobResponse.model_validate(job)


@router.get("/{job_id}/download")
def download_data_transfer_job_result(
    job_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
):
    job = get_data_transfer_job_or_404(
        db,
        job_id=job_id,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id if current_user else None,
    )
    require_data_transfer_job_access(
        db,
        current_user=current_user,
        job=job,
        action=data_transfer_download_action(job),
    )
    path = get_job_result_path(job)
    return FileResponse(
        path,
        media_type=job.result_media_type or "application/octet-stream",
        filename=job.result_file_name or path.name,
    )
