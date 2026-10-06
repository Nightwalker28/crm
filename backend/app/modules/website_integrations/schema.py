from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class WebsiteCatalogItemType(str, Enum):
    product = "product"
    service = "service"


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


class PublicWebsiteCatalogItemResponse(BaseModel):
    id: int
    item_type: WebsiteCatalogItemType
    catalog_product_id: int | None = None
    catalog_service_id: int | None = None
    slug: str
    sku: str | None = None
    name: str
    description: str | None = None
    currency: str
    public_unit_price: Decimal
    stock_status: WebsiteCatalogStockStatus
    stock_quantity: Decimal | None = None
    media_url: str | None = None
    updated_at: datetime


class PublicWebsiteCatalogListResponse(BaseModel):
    results: list[PublicWebsiteCatalogItemResponse]
    total_count: int
    limit: int
    offset: int


class PublicWebsiteOrderLineRequest(BaseModel):
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
        if not self.catalog_product_id and not self.catalog_service_id and not self.slug and not self.sku:
            raise ValueError("order line requires catalog_product_id, catalog_service_id, slug, or sku")
        return self


class PublicWebsiteOrderCreateRequest(BaseModel):
    external_reference: str = Field(min_length=1, max_length=180)
    source_platform: str | None = Field(default=None, max_length=80)
    customer_name: str | None = Field(default=None, max_length=180)
    customer_email: str | None = Field(default=None, max_length=180)
    customer_phone: str | None = Field(default=None, max_length=80)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    delivery_address: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=4000)
    line_items: list[PublicWebsiteOrderLineRequest] = Field(min_length=1)

    @field_validator("external_reference", mode="after")
    @classmethod
    def strip_external_reference(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("external_reference is required")
        return normalized

    @field_validator("source_platform", "customer_name", "customer_email", "customer_phone", "delivery_address", "notes", mode="after")
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


class WebsiteOrderLineResponse(BaseModel):
    id: int
    catalog_product_id: int | None = None
    catalog_service_id: int | None = None
    name: str
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal


class WebsiteOrderResponse(BaseModel):
    """The sales order a website order became."""

    id: int
    order_number: str
    external_reference: str
    channel: str | None = None
    status: str
    currency: str
    grand_total: Decimal
    created_at: datetime
    line_items: list[WebsiteOrderLineResponse]
    idempotent_replayed: bool = False
