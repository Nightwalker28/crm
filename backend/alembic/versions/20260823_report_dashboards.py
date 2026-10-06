"""report dashboards: pages of saved reports, private or shared

Revision ID: 20260823_report_dashboards
Revises: 20260822_report_sharing
Create Date: 2026-10-01

11-reports.md Phase 2. A new table with no existing rows to carry. Widgets reference saved
reports by ID inside JSON rather than through a foreign key: a deleted report leaves its
widget showing "no longer available" instead of silently vanishing from someone else's
dashboard, which is how Salesforce treats a component whose source report is gone.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260823_report_dashboards"
down_revision: Union[str, None] = "20260822_report_sharing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "report_dashboards",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("visibility", sa.String(length=20), nullable=False, server_default="private"),
        sa.Column("widgets", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("filters", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_report_dashboards_user_name"),
        sa.CheckConstraint("visibility IN ('private', 'everyone')", name="ck_report_dashboards_visibility"),
    )
    op.create_index("ix_report_dashboards_id", "report_dashboards", ["id"])
    op.create_index("ix_report_dashboards_tenant_id", "report_dashboards", ["tenant_id"])
    op.create_index("ix_report_dashboards_user_id", "report_dashboards", ["user_id"])
    op.create_index("ix_report_dashboards_tenant_visibility", "report_dashboards", ["tenant_id", "visibility"])


def downgrade() -> None:
    op.drop_index("ix_report_dashboards_tenant_visibility", table_name="report_dashboards")
    op.drop_index("ix_report_dashboards_user_id", table_name="report_dashboards")
    op.drop_index("ix_report_dashboards_tenant_id", table_name="report_dashboards")
    op.drop_index("ix_report_dashboards_id", table_name="report_dashboards")
    op.drop_table("report_dashboards")
