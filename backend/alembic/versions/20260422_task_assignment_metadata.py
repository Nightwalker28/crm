"""add task assignment metadata

Revision ID: 20260422_task_assign_meta
Revises: 20260422_tasks_module
Create Date: 2026-04-22 03:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260422_task_assign_meta"
down_revision = "20260422_tasks_module"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tasks",
        sa.Column("assigned_by_user_id", sa.BigInteger(), nullable=True),
    )
    op.add_column(
        "tasks",
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_tasks_assigned_by_user_id", "tasks", ["assigned_by_user_id"])
    op.create_index("ix_tasks_assigned_at", "tasks", ["assigned_at"])
    op.create_foreign_key(
        "fk_tasks_assigned_by_user_id_users",
        "tasks",
        "users",
        ["assigned_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(
        """
        UPDATE tasks
        SET assigned_by_user_id = created_by_user_id,
            assigned_at = created_at
        WHERE EXISTS (
            SELECT 1
            FROM task_assignees
            WHERE task_assignees.task_id = tasks.id
        )
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_tasks_assigned_by_user_id_users", "tasks", type_="foreignkey")
    op.drop_index("ix_tasks_assigned_at", table_name="tasks")
    op.drop_index("ix_tasks_assigned_by_user_id", table_name="tasks")
    op.drop_column("tasks", "assigned_at")
    op.drop_column("tasks", "assigned_by_user_id")
