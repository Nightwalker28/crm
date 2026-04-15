"""add module enable flag

Revision ID: 20260415_module_enable
Revises: 20260415_tbl_prefs
Create Date: 2026-04-15
"""

from alembic import op
import sqlalchemy as sa


revision = "20260415_module_enable"
down_revision = "20260415_tbl_prefs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "modules",
        sa.Column("is_enabled", sa.SmallInteger(), nullable=False, server_default="1"),
    )
    op.execute("UPDATE modules SET is_enabled = 1 WHERE is_enabled IS NULL")
    op.alter_column("modules", "is_enabled", server_default=None)


def downgrade() -> None:
    op.drop_column("modules", "is_enabled")
