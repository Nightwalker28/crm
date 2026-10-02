"""E3 Phase 1: stock reservations for confirmed sales orders.

Adds the order's warehouse and the reservation table, then gives every confirmed order
the holds `reserve_for_order` would: oldest order first, from what is free in its
warehouse. A short order is left partly waiting, which is accurate.

Revision ID: 20260830_order_reservations
Revises: 20260829_inventory_reorder
"""

from decimal import Decimal
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260830_order_reservations"
down_revision: Union[str, None] = "20260829_inventory_reorder"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sales_orders", sa.Column("warehouse_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key("fk_sales_orders_warehouse_id", "sales_orders", "inventory_warehouses", ["warehouse_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_sales_orders_warehouse_id", "sales_orders", ["warehouse_id"])
    op.execute("""
        UPDATE sales_orders SET warehouse_id = w.id
        FROM inventory_warehouses w
        WHERE w.tenant_id = sales_orders.tenant_id AND w.is_default = 1 AND w.deleted_at IS NULL
    """)
    op.create_table(
        "inventory_reservations",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_line_id", sa.Integer(), sa.ForeignKey("sales_order_items.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("manual", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.UniqueConstraint("tenant_id", "order_line_id", "warehouse_id", name="uq_inventory_reservation_line_warehouse"),
        sa.CheckConstraint("quantity > 0", name="ck_inventory_reservation_positive"),
    )
    op.create_index("ix_inventory_reservations_tenant_product_warehouse", "inventory_reservations", ["tenant_id", "product_id", "warehouse_id"])
    op.create_index("ix_inventory_reservations_tenant_order", "inventory_reservations", ["tenant_id", "order_id"])

    bind = op.get_bind()
    free = {
        (row.tenant_id, row.product_id, row.warehouse_id): Decimal(row.on_hand) - Decimal(row.reserved)
        for row in bind.execute(sa.text("SELECT tenant_id, product_id, warehouse_id, on_hand, reserved FROM inventory_stock_levels"))
    }
    lines = bind.execute(sa.text("""
        SELECT o.tenant_id, o.id AS order_id, i.id AS line_id, i.catalog_product_id AS product_id,
               o.warehouse_id, i.quantity
        FROM sales_orders o
        JOIN sales_order_items i ON i.order_id = o.id AND i.tenant_id = o.tenant_id
        JOIN catalog_products p ON p.id = i.catalog_product_id AND p.tenant_id = o.tenant_id
        WHERE o.status = 'confirmed' AND o.warehouse_id IS NOT NULL
          AND p.track_inventory = 1 AND p.deleted_at IS NULL
        ORDER BY o.created_at, o.id, i.sort_order, i.id
    """)).fetchall()
    held: dict[tuple[int, int, int], Decimal] = {}
    for line in lines:
        key = (line.tenant_id, line.product_id, line.warehouse_id)
        take = min(Decimal(line.quantity), free.get(key, Decimal(0)))
        if take <= 0:
            continue
        free[key] -= take
        held[key] = held.get(key, Decimal(0)) + take
        bind.execute(sa.text("""
            INSERT INTO inventory_reservations (tenant_id, order_id, order_line_id, product_id, warehouse_id, quantity)
            VALUES (:tenant_id, :order_id, :line_id, :product_id, :warehouse_id, :quantity)
        """), {"tenant_id": line.tenant_id, "order_id": line.order_id, "line_id": line.line_id,
               "product_id": line.product_id, "warehouse_id": line.warehouse_id, "quantity": take})
    for (tenant_id, product_id, warehouse_id), quantity in held.items():
        bind.execute(sa.text("""
            UPDATE inventory_stock_levels SET reserved = reserved + :quantity
            WHERE tenant_id = :tenant_id AND product_id = :product_id AND warehouse_id = :warehouse_id
        """), {"tenant_id": tenant_id, "product_id": product_id, "warehouse_id": warehouse_id, "quantity": quantity})


def downgrade() -> None:
    op.execute("UPDATE inventory_stock_levels SET reserved = 0")
    op.drop_index("ix_inventory_reservations_tenant_order", table_name="inventory_reservations")
    op.drop_index("ix_inventory_reservations_tenant_product_warehouse", table_name="inventory_reservations")
    op.drop_table("inventory_reservations")
    op.drop_index("ix_sales_orders_warehouse_id", table_name="sales_orders")
    op.drop_constraint("fk_sales_orders_warehouse_id", "sales_orders", type_="foreignkey")
    op.drop_column("sales_orders", "warehouse_id")
