"""add tasks module foundation

Revision ID: 20260422_tasks_module
Revises: 20260422_cf_uniqs
Create Date: 2026-04-22 01:30:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260422_tasks_module"
down_revision = "20260422_cf_uniqs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="todo"),
        sa.Column("priority", sa.String(length=32), nullable=False, server_default="medium"),
        sa.Column("start_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tasks_id", "tasks", ["id"])
    op.create_index("ix_tasks_tenant_id", "tasks", ["tenant_id"])
    op.create_index("ix_tasks_title", "tasks", ["title"])
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_priority", "tasks", ["priority"])
    op.create_index("ix_tasks_due_at", "tasks", ["due_at"])
    op.create_index("ix_tasks_created_by_user_id", "tasks", ["created_by_user_id"])
    op.create_index("ix_tasks_updated_by_user_id", "tasks", ["updated_by_user_id"])
    op.create_index("ix_tasks_created_at", "tasks", ["created_at"])
    op.create_index("ix_tasks_deleted_at", "tasks", ["deleted_at"])

    op.create_table(
        "task_assignees",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("task_id", sa.BigInteger(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("assignee_type", sa.String(length=20), nullable=False),
        sa.Column("assignee_key", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("team_id", sa.BigInteger(), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("tenant_id", "task_id", "assignee_key", name="uq_task_assignees_task_key"),
    )
    op.create_index("ix_task_assignees_id", "task_assignees", ["id"])
    op.create_index("ix_task_assignees_tenant_id", "task_assignees", ["tenant_id"])
    op.create_index("ix_task_assignees_task_id", "task_assignees", ["task_id"])
    op.create_index("ix_task_assignees_assignee_type", "task_assignees", ["assignee_type"])
    op.create_index("ix_task_assignees_assignee_key", "task_assignees", ["assignee_key"])
    op.create_index("ix_task_assignees_user_id", "task_assignees", ["user_id"])
    op.create_index("ix_task_assignees_team_id", "task_assignees", ["team_id"])

    op.execute(
        """
        INSERT INTO modules (name, base_route, description, is_enabled, import_duplicate_mode)
        VALUES ('tasks', '/dashboard/tasks', 'Collaborative task management and assignment', 1, 'skip')
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
        WHERE modules.name = 'tasks'
        ON CONFLICT (tenant_id, module_id) DO NOTHING
        """
    )

    op.execute(
        """
        INSERT INTO department_module_permissions (department_id, module_id)
        SELECT departments.id, modules.id
        FROM departments
        CROSS JOIN modules
        WHERE modules.name = 'tasks'
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
        WHERE modules.name = 'tasks'
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
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
            0,
            CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
        FROM roles
        CROSS JOIN modules
        WHERE modules.name = 'tasks'
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
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'tasks')
        """
    )
    op.execute(
        """
        DELETE FROM team_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'tasks')
        """
    )
    op.execute(
        """
        DELETE FROM department_module_permissions
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'tasks')
        """
    )
    op.execute(
        """
        DELETE FROM tenant_module_configs
        WHERE module_id IN (SELECT id FROM modules WHERE name = 'tasks')
        """
    )
    op.execute("DELETE FROM modules WHERE name = 'tasks'")

    op.drop_index("ix_task_assignees_team_id", table_name="task_assignees")
    op.drop_index("ix_task_assignees_user_id", table_name="task_assignees")
    op.drop_index("ix_task_assignees_assignee_key", table_name="task_assignees")
    op.drop_index("ix_task_assignees_assignee_type", table_name="task_assignees")
    op.drop_index("ix_task_assignees_task_id", table_name="task_assignees")
    op.drop_index("ix_task_assignees_tenant_id", table_name="task_assignees")
    op.drop_index("ix_task_assignees_id", table_name="task_assignees")
    op.drop_table("task_assignees")

    op.drop_index("ix_tasks_deleted_at", table_name="tasks")
    op.drop_index("ix_tasks_created_at", table_name="tasks")
    op.drop_index("ix_tasks_updated_by_user_id", table_name="tasks")
    op.drop_index("ix_tasks_created_by_user_id", table_name="tasks")
    op.drop_index("ix_tasks_due_at", table_name="tasks")
    op.drop_index("ix_tasks_priority", table_name="tasks")
    op.drop_index("ix_tasks_status", table_name="tasks")
    op.drop_index("ix_tasks_title", table_name="tasks")
    op.drop_index("ix_tasks_tenant_id", table_name="tasks")
    op.drop_index("ix_tasks_id", table_name="tasks")
    op.drop_table("tasks")
