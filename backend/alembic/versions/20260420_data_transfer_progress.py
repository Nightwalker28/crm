"""add data transfer progress fields

Revision ID: 20260420_data_transfer_progress
Revises: 20260419_user_notifications
Create Date: 2026-04-20
"""

from alembic import op
import sqlalchemy as sa


revision = "20260420_data_transfer_progress"
down_revision = "20260419_user_notifications"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "data_transfer_jobs",
        sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "data_transfer_jobs",
        sa.Column("progress_message", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("data_transfer_jobs", "progress_message")
    op.drop_column("data_transfer_jobs", "progress_percent")
