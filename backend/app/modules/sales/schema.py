from datetime import date, datetime
from decimal import Decimal
import json
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.modules.sales.opportunity_contact_roles import OPPORTUNITY_CONTACT_ROLE_PATTERN


class CustomerGroupSummary(BaseModel):
    id: int
    group_key: str
    name: str
    discount_type: str
    discount_value: float | None = None
    is_default: bool
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


# organization schemas
class SalesOrganizationBase(BaseModel):
    org_name: str
    primary_email: str
    website: str | None = None
    primary_phone: str | None = None # optional str = either can be a string or None = None by default
    secondary_phone: str | None = None
    secondary_email: str | None = None
    industry: str | None = None
    annual_revenue: str | None = None
    billing_address: str | None = None
    billing_city: str | None = None
    billing_state: str | None = None
    billing_postal_code: str | None = None
    billing_country: str | None = None
    # Vendors are Accounts we buy from (E4); the same company can also be a customer.
    is_vendor: bool = False
    # Days to pay, for invoices to this Account and bills from it (E5); none uses the company default.
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    custom_fields: dict[str, Any] | None = None


class SalesOrganizationCreate(SalesOrganizationBase):
    assigned_to: int | None = None


class SalesOrganizationUpdate(BaseModel):
    org_name: str | None = None
    primary_email: str | None = None
    website: str | None = None
    primary_phone: str | None = None
    secondary_phone: str | None = None
    secondary_email: str | None = None
    industry: str | None = None
    annual_revenue: str | None = None
    billing_address: str | None = None
    billing_city: str | None = None
    billing_state: str | None = None
    billing_postal_code: str | None = None
    billing_country: str | None = None
    is_vendor: bool | None = None
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    assigned_to: int | None = None
    custom_fields: dict[str, Any] | None = None


class SalesOrganizationResponse(SalesOrganizationBase):
    org_id: int
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    customer_group_id: int | None = None
    customer_group: CustomerGroupSummary | None = None
    created_time: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesOrganizationListItem(BaseModel):
    org_id: int
    org_name: str | None = None
    primary_email: str | None = None
    website: str | None = None
    primary_phone: str | None = None
    industry: str | None = None
    annual_revenue: str | None = None
    billing_country: str | None = None
    is_vendor: bool = False
    customer_group_id: int | None = None
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    created_time: datetime | None = None
    customer_group: CustomerGroupSummary | None = None
    custom_fields: dict[str, Any] | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesOrganizationListResponse(BaseModel):
    results: list[SalesOrganizationListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int

# contacts schemas
   
class SalesContactBase(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    contact_telephone: Optional[str] = None
    linkedin_url: Optional[str] = None
    current_title: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    email_opt_out: bool = False
    organization_id: Optional[int] = None
    custom_fields: dict[str, Any] | None = None


class SalesContactCreateRequest(SalesContactBase):
    primary_email: EmailStr
    assigned_to: Optional[int] = None


class SalesContactUpdateRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    contact_telephone: Optional[str] = None
    linkedin_url: Optional[str] = None
    current_title: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    email_opt_out: Optional[bool] = None
    organization_id: Optional[int] = None
    primary_email: Optional[EmailStr] = None
    assigned_to: Optional[int] = None
    custom_fields: dict[str, Any] | None = None


class SalesContactResponse(SalesContactBase):
    contact_id: int
    primary_email: EmailStr
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    customer_group_id: int | None = None
    customer_group: CustomerGroupSummary | None = None
    created_time: datetime
    updated_at: datetime | None = None
    last_contacted_at: datetime | None = None
    last_contacted_channel: str | None = None
    last_contacted_by_user_id: int | None = None
    whatsapp_last_contacted_at: datetime | None = None
    organization_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class SalesContactListItem(BaseModel):
    contact_id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    primary_email: EmailStr | None = None
    contact_telephone: Optional[str] = None
    linkedin_url: Optional[str] = None
    current_title: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    organization_id: Optional[int] = None
    organization_name: Optional[str] = None
    assigned_to: Optional[int] = None
    assigned_to_name: Optional[str] = None
    customer_group_id: Optional[int] = None
    customer_group: CustomerGroupSummary | None = None
    created_time: datetime | None = None
    last_contacted_at: datetime | None = None
    last_contacted_channel: str | None = None
    last_contacted_by_user_id: int | None = None
    custom_fields: dict[str, Any] | None = None


class SalesContactListResponse(BaseModel):
    results: list[SalesContactListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class SalesLeadBase(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    phone: str | None = None
    title: str | None = None
    source: str | None = None
    status: str = "new"
    notes: str | None = None
    next_follow_up_at: datetime | None = None
    custom_fields: dict[str, Any] | None = None


class SalesLeadScoreFactor(BaseModel):
    key: str
    label: str
    points: int
    reason: str


class SalesLeadCreateRequest(SalesLeadBase):
    primary_email: EmailStr
    assigned_to: int | None = None
    team_id: int | None = None
    tags: list[str] = Field(default_factory=list, max_length=20)


class SalesLeadUpdateRequest(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    primary_email: EmailStr | None = None
    phone: str | None = None
    title: str | None = None
    source: str | None = None
    status: str | None = None
    notes: str | None = None
    assigned_to: int | None = None
    team_id: int | None = None
    tags: list[str] = Field(default_factory=list, max_length=20)
    next_follow_up_at: datetime | None = None
    custom_fields: dict[str, Any] | None = None


class SalesLeadResponse(SalesLeadBase):
    lead_id: int
    primary_email: EmailStr
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    team_id: int | None = None
    team_name: str | None = None
    tags: list[str] = Field(default_factory=list)
    next_follow_up_is_overdue: bool = False
    created_time: datetime
    updated_at: datetime | None = None
    last_contacted_at: datetime | None = None
    last_contacted_channel: str | None = None
    last_contacted_by_user_id: int | None = None
    score: int | None = None
    score_grade: str | None = None
    score_factors: list[SalesLeadScoreFactor] | None = None
    score_calculated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesLeadListItem(BaseModel):
    lead_id: int
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    primary_email: EmailStr | None = None
    phone: str | None = None
    title: str | None = None
    source: str | None = None
    status: str | None = None
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    team_id: int | None = None
    team_name: str | None = None
    tags: list[str] = Field(default_factory=list)
    created_time: datetime | None = None
    last_contacted_at: datetime | None = None
    next_follow_up_at: datetime | None = None
    next_follow_up_is_overdue: bool = False
    last_contacted_channel: str | None = None
    last_contacted_by_user_id: int | None = None
    score: int | None = None
    score_grade: str | None = None
    score_factors: list[SalesLeadScoreFactor] | None = None
    score_calculated_at: datetime | None = None
    custom_fields: dict[str, Any] | None = None


class SalesLeadListResponse(BaseModel):
    results: list[SalesLeadListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class LeadSummaryResponse(BaseModel):
    lead: SalesLeadResponse


class LeadConversionRequest(BaseModel):
    create_account: bool = True
    account_id: int | None = None
    create_contact: bool = True
    contact_id: int | None = None
    create_deal: bool = False
    deal_name: str | None = None
    deal_stage: str | None = "qualified"
    # 13a H11: a converted lead is qualified, so the deal it opens carries its value and
    # expected close from the start (Dynamics 365's Qualify, Salesforce's Convert).
    deal_amount: Decimal | None = Field(default=None, ge=0, max_digits=18, decimal_places=2)
    deal_currency: str | None = Field(default=None, max_length=10)
    deal_close_date: date | None = None
    assigned_to: int | None = None


class LeadConversionResponse(BaseModel):
    lead: SalesLeadResponse
    account_id: int | None = None
    contact_id: int | None = None
    deal_id: int | None = None
    created_account: bool = False
    created_contact: bool = False
    created_deal: bool = False


class SalesQuoteItemBase(BaseModel):
    catalog_product_id: int | None = Field(default=None, gt=0)
    catalog_service_id: int | None = Field(default=None, gt=0)
    name: str = Field(min_length=1, max_length=500)
    description: str | None = None
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    tax_amount: Decimal = Field(default=Decimal("0"), ge=0)
    sort_order: int = Field(default=0, ge=0)


class SalesQuoteItemCreate(SalesQuoteItemBase):
    pass


class SalesQuoteItemResponse(SalesQuoteItemBase):
    id: int
    quote_id: int
    line_total: Decimal

    model_config = ConfigDict(from_attributes=True)


class SalesQuoteBase(BaseModel):
    title: str | None = None
    customer_name: str
    contact_id: int | None = None
    organization_id: int | None = None
    opportunity_id: int | None = None
    status: str = "draft"
    issue_date: date | None = None
    expiry_date: date | None = None
    currency: str = "USD"
    subtotal_amount: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")
    tax_amount: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    notes: str | None = None
    custom_fields: dict[str, Any] | None = None


class SalesQuoteCreateRequest(SalesQuoteBase):
    quote_number: str | None = None
    assigned_to: int | None = None
    items: list[SalesQuoteItemCreate] = Field(default_factory=list, max_length=200)


class SalesQuoteUpdateRequest(BaseModel):
    quote_number: str | None = None
    title: str | None = None
    customer_name: str | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    opportunity_id: int | None = None
    status: str | None = None
    issue_date: date | None = None
    expiry_date: date | None = None
    currency: str | None = None
    subtotal_amount: Decimal | None = None
    discount_amount: Decimal | None = None
    tax_amount: Decimal | None = None
    total_amount: Decimal | None = None
    notes: str | None = None
    assigned_to: int | None = None
    custom_fields: dict[str, Any] | None = None
    items: list[SalesQuoteItemCreate] | None = Field(default=None, max_length=200)


class SalesQuoteResponse(SalesQuoteBase):
    quote_id: int
    quote_number: str
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    created_time: datetime
    updated_at: datetime | None = None
    items: list[SalesQuoteItemResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class SalesQuoteListItem(BaseModel):
    quote_id: int
    quote_number: str
    title: str | None = None
    customer_name: str | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    opportunity_id: int | None = None
    status: str | None = None
    issue_date: date | None = None
    expiry_date: date | None = None
    currency: str | None = None
    subtotal_amount: Decimal | None = None
    discount_amount: Decimal | None = None
    tax_amount: Decimal | None = None
    total_amount: Decimal | None = None
    assigned_to: int | None = None
    created_time: datetime | None = None
    updated_at: datetime | None = None
    custom_fields: dict[str, Any] | None = None


class SalesQuoteListResponse(BaseModel):
    results: list[SalesQuoteListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class SalesQuoteProposalDocumentResponse(BaseModel):
    id: int
    quote_id: int
    document_id: int | None = None
    template_name: str
    status: str
    title: str
    content_text: str
    sent_to: str | None = None
    generated_at: datetime
    sent_at: datetime | None = None
    public_expires_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SalesQuoteProposalSendRequest(BaseModel):
    sent_to: EmailStr | None = None


class SalesQuoteProposalSendResponse(BaseModel):
    proposal: SalesQuoteProposalDocumentResponse
    public_url_path: str
    expires_at: datetime


class SalesQuoteProposalEventResponse(BaseModel):
    id: int
    quote_id: int
    quote_document_id: int
    event_type: str
    recipient_email: str | None = None
    occurred_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SalesQuoteProposalEventsResponse(BaseModel):
    results: list[SalesQuoteProposalEventResponse]


class SalesQuoteProposalPublicEventRequest(BaseModel):
    event_type: str = Field(pattern="^(opened|viewed|downloaded)$")
    recipient_email: EmailStr | None = None


class SalesQuoteProposalPublicResponse(BaseModel):
    quote_number: str
    customer_name: str
    title: str
    content_text: str
    currency: str | None = None
    total_amount: Decimal | None = None
    expiry_date: date | None = None


class ClientQuoteResponse(BaseModel):
    quote_id: int
    quote_number: str
    title: str | None = None
    customer_name: str
    status: str
    issue_date: date | None = None
    expiry_date: date | None = None
    currency: str
    subtotal_amount: Decimal
    discount_amount: Decimal
    tax_amount: Decimal
    total_amount: Decimal
    notes: str | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    proposal_document_id: int | None = None
    proposal_title: str | None = None
    proposal_content_text: str | None = None
    proposal_generated_at: datetime | None = None
    can_respond: bool = False
    created_time: datetime
    updated_at: datetime | None = None


class ClientQuoteListResponse(BaseModel):
    results: list[ClientQuoteResponse]


class ClientQuoteActionRequest(BaseModel):
    message: str | None = Field(default=None, max_length=2000)


class SalesOrderItemBase(BaseModel):
    catalog_product_id: int | None = Field(default=None, gt=0)
    catalog_service_id: int | None = Field(default=None, gt=0)
    name: str = Field(min_length=1, max_length=500)
    description: str | None = None
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)
    discount_amount: Decimal = Field(default=Decimal("0"), ge=0)
    tax_amount: Decimal = Field(default=Decimal("0"), ge=0)
    line_total: Decimal = Field(default=Decimal("0"), ge=0)
    sort_order: int = Field(default=0, ge=0)


class SalesOrderItemCreate(SalesOrderItemBase):
    # An existing line's ID keeps that line (and its stock holds) on update; omit for a new one.
    id: int | None = Field(default=None, gt=0)


class SalesOrderItemResponse(SalesOrderItemBase):
    id: int
    order_id: int

    model_config = ConfigDict(from_attributes=True)


class SalesOrderCreateRequest(BaseModel):
    order_number: str | None = None
    quote_id: int | None = None
    organization_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    status: str = "confirmed"
    currency: str = "USD"
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    subtotal: Decimal = Decimal("0")
    tax_total: Decimal = Decimal("0")
    discount_total: Decimal = Decimal("0")
    grand_total: Decimal = Decimal("0")
    delivery_date: date | None = None
    delivery_address: str | None = None
    payment_terms: str | None = None
    notes: str | None = None
    owner_id: int | None = None
    warehouse_id: int | None = Field(default=None, gt=0)
    priority: str = "normal"
    items: list[SalesOrderItemCreate] = Field(default_factory=list)


class SalesOrderUpdateRequest(BaseModel):
    order_number: str | None = None
    organization_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    status: str | None = None
    currency: str | None = None
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    owner_id: int | None = None
    delivery_date: date | None = None
    delivery_address: str | None = None
    payment_terms: str | None = None
    notes: str | None = None
    warehouse_id: int | None = Field(default=None, gt=0)
    priority: str | None = None
    items: list[SalesOrderItemCreate] | None = Field(default=None, min_length=1)


class SalesOrderResponse(BaseModel):
    id: int
    order_number: str
    quote_id: int | None = None
    quote_number: str | None = None
    organization_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    organization_name: str | None = None
    contact_name: str | None = None
    opportunity_name: str | None = None
    status: str
    currency: str
    # E6: base-currency units per order currency unit, for margin (12d §3.3).
    exchange_rate: Decimal | None = None
    base_currency: str | None = None
    suggested_exchange_rate: Decimal | None = None
    subtotal: Decimal
    tax_total: Decimal
    discount_total: Decimal
    grand_total: Decimal
    delivery_date: date | None = None
    delivery_address: str | None = None
    payment_terms: str | None = None
    notes: str | None = None
    owner_id: int | None = None
    owner_name: str | None = None
    warehouse_id: int | None = None
    warehouse_name: str | None = None
    delivery_status: str = "none"
    invoice_status: str = "none"
    priority: str = "normal"
    remaining_closed_at: datetime | None = None
    remaining_close_reason: str | None = None
    created_by_id: int | None = None
    created_at: datetime
    updated_at: datetime
    items: list[SalesOrderItemResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class SalesOrderListItem(BaseModel):
    id: int
    order_number: str
    quote_id: int | None = None
    organization_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    organization_name: str | None = None
    contact_name: str | None = None
    opportunity_name: str | None = None
    status: str
    delivery_status: str = "none"
    invoice_status: str = "none"
    priority: str = "normal"
    currency: str
    grand_total: Decimal
    owner_id: int | None = None
    owner_name: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SalesOrderListResponse(BaseModel):
    results: list[SalesOrderListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class SalesQuoteConvertToOrderRequest(BaseModel):
    allow_duplicate: bool = False


class RelatedOpportunitySummary(BaseModel):
    opportunity_id: int
    opportunity_name: str
    sales_stage: str | None = None
    expected_close_date: date | None = None
    probability_percent: Decimal | None = None
    total_cost_of_project: str | None = None
    currency_type: str | None = None
    # Set only on a contact's related deals: the role that contact plays on the deal.
    # `contact_role_key` is null when the contact is the legacy primary without a
    # participant row.
    contact_role_key: str | None = None
    contact_role_label: str | None = None
    is_primary_contact: bool | None = None

    model_config = ConfigDict(from_attributes=True)


class RelatedRecordAccess(BaseModel):
    """Which related sections of a summary the reader may view.

    False means the section is hidden by permission, so its list is empty and its
    count is zero whatever exists. Sections a summary does not carry are omitted.
    """

    contacts: bool | None = None
    opportunities: bool | None = None
    quotes: bool | None = None
    orders: bool | None = None
    invoices: bool | None = None
    insertion_orders: bool | None = None


class QuoteSummaryResponse(BaseModel):
    quote: SalesQuoteResponse
    opportunity: RelatedOpportunitySummary | None = None
    contact: "ContactCompactSummary | None" = None
    organization: "OrganizationCompactSummary | None" = None
    latest_proposal: SalesQuoteProposalDocumentResponse | None = None
    proposal_events: list[SalesQuoteProposalEventResponse] = Field(default_factory=list)
    related_order: SalesOrderListItem | None = None


class RelatedInsertionOrderSummary(BaseModel):
    id: int
    io_number: str
    customer_name: str | None = None
    status: str | None = None
    total_amount: float | None = None
    currency: str | None = None
    updated_at: datetime | None = None


class RelatedQuoteSummary(BaseModel):
    quote_id: int
    quote_number: str
    title: str | None = None
    customer_name: str
    opportunity_id: int | None = None
    status: str | None = None
    currency: str | None = None
    total_amount: Decimal | None = None
    issue_date: date | None = None
    expiry_date: date | None = None

    model_config = ConfigDict(from_attributes=True)


class RelatedOrderSummary(BaseModel):
    id: int
    order_number: str
    status: str
    currency: str
    grand_total: Decimal
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RelatedInvoiceSummary(BaseModel):
    id: int
    # Drafts have no number until they are issued (E5).
    invoice_number: str | None = None
    status: str
    payment_status: str
    currency: str
    total_amount: Decimal
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class OrganizationCompactSummary(BaseModel):
    org_id: int
    org_name: str
    primary_email: str | None = None
    website: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ContactSummaryResponse(BaseModel):
    contact: SalesContactResponse
    organization: OrganizationCompactSummary | None = None
    related_access: RelatedRecordAccess = Field(default_factory=RelatedRecordAccess)
    # The contact's deals: as primary contact or as a participant, with its role.
    related_opportunities: list[RelatedOpportunitySummary]
    related_quotes: list[RelatedQuoteSummary]
    related_orders: list[RelatedOrderSummary] = Field(default_factory=list)
    related_insertion_orders: list[RelatedInsertionOrderSummary]
    inferred_services: list[str]
    # Counts are totals; the lists above hold the most recent few.
    opportunity_count: int
    quote_count: int
    order_count: int = 0
    insertion_order_count: int


class FollowUpActionRequest(BaseModel):
    channel: str = Field(pattern="^(whatsapp|email|call)$")
    note: str | None = Field(default=None, max_length=1000)
    create_follow_up_task: bool = False
    follow_up_due_at: datetime | None = None


class FollowUpActionResponse(BaseModel):
    module_key: str
    entity_id: str
    channel: str
    last_contacted_at: datetime
    next_follow_up_at: datetime | None = None
    follow_up_task_id: int | None = None


class MoneyTotal(BaseModel):
    currency: str
    amount: float
    count: int


class OrganizationSummaryResponse(BaseModel):
    organization: SalesOrganizationResponse
    related_access: RelatedRecordAccess = Field(default_factory=RelatedRecordAccess)
    related_contacts: list[SalesContactResponse]
    related_opportunities: list[RelatedOpportunitySummary]
    related_quotes: list[RelatedQuoteSummary]
    related_orders: list[RelatedOrderSummary]
    related_invoices: list[RelatedInvoiceSummary]
    related_insertion_orders: list[RelatedInsertionOrderSummary]
    inferred_services: list[str]
    contact_count: int
    opportunity_count: int
    quote_count: int
    order_count: int
    invoice_count: int
    # Counts are totals; the lists above hold the most recent few.
    insertion_order_count: int
    # E5: what the account owes on issued invoices, and is owed on posted bills, per currency.
    receivables: list[MoneyTotal] = Field(default_factory=list)
    payables: list[MoneyTotal] = Field(default_factory=list)


class ContactCompactSummary(BaseModel):
    contact_id: int
    first_name: str | None = None
    last_name: str | None = None
    primary_email: str | None = None
    contact_telephone: str | None = None
    current_title: str | None = None
    # Lets a deal's composer list an opted-out participant as not selectable.
    email_opt_out: bool | None = None

    model_config = ConfigDict(from_attributes=True)


# opportunities schemas

class SalesOpportunityBase(BaseModel):
    opportunity_name: str
    client: str | None = None
    # Legacy stage key; still accepted and returned during the pipeline
    # compatibility period. `pipeline_stage_id` is the stable reference.
    sales_stage: str | None = None
    pipeline_stage_id: int | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    assigned_to: int | None = None
    start_date: date | None = None
    expected_close_date: date | None = None
    probability_percent: Decimal | None = Field(default=None, ge=0, le=100)
    campaign_type: str | None = None
    total_leads: str | None = None
    cpl: str | None = None
    total_cost_of_project: str | None = None
    currency_type: str | None = None
    target_geography: str | None = None
    target_audience: str | None = None
    domain_cap: str | None = None
    tactics: str | None = None
    delivery_format: str | None = None
    attachments: list[str] | None = None
    custom_fields: dict[str, Any] | None = None

    @field_validator("attachments", mode="before")
    @classmethod
    def parse_attachments(cls, value):
        if value is None:
            return None
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return parsed
            except json.JSONDecodeError:
                pass
            return [value]
        return None


class SalesOpportunityCreate(SalesOpportunityBase):
    client: str | None = None


class SalesOpportunityUpdate(BaseModel):
    opportunity_name: str | None = None
    client: str | None = None
    sales_stage: str | None = None
    pipeline_stage_id: int | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    assigned_to: int | None = None
    start_date: date | None = None
    expected_close_date: date | None = None
    probability_percent: Decimal | None = Field(default=None, ge=0, le=100)
    campaign_type: str | None = None
    total_leads: str | None = None
    cpl: str | None = None
    total_cost_of_project: str | None = None
    currency_type: str | None = None
    target_geography: str | None = None
    target_audience: str | None = None
    domain_cap: str | None = None
    tactics: str | None = None
    delivery_format: str | None = None
    attachments: list[str] | None = None
    custom_fields: dict[str, Any] | None = None


class SalesOpportunityStageUpdate(BaseModel):
    """Move a deal by legacy key or by stage id; when both are sent they must agree."""

    # Validated against the tenant's pipeline by `assign_opportunity_stage`, not a fixed list.
    sales_stage: str | None = Field(default=None, max_length=40)
    pipeline_stage_id: int | None = None

    @model_validator(mode="after")
    def require_a_stage(self):
        if self.sales_stage is None and self.pipeline_stage_id is None:
            raise ValueError("sales_stage or pipeline_stage_id is required")
        return self


class OpportunityPipelineStageRef(BaseModel):
    """A deal's stage as display metadata, so clients never infer meaning from a label."""

    id: int
    key: str
    label: str
    semantic_type: str
    probability: float
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class SalesOpportunityResponse(SalesOpportunityBase):
    opportunity_id: int
    pipeline_id: int | None = None
    pipeline_stage: OpportunityPipelineStageRef | None = None
    contact_name: str | None = None
    organization_name: str | None = None
    assigned_to_name: str | None = None
    created_time: datetime | None = None
    updated_at: datetime | None = None
    last_contacted_at: datetime | None = None
    last_contacted_channel: str | None = None
    last_contacted_by_user_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesOpportunityListItem(BaseModel):
    opportunity_id: int
    opportunity_name: str | None = None
    client: str | None = None
    sales_stage: str | None = None
    pipeline_id: int | None = None
    pipeline_stage_id: int | None = None
    pipeline_stage: OpportunityPipelineStageRef | None = None
    expected_close_date: date | None = None
    probability_percent: Decimal | None = None
    total_cost_of_project: str | None = None
    currency_type: str | None = None
    created_time: datetime | None = None
    last_contacted_at: datetime | None = None
    last_contacted_channel: str | None = None
    last_contacted_by_user_id: int | None = None
    assigned_to: int | None = None
    assigned_to_name: str | None = None
    contact_id: int | None = None
    contact_name: str | None = None
    organization_id: int | None = None
    organization_name: str | None = None
    start_date: date | None = None
    campaign_type: str | None = None
    total_leads: str | None = None
    cpl: str | None = None
    target_geography: str | None = None
    target_audience: str | None = None
    domain_cap: str | None = None
    tactics: str | None = None
    delivery_format: str | None = None
    attachments: list[str] | None = None
    custom_fields: dict[str, Any] | None = None

    
class SalesOpportunityListResponse(BaseModel):
    results: list[SalesOpportunityListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class OpportunityContactParticipant(BaseModel):
    """One contact involved in a deal, with the role they play in it."""

    id: int
    opportunity_id: int
    contact_id: int
    role_key: str
    role_label: str
    is_primary: bool
    contact_name: str | None = None
    contact: ContactCompactSummary
    created_at: datetime | None = None
    created_by_user_id: int | None = None
    # Populated only on removed participants, which are served by their own route.
    removed_at: datetime | None = None
    removed_by_user_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class OpportunityParticipantCreate(BaseModel):
    """Put an existing contact on a deal.

    `contact_id` is a hint from the client, never an authorization: the service
    resolves it inside the caller's tenant and the route independently requires
    Contacts link access.
    """

    contact_id: int
    # Omitted role means the catalog default rather than a rejection, matching the
    # legacy mirror, which records no role.
    role_key: str | None = Field(default=None, pattern=OPPORTUNITY_CONTACT_ROLE_PATTERN)
    # Adding someone straight as the primary contact also moves the legacy
    # `sales_opportunities.contact_id`.
    is_primary: bool = False


class OpportunityParticipantRoleUpdate(BaseModel):
    role_key: str = Field(pattern=OPPORTUNITY_CONTACT_ROLE_PATTERN)


class OpportunityParticipantListResponse(BaseModel):
    results: list[OpportunityContactParticipant]
    # Whether this reader may change the participant list, so a client can render a
    # read-only relationship rail without probing the write routes. UI hiding is not
    # the authorization; the routes enforce it independently.
    can_manage: bool = False


class OpportunityContactRoleOption(BaseModel):
    key: str
    label: str


class OpportunityContactRoleCatalogResponse(BaseModel):
    results: list[OpportunityContactRoleOption]


class OpportunitySummaryResponse(BaseModel):
    opportunity: SalesOpportunityResponse
    contact: ContactCompactSummary | None = None
    organization: OrganizationCompactSummary | None = None
    # `participant_contacts` carries every association including the primary one,
    # which is repeated in `primary_contact` for clients that only need that.
    # `contact` above stays the legacy single-contact field.
    primary_contact: OpportunityContactParticipant | None = None
    participant_contacts: list[OpportunityContactParticipant] = Field(default_factory=list)
    # False when the reader may not view Contacts; the participant lists are then
    # empty because they are hidden, not because the deal has no participants.
    can_view_contacts: bool = True
    related_access: RelatedRecordAccess = Field(default_factory=RelatedRecordAccess)
    related_quotes: list[RelatedQuoteSummary]
    related_insertion_orders: list[RelatedInsertionOrderSummary]
    inferred_services: list[str]
    quote_count: int = 0
    insertion_order_count: int


class SalesPipelineStageResponse(BaseModel):
    id: int
    key: str
    label: str
    position: int
    semantic_type: str
    is_closed: bool
    probability: float
    is_active: bool


class SalesPipelineResponse(BaseModel):
    id: int
    module_key: str
    name: str
    is_default: bool
    is_active: bool
    stages: list[SalesPipelineStageResponse]


class SalesPipelineStageUpdate(BaseModel):
    """A partial change to one stage. The stable `key` is deliberately not editable."""

    label: str | None = Field(default=None, max_length=80)
    semantic_type: str | None = None
    probability: Decimal | None = Field(default=None, ge=0, le=100)
    is_active: bool | None = None


class SalesPipelineStageCreate(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    # Optional: derived from the name when omitted. Permanent once created.
    key: str | None = Field(default=None, max_length=40)
    semantic_type: str = "ongoing"
    probability: Decimal | None = Field(default=None, ge=0, le=100)


class SalesPipelineStageOrderUpdate(BaseModel):
    stage_ids: list[int] = Field(min_length=1)


class SalesPipelineStageUsage(BaseModel):
    stage_id: int
    live_deal_count: int


class SalesPipelineStageUsageResponse(BaseModel):
    pipeline_id: int
    stages: list[SalesPipelineStageUsage]


class OpportunityPipelineStageSummary(BaseModel):
    stage_key: str
    # None for the Unstaged bucket.
    stage_id: int | None = None
    label: str
    semantic_type: str
    probability: float
    is_active: bool = True
    count: int
    # In the summary's base currency; deals that could not be converted are left out.
    total_value: float
    unconverted_count: int = 0


class OpportunityPipelineSummaryResponse(BaseModel):
    total_count: int
    stages: list[OpportunityPipelineStageSummary]
    currency: str
    unconverted_count: int = 0
    unconverted_currencies: list[str] = []
