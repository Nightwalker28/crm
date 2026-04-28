from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ActivityLogResponse(BaseModel):
    id: int
    actor_user_id: int | None = None
    module_key: str
    entity_type: str
    entity_id: str
    action: str
    description: str | None = None
    before_state: dict[str, Any] | None = None
    after_state: dict[str, Any] | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ActivityLogListResponse(BaseModel):
    results: list[ActivityLogResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class CustomFieldDefinitionResponse(BaseModel):
    id: int
    module_key: str
    field_key: str
    label: str
    field_type: str
    placeholder: str | None = None
    help_text: str | None = None
    is_required: bool
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CustomFieldDefinitionCreateRequest(BaseModel):
    field_key: str
    label: str
    field_type: str
    placeholder: str | None = None
    help_text: str | None = None
    is_required: bool = False
    is_active: bool = True
    sort_order: int = 0


class CustomFieldDefinitionUpdateRequest(BaseModel):
    label: str | None = None
    field_type: str | None = None
    placeholder: str | None = None
    help_text: str | None = None
    is_required: bool | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class DataTransferJobResponse(BaseModel):
    id: int
    actor_user_id: int | None = None
    module_key: str
    operation_type: str
    status: str
    mode: str
    summary: dict[str, Any] | None = None
    result_file_name: str | None = None
    result_media_type: str | None = None
    error_message: str | None = None
    progress_percent: int = 0
    progress_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DataTransferJobListResponse(BaseModel):
    results: list[DataTransferJobResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class DataTransferExecutionResponse(BaseModel):
    mode: str
    message: str
    job_id: int | None = None
    job_status: str | None = None


class DataTransferExportRequest(BaseModel):
    mode: str = "all"
    selected_ids: list[int] | None = None
    current_page_ids: list[int] | None = None
    search: str | None = None
    status: str | None = None
    filters_all: list[dict[str, Any]] | None = None
    filters_any: list[dict[str, Any]] | None = None


class UserNotificationResponse(BaseModel):
    id: int
    user_id: int
    category: str
    title: str
    message: str
    status: str
    link_url: str | None = None
    metadata: dict[str, Any] | None = Field(default=None, alias="payload")
    read_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)


class UserNotificationListResponse(BaseModel):
    results: list[UserNotificationResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
    page_size: int
    unread_count: int


class NotificationChannelResponse(BaseModel):
    id: int
    provider: str
    channel_name: str | None = None
    webhook_url_masked: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class NotificationChannelCreateRequest(BaseModel):
    provider: str = Field(default="slack", min_length=1, max_length=40)
    webhook_url: str = Field(min_length=1)
    channel_name: str | None = Field(default=None, max_length=120)
    is_active: bool = True


class NotificationChannelUpdateRequest(BaseModel):
    provider: str | None = Field(default=None, min_length=1, max_length=40)
    webhook_url: str | None = Field(default=None, min_length=1)
    channel_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None


class NotificationChannelListResponse(BaseModel):
    results: list[NotificationChannelResponse]


class NotificationChannelTestResponse(BaseModel):
    ok: bool
    message: str


class RecordCommentResponse(BaseModel):
    id: int
    actor_user_id: int | None = None
    module_key: str
    entity_id: str
    body: str
    author_name: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class RecordCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class RecordCommentListResponse(BaseModel):
    results: list[RecordCommentResponse]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int


class GlobalSearchResultResponse(BaseModel):
    module_key: str
    module_label: str
    record_id: str
    title: str
    subtitle: str | None = None
    href: str


class GlobalSearchResponse(BaseModel):
    query: str
    results: list[GlobalSearchResultResponse]


class MessageTemplateResponse(BaseModel):
    id: int
    template_key: str
    name: str
    description: str | None = None
    channel: str
    module_key: str | None = None
    body: str
    variables: list[str]
    is_system: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class MessageTemplateCreateRequest(BaseModel):
    template_key: str | None = None
    name: str = Field(min_length=1, max_length=180)
    description: str | None = None
    channel: str = Field(min_length=1, max_length=40)
    module_key: str | None = Field(default=None, max_length=100)
    body: str = Field(min_length=1)
    variables: list[str] = Field(default_factory=list)
    is_active: bool = True


class MessageTemplateUpdateRequest(BaseModel):
    template_key: str | None = None
    name: str | None = Field(default=None, min_length=1, max_length=180)
    description: str | None = None
    channel: str | None = Field(default=None, min_length=1, max_length=40)
    module_key: str | None = Field(default=None, max_length=100)
    body: str | None = Field(default=None, min_length=1)
    variables: list[str] | None = None
    is_active: bool | None = None


class MessageTemplateListResponse(BaseModel):
    results: list[MessageTemplateResponse]
