"""add catalog services

Revision ID: 20260524_catalog_services
Revises: 20260523_catalog_products
Create Date: 2026-05-11
"""

from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260524_catalog_services"
down_revision: Union[str, None] = "20260523_catalog_products"
branch_labels: Union[str, tuple[str, ...], None] = None
depends_on: Union[str, tuple[str, ...], None] = None


def upgrade() -> None:
    op.create_table(
        "catalog_services",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(length=3), server_default="USD", nullable=False),
        sa.Column("public_unit_price", sa.Numeric(12, 4), server_default="0", nullable=False),
        sa.Column("is_active", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("media_path", sa.String(length=500), nullable=True),
        sa.Column("media_content_type", sa.String(length=120), nullable=True),
        sa.Column("media_original_filename", sa.String(length=255), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("public_unit_price >= 0", name="ck_catalog_services_public_price_nonnegative"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_catalog_services_id", "catalog_services", ["id"])
    op.create_index("ix_catalog_services_tenant_id", "catalog_services", ["tenant_id"])
    op.create_index("ix_catalog_services_name", "catalog_services", ["name"])
    op.create_index("ix_catalog_services_is_active", "catalog_services", ["is_active"])
    op.create_index("ix_catalog_services_created_by_user_id", "catalog_services", ["created_by_user_id"])
    op.create_index("ix_catalog_services_updated_by_user_id", "catalog_services", ["updated_by_user_id"])
    op.create_index("ix_catalog_services_created_at", "catalog_services", ["created_at"])
    op.create_index("ix_catalog_services_updated_at", "catalog_services", ["updated_at"])
    op.create_index("ix_catalog_services_deleted_at", "catalog_services", ["deleted_at"])
    op.create_index(
        "ix_catalog_services_active_tenant",
        "catalog_services",
        ["tenant_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_catalog_services_tenant_active",
        "catalog_services",
        ["tenant_id", "is_active"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_table("catalog_services")
