"""add tenant backup runs

Revision ID: 20260625_tenant_backup_runs
Revises: 20260624_tenant_backup_settings
Create Date: 2026-06-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260625_tenant_backup_runs"
down_revision: Union[str, None] = "20260624_tenant_backup_settings"
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
    if not _table_exists(bind, "tenant_backup_runs"):
        op.create_table(
            "tenant_backup_runs",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("requested_by_user_id", sa.BigInteger(), nullable=True),
            sa.Column("settings_id", sa.BigInteger(), nullable=True),
            sa.Column("backup_type", sa.String(length=20), server_default="tenant", nullable=False),
            sa.Column("scope", sa.String(length=30), nullable=False),
            sa.Column("modules_included", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
            sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("file_path", sa.Text(), nullable=True),
            sa.Column("storage_ref", sa.Text(), nullable=True),
            sa.Column("size_bytes", sa.BigInteger(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("destination", sa.String(length=30), server_default="local_download", nullable=False),
            sa.Column("destination_upload_status", sa.String(length=30), server_default="not_applicable", nullable=False),
            sa.Column("metadata_json", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("backup_type = 'tenant'", name="ck_tenant_backup_runs_type"),
            sa.CheckConstraint("scope IN ('full_tenant', 'selected_modules')", name="ck_tenant_backup_runs_scope"),
            sa.CheckConstraint("status IN ('pending', 'running', 'completed', 'failed', 'cancelled')", name="ck_tenant_backup_runs_status"),
            sa.CheckConstraint("destination IN ('local_download', 'google_drive', 'onedrive')", name="ck_tenant_backup_runs_destination"),
            sa.CheckConstraint("destination_upload_status IN ('not_applicable', 'pending', 'uploaded', 'failed', 'expired')", name="ck_tenant_backup_runs_upload_status"),
            sa.ForeignKeyConstraint(["requested_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["settings_id"], ["tenant_backup_settings.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = [
        ("ix_tenant_backup_runs_id", ["id"]),
        ("ix_tenant_backup_runs_tenant_id", ["tenant_id"]),
        ("ix_tenant_backup_runs_requested_by_user_id", ["requested_by_user_id"]),
        ("ix_tenant_backup_runs_settings_id", ["settings_id"]),
        ("ix_tenant_backup_runs_status", ["status"]),
        ("ix_tenant_backup_runs_created_at", ["created_at"]),
        ("ix_tenant_backup_runs_tenant_status", ["tenant_id", "status"]),
        ("ix_tenant_backup_runs_tenant_created", ["tenant_id", "created_at"]),
    ]
    for index_name, columns in indexes:
        if not _index_exists(bind, "tenant_backup_runs", index_name):
            op.create_index(index_name, "tenant_backup_runs", columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "tenant_backup_runs"):
        for index_name in (
            "ix_tenant_backup_runs_tenant_created",
            "ix_tenant_backup_runs_tenant_status",
            "ix_tenant_backup_runs_created_at",
            "ix_tenant_backup_runs_status",
            "ix_tenant_backup_runs_settings_id",
            "ix_tenant_backup_runs_requested_by_user_id",
            "ix_tenant_backup_runs_tenant_id",
            "ix_tenant_backup_runs_id",
        ):
            if _index_exists(bind, "tenant_backup_runs", index_name):
                op.drop_index(index_name, table_name="tenant_backup_runs")
        op.drop_table("tenant_backup_runs")
