"""add generic system records

Revision ID: 20260605_generic_records
Revises: 20260604_perf_indexes
Create Date: 2026-05-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260605_generic_records"
down_revision: Union[str, None] = "20260604_perf_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "generic_system_records",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=80), nullable=True),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_generic_system_records_id", "generic_system_records", ["id"])
    op.create_index("ix_generic_system_records_tenant_id", "generic_system_records", ["tenant_id"])
    op.create_index("ix_generic_system_records_module_key", "generic_system_records", ["module_key"])
    op.create_index("ix_generic_system_records_status", "generic_system_records", ["status"])
    op.create_index("ix_generic_system_records_created_at", "generic_system_records", ["created_at"])
    op.create_index("ix_generic_system_records_deleted_at", "generic_system_records", ["deleted_at"])
    op.create_index(
        "ix_generic_system_records_tenant_module_deleted",
        "generic_system_records",
        ["tenant_id", "module_key", "deleted_at"],
    )
    op.create_index(
        "ix_generic_system_records_tenant_module_title",
        "generic_system_records",
        ["tenant_id", "module_key", "title"],
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_generic_system_records_active_tenant_id_desc "
        "ON generic_system_records (tenant_id, module_key, id DESC) WHERE deleted_at IS NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_generic_system_records_deleted_tenant_deleted_desc "
        "ON generic_system_records (tenant_id, module_key, deleted_at DESC, id DESC) WHERE deleted_at IS NOT NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_generic_system_records_deleted_tenant_deleted_desc")
    op.execute("DROP INDEX IF EXISTS ix_generic_system_records_active_tenant_id_desc")
    op.drop_index("ix_generic_system_records_tenant_module_title", table_name="generic_system_records")
    op.drop_index("ix_generic_system_records_tenant_module_deleted", table_name="generic_system_records")
    op.drop_index("ix_generic_system_records_deleted_at", table_name="generic_system_records")
    op.drop_index("ix_generic_system_records_created_at", table_name="generic_system_records")
    op.drop_index("ix_generic_system_records_status", table_name="generic_system_records")
    op.drop_index("ix_generic_system_records_module_key", table_name="generic_system_records")
    op.drop_index("ix_generic_system_records_tenant_id", table_name="generic_system_records")
    op.drop_index("ix_generic_system_records_id", table_name="generic_system_records")
    op.drop_table("generic_system_records")

