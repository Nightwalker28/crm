"""add saved module reports

Revision ID: 20260609_module_reports
Revises: 20260608_sales_leads
Create Date: 2026-05-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260609_module_reports"
down_revision: Union[str, None] = "20260608_sales_leads"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_module_reports",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("config", sa.JSON(), server_default=sa.text("'{}'::json"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "module_key", "name", name="uq_user_module_reports_user_module_name"),
    )
    op.create_index("ix_user_module_reports_id", "user_module_reports", ["id"])
    op.create_index("ix_user_module_reports_tenant_id", "user_module_reports", ["tenant_id"])
    op.create_index("ix_user_module_reports_user_id", "user_module_reports", ["user_id"])
    op.create_index("ix_user_module_reports_module_key", "user_module_reports", ["module_key"])
    op.create_index(
        "ix_user_module_reports_tenant_user_module",
        "user_module_reports",
        ["tenant_id", "user_id", "module_key"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_module_reports_tenant_user_module", table_name="user_module_reports")
    op.drop_index("ix_user_module_reports_module_key", table_name="user_module_reports")
    op.drop_index("ix_user_module_reports_user_id", table_name="user_module_reports")
    op.drop_index("ix_user_module_reports_tenant_id", table_name="user_module_reports")
    op.drop_index("ix_user_module_reports_id", table_name="user_module_reports")
    op.drop_table("user_module_reports")
