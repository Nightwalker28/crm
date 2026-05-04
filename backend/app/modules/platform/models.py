from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    entity_type = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    action = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    before_state = Column(JSON, nullable=True)
    after_state = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    actor = relationship("User")


class CustomFieldDefinition(Base):
    __tablename__ = "custom_field_definitions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_key", "field_key", name="uq_custom_field_defs_tenant_module_key"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    field_key = Column(String(100), nullable=False, index=True)
    label = Column(String(150), nullable=False)
    field_type = Column(String(50), nullable=False)
    placeholder = Column(String(255), nullable=True)
    help_text = Column(Text, nullable=True)
    is_required = Column(Boolean, nullable=False, server_default="false")
    is_active = Column(Boolean, nullable=False, server_default="true")
    sort_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    values = relationship("CustomFieldValue", back_populates="definition", cascade="all, delete-orphan")


class CustomFieldValue(Base):
    __tablename__ = "custom_field_values"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "module_key",
            "record_id",
            "field_definition_id",
            name="uq_custom_field_values_tenant_record_field",
        ),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    record_id = Column(BigInteger, nullable=False, index=True)
    field_definition_id = Column(BigInteger, ForeignKey("custom_field_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    value_text = Column(Text, nullable=True)
    value_number = Column(JSON, nullable=True)
    value_date = Column(String(20), nullable=True)
    value_boolean = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    definition = relationship("CustomFieldDefinition", back_populates="values")


class DataTransferJob(Base):
    __tablename__ = "data_transfer_jobs"

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    operation_type = Column(String(20), nullable=False, index=True)
    status = Column(String(20), nullable=False, index=True, server_default="queued")
    mode = Column(String(20), nullable=False, server_default="background")
    payload = Column(JSON, nullable=True)
    summary = Column(JSON, nullable=True)
    result_file_path = Column(Text, nullable=True)
    result_file_name = Column(String(255), nullable=True)
    result_media_type = Column(String(100), nullable=True)
    error_message = Column(Text, nullable=True)
    progress_percent = Column(Integer, nullable=False, server_default="0")
    progress_message = Column(String(255), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    actor = relationship("User")


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String(50), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, index=True, server_default="unread")
    link_url = Column(String(255), nullable=True)
    payload = Column("metadata", JSON, nullable=True)
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")


class CrmEvent(Base):
    __tablename__ = "crm_events"

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)
    entity_type = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    payload = Column("payload_json", JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    actor = relationship("User")


class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(40), nullable=False, index=True)
    webhook_url = Column(Text, nullable=False)
    channel_name = Column(String(120), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true", index=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    creator = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])


class CrmEventDelivery(Base):
    __tablename__ = "crm_event_deliveries"

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(BigInteger, ForeignKey("crm_events.id", ondelete="CASCADE"), nullable=False, index=True)
    channel_id = Column(BigInteger, ForeignKey("notification_channels.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(40), nullable=False, index=True)
    status = Column(String(30), nullable=False, index=True)
    error_message = Column(Text, nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    event = relationship("CrmEvent")
    channel = relationship("NotificationChannel")


class RecordComment(Base):
    __tablename__ = "record_comments"

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    body = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    actor = relationship("User")

    @property
    def author_name(self) -> str:
        if self.actor:
            full_name = " ".join(part for part in [self.actor.first_name, self.actor.last_name] if part).strip()
            if full_name:
                return full_name
            if self.actor.email:
                return self.actor.email
        return "Unknown user"


class MessageTemplate(Base):
    __tablename__ = "message_templates"
    __table_args__ = (
        UniqueConstraint("tenant_id", "template_key", name="uq_message_templates_tenant_key"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    template_key = Column(String(120), nullable=False, index=True)
    name = Column(String(180), nullable=False)
    description = Column(Text, nullable=True)
    channel = Column(String(40), nullable=False, index=True)
    module_key = Column(String(100), nullable=True, index=True)
    body = Column(Text, nullable=False)
    variables = Column(JSON, nullable=True)
    is_system = Column(Boolean, nullable=False, server_default="false")
    is_active = Column(Boolean, nullable=False, server_default="true", index=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    creator = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
