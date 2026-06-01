"""add integration registry

Revision ID: 20260623_integration_registry
Revises: 20260622_contracts
Create Date: 2026-06-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260623_integration_registry"
down_revision: Union[str, None] = "20260622_contracts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PROVIDERS = [
    ("google_mail", "Gmail", "Communication", "Google mailbox sending and opt-in inbox sync.", "/dashboard/mail", "mail"),
    ("microsoft_mail", "Microsoft Mail", "Communication", "Microsoft Graph mailbox sending and opt-in inbox sync.", "/dashboard/mail", "mail"),
    ("imap_smtp_mail", "IMAP / SMTP", "Communication", "Custom mailbox connection for sending and inbox sync.", "/dashboard/mail", "mail"),
    ("google_calendar", "Google Calendar", "Scheduling", "Google Calendar sync for CRM calendar events.", "/dashboard/calendar", "calendar"),
    ("microsoft_calendar", "Microsoft Calendar", "Scheduling", "Microsoft Calendar connection readiness.", "/dashboard/calendar", "calendar"),
    ("google_drive", "Google Drive", "Documents", "External document storage connection.", "/dashboard/documents", "documents"),
    ("website_api", "Website API", "Website", "Scoped API keys for public catalog reads and website order writeback.", "/dashboard/settings/integrations#website-apis", "website"),
    ("slack_webhooks", "Slack Webhooks", "Notifications", "Slack incoming webhooks for CRM event alerts.", "/dashboard/settings/integrations#webhooks", "notifications"),
    ("teams_webhooks", "Microsoft Teams Webhooks", "Notifications", "Microsoft Teams incoming webhooks for CRM event alerts.", "/dashboard/settings/integrations#webhooks", "notifications"),
]


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "integration_providers"):
        op.create_table(
            "integration_providers",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("key", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("category", sa.String(length=80), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("metadata_json", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("key", name="uq_integration_providers_key"),
        )
        op.create_index("ix_integration_providers_id", "integration_providers", ["id"], unique=False)
        op.create_index("ix_integration_providers_key", "integration_providers", ["key"], unique=True)
        op.create_index("ix_integration_providers_category", "integration_providers", ["category"], unique=False)
        op.create_index("ix_integration_providers_enabled", "integration_providers", ["enabled"], unique=False)

    if not _table_exists(bind, "integration_connections"):
        op.create_table(
            "integration_connections",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("provider_key", sa.String(length=100), nullable=False),
            sa.Column("status", sa.String(length=30), server_default="disconnected", nullable=False),
            sa.Column("connected_by_id", sa.BigInteger(), nullable=True),
            sa.Column("connected_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("settings_json", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("status IN ('connected', 'disconnected', 'error', 'pending')", name="ck_integration_connections_status"),
            sa.ForeignKeyConstraint(["connected_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["provider_key"], ["integration_providers.key"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "provider_key", name="uq_integration_connections_tenant_provider"),
        )
        op.create_index("ix_integration_connections_id", "integration_connections", ["id"], unique=False)
        op.create_index("ix_integration_connections_tenant_id", "integration_connections", ["tenant_id"], unique=False)
        op.create_index("ix_integration_connections_provider_key", "integration_connections", ["provider_key"], unique=False)
        op.create_index("ix_integration_connections_status", "integration_connections", ["status"], unique=False)
        op.create_index("ix_integration_connections_connected_by_id", "integration_connections", ["connected_by_id"], unique=False)
        op.create_index("ix_integration_connections_tenant_status", "integration_connections", ["tenant_id", "status"], unique=False)

    if not _table_exists(bind, "integration_sync_runs"):
        op.create_table(
            "integration_sync_runs",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("connection_id", sa.BigInteger(), nullable=False),
            sa.Column("status", sa.String(length=30), server_default="queued", nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("result_json", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.CheckConstraint("status IN ('queued', 'running', 'completed', 'failed')", name="ck_integration_sync_runs_status"),
            sa.ForeignKeyConstraint(["connection_id"], ["integration_connections.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_integration_sync_runs_id", "integration_sync_runs", ["id"], unique=False)
        op.create_index("ix_integration_sync_runs_tenant_id", "integration_sync_runs", ["tenant_id"], unique=False)
        op.create_index("ix_integration_sync_runs_connection_id", "integration_sync_runs", ["connection_id"], unique=False)
        op.create_index("ix_integration_sync_runs_status", "integration_sync_runs", ["status"], unique=False)
        op.create_index("ix_integration_sync_runs_tenant_started", "integration_sync_runs", ["tenant_id", "started_at"], unique=False)
        op.create_index("ix_integration_sync_runs_connection_started", "integration_sync_runs", ["connection_id", "started_at"], unique=False)

    for key, name, category, description, config_href, source in PROVIDERS:
        op.execute(
            sa.text(
                """
                INSERT INTO integration_providers (key, name, category, description, enabled, metadata_json)
                VALUES (:key, :name, :category, :description, true, json_build_object('config_href', :config_href, 'source', :source))
                ON CONFLICT (key) DO UPDATE
                SET name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    description = EXCLUDED.description,
                    enabled = true,
                    metadata_json = EXCLUDED.metadata_json
                """
            ).bindparams(key=key, name=name, category=category, description=description, config_href=config_href, source=source)
        )


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in ("integration_sync_runs", "integration_connections", "integration_providers"):
        if _table_exists(bind, table_name):
            op.drop_table(table_name)
