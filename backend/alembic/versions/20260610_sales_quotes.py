"""add first-class sales quotes module

Revision ID: 20260610_sales_quotes
Revises: 20260609_module_reports
Create Date: 2026-05-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260610_sales_quotes"
down_revision: Union[str, None] = "20260609_module_reports"
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
    if not _table_exists(bind, "sales_quotes"):
        op.create_table(
            "sales_quotes",
            sa.Column("quote_id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("quote_number", sa.Text(), nullable=False),
            sa.Column("title", sa.Text(), nullable=True),
            sa.Column("customer_name", sa.Text(), nullable=False),
            sa.Column("contact_id", sa.BigInteger(), nullable=True),
            sa.Column("organization_id", sa.BigInteger(), nullable=True),
            sa.Column("status", sa.Text(), server_default="draft", nullable=False),
            sa.Column("issue_date", sa.Date(), nullable=True),
            sa.Column("expiry_date", sa.Date(), nullable=True),
            sa.Column("currency", sa.Text(), server_default="USD", nullable=False),
            sa.Column("subtotal_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("discount_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("tax_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("total_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("assigned_to", sa.BigInteger(), nullable=True),
            sa.Column("created_time", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "search_doc",
                sa.Text(),
                sa.Computed(
                    "lower(coalesce(quote_number, '') || ' ' || coalesce(title, '') || ' ' || "
                    "coalesce(customer_name, '') || ' ' || coalesce(status, '') || ' ' || "
                    "coalesce(currency, '') || ' ' || coalesce(notes, ''))",
                    persisted=True,
                ),
                nullable=True,
            ),
            sa.CheckConstraint("status IN ('draft', 'sent', 'accepted', 'declined', 'expired')", name="ck_sales_quotes_status"),
            sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["contact_id"], ["sales_contacts.contact_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["organization_id"], ["sales_organizations.org_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("quote_id"),
        )
        op.create_index(op.f("ix_sales_quotes_quote_id"), "sales_quotes", ["quote_id"], unique=False)
        op.create_index(op.f("ix_sales_quotes_quote_number"), "sales_quotes", ["quote_number"], unique=False)
        op.create_index(op.f("ix_sales_quotes_tenant_id"), "sales_quotes", ["tenant_id"], unique=False)

    if not _index_exists(bind, "sales_quotes", "ix_sales_quotes_active_tenant"):
        op.create_index("ix_sales_quotes_active_tenant", "sales_quotes", ["tenant_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    if not _index_exists(bind, "sales_quotes", "ix_sales_quotes_tenant_status_active"):
        op.create_index("ix_sales_quotes_tenant_status_active", "sales_quotes", ["tenant_id", "status"], postgresql_where=sa.text("deleted_at IS NULL"))
    if not _index_exists(bind, "sales_quotes", "ix_sales_quotes_tenant_contact"):
        op.create_index("ix_sales_quotes_tenant_contact", "sales_quotes", ["tenant_id", "contact_id"])
    if not _index_exists(bind, "sales_quotes", "ix_sales_quotes_tenant_organization"):
        op.create_index("ix_sales_quotes_tenant_organization", "sales_quotes", ["tenant_id", "organization_id"])
    if bind.dialect.name == "postgresql":
        op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_quotes_tenant_number_active ON sales_quotes (tenant_id, lower(quote_number)) WHERE deleted_at IS NULL"))
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_sales_quotes_search_doc_trgm_active ON sales_quotes USING GIN (search_doc gin_trgm_ops) WHERE deleted_at IS NULL"))

    op.execute(
        sa.text(
            """
            INSERT INTO modules (name, base_route, description, is_enabled)
            VALUES ('sales_quotes', '/dashboard/sales/quotes', 'Sales quotes', 1)
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
            WHERE modules.name = 'sales_quotes'
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
            WHERE modules.name = 'sales_quotes'
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
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
            FROM roles
            CROSS JOIN modules
            WHERE modules.name = 'sales_quotes'
            ON CONFLICT (role_id, module_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute(sa.text("DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_quotes')"))
    op.execute(sa.text("DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_quotes')"))
    op.execute(sa.text("DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_quotes')"))
    op.execute(sa.text("DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_quotes')"))
    op.execute(sa.text("DELETE FROM module_field_configs WHERE module_key = 'sales_quotes'"))
    op.execute(sa.text("DELETE FROM modules WHERE name = 'sales_quotes'"))
    if _table_exists(bind, "sales_quotes"):
        for index_name in (
            "ix_sales_quotes_search_doc_trgm_active",
            "uq_sales_quotes_tenant_number_active",
            "ix_sales_quotes_tenant_organization",
            "ix_sales_quotes_tenant_contact",
            "ix_sales_quotes_tenant_status_active",
            "ix_sales_quotes_active_tenant",
            op.f("ix_sales_quotes_tenant_id"),
            op.f("ix_sales_quotes_quote_number"),
            op.f("ix_sales_quotes_quote_id"),
        ):
            if _index_exists(bind, "sales_quotes", index_name):
                op.drop_index(index_name, table_name="sales_quotes")
        op.drop_table("sales_quotes")
