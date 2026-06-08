"""add tenant backup settings

Revision ID: 20260624_tenant_backup_settings
Revises: 20260623_integration_registry
Create Date: 2026-06-08
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260624_tenant_backup_settings"
down_revision: Union[str, None] = "20260623_integration_registry"
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
    if not _table_exists(bind, "tenant_backup_settings"):
        op.create_table(
            "tenant_backup_settings",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
            sa.Column("frequency", sa.String(length=20), server_default="manual", nullable=False),
            sa.Column("scope", sa.String(length=30), server_default="full_tenant", nullable=False),
            sa.Column("selected_modules", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
            sa.Column("retention_count", sa.Integer(), server_default="3", nullable=False),
            sa.Column("destination", sa.String(length=30), server_default="local_download", nullable=False),
            sa.Column("include_documents", sa.Boolean(), server_default=sa.text("true"), nullable=False),
            sa.Column("created_by_id", sa.BigInteger(), nullable=True),
            sa.Column("updated_by_id", sa.BigInteger(), nullable=True),
            sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("frequency IN ('manual', 'daily', 'weekly', 'monthly')", name="ck_tenant_backup_settings_frequency"),
            sa.CheckConstraint("scope IN ('full_tenant', 'selected_modules')", name="ck_tenant_backup_settings_scope"),
            sa.CheckConstraint("destination IN ('local_download', 'google_drive', 'onedrive')", name="ck_tenant_backup_settings_destination"),
            sa.CheckConstraint("retention_count IN (3, 7, 14, 30)", name="ck_tenant_backup_settings_retention"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", name="uq_tenant_backup_settings_tenant"),
        )

    indexes = [
        ("ix_tenant_backup_settings_id", ["id"]),
        ("ix_tenant_backup_settings_tenant_id", ["tenant_id"]),
        ("ix_tenant_backup_settings_created_by_id", ["created_by_id"]),
        ("ix_tenant_backup_settings_updated_by_id", ["updated_by_id"]),
        ("ix_tenant_backup_settings_tenant_updated", ["tenant_id", "updated_at"]),
    ]
    for index_name, columns in indexes:
        if not _index_exists(bind, "tenant_backup_settings", index_name):
            op.create_index(index_name, "tenant_backup_settings", columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "tenant_backup_settings"):
        for index_name in (
            "ix_tenant_backup_settings_tenant_updated",
            "ix_tenant_backup_settings_updated_by_id",
            "ix_tenant_backup_settings_created_by_id",
            "ix_tenant_backup_settings_tenant_id",
            "ix_tenant_backup_settings_id",
        ):
            if _index_exists(bind, "tenant_backup_settings", index_name):
                op.drop_index(index_name, table_name="tenant_backup_settings")
        op.drop_table("tenant_backup_settings")
