from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SupportCaseBase(BaseModel):
    subject: str = Field(min_length=1)
    description: str | None = None
    status: str = "new"
    priority: str = "medium"
    source: str | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    opportunity_id: int | None = None
    quote_id: int | None = None
    order_id: int | None = None
    assigned_to_id: int | None = None
    sla_due_at: datetime | None = None


class SupportCaseCreateRequest(SupportCaseBase):
    pass


class SupportCaseUpdateRequest(BaseModel):
    subject: str | None = None
    description: str | None = None
    status: str | None = None
    priority: str | None = None
    source: str | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    opportunity_id: int | None = None
    quote_id: int | None = None
    order_id: int | None = None
    assigned_to_id: int | None = None
    sla_due_at: datetime | None = None
    first_response_at: datetime | None = None


class SupportCaseCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1)
    is_internal: bool = False


class SupportCaseCommentResponse(BaseModel):
    id: int
    case_id: int
    author_id: int | None = None
    body: str
    is_internal: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SupportCaseEventResponse(BaseModel):
    id: int
    case_id: int
    event_type: str
    payload_json: dict[str, Any]
    created_by_id: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SupportCaseResponse(SupportCaseBase):
    id: int
    tenant_id: int
    case_number: str
    created_by_id: int | None = None
    first_response_at: datetime | None = None
    resolved_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    comments: list[SupportCaseCommentResponse] = Field(default_factory=list)
    events: list[SupportCaseEventResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class SupportCaseListItem(BaseModel):
    id: int
    case_number: str
    subject: str
    status: str
    priority: str
    source: str | None = None
    contact_id: int | None = None
    organization_id: int | None = None
    opportunity_id: int | None = None
    quote_id: int | None = None
    order_id: int | None = None
    assigned_to_id: int | None = None
    sla_due_at: datetime | None = None
    first_response_at: datetime | None = None
    resolved_at: datetime | None = None
    closed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SupportCaseListResponse(BaseModel):
    results: list[SupportCaseListItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class SupportCaseSummaryResponse(BaseModel):
    total_open: int
    urgent_open: int
    overdue: int
    by_status: dict[str, int]
