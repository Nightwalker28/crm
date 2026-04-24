"""add mail integration foundation

Revision ID: 20260423_mail_foundation
Revises: 20260422_cal_sync
Create Date: 2026-04-23 09:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260423_mail_foundation"
down_revision = "20260422_cal_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_mail_connections",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="disconnected", nullable=False),
        sa.Column("account_email", sa.String(length=255), nullable=True),
        sa.Column("scopes", sa.JSON(), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("provider_mailbox_id", sa.String(length=255), nullable=True),
        sa.Column("provider_mailbox_name", sa.String(length=255), nullable=True),
        sa.Column("sync_cursor", sa.Text(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "user_id", "provider", name="uq_user_mail_connections_user_provider"),
    )
    op.create_index("ix_user_mail_connections_id", "user_mail_connections", ["id"])
    op.create_index("ix_user_mail_connections_tenant_id", "user_mail_connections", ["tenant_id"])
    op.create_index("ix_user_mail_connections_user_id", "user_mail_connections", ["user_id"])
    op.create_index("ix_user_mail_connections_provider", "user_mail_connections", ["provider"])
    op.create_index("ix_user_mail_connections_status", "user_mail_connections", ["status"])

    op.create_table(
        "mail_messages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("connection_id", sa.BigInteger(), sa.ForeignKey("user_mail_connections.id", ondelete="SET NULL"), nullable=True),
        sa.Column("provider", sa.String(length=20), nullable=True),
        sa.Column("provider_message_id", sa.String(length=255), nullable=True),
        sa.Column("provider_thread_id", sa.String(length=255), nullable=True),
        sa.Column("direction", sa.String(length=20), server_default="inbound", nullable=False),
        sa.Column("folder", sa.String(length=80), server_default="inbox", nullable=False),
        sa.Column("from_email", sa.String(length=255), nullable=True),
        sa.Column("from_name", sa.String(length=255), nullable=True),
        sa.Column("to_recipients", sa.JSON(), nullable=True),
        sa.Column("cc_recipients", sa.JSON(), nullable=True),
        sa.Column("bcc_recipients", sa.JSON(), nullable=True),
        sa.Column("subject", sa.String(length=500), nullable=True),
        sa.Column("snippet", sa.Text(), nullable=True),
        sa.Column("body_text", sa.Text(), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_module_key", sa.String(length=100), nullable=True),
        sa.Column("source_entity_id", sa.String(length=100), nullable=True),
        sa.Column("source_label", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "connection_id", "provider_message_id", name="uq_mail_messages_provider_message"),
    )
    op.create_index("ix_mail_messages_id", "mail_messages", ["id"])
    op.create_index("ix_mail_messages_tenant_id", "mail_messages", ["tenant_id"])
    op.create_index("ix_mail_messages_owner_user_id", "mail_messages", ["owner_user_id"])
    op.create_index("ix_mail_messages_connection_id", "mail_messages", ["connection_id"])
    op.create_index("ix_mail_messages_provider", "mail_messages", ["provider"])
    op.create_index("ix_mail_messages_provider_message_id", "mail_messages", ["provider_message_id"])
    op.create_index("ix_mail_messages_provider_thread_id", "mail_messages", ["provider_thread_id"])
    op.create_index("ix_mail_messages_direction", "mail_messages", ["direction"])
    op.create_index("ix_mail_messages_folder", "mail_messages", ["folder"])
    op.create_index("ix_mail_messages_from_email", "mail_messages", ["from_email"])
    op.create_index("ix_mail_messages_subject", "mail_messages", ["subject"])
    op.create_index("ix_mail_messages_received_at", "mail_messages", ["received_at"])
    op.create_index("ix_mail_messages_sent_at", "mail_messages", ["sent_at"])
    op.create_index("ix_mail_messages_source_module_key", "mail_messages", ["source_module_key"])
    op.create_index("ix_mail_messages_source_entity_id", "mail_messages", ["source_entity_id"])
    op.create_index("ix_mail_messages_created_at", "mail_messages", ["created_at"])
    op.create_index("ix_mail_messages_deleted_at", "mail_messages", ["deleted_at"])

    op.execute(
        """
        INSERT INTO modules (name, base_route, description, is_enabled, import_duplicate_mode)
        VALUES ('mail', '/dashboard/mail', 'Mailbox integration and CRM communication history', 1, 'skip')
        ON CONFLICT (name) DO UPDATE
        SET base_route = EXCLUDED.base_route,
            description = EXCLUDED.description,
            is_enabled = 1
        """
    )
    op.execute(
        """
        INSERT INTO department_module_permissions (department_id, module_id)
        SELECT departments.id, modules.id
        FROM departments
        CROSS JOIN modules
        WHERE modules.name = 'mail'
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO team_module_permissions (team_id, module_id)
        SELECT teams.id, modules.id
        FROM teams
        CROSS JOIN modules
        WHERE modules.name = 'mail'
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO role_module_permissions (
            role_id,
            module_id,
            can_view,
            can_create,
            can_edit,
            can_delete,
            can_restore,
            can_export,
            can_configure
        )
        SELECT
            roles.id,
            modules.id,
            1,
            CASE WHEN roles.name IN ('Admin', 'Superuser') THEN 1 ELSE 0 END,
            CASE WHEN roles.name IN ('Admin', 'Superuser') THEN 1 ELSE 0 END,
            CASE WHEN roles.name IN ('Admin', 'Superuser') THEN 1 ELSE 0 END,
            CASE WHEN roles.name IN ('Admin', 'Superuser') THEN 1 ELSE 0 END,
            CASE WHEN roles.name IN ('Admin', 'Superuser') THEN 1 ELSE 0 END,
            CASE WHEN roles.name = 'Admin' THEN 1 ELSE 0 END
        FROM roles
        CROSS JOIN modules
        WHERE modules.name = 'mail'
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'mail')
        """
    )
    op.execute(
        """
        DELETE FROM team_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'mail')
        """
    )
    op.execute(
        """
        DELETE FROM department_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'mail')
        """
    )
    op.execute("DELETE FROM modules WHERE name = 'mail'")

    op.drop_index("ix_mail_messages_deleted_at", table_name="mail_messages")
    op.drop_index("ix_mail_messages_created_at", table_name="mail_messages")
    op.drop_index("ix_mail_messages_source_entity_id", table_name="mail_messages")
    op.drop_index("ix_mail_messages_source_module_key", table_name="mail_messages")
    op.drop_index("ix_mail_messages_sent_at", table_name="mail_messages")
    op.drop_index("ix_mail_messages_received_at", table_name="mail_messages")
    op.drop_index("ix_mail_messages_subject", table_name="mail_messages")
    op.drop_index("ix_mail_messages_from_email", table_name="mail_messages")
    op.drop_index("ix_mail_messages_folder", table_name="mail_messages")
    op.drop_index("ix_mail_messages_direction", table_name="mail_messages")
    op.drop_index("ix_mail_messages_provider_thread_id", table_name="mail_messages")
    op.drop_index("ix_mail_messages_provider_message_id", table_name="mail_messages")
    op.drop_index("ix_mail_messages_provider", table_name="mail_messages")
    op.drop_index("ix_mail_messages_connection_id", table_name="mail_messages")
    op.drop_index("ix_mail_messages_owner_user_id", table_name="mail_messages")
    op.drop_index("ix_mail_messages_tenant_id", table_name="mail_messages")
    op.drop_index("ix_mail_messages_id", table_name="mail_messages")
    op.drop_table("mail_messages")

    op.drop_index("ix_user_mail_connections_status", table_name="user_mail_connections")
    op.drop_index("ix_user_mail_connections_provider", table_name="user_mail_connections")
    op.drop_index("ix_user_mail_connections_user_id", table_name="user_mail_connections")
    op.drop_index("ix_user_mail_connections_tenant_id", table_name="user_mail_connections")
    op.drop_index("ix_user_mail_connections_id", table_name="user_mail_connections")
    op.drop_table("user_mail_connections")
