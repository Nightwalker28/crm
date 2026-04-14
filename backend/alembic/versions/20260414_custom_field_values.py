"""add relational custom field values

Revision ID: 20260414_custom_field_values
Revises: 20260414_finance_generic_cleanup
Create Date: 2026-04-14 19:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_custom_field_values"
down_revision = "20260414_finance_generic_cleanup"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_field_values",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("record_id", sa.BigInteger(), nullable=False),
        sa.Column("field_definition_id", sa.BigInteger(), nullable=False),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_number", sa.JSON(), nullable=True),
        sa.Column("value_date", sa.String(length=20), nullable=True),
        sa.Column("value_boolean", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["field_definition_id"], ["custom_field_definitions.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_custom_field_values_module_key", "custom_field_values", ["module_key"], unique=False)
    op.create_index("ix_custom_field_values_record_id", "custom_field_values", ["record_id"], unique=False)
    op.create_index("ix_custom_field_values_field_definition_id", "custom_field_values", ["field_definition_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_custom_field_values_field_definition_id", table_name="custom_field_values")
    op.drop_index("ix_custom_field_values_record_id", table_name="custom_field_values")
    op.drop_index("ix_custom_field_values_module_key", table_name="custom_field_values")
    op.drop_table("custom_field_values")
