from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class GenericSystemRecordCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    status: str | None = Field(default=None, max_length=80)
    data: dict[str, Any] | None = None


class GenericSystemRecordUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = Field(default=None, max_length=80)
    data: dict[str, Any] | None = None


class GenericSystemRecordResponse(BaseModel):
    id: int
    module_key: str
    title: str
    status: str | None = None
    data: dict[str, Any] | None = None
    created_by_user_id: int | None = None
    updated_by_user_id: int | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)

