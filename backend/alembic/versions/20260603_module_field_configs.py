"""add tenant module field configs

Revision ID: 20260603_module_fields
Revises: 20260602_finance_pos_cleanup
Create Date: 2026-05-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260603_module_fields"
down_revision: Union[str, None] = "20260602_finance_pos_cleanup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "module_field_configs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("field_key", sa.String(length=150), nullable=False),
        sa.Column("label", sa.String(length=150), nullable=False),
        sa.Column("field_type", sa.String(length=50), nullable=True),
        sa.Column("field_source", sa.String(length=40), server_default="system", nullable=False),
        sa.Column("is_enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("is_protected", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "module_key", "field_key", name="uq_module_field_configs_tenant_module_field"),
    )
    op.create_index("ix_module_field_configs_id", "module_field_configs", ["id"])
    op.create_index("ix_module_field_configs_tenant_id", "module_field_configs", ["tenant_id"])
    op.create_index("ix_module_field_configs_module_key", "module_field_configs", ["module_key"])
    op.create_index("ix_module_field_configs_field_key", "module_field_configs", ["field_key"])
    op.create_index("ix_module_field_configs_tenant_module", "module_field_configs", ["tenant_id", "module_key", "is_enabled"])


def downgrade() -> None:
    op.drop_index("ix_module_field_configs_tenant_module", table_name="module_field_configs")
    op.drop_index("ix_module_field_configs_field_key", table_name="module_field_configs")
    op.drop_index("ix_module_field_configs_module_key", table_name="module_field_configs")
    op.drop_index("ix_module_field_configs_tenant_id", table_name="module_field_configs")
    op.drop_index("ix_module_field_configs_id", table_name="module_field_configs")
    op.drop_table("module_field_configs")
