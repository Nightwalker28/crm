from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DocumentLinkResponse(BaseModel):
    id: int
    module_key: str
    entity_id: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentClientShareResponse(BaseModel):
    id: int
    document_id: int
    contact_id: int | None = None
    organization_id: int | None = None
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    created_by_user_id: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentClientShareRequest(BaseModel):
    contact_id: int | None = None
    organization_id: int | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def require_target(self):
        if self.contact_id is None and self.organization_id is None:
            raise ValueError("contact_id or organization_id is required")
        return self


class DocumentAssociationFailure(BaseModel):
    module_key: str
    entity_id: str
    message: str = "Record could not be linked."


class DocumentResponse(BaseModel):
    id: int
    tenant_id: int | None = None
    title: str
    display_name: str | None = None
    description: str | None = None
    original_filename: str
    content_type: str
    extension: str
    file_size_bytes: int
    storage_provider: str = "local"
    provider_file_id: str | None = None
    provider_parent_id: str | None = None
    provider_account_id: int | None = None
    checksum: str | None = None
    provider_path: str | None = None
    external_web_url: str | None = None
    provider_created_at: datetime | None = None
    uploaded_at: datetime | None = None
    provider_status: str = "available"
    category: str | None = None
    tags: list[str] = Field(default_factory=list)
    is_template: bool = False
    template_category: str | None = None
    current_version_id: int | None = None
    uploaded_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime
    links: list[DocumentLinkResponse] = Field(default_factory=list)
    client_shares: list[DocumentClientShareResponse] = Field(default_factory=list)
    association_failures: list[DocumentAssociationFailure] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class DocumentVersionResponse(BaseModel):
    id: int
    document_id: int
    version_number: int
    file_name: str
    mime_type: str
    size_bytes: int
    checksum: str | None = None
    storage_provider: str = "local"
    provider_file_id: str | None = None
    provider_parent_id: str | None = None
    provider_account_id: int | None = None
    provider_path: str | None = None
    external_web_url: str | None = None
    provider_created_at: datetime | None = None
    provider_status: str = "available"
    uploaded_by_id: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DocumentListResponse(BaseModel):
    results: list[DocumentResponse]
    total: int


class ClientDocumentResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    original_filename: str
    content_type: str
    extension: str
    file_size_bytes: int
    storage_provider: str = "local"
    provider_status: str = "available"
    created_at: datetime
    updated_at: datetime
    share_id: int
    expires_at: datetime | None = None


class ClientDocumentListResponse(BaseModel):
    results: list[ClientDocumentResponse]


class DocumentVersionListResponse(BaseModel):
    results: list[DocumentVersionResponse]


class DocumentTemplateUpdateRequest(BaseModel):
    is_template: bool
    template_category: str | None = None


class DocumentUploadLimitsResponse(BaseModel):
    allowed_extensions: list[str]
    max_upload_bytes: int
    tenant_storage_limit_bytes: int


class DocumentViewResponse(BaseModel):
    kind: str
    url: str
    provider_status: str


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
