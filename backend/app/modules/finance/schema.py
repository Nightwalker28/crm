from datetime import date
from decimal import Decimal
from typing import Any, Optional
from pydantic import BaseModel, Field, field_validator

from app.modules.finance.services.io_search_services import normalize_io_status


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

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str) -> str:
        return normalize_io_status(value)


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
    #: The record's owner. Writable because design.md 4.7 puts a user-pointing column in the
    #: spine's State block, and an insertion order was the one record type of the nine whose
    #: update contract had no way to carry the reassignment at all.
    user_id: Optional[int] = None
    custom_fields: dict[str, Any] | None = None

    @field_validator("status")
    @classmethod
    def validate_status(cls, value: str | None) -> str | None:
        return normalize_io_status(value, default=None)


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
    #: The owner's id as well as their name: the rail's Owner control selects by id, and the
    #: name alone left it unable to say which option was the current one.
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    photo_url: Optional[str] = None
    created_at: Optional[str] = None
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
    discount_amount: float = Field(default=0, ge=0)
    tax_amount: float = Field(default=0, ge=0)


class PosInvoicePaidNow(BaseModel):
    """The POS fast path: issue and record a payment in one step (12c §3.3)."""

    amount: Optional[Decimal] = Field(default=None, gt=0, max_digits=14, decimal_places=2)
    method: Optional[str] = Field(default=None, max_length=100)
    reference: Optional[str] = Field(default=None, max_length=200)
    paid_on: Optional[date] = None


class PosInvoiceBase(BaseModel):
    customer_name: str = Field(min_length=1)
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    create_customer_if_missing: bool = False
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    payment_method: Optional[str] = None
    template_id: str = "modern"
    accent_color: str = "#14b8a6"
    currency: str = "USD"
    discount_amount: float = Field(default=0, ge=0)
    tax_rate: float = Field(default=0, ge=0, le=100)
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    lines: list[PosInvoiceLineRequest] = Field(min_length=1)


class PosInvoiceCreateRequest(PosInvoiceBase):
    # A draft unless `issue`; an invoice number is given only at issue.
    issue: bool = False
    paid_now: Optional[PosInvoicePaidNow] = None


class PosInvoiceUpdateRequest(BaseModel):
    """A draft takes any field. An issued invoice takes only due date, notes, payment terms
    and template; the service refuses the rest (12c §3.3)."""

    customer_name: Optional[str] = Field(default=None, min_length=1)
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    create_customer_if_missing: bool = False
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    payment_method: Optional[str] = None
    template_id: Optional[str] = None
    accent_color: Optional[str] = None
    currency: Optional[str] = None
    discount_amount: Optional[float] = Field(default=None, ge=0)
    tax_rate: Optional[float] = Field(default=None, ge=0, le=100)
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    lines: Optional[list[PosInvoiceLineRequest]] = Field(default=None, min_length=1)


class PosInvoicePaymentRequest(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2)
    payment_method: str | None = Field(default=None, max_length=100)
    paid_on: Optional[date] = None
    reference: Optional[str] = Field(default=None, max_length=200)


class ReasonRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class InvoiceSourceRequest(BaseModel):
    order_id: int = Field(gt=0)
    delivery_id: Optional[int] = Field(default=None, gt=0)


class InvoiceFromSourcesRequest(BaseModel):
    # A list so that several orders on one invoice is additive later; one today (12c §5a).
    sources: list[InvoiceSourceRequest] = Field(min_length=1, max_length=1)


class PosInvoiceLineResponse(BaseModel):
    id: int
    catalog_product_id: Optional[int] = None
    catalog_service_id: Optional[int] = None
    sales_order_item_id: Optional[int] = None
    delivery_line_id: Optional[int] = None
    description: str
    quantity: float
    unit_price: float
    discount_amount: float = 0
    tax_amount: float = 0
    line_total: float
    sort_order: int
    # Issued invoices: invoiced less already credited (12c §3.3).
    creditable: Optional[float] = None


class PosInvoiceResponse(BaseModel):
    id: int
    invoice_number: Optional[str] = None
    mode: str
    source: str = "manual"
    sales_order_id: Optional[int] = None
    status: str
    payment_status: str
    is_overdue: bool = False
    payment_method: Optional[str] = None
    template_id: str
    accent_color: str
    customer_name: str
    customer_email: Optional[str] = None
    customer_address: Optional[str] = None
    customer_contact_id: Optional[int] = None
    customer_organization_id: Optional[int] = None
    customer_contact_name: Optional[str] = None
    customer_organization_name: Optional[str] = None
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    currency: str
    subtotal_amount: float
    discount_amount: float
    tax_rate: float
    tax_amount: float
    total_amount: float
    amount_paid: float
    amount_credited: float = 0
    balance_due: float
    payment_terms: Optional[str] = None
    notes: Optional[str] = None
    issued_at: Optional[str] = None
    voided_at: Optional[str] = None
    void_reason: Optional[str] = None
    user_name: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    lines: list[PosInvoiceLineResponse] = Field(default_factory=list)
    payments: list[dict[str, Any]] = Field(default_factory=list)
    credit_notes: list[dict[str, Any]] = Field(default_factory=list)
    sales_order_number: Optional[str] = None


class PosInvoiceListItem(BaseModel):
    id: int
    invoice_number: Optional[str] = None
    customer_name: str
    status: str
    payment_status: str
    is_overdue: bool = False
    source: str = "manual"
    sales_order_id: Optional[int] = None
    currency: str
    total_amount: float
    amount_paid: float
    amount_credited: float = 0
    balance_due: float
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    template_id: str
    payment_method: Optional[str] = None
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
