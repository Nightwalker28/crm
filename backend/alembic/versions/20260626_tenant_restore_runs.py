"""add tenant restore runs

Revision ID: 20260626_tenant_restore_runs
Revises: 20260625_tenant_backup_runs
Create Date: 2026-06-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260626_tenant_restore_runs"
down_revision: Union[str, None] = "20260625_tenant_backup_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "tenant_restore_runs"):
        op.create_table(
            "tenant_restore_runs",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
            sa.Column("source_backup_run_id", sa.BigInteger(), nullable=True),
            sa.Column("restore_type", sa.String(length=30), server_default="tenant_module", nullable=False),
            sa.Column("module_key", sa.String(length=100), nullable=False),
            sa.Column("mode", sa.String(length=30), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("summary", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("restore_type = 'tenant_module'", name="ck_tenant_restore_runs_type"),
            sa.CheckConstraint(
                "mode IN ('preview_only', 'create_missing', 'update_existing', 'skip_duplicates', 'replace_module_data')",
                name="ck_tenant_restore_runs_mode",
            ),
            sa.CheckConstraint("status IN ('previewed', 'running', 'completed', 'failed')", name="ck_tenant_restore_runs_status"),
            sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["source_backup_run_id"], ["tenant_backup_runs.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = [
        ("ix_tenant_restore_runs_id", ["id"]),
        ("ix_tenant_restore_runs_tenant_id", ["tenant_id"]),
        ("ix_tenant_restore_runs_actor_user_id", ["actor_user_id"]),
        ("ix_tenant_restore_runs_source_backup_run_id", ["source_backup_run_id"]),
        ("ix_tenant_restore_runs_module_key", ["module_key"]),
        ("ix_tenant_restore_runs_status", ["status"]),
        ("ix_tenant_restore_runs_created_at", ["created_at"]),
        ("ix_tenant_restore_runs_tenant_status", ["tenant_id", "status"]),
        ("ix_tenant_restore_runs_tenant_created", ["tenant_id", "created_at"]),
    ]
    for index_name, columns in indexes:
        if not _index_exists(bind, "tenant_restore_runs", index_name):
            op.create_index(index_name, "tenant_restore_runs", columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "tenant_restore_runs"):
        for index_name in (
            "ix_tenant_restore_runs_tenant_created",
            "ix_tenant_restore_runs_tenant_status",
            "ix_tenant_restore_runs_created_at",
            "ix_tenant_restore_runs_status",
            "ix_tenant_restore_runs_module_key",
            "ix_tenant_restore_runs_source_backup_run_id",
            "ix_tenant_restore_runs_actor_user_id",
            "ix_tenant_restore_runs_tenant_id",
            "ix_tenant_restore_runs_id",
        ):
            if _index_exists(bind, "tenant_restore_runs", index_name):
                op.drop_index(index_name, table_name="tenant_restore_runs")
        op.drop_table("tenant_restore_runs")
