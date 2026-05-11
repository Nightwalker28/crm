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
    description: str | None = None
    sku: str | None = Field(default=None, max_length=100)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    public_unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    stock_status: CatalogProductStockStatus = CatalogProductStockStatus.untracked
    stock_quantity: Decimal | None = Field(default=None, ge=0)
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
    description: str | None = None
    sku: str | None = Field(default=None, max_length=100)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    public_unit_price: Decimal | None = Field(default=None, ge=0)
    stock_status: CatalogProductStockStatus | None = None
    stock_quantity: Decimal | None = Field(default=None, ge=0)
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
    description: str | None = None
    sku: str | None = None
    currency: str
    public_unit_price: Decimal
    stock_status: CatalogProductStockStatus
    stock_quantity: Decimal | None = None
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
    description: str | None = None
    currency: str = Field(default="USD", min_length=3, max_length=3)
    public_unit_price: Decimal = Field(default=Decimal("0"), ge=0)
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


class CatalogServiceCreateRequest(CatalogServiceBase):
    pass


class CatalogServiceUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    public_unit_price: Decimal | None = Field(default=None, ge=0)
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


class CatalogServiceResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    currency: str
    public_unit_price: Decimal
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
