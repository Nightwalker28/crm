from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
