"""Catalog first class: categories, cost, unit, barcode, service SKU, and line-item links.

E1 of docs/crm-evolution/12-erp-inventory.md. Every new column is nullable or has a server
default, so existing rows need no backfill: existing quote and order lines stay free text.

Revision ID: 20260825_catalog_first_class
Revises: 20260824_report_subscriptions
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260825_catalog_first_class"
down_revision: Union[str, None] = "20260824_report_subscriptions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "catalog_categories",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.BigInteger(), sa.ForeignKey("catalog_categories.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_by_user_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_catalog_categories_id", "catalog_categories", ["id"])
    op.create_index("ix_catalog_categories_tenant_id", "catalog_categories", ["tenant_id"])
    op.create_index("ix_catalog_categories_tenant_parent", "catalog_categories", ["tenant_id", "parent_id"])

    for table in ("catalog_products", "catalog_services"):
        op.add_column(table, sa.Column("category_id", sa.BigInteger(), sa.ForeignKey("catalog_categories.id", ondelete="SET NULL"), nullable=True))
        op.add_column(table, sa.Column("cost_price", sa.Numeric(12, 4), nullable=True))
        op.add_column(table, sa.Column("unit", sa.String(40), nullable=False, server_default="unit"))
        op.create_index(f"ix_{table}_category_id", table, ["category_id"])
        op.create_check_constraint(f"ck_{table}_cost_nonnegative", table, "cost_price IS NULL OR cost_price >= 0")

    op.add_column("catalog_products", sa.Column("barcode", sa.String(100), nullable=True))
    op.create_index(
        "uq_catalog_products_active_tenant_barcode",
        "catalog_products",
        ["tenant_id", "barcode"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND barcode IS NOT NULL"),
    )
    op.add_column("catalog_services", sa.Column("sku", sa.String(100), nullable=True))
    op.create_index("ix_catalog_services_sku", "catalog_services", ["sku"])
    op.create_index(
        "uq_catalog_services_active_tenant_sku",
        "catalog_services",
        ["tenant_id", "sku"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND sku IS NOT NULL"),
    )

    for table in ("sales_quote_items", "sales_order_items"):
        op.add_column(table, sa.Column("catalog_product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="SET NULL"), nullable=True))
        op.add_column(table, sa.Column("catalog_service_id", sa.BigInteger(), sa.ForeignKey("catalog_services.id", ondelete="SET NULL"), nullable=True))
        op.create_index(f"ix_{table}_catalog_product_id", table, ["catalog_product_id"])
        op.create_index(f"ix_{table}_catalog_service_id", table, ["catalog_service_id"])
        op.create_check_constraint(
            f"ck_{table}_one_catalog_link",
            table,
            "catalog_product_id IS NULL OR catalog_service_id IS NULL",
        )


def downgrade() -> None:
    for table in ("sales_order_items", "sales_quote_items"):
        op.drop_constraint(f"ck_{table}_one_catalog_link", table, type_="check")
        op.drop_index(f"ix_{table}_catalog_service_id", table_name=table)
        op.drop_index(f"ix_{table}_catalog_product_id", table_name=table)
        op.drop_column(table, "catalog_service_id")
        op.drop_column(table, "catalog_product_id")

    op.drop_index("uq_catalog_services_active_tenant_sku", table_name="catalog_services")
    op.drop_index("ix_catalog_services_sku", table_name="catalog_services")
    op.drop_column("catalog_services", "sku")
    op.drop_index("uq_catalog_products_active_tenant_barcode", table_name="catalog_products")
    op.drop_column("catalog_products", "barcode")

    for table in ("catalog_services", "catalog_products"):
        op.drop_constraint(f"ck_{table}_cost_nonnegative", table, type_="check")
        op.drop_index(f"ix_{table}_category_id", table_name=table)
        op.drop_column(table, "unit")
        op.drop_column(table, "cost_price")
        op.drop_column(table, "category_id")

    op.drop_index("ix_catalog_categories_tenant_parent", table_name="catalog_categories")
    op.drop_index("ix_catalog_categories_tenant_id", table_name="catalog_categories")
    op.drop_index("ix_catalog_categories_id", table_name="catalog_categories")
    op.drop_table("catalog_categories")
