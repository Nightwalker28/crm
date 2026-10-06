"""E3 follow-ups: order priority and the portal order's sales order.

Revision ID: 20260902_e3_followups
Revises: 20260901_inventory_returns
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_e3_followups"
down_revision: Union[str, None] = "20260901_inventory_returns"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sales_orders", sa.Column("priority", sa.Text(), nullable=False, server_default="normal"))
    op.create_check_constraint("ck_sales_orders_priority", "sales_orders", "priority IN ('urgent', 'high', 'normal')")
    op.add_column("website_integration_orders", sa.Column("sales_order_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_website_orders_sales_order_id", "website_integration_orders", "sales_orders", ["sales_order_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_website_integration_orders_sales_order_id", "website_integration_orders", ["sales_order_id"])


def downgrade() -> None:
    op.drop_index("ix_website_integration_orders_sales_order_id", table_name="website_integration_orders")
    op.drop_constraint("fk_website_orders_sales_order_id", "website_integration_orders", type_="foreignkey")
    op.drop_column("website_integration_orders", "sales_order_id")
    op.drop_constraint("ck_sales_orders_priority", "sales_orders", type_="check")
    op.drop_column("sales_orders", "priority")
