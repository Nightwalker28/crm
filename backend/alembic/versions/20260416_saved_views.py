"""add user saved views

Revision ID: 20260416_saved_views
Revises: 20260415_company_currencies
Create Date: 2026-04-16
"""

from alembic import op
import sqlalchemy as sa


revision = "20260416_saved_views"
down_revision = "20260415_company_currencies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_saved_views",
        sa.Column("id", sa.BigInteger(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False, server_default=sa.text("'{}'::json")),
        sa.Column("is_default", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
    )
    op.create_index("ix_user_saved_views_id", "user_saved_views", ["id"])
    op.create_index("ix_user_saved_views_user_id", "user_saved_views", ["user_id"])
    op.create_index("ix_user_saved_views_module_key", "user_saved_views", ["module_key"])


def downgrade() -> None:
    op.drop_index("ix_user_saved_views_module_key", table_name="user_saved_views")
    op.drop_index("ix_user_saved_views_user_id", table_name="user_saved_views")
    op.drop_index("ix_user_saved_views_id", table_name="user_saved_views")
    op.drop_table("user_saved_views")
