"""add tenant sidebar tab display config

Revision ID: 20260529_sidebar_tabs
Revises: 20260528_custom_modules
Create Date: 2026-05-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260529_sidebar_tabs"
down_revision: Union[str, None] = "20260528_custom_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenant_module_configs", sa.Column("sidebar_tab_key", sa.String(length=100), nullable=True))
    op.add_column("tenant_module_configs", sa.Column("display_name", sa.String(length=150), nullable=True))

    op.create_table(
        "tenant_sidebar_tabs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "key", name="uq_tenant_sidebar_tabs_tenant_key"),
    )
    op.create_index("ix_tenant_sidebar_tabs_id", "tenant_sidebar_tabs", ["id"])
    op.create_index("ix_tenant_sidebar_tabs_key", "tenant_sidebar_tabs", ["key"])
    op.create_index("ix_tenant_sidebar_tabs_tenant_id", "tenant_sidebar_tabs", ["tenant_id"])


def downgrade() -> None:
    op.drop_index("ix_tenant_sidebar_tabs_tenant_id", table_name="tenant_sidebar_tabs")
    op.drop_index("ix_tenant_sidebar_tabs_key", table_name="tenant_sidebar_tabs")
    op.drop_index("ix_tenant_sidebar_tabs_id", table_name="tenant_sidebar_tabs")
    op.drop_table("tenant_sidebar_tabs")
    op.drop_column("tenant_module_configs", "display_name")
    op.drop_column("tenant_module_configs", "sidebar_tab_key")
