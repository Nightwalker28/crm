from datetime import datetime
from pydantic import BaseModel, Field

from app.modules.tasks.schema import TaskResponse


class WhatsAppContactClickRequest(BaseModel):
    template_id: int | None = None
    variables: dict[str, str | int | float | None] = Field(default_factory=dict)
    create_follow_up_task: bool = False
    follow_up_due_at: datetime | None = None
    follow_up_title: str | None = None


class WhatsAppContactClickResponse(BaseModel):
    interaction_id: int
    contact_id: int
    phone_number: str
    template_id: int | None = None
    message_body: str
    whatsapp_url: str
    last_contacted_at: datetime
    follow_up_task: TaskResponse | None = None
