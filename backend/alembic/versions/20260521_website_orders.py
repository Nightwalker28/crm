"""Add website order writebacks

Revision ID: 20260521_website_orders
Revises: 20260520_website_integrations
Create Date: 2026-05-21 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260521_website_orders"
down_revision: Union[str, None] = "20260520_website_integrations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "website_integration_orders"):
        op.create_table(
            "website_integration_orders",
            sa.Column("id", sa.BigInteger(), nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("api_key_id", sa.BigInteger(), nullable=True),
            sa.Column("external_reference", sa.String(length=180), nullable=False),
            sa.Column("source_platform", sa.String(length=80), nullable=True),
            sa.Column("status", sa.String(length=20), server_default="confirmed", nullable=False),
            sa.Column("request_hash", sa.String(length=64), nullable=False),
            sa.Column("customer_name", sa.String(length=180), nullable=True),
            sa.Column("customer_email", sa.String(length=180), nullable=True),
            sa.Column("customer_phone", sa.String(length=80), nullable=True),
            sa.Column("currency", sa.String(length=3), server_default="USD", nullable=False),
            sa.Column("subtotal_amount", sa.Numeric(12, 4), server_default="0", nullable=False),
            sa.Column("metadata_json", sa.JSON(), nullable=True),
            sa.Column("raw_payload", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("status IN ('confirmed', 'rejected')", name="ck_website_orders_status"),
            sa.ForeignKeyConstraint(["api_key_id"], ["website_integration_api_keys.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "external_reference", name="uq_website_orders_tenant_external_ref"),
        )
        op.create_index("ix_website_integration_orders_id", "website_integration_orders", ["id"])
        op.create_index("ix_website_integration_orders_tenant_id", "website_integration_orders", ["tenant_id"])
        op.create_index("ix_website_integration_orders_api_key_id", "website_integration_orders", ["api_key_id"])
        op.create_index("ix_website_integration_orders_external_reference", "website_integration_orders", ["external_reference"])
        op.create_index("ix_website_integration_orders_source_platform", "website_integration_orders", ["source_platform"])
        op.create_index("ix_website_integration_orders_status", "website_integration_orders", ["status"])
        op.create_index("ix_website_integration_orders_customer_email", "website_integration_orders", ["customer_email"])
        op.create_index("ix_website_integration_orders_created_at", "website_integration_orders", ["created_at"])
        op.create_index("ix_website_orders_tenant_status", "website_integration_orders", ["tenant_id", "status"])

    if not _table_exists(bind, "website_integration_order_lines"):
        op.create_table(
            "website_integration_order_lines",
            sa.Column("id", sa.BigInteger(), nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("order_id", sa.BigInteger(), nullable=False),
            sa.Column("catalog_item_id", sa.BigInteger(), nullable=True),
            sa.Column("slug", sa.String(length=160), nullable=True),
            sa.Column("sku", sa.String(length=100), nullable=True),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
            sa.Column("currency", sa.String(length=3), server_default="USD", nullable=False),
            sa.Column("unit_price_snapshot", sa.Numeric(12, 4), nullable=False),
            sa.Column("line_total", sa.Numeric(12, 4), nullable=False),
            sa.Column("stock_quantity_before", sa.Numeric(12, 4), nullable=True),
            sa.Column("stock_quantity_after", sa.Numeric(12, 4), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["catalog_item_id"], ["website_catalog_items.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["order_id"], ["website_integration_orders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_website_integration_order_lines_id", "website_integration_order_lines", ["id"])
        op.create_index("ix_website_integration_order_lines_tenant_id", "website_integration_order_lines", ["tenant_id"])
        op.create_index("ix_website_integration_order_lines_order_id", "website_integration_order_lines", ["order_id"])
        op.create_index("ix_website_integration_order_lines_catalog_item_id", "website_integration_order_lines", ["catalog_item_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "website_integration_order_lines"):
        op.drop_table("website_integration_order_lines")
    if _table_exists(bind, "website_integration_orders"):
        op.drop_table("website_integration_orders")
