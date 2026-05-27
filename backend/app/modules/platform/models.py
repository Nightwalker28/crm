from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Index, Integer, Numeric, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship, validates

from app.core.database import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_logs_module_entity", "module_key", "entity_id"),
    )

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

    @validates("entity_id")
    def _normalize_entity_id(self, _key, value):
        return str(value)


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
        Index("ix_custom_field_values_module_record", "module_key", "record_id"),
        Index("ix_custom_field_values_definition_record", "field_definition_id", "record_id"),
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


class ModuleFieldConfig(Base):
    __tablename__ = "module_field_configs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_key", "field_key", name="uq_module_field_configs_tenant_module_field"),
        Index("ix_module_field_configs_tenant_module", "tenant_id", "module_key", "is_enabled"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    field_key = Column(String(150), nullable=False, index=True)
    label = Column(String(150), nullable=False)
    field_type = Column(String(50), nullable=True)
    field_source = Column(String(40), nullable=False, server_default="system")
    is_enabled = Column(Boolean, nullable=False, server_default="true")
    is_protected = Column(Boolean, nullable=False, server_default="false")
    sort_order = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class UserModuleReport(Base):
    __tablename__ = "user_module_reports"
    __table_args__ = (
        UniqueConstraint("user_id", "module_key", "name", name="uq_user_module_reports_user_module_name"),
        Index("ix_user_module_reports_tenant_user_module", "tenant_id", "user_id", "module_key"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    config = Column(JSON, nullable=False, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")


class DataTransferJob(Base):
    __tablename__ = "data_transfer_jobs"
    __table_args__ = (
        Index("ix_data_transfer_jobs_tenant_status", "tenant_id", "status"),
    )

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
    __table_args__ = (
        Index("ix_user_notifications_user_status", "user_id", "status"),
        Index("ix_user_notifications_user_created", "user_id", "created_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
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

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
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


class AutomationRule(Base):
    __tablename__ = "automation_rules"
    __table_args__ = (
        Index("ix_automation_rules_tenant_trigger_enabled", "tenant_id", "trigger_event", "enabled"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(180), nullable=False)
    description = Column(Text, nullable=True)
    enabled = Column(Boolean, nullable=False, server_default="true", index=True)
    trigger_event = Column(String(100), nullable=False, index=True)
    conditions_json = Column(JSON, nullable=False, server_default="[]")
    actions_json = Column(JSON, nullable=False, server_default="[]")
    created_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    created_by = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])
    runs = relationship("AutomationRuleRun", back_populates="rule", cascade="all, delete-orphan")


class AutomationRuleRun(Base):
    __tablename__ = "automation_rule_runs"
    __table_args__ = (
        Index("ix_automation_rule_runs_tenant_status", "tenant_id", "status"),
        Index("ix_automation_rule_runs_rule_started", "rule_id", "started_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    rule_id = Column(BigInteger, ForeignKey("automation_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(BigInteger, ForeignKey("crm_events.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(String(30), nullable=False, index=True)
    input_json = Column(JSON, nullable=True)
    result_json = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)

    rule = relationship("AutomationRule", back_populates="runs")
    event = relationship("CrmEvent")


class AutomationRuleDeadLetter(Base):
    __tablename__ = "automation_rule_dead_letters"
    __table_args__ = (
        Index("ix_automation_dead_letters_tenant_status", "tenant_id", "status"),
        Index("ix_automation_dead_letters_rule_created", "rule_id", "created_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    rule_id = Column(BigInteger, ForeignKey("automation_rules.id", ondelete="CASCADE"), nullable=True, index=True)
    run_id = Column(BigInteger, ForeignKey("automation_rule_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    event_id = Column(BigInteger, ForeignKey("crm_events.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(String(30), nullable=False, server_default="open", index=True)
    payload_json = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)

    rule = relationship("AutomationRule")
    run = relationship("AutomationRuleRun")
    event = relationship("CrmEvent")


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


class CustomModuleDefinition(Base):
    __tablename__ = "custom_module_definitions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_custom_module_definitions_tenant_key"),
        Index("ix_custom_module_definitions_tenant_active", "tenant_id", "is_active", "deleted_at"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    key = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    icon = Column(String(80), nullable=True)
    is_active = Column(Boolean, nullable=False, server_default="true", index=True)
    module_id = Column(BigInteger, ForeignKey("modules.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    module = relationship("Module")
    fields = relationship("CustomModuleFieldDefinition", back_populates="custom_module", cascade="all, delete-orphan")


class CustomModuleFieldDefinition(Base):
    __tablename__ = "custom_module_field_definitions"
    __table_args__ = (
        UniqueConstraint("custom_module_id", "key", name="uq_custom_module_field_definitions_module_key"),
        Index("ix_custom_module_field_definitions_tenant_module", "tenant_id", "custom_module_id", "is_active", "deleted_at"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    custom_module_id = Column(BigInteger, ForeignKey("custom_module_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(100), nullable=False, index=True)
    label = Column(String(150), nullable=False)
    field_type = Column(String(40), nullable=False)
    help_text = Column(Text, nullable=True)
    placeholder = Column(String(255), nullable=True)
    is_required = Column(Boolean, nullable=False, server_default="false")
    is_unique = Column(Boolean, nullable=False, server_default="false")
    display_in_list = Column(Boolean, nullable=False, server_default="true")
    default_value = Column(JSON, nullable=True)
    validation_json = Column(JSON, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")
    is_active = Column(Boolean, nullable=False, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    custom_module = relationship("CustomModuleDefinition", back_populates="fields")
    values = relationship("CustomModuleRecordValue", back_populates="field", cascade="all, delete-orphan")


class CustomModuleRecord(Base):
    __tablename__ = "custom_module_records"
    __table_args__ = (
        Index("ix_custom_module_records_tenant_module_deleted", "tenant_id", "custom_module_id", "deleted_at"),
        Index("ix_custom_module_records_tenant_title", "tenant_id", "custom_module_id", "title"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    custom_module_id = Column(BigInteger, ForeignKey("custom_module_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    custom_module = relationship("CustomModuleDefinition")
    values = relationship("CustomModuleRecordValue", back_populates="record", cascade="all, delete-orphan")


class CustomModuleRecordValue(Base):
    __tablename__ = "custom_module_record_values"
    __table_args__ = (
        UniqueConstraint("record_id", "field_id", name="uq_custom_module_record_values_record_field"),
        Index("ix_custom_module_record_values_tenant_module", "tenant_id", "custom_module_id"),
        Index("ix_custom_module_record_values_field_text", "field_id", "text_value"),
        Index("ix_custom_module_record_values_field_number", "field_id", "number_value"),
        Index("ix_custom_module_record_values_field_datetime", "field_id", "datetime_value"),
        Index("ix_custom_module_record_values_field_boolean", "field_id", "boolean_value"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    custom_module_id = Column(BigInteger, ForeignKey("custom_module_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    record_id = Column(BigInteger, ForeignKey("custom_module_records.id", ondelete="CASCADE"), nullable=False, index=True)
    field_id = Column(BigInteger, ForeignKey("custom_module_field_definitions.id", ondelete="CASCADE"), nullable=False, index=True)
    text_value = Column(Text, nullable=True)
    number_value = Column(Numeric(18, 4), nullable=True)
    datetime_value = Column(DateTime(timezone=True), nullable=True)
    boolean_value = Column(Boolean, nullable=True)
    json_value = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    record = relationship("CustomModuleRecord", back_populates="values")
    field = relationship("CustomModuleFieldDefinition", back_populates="values")
