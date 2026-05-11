"""add finance pos invoices

Revision ID: 20260526_finance_pos_invoices
Revises: 20260525_catalog_public_refactor
Create Date: 2026-05-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260526_finance_pos_invoices"
down_revision: Union[str, None] = "20260525_catalog_public_refactor"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _seed_module() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            INSERT INTO modules (name, base_route, description, is_enabled, import_duplicate_mode)
            VALUES ('finance_pos', '/dashboard/finance/pos', 'POS mode invoices and walk-in sales', 1, 'skip')
            ON CONFLICT (name) DO UPDATE
            SET base_route = EXCLUDED.base_route,
                description = EXCLUDED.description,
                is_enabled = EXCLUDED.is_enabled
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO tenant_module_configs (tenant_id, module_id, is_enabled, import_duplicate_mode)
            SELECT tenants.id, modules.id, 1, 'skip'
            FROM tenants
            CROSS JOIN modules
            WHERE modules.name = 'finance_pos'
            ON CONFLICT (tenant_id, module_id) DO NOTHING
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO department_module_permissions (department_id, module_id)
            SELECT departments.id, modules.id
            FROM departments
            CROSS JOIN modules
            WHERE modules.name = 'finance_pos'
              AND NOT EXISTS (
                  SELECT 1 FROM department_module_permissions existing
                  WHERE existing.department_id = departments.id
                    AND existing.module_id = modules.id
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO team_module_permissions (team_id, module_id)
            SELECT teams.id, modules.id
            FROM teams
            CROSS JOIN modules
            WHERE modules.name = 'finance_pos'
              AND NOT EXISTS (
                  SELECT 1 FROM team_module_permissions existing
                  WHERE existing.team_id = teams.id
                    AND existing.module_id = modules.id
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO role_module_permissions (
                role_id, module_id, can_view, can_create, can_edit,
                can_delete, can_restore, can_export, can_configure
            )
            SELECT
                roles.id,
                modules.id,
                1,
                CASE WHEN roles.level >= 10 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 10 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
            FROM roles
            CROSS JOIN modules
            WHERE modules.name = 'finance_pos'
              AND NOT EXISTS (
                  SELECT 1 FROM role_module_permissions existing
                  WHERE existing.role_id = roles.id
                    AND existing.module_id = modules.id
              )
            """
        )
    )


def upgrade() -> None:
    _seed_module()
    op.execute(sa.text("CREATE SEQUENCE IF NOT EXISTS finance_pos_invoice_number_seq START WITH 1"))
    op.create_table(
        "finance_pos_invoices",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
        sa.Column("customer_contact_id", sa.BigInteger(), nullable=True),
        sa.Column("customer_organization_id", sa.BigInteger(), nullable=True),
        sa.Column("invoice_number", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), server_default="pos", nullable=False),
        sa.Column("status", sa.Text(), server_default="issued", nullable=False),
        sa.Column("payment_status", sa.Text(), server_default="unpaid", nullable=False),
        sa.Column("payment_method", sa.Text(), nullable=True),
        sa.Column("template_id", sa.Text(), server_default="modern", nullable=False),
        sa.Column("accent_color", sa.Text(), server_default="#14b8a6", nullable=False),
        sa.Column("customer_name", sa.Text(), nullable=False),
        sa.Column("customer_email", sa.Text(), nullable=True),
        sa.Column("customer_address", sa.Text(), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("currency", sa.Text(), server_default="USD", nullable=False),
        sa.Column("subtotal_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("discount_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("tax_rate", sa.Numeric(8, 4), server_default="0", nullable=False),
        sa.Column("tax_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("amount_paid", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("payment_terms", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.CheckConstraint("status IN ('draft', 'issued', 'paid', 'void')", name="ck_finance_pos_invoice_status"),
        sa.CheckConstraint("payment_status IN ('unpaid', 'partial', 'paid', 'refunded')", name="ck_finance_pos_invoice_payment_status"),
        sa.CheckConstraint("template_id IN ('modern', 'classic', 'compact')", name="ck_finance_pos_invoice_template"),
        sa.ForeignKeyConstraint(["customer_contact_id"], ["sales_contacts.contact_id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["customer_organization_id"], ["sales_organizations.org_id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_finance_pos_invoices_id", "finance_pos_invoices", ["id"])
    op.create_index("ix_finance_pos_invoices_tenant_id", "finance_pos_invoices", ["tenant_id"])
    op.create_index("ix_finance_pos_invoices_user_id", "finance_pos_invoices", ["user_id"])
    op.create_index("ix_finance_pos_invoices_active_tenant", "finance_pos_invoices", ["tenant_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_finance_pos_invoices_tenant_status_active", "finance_pos_invoices", ["tenant_id", "status"], postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_finance_pos_invoices_tenant_number", "finance_pos_invoices", ["tenant_id", "invoice_number"], unique=True)
    op.create_table(
        "finance_pos_invoice_lines",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("invoice_id", sa.BigInteger(), nullable=False),
        sa.Column("catalog_product_id", sa.BigInteger(), nullable=True),
        sa.Column("catalog_service_id", sa.BigInteger(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), server_default="1", nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 4), server_default="0", nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("sort_order", sa.BigInteger(), server_default="0", nullable=False),
        sa.CheckConstraint("quantity > 0", name="ck_finance_pos_invoice_lines_quantity_positive"),
        sa.CheckConstraint("unit_price >= 0", name="ck_finance_pos_invoice_lines_unit_price_nonnegative"),
        sa.CheckConstraint("line_total >= 0", name="ck_finance_pos_invoice_lines_total_nonnegative"),
        sa.ForeignKeyConstraint(["catalog_product_id"], ["catalog_products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["catalog_service_id"], ["catalog_services.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["invoice_id"], ["finance_pos_invoices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_finance_pos_invoice_lines_id", "finance_pos_invoice_lines", ["id"])
    op.create_index("ix_finance_pos_invoice_lines_invoice_id", "finance_pos_invoice_lines", ["invoice_id"])
    op.create_index("ix_finance_pos_invoice_lines_invoice", "finance_pos_invoice_lines", ["invoice_id", "sort_order"])


def downgrade() -> None:
    op.drop_table("finance_pos_invoice_lines")
    op.drop_table("finance_pos_invoices")
    op.execute(sa.text("DROP SEQUENCE IF EXISTS finance_pos_invoice_number_seq"))
    op.execute("DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'finance_pos')")
    op.execute("DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'finance_pos')")
    op.execute("DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'finance_pos')")
    op.execute("DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name = 'finance_pos')")
    op.execute("DELETE FROM modules WHERE name = 'finance_pos'")
