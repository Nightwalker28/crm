"""add tenant custom module runtime storage

Revision ID: 20260528_custom_modules
Revises: 20260527_website_order_pos_link
Create Date: 2026-05-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260528_custom_modules"
down_revision: Union[str, None] = "20260527_website_order_pos_link"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "custom_module_definitions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(length=80), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("module_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["module_id"], ["modules.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "key", name="uq_custom_module_definitions_tenant_key"),
    )
    op.create_index("ix_custom_module_definitions_id", "custom_module_definitions", ["id"])
    op.create_index("ix_custom_module_definitions_key", "custom_module_definitions", ["key"])
    op.create_index("ix_custom_module_definitions_module_id", "custom_module_definitions", ["module_id"])
    op.create_index("ix_custom_module_definitions_tenant_id", "custom_module_definitions", ["tenant_id"])
    op.create_index("ix_custom_module_definitions_tenant_active", "custom_module_definitions", ["tenant_id", "is_active", "deleted_at"])

    op.create_table(
        "custom_module_field_definitions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("custom_module_id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("label", sa.String(length=150), nullable=False),
        sa.Column("field_type", sa.String(length=40), nullable=False),
        sa.Column("help_text", sa.Text(), nullable=True),
        sa.Column("placeholder", sa.String(length=255), nullable=True),
        sa.Column("is_required", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("is_unique", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("display_in_list", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("default_value", sa.JSON(), nullable=True),
        sa.Column("validation_json", sa.JSON(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["custom_module_id"], ["custom_module_definitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("custom_module_id", "key", name="uq_custom_module_field_definitions_module_key"),
    )
    op.create_index("ix_custom_module_field_definitions_id", "custom_module_field_definitions", ["id"])
    op.create_index("ix_custom_module_field_definitions_tenant_module", "custom_module_field_definitions", ["tenant_id", "custom_module_id", "is_active", "deleted_at"])

    op.create_table(
        "custom_module_records",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("custom_module_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["custom_module_id"], ["custom_module_definitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_custom_module_records_id", "custom_module_records", ["id"])
    op.create_index("ix_custom_module_records_tenant_module_deleted", "custom_module_records", ["tenant_id", "custom_module_id", "deleted_at"])
    op.create_index("ix_custom_module_records_tenant_title", "custom_module_records", ["tenant_id", "custom_module_id", "title"])

    op.create_table(
        "custom_module_record_values",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("custom_module_id", sa.BigInteger(), nullable=False),
        sa.Column("record_id", sa.BigInteger(), nullable=False),
        sa.Column("field_id", sa.BigInteger(), nullable=False),
        sa.Column("text_value", sa.Text(), nullable=True),
        sa.Column("number_value", sa.Numeric(18, 4), nullable=True),
        sa.Column("datetime_value", sa.DateTime(timezone=True), nullable=True),
        sa.Column("boolean_value", sa.Boolean(), nullable=True),
        sa.Column("json_value", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["custom_module_id"], ["custom_module_definitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["field_id"], ["custom_module_field_definitions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["record_id"], ["custom_module_records.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("record_id", "field_id", name="uq_custom_module_record_values_record_field"),
    )
    op.create_index("ix_custom_module_record_values_id", "custom_module_record_values", ["id"])
    op.create_index("ix_custom_module_record_values_field_text", "custom_module_record_values", ["field_id", "text_value"])
    op.create_index("ix_custom_module_record_values_field_number", "custom_module_record_values", ["field_id", "number_value"])
    op.create_index("ix_custom_module_record_values_field_datetime", "custom_module_record_values", ["field_id", "datetime_value"])
    op.create_index("ix_custom_module_record_values_field_boolean", "custom_module_record_values", ["field_id", "boolean_value"])
    op.create_index("ix_custom_module_record_values_tenant_module", "custom_module_record_values", ["tenant_id", "custom_module_id"])


def downgrade() -> None:
    op.drop_index("ix_custom_module_record_values_tenant_module", table_name="custom_module_record_values")
    op.drop_index("ix_custom_module_record_values_field_boolean", table_name="custom_module_record_values")
    op.drop_index("ix_custom_module_record_values_field_datetime", table_name="custom_module_record_values")
    op.drop_index("ix_custom_module_record_values_field_number", table_name="custom_module_record_values")
    op.drop_index("ix_custom_module_record_values_field_text", table_name="custom_module_record_values")
    op.drop_index("ix_custom_module_record_values_id", table_name="custom_module_record_values")
    op.drop_table("custom_module_record_values")
    op.drop_index("ix_custom_module_records_tenant_title", table_name="custom_module_records")
    op.drop_index("ix_custom_module_records_tenant_module_deleted", table_name="custom_module_records")
    op.drop_index("ix_custom_module_records_id", table_name="custom_module_records")
    op.drop_table("custom_module_records")
    op.drop_index("ix_custom_module_field_definitions_tenant_module", table_name="custom_module_field_definitions")
    op.drop_index("ix_custom_module_field_definitions_id", table_name="custom_module_field_definitions")
    op.drop_table("custom_module_field_definitions")
    op.drop_index("ix_custom_module_definitions_tenant_active", table_name="custom_module_definitions")
    op.drop_index("ix_custom_module_definitions_tenant_id", table_name="custom_module_definitions")
    op.drop_index("ix_custom_module_definitions_module_id", table_name="custom_module_definitions")
    op.drop_index("ix_custom_module_definitions_key", table_name="custom_module_definitions")
    op.drop_index("ix_custom_module_definitions_id", table_name="custom_module_definitions")
    op.drop_table("custom_module_definitions")
