from typing import Any, Optional
from pydantic import BaseModel, ConfigDict, Field


class InsertionOrderImportResponse(BaseModel):
    message: str
    inserted: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = Field(default_factory=list)
    duplicate_io_numbers: list[str] | None = None
    requires_confirmation: bool = False


class InsertionOrderBase(BaseModel):
    io_number: Optional[str] = None
    customer_name: str = Field(min_length=1)
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    create_customer_if_missing: bool = False
    customer_email: Optional[str] = None
    counterparty_reference: Optional[str] = None
    external_reference: Optional[str] = None
    issue_date: Optional[str] = None
    effective_date: Optional[str] = None
    due_date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: str = "draft"
    currency: str = "USD"
    subtotal_amount: Optional[float] = None
    tax_amount: Optional[float] = None
    total_amount: Optional[float] = None
    notes: Optional[str] = None
    custom_fields: dict[str, Any] | None = None


class InsertionOrderCreateRequest(InsertionOrderBase):
    pass


class InsertionOrderUpdateRequest(BaseModel):
    customer_name: Optional[str] = Field(default=None, min_length=1)
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    create_customer_if_missing: bool = False
    customer_email: Optional[str] = None
    counterparty_reference: Optional[str] = None
    external_reference: Optional[str] = None
    issue_date: Optional[str] = None
    effective_date: Optional[str] = None
    due_date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None
    currency: Optional[str] = None
    subtotal_amount: Optional[float] = None
    tax_amount: Optional[float] = None
    total_amount: Optional[float] = None
    notes: Optional[str] = None
    custom_fields: dict[str, Any] | None = None


class InsertionOrderResponse(BaseModel):
    id: int
    io_number: str
    customer_name: str
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    counterparty_reference: Optional[str] = None
    external_reference: Optional[str] = None
    issue_date: Optional[str] = None
    effective_date: Optional[str] = None
    due_date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: str
    currency: str
    subtotal_amount: Optional[float] = None
    tax_amount: Optional[float] = None
    total_amount: Optional[float] = None
    notes: Optional[str] = None
    custom_fields: dict[str, Any] | None = None
    file_name: Optional[str] = None
    file_url: Optional[str] = None
    user_name: Optional[str] = None
    photo_url: Optional[str] = None
    updated_at: Optional[str] = None


class InsertionOrderListResponse(BaseModel):
    results: list[InsertionOrderResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int
