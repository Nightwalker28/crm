from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class CustomerGroupCreateRequest(BaseModel):
    group_key: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    discount_type: str = Field(default="none", max_length=20)
    discount_value: Decimal | None = None
    is_default: bool = False
    is_active: bool = True


class CustomerGroupUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    discount_type: str | None = Field(default=None, max_length=20)
    discount_value: Decimal | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class CustomerGroupResponse(BaseModel):
    id: int
    group_key: str
    name: str
    description: str | None = None
    discount_type: str
    discount_value: Decimal | None = None
    is_default: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomerGroupAssignmentRequest(BaseModel):
    customer_group_id: int | None = None


class ClientAccountCreateRequest(BaseModel):
    email: EmailStr
    contact_id: int | None = None
    organization_id: int | None = None
    status: str = Field(default="pending", max_length=20)

    @model_validator(mode="after")
    def validate_link(self):
        if bool(self.contact_id) == bool(self.organization_id):
            raise ValueError("Link the client account to exactly one contact or organization")
        return self


class ClientAccountStatusRequest(BaseModel):
    status: str = Field(max_length=20)


class ClientAccountResponse(BaseModel):
    id: int
    email: EmailStr
    status: str
    contact_id: int | None = None
    organization_id: int | None = None
    contact_name: str | None = None
    organization_name: str | None = None
    has_password: bool
    setup_link: str | None = None
    setup_token_expires_at: datetime | None = None
    last_login_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ClientSetupPasswordRequest(BaseModel):
    token: str = Field(min_length=16)
    password: str = Field(min_length=1)


class ClientLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class ClientLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    account: ClientAccountResponse


class ClientMeResponse(BaseModel):
    id: int
    email: EmailStr
    tenant_id: int
    contact_id: int | None = None
    organization_id: int | None = None
    customer_group: CustomerGroupResponse | None = None


class ClientPagePricingItemRequest(BaseModel):
    sku: str | None = Field(default=None, max_length=80)
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    public_unit_price: Decimal = Field(ge=0)


class ClientPageProposalSectionRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    body: str = Field(min_length=1, max_length=4000)
    sort_order: int = Field(default=0, ge=0, le=1000)


class ClientPageBrandSettingsRequest(BaseModel):
    company_name: str | None = Field(default=None, max_length=150)
    logo_url: str | None = Field(default=None, max_length=500)
    accent_color: str | None = Field(default=None, max_length=20)


class ClientPageCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    summary: str | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    pricing_items: list[ClientPagePricingItemRequest] = Field(default_factory=list)
    document_ids: list[int] = Field(default_factory=list)
    proposal_sections: list[ClientPageProposalSectionRequest] = Field(default_factory=list)
    brand_settings: ClientPageBrandSettingsRequest | None = None
    source_module_key: str | None = Field(default=None, max_length=100)
    source_entity_id: str | None = Field(default=None, max_length=100)
    status: str = Field(default="draft", max_length=20)

    @model_validator(mode="after")
    def validate_link(self):
        if bool(self.contact_id) == bool(self.organization_id):
            raise ValueError("Link the client page to exactly one contact or organization")
        return self


class ClientPageUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=180)
    summary: str | None = None
    pricing_items: list[ClientPagePricingItemRequest] | None = None
    document_ids: list[int] | None = None
    proposal_sections: list[ClientPageProposalSectionRequest] | None = None
    brand_settings: ClientPageBrandSettingsRequest | None = None
    source_module_key: str | None = Field(default=None, max_length=100)
    source_entity_id: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, max_length=20)


class ClientPagePublishRequest(BaseModel):
    expires_in_days: int = Field(default=30, ge=1, le=365)


class ClientPageActionRequest(BaseModel):
    message: str | None = Field(default=None, max_length=4000)
    actor_name: str | None = Field(default=None, max_length=150)
    actor_email: EmailStr | None = None


class ClientPagePricingItemResponse(BaseModel):
    sku: str | None = None
    name: str
    description: str | None = None
    quantity: Decimal
    currency: str
    public_unit_price: Decimal
    resolved_unit_price: Decimal
    public_total: Decimal
    resolved_total: Decimal
    discount_type: str = "none"
    discount_value: Decimal | None = None


class ClientPageProposalSectionResponse(BaseModel):
    title: str
    body: str
    sort_order: int = 0


class ClientPageBrandSettingsResponse(BaseModel):
    company_name: str | None = None
    logo_url: str | None = None
    accent_color: str | None = None


class ClientPageDocumentResponse(BaseModel):
    id: int
    title: str
    original_filename: str
    content_type: str
    extension: str
    file_size_bytes: int


class ClientPageActionSummaryResponse(BaseModel):
    id: int
    action: str
    message: str | None = None
    actor_name: str | None = None
    actor_email: str | None = None
    client_account_id: int | None = None
    created_at: datetime


class ClientPageResponse(BaseModel):
    id: int
    title: str
    summary: str | None = None
    status: str
    contact_id: int | None = None
    organization_id: int | None = None
    contact_name: str | None = None
    organization_name: str | None = None
    source_module_key: str | None = None
    source_entity_id: str | None = None
    document_ids: list[int] = Field(default_factory=list)
    documents: list[ClientPageDocumentResponse] = Field(default_factory=list)
    proposal_sections: list[ClientPageProposalSectionResponse] = Field(default_factory=list)
    brand_settings: ClientPageBrandSettingsResponse | None = None
    pricing_items: list[ClientPagePricingItemResponse] = Field(default_factory=list)
    customer_group: CustomerGroupResponse | None = None
    pricing_mode: str
    action_count: int = 0
    latest_action: ClientPageActionSummaryResponse | None = None
    recent_actions: list[ClientPageActionSummaryResponse] = Field(default_factory=list)
    public_link: str | None = None
    public_token_expires_at: datetime | None = None
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ClientPagePublicResponse(BaseModel):
    title: str
    summary: str | None = None
    pricing_items: list[ClientPagePricingItemResponse] = Field(default_factory=list)
    customer_group: CustomerGroupResponse | None = None
    pricing_mode: str
    document_ids: list[int] = Field(default_factory=list)
    documents: list[ClientPageDocumentResponse] = Field(default_factory=list)
    proposal_sections: list[ClientPageProposalSectionResponse] = Field(default_factory=list)
    brand_settings: ClientPageBrandSettingsResponse | None = None


class ClientPageActionResponse(BaseModel):
    id: int
    action: str
    created_at: datetime
