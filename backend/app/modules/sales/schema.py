from datetime import date, datetime
import json
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


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
    created_time: datetime
    organization_name: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class SalesContactListItem(BaseModel):
    contact_id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    primary_email: EmailStr | None = None
    linkedin_url: Optional[str] = None
    current_title: Optional[str] = None
    region: Optional[str] = None
    country: Optional[str] = None
    organization_id: Optional[int] = None
    organization_name: Optional[str] = None
    assigned_to: Optional[int] = None
    created_time: datetime | None = None
    custom_fields: dict[str, Any] | None = None


class SalesContactListResponse(BaseModel):
    results: list[SalesContactListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class RelatedOpportunitySummary(BaseModel):
    opportunity_id: int
    opportunity_name: str
    sales_stage: str | None = None
    expected_close_date: date | None = None
    total_cost_of_project: str | None = None
    currency_type: str | None = None

    model_config = ConfigDict(from_attributes=True)


class RelatedInsertionOrderSummary(BaseModel):
    id: int
    io_number: str
    customer_name: str | None = None
    status: str | None = None
    total_amount: float | None = None
    currency: str | None = None
    updated_at: datetime | None = None


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
    related_insertion_orders: list[RelatedInsertionOrderSummary]
    inferred_services: list[str]
    opportunity_count: int
    insertion_order_count: int


class OrganizationSummaryResponse(BaseModel):
    organization: SalesOrganizationResponse
    related_contacts: list[SalesContactResponse]
    related_opportunities: list[RelatedOpportunitySummary]
    related_insertion_orders: list[RelatedInsertionOrderSummary]
    inferred_services: list[str]
    contact_count: int
    opportunity_count: int
    insertion_order_count: int


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


class SalesOpportunityResponse(SalesOpportunityBase):
    opportunity_id: int
    created_time: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class SalesOpportunityListItem(BaseModel):
    opportunity_id: int
    opportunity_name: str | None = None
    client: str | None = None
    sales_stage: str | None = None
    expected_close_date: date | None = None
    total_cost_of_project: str | None = None
    currency_type: str | None = None
    created_time: datetime | None = None
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
