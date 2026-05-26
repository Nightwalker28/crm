"""add user dashboard layouts

Revision ID: 20260613_dashboard_layouts
Revises: 20260612_crm_admin_modules
Create Date: 2026-05-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260613_dashboard_layouts"
down_revision: Union[str, None] = "20260612_crm_admin_modules"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_dashboard_layouts",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("layout", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "user_id", name="uq_user_dashboard_layouts_tenant_user"),
    )
    op.create_index("ix_user_dashboard_layouts_id", "user_dashboard_layouts", ["id"], unique=False)
    op.create_index("ix_user_dashboard_layouts_tenant_id", "user_dashboard_layouts", ["tenant_id"], unique=False)
    op.create_index("ix_user_dashboard_layouts_user_id", "user_dashboard_layouts", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_dashboard_layouts_user_id", table_name="user_dashboard_layouts")
    op.drop_index("ix_user_dashboard_layouts_tenant_id", table_name="user_dashboard_layouts")
    op.drop_index("ix_user_dashboard_layouts_id", table_name="user_dashboard_layouts")
    op.drop_table("user_dashboard_layouts")
