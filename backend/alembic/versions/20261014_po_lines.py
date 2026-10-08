"""Purchase order lines take services and non-stock products, and a discount (13c §3.5, H18)

`product_id` becomes nullable beside a new `catalog_service_id`; a check keeps exactly one.
`discount_amount` is an amount off the line. Existing lines are all tracked products with no
discount, so they satisfy both checks as they are; nothing is backfilled.

Revision ID: 20261014_po_lines
Revises: 20261013_layout_overrides
Create Date: 2026-10-08
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261014_po_lines"
down_revision: Union[str, None] = "20261013_layout_overrides"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("purchase_order_lines", sa.Column("catalog_service_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key("fk_purchase_order_lines_catalog_service", "purchase_order_lines", "catalog_services",
                          ["catalog_service_id"], ["id"], ondelete="RESTRICT")
    op.add_column("purchase_order_lines", sa.Column("discount_amount", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.alter_column("purchase_order_lines", "product_id", existing_type=sa.BigInteger(), nullable=True)
    op.create_check_constraint("ck_purchase_order_line_discount_nonnegative", "purchase_order_lines", "discount_amount >= 0")
    op.create_check_constraint("ck_purchase_order_line_one_item", "purchase_order_lines",
                               "(product_id IS NULL) <> (catalog_service_id IS NULL)")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM purchase_order_lines WHERE product_id IS NULL LIMIT 1")).first():
        raise RuntimeError("Purchase orders have service lines; remove them before downgrading 20261014_po_lines")
    op.drop_constraint("ck_purchase_order_line_one_item", "purchase_order_lines", type_="check")
    op.drop_constraint("ck_purchase_order_line_discount_nonnegative", "purchase_order_lines", type_="check")
    op.alter_column("purchase_order_lines", "product_id", existing_type=sa.BigInteger(), nullable=False)
    op.drop_column("purchase_order_lines", "discount_amount")
    op.drop_constraint("fk_purchase_order_lines_catalog_service", "purchase_order_lines", type_="foreignkey")
    op.drop_column("purchase_order_lines", "catalog_service_id")
