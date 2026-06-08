from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin
from app.modules.documents.services.document_services import get_google_drive_connect_url, get_microsoft_onedrive_connect_url
from app.modules.platform.schema import (
    TenantBackupDestinationConnectResponse,
    TenantBackupDestinationConnectionResponse,
    TenantBackupSettingsResponse,
    TenantBackupSettingsUpdateRequest,
)
from app.modules.platform.services.tenant_backup_settings import (
    get_or_create_tenant_backup_settings,
    list_tenant_backup_destination_connections,
    serialize_tenant_backup_settings,
    update_tenant_backup_settings,
)


router = APIRouter(prefix="/admin/tenant-backup-settings", tags=["Tenant Backup Settings"])


@router.get("", response_model=TenantBackupSettingsResponse)
def get_settings(db: Session = Depends(get_db), admin=Depends(require_admin)):
    settings = get_or_create_tenant_backup_settings(db, tenant_id=admin.tenant_id, actor_user_id=admin.id)
    return TenantBackupSettingsResponse.model_validate(serialize_tenant_backup_settings(settings))


@router.get("/destinations/connections", response_model=list[TenantBackupDestinationConnectionResponse])
def get_destination_connections(db: Session = Depends(get_db), admin=Depends(require_admin)):
    return list_tenant_backup_destination_connections(db, tenant_id=admin.tenant_id, actor_user_id=admin.id)


@router.post("/destinations/connect/google-drive", response_model=TenantBackupDestinationConnectResponse)
def connect_google_drive_destination(request: Request, admin=Depends(require_admin)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return {
        "destination": "google_drive",
        "provider": "google_drive",
        "auth_url": get_google_drive_connect_url(
            request=request,
            tenant=tenant,
            user=admin,
            return_path="/dashboard/settings/backups",
        ),
    }


@router.post("/destinations/connect/microsoft-onedrive", response_model=TenantBackupDestinationConnectResponse)
def connect_onedrive_destination(request: Request, admin=Depends(require_admin)):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return {
        "destination": "onedrive",
        "provider": "microsoft_onedrive",
        "auth_url": get_microsoft_onedrive_connect_url(
            request=request,
            tenant=tenant,
            user=admin,
            return_path="/dashboard/settings/backups",
        ),
    }


@router.put("", response_model=TenantBackupSettingsResponse)
def update_settings(payload: TenantBackupSettingsUpdateRequest, db: Session = Depends(get_db), admin=Depends(require_admin)):
    settings = update_tenant_backup_settings(
        db,
        tenant_id=admin.tenant_id,
        actor_user_id=admin.id,
        payload=payload.model_dump(exclude_unset=True),
    )
    return TenantBackupSettingsResponse.model_validate(serialize_tenant_backup_settings(settings))
