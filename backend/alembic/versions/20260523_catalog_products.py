"""add catalog products

Revision ID: 20260523_catalog_products
Revises: 20260522_catalog_foundation
Create Date: 2026-05-11
"""

from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260523_catalog_products"
down_revision: Union[str, None] = "20260522_catalog_foundation"
branch_labels: Union[str, tuple[str, ...], None] = None
depends_on: Union[str, tuple[str, ...], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "catalog_products"):
        return

    op.create_table(
        "catalog_products",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sku", sa.String(length=100), nullable=True),
        sa.Column("currency", sa.String(length=3), server_default="USD", nullable=False),
        sa.Column("public_unit_price", sa.Numeric(12, 4), server_default="0", nullable=False),
        sa.Column("stock_status", sa.String(length=20), server_default="untracked", nullable=False),
        sa.Column("stock_quantity", sa.Numeric(12, 4), nullable=True),
        sa.Column("is_active", sa.SmallInteger(), server_default="1", nullable=False),
        sa.Column("media_path", sa.String(length=500), nullable=True),
        sa.Column("media_content_type", sa.String(length=120), nullable=True),
        sa.Column("media_original_filename", sa.String(length=255), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("public_unit_price >= 0", name="ck_catalog_products_public_price_nonnegative"),
        sa.CheckConstraint("stock_quantity IS NULL OR stock_quantity >= 0", name="ck_catalog_products_stock_nonnegative"),
        sa.CheckConstraint(
            "stock_status IN ('untracked', 'in_stock', 'out_of_stock', 'preorder')",
            name="ck_catalog_products_stock_status",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "sku", name="uq_catalog_products_tenant_sku"),
    )
    op.create_index("ix_catalog_products_id", "catalog_products", ["id"])
    op.create_index("ix_catalog_products_tenant_id", "catalog_products", ["tenant_id"])
    op.create_index("ix_catalog_products_name", "catalog_products", ["name"])
    op.create_index("ix_catalog_products_sku", "catalog_products", ["sku"])
    op.create_index("ix_catalog_products_stock_status", "catalog_products", ["stock_status"])
    op.create_index("ix_catalog_products_is_active", "catalog_products", ["is_active"])
    op.create_index("ix_catalog_products_created_by_user_id", "catalog_products", ["created_by_user_id"])
    op.create_index("ix_catalog_products_updated_by_user_id", "catalog_products", ["updated_by_user_id"])
    op.create_index("ix_catalog_products_created_at", "catalog_products", ["created_at"])
    op.create_index("ix_catalog_products_updated_at", "catalog_products", ["updated_at"])
    op.create_index("ix_catalog_products_deleted_at", "catalog_products", ["deleted_at"])
    op.create_index(
        "ix_catalog_products_active_tenant",
        "catalog_products",
        ["tenant_id"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )
    op.create_index(
        "ix_catalog_products_tenant_active",
        "catalog_products",
        ["tenant_id", "is_active"],
        postgresql_where=sa.text("deleted_at IS NULL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "catalog_products"):
        return
    op.drop_table("catalog_products")
