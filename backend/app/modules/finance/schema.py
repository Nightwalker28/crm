from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class DocxTableRecord(BaseModel):
    file_name: str
    model_config = ConfigDict(extra="allow")


class DocxZipParseResponse(BaseModel):
    message: str
    duplicate_files: list[str] | None = None
    duplicate_campaigns: list[str] | None = None
    requires_confirmation: bool = False


class IOFileSearchItem(BaseModel):
    invoice_no: Optional[str] = None
    file_url: Optional[str] = None
    campaign_name: str
    file_path: str
    client_name: Optional[str] = None
    cpl: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    campaign_type: Optional[str] = None
    account_manager: Optional[str] = None
    total_leads: Optional[str] = None
    quarter: Optional[str] = None
    user_name: Optional[str] = None
    photo_url: Optional[str] = None
    updated_at: str 

class IOFileSearchResponse(BaseModel):
    results: list[IOFileSearchItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class InsertionOrderBase(BaseModel):
    customer_name: str = Field(min_length=1)
    customer_organization_id: Optional[int] = None
    create_customer_if_missing: bool = False
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


class InsertionOrderCreateRequest(InsertionOrderBase):
    pass


class InsertionOrderUpdateRequest(BaseModel):
    customer_name: Optional[str] = Field(default=None, min_length=1)
    customer_organization_id: Optional[int] = None
    create_customer_if_missing: bool = False
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


class InsertionOrderResponse(BaseModel):
    id: int
    io_number: str
    customer_name: str
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
