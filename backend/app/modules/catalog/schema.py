from datetime import datetime
from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CatalogProductStockStatus(str, Enum):
    untracked = "untracked"
    in_stock = "in_stock"
    out_of_stock = "out_of_stock"
    preorder = "preorder"


class CatalogProductBase(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    slug: str | None = Field(default=None, max_length=160)
    description: str | None = None
    sku: str | None = Field(default=None, max_length=100)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    public_unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    stock_status: CatalogProductStockStatus = CatalogProductStockStatus.untracked
    stock_quantity: Decimal | None = Field(default=None, ge=0)
    track_inventory: bool | None = None
    category_id: int | None = Field(default=None, gt=0)
    cost_price: Decimal | None = Field(default=None, ge=0)
    unit: str = Field(default="unit", min_length=1, max_length=40)
    barcode: str | None = Field(default=None, max_length=100)
    is_public: bool = False
    is_active: bool = True

    @field_validator("name", mode="after")
    @classmethod
    def strip_required_string(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized

    @field_validator("sku", mode="after")
    @classmethod
    def strip_optional_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("slug", mode="after")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        return normalized or None

    @field_validator("currency", mode="after")
    @classmethod
    def normalize_currency(cls, value: str | None) -> str:
        normalized = (value or "USD").strip().upper()
        if len(normalized) != 3:
            raise ValueError("currency must be a 3-letter code")
        return normalized


class CatalogProductCreateRequest(CatalogProductBase):
    pass


class CatalogProductUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    slug: str | None = Field(default=None, max_length=160)
    description: str | None = None
    sku: str | None = Field(default=None, max_length=100)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    public_unit_price: Decimal | None = Field(default=None, ge=0)
    stock_status: CatalogProductStockStatus | None = None
    stock_quantity: Decimal | None = Field(default=None, ge=0)
    track_inventory: bool | None = None
    category_id: int | None = Field(default=None, gt=0)
    cost_price: Decimal | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, min_length=1, max_length=40)
    barcode: str | None = Field(default=None, max_length=100)
    is_public: bool | None = None
    is_active: bool | None = None

    @field_validator("name", mode="after")
    @classmethod
    def strip_required_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized

    @field_validator("sku", mode="after")
    @classmethod
    def strip_optional_string(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("slug", mode="after")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
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


class CatalogProductResponse(BaseModel):
    id: int
    name: str
    slug: str | None = None
    description: str | None = None
    sku: str | None = None
    currency: str
    public_unit_price: Decimal
    stock_status: CatalogProductStockStatus
    stock_quantity: Decimal | None = None
    track_inventory: bool = False
    category_id: int | None = None
    category_name: str | None = None
    cost_price: Decimal | None = None
    unit: str = "unit"
    barcode: str | None = None
    is_public: bool
    is_active: bool
    media_url: str | None = None
    media_content_type: str | None = None
    media_original_filename: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CatalogProductListResponse(BaseModel):
    results: list[CatalogProductResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int


class CatalogServiceBase(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    slug: str | None = Field(default=None, max_length=160)
    description: str | None = None
    sku: str | None = Field(default=None, max_length=100)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    public_unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    category_id: int | None = Field(default=None, gt=0)
    cost_price: Decimal | None = Field(default=None, ge=0)
    unit: str = Field(default="unit", min_length=1, max_length=40)
    is_public: bool = False
    is_active: bool = True

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

    @field_validator("slug", mode="after")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        return normalized or None


class CatalogServiceCreateRequest(CatalogServiceBase):
    pass


class CatalogServiceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    slug: str | None = Field(default=None, max_length=160)
    description: str | None = None
    sku: str | None = Field(default=None, max_length=100)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    public_unit_price: Decimal | None = Field(default=None, ge=0)
    category_id: int | None = Field(default=None, gt=0)
    cost_price: Decimal | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, min_length=1, max_length=40)
    is_public: bool | None = None
    is_active: bool | None = None

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

    @field_validator("slug", mode="after")
    @classmethod
    def normalize_slug(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().lower()
        return normalized or None


class CatalogServiceResponse(BaseModel):
    id: int
    name: str
    slug: str | None = None
    description: str | None = None
    sku: str | None = None
    currency: str
    public_unit_price: Decimal
    category_id: int | None = None
    category_name: str | None = None
    cost_price: Decimal | None = None
    unit: str = "unit"
    is_public: bool
    is_active: bool
    media_url: str | None = None
    media_content_type: str | None = None
    media_original_filename: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CatalogServiceListResponse(BaseModel):
    results: list[CatalogServiceResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int


class CatalogCategoryRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: int | None = Field(default=None, gt=0)
    description: str | None = Field(default=None, max_length=2000)
    sort_order: int = Field(default=0, ge=0, le=100000)

    @field_validator("name", mode="after")
    @classmethod
    def strip_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("name is required")
        return normalized


class CatalogCategoryResponse(BaseModel):
    id: int
    name: str
    full_name: str
    parent_id: int | None = None
    description: str | None = None
    sort_order: int
    product_count: int = 0
    service_count: int = 0
    created_at: datetime
    updated_at: datetime


class CatalogCategoryListResponse(BaseModel):
    results: list[CatalogCategoryResponse]


class CatalogItemKind(str, Enum):
    product = "product"
    service = "service"


class CatalogItemOption(BaseModel):
    """One row of the line-item picker: a product or a service, ready to fill a line."""

    kind: CatalogItemKind
    id: int
    name: str
    description: str | None = None
    sku: str | None = None
    barcode: str | None = None
    unit: str
    currency: str
    unit_price: Decimal
    category_name: str | None = None


class CatalogItemSearchResponse(BaseModel):
    results: list[CatalogItemOption]


class CatalogItemSalesLine(BaseModel):
    """A quote or order line that uses a catalog item (the record's *Sales* tab)."""

    document_type: str
    document_id: int
    document_number: str
    customer_name: str | None = None
    status: str
    currency: str
    quantity: Decimal
    unit_price: Decimal
    line_total: Decimal
    document_date: datetime | None = None


class CatalogItemSalesResponse(BaseModel):
    results: list[CatalogItemSalesLine]
    quote_line_count: int
    order_line_count: int
    ordered_quantity: Decimal
    can_view_quotes: bool
    can_view_orders: bool
