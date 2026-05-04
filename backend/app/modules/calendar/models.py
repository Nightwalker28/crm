from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    String,
    Text,
    Index,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class UserCalendarConnection(Base):
    __tablename__ = "user_calendar_connections"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "provider", name="uq_user_calendar_connections_user_provider"),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(20), nullable=False, index=True)
    status = Column(String(20), nullable=False, server_default="connected", index=True)
    account_email = Column(String(255), nullable=True)
    scopes = Column(JSON, nullable=True)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    provider_calendar_id = Column(String(255), nullable=True)
    provider_calendar_name = Column(String(255), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (
        Index("ix_calendar_events_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    start_at = Column(DateTime(timezone=True), nullable=False, index=True)
    end_at = Column(DateTime(timezone=True), nullable=False, index=True)
    is_all_day = Column(Boolean, nullable=False, server_default="false")
    location = Column(String(255), nullable=True)
    meeting_url = Column(String(500), nullable=True)
    status = Column(String(20), nullable=False, server_default="confirmed", index=True)
    source_module_key = Column(String(100), nullable=True, index=True)
    source_entity_id = Column(String(100), nullable=True, index=True)
    source_label = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    owner = relationship("User", foreign_keys=[owner_user_id], lazy="joined")
    participants = relationship(
        "CalendarEventParticipant",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class CalendarEventParticipant(Base):
    __tablename__ = "calendar_event_participants"
    __table_args__ = (
        UniqueConstraint("tenant_id", "event_id", "participant_key", name="uq_calendar_event_participants_event_key"),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(BigInteger, ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False, index=True)
    participant_type = Column(String(20), nullable=False, index=True)
    participant_key = Column(String(64), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="CASCADE"), nullable=True, index=True)
    response_status = Column(String(20), nullable=False, server_default="pending", index=True)
    is_owner = Column(Boolean, nullable=False, server_default="false")
    external_provider = Column(String(20), nullable=True)
    external_event_id = Column(String(255), nullable=True)
    external_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_error = Column(Text, nullable=True)
    responded_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    event = relationship("CalendarEvent", back_populates="participants")
    user = relationship("User", lazy="joined")
    team = relationship("Team", lazy="joined")

    @property
    def label(self) -> str:
        if self.participant_type == "user" and self.user:
            full_name = " ".join(part for part in [self.user.first_name, self.user.last_name] if part).strip()
            return full_name or self.user.email or f"User {self.user_id}"
        if self.participant_type == "team" and self.team:
            return self.team.name
        return self.participant_key
