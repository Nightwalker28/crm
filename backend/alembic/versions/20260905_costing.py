"""E6: moving-average costing, stock valuation and revaluations.

Plan: docs/crm-evolution/12d-erp-costing.md. Every company gets a base currency (its first
operating currency, else USD). The ledger is replayed per product in move order so each move
carries a value and the average after it (§3.6): receipts at their PO cost, returns at the cost
their delivery left at, reversals at the cost of the move they undo, other inbound moves at the
cost they recorded, else the product's current cost price (`fallback`), else zero (`missing`).
Outbound moves take their share of the value. Nothing invents a cost; *Revalue* fixes the rest.

Revision ID: 20260905_costing
Revises: 20260904_invoicing
"""

import json
from collections import defaultdict
from decimal import ROUND_HALF_UP, Decimal
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260905_costing"
down_revision: Union[str, None] = "20260904_invoicing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PLACES = Decimal("0.0001")


def _q(value) -> Decimal:
    return Decimal(value).quantize(PLACES, rounding=ROUND_HALF_UP)


def _base_currencies(bind) -> dict[int, str]:
    result = {}
    for tenant_id, currencies in bind.execute(sa.text("SELECT tenant_id, operating_currencies FROM company_profiles")).fetchall():
        values = currencies if isinstance(currencies, list) else json.loads(currencies or "[]")
        code = str(values[0]).strip().upper()[:3] if values else "USD"
        result[tenant_id] = code or "USD"
    return result


def _replay(bind) -> dict:
    bases = _base_currencies(bind)
    products = {row.id: row for row in bind.execute(sa.text(
        "SELECT id, tenant_id, cost_price, stock_quantity FROM catalog_products WHERE track_inventory = 1")).fetchall()}
    receipt_currency = {row.id: (row.currency or "USD").upper() for row in bind.execute(sa.text("""
        SELECT m.id, po.currency FROM inventory_stock_moves m
        JOIN purchase_receipt_lines rl ON rl.id = m.source_line_id AND rl.tenant_id = m.tenant_id
        JOIN purchase_order_lines pl ON pl.id = rl.order_line_id
        JOIN purchase_orders po ON po.id = pl.order_id
        WHERE m.move_type = 'receipt' AND m.source_type = 'purchase_receipt'
    """)).fetchall()}
    # A return's delivery move: return line -> delivery line -> that line's delivery move, or
    # for an E2 delivery migrated in E3, the order's legacy move for the order line.
    return_origin = {row.id: row.origin_id for row in bind.execute(sa.text("""
        SELECT m.id, COALESCE(
            (SELECT d.id FROM inventory_stock_moves d WHERE d.tenant_id = m.tenant_id AND d.source_type = 'inventory_delivery'
               AND d.move_type = 'delivery' AND d.source_line_id = rl.delivery_line_id),
            (SELECT s.id FROM inventory_stock_moves s WHERE s.tenant_id = m.tenant_id AND s.source_type = 'sales_order'
               AND s.move_type = 'sales_order' AND s.source_line_id = rl.order_line_id)) AS origin_id
        FROM inventory_stock_moves m JOIN inventory_return_lines rl ON rl.id = m.source_line_id AND rl.tenant_id = m.tenant_id
        WHERE m.move_type = 'return' AND m.source_type = 'inventory_return'
    """)).fetchall()}

    moves_by_product = defaultdict(list)
    for move in bind.execute(sa.text("""
        SELECT id, tenant_id, product_id, quantity, move_type, unit_cost, reverses_move_id
        FROM inventory_stock_moves ORDER BY id
    """)).fetchall():
        moves_by_product[move.product_id].append(move)

    report = {"products_valued": 0, "products_missing_cost": [], "foreign_receipts": 0, "moves": 0}
    updates, product_updates = [], []
    for product_id, moves in moves_by_product.items():
        product = products.get(product_id)
        fallback = Decimal(product.cost_price) if product is not None and product.cost_price is not None else None
        quantity, value, last_cost = Decimal(0), Decimal(0), None
        computed: dict[int, tuple[Decimal, Decimal]] = {}
        for move in moves:
            q = Decimal(move.quantity)
            after = quantity + q
            if move.reverses_move_id is not None and move.reverses_move_id in computed:
                move_value = -computed[move.reverses_move_id][1]
                if after == 0 or value + move_value < 0:
                    move_value = -value
                source = "reversal"
            elif q > 0:
                cost, source = None, None
                if move.move_type == "return" and return_origin.get(move.id) in computed:
                    cost, source = computed[return_origin[move.id]][0], "return"
                elif move.move_type == "transfer_in":
                    cost, source = (value / quantity if quantity > 0 else last_cost), "average"
                elif move.unit_cost is not None:
                    cost = Decimal(move.unit_cost)
                    source = {"receipt": "receipt", "opening": "opening"}.get(move.move_type, "manual")
                    if move.move_type == "receipt" and receipt_currency.get(move.id, bases.get(move.tenant_id, "USD")) != bases.get(move.tenant_id, "USD"):
                        report["foreign_receipts"] += 1
                if cost is None and fallback is not None:
                    cost, source = fallback, "fallback"
                if cost is None:
                    cost, source = Decimal(0), "missing"
                move_value = _q(q * cost)
            else:
                move_value = -value if after == 0 else (_q(value * q / quantity) if quantity > 0 else Decimal(0))
                source = "missing" if last_cost is None and value <= 0 else "average"
            quantity, value = after, value + move_value
            if quantity == 0:
                value = Decimal(0)
            if quantity > 0:
                last_cost = _q(value / quantity)
            unit_cost = _q(abs(move_value / q)) if q else Decimal(0)
            computed[move.id] = (unit_cost, move_value)
            updates.append({"id": move.id, "unit_cost": unit_cost, "value": move_value, "average": last_cost, "source": source})
        if product is None:
            continue
        report["products_valued"] += 1
        if quantity > 0 and value <= 0:
            report["products_missing_cost"].append(product_id)
        new_cost = last_cost if (last_cost is not None and value > 0) else product.cost_price
        product_updates.append({"id": product_id, "value": value, "cost": new_cost})
    report["moves"] = len(updates)
    if updates:
        bind.execute(sa.text("""UPDATE inventory_stock_moves SET unit_cost = :unit_cost, value = :value,
            average_cost_after = :average, cost_source = :source WHERE id = :id"""), updates)
    if product_updates:
        bind.execute(sa.text("UPDATE catalog_products SET stock_value = :value, cost_price = :cost WHERE id = :id"), product_updates)
    return report


def upgrade() -> None:
    bind = op.get_bind()

    op.add_column("company_profiles", sa.Column("base_currency", sa.String(3), nullable=True))
    for tenant_id, code in _base_currencies(bind).items():
        bind.execute(sa.text("UPDATE company_profiles SET base_currency = :code WHERE tenant_id = :tenant_id"), {"code": code, "tenant_id": tenant_id})

    op.add_column("catalog_products", sa.Column("stock_value", sa.Numeric(18, 4), nullable=False, server_default="0"))
    op.add_column("inventory_stock_moves", sa.Column("value", sa.Numeric(18, 4), nullable=True))
    op.add_column("inventory_stock_moves", sa.Column("average_cost_after", sa.Numeric(12, 4), nullable=True))
    op.add_column("inventory_stock_moves", sa.Column("cost_source", sa.String(20), nullable=True))
    op.add_column("inventory_stock_moves", sa.Column("sales_order_item_id", sa.Integer(),
        sa.ForeignKey("sales_order_items.id", ondelete="SET NULL"), nullable=True))
    op.create_index("ix_inventory_moves_tenant_order_item", "inventory_stock_moves", ["tenant_id", "sales_order_item_id"])
    op.add_column("inventory_adjustment_lines", sa.Column("unit_cost", sa.Numeric(12, 4), nullable=True))
    op.add_column("purchase_orders", sa.Column("exchange_rate", sa.Numeric(18, 8), nullable=True))
    op.add_column("sales_orders", sa.Column("exchange_rate", sa.Numeric(18, 8), nullable=True))

    op.create_table(
        "inventory_revaluations",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("bill_line_id", sa.BigInteger(), nullable=True),
        sa.Column("on_hand", sa.Numeric(12, 4), nullable=False),
        sa.Column("average_before", sa.Numeric(12, 4), nullable=True),
        sa.Column("average_after", sa.Numeric(12, 4), nullable=True),
        sa.Column("stock_change", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("cogs_change", sa.Numeric(18, 4), nullable=False, server_default="0"),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("reverses_id", sa.BigInteger(), sa.ForeignKey("inventory_revaluations.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "number", name="uq_inventory_revaluation_number"),
        sa.CheckConstraint("kind IN ('manual', 'bill_variance', 'migration')", name="ck_inventory_revaluation_kind"),
    )
    op.create_index("ix_inventory_revaluations_tenant_id", "inventory_revaluations", ["tenant_id"])
    op.create_index("ix_inventory_revaluations_tenant_product_id", "inventory_revaluations", ["tenant_id", "product_id", "id"])
    op.create_index("uq_inventory_revaluation_reversal", "inventory_revaluations", ["reverses_id"], unique=True,
        postgresql_where=sa.text("reverses_id IS NOT NULL"))

    # Moves are append-only at the database (20260827); this one-time backfill fills the new
    # columns only, so the guard steps aside for it and comes straight back.
    op.execute("ALTER TABLE inventory_stock_moves DISABLE TRIGGER inventory_stock_moves_append_only")
    # Each move that served a sales order line names it, so cost of goods per line is a sum.
    op.execute("""
        UPDATE inventory_stock_moves m SET sales_order_item_id = dl.order_line_id
        FROM inventory_delivery_lines dl
        WHERE m.source_type = 'inventory_delivery' AND m.move_type = 'delivery' AND dl.id = m.source_line_id AND dl.tenant_id = m.tenant_id
    """)
    op.execute("""
        UPDATE inventory_stock_moves m SET sales_order_item_id = i.id
        FROM sales_order_items i
        WHERE m.source_type = 'sales_order' AND m.move_type = 'sales_order' AND i.id = m.source_line_id AND i.tenant_id = m.tenant_id
    """)
    op.execute("""
        UPDATE inventory_stock_moves m SET sales_order_item_id = rl.order_line_id
        FROM inventory_return_lines rl
        WHERE m.source_type = 'inventory_return' AND m.move_type = 'return' AND rl.id = m.source_line_id AND rl.tenant_id = m.tenant_id
    """)
    op.execute("""
        UPDATE inventory_stock_moves r SET sales_order_item_id = o.sales_order_item_id
        FROM inventory_stock_moves o
        WHERE r.reverses_move_id = o.id AND o.sales_order_item_id IS NOT NULL
    """)

    report = _replay(bind)
    op.execute("ALTER TABLE inventory_stock_moves ENABLE TRIGGER inventory_stock_moves_append_only")
    print(f"E6 costing replay: {report['moves']} moves valued over {report['products_valued']} products; "
          f"{len(report['products_missing_cost'])} products in stock with no cost "
          f"({', '.join(str(pid) for pid in report['products_missing_cost'][:50])}); "
          f"{report['foreign_receipts']} receipts in a currency other than the base valued at rate 1")

    # Access copies Stock (inventory_stock), so nobody loses a figure they can see today.
    module_id = bind.execute(sa.text("""
        INSERT INTO modules (name, base_route, description, is_enabled)
        VALUES ('inventory_valuation', '/dashboard/inventory/valuation', 'Stock value, revaluations and margin', 1)
        ON CONFLICT (name) DO UPDATE SET base_route = EXCLUDED.base_route RETURNING id
    """)).scalar_one()
    for table, owner in (("department_module_permissions", "department_id"), ("team_module_permissions", "team_id")):
        bind.execute(sa.text(f"""
            INSERT INTO {table} ({owner}, module_id)
            SELECT source.{owner}, :new_id FROM {table} source JOIN modules m ON m.id = source.module_id
            WHERE m.name = 'inventory_stock'
              AND NOT EXISTS (SELECT 1 FROM {table} t WHERE t.{owner} = source.{owner} AND t.module_id = :new_id)
        """), {"new_id": module_id})
    bind.execute(sa.text("""
        INSERT INTO role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete, can_restore, can_export, can_configure)
        SELECT source.role_id, :new_id, source.can_view, source.can_create, source.can_edit, source.can_delete,
               source.can_restore, source.can_export, source.can_configure
        FROM role_module_permissions source JOIN modules m ON m.id = source.module_id
        WHERE m.name = 'inventory_stock'
          AND NOT EXISTS (SELECT 1 FROM role_module_permissions t WHERE t.role_id = source.role_id AND t.module_id = :new_id)
    """), {"new_id": module_id})


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM modules WHERE name = 'inventory_valuation'"))
    op.drop_table("inventory_revaluations")
    op.drop_column("sales_orders", "exchange_rate")
    op.drop_column("purchase_orders", "exchange_rate")
    op.drop_column("inventory_adjustment_lines", "unit_cost")
    op.drop_index("ix_inventory_moves_tenant_order_item", table_name="inventory_stock_moves")
    op.drop_column("inventory_stock_moves", "sales_order_item_id")
    op.drop_column("inventory_stock_moves", "cost_source")
    op.drop_column("inventory_stock_moves", "average_cost_after")
    op.drop_column("inventory_stock_moves", "value")
    op.drop_column("catalog_products", "stock_value")
    op.drop_column("company_profiles", "base_currency")
