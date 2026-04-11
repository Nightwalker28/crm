from typing import Optional
from datetime import datetime
from pydantic import BaseModel, ConfigDict


class DocxTableRecord(BaseModel):
    file_name: str
    model_config = ConfigDict(extra="allow")


class DocxZipParseResponse(BaseModel):
    message: str
    duplicate_files: list[str] | None = None
    duplicate_campaigns: list[str] | None = None
    requires_confirmation: bool = False


class IOFileSearchItem(BaseModel):
    invoice_no: Optional[str] = None
    file_url: Optional[str] = None
    campaign_name: str
    file_path: str
    client_name: Optional[str] = None
    cpl: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    campaign_type: Optional[str] = None
    account_manager: Optional[str] = None
    total_leads: Optional[str] = None
    quarter: Optional[str] = None
    user_name: Optional[str] = None
    photo_url: Optional[str] = None
    updated_at: str 

class IOFileSearchResponse(BaseModel):
    results: list[IOFileSearchItem]
    range_start: int
    range_end: int
    total_count: int
    total_pages: int
    page: int
