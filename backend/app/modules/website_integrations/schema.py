from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WebsiteCatalogItemType(str, Enum):
    product = "product"
    service = "service"
    bundle = "bundle"


class WebsiteCatalogStockStatus(str, Enum):
    untracked = "untracked"
    in_stock = "in_stock"
    out_of_stock = "out_of_stock"
    preorder = "preorder"


class WebsiteIntegrationApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(default_factory=lambda: ["catalog:read"])
    allowed_origins: list[str] = Field(default_factory=list)

    @field_validator("scopes", mode="after")
    @classmethod
    def normalize_scopes(cls, value: list[str]) -> list[str]:
        scopes = sorted({item.strip().lower() for item in value if item and item.strip()})
        return scopes or ["catalog:read"]

    @field_validator("allowed_origins", mode="after")
    @classmethod
    def normalize_origins(cls, value: list[str]) -> list[str]:
        return sorted({item.strip().rstrip("/") for item in value if item and item.strip()})


class WebsiteIntegrationApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    scopes: list[str]
    allowed_origins: list[str]
    status: str
    last_used_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    api_key: str | None = None

    model_config = ConfigDict(from_attributes=True)


class WebsiteCatalogItemBase(BaseModel):
    item_type: WebsiteCatalogItemType = WebsiteCatalogItemType.product
    slug: str = Field(min_length=1, max_length=160)
    sku: str | None = Field(default=None, max_length=100)
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    currency: str = Field(default="USD", min_length=3, max_length=3)
    public_unit_price: Decimal = Field(ge=0)
    stock_status: WebsiteCatalogStockStatus = WebsiteCatalogStockStatus.untracked
    stock_quantity: Decimal | None = Field(default=None, ge=0)
    media_url: str | None = Field(default=None, max_length=500)
    metadata: dict[str, Any] | None = None
    is_public: bool = False
    is_active: bool = True

    @field_validator("slug", mode="after")
    @classmethod
    def normalize_slug(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("slug is required")
        return normalized

    @field_validator("sku", mode="after")
    @classmethod
    def strip_optional_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("name", mode="after")
    @classmethod
    def strip_required_string(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized

    @field_validator("currency", mode="after")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str:
        normalized = (value or "USD").strip().upper()
        if len(normalized) != 3:
            raise ValueError("currency must be a 3-letter code")
        return normalized


class WebsiteCatalogItemCreateRequest(WebsiteCatalogItemBase):
    pass


class WebsiteCatalogItemUpdateRequest(BaseModel):
    item_type: WebsiteCatalogItemType | None = None
    slug: str | None = Field(default=None, min_length=1, max_length=160)
    sku: str | None = Field(default=None, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    public_unit_price: Decimal | None = Field(default=None, ge=0)
    stock_status: WebsiteCatalogStockStatus | None = None
    stock_quantity: Decimal | None = Field(default=None, ge=0)
    media_url: str | None = Field(default=None, max_length=500)
    metadata: dict[str, Any] | None = None
    is_public: bool | None = None
    is_active: bool | None = None

    @field_validator("slug", mode="after")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        if not normalized:
            raise ValueError("slug is required")
        return normalized

    @field_validator("sku", mode="after")
    @classmethod
    def strip_optional_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("name", mode="after")
    @classmethod
    def strip_required_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized

    @field_validator("currency", mode="after")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        if len(normalized) != 3:
            raise ValueError("currency must be a 3-letter code")
        return normalized


class WebsiteCatalogItemResponse(BaseModel):
    id: int
    item_type: WebsiteCatalogItemType
    slug: str
    sku: str | None = None
    name: str
    description: str | None = None
    currency: str
    public_unit_price: Decimal
    stock_status: WebsiteCatalogStockStatus
    stock_quantity: Decimal | None = None
    media_url: str | None = None
    metadata: dict[str, Any] | None = None
    is_public: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PublicWebsiteCatalogItemResponse(BaseModel):
    id: int
    item_type: WebsiteCatalogItemType
    slug: str
    sku: str | None = None
    name: str
    description: str | None = None
    currency: str
    public_unit_price: Decimal
    stock_status: WebsiteCatalogStockStatus
    stock_quantity: Decimal | None = None
    media_url: str | None = None
    metadata: dict[str, Any] | None = None
    updated_at: datetime


class PublicWebsiteCatalogListResponse(BaseModel):
    results: list[PublicWebsiteCatalogItemResponse]
    total_count: int
    limit: int
    offset: int


class PublicWebsiteOrderLineRequest(BaseModel):
    catalog_item_id: int | None = None
    catalog_product_id: int | None = None
    catalog_service_id: int | None = None
    item_type: WebsiteCatalogItemType | None = None
    slug: str | None = Field(default=None, max_length=160)
    sku: str | None = Field(default=None, max_length=100)
    quantity: Decimal = Field(gt=0)

    @field_validator("slug", "sku", mode="after")
    @classmethod
    def normalize_lookup(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @model_validator(mode="after")
    def validate_lookup(self):
        if not self.catalog_item_id and not self.catalog_product_id and not self.catalog_service_id and not self.slug and not self.sku:
            raise ValueError("order line requires catalog_product_id, catalog_service_id, catalog_item_id, slug, or sku")
        return self


class PublicWebsiteOrderCreateRequest(BaseModel):
    external_reference: str = Field(min_length=1, max_length=180)
    source_platform: str | None = Field(default=None, max_length=80)
    customer_name: str | None = Field(default=None, max_length=180)
    customer_email: str | None = Field(default=None, max_length=180)
    customer_phone: str | None = Field(default=None, max_length=80)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    line_items: list[PublicWebsiteOrderLineRequest] = Field(min_length=1)
    metadata: dict[str, Any] | None = None

    @field_validator("external_reference", mode="after")
    @classmethod
    def strip_external_reference(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("external_reference is required")
        return normalized

    @field_validator("source_platform", "customer_name", "customer_email", "customer_phone", mode="after")
    @classmethod
    def strip_optional_strings(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("currency", mode="after")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        if len(normalized) != 3:
            raise ValueError("currency must be a 3-letter code")
        return normalized


WebsiteOrderStatus = Literal[
    "submitted",
    "under_review",
    "confirmed",
    "in_progress",
    "completed",
    "cancelled",
    "rejected",
]


class WebsiteOrderStatusUpdateRequest(BaseModel):
    status: WebsiteOrderStatus


class WebsiteOrderLineResponse(BaseModel):
    id: int
    catalog_item_id: int | None = None
    catalog_product_id: int | None = None
    catalog_service_id: int | None = None
    item_type: WebsiteCatalogItemType
    slug: str | None = None
    sku: str | None = None
    name: str
    quantity: Decimal
    currency: str
    unit_price_snapshot: Decimal
    line_total: Decimal
    stock_quantity_before: Decimal | None = None
    stock_quantity_after: Decimal | None = None

    model_config = ConfigDict(from_attributes=True)


class WebsiteOrderResponse(BaseModel):
    id: int
    pos_invoice_id: int | None = None
    external_reference: str
    source_platform: str | None = None
    status: str
    customer_name: str | None = None
    customer_email: str | None = None
    customer_phone: str | None = None
    currency: str
    subtotal_amount: Decimal
    metadata: dict[str, Any] | None = None
    created_at: datetime
    line_items: list[WebsiteOrderLineResponse]
    idempotent_replayed: bool = False

    model_config = ConfigDict(from_attributes=True)
