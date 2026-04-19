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
