from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class MailProvider(str, Enum):
    google = "google"
    microsoft = "microsoft"
    imap_smtp = "imap_smtp"


class MailConnectionSecurity(str, Enum):
    ssl = "ssl"
    starttls = "starttls"
    none = "none"


class MailConnectionStatus(str, Enum):
    connected = "connected"
    disconnected = "disconnected"
    error = "error"


class MailDirection(str, Enum):
    inbound = "inbound"
    outbound = "outbound"
    internal = "internal"


class MailConnectionSummaryResponse(BaseModel):
    provider: MailProvider
    status: MailConnectionStatus
    account_email: str | None = None
    provider_mailbox_id: str | None = None
    provider_mailbox_name: str | None = None
    sync_cursor: str | None = None
    can_send: bool = False
    can_sync: bool = False
    last_synced_at: datetime | None = None
    last_error: str | None = None


class MailContextResponse(BaseModel):
    connections: list[MailConnectionSummaryResponse]
    sync_available: bool = False
    sync_note: str


class MailMessageResponse(BaseModel):
    id: int
    provider: MailProvider | None = None
    provider_message_id: str | None = None
    provider_thread_id: str | None = None
    direction: MailDirection
    folder: str
    from_email: str | None = None
    from_name: str | None = None
    to_recipients: list[dict] | None = None
    cc_recipients: list[dict] | None = None
    bcc_recipients: list[dict] | None = None
    subject: str | None = None
    snippet: str | None = None
    body_text: str | None = None
    received_at: datetime | None = None
    sent_at: datetime | None = None
    source_module_key: str | None = None
    source_entity_id: str | None = None
    source_label: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MailMessageListResponse(BaseModel):
    results: list[MailMessageResponse]


class MailSendRequest(BaseModel):
    provider: MailProvider
    to: list[EmailStr] = Field(min_length=1)
    cc: list[EmailStr] = Field(default_factory=list)
    bcc: list[EmailStr] = Field(default_factory=list)
    subject: str = Field(default="", max_length=500)
    body_text: str = ""
    source_module_key: str | None = Field(default=None, max_length=100)
    source_entity_id: str | None = Field(default=None, max_length=100)
    source_label: str | None = Field(default=None, max_length=255)


class MailProviderConnectResponse(BaseModel):
    provider: MailProvider
    auth_url: str


class MailImapSmtpConnectRequest(BaseModel):
    account_email: EmailStr
    imap_host: str = Field(min_length=1, max_length=255)
    imap_port: int = Field(ge=1, le=65535)
    imap_security: MailConnectionSecurity = MailConnectionSecurity.ssl
    imap_username: str = Field(min_length=1, max_length=255)
    smtp_host: str = Field(min_length=1, max_length=255)
    smtp_port: int = Field(ge=1, le=65535)
    smtp_security: MailConnectionSecurity = MailConnectionSecurity.starttls
    smtp_username: str | None = Field(default=None, max_length=255)
    password: str = Field(min_length=1, max_length=4096)


class MailSyncResponse(BaseModel):
    provider: MailProvider
    synced_message_count: int = 0
    status: MailConnectionStatus
    last_synced_at: datetime | None = None
    last_error: str | None = None


class MailDisconnectResponse(BaseModel):
    provider: MailProvider
    status: MailConnectionStatus
