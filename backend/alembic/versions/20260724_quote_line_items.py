"""add tenant-scoped quote line items

Revision ID: 20260724_quote_line_items
Revises: 20260723_lead_team_tags
Create Date: 2026-07-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260724_quote_line_items"
down_revision: Union[str, None] = "20260723_lead_team_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_unique_constraint("uq_sales_quotes_tenant_quote_id", "sales_quotes", ["tenant_id", "quote_id"])
    op.create_table(
        "sales_quote_items",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("quote_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Numeric(18, 4), server_default="1", nullable=False),
        sa.Column("unit_price", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("discount_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("tax_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("line_total", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_sales_quote_items_quantity_positive"),
        sa.CheckConstraint("unit_price >= 0", name="ck_sales_quote_items_unit_price_nonnegative"),
        sa.CheckConstraint("discount_amount >= 0", name="ck_sales_quote_items_discount_nonnegative"),
        sa.CheckConstraint("tax_amount >= 0", name="ck_sales_quote_items_tax_nonnegative"),
        sa.CheckConstraint("line_total >= 0", name="ck_sales_quote_items_total_nonnegative"),
        sa.ForeignKeyConstraint(
            ["tenant_id", "quote_id"],
            ["sales_quotes.tenant_id", "sales_quotes.quote_id"],
            name="fk_sales_quote_items_tenant_quote",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sales_quote_items_tenant_quote", "sales_quote_items", ["tenant_id", "quote_id"])


def downgrade() -> None:
    op.drop_index("ix_sales_quote_items_tenant_quote", table_name="sales_quote_items")
    op.drop_table("sales_quote_items")
    op.drop_constraint("uq_sales_quotes_tenant_quote_id", "sales_quotes", type_="unique")
