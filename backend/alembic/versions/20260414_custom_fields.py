"""add custom field definitions and record custom data

Revision ID: 20260414_custom_fields
Revises: 20260414_opportunity_recycle
Create Date: 2026-04-14 14:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_custom_fields"
down_revision = "20260414_opportunity_recycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "custom_field_definitions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("field_key", sa.String(length=100), nullable=False),
        sa.Column("label", sa.String(length=150), nullable=False),
        sa.Column("field_type", sa.String(length=50), nullable=False),
        sa.Column("placeholder", sa.String(length=255), nullable=True),
        sa.Column("help_text", sa.Text(), nullable=True),
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_custom_field_definitions_module_key", "custom_field_definitions", ["module_key"], unique=False)
    op.create_index("ix_custom_field_definitions_field_key", "custom_field_definitions", ["field_key"], unique=False)

    op.add_column("finance_io", sa.Column("custom_data", sa.JSON(), nullable=True))
    op.add_column("sales_contacts", sa.Column("custom_data", sa.JSON(), nullable=True))
    op.add_column("sales_opportunities", sa.Column("custom_data", sa.JSON(), nullable=True))
    op.add_column("sales_organizations", sa.Column("custom_data", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("sales_organizations", "custom_data")
    op.drop_column("sales_opportunities", "custom_data")
    op.drop_column("sales_contacts", "custom_data")
    op.drop_column("finance_io", "custom_data")
    op.drop_index("ix_custom_field_definitions_field_key", table_name="custom_field_definitions")
    op.drop_index("ix_custom_field_definitions_module_key", table_name="custom_field_definitions")
    op.drop_table("custom_field_definitions")
