from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


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
