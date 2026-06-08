from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.pagination import Pagination, build_paged_response, get_pagination
from app.core.security import require_admin
from app.modules.platform.schema import (
    TenantBackupRunCreateResponse,
    TenantBackupRunDeleteResponse,
    TenantBackupRunListResponse,
    TenantBackupRunResponse,
)
from app.modules.platform.services.tenant_backup_runs import (
    create_manual_tenant_backup_run,
    delete_tenant_backup_artifact,
    get_tenant_backup_artifact_path,
    get_tenant_backup_run_or_404,
    list_tenant_backup_runs,
    serialize_tenant_backup_run,
)
from app.modules.platform.services.activity_logs import safe_log_activity


router = APIRouter(prefix="/admin/tenant-backup-runs", tags=["Tenant Backup Runs"])


@router.get("", response_model=TenantBackupRunListResponse)
def get_runs(pagination: Pagination = Depends(get_pagination), db: Session = Depends(get_db), admin=Depends(require_admin)):
    runs, total = list_tenant_backup_runs(db, tenant_id=admin.tenant_id, pagination=pagination)
    serialized = [TenantBackupRunResponse.model_validate(serialize_tenant_backup_run(run)) for run in runs]
    return build_paged_response(serialized, total_count=total, pagination=pagination)


@router.post("/manual", response_model=TenantBackupRunCreateResponse)
def create_manual_run(db: Session = Depends(get_db), admin=Depends(require_admin)):
    run = create_manual_tenant_backup_run(db, tenant_id=admin.tenant_id, actor_user_id=admin.id)
    message = "Tenant backup completed." if run.status == "completed" else "Tenant backup failed."
    return {
        "run": TenantBackupRunResponse.model_validate(serialize_tenant_backup_run(run)),
        "message": message,
    }


@router.get("/{run_id}", response_model=TenantBackupRunResponse)
def get_run(run_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    run = get_tenant_backup_run_or_404(db, tenant_id=admin.tenant_id, run_id=run_id)
    return TenantBackupRunResponse.model_validate(serialize_tenant_backup_run(run))


@router.get("/{run_id}/download")
def download_run(run_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    run = get_tenant_backup_run_or_404(db, tenant_id=admin.tenant_id, run_id=run_id)
    path = get_tenant_backup_artifact_path(run)
    safe_log_activity(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        module_key="tenant_backups",
        entity_type="tenant_backup_run",
        entity_id=run.id,
        action="backup.downloaded",
        description=f"Downloaded tenant backup run #{run.id}",
        after_state={"run_id": run.id, "backup_type": "tenant", "storage_ref": run.storage_ref},
    )
    return FileResponse(
        path,
        media_type="application/zip",
        filename=path.name,
    )


@router.delete("/{run_id}", response_model=TenantBackupRunDeleteResponse)
def delete_run(run_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    run = delete_tenant_backup_artifact(db, tenant_id=admin.tenant_id, actor_user_id=admin.id, run_id=run_id)
    return {
        "run": TenantBackupRunResponse.model_validate(serialize_tenant_backup_run(run)),
        "message": "Tenant backup artifact deleted.",
    }
