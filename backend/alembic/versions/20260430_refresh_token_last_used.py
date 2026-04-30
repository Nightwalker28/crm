"""Add refresh token last-used timestamp

Revision ID: 20260430_refresh_last_used
Revises: 20260428_slack_alerts
Create Date: 2026-04-30
"""

from alembic import op
import sqlalchemy as sa


revision = "20260430_refresh_last_used"
down_revision = "20260428_slack_alerts"
branch_labels = None
depends_on = None


def _table_exists(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    columns = sa.inspect(bind).get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "refresh_tokens"):
        return
    if not _column_exists(bind, "refresh_tokens", "last_used_at"):
        op.add_column(
            "refresh_tokens",
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "refresh_tokens") and _column_exists(
        bind,
        "refresh_tokens",
        "last_used_at",
    ):
        op.drop_column("refresh_tokens", "last_used_at")
