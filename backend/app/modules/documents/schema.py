from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DocumentLinkResponse(BaseModel):
    id: int
    module_key: str
    entity_id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    original_filename: str
    content_type: str
    extension: str
    file_size_bytes: int
    storage_provider: str = "local"
    is_template: bool = False
    template_category: str | None = None
    current_version_id: int | None = None
    uploaded_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime
    links: list[DocumentLinkResponse] = []

    model_config = ConfigDict(from_attributes=True)


class DocumentVersionResponse(BaseModel):
    id: int
    document_id: int
    version_number: int
    file_name: str
    mime_type: str
    size_bytes: int
    checksum: str | None = None
    uploaded_by_id: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentListResponse(BaseModel):
    results: list[DocumentResponse]
    total: int


class DocumentVersionListResponse(BaseModel):
    results: list[DocumentVersionResponse]


class DocumentTemplateUpdateRequest(BaseModel):
    is_template: bool
    template_category: str | None = None


class DocumentUploadLimitsResponse(BaseModel):
    allowed_extensions: list[str]
    max_upload_bytes: int
    tenant_storage_limit_bytes: int


class DocumentStorageUsageResponse(BaseModel):
    used_bytes: int
    tenant_storage_limit_bytes: int
    remaining_bytes: int
    usage_percent: float


class DocumentStorageProviderResponse(BaseModel):
    provider: str
    label: str
    status: str
    requires_oauth: bool


class DocumentStorageConnectionResponse(BaseModel):
    provider: str
    status: str
    account_email: str | None = None
    provider_root_id: str | None = None
    provider_root_name: str | None = None
    last_error: str | None = None
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentStorageConnectResponse(BaseModel):
    provider: str
    auth_url: str
