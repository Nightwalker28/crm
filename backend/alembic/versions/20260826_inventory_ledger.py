"""E2 Phase 1: warehouse ledger and deterministic opening stock.

Revision ID: 20260826_inventory_ledger
Revises: 20260825_catalog_first_class
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260826_inventory_ledger"
down_revision: Union[str, None] = "20260825_catalog_first_class"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "inventory_warehouses",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("address", sa.Text()),
        sa.Column("is_default", sa.SmallInteger(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.SmallInteger(), nullable=False, server_default="1"),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "code", name="uq_inventory_warehouse_tenant_code"),
    )
    op.create_index("ix_inventory_warehouses_tenant_id", "inventory_warehouses", ["tenant_id"])
    op.create_index("uq_inventory_warehouse_default", "inventory_warehouses", ["tenant_id"], unique=True, postgresql_where=sa.text("is_default = 1 AND deleted_at IS NULL"))

    op.add_column("catalog_products", sa.Column("track_inventory", sa.SmallInteger(), nullable=False, server_default="0"))

    op.create_table(
        "inventory_stock_levels",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("on_hand", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("reserved", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "product_id", "warehouse_id", name="uq_inventory_level_tenant_product_warehouse"),
        sa.CheckConstraint("on_hand >= 0", name="ck_inventory_level_nonnegative"),
        sa.CheckConstraint("reserved >= 0", name="ck_inventory_level_reserved_nonnegative"),
    )
    for field in ("tenant_id", "product_id", "warehouse_id"):
        op.create_index(f"ix_inventory_stock_levels_{field}", "inventory_stock_levels", [field])

    op.create_table(
        "inventory_stock_moves",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("move_type", sa.String(30), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("source_id", sa.BigInteger(), nullable=False),
        sa.Column("source_line_id", sa.BigInteger()),
        sa.Column("reverses_move_id", sa.BigInteger(), sa.ForeignKey("inventory_stock_moves.id", ondelete="RESTRICT")),
        sa.Column("unit_cost", sa.Numeric(12, 4)),
        sa.Column("on_hand_after", sa.Numeric(12, 4), nullable=False),
        sa.Column("reason", sa.String(120)),
        sa.Column("note", sa.Text()),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("quantity <> 0", name="ck_inventory_move_nonzero"),
    )
    for field in ("tenant_id", "product_id", "warehouse_id"):
        op.create_index(f"ix_inventory_stock_moves_{field}", "inventory_stock_moves", [field])
    op.create_index("ix_inventory_moves_tenant_product_id", "inventory_stock_moves", ["tenant_id", "product_id", "id"])
    op.create_index("ix_inventory_moves_tenant_warehouse_id", "inventory_stock_moves", ["tenant_id", "warehouse_id", "id"])
    op.create_index("uq_inventory_move_source_line", "inventory_stock_moves", ["tenant_id", "source_type", "source_line_id", "move_type"], unique=True, postgresql_where=sa.text("source_line_id IS NOT NULL"))
    op.create_index("uq_inventory_move_reversal", "inventory_stock_moves", ["reverses_move_id"], unique=True, postgresql_where=sa.text("reverses_move_id IS NOT NULL"))

    op.create_table(
        "inventory_adjustments",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("mode", sa.String(20), nullable=False, server_default="quantity"),
        sa.Column("reason", sa.String(120), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("posted_at", sa.DateTime(timezone=True)),
        sa.Column("posted_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("notes", sa.Text()),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "number", name="uq_inventory_adjustment_number"),
        sa.CheckConstraint("mode IN ('quantity', 'count')", name="ck_inventory_adjustment_mode"),
        sa.CheckConstraint("status IN ('draft', 'posted', 'cancelled')", name="ck_inventory_adjustment_status"),
    )
    op.create_index("ix_inventory_adjustments_tenant_id", "inventory_adjustments", ["tenant_id"])
    op.create_table(
        "inventory_adjustment_lines",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("adjustment_id", sa.BigInteger(), sa.ForeignKey("inventory_adjustments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("expected", sa.Numeric(12, 4), nullable=False),
        sa.Column("counted", sa.Numeric(12, 4)),
        sa.Column("delta", sa.Numeric(12, 4)),
        sa.CheckConstraint("counted IS NULL OR counted >= 0", name="ck_inventory_adjustment_count_nonnegative"),
    )
    op.create_index("ix_inventory_adjustment_lines_tenant_id", "inventory_adjustment_lines", ["tenant_id"])

    bind = op.get_bind()
    bind.execute(sa.text("INSERT INTO inventory_warehouses (tenant_id, code, name, is_default) SELECT id, 'MAIN', 'Main', 1 FROM tenants"))
    bind.execute(sa.text("UPDATE catalog_products SET track_inventory = 1 WHERE stock_quantity IS NOT NULL"))
    bind.execute(sa.text("""
        INSERT INTO inventory_stock_levels (tenant_id, product_id, warehouse_id, on_hand)
        SELECT p.tenant_id, p.id, w.id, p.stock_quantity
        FROM catalog_products p JOIN inventory_warehouses w ON w.tenant_id = p.tenant_id AND w.is_default = 1
        WHERE p.track_inventory = 1
    """))
    bind.execute(sa.text("""
        INSERT INTO inventory_stock_moves (tenant_id, product_id, warehouse_id, quantity, move_type, source_type, source_id, unit_cost, on_hand_after, reason)
        SELECT p.tenant_id, p.id, w.id, p.stock_quantity, 'opening', 'catalog_product', p.id, p.cost_price, p.stock_quantity, 'Opening balance'
        FROM catalog_products p JOIN inventory_warehouses w ON w.tenant_id = p.tenant_id AND w.is_default = 1
        WHERE p.track_inventory = 1 AND p.stock_quantity > 0
    """))
    bind.execute(sa.text("UPDATE catalog_products SET stock_status = CASE WHEN stock_quantity > 0 THEN 'in_stock' ELSE 'out_of_stock' END WHERE track_inventory = 1"))

    # Existing access is copied from Catalog Products, so new modules respect each tenant's
    # department, team and role assignments from their first request.
    modules = (
        ("inventory_stock", "/dashboard/inventory/stock", "Stock and movements"),
        ("inventory_adjustments", "/dashboard/inventory/adjustments", "Stock adjustments"),
        ("inventory_transfers", "/dashboard/inventory/transfers", "Warehouse transfers"),
    )
    for name, route, description in modules:
        module_id = bind.execute(sa.text("INSERT INTO modules (name, base_route, description, is_enabled) VALUES (:name, :route, :description, 1) RETURNING id"), {"name": name, "route": route, "description": description}).scalar_one()
        for table, owner in (("department_module_permissions", "department_id"), ("team_module_permissions", "team_id")):
            bind.execute(sa.text(f"INSERT INTO {table} ({owner}, module_id) SELECT source.{owner}, :new_id FROM {table} source JOIN modules m ON m.id = source.module_id WHERE m.name = 'catalog_products'"), {"new_id": module_id})
        bind.execute(sa.text("""
            INSERT INTO role_module_permissions (role_id, module_id, can_view, can_create, can_edit, can_delete, can_restore, can_export, can_configure)
            SELECT source.role_id, :new_id, source.can_view, source.can_create, source.can_edit,
                   source.can_delete, source.can_restore, source.can_export,
                   CASE WHEN :module_name = 'inventory_stock' THEN source.can_configure ELSE 0 END
            FROM role_module_permissions source JOIN modules m ON m.id = source.module_id WHERE m.name = 'catalog_products'
        """), {"new_id": module_id, "module_name": name})


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("DELETE FROM modules WHERE name IN ('inventory_stock', 'inventory_adjustments', 'inventory_transfers')"))
    op.drop_table("inventory_adjustment_lines")
    op.drop_table("inventory_adjustments")
    op.drop_table("inventory_stock_moves")
    op.drop_table("inventory_stock_levels")
    op.drop_column("catalog_products", "track_inventory")
    op.drop_table("inventory_warehouses")
