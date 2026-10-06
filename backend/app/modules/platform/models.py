import uuid

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, Numeric, JSON, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship, validates

from app.core.database import Base
from app.core.json_serialization import to_json_safe


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


class CrmNumberCounter(Base):
    __tablename__ = "crm_number_counters"
    __table_args__ = (
        UniqueConstraint("tenant_id", "scope", "period", name="uq_crm_number_counters_tenant_scope_period"),
        Index("ix_crm_number_counters_tenant_scope", "tenant_id", "scope"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    scope = Column(String(100), nullable=False)
    period = Column(String(20), nullable=False)
    next_value = Column(Integer, nullable=False, server_default="1")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class FieldDefinition(Base):
    """One field of the one field system (13b §3.4): a custom field on a built-in module, or a
    field of a custom module. What each `field_type` means lives in `app/core/field_types.py`.

    `module_key` is the module the field belongs to: a built-in key (`sales_leads`), or a
    custom module's platform module name. A custom module's fields also carry
    `custom_module_id`, so the module and its fields go together.
    """

    __tablename__ = "field_definitions"
    __table_args__ = (
        Index(
            "uq_field_definitions_tenant_module_key",
            "tenant_id",
            "module_key",
            "field_key",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
        Index("ix_field_definitions_tenant_module", "tenant_id", "module_key", "is_active"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    field_key = Column(String(100), nullable=False)
    label = Column(String(150), nullable=False)
    field_type = Column(String(40), nullable=False)
    custom_module_id = Column(BigInteger, ForeignKey("custom_module_definitions.id", ondelete="CASCADE"), nullable=True, index=True)
    picklist_id = Column(BigInteger, ForeignKey("picklists.id", ondelete="RESTRICT"), nullable=True, index=True)
    lookup_module_key = Column(String(100), nullable=True)
    is_required = Column(Boolean, nullable=False, default=False, server_default="false")
    is_unique = Column(Boolean, nullable=False, default=False, server_default="false")
    display_in_list = Column(Boolean, nullable=False, default=True, server_default="true")
    default_value = Column(JSON, nullable=True)
    config = Column(JSON, nullable=True)
    placeholder = Column(String(255), nullable=True)
    help_text = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    picklist = relationship("Picklist")
    custom_module = relationship("CustomModuleDefinition", back_populates="fields")
    values = relationship("FieldValue", back_populates="definition", cascade="all, delete-orphan", passive_deletes=True)

    @property
    def picklist_key(self) -> str | None:
        return self.picklist.key if self.picklist is not None else None


class FieldValue(Base):
    """A record's value for one field, in the column its type stores into."""

    __tablename__ = "field_values"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_key", "record_id", "field_definition_id", name="uq_field_values_record_field"),
        Index("ix_field_values_module_record", "tenant_id", "module_key", "record_id"),
        Index("ix_field_values_definition_text", "field_definition_id", "value_text"),
        Index("ix_field_values_definition_number", "field_definition_id", "value_number"),
        Index("ix_field_values_definition_date", "field_definition_id", "value_date"),
        Index("ix_field_values_definition_datetime", "field_definition_id", "value_datetime"),
        Index("ix_field_values_definition_record", "field_definition_id", "value_record_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False)
    record_id = Column(BigInteger, nullable=False)
    field_definition_id = Column(BigInteger, ForeignKey("field_definitions.id", ondelete="CASCADE"), nullable=False)
    value_text = Column(Text, nullable=True)
    value_number = Column(Numeric(28, 8), nullable=True)
    value_date = Column(Date, nullable=True)
    value_datetime = Column(DateTime(timezone=True), nullable=True)
    value_boolean = Column(Boolean, nullable=True)
    value_json = Column(JSON, nullable=True)
    value_record_id = Column(BigInteger, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    definition = relationship("FieldDefinition", back_populates="values")


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


class RecordLayoutDefinition(Base):
    __tablename__ = "record_layout_definitions"
    __table_args__ = (
        CheckConstraint(
            "surface IN ('quick_create', 'detail', 'full_form')",
            name="ck_record_layout_definitions_surface",
        ),
        CheckConstraint("version >= 1", name="ck_record_layout_definitions_version"),
        UniqueConstraint(
            "tenant_id",
            "module_key",
            "surface",
            "name",
            name="uq_record_layout_defs_tenant_module_surface_name",
        ),
        Index(
            "uq_record_layout_defs_default",
            "tenant_id",
            "module_key",
            "surface",
            unique=True,
            postgresql_where=text("is_default"),
            sqlite_where=text("is_default = 1"),
        ),
        Index(
            "ix_record_layout_defs_tenant_module_surface",
            "tenant_id",
            "module_key",
            "surface",
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    surface = Column(String(32), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    is_default = Column(Boolean, nullable=False, server_default="false")
    version = Column(Integer, nullable=False, server_default="1")
    sections = Column(JSON, nullable=False, server_default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class RecordTag(Base):
    __tablename__ = "record_tags"
    __table_args__ = (
        UniqueConstraint("tenant_id", "normalized_name", name="uq_record_tags_tenant_normalized_name"),
        UniqueConstraint("tenant_id", "id", name="uq_record_tags_tenant_id"),
        Index("ix_record_tags_tenant_name", "tenant_id", "name"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(50), nullable=False)
    normalized_name = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    links = relationship("RecordTagLink", back_populates="tag", cascade="all, delete-orphan")


class RecordTagLink(Base):
    __tablename__ = "record_tag_links"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "module_key",
            "entity_id",
            "tag_id",
            name="uq_record_tag_links_tenant_record_tag",
        ),
        ForeignKeyConstraint(
            ["tenant_id", "tag_id"],
            ["record_tags.tenant_id", "record_tags.id"],
            ondelete="CASCADE",
            name="fk_record_tag_links_tenant_tag",
        ),
        Index("ix_record_tag_links_tenant_record", "tenant_id", "module_key", "entity_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    tag_id = Column(BigInteger, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    tag = relationship("RecordTag", back_populates="links")


class Picklist(Base):
    """A tenant-managed value list (13b §3.1).

    `is_system` lists are the ones code refers to by key (lead status, industry, …): their
    values are editable but the list cannot be removed. `is_locked` lists hold values the
    platform defines (ISO countries): an admin can only switch values on and off.
    """

    __tablename__ = "picklists"
    __table_args__ = (
        UniqueConstraint("tenant_id", "key", name="uq_picklists_tenant_key"),
        UniqueConstraint("tenant_id", "id", name="uq_picklists_tenant_id"),
        CheckConstraint("scope IN ('global', 'local')", name="ck_picklists_scope"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(100), nullable=False)
    label = Column(String(150), nullable=False)
    scope = Column(String(20), nullable=False, server_default="global")
    meaning_set = Column(String(50), nullable=True)
    is_system = Column(Boolean, nullable=False, default=False, server_default="false")
    is_locked = Column(Boolean, nullable=False, default=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    values = relationship(
        "PicklistValue",
        back_populates="picklist",
        cascade="all, delete-orphan",
        order_by="(PicklistValue.position, PicklistValue.id)",
    )


class PicklistValue(Base):
    """One value of a picklist. The key is fixed once created; records store it."""

    __tablename__ = "picklist_values"
    __table_args__ = (
        UniqueConstraint("tenant_id", "picklist_id", "key", name="uq_picklist_values_list_key"),
        ForeignKeyConstraint(
            ["tenant_id", "picklist_id"],
            ["picklists.tenant_id", "picklists.id"],
            ondelete="CASCADE",
            name="fk_picklist_values_tenant_list",
        ),
        CheckConstraint(
            "tone IS NULL OR tone IN ('neutral', 'success', 'attention', 'critical')",
            name="ck_picklist_values_tone",
        ),
        CheckConstraint("NOT is_default OR is_active", name="ck_picklist_values_default_active"),
        Index(
            "uq_picklist_values_default",
            "picklist_id",
            unique=True,
            postgresql_where=text("is_default"),
            sqlite_where=text("is_default = 1"),
        ),
        Index("ix_picklist_values_list_position", "picklist_id", "position"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    picklist_id = Column(BigInteger, nullable=False, index=True)
    key = Column(String(100), nullable=False)
    label = Column(String(150), nullable=False)
    position = Column(Integer, nullable=False, server_default="0")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    is_default = Column(Boolean, nullable=False, default=False, server_default="false")
    tone = Column(String(20), nullable=True)
    meaning = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    picklist = relationship("Picklist", back_populates="values")


class UserModuleReport(Base):
    __tablename__ = "user_module_reports"
    __table_args__ = (
        UniqueConstraint("user_id", "module_key", "name", name="uq_user_module_reports_user_module_name"),
        Index("ix_user_module_reports_tenant_user_module", "tenant_id", "user_id", "module_key"),
        # The library lists everyone's shared reports in a tenant.
        Index("ix_user_module_reports_tenant_visibility", "tenant_id", "visibility"),
        CheckConstraint("visibility IN ('private', 'everyone')", name="ck_user_module_reports_visibility"),
    )

    # The SQLite variant keeps the tests able to autoincrement it; PostgreSQL is unchanged.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    # `private` (the owner only) or `everyone` in the tenant. Each viewer still sees only the
    # records they may open: a report is a definition, never a copy of the data.
    visibility = Column(String(20), nullable=False, server_default="private", default="private")
    config = Column(JSON, nullable=False, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")


class ReportDashboard(Base):
    """A shared or private page of saved reports (11-reports.md Phase 2).

    `widgets` holds references to saved reports, never their data or definitions: each
    viewer's dashboard runs every report as that viewer, so a dashboard shows nobody more
    than the reports would. `filters` holds the dashboard-wide defaults (date range, Show me).
    """

    __tablename__ = "report_dashboards"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_report_dashboards_user_name"),
        Index("ix_report_dashboards_tenant_visibility", "tenant_id", "visibility"),
        CheckConstraint("visibility IN ('private', 'everyone')", name="ck_report_dashboards_visibility"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    visibility = Column(String(20), nullable=False, server_default="private", default="private")
    widgets = Column(JSON, nullable=False, server_default="[]", default=list)
    filters = Column(JSON, nullable=False, server_default="{}", default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")


class ReportSubscription(Base):
    __tablename__ = "report_subscriptions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "target_type", "target_id", name="uq_report_subscription_user_target"),
        CheckConstraint("target_type IN ('report', 'dashboard')", name="ck_report_subscription_target"),
        CheckConstraint("frequency IN ('daily', 'weekly', 'monthly')", name="ck_report_subscription_frequency"),
        Index("ix_report_subscriptions_due", "next_run_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type = Column(String(20), nullable=False)
    target_id = Column(BigInteger, nullable=False)
    frequency = Column(String(20), nullable=False)
    hour = Column(Integer, nullable=False)
    minute = Column(Integer, nullable=False, server_default="0")
    weekday = Column(Integer, nullable=True)
    day_of_month = Column(Integer, nullable=True)
    timezone = Column(String(100), nullable=False)
    is_active = Column(Boolean, nullable=False, server_default="true")
    next_run_at = Column(DateTime(timezone=True), nullable=False)
    last_status = Column(String(20), nullable=True)
    last_error = Column(String(255), nullable=True)
    last_sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ReportSubscriptionDelivery(Base):
    __tablename__ = "report_subscription_deliveries"
    __table_args__ = (
        UniqueConstraint("subscription_id", "scheduled_for", name="uq_report_delivery_slot"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    subscription_id = Column(BigInteger, ForeignKey("report_subscriptions.id", ondelete="CASCADE"), nullable=False, index=True)
    scheduled_for = Column(DateTime(timezone=True), nullable=False)
    status = Column(String(20), nullable=False, server_default="queued")
    error = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)


class ForecastSnapshot(Base):
    __tablename__ = "forecast_snapshots"
    __table_args__ = (
        Index("ix_forecast_snapshots_tenant_period", "tenant_id", "period_start", "period_end"),
        Index("ix_forecast_snapshots_tenant_created", "tenant_id", "created_at"),
        Index("ix_forecast_snapshots_tenant_owner", "tenant_id", "owner_id"),
        Index("ix_forecast_snapshots_tenant_team", "tenant_id", "team_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    period_start = Column(Date, nullable=False)
    period_end = Column(Date, nullable=False)
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True, index=True)
    pipeline_key = Column(String(100), nullable=True, index=True)
    gross_pipeline_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    weighted_pipeline_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    commit_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    best_case_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    snapshot_json = Column(JSON, nullable=False, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    owner = relationship("User", foreign_keys=[owner_id])
    team = relationship("Team", foreign_keys=[team_id])


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

    @validates("payload", "summary")
    def _serialize_json_fields(self, _key, value):
        return to_json_safe(value) if value is not None else None


class TenantBackupSettings(Base):
    __tablename__ = "tenant_backup_settings"
    __table_args__ = (
        UniqueConstraint("tenant_id", name="uq_tenant_backup_settings_tenant"),
        CheckConstraint("frequency IN ('manual', 'daily', 'weekly', 'monthly')", name="ck_tenant_backup_settings_frequency"),
        CheckConstraint("scope IN ('full_tenant', 'selected_modules')", name="ck_tenant_backup_settings_scope"),
        CheckConstraint("destination IN ('local_download', 'google_drive', 'onedrive')", name="ck_tenant_backup_settings_destination"),
        CheckConstraint("retention_count IN (3, 7, 14, 30)", name="ck_tenant_backup_settings_retention"),
        Index("ix_tenant_backup_settings_tenant_updated", "tenant_id", "updated_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, server_default="false")
    frequency = Column(String(20), nullable=False, server_default="manual")
    scope = Column(String(30), nullable=False, server_default="full_tenant")
    selected_modules = Column(JSON, nullable=False, server_default="[]")
    retention_count = Column(Integer, nullable=False, server_default="3")
    destination = Column(String(30), nullable=False, server_default="local_download")
    include_documents = Column(Boolean, nullable=False, server_default="true")
    created_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    next_run_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    creator = relationship("User", foreign_keys=[created_by_id])
    updated_by = relationship("User", foreign_keys=[updated_by_id])


class TenantBackupRun(Base):
    __tablename__ = "tenant_backup_runs"
    __table_args__ = (
        CheckConstraint("backup_type = 'tenant'", name="ck_tenant_backup_runs_type"),
        CheckConstraint("scope IN ('full_tenant', 'selected_modules')", name="ck_tenant_backup_runs_scope"),
        CheckConstraint("status IN ('pending', 'running', 'completed', 'failed', 'cancelled')", name="ck_tenant_backup_runs_status"),
        CheckConstraint("destination IN ('local_download', 'google_drive', 'onedrive')", name="ck_tenant_backup_runs_destination"),
        CheckConstraint("destination_upload_status IN ('not_applicable', 'pending', 'uploaded', 'failed', 'expired')", name="ck_tenant_backup_runs_upload_status"),
        Index("ix_tenant_backup_runs_tenant_status", "tenant_id", "status"),
        Index("ix_tenant_backup_runs_tenant_created", "tenant_id", "created_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    settings_id = Column(BigInteger, ForeignKey("tenant_backup_settings.id", ondelete="SET NULL"), nullable=True, index=True)
    backup_type = Column(String(20), nullable=False, server_default="tenant")
    scope = Column(String(30), nullable=False)
    modules_included = Column(JSON, nullable=False, server_default="[]")
    status = Column(String(20), nullable=False, server_default="pending", index=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    file_path = Column(Text, nullable=True)
    storage_ref = Column(Text, nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    error_message = Column(Text, nullable=True)
    destination = Column(String(30), nullable=False, server_default="local_download")
    destination_upload_status = Column(String(30), nullable=False, server_default="not_applicable")
    metadata_json = Column(JSON, nullable=False, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    requester = relationship("User", foreign_keys=[requested_by_user_id])
    settings = relationship("TenantBackupSettings")


class TenantRestoreRun(Base):
    __tablename__ = "tenant_restore_runs"
    __table_args__ = (
        CheckConstraint("restore_type IN ('tenant_module', 'tenant_whole')", name="ck_tenant_restore_runs_type"),
        CheckConstraint(
            "mode IN ('preview_only', 'create_missing', 'update_existing', 'skip_duplicates', 'replace_module_data', 'replace_tenant_data')",
            name="ck_tenant_restore_runs_mode",
        ),
        CheckConstraint("status IN ('previewed', 'running', 'completed', 'failed')", name="ck_tenant_restore_runs_status"),
        Index("ix_tenant_restore_runs_tenant_status", "tenant_id", "status"),
        Index("ix_tenant_restore_runs_tenant_created", "tenant_id", "created_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    source_backup_run_id = Column(BigInteger, ForeignKey("tenant_backup_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    restore_type = Column(String(30), nullable=False, server_default="tenant_module")
    module_key = Column(String(100), nullable=False, index=True)
    mode = Column(String(30), nullable=False)
    status = Column(String(20), nullable=False, index=True)
    summary = Column(JSON, nullable=False, server_default="{}")
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    actor = relationship("User", foreign_keys=[actor_user_id])
    source_backup_run = relationship("TenantBackupRun")


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

    @validates("payload")
    def _serialize_metadata(self, _key, value):
        return to_json_safe(value) if value is not None else None


class CrmEvent(Base):
    __tablename__ = "crm_events"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type = Column(String(100), nullable=False, index=True)
    entity_type = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    # ORM callers use event.payload; the persisted column remains payload_json.
    payload = Column("payload_json", JSON, nullable=True)
    # The identity an outside system sees (webhook envelope `id`). Random, so it neither
    # reveals event volume nor changes on replay. Null on events recorded before webhooks
    # existed: no subscription could have matched them, so they are never delivered.
    public_id = Column(String(36), nullable=True, unique=True, index=True, default=lambda: str(uuid.uuid4()))
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

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
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
    module_key = Column(String(100), nullable=True, index=True)
    enabled = Column(Boolean, nullable=False, server_default="true", index=True)
    trigger_event = Column(String(100), nullable=False, index=True)
    condition_mode = Column(String(10), nullable=False, server_default="all")
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
        UniqueConstraint("rule_id", "event_id", name="uq_automation_rule_runs_rule_event"),
        Index("ix_automation_rule_runs_tenant_status", "tenant_id", "status"),
        Index("ix_automation_rule_runs_rule_started", "rule_id", "started_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    rule_id = Column(BigInteger, ForeignKey("automation_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(BigInteger, ForeignKey("crm_events.id", ondelete="SET NULL"), nullable=True, index=True)
    trigger_event_key = Column(String(100), nullable=True, index=True)
    source_module_key = Column(String(100), nullable=True, index=True)
    source_record_id = Column(String(100), nullable=True, index=True)
    status = Column(String(30), nullable=False, index=True)
    input_json = Column(JSON, nullable=True)
    result_json = Column(JSON, nullable=True)
    step_results_json = Column(JSON, nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

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
    __table_args__ = (
        Index(
            "ix_record_comments_tenant_record",
            "tenant_id",
            "module_key",
            "entity_id",
            "created_at",
            "id",
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
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


class RecordFollowUp(Base):
    """Source of truth for a logged salesperson follow-up outcome.

    Follow-ups previously existed only as ``activity_logs`` rows, which mixed
    salesperson interaction history into the immutable audit store. This table
    owns the interaction; the audit log keeps recording the change separately.
    ``follow_up_task_id`` is a soft reference (no FK) matching the existing
    cross-module convention used by ``tasks.source_entity_id``.
    """

    __tablename__ = "record_follow_ups"
    __table_args__ = (
        CheckConstraint(
            "channel IN ('whatsapp', 'email', 'call')",
            name="ck_record_follow_ups_channel",
        ),
        Index(
            "ix_record_follow_ups_tenant_record",
            "tenant_id",
            "module_key",
            "entity_id",
            "occurred_at",
            "id",
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    channel = Column(String(20), nullable=False, index=True)
    note = Column(Text, nullable=True)
    follow_up_task_id = Column(BigInteger, nullable=True, index=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    actor = relationship("User")

    @validates("entity_id")
    def _normalize_entity_id(self, _key, value):
        return str(value)


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
    fields = relationship("FieldDefinition", back_populates="custom_module", cascade="all, delete-orphan")


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

    # Field values live in `field_values` under the custom module's module key; the service
    # loads them in one query per page of records.
    custom_module = relationship("CustomModuleDefinition")


class IntegrationProvider(Base):
    __tablename__ = "integration_providers"

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    key = Column(String(100), nullable=False, unique=True, index=True)
    name = Column(String(150), nullable=False)
    category = Column(String(80), nullable=False, index=True)
    description = Column(Text, nullable=True)
    enabled = Column(Boolean, nullable=False, server_default="true", index=True)
    metadata_json = Column(JSON, nullable=False, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class IntegrationConnection(Base):
    __tablename__ = "integration_connections"
    __table_args__ = (
        UniqueConstraint("tenant_id", "provider_key", name="uq_integration_connections_tenant_provider"),
        CheckConstraint("status IN ('connected', 'disconnected', 'error', 'pending')", name="ck_integration_connections_status"),
        Index("ix_integration_connections_tenant_status", "tenant_id", "status"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    provider_key = Column(String(100), ForeignKey("integration_providers.key", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(30), nullable=False, server_default="disconnected", index=True)
    connected_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    connected_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    settings_json = Column(JSON, nullable=False, server_default="{}")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    provider = relationship("IntegrationProvider")
    connected_by = relationship("User")
    sync_runs = relationship("IntegrationSyncRun", back_populates="connection", cascade="all, delete-orphan")


class IntegrationSyncRun(Base):
    __tablename__ = "integration_sync_runs"
    __table_args__ = (
        CheckConstraint("status IN ('queued', 'running', 'completed', 'failed')", name="ck_integration_sync_runs_status"),
        Index("ix_integration_sync_runs_tenant_started", "tenant_id", "started_at"),
        Index("ix_integration_sync_runs_connection_started", "connection_id", "started_at"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    connection_id = Column(BigInteger, ForeignKey("integration_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    status = Column(String(30), nullable=False, server_default="queued", index=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    result_json = Column(JSON, nullable=False, server_default="{}")
    error_message = Column(Text, nullable=True)

    connection = relationship("IntegrationConnection", back_populates="sync_runs")
