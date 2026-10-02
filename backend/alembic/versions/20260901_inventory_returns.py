"""E3 Phase 3: customer returns against posted deliveries.

Revision ID: 20260901_inventory_returns
Revises: 20260831_inventory_deliveries
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260901_inventory_returns"
down_revision: Union[str, None] = "20260831_inventory_deliveries"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "inventory_returns",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("delivery_id", sa.BigInteger(), sa.ForeignKey("inventory_deliveries.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("reason", sa.String(120), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("received_at", sa.DateTime(timezone=True)),
        sa.Column("received_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("cancel_reason", sa.String(120)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "number", name="uq_inventory_return_number"),
        sa.CheckConstraint("status IN ('draft', 'received', 'cancelled')", name="ck_inventory_return_status"),
    )
    op.create_index("ix_inventory_returns_tenant_id", "inventory_returns", ["tenant_id"])
    op.create_index("ix_inventory_returns_tenant_status_id", "inventory_returns", ["tenant_id", "status", "id"])
    op.create_index("ix_inventory_returns_tenant_delivery", "inventory_returns", ["tenant_id", "delivery_id"])
    op.create_table(
        "inventory_return_lines",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("return_id", sa.BigInteger(), sa.ForeignKey("inventory_returns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("delivery_line_id", sa.BigInteger(), sa.ForeignKey("inventory_delivery_lines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("order_line_id", sa.Integer(), sa.ForeignKey("sales_order_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("restock", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.UniqueConstraint("return_id", "delivery_line_id", name="uq_inventory_return_line_delivery_line"),
        sa.CheckConstraint("quantity > 0", name="ck_inventory_return_line_positive"),
    )
    op.create_index("ix_inventory_return_lines_tenant_id", "inventory_return_lines", ["tenant_id"])
    op.create_index("ix_inventory_return_lines_return_id", "inventory_return_lines", ["return_id"])
    op.create_index("ix_inventory_return_lines_tenant_delivery_line", "inventory_return_lines", ["tenant_id", "delivery_line_id"])


def downgrade() -> None:
    op.drop_index("ix_inventory_return_lines_tenant_delivery_line", table_name="inventory_return_lines")
    op.drop_index("ix_inventory_return_lines_return_id", table_name="inventory_return_lines")
    op.drop_index("ix_inventory_return_lines_tenant_id", table_name="inventory_return_lines")
    op.drop_table("inventory_return_lines")
    op.drop_index("ix_inventory_returns_tenant_delivery", table_name="inventory_returns")
    op.drop_index("ix_inventory_returns_tenant_status_id", table_name="inventory_returns")
    op.drop_index("ix_inventory_returns_tenant_id", table_name="inventory_returns")
    op.drop_table("inventory_returns")
