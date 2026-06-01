from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_admin
from app.modules.platform.schema import (
    IntegrationConnectionListResponse,
    IntegrationConnectionResponse,
    IntegrationHealthListResponse,
    IntegrationHealthResponse,
    IntegrationProviderListResponse,
    IntegrationProviderResponse,
    IntegrationSyncRunListResponse,
    IntegrationSyncRunResponse,
)
from app.modules.platform.services.integrations_registry import (
    list_integration_connections,
    list_integration_health,
    list_provider_registry,
    list_sync_runs,
    seed_provider_registry,
    serialize_sync_run,
)


router = APIRouter(prefix="/admin/integrations-registry", tags=["Integrations Registry"])


@router.get("/providers", response_model=IntegrationProviderListResponse)
def list_providers(db: Session = Depends(get_db), admin=Depends(require_admin)):
    seed_provider_registry(db)
    return {"results": [IntegrationProviderResponse.model_validate(provider) for provider in list_provider_registry(db)]}


@router.get("/connections", response_model=IntegrationConnectionListResponse)
def list_connections(db: Session = Depends(get_db), admin=Depends(require_admin)):
    return {"results": [IntegrationConnectionResponse.model_validate(connection) for connection in list_integration_connections(db, tenant_id=admin.tenant_id)]}


@router.get("/health", response_model=IntegrationHealthListResponse)
def get_health(db: Session = Depends(get_db), admin=Depends(require_admin)):
    return {
        "results": [
            IntegrationHealthResponse(
                provider=IntegrationProviderResponse.model_validate(item["provider"]),
                connection=IntegrationConnectionResponse.model_validate(item["connection"]),
            )
            for item in list_integration_health(db, tenant_id=admin.tenant_id)
        ]
    }


@router.get("/sync-runs", response_model=IntegrationSyncRunListResponse)
def get_sync_runs(
    provider_key: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    admin=Depends(require_admin),
):
    runs = list_sync_runs(db, tenant_id=admin.tenant_id, provider_key=provider_key, limit=limit)
    return {"results": [IntegrationSyncRunResponse.model_validate(serialize_sync_run(run)) for run in runs]}
