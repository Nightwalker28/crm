from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


CallDirection = Literal["outbound", "inbound"]
CallOutcome = Literal["connected", "left_voicemail", "left_message", "no_answer", "busy", "wrong_number"]


class CallLogCreateRequest(BaseModel):
    """A call the operator reports. There is no provider field: this is not a dial request."""

    model_config = ConfigDict(extra="forbid")

    direction: CallDirection = "outbound"
    outcome: CallOutcome
    # When the call happened. Omitted means now; a later log of an earlier call is normal.
    occurred_at: datetime | None = None
    duration_seconds: int | None = Field(default=None, ge=0, le=86_400)
    note: str | None = Field(default=None, max_length=2000)
    # The person spoken with, when the record is not itself that person (a deal, a quote).
    contact_id: int | None = Field(default=None, ge=1)
    create_follow_up_task: bool = False
    follow_up_due_at: datetime | None = None


class CallLogResponse(BaseModel):
    id: int
    module_key: str
    entity_id: str
    capture: str
    direction: CallDirection
    outcome: CallOutcome
    occurred_at: datetime
    duration_seconds: int | None = None
    note: str | None = None
    phone_number: str | None = None
    contact_id: int | None = None
    follow_up_task_id: int | None = None
