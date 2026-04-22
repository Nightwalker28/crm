"""add calendar provider calendar fields

Revision ID: 20260422_cal_sync
Revises: 20260422_calendar_foundation
Create Date: 2026-04-22 13:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260422_cal_sync"
down_revision = "20260422_calendar_foundation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_calendar_connections",
        sa.Column("provider_calendar_id", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "user_calendar_connections",
        sa.Column("provider_calendar_name", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("user_calendar_connections", "provider_calendar_name")
    op.drop_column("user_calendar_connections", "provider_calendar_id")
