from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.modules.tasks.schema import TaskResponse


WhatsAppDeliveryMode = Literal["external_link", "meta_cloud_api"]
WhatsAppDefaultMode = Literal["external_link", "meta_cloud_api", "ask_each_time"]


class WhatsAppModeCapability(BaseModel):
    mode: WhatsAppDeliveryMode
    # The tenant policy allows the mode.
    enabled: bool
    # Allowed and usable now (a provider mode also needs a connected account).
    available: bool
    unavailable_reason: Literal["disabled_by_policy", "not_configured"] | None = None
    # What the mode can truthfully promise. External mode is false on all three:
    # Lynk opens the chat and learns nothing after that.
    sends_from_crm: bool
    tracks_delivery: bool
    receives_inbound: bool


class WhatsAppCapabilitiesResponse(BaseModel):
    default_mode: WhatsAppDefaultMode
    # What one press of the WhatsApp action does now; null when no mode is usable.
    effective_mode: WhatsAppDefaultMode | None = None
    modes: list[WhatsAppModeCapability]


class WhatsAppContactClickRequest(BaseModel):
    template_id: int | None = None
    variables: dict[str, str | int | float | None] = Field(default_factory=dict)
    create_follow_up_task: bool = False
    follow_up_due_at: datetime | None = None
    follow_up_title: str | None = Field(default=None, max_length=255)


class WhatsAppContactClickResponse(BaseModel):
    interaction_id: int
    contact_id: int
    # Click-to-chat only prepares the message; the operator sends it in WhatsApp,
    # and Lynk never learns whether it was sent, delivered or read.
    mode: Literal["external_link"] = "external_link"
    status: Literal["prepared"] = "prepared"
    phone_number: str
    template_id: int | None = None
    message_body: str
    whatsapp_url: str
    last_contacted_at: datetime
    follow_up_task: TaskResponse | None = None
