from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CustomModuleFieldType(str, Enum):
    text = "text"
    textarea = "textarea"
    number = "number"
    currency = "currency"
    date = "date"
    datetime = "datetime"
    boolean = "boolean"
    email = "email"
    phone = "phone"
    url = "url"
    single_select = "single_select"
    multi_select = "multi_select"


class CustomModuleFieldBase(BaseModel):
    label: str = Field(min_length=1, max_length=150)
    key: str | None = Field(default=None, max_length=100)
    field_type: CustomModuleFieldType
    help_text: str | None = None
    placeholder: str | None = None
    is_required: bool = False
    is_unique: bool = False
    display_in_list: bool = True
    default_value: Any | None = None
    validation_json: dict[str, Any] | None = None
    sort_order: int = 0
    is_active: bool = True


class CustomModuleFieldCreate(CustomModuleFieldBase):
    pass


class CustomModuleFieldUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=150)
    help_text: str | None = None
    placeholder: str | None = None
    is_required: bool | None = None
    is_unique: bool | None = None
    display_in_list: bool | None = None
    default_value: Any | None = None
    validation_json: dict[str, Any] | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class CustomModuleFieldResponse(BaseModel):
    id: int
    key: str
    label: str
    field_type: CustomModuleFieldType
    help_text: str | None = None
    placeholder: str | None = None
    is_required: bool = False
    is_unique: bool = False
    display_in_list: bool = True
    default_value: Any | None = None
    validation_json: dict[str, Any] | None = None
    sort_order: int = 0
    is_active: bool = True
    is_protected: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class CustomModuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    key: str | None = Field(default=None, max_length=100)
    description: str | None = None
    icon: str | None = Field(default=None, max_length=80)
    sidebar_tab_key: str | None = Field(default=None, max_length=100)
    display_name: str | None = Field(default=None, max_length=150)
    fields: list[CustomModuleFieldCreate] = Field(default_factory=list)


class CustomModuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=150)
    description: str | None = None
    icon: str | None = Field(default=None, max_length=80)
    is_active: bool | None = None
    sidebar_tab_key: str | None = Field(default=None, max_length=100)
    display_name: str | None = Field(default=None, max_length=150)


class CustomModuleResponse(BaseModel):
    id: int
    name: str
    key: str
    description: str | None = None
    icon: str | None = None
    is_active: bool = True
    module_id: int | None = None
    base_route: str | None = None
    sidebar_tab_key: str | None = None
    sidebar_tab_label: str | None = None
    display_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    deleted_at: datetime | None = None
    fields: list[CustomModuleFieldResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class CustomModuleRecordRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    values: dict[str, Any] = Field(default_factory=dict)

    @field_validator("values")
    @classmethod
    def values_must_be_mapping(cls, value: dict[str, Any]) -> dict[str, Any]:
        return value or {}


class CustomModuleRecordResponse(BaseModel):
    id: int
    custom_module_id: int
    title: str
    values: dict[str, Any] = Field(default_factory=dict)
    created_by_user_id: int | None = None
    updated_by_user_id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    deleted_at: datetime | None = None


class CustomModuleRecordListResponse(BaseModel):
    results: list[CustomModuleRecordResponse]
    range_start: int = 0
    range_end: int = 0
    total_count: int
    total_pages: int
    page: int
    page_size: int
