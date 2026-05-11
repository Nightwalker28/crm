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


class InsertionOrderListItem(BaseModel):
    id: int
    io_number: str | None = None
    customer_name: str | None = None
    status: str | None = None
    currency: str | None = None
    total_amount: Optional[float] = None
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    external_reference: Optional[str] = None
    user_name: Optional[str] = None
    updated_at: Optional[str] = None
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    counterparty_reference: Optional[str] = None
    effective_date: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    subtotal_amount: Optional[float] = None
    tax_amount: Optional[float] = None
    notes: Optional[str] = None
    custom_fields: dict[str, Any] | None = None


class InsertionOrderListResponse(BaseModel):
    results: list[InsertionOrderListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int


class PosInvoiceLineRequest(BaseModel):
    id: Optional[int] = None
    catalog_product_id: Optional[int] = None
    catalog_service_id: Optional[int] = None
    description: str = Field(min_length=1)
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class PosInvoiceBase(BaseModel):
    customer_name: str = Field(min_length=1)
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    create_customer_if_missing: bool = False
    invoice_number: Optional[str] = None
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    status: str = "issued"
    payment_status: str = "unpaid"
    payment_method: Optional[str] = None
    template_id: str = "modern"
    accent_color: str = "#14b8a6"
    currency: str = "USD"
    discount_amount: float = Field(default=0, ge=0)
    tax_rate: float = Field(default=0, ge=0)
    amount_paid: float = Field(default=0, ge=0)
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    lines: list[PosInvoiceLineRequest] = Field(min_length=1)


class PosInvoiceCreateRequest(PosInvoiceBase):
    pass


class PosInvoiceUpdateRequest(BaseModel):
    customer_name: Optional[str] = Field(default=None, min_length=1)
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    create_customer_if_missing: bool = False
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None
    payment_status: Optional[str] = None
    payment_method: Optional[str] = None
    template_id: Optional[str] = None
    accent_color: Optional[str] = None
    currency: Optional[str] = None
    discount_amount: Optional[float] = Field(default=None, ge=0)
    tax_rate: Optional[float] = Field(default=None, ge=0)
    amount_paid: Optional[float] = Field(default=None, ge=0)
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    lines: Optional[list[PosInvoiceLineRequest]] = Field(default=None, min_length=1)


class PosInvoiceLineResponse(BaseModel):
    id: int
    catalog_product_id: Optional[int] = None
    catalog_service_id: Optional[int] = None
    description: str
    quantity: float
    unit_price: float
    line_total: float
    sort_order: int


class PosInvoiceResponse(BaseModel):
    id: int
    invoice_number: str
    mode: str
    status: str
    payment_status: str
    payment_method: Optional[str] = None
    template_id: str
    accent_color: str
    customer_name: str
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    currency: str
    subtotal_amount: float
    discount_amount: float
    tax_rate: float
    tax_amount: float
    total_amount: float
    amount_paid: float
    balance_due: float
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    user_name: Optional[str] = None
    updated_at: Optional[str] = None
    lines: list[PosInvoiceLineResponse] = Field(default_factory=list)


class PosInvoiceListItem(BaseModel):
    id: int
    invoice_number: str
    customer_name: str
    status: str
    payment_status: str
    currency: str
    total_amount: float
    amount_paid: float
    balance_due: float
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    template_id: str
    user_name: Optional[str] = None
    updated_at: Optional[str] = None


class PosInvoiceListResponse(BaseModel):
    results: list[PosInvoiceListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int
