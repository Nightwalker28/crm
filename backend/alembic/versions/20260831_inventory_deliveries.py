"""E3 Phase 2: delivery documents and the order's delivery status.

Every order whose E2 *Fulfilled* took stock gets one posted delivery, flagged `migrated`,
whose lines mirror its `sales_order` moves; cancelling it reverses those moves. An order
fulfilled before E2 took no stock, so it gets no delivery and is marked closed instead.

Revision ID: 20260831_inventory_deliveries
Revises: 20260830_order_reservations
"""

from decimal import Decimal
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260831_inventory_deliveries"
down_revision: Union[str, None] = "20260830_order_reservations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sales_orders", sa.Column("delivery_status", sa.Text(), nullable=False, server_default="none"))
    op.add_column("sales_orders", sa.Column("remaining_closed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sales_orders", sa.Column("remaining_close_reason", sa.Text(), nullable=True))
    op.create_check_constraint("ck_sales_orders_delivery_status", "sales_orders",
        "delivery_status IN ('none', 'pending', 'partial', 'delivered', 'closed')")
    op.create_table(
        "inventory_deliveries",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("shipped_on", sa.Date()),
        sa.Column("carrier", sa.String(120)),
        sa.Column("tracking_number", sa.String(120)),
        sa.Column("notes", sa.Text()),
        sa.Column("posted_at", sa.DateTime(timezone=True)),
        sa.Column("posted_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("cancel_reason", sa.String(120)),
        sa.Column("migrated", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "number", name="uq_inventory_delivery_number"),
        sa.CheckConstraint("status IN ('draft', 'posted', 'cancelled')", name="ck_inventory_delivery_status"),
    )
    op.create_index("ix_inventory_deliveries_tenant_id", "inventory_deliveries", ["tenant_id"])
    op.create_index("ix_inventory_deliveries_tenant_status_id", "inventory_deliveries", ["tenant_id", "status", "id"])
    op.create_index("ix_inventory_deliveries_tenant_order", "inventory_deliveries", ["tenant_id", "order_id"])
    op.create_table(
        "inventory_delivery_lines",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("delivery_id", sa.BigInteger(), sa.ForeignKey("inventory_deliveries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_line_id", sa.Integer(), sa.ForeignKey("sales_order_items.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.UniqueConstraint("delivery_id", "order_line_id", name="uq_inventory_delivery_line_order_line"),
        sa.CheckConstraint("quantity > 0", name="ck_inventory_delivery_line_positive"),
    )
    op.create_index("ix_inventory_delivery_lines_tenant_id", "inventory_delivery_lines", ["tenant_id"])
    op.create_index("ix_inventory_delivery_lines_delivery_id", "inventory_delivery_lines", ["delivery_id"])
    op.create_index("ix_inventory_delivery_lines_tenant_order_line", "inventory_delivery_lines", ["tenant_id", "order_line_id"])

    bind = op.get_bind()
    # E2 fulfilments still standing: `sales_order` moves that were never reversed.
    moves = bind.execute(sa.text("""
        SELECT m.tenant_id, m.source_id AS order_id, m.source_line_id AS line_id, m.product_id, m.warehouse_id,
               m.quantity, m.created_at, m.created_by
        FROM inventory_stock_moves m
        JOIN sales_order_items i ON i.id = m.source_line_id AND i.order_id = m.source_id AND i.tenant_id = m.tenant_id
        WHERE m.source_type = 'sales_order' AND m.move_type = 'sales_order' AND m.reverses_move_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM inventory_stock_moves r WHERE r.reverses_move_id = m.id)
        ORDER BY m.source_id, m.id
    """)).fetchall()
    by_order: dict[tuple[int, int], list] = {}
    for move in moves:
        by_order.setdefault((move.tenant_id, move.order_id), []).append(move)
    for (tenant_id, order_id), rows in by_order.items():
        delivery_id = bind.execute(sa.text("""
            INSERT INTO inventory_deliveries (tenant_id, number, order_id, warehouse_id, status, posted_at, posted_by, migrated, notes, created_at)
            VALUES (:tenant_id, :number, :order_id, :warehouse_id, 'posted', :posted_at, :posted_by, 1,
                    'Recorded from the order''s fulfilment before deliveries existed', :posted_at)
            RETURNING id
        """), {"tenant_id": tenant_id, "number": f"DEL-M-{order_id}", "order_id": order_id, "warehouse_id": rows[0].warehouse_id,
               "posted_at": rows[0].created_at, "posted_by": rows[0].created_by}).scalar_one()
        for row in rows:
            bind.execute(sa.text("""
                INSERT INTO inventory_delivery_lines (tenant_id, delivery_id, order_line_id, product_id, quantity)
                VALUES (:tenant_id, :delivery_id, :line_id, :product_id, :quantity)
            """), {"tenant_id": tenant_id, "delivery_id": delivery_id, "line_id": row.line_id,
                   "product_id": row.product_id, "quantity": -Decimal(row.quantity)})

    # Delivery status, by the same rule as `refresh_delivery_status`.
    tracked = bind.execute(sa.text("""
        SELECT o.id, o.status, i.id AS line_id, i.quantity,
               COALESCE((SELECT SUM(l.quantity) FROM inventory_delivery_lines l JOIN inventory_deliveries d ON d.id = l.delivery_id
                         WHERE l.order_line_id = i.id AND d.status = 'posted'), 0) AS delivered
        FROM sales_orders o
        JOIN sales_order_items i ON i.order_id = o.id AND i.tenant_id = o.tenant_id
        JOIN catalog_products p ON p.id = i.catalog_product_id AND p.tenant_id = o.tenant_id AND p.track_inventory = 1
    """)).fetchall()
    lines: dict[int, list] = {}
    statuses: dict[int, str] = {}
    for row in tracked:
        lines.setdefault(row.id, []).append(row)
        statuses[row.id] = row.status
    for order_id, rows in lines.items():
        status = statuses[order_id]
        delivered = [Decimal(row.delivered) for row in rows]
        if status == "cancelled":
            continue
        if all(value >= Decimal(row.quantity) for value, row in zip(delivered, rows)):
            value = "delivered"
        elif status == "fulfilled":
            # Fulfilled before E2, when fulfilment moved no stock: nothing is left to ship.
            bind.execute(sa.text("""
                UPDATE sales_orders SET delivery_status = 'closed', remaining_closed_at = updated_at,
                    remaining_close_reason = 'Fulfilled before deliveries were recorded' WHERE id = :id
            """), {"id": order_id})
            continue
        elif any(value > 0 for value in delivered):
            value = "partial"
        else:
            value = "pending"
        bind.execute(sa.text("UPDATE sales_orders SET delivery_status = :value WHERE id = :id"), {"value": value, "id": order_id})

    # Users who already have order views get the two presets once, with their default view's
    # columns; anyone else gets them on their first visit (`PRESET_SAVED_VIEWS`).
    presets = (
        ("To deliver", [("status", "is", "confirmed"), ("delivery_status", "is_not", "none")]),
        ("Waiting for stock", [("waiting_for_stock", "is", True)]),
    )
    views = bind.execute(sa.text("SELECT user_id, config FROM user_saved_views WHERE module_key = 'sales_orders'")).fetchall()
    columns_by_user: dict[int, list] = {}
    for view in views:
        config = view.config if isinstance(view.config, dict) else json.loads(view.config or "{}")
        meta = config.get("_meta") if isinstance(config.get("_meta"), dict) else {}
        if meta.get("system_default") or view.user_id not in columns_by_user:
            columns_by_user[view.user_id] = config.get("visible_columns") if isinstance(config.get("visible_columns"), list) else []
    for user_id, columns in columns_by_user.items():
        for name, conditions in presets:
            slug = name.lower().replace(" ", "-")
            config = {
                "visible_columns": columns,
                "filters": {"search": "", "logic": "all", "conditions": [], "any_conditions": [], "all_conditions": [
                    {"id": f"{slug}-{index}", "field": field, "operator": operator, "value": value, "values": None}
                    for index, (field, operator, value) in enumerate(conditions)
                ]},
                "sort": None, "display": None,
            }
            bind.execute(sa.text("""
                INSERT INTO user_saved_views (user_id, module_key, name, config, is_default)
                VALUES (:user_id, 'sales_orders', :name, CAST(:config AS JSON), 0)
            """), {"user_id": user_id, "name": name, "config": json.dumps(config)})


def downgrade() -> None:
    op.execute("DELETE FROM user_saved_views WHERE module_key = 'sales_orders' AND name IN ('To deliver', 'Waiting for stock')")
    op.drop_index("ix_inventory_delivery_lines_tenant_order_line", table_name="inventory_delivery_lines")
    op.drop_index("ix_inventory_delivery_lines_delivery_id", table_name="inventory_delivery_lines")
    op.drop_index("ix_inventory_delivery_lines_tenant_id", table_name="inventory_delivery_lines")
    op.drop_table("inventory_delivery_lines")
    op.drop_index("ix_inventory_deliveries_tenant_order", table_name="inventory_deliveries")
    op.drop_index("ix_inventory_deliveries_tenant_status_id", table_name="inventory_deliveries")
    op.drop_index("ix_inventory_deliveries_tenant_id", table_name="inventory_deliveries")
    op.drop_table("inventory_deliveries")
    op.drop_constraint("ck_sales_orders_delivery_status", "sales_orders", type_="check")
    op.drop_column("sales_orders", "remaining_close_reason")
    op.drop_column("sales_orders", "remaining_closed_at")
    op.drop_column("sales_orders", "delivery_status")
