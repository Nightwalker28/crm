from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin
from app.modules.platform.schema import (
    TenantRestoreExecuteRequest,
    TenantRestoreExecuteResponse,
    TenantRestorePreviewRequest,
    TenantRestorePreviewResponse,
    TenantRestoreRunResponse,
    TenantWholeRestoreExecuteRequest,
    TenantWholeRestorePreviewRequest,
)
from app.modules.platform.services.tenant_restore_runs import (
    execute_tenant_module_restore,
    execute_whole_tenant_restore,
    preview_tenant_module_restore,
    preview_whole_tenant_restore,
)


router = APIRouter(prefix="/admin/tenant-restore-runs", tags=["Tenant Restore Runs"])


@router.post("/preview", response_model=TenantRestorePreviewResponse)
def preview_restore(payload: TenantRestorePreviewRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    result = preview_tenant_module_restore(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        source_backup_run_id=payload.source_backup_run_id,
        module_key=payload.module_key,
    )
    return {
        "run": TenantRestoreRunResponse.model_validate(result["run"]),
        "metadata": result["metadata"],
        "summary": result["summary"],
    }


@router.post("/execute", response_model=TenantRestoreExecuteResponse)
def execute_restore(payload: TenantRestoreExecuteRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    run = execute_tenant_module_restore(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        source_backup_run_id=payload.source_backup_run_id,
        module_key=payload.module_key,
        mode=payload.mode,
        confirmation=payload.confirmation,
    )
    message = "Tenant module restore completed." if run.status == "completed" else "Tenant module restore failed."
    return {
        "run": TenantRestoreRunResponse.model_validate(run),
        "message": message,
    }


@router.post("/whole/preview", response_model=TenantRestorePreviewResponse)
def preview_whole_restore(payload: TenantWholeRestorePreviewRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    result = preview_whole_tenant_restore(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        source_backup_run_id=payload.source_backup_run_id,
    )
    return {
        "run": TenantRestoreRunResponse.model_validate(result["run"]),
        "metadata": result["metadata"],
        "summary": result["summary"],
    }


@router.post("/whole/execute", response_model=TenantRestoreExecuteResponse)
def execute_whole_restore(payload: TenantWholeRestoreExecuteRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    run = execute_whole_tenant_restore(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        source_backup_run_id=payload.source_backup_run_id,
        confirmation=payload.confirmation,
    )
    message = "Whole-tenant restore completed." if run.status == "completed" else "Whole-tenant restore failed."
    return {
        "run": TenantRestoreRunResponse.model_validate(run),
        "message": message,
    }
