"""add user table preferences

Revision ID: 20260415_tbl_prefs
Revises: 20260415_rm_cf_json
Create Date: 2026-04-15 12:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260415_tbl_prefs"
down_revision = "20260415_rm_cf_json"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_table_preferences",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("visible_columns", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_user_table_preferences_user_id", "user_table_preferences", ["user_id"], unique=False)
    op.create_index("ix_user_table_preferences_module_key", "user_table_preferences", ["module_key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_table_preferences_module_key", table_name="user_table_preferences")
    op.drop_index("ix_user_table_preferences_user_id", table_name="user_table_preferences")
    op.drop_table("user_table_preferences")
