"""add sales orders

Revision ID: 20260617_sales_orders
Revises: 20260616_quote_proposals
Create Date: 2026-05-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260617_sales_orders"
down_revision: Union[str, None] = "20260616_quote_proposals"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "sales_orders"):
        op.create_table(
            "sales_orders",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("order_number", sa.Text(), nullable=False),
            sa.Column("quote_id", sa.BigInteger(), nullable=True),
            sa.Column("organization_id", sa.BigInteger(), nullable=True),
            sa.Column("contact_id", sa.BigInteger(), nullable=True),
            sa.Column("opportunity_id", sa.BigInteger(), nullable=True),
            sa.Column("status", sa.Text(), server_default="confirmed", nullable=False),
            sa.Column("currency", sa.Text(), server_default="USD", nullable=False),
            sa.Column("subtotal", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("tax_total", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("discount_total", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("grand_total", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("owner_id", sa.BigInteger(), nullable=True),
            sa.Column("created_by_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column(
                "search_doc",
                sa.Text(),
                sa.Computed(
                    "lower(coalesce(order_number, '') || ' ' || coalesce(status, '') || ' ' || coalesce(currency, ''))",
                    persisted=True,
                ),
                nullable=True,
            ),
            sa.CheckConstraint("status IN ('draft', 'confirmed', 'fulfilled', 'cancelled')", name="ck_sales_orders_status"),
            sa.ForeignKeyConstraint(["contact_id"], ["sales_contacts.contact_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["opportunity_id"], ["sales_opportunities.opportunity_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["organization_id"], ["sales_organizations.org_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["quote_id"], ["sales_quotes.quote_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("quote_id"),
        )
    if not _table_exists(bind, "sales_order_items"):
        op.create_table(
            "sales_order_items",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("order_id", sa.Integer(), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("quantity", sa.Numeric(18, 4), server_default="1", nullable=False),
            sa.Column("unit_price", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("discount_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("tax_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("line_total", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.ForeignKeyConstraint(["order_id"], ["sales_orders.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = [
        ("sales_orders", "ix_sales_orders_id", ["id"]),
        ("sales_orders", "ix_sales_orders_tenant_id", ["tenant_id"]),
        ("sales_orders", "ix_sales_orders_order_number", ["order_number"]),
        ("sales_orders", "ix_sales_orders_quote_id", ["quote_id"]),
        ("sales_orders", "ix_sales_orders_organization_id", ["organization_id"]),
        ("sales_orders", "ix_sales_orders_contact_id", ["contact_id"]),
        ("sales_orders", "ix_sales_orders_opportunity_id", ["opportunity_id"]),
        ("sales_orders", "ix_sales_orders_tenant_status", ["tenant_id", "status"]),
        ("sales_orders", "ix_sales_orders_tenant_quote", ["tenant_id", "quote_id"]),
        ("sales_orders", "ix_sales_orders_tenant_created", ["tenant_id", "created_at"]),
        ("sales_order_items", "ix_sales_order_items_id", ["id"]),
        ("sales_order_items", "ix_sales_order_items_tenant_id", ["tenant_id"]),
        ("sales_order_items", "ix_sales_order_items_order_id", ["order_id"]),
        ("sales_order_items", "ix_sales_order_items_tenant_order", ["tenant_id", "order_id"]),
    ]
    for table_name, index_name, columns in indexes:
        if not _index_exists(bind, table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=False)

    if bind.dialect.name == "postgresql":
        op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_orders_tenant_number ON sales_orders (tenant_id, lower(order_number))"))

    op.execute(
        sa.text(
            """
            INSERT INTO modules (name, base_route, description, is_enabled)
            VALUES ('sales_orders', '/dashboard/sales/orders', 'Sales orders', 1)
            ON CONFLICT (name) DO UPDATE
            SET base_route = EXCLUDED.base_route,
                description = EXCLUDED.description,
                is_enabled = 1
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO department_module_permissions (department_id, module_id)
            SELECT departments.id, modules.id
            FROM departments
            CROSS JOIN modules
            WHERE modules.name = 'sales_orders'
            ON CONFLICT (department_id, module_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO team_module_permissions (team_id, module_id)
            SELECT teams.id, modules.id
            FROM teams
            CROSS JOIN modules
            WHERE modules.name = 'sales_orders'
            ON CONFLICT (team_id, module_id) DO NOTHING
            """
        )
    )
    op.execute(
        sa.text(
            """
            INSERT INTO role_module_permissions (
                role_id, module_id, can_view, can_create, can_edit, can_delete, can_restore, can_export, can_configure
            )
            SELECT roles.id, modules.id, 1,
                CASE WHEN roles.level >= 10 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 10 THEN 1 ELSE 0 END,
                0,
                0,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
            FROM roles
            CROSS JOIN modules
            WHERE modules.name = 'sales_orders'
            ON CONFLICT (role_id, module_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute(sa.text("DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_orders')"))
    op.execute(sa.text("DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_orders')"))
    op.execute(sa.text("DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_orders')"))
    op.execute(sa.text("DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_orders')"))
    op.execute(sa.text("DELETE FROM modules WHERE name = 'sales_orders'"))
    for table_name, index_names in (
        (
            "sales_order_items",
            (
                "ix_sales_order_items_tenant_order",
                "ix_sales_order_items_order_id",
                "ix_sales_order_items_tenant_id",
                "ix_sales_order_items_id",
            ),
        ),
        (
            "sales_orders",
            (
                "uq_sales_orders_tenant_number",
                "ix_sales_orders_tenant_created",
                "ix_sales_orders_tenant_quote",
                "ix_sales_orders_tenant_status",
                "ix_sales_orders_opportunity_id",
                "ix_sales_orders_contact_id",
                "ix_sales_orders_organization_id",
                "ix_sales_orders_quote_id",
                "ix_sales_orders_order_number",
                "ix_sales_orders_tenant_id",
                "ix_sales_orders_id",
            ),
        ),
    ):
        if _table_exists(bind, table_name):
            for index_name in index_names:
                if _index_exists(bind, table_name, index_name):
                    op.drop_index(index_name, table_name=table_name)
    for table_name in ("sales_order_items", "sales_orders"):
        if _table_exists(bind, table_name):
            op.drop_table(table_name)
