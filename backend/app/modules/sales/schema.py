from datetime import date, datetime
from decimal import Decimal
import json
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


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
    custom_fields: dict[str, Any] | None = None


class SalesOrganizationCreate(SalesOrganizationBase):
    # No additional fields for creation at this time currently using all fields from base
    # can be extended in the future if needed
    pass


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
    custom_fields: dict[str, Any] | None = None


class SalesOrganizationResponse(SalesOrganizationBase):
    org_id: int
    assigned_to: int | None = None
    customer_group_id: int | None = None
    customer_group: CustomerGroupSummary | None = None
    created_time: datetime | None = None

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
    customer_group_id: int | None = None
    customer_group: CustomerGroupSummary | None = None
    custom_fields: dict[str, Any] | None = None


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
    assigned_to: int
    customer_group_id: int | None = None
    customer_group: CustomerGroupSummary | None = None
    created_time: datetime
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
    custom_fields: dict[str, Any] | None = None


class SalesLeadScoreFactor(BaseModel):
    key: str
    label: str
    points: int
    reason: str


class SalesLeadCreateRequest(SalesLeadBase):
    primary_email: EmailStr
    assigned_to: int | None = None


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
    custom_fields: dict[str, Any] | None = None


class SalesLeadResponse(SalesLeadBase):
    lead_id: int
    primary_email: EmailStr
    assigned_to: int | None = None
    created_time: datetime
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
    created_time: datetime | None = None
    last_contacted_at: datetime | None = None
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
    assigned_to: int | None = None


class LeadConversionResponse(BaseModel):
    lead: SalesLeadResponse
    account_id: int | None = None
    contact_id: int | None = None
    deal_id: int | None = None
    created_account: bool = False
    created_contact: bool = False
    created_deal: bool = False


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


class SalesQuoteResponse(SalesQuoteBase):
    quote_id: int
    quote_number: str
    assigned_to: int | None = None
    created_time: datetime
    updated_at: datetime | None = None

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
    name: str
    description: str | None = None
    quantity: Decimal = Decimal("1")
    unit_price: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")
    tax_amount: Decimal = Decimal("0")
    line_total: Decimal = Decimal("0")
    sort_order: int = 0


class SalesOrderItemCreate(SalesOrderItemBase):
    pass


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
    subtotal: Decimal = Decimal("0")
    tax_total: Decimal = Decimal("0")
    discount_total: Decimal = Decimal("0")
    grand_total: Decimal = Decimal("0")
    owner_id: int | None = None
    items: list[SalesOrderItemCreate] = Field(default_factory=list)


class SalesOrderUpdateRequest(BaseModel):
    status: str | None = None
    owner_id: int | None = None


class SalesOrderResponse(BaseModel):
    id: int
    order_number: str
    quote_id: int | None = None
    organization_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    status: str
    currency: str
    subtotal: Decimal
    tax_total: Decimal
    discount_total: Decimal
    grand_total: Decimal
    owner_id: int | None = None
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
    status: str
    currency: str
    grand_total: Decimal
    owner_id: int | None = None
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

    model_config = ConfigDict(from_attributes=True)


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


class OrganizationCompactSummary(BaseModel):
    org_id: int
    org_name: str
    primary_email: str | None = None
    website: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ContactSummaryResponse(BaseModel):
    contact: SalesContactResponse
    organization: OrganizationCompactSummary | None = None
    related_opportunities: list[RelatedOpportunitySummary]
    related_quotes: list[RelatedQuoteSummary]
    related_insertion_orders: list[RelatedInsertionOrderSummary]
    inferred_services: list[str]
    opportunity_count: int
    quote_count: int
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
    follow_up_task_id: int | None = None


class OrganizationSummaryResponse(BaseModel):
    organization: SalesOrganizationResponse
    related_contacts: list[SalesContactResponse]
    related_opportunities: list[RelatedOpportunitySummary]
    related_quotes: list[RelatedQuoteSummary]
    related_insertion_orders: list[RelatedInsertionOrderSummary]
    inferred_services: list[str]
    contact_count: int
    opportunity_count: int
    quote_count: int
    insertion_order_count: int


class ContactCompactSummary(BaseModel):
    contact_id: int
    first_name: str | None = None
    last_name: str | None = None
    primary_email: str | None = None
    contact_telephone: str | None = None
    current_title: str | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesContactImportSummary(BaseModel):
    inserted: int
    updated: int
    skipped: int
    errors: list[str] = Field(default_factory=list)

# opportunities schemas

class SalesOpportunityBase(BaseModel):
    opportunity_name: str
    client: str | None = None
    sales_stage: str | None = None
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
    sales_stage: str = Field(pattern="^(lead|qualified|proposal|negotiation|closed_won|closed_lost)$")


class SalesOpportunityResponse(SalesOpportunityBase):
    opportunity_id: int
    created_time: datetime | None = None
    last_contacted_at: datetime | None = None
    last_contacted_channel: str | None = None
    last_contacted_by_user_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesOpportunityListItem(BaseModel):
    opportunity_id: int
    opportunity_name: str | None = None
    client: str | None = None
    sales_stage: str | None = None
    expected_close_date: date | None = None
    probability_percent: Decimal | None = None
    total_cost_of_project: str | None = None
    currency_type: str | None = None
    created_time: datetime | None = None
    last_contacted_at: datetime | None = None
    last_contacted_channel: str | None = None
    last_contacted_by_user_id: int | None = None
    assigned_to: int | None = None
    contact_id: int | None = None
    organization_id: int | None = None
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


class OpportunitySummaryResponse(BaseModel):
    opportunity: SalesOpportunityResponse
    contact: ContactCompactSummary | None = None
    organization: OrganizationCompactSummary | None = None
    related_quotes: list[RelatedQuoteSummary]
    related_insertion_orders: list[RelatedInsertionOrderSummary]
    inferred_services: list[str]
    insertion_order_count: int


class OpportunityPipelineStageSummary(BaseModel):
    stage_key: str
    label: str
    count: int
    total_value: float


class OpportunityPipelineSummaryResponse(BaseModel):
    total_count: int
    stages: list[OpportunityPipelineStageSummary]
