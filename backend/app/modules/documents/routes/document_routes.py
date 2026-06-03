from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.core.cursor_pagination import CursorPagination, build_cursor_response, get_cursor_pagination
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
    DocumentTemplateUpdateRequest,
    DocumentUploadLimitsResponse,
    DocumentVersionListResponse,
    DocumentVersionResponse,
)
from app.modules.documents.services.document_services import (
    create_document,
    disconnect_document_storage_connection,
    get_google_drive_connect_url,
    get_microsoft_onedrive_connect_url,
    document_storage_providers,
    document_storage_usage,
    document_upload_limits,
    get_document_version_or_404,
    get_document_or_404,
    list_document_templates,
    list_document_storage_connections,
    list_document_versions,
    list_documents,
    list_documents_cursor,
    log_document_download,
    require_document_link_access,
    resolve_document_download,
    resolve_document_version_download,
    soft_delete_document,
    update_document_template_status,
    upload_document_version,
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


@router.post("/storage/connect/microsoft-onedrive", response_model=DocumentStorageConnectResponse)
def connect_microsoft_onedrive_storage(
    request: Request,
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "create")),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return {
        "provider": "microsoft_onedrive",
        "auth_url": get_microsoft_onedrive_connect_url(request=request, tenant=tenant, user=current_user),
    }


@router.delete("/storage/connect/microsoft-onedrive", response_model=DocumentStorageConnectionResponse)
def disconnect_microsoft_onedrive_storage(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "create")),
):
    return disconnect_document_storage_connection(
        db,
        tenant_id=current_user.tenant_id,
        user_id=current_user.id,
        provider="microsoft_onedrive",
    )


@router.get("", response_model=DocumentListResponse)
def get_documents(
    search: str | None = Query(default=None, max_length=100),
    module_key: str | None = Query(default=None, max_length=100),
    entity_id: str | None = Query(default=None, max_length=100),
    is_template: bool | None = Query(default=None),
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
        is_template=is_template,
        limit=limit,
        current_user=current_user,
    )
    return {"results": [DocumentResponse.model_validate(document) for document in documents], "total": total}


@router.get("/cursor")
def get_documents_cursor(
    search: str | None = Query(default=None, max_length=100),
    module_key: str | None = Query(default=None, max_length=100),
    entity_id: str | None = Query(default=None, max_length=100),
    is_template: bool | None = Query(default=None),
    pagination: CursorPagination = Depends(get_cursor_pagination),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    documents = list_documents_cursor(
        db,
        tenant_id=current_user.tenant_id,
        search=search,
        module_key=module_key,
        entity_id=entity_id,
        is_template=is_template,
        limit=pagination.limit,
        cursor=pagination.cursor,
        current_user=current_user,
    )
    serialized = [DocumentResponse.model_validate(document) for document in documents]
    return build_cursor_response(serialized, limit=pagination.limit, id_attr="id")


@router.get("/templates", response_model=DocumentListResponse)
def get_document_templates(
    search: str | None = Query(default=None, max_length=100),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    documents, total = list_document_templates(
        db,
        tenant_id=current_user.tenant_id,
        search=search,
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


@router.get("/{document_id}/versions", response_model=DocumentVersionListResponse)
def get_document_versions(
    document_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    document = get_document_or_404(db, tenant_id=current_user.tenant_id, document_id=document_id)
    require_document_link_access(db, user=current_user, document=document, action="view")
    return {"results": [DocumentVersionResponse.model_validate(version) for version in list_document_versions(db, document=document)]}


@router.post("/{document_id}/versions", response_model=DocumentResponse)
async def upload_new_document_version(
    document_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "edit")),
):
    document = await upload_document_version(
        db,
        tenant_id=current_user.tenant_id,
        document_id=document_id,
        file=file,
        current_user=current_user,
    )
    return DocumentResponse.model_validate(document)


@router.get("/{document_id}/versions/{version_id}/download")
def download_document_version(
    document_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "view")),
):
    document = get_document_or_404(db, tenant_id=current_user.tenant_id, document_id=document_id)
    require_document_link_access(db, user=current_user, document=document, action="view")
    version = get_document_version_or_404(db, tenant_id=current_user.tenant_id, document_id=document_id, version_id=version_id)
    download = resolve_document_version_download(db, document=document, version=version, current_user=current_user)
    log_document_download(db, document=document, current_user=current_user)
    if download["kind"] == "bytes":
        return Response(
            content=download["content"],
            media_type=version.mime_type,
            headers={"Content-Disposition": f'inline; filename="{version.file_name}"'},
        )
    return FileResponse(
        download["path"],
        media_type=version.mime_type,
        filename=version.file_name,
        content_disposition_type="inline",
    )


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


@router.patch("/{document_id}/template", response_model=DocumentResponse)
def update_document_template(
    document_id: int,
    payload: DocumentTemplateUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("documents")),
    require_permission=Depends(require_action_access("documents", "edit")),
):
    document = update_document_template_status(
        db,
        tenant_id=current_user.tenant_id,
        document_id=document_id,
        is_template=payload.is_template,
        template_category=payload.template_category,
        current_user=current_user,
    )
    return DocumentResponse.model_validate(document)


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
