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


class MailSendStatus(str, Enum):
    """Outbound lifecycle. Inbound messages carry no send status at all."""

    sending = "sending"
    sent = "sent"
    failed = "failed"


class MailAttachmentResponse(BaseModel):
    document_id: int
    filename: str
    content_type: str | None = None
    size_bytes: int | None = None


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
    health_status: str = "unknown"
    credential_state: str = "unknown"
    scopes: list[str] = Field(default_factory=list)
    last_successful_sync_at: datetime | None = None
    last_failure_reason: str | None = None
    reconnect_required: bool = False
    reconnect_label: str | None = None
    sync_unavailable_reason: str | None = None


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
    send_status: MailSendStatus | None = None
    send_error_code: str | None = None
    template_id: int | None = None
    attachments: list[MailAttachmentResponse] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MailMessageListResponse(BaseModel):
    results: list[MailMessageResponse]


class MailMessageLinkRequest(BaseModel):
    source_module_key: str = Field(max_length=100)
    source_entity_id: str = Field(max_length=100)


class MailAssociationType(str, Enum):
    primary = "primary"
    related = "related"


class MailRecordAssociationCreateRequest(BaseModel):
    module_key: str = Field(min_length=1, max_length=100)
    entity_id: str = Field(min_length=1, max_length=100)
    association_type: MailAssociationType = MailAssociationType.related
    # Link every message the provider already threaded together, so a
    # conversation lands on the record in one action instead of message by
    # message.
    apply_to_thread: bool = False


class MailRecordAssociationResponse(BaseModel):
    id: int
    message_id: int
    module_key: str
    entity_id: str
    association_type: MailAssociationType
    record_label: str | None = None
    created_by_user_id: int | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MailRecordAssociationListResponse(BaseModel):
    results: list[MailRecordAssociationResponse]


class MailComposeRequest(BaseModel):
    """Everything a send needs except which record it belongs to."""

    provider: MailProvider
    to: list[EmailStr] = Field(min_length=1, max_length=50)
    cc: list[EmailStr] = Field(default_factory=list, max_length=50)
    bcc: list[EmailStr] = Field(default_factory=list, max_length=50)
    subject: str = Field(default="", max_length=500)
    body_text: str = Field(default="", max_length=100_000)
    # Provenance only: the composer inserts template text into the body, and
    # the user may edit it before sending.
    template_id: int | None = Field(default=None, ge=1)
    # Attachments are existing CRM documents. Raw uploads go through the
    # documents module first, so upload validation and quota are not bypassed.
    attachment_document_ids: list[int] = Field(default_factory=list, max_length=5)
    # Client-generated, stable across retries of one compose attempt. Sending
    # twice with the same key returns the first message instead of a duplicate.
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=64)


class MailSendRequest(MailComposeRequest):
    # The display label is resolved from the record server-side; it is not
    # accepted from the client because it is persisted and searchable.
    source_module_key: str | None = Field(default=None, max_length=100)
    source_entity_id: str | None = Field(default=None, max_length=100)


class MailRecordSendRequest(MailComposeRequest):
    """Contextual send. The source record comes from the route path."""


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
