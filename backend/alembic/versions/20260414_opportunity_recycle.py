"""add recycle support to sales opportunities

Revision ID: 20260414_opportunity_recycle
Revises: 20260414_role_permissions
Create Date: 2026-04-14 13:05:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_opportunity_recycle"
down_revision = "20260414_role_permissions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sales_opportunities",
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sales_opportunities", "deleted_at")
