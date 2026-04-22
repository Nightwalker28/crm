"""add calendar foundation

Revision ID: 20260422_calendar_foundation
Revises: 20260422_task_assign_meta
Create Date: 2026-04-22 06:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260422_calendar_foundation"
down_revision = "20260422_task_assign_meta"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("last_login_provider", sa.String(length=20), nullable=True))
    op.create_index("ix_users_last_login_provider", "users", ["last_login_provider"])

    op.create_table(
        "user_calendar_connections",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=20), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="connected"),
        sa.Column("account_email", sa.String(length=255), nullable=True),
        sa.Column("scopes", sa.JSON(), nullable=True),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "user_id", "provider", name="uq_user_calendar_connections_user_provider"),
    )
    op.create_index("ix_user_calendar_connections_id", "user_calendar_connections", ["id"])
    op.create_index("ix_user_calendar_connections_tenant_id", "user_calendar_connections", ["tenant_id"])
    op.create_index("ix_user_calendar_connections_user_id", "user_calendar_connections", ["user_id"])
    op.create_index("ix_user_calendar_connections_provider", "user_calendar_connections", ["provider"])
    op.create_index("ix_user_calendar_connections_status", "user_calendar_connections", ["status"])

    op.create_table(
        "calendar_events",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_all_day", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("location", sa.String(length=255), nullable=True),
        sa.Column("meeting_url", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="confirmed"),
        sa.Column("source_module_key", sa.String(length=100), nullable=True),
        sa.Column("source_entity_id", sa.String(length=100), nullable=True),
        sa.Column("source_label", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_calendar_events_id", "calendar_events", ["id"])
    op.create_index("ix_calendar_events_tenant_id", "calendar_events", ["tenant_id"])
    op.create_index("ix_calendar_events_owner_user_id", "calendar_events", ["owner_user_id"])
    op.create_index("ix_calendar_events_title", "calendar_events", ["title"])
    op.create_index("ix_calendar_events_start_at", "calendar_events", ["start_at"])
    op.create_index("ix_calendar_events_end_at", "calendar_events", ["end_at"])
    op.create_index("ix_calendar_events_status", "calendar_events", ["status"])
    op.create_index("ix_calendar_events_source_module_key", "calendar_events", ["source_module_key"])
    op.create_index("ix_calendar_events_source_entity_id", "calendar_events", ["source_entity_id"])
    op.create_index("ix_calendar_events_created_at", "calendar_events", ["created_at"])
    op.create_index("ix_calendar_events_deleted_at", "calendar_events", ["deleted_at"])

    op.create_table(
        "calendar_event_participants",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_id", sa.BigInteger(), sa.ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False),
        sa.Column("participant_type", sa.String(length=20), nullable=False),
        sa.Column("participant_key", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("team_id", sa.BigInteger(), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=True),
        sa.Column("response_status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("is_owner", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("external_provider", sa.String(length=20), nullable=True),
        sa.Column("external_event_id", sa.String(length=255), nullable=True),
        sa.Column("external_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_error", sa.Text(), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "event_id", "participant_key", name="uq_calendar_event_participants_event_key"),
    )
    op.create_index("ix_calendar_event_participants_id", "calendar_event_participants", ["id"])
    op.create_index("ix_calendar_event_participants_tenant_id", "calendar_event_participants", ["tenant_id"])
    op.create_index("ix_calendar_event_participants_event_id", "calendar_event_participants", ["event_id"])
    op.create_index("ix_calendar_event_participants_participant_type", "calendar_event_participants", ["participant_type"])
    op.create_index("ix_calendar_event_participants_participant_key", "calendar_event_participants", ["participant_key"])
    op.create_index("ix_calendar_event_participants_user_id", "calendar_event_participants", ["user_id"])
    op.create_index("ix_calendar_event_participants_team_id", "calendar_event_participants", ["team_id"])
    op.create_index("ix_calendar_event_participants_response_status", "calendar_event_participants", ["response_status"])

    op.execute(
        """
        INSERT INTO modules (name, base_route, description, is_enabled, import_duplicate_mode)
        VALUES ('calendar', '/dashboard/calendar', 'Shared user calendar, invites, and task scheduling', 1, 'skip')
        ON CONFLICT (name) DO UPDATE
        SET base_route = EXCLUDED.base_route,
            description = EXCLUDED.description,
            is_enabled = EXCLUDED.is_enabled
        """
    )

    op.execute(
        """
        INSERT INTO tenant_module_configs (tenant_id, module_id, is_enabled, import_duplicate_mode)
        SELECT tenants.id, modules.id, 1, 'skip'
        FROM tenants
        CROSS JOIN modules
        WHERE modules.name = 'calendar'
        ON CONFLICT (tenant_id, module_id) DO NOTHING
        """
    )

    op.execute(
        """
        INSERT INTO department_module_permissions (department_id, module_id)
        SELECT departments.id, modules.id
        FROM departments
        CROSS JOIN modules
        WHERE modules.name = 'calendar'
          AND NOT EXISTS (
              SELECT 1
              FROM department_module_permissions existing
              WHERE existing.department_id = departments.id
                AND existing.module_id = modules.id
          )
        """
    )

    op.execute(
        """
        INSERT INTO team_module_permissions (team_id, module_id)
        SELECT teams.id, modules.id
        FROM teams
        CROSS JOIN modules
        WHERE modules.name = 'calendar'
          AND NOT EXISTS (
              SELECT 1
              FROM team_module_permissions existing
              WHERE existing.team_id = teams.id
                AND existing.module_id = modules.id
          )
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
            1,
            1,
            1,
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            0,
            CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
        FROM roles
        CROSS JOIN modules
        WHERE modules.name = 'calendar'
          AND NOT EXISTS (
              SELECT 1
              FROM role_module_permissions existing
              WHERE existing.role_id = roles.id
                AND existing.module_id = modules.id
          )
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DELETE FROM role_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'calendar')
        """
    )
    op.execute(
        """
        DELETE FROM team_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'calendar')
        """
    )
    op.execute(
        """
        DELETE FROM department_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'calendar')
        """
    )
    op.execute(
        """
        DELETE FROM tenant_module_configs
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'calendar')
        """
    )
    op.execute("DELETE FROM modules WHERE name = 'calendar'")

    op.drop_index("ix_calendar_event_participants_response_status", table_name="calendar_event_participants")
    op.drop_index("ix_calendar_event_participants_team_id", table_name="calendar_event_participants")
    op.drop_index("ix_calendar_event_participants_user_id", table_name="calendar_event_participants")
    op.drop_index("ix_calendar_event_participants_participant_key", table_name="calendar_event_participants")
    op.drop_index("ix_calendar_event_participants_participant_type", table_name="calendar_event_participants")
    op.drop_index("ix_calendar_event_participants_event_id", table_name="calendar_event_participants")
    op.drop_index("ix_calendar_event_participants_tenant_id", table_name="calendar_event_participants")
    op.drop_index("ix_calendar_event_participants_id", table_name="calendar_event_participants")
    op.drop_table("calendar_event_participants")

    op.drop_index("ix_calendar_events_deleted_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_created_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_source_entity_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_source_module_key", table_name="calendar_events")
    op.drop_index("ix_calendar_events_status", table_name="calendar_events")
    op.drop_index("ix_calendar_events_end_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_start_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_title", table_name="calendar_events")
    op.drop_index("ix_calendar_events_owner_user_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_tenant_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_id", table_name="calendar_events")
    op.drop_table("calendar_events")

    op.drop_index("ix_user_calendar_connections_status", table_name="user_calendar_connections")
    op.drop_index("ix_user_calendar_connections_provider", table_name="user_calendar_connections")
    op.drop_index("ix_user_calendar_connections_user_id", table_name="user_calendar_connections")
    op.drop_index("ix_user_calendar_connections_tenant_id", table_name="user_calendar_connections")
    op.drop_index("ix_user_calendar_connections_id", table_name="user_calendar_connections")
    op.drop_table("user_calendar_connections")

    op.drop_index("ix_users_last_login_provider", table_name="users")
    op.drop_column("users", "last_login_provider")
