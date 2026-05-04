from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.documents.schema import (
    DocumentListResponse,
    DocumentResponse,
    DocumentStorageConnectResponse,
    DocumentStorageConnectionResponse,
    DocumentStorageProviderResponse,
    DocumentStorageUsageResponse,
    DocumentUploadLimitsResponse,
)
from app.modules.documents.services.document_services import (
    create_document,
    disconnect_document_storage_connection,
    get_google_drive_connect_url,
    document_storage_providers,
    document_storage_usage,
    document_upload_limits,
    get_document_or_404,
    list_document_storage_connections,
    list_documents,
    log_document_download,
    require_document_link_access,
    resolve_document_download,
    soft_delete_document,
)


router = APIRouter(prefix="/documents", tags=["Documents"])


@router.get("/limits", response_model=DocumentUploadLimitsResponse)
def get_document_upload_limits(
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    return document_upload_limits()


@router.get("/storage/usage", response_model=DocumentStorageUsageResponse)
def get_document_storage_usage(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    return document_storage_usage(db, tenant_id=current_user.tenant_id)


@router.get("/storage/providers", response_model=list[DocumentStorageProviderResponse])
def get_document_storage_providers(
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "configure")),
):
    return document_storage_providers()


@router.get("/storage/connections", response_model=list[DocumentStorageConnectionResponse])
def get_document_storage_connections(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    return list_document_storage_connections(db, tenant_id=current_user.tenant_id, user_id=current_user.id)


@router.post("/storage/connect/google-drive", response_model=DocumentStorageConnectResponse)
def connect_google_drive_storage(
    request: Request,
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "create")),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return {
        "provider": "google_drive",
        "auth_url": get_google_drive_connect_url(request=request, tenant=tenant, user=current_user),
    }


@router.delete("/storage/connect/google-drive", response_model=DocumentStorageConnectionResponse)
def disconnect_google_drive_storage(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "create")),
):
    return disconnect_document_storage_connection(
        db,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        provider="google_drive",
    )


@router.get("", response_model=DocumentListResponse)
def get_documents(
    search: str | None = Query(default=None, max_length=100),
    module_key: str | None = Query(default=None, max_length=100),
    entity_id: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    documents, total = list_documents(
        db,
        tenant_id=current_user.tenant_id,
        search=search,
        module_key=module_key,
        entity_id=entity_id,
        limit=limit,
        current_user=current_user,
    )
    return {"results": [DocumentResponse.model_validate(document) for document in documents], "total": total}


@router.post("", response_model=DocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    title: str | None = Form(default=None, max_length=255),
    description: str | None = Form(default=None, max_length=1000),
    linked_module_key: str | None = Form(default=None, max_length=100),
    linked_entity_id: str | None = Form(default=None, max_length=100),
    storage_provider: str = Form(default="local", max_length=40),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "create")),
):
    document = await create_document(
        db,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        file=file,
        title=title,
        description=description,
        linked_module_key=linked_module_key,
        linked_entity_id=linked_entity_id,
        storage_provider=storage_provider,
        current_user=current_user,
    )
    return DocumentResponse.model_validate(document)


@router.get("/{document_id}/download")
def download_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    document = get_document_or_404(db, tenant_id=current_user.tenant_id, document_id=document_id)
    require_document_link_access(db, user=current_user, document=document, action="view")
    download = resolve_document_download(db, document=document, current_user=current_user)
    log_document_download(db, document=document, current_user=current_user)
    if download["kind"] == "bytes":
        return Response(
            content=download["content"],
            media_type=document.content_type,
            headers={"Content-Disposition": f'inline; filename="{document.original_filename}"'},
        )
    return FileResponse(
        download["path"],
        media_type=document.content_type,
        filename=document.original_filename,
        content_disposition_type="inline",
    )


@router.delete("/{document_id}", response_model=DocumentResponse)
def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "delete")),
):
    document = soft_delete_document(db, tenant_id=current_user.tenant_id, document_id=document_id, current_user=current_user)
    return DocumentResponse.model_validate(document)
