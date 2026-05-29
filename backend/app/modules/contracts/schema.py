from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ContractBase(BaseModel):
    contract_number: str | None = None
    title: str = Field(min_length=1)
    status: str = "draft"
    organization_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    quote_id: int | None = None
    order_id: int | None = None
    document_id: int | None = None
    effective_date: date | None = None
    expiration_date: date | None = None
    renewal_date: date | None = None
    value_amount: Decimal | None = None
    currency: str | None = None
    owner_id: int | None = None


class ContractCreateRequest(ContractBase):
    pass


class ContractUpdateRequest(BaseModel):
    title: str | None = None
    status: str | None = None
    organization_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    quote_id: int | None = None
    order_id: int | None = None
    document_id: int | None = None
    effective_date: date | None = None
    expiration_date: date | None = None
    renewal_date: date | None = None
    value_amount: Decimal | None = None
    currency: str | None = None
    owner_id: int | None = None


class ContractPartyCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr | None = None
    role: str = "counterparty"


class ContractSignerCreateRequest(BaseModel):
    party_id: int | None = None
    name: str = Field(min_length=1)
    email: EmailStr
    signing_order: int = 1
    status: str = "pending"


class ContractSignerUpdateRequest(BaseModel):
    status: str | None = None
    signed_at: datetime | None = None


class ContractPartyResponse(BaseModel):
    id: int
    contract_id: int
    name: str
    email: str | None = None
    role: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContractSignerResponse(BaseModel):
    id: int
    contract_id: int
    party_id: int | None = None
    name: str
    email: str
    signing_order: int
    status: str
    signed_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContractEventResponse(BaseModel):
    id: int
    contract_id: int
    event_type: str
    payload_json: dict[str, Any]
    created_by_id: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContractResponse(ContractBase):
    id: int
    tenant_id: int
    contract_number: str
    created_by_id: int | None = None
    created_at: datetime
    updated_at: datetime
    parties: list[ContractPartyResponse] = Field(default_factory=list)
    signers: list[ContractSignerResponse] = Field(default_factory=list)
    events: list[ContractEventResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class ContractListItem(BaseModel):
    id: int
    contract_number: str
    title: str
    status: str
    organization_id: int | None = None
    contact_id: int | None = None
    opportunity_id: int | None = None
    quote_id: int | None = None
    order_id: int | None = None
    document_id: int | None = None
    effective_date: date | None = None
    expiration_date: date | None = None
    renewal_date: date | None = None
    value_amount: Decimal | None = None
    currency: str | None = None
    owner_id: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ContractListResponse(BaseModel):
    results: list[ContractListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
