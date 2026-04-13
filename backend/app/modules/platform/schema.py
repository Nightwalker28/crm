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
