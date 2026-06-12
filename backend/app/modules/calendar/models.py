from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
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

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(20), nullable=False, index=True)
    status = Column(String(20), nullable=False, server_default="connected", index=True)
    account_email = Column(String(255), nullable=True)
    scopes = Column(JSON, nullable=True)
    access_token = Column(Text, nullable=True)
    access_token_key_version = Column(String(32), nullable=True)
    refresh_token = Column(Text, nullable=True)
    refresh_token_key_version = Column(String(32), nullable=True)
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

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
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

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
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


class MeetingBookingType(Base):
    __tablename__ = "meeting_booking_types"
    __table_args__ = (
        UniqueConstraint("slug", name="uq_meeting_booking_types_slug"),
        Index("ix_meeting_booking_types_tenant_owner", "tenant_id", "owner_id"),
        Index("ix_meeting_booking_types_tenant_enabled", "tenant_id", "enabled"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(160), nullable=False)
    slug = Column(String(120), nullable=False, index=True)
    duration_minutes = Column(Integer, nullable=False, server_default="30")
    buffer_before_minutes = Column(Integer, nullable=False, server_default="0")
    buffer_after_minutes = Column(Integer, nullable=False, server_default="0")
    timezone = Column(String(100), nullable=False, server_default="UTC")
    enabled = Column(Boolean, nullable=False, server_default="true", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    owner = relationship("User", lazy="joined")
    availability = relationship("MeetingBookingAvailability", back_populates="booking_type", cascade="all, delete-orphan", order_by="MeetingBookingAvailability.sort_order")
    questions = relationship("MeetingBookingQuestion", back_populates="booking_type", cascade="all, delete-orphan", order_by="MeetingBookingQuestion.sort_order")


class MeetingBookingAvailability(Base):
    __tablename__ = "meeting_booking_availability"
    __table_args__ = (
        CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_meeting_booking_availability_weekday"),
        Index("ix_meeting_booking_availability_type_weekday", "booking_type_id", "weekday"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    booking_type_id = Column(BigInteger, ForeignKey("meeting_booking_types.id", ondelete="CASCADE"), nullable=False, index=True)
    weekday = Column(Integer, nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    sort_order = Column(Integer, nullable=False, server_default="0")

    booking_type = relationship("MeetingBookingType", back_populates="availability")


class MeetingBookingQuestion(Base):
    __tablename__ = "meeting_booking_questions"
    __table_args__ = (
        Index("ix_meeting_booking_questions_type", "booking_type_id", "sort_order"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    booking_type_id = Column(BigInteger, ForeignKey("meeting_booking_types.id", ondelete="CASCADE"), nullable=False, index=True)
    label = Column(String(255), nullable=False)
    field_type = Column(String(40), nullable=False, server_default="text")
    required = Column(Boolean, nullable=False, server_default="false")
    sort_order = Column(Integer, nullable=False, server_default="0")

    booking_type = relationship("MeetingBookingType", back_populates="questions")


class MeetingBooking(Base):
    __tablename__ = "meeting_bookings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "booking_type_id", "start_at", name="uq_meeting_bookings_type_start"),
        Index("ix_meeting_bookings_tenant_start", "tenant_id", "start_at"),
        Index("ix_meeting_bookings_event", "calendar_event_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    booking_type_id = Column(BigInteger, ForeignKey("meeting_booking_types.id", ondelete="CASCADE"), nullable=False, index=True)
    calendar_event_id = Column(BigInteger, ForeignKey("calendar_events.id", ondelete="SET NULL"), nullable=True, index=True)
    guest_name = Column(String(160), nullable=False)
    guest_email = Column(String(255), nullable=False, index=True)
    guest_note = Column(Text, nullable=True)
    answers_json = Column(JSON, nullable=False, server_default="{}")
    start_at = Column(DateTime(timezone=True), nullable=False, index=True)
    end_at = Column(DateTime(timezone=True), nullable=False, index=True)
    timezone = Column(String(100), nullable=False)
    status = Column(String(30), nullable=False, server_default="confirmed", index=True)
    booked_date = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    booking_type = relationship("MeetingBookingType", lazy="joined")
    calendar_event = relationship("CalendarEvent", lazy="joined")
