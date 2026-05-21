"""add first-class sales leads module

Revision ID: 20260608_sales_leads
Revises: 20260607_remove_generic_mods
Create Date: 2026-05-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260608_sales_leads"
down_revision: Union[str, None] = "20260607_remove_generic_mods"
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
    if not _table_exists(bind, "sales_leads"):
        op.create_table(
            "sales_leads",
            sa.Column("lead_id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("first_name", sa.Text(), nullable=True),
            sa.Column("last_name", sa.Text(), nullable=True),
            sa.Column("company", sa.Text(), nullable=True),
            sa.Column("primary_email", sa.Text(), nullable=False),
            sa.Column("phone", sa.Text(), nullable=True),
            sa.Column("title", sa.Text(), nullable=True),
            sa.Column("source", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), server_default="new", nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("assigned_to", sa.BigInteger(), nullable=True),
            sa.Column("created_time", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_contacted_channel", sa.Text(), nullable=True),
            sa.Column("last_contacted_by_user_id", sa.BigInteger(), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "search_doc",
                sa.Text(),
                sa.Computed(
                    "lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || "
                    "coalesce(company, '') || ' ' || coalesce(primary_email, '') || ' ' || "
                    "coalesce(phone, '') || ' ' || coalesce(title, '') || ' ' || "
                    "coalesce(source, '') || ' ' || coalesce(status, ''))",
                    persisted=True,
                ),
                nullable=True,
            ),
            sa.CheckConstraint(
                "status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted')",
                name="ck_sales_leads_status",
            ),
            sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["last_contacted_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("lead_id"),
        )
        op.create_index(op.f("ix_sales_leads_lead_id"), "sales_leads", ["lead_id"], unique=False)
        op.create_index(op.f("ix_sales_leads_primary_email"), "sales_leads", ["primary_email"], unique=False)
        op.create_index(op.f("ix_sales_leads_tenant_id"), "sales_leads", ["tenant_id"], unique=False)
        op.create_index("ix_sales_leads_last_contacted_at", "sales_leads", ["last_contacted_at"], unique=False)
        op.create_index("ix_sales_leads_last_contacted_by_user_id", "sales_leads", ["last_contacted_by_user_id"], unique=False)

    if not _index_exists(bind, "sales_leads", "ix_sales_leads_active_tenant"):
        op.create_index("ix_sales_leads_active_tenant", "sales_leads", ["tenant_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    if not _index_exists(bind, "sales_leads", "ix_sales_leads_tenant_status_active"):
        op.create_index("ix_sales_leads_tenant_status_active", "sales_leads", ["tenant_id", "status"], postgresql_where=sa.text("deleted_at IS NULL"))
    if bind.dialect.name == "postgresql" and not _index_exists(bind, "sales_leads", "uq_sales_leads_tenant_email_active"):
        op.execute(
            sa.text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_leads_tenant_email_active "
                "ON sales_leads (tenant_id, lower(primary_email)) WHERE deleted_at IS NULL"
            )
        )
        op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_sales_leads_search_doc_trgm_active "
                "ON sales_leads USING GIN (search_doc gin_trgm_ops) WHERE deleted_at IS NULL"
            )
        )

    op.execute(
        sa.text(
            """
            INSERT INTO modules (name, base_route, description, is_enabled)
            VALUES ('sales_leads', '/dashboard/sales/leads', 'Sales leads', 1)
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
            WHERE modules.name = 'sales_leads'
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
            WHERE modules.name = 'sales_leads'
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
            WHERE modules.name = 'sales_leads'
            ON CONFLICT (role_id, module_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute(sa.text("DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_leads')"))
    op.execute(sa.text("DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_leads')"))
    op.execute(sa.text("DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_leads')"))
    op.execute(sa.text("DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name = 'sales_leads')"))
    op.execute(sa.text("DELETE FROM module_field_configs WHERE module_key = 'sales_leads'"))
    op.execute(sa.text("DELETE FROM modules WHERE name = 'sales_leads'"))
    if _table_exists(bind, "sales_leads"):
        for index_name in (
            "ix_sales_leads_search_doc_trgm_active",
            "uq_sales_leads_tenant_email_active",
            "ix_sales_leads_tenant_status_active",
            "ix_sales_leads_active_tenant",
            "ix_sales_leads_last_contacted_by_user_id",
            "ix_sales_leads_last_contacted_at",
            op.f("ix_sales_leads_tenant_id"),
            op.f("ix_sales_leads_primary_email"),
            op.f("ix_sales_leads_lead_id"),
        ):
            if _index_exists(bind, "sales_leads", index_name):
                op.drop_index(index_name, table_name="sales_leads")
        op.drop_table("sales_leads")
