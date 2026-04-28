"""add crm events and notification channels

Revision ID: 20260428_slack_alerts
Revises: 20260428_whatsapp_templates
Create Date: 2026-04-28 18:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260428_slack_alerts"
down_revision = "20260428_whatsapp_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "crm_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("entity_type", sa.String(length=100), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_crm_events_id", "crm_events", ["id"])
    op.create_index("ix_crm_events_tenant_id", "crm_events", ["tenant_id"])
    op.create_index("ix_crm_events_actor_user_id", "crm_events", ["actor_user_id"])
    op.create_index("ix_crm_events_event_type", "crm_events", ["event_type"])
    op.create_index("ix_crm_events_entity_type", "crm_events", ["entity_type"])
    op.create_index("ix_crm_events_entity_id", "crm_events", ["entity_id"])
    op.create_index("ix_crm_events_created_at", "crm_events", ["created_at"])

    op.create_table(
        "notification_channels",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("webhook_url", sa.Text(), nullable=False),
        sa.Column("channel_name", sa.String(length=120), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_notification_channels_id", "notification_channels", ["id"])
    op.create_index("ix_notification_channels_tenant_id", "notification_channels", ["tenant_id"])
    op.create_index("ix_notification_channels_provider", "notification_channels", ["provider"])
    op.create_index("ix_notification_channels_is_active", "notification_channels", ["is_active"])
    op.create_index("ix_notification_channels_created_by_user_id", "notification_channels", ["created_by_user_id"])
    op.create_index("ix_notification_channels_updated_by_user_id", "notification_channels", ["updated_by_user_id"])
    op.create_index("ix_notification_channels_created_at", "notification_channels", ["created_at"])

    op.create_table(
        "crm_event_deliveries",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.BigInteger(), sa.ForeignKey("crm_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel_id", sa.BigInteger(), sa.ForeignKey("notification_channels.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_crm_event_deliveries_id", "crm_event_deliveries", ["id"])
    op.create_index("ix_crm_event_deliveries_tenant_id", "crm_event_deliveries", ["tenant_id"])
    op.create_index("ix_crm_event_deliveries_event_id", "crm_event_deliveries", ["event_id"])
    op.create_index("ix_crm_event_deliveries_channel_id", "crm_event_deliveries", ["channel_id"])
    op.create_index("ix_crm_event_deliveries_provider", "crm_event_deliveries", ["provider"])
    op.create_index("ix_crm_event_deliveries_status", "crm_event_deliveries", ["status"])
    op.create_index("ix_crm_event_deliveries_created_at", "crm_event_deliveries", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_crm_event_deliveries_created_at", table_name="crm_event_deliveries")
    op.drop_index("ix_crm_event_deliveries_status", table_name="crm_event_deliveries")
    op.drop_index("ix_crm_event_deliveries_provider", table_name="crm_event_deliveries")
    op.drop_index("ix_crm_event_deliveries_channel_id", table_name="crm_event_deliveries")
    op.drop_index("ix_crm_event_deliveries_event_id", table_name="crm_event_deliveries")
    op.drop_index("ix_crm_event_deliveries_tenant_id", table_name="crm_event_deliveries")
    op.drop_index("ix_crm_event_deliveries_id", table_name="crm_event_deliveries")
    op.drop_table("crm_event_deliveries")

    op.drop_index("ix_notification_channels_created_at", table_name="notification_channels")
    op.drop_index("ix_notification_channels_updated_by_user_id", table_name="notification_channels")
    op.drop_index("ix_notification_channels_created_by_user_id", table_name="notification_channels")
    op.drop_index("ix_notification_channels_is_active", table_name="notification_channels")
    op.drop_index("ix_notification_channels_provider", table_name="notification_channels")
    op.drop_index("ix_notification_channels_tenant_id", table_name="notification_channels")
    op.drop_index("ix_notification_channels_id", table_name="notification_channels")
    op.drop_table("notification_channels")

    op.drop_index("ix_crm_events_created_at", table_name="crm_events")
    op.drop_index("ix_crm_events_entity_id", table_name="crm_events")
    op.drop_index("ix_crm_events_entity_type", table_name="crm_events")
    op.drop_index("ix_crm_events_event_type", table_name="crm_events")
    op.drop_index("ix_crm_events_actor_user_id", table_name="crm_events")
    op.drop_index("ix_crm_events_tenant_id", table_name="crm_events")
    op.drop_index("ix_crm_events_id", table_name="crm_events")
    op.drop_table("crm_events")
