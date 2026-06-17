from datetime import date, datetime, time
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.platform.schema import DataTransferJobResponse


class CalendarParticipantType(str, Enum):
    user = "user"
    team = "team"


class CalendarParticipantStatus(str, Enum):
    pending = "pending"
    accepted = "accepted"
    declined = "declined"
    shared = "shared"


class CalendarProvider(str, Enum):
    google = "google"
    microsoft = "microsoft"


class CalendarConnectionStatus(str, Enum):
    connected = "connected"
    disconnected = "disconnected"
    error = "error"


class CalendarEventParticipantInput(BaseModel):
    participant_type: CalendarParticipantType
    user_id: int | None = None
    team_id: int | None = None

    @model_validator(mode="after")
    def validate_target(self):
        if self.participant_type == CalendarParticipantType.user and not self.user_id:
            raise ValueError("user_id is required for user participants")
        if self.participant_type == CalendarParticipantType.team and not self.team_id:
            raise ValueError("team_id is required for team participants")
        if self.participant_type == CalendarParticipantType.user:
            self.team_id = None
        if self.participant_type == CalendarParticipantType.team:
            self.user_id = None
        return self


class CalendarEventParticipantResponse(BaseModel):
    participant_type: CalendarParticipantType
    participant_key: str
    user_id: int | None = None
    team_id: int | None = None
    response_status: CalendarParticipantStatus
    is_owner: bool = False
    label: str

    model_config = ConfigDict(from_attributes=True)


class CalendarEventBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    start_at: datetime
    end_at: datetime
    is_all_day: bool = False
    location: str | None = Field(default=None, max_length=255)
    meeting_url: str | None = Field(default=None, max_length=500)
    participants: list[CalendarEventParticipantInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_times(self):
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class CalendarEventCreateRequest(CalendarEventBase):
    source_module_key: str | None = Field(default=None, max_length=100)
    source_entity_id: str | None = Field(default=None, max_length=100)
    source_label: str | None = Field(default=None, max_length=255)


class CalendarEventUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    is_all_day: bool | None = None
    location: str | None = Field(default=None, max_length=255)
    meeting_url: str | None = Field(default=None, max_length=500)
    participants: list[CalendarEventParticipantInput] | None = None

    @model_validator(mode="after")
    def validate_times(self):
        if self.start_at and self.end_at and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class CalendarInviteResponseRequest(BaseModel):
    response_status: CalendarParticipantStatus

    @model_validator(mode="after")
    def validate_response(self):
        if self.response_status not in {CalendarParticipantStatus.accepted, CalendarParticipantStatus.declined}:
            raise ValueError("response_status must be accepted or declined")
        return self


class CalendarEventResponse(BaseModel):
    id: int
    title: str
    description: str | None = None
    start_at: datetime
    end_at: datetime
    is_all_day: bool = False
    location: str | None = None
    meeting_url: str | None = None
    status: str
    owner_user_id: int
    owner_name: str | None = None
    source_module_key: str | None = None
    source_entity_id: str | None = None
    source_label: str | None = None
    current_user_response: CalendarParticipantStatus | None = None
    participants: list[CalendarEventParticipantResponse]
    created_at: datetime
    updated_at: datetime


class CalendarConnectionSummaryResponse(BaseModel):
    provider: CalendarProvider
    status: CalendarConnectionStatus
    account_email: str | None = None
    provider_calendar_id: str | None = None
    provider_calendar_name: str | None = None
    sync_enabled_for_current_session: bool = False
    last_synced_at: datetime | None = None
    last_error: str | None = None
    health_status: str = "unknown"
    credential_state: str = "unknown"
    scopes: list[str] = Field(default_factory=list)
    last_successful_sync_at: datetime | None = None
    last_failure_reason: str | None = None
    reconnect_required: bool = False
    reconnect_label: str | None = None


class CalendarAssignmentUserOption(BaseModel):
    id: int
    name: str
    email: str | None = None
    team_id: int | None = None
    team_name: str | None = None


class CalendarAssignmentTeamOption(BaseModel):
    id: int
    name: str
    department_id: int | None = None


class CalendarContextResponse(BaseModel):
    users: list[CalendarAssignmentUserOption]
    teams: list[CalendarAssignmentTeamOption]
    connections: list[CalendarConnectionSummaryResponse]
    recent_sync_jobs: list[DataTransferJobResponse] = Field(default_factory=list)
    pending_invite_count: int = 0


class CalendarEventListResponse(BaseModel):
    results: list[CalendarEventResponse]


class CalendarTaskCreateResponse(BaseModel):
    event: CalendarEventResponse
    created_from_task_id: int
    reused_existing: bool = False


class CalendarTaskEventResponse(BaseModel):
    event: CalendarEventResponse | None = None
    task_id: int


class CalendarSyncResponse(BaseModel):
    provider: CalendarProvider
    synced_event_count: int = 0
    provider_calendar_id: str | None = None
    provider_calendar_name: str | None = None
    last_synced_at: datetime | None = None
    status: CalendarConnectionStatus
    last_error: str | None = None


class MeetingBookingAvailabilityInput(BaseModel):
    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    sort_order: int = 0

    @model_validator(mode="after")
    def validate_window(self):
        if self.end_time <= self.start_time:
            raise ValueError("availability end_time must be after start_time")
        return self


class MeetingBookingQuestionInput(BaseModel):
    label: str = Field(min_length=1, max_length=255)
    field_type: str = Field(default="text", pattern="^(text|textarea)$")
    required: bool = False
    sort_order: int = 0


class MeetingBookingTypeCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    slug: str = Field(min_length=3, max_length=120, pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$")
    owner_id: int | None = None
    duration_minutes: int = Field(default=30, ge=15, le=240)
    buffer_before_minutes: int = Field(default=0, ge=0, le=240)
    buffer_after_minutes: int = Field(default=0, ge=0, le=240)
    timezone: str = Field(default="UTC", min_length=1, max_length=100)
    enabled: bool = True
    availability: list[MeetingBookingAvailabilityInput] = Field(default_factory=list)
    questions: list[MeetingBookingQuestionInput] = Field(default_factory=list)


class MeetingBookingTypeUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    slug: str | None = Field(default=None, min_length=3, max_length=120, pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$")
    owner_id: int | None = None
    duration_minutes: int | None = Field(default=None, ge=15, le=240)
    buffer_before_minutes: int | None = Field(default=None, ge=0, le=240)
    buffer_after_minutes: int | None = Field(default=None, ge=0, le=240)
    timezone: str | None = Field(default=None, min_length=1, max_length=100)
    enabled: bool | None = None
    availability: list[MeetingBookingAvailabilityInput] | None = None
    questions: list[MeetingBookingQuestionInput] | None = None


class MeetingBookingAvailabilityResponse(BaseModel):
    id: int | None = None
    weekday: int
    start_time: time
    end_time: time
    sort_order: int = 0

    model_config = ConfigDict(from_attributes=True)


class MeetingBookingQuestionResponse(BaseModel):
    id: int | None = None
    label: str
    field_type: str
    required: bool
    sort_order: int = 0

    model_config = ConfigDict(from_attributes=True)


class MeetingBookingTypeResponse(BaseModel):
    id: int
    owner_id: int
    owner_name: str | None = None
    name: str
    slug: str
    duration_minutes: int
    buffer_before_minutes: int
    buffer_after_minutes: int
    timezone: str
    enabled: bool
    availability: list[MeetingBookingAvailabilityResponse]
    questions: list[MeetingBookingQuestionResponse]
    created_at: datetime
    updated_at: datetime


class MeetingBookingTypeListResponse(BaseModel):
    results: list[MeetingBookingTypeResponse]


class PublicMeetingBookingTypeResponse(BaseModel):
    name: str
    slug: str
    duration_minutes: int
    timezone: str
    owner_name: str | None = None
    questions: list[MeetingBookingQuestionResponse]


class PublicMeetingSlot(BaseModel):
    start_at: datetime
    end_at: datetime
    label: str


class PublicMeetingSlotListResponse(BaseModel):
    results: list[PublicMeetingSlot]


class PublicMeetingBookingSubmitRequest(BaseModel):
    start_at: datetime
    guest_name: str = Field(min_length=1, max_length=160)
    guest_email: str = Field(min_length=3, max_length=255)
    guest_note: str | None = Field(default=None, max_length=2000)
    answers: dict[str, str] = Field(default_factory=dict)


class MeetingBookingResponse(BaseModel):
    id: int
    booking_type_id: int
    calendar_event_id: int | None = None
    crm_source_module_key: str | None = None
    crm_source_entity_id: str | None = None
    crm_source_label: str | None = None
    guest_name: str
    guest_email: str
    guest_note: str | None = None
    answers_json: dict
    start_at: datetime
    end_at: datetime
    timezone: str
    status: str
    booked_date: date
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MeetingBookingListResponse(BaseModel):
    results: list[MeetingBookingResponse]


class ClientMeetingBookingResponse(BaseModel):
    id: int
    booking_type_id: int
    booking_type_name: str | None = None
    owner_name: str | None = None
    guest_name: str
    guest_email: str
    guest_note: str | None = None
    start_at: datetime
    end_at: datetime
    timezone: str
    status: str
    booked_date: date
    meeting_url: str | None = None
    location: str | None = None
    created_at: datetime


class ClientMeetingBookingListResponse(BaseModel):
    results: list[ClientMeetingBookingResponse]
