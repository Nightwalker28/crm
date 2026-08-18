"""add tenant record layout definitions

Revision ID: 20260810_record_layouts
Revises: 20260810_booking_handles
Create Date: 2026-08-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260810_record_layouts"
down_revision: Union[str, None] = "20260810_booking_handles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "record_layout_definitions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("surface", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("is_default", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("sections", sa.JSON(), server_default="[]", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "surface IN ('quick_create', 'detail', 'full_form')",
            name="ck_record_layout_definitions_surface",
        ),
        sa.CheckConstraint("version >= 1", name="ck_record_layout_definitions_version"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "tenant_id",
            "module_key",
            "surface",
            "name",
            name="uq_record_layout_defs_tenant_module_surface_name",
        ),
    )
    op.create_index("ix_record_layout_definitions_id", "record_layout_definitions", ["id"], unique=False)
    op.create_index("ix_record_layout_definitions_tenant_id", "record_layout_definitions", ["tenant_id"], unique=False)
    op.create_index("ix_record_layout_definitions_module_key", "record_layout_definitions", ["module_key"], unique=False)
    op.create_index("ix_record_layout_definitions_surface", "record_layout_definitions", ["surface"], unique=False)
    op.create_index(
        "ix_record_layout_defs_tenant_module_surface",
        "record_layout_definitions",
        ["tenant_id", "module_key", "surface"],
        unique=False,
    )
    op.create_index(
        "uq_record_layout_defs_default",
        "record_layout_definitions",
        ["tenant_id", "module_key", "surface"],
        unique=True,
        postgresql_where=sa.text("is_default"),
        sqlite_where=sa.text("is_default = 1"),
    )


def downgrade() -> None:
    op.drop_index("uq_record_layout_defs_default", table_name="record_layout_definitions")
    op.drop_index("ix_record_layout_defs_tenant_module_surface", table_name="record_layout_definitions")
    op.drop_index("ix_record_layout_definitions_surface", table_name="record_layout_definitions")
    op.drop_index("ix_record_layout_definitions_module_key", table_name="record_layout_definitions")
    op.drop_index("ix_record_layout_definitions_tenant_id", table_name="record_layout_definitions")
    op.drop_index("ix_record_layout_definitions_id", table_name="record_layout_definitions")
    op.drop_table("record_layout_definitions")
