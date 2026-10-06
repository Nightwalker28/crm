"""E4: vendors, product purchasing fields, purchase orders and receipts.

Revision ID: 20260903_purchasing
Revises: 20260902_e3_followups
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260903_purchasing"
down_revision: Union[str, None] = "20260902_e3_followups"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sales_organizations", sa.Column("is_vendor", sa.SmallInteger(), nullable=False, server_default="0"))
    op.add_column("catalog_products", sa.Column("preferred_vendor_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key("fk_catalog_products_preferred_vendor", "catalog_products", "sales_organizations", ["preferred_vendor_id"], ["org_id"], ondelete="SET NULL")
    op.create_index("ix_catalog_products_preferred_vendor_id", "catalog_products", ["preferred_vendor_id"])
    op.add_column("catalog_products", sa.Column("vendor_sku", sa.String(100), nullable=True))
    op.add_column("catalog_products", sa.Column("lead_time_days", sa.Integer(), nullable=True))

    op.create_table(
        "purchase_orders",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("vendor_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False, server_default="USD"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("receipt_status", sa.String(20), nullable=False, server_default="none"),
        sa.Column("expected_date", sa.Date()),
        sa.Column("vendor_reference", sa.String(120)),
        sa.Column("notes", sa.Text()),
        sa.Column("subtotal", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("ordered_at", sa.DateTime(timezone=True)),
        sa.Column("ordered_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("close_reason", sa.String(500)),
        sa.Column("cancel_reason", sa.String(120)),
        sa.Column("owner_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "number", name="uq_purchase_order_number"),
        sa.CheckConstraint("status IN ('draft', 'ordered', 'received', 'closed', 'cancelled')", name="ck_purchase_order_status"),
        sa.CheckConstraint("receipt_status IN ('none', 'partial', 'received')", name="ck_purchase_order_receipt_status"),
    )
    op.create_index("ix_purchase_orders_tenant_id", "purchase_orders", ["tenant_id"])
    op.create_index("ix_purchase_orders_tenant_status_id", "purchase_orders", ["tenant_id", "status", "id"])
    op.create_index("ix_purchase_orders_tenant_vendor", "purchase_orders", ["tenant_id", "vendor_id"])

    op.create_table(
        "purchase_order_lines",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_id", sa.BigInteger(), sa.ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("quantity > 0", name="ck_purchase_order_line_positive"),
        sa.CheckConstraint("unit_cost >= 0", name="ck_purchase_order_line_cost_nonnegative"),
    )
    op.create_index("ix_purchase_order_lines_tenant_id", "purchase_order_lines", ["tenant_id"])
    op.create_index("ix_purchase_order_lines_order_id", "purchase_order_lines", ["order_id"])
    op.create_index("ix_purchase_order_lines_tenant_product", "purchase_order_lines", ["tenant_id", "product_id"])

    op.create_table(
        "purchase_receipts",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("order_id", sa.BigInteger(), sa.ForeignKey("purchase_orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("received_on", sa.Date()),
        sa.Column("vendor_delivery_ref", sa.String(120)),
        sa.Column("notes", sa.Text()),
        sa.Column("posted_at", sa.DateTime(timezone=True)),
        sa.Column("posted_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("cancel_reason", sa.String(120)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "number", name="uq_purchase_receipt_number"),
        sa.CheckConstraint("status IN ('draft', 'posted', 'cancelled')", name="ck_purchase_receipt_status"),
    )
    op.create_index("ix_purchase_receipts_tenant_id", "purchase_receipts", ["tenant_id"])
    op.create_index("ix_purchase_receipts_tenant_status_id", "purchase_receipts", ["tenant_id", "status", "id"])
    op.create_index("ix_purchase_receipts_tenant_order", "purchase_receipts", ["tenant_id", "order_id"])

    op.create_table(
        "purchase_receipt_lines",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("receipt_id", sa.BigInteger(), sa.ForeignKey("purchase_receipts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_line_id", sa.BigInteger(), sa.ForeignKey("purchase_order_lines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.UniqueConstraint("receipt_id", "order_line_id", name="uq_purchase_receipt_line_order_line"),
        sa.CheckConstraint("quantity > 0", name="ck_purchase_receipt_line_positive"),
    )
    op.create_index("ix_purchase_receipt_lines_tenant_id", "purchase_receipt_lines", ["tenant_id"])
    op.create_index("ix_purchase_receipt_lines_receipt_id", "purchase_receipt_lines", ["receipt_id"])
    op.create_index("ix_purchase_receipt_lines_tenant_order_line", "purchase_receipt_lines", ["tenant_id", "order_line_id"])

    # Users who already have account views get a *Vendors* preset once, with their default
    # view's columns; anyone else gets it on their first visit (`PRESET_SAVED_VIEWS`).
    bind = op.get_bind()
    columns_by_user: dict[int, list] = {}
    for view in bind.execute(sa.text("SELECT user_id, config FROM user_saved_views WHERE module_key = 'sales_organizations'")).fetchall():
        config = view.config if isinstance(view.config, dict) else json.loads(view.config or "{}")
        meta = config.get("_meta") if isinstance(config.get("_meta"), dict) else {}
        if meta.get("system_default") or view.user_id not in columns_by_user:
            columns_by_user[view.user_id] = config.get("visible_columns") if isinstance(config.get("visible_columns"), list) else []
    for user_id, columns in columns_by_user.items():
        config = {"visible_columns": columns, "sort": None, "display": None, "filters": {"search": "", "logic": "all", "conditions": [], "any_conditions": [],
            "all_conditions": [{"id": "vendors-0", "field": "is_vendor", "operator": "is", "value": True, "values": None}]}}
        bind.execute(sa.text("INSERT INTO user_saved_views (user_id, module_key, name, config, is_default) VALUES (:user_id, 'sales_organizations', 'Vendors', CAST(:config AS JSON), 0)"),
            {"user_id": user_id, "config": json.dumps(config)})


def downgrade() -> None:
    op.execute("DELETE FROM user_saved_views WHERE module_key = 'sales_organizations' AND name = 'Vendors'")
    for table in ("purchase_receipt_lines", "purchase_receipts", "purchase_order_lines", "purchase_orders"):
        op.drop_table(table)
    op.drop_column("catalog_products", "lead_time_days")
    op.drop_column("catalog_products", "vendor_sku")
    op.drop_index("ix_catalog_products_preferred_vendor_id", table_name="catalog_products")
    op.drop_constraint("fk_catalog_products_preferred_vendor", "catalog_products", type_="foreignkey")
    op.drop_column("catalog_products", "preferred_vendor_id")
    op.drop_column("sales_organizations", "is_vendor")
