"""add support cases

Revision ID: 20260621_support_cases
Revises: 20260620_doc_versions
Create Date: 2026-05-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260621_support_cases"
down_revision: Union[str, None] = "20260620_doc_versions"
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
    if not _table_exists(bind, "support_cases"):
        op.create_table(
            "support_cases",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("case_number", sa.Text(), nullable=False),
            sa.Column("subject", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), server_default="new", nullable=False),
            sa.Column("priority", sa.Text(), server_default="medium", nullable=False),
            sa.Column("source", sa.Text(), nullable=True),
            sa.Column("contact_id", sa.BigInteger(), nullable=True),
            sa.Column("organization_id", sa.BigInteger(), nullable=True),
            sa.Column("opportunity_id", sa.BigInteger(), nullable=True),
            sa.Column("quote_id", sa.BigInteger(), nullable=True),
            sa.Column("order_id", sa.Integer(), nullable=True),
            sa.Column("assigned_to_id", sa.BigInteger(), nullable=True),
            sa.Column("created_by_id", sa.BigInteger(), nullable=True),
            sa.Column("sla_due_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("status IN ('new', 'open', 'pending', 'resolved', 'closed')", name="ck_support_cases_status"),
            sa.CheckConstraint("priority IN ('low', 'medium', 'high', 'urgent')", name="ck_support_cases_priority"),
            sa.ForeignKeyConstraint(["assigned_to_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["contact_id"], ["sales_contacts.contact_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["opportunity_id"], ["sales_opportunities.opportunity_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["order_id"], ["sales_orders.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["organization_id"], ["sales_organizations.org_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["quote_id"], ["sales_quotes.quote_id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "case_number", name="uq_support_cases_tenant_number"),
        )
    if not _table_exists(bind, "support_case_comments"):
        op.create_table(
            "support_case_comments",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=False),
            sa.Column("author_id", sa.BigInteger(), nullable=True),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("is_internal", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["author_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["case_id"], ["support_cases.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _table_exists(bind, "support_case_events"):
        op.create_table(
            "support_case_events",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("case_id", sa.Integer(), nullable=False),
            sa.Column("event_type", sa.Text(), nullable=False),
            sa.Column("payload_json", sa.JSON(), server_default="{}", nullable=False),
            sa.Column("created_by_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["case_id"], ["support_cases.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = [
        ("support_cases", "ix_support_cases_id", ["id"]),
        ("support_cases", "ix_support_cases_tenant_id", ["tenant_id"]),
        ("support_cases", "ix_support_cases_case_number", ["case_number"]),
        ("support_cases", "ix_support_cases_contact_id", ["contact_id"]),
        ("support_cases", "ix_support_cases_organization_id", ["organization_id"]),
        ("support_cases", "ix_support_cases_opportunity_id", ["opportunity_id"]),
        ("support_cases", "ix_support_cases_quote_id", ["quote_id"]),
        ("support_cases", "ix_support_cases_order_id", ["order_id"]),
        ("support_cases", "ix_support_cases_assigned_to_id", ["assigned_to_id"]),
        ("support_cases", "ix_support_cases_created_by_id", ["created_by_id"]),
        ("support_cases", "ix_support_cases_tenant_status", ["tenant_id", "status"]),
        ("support_cases", "ix_support_cases_tenant_priority", ["tenant_id", "priority"]),
        ("support_cases", "ix_support_cases_tenant_assignee", ["tenant_id", "assigned_to_id"]),
        ("support_case_comments", "ix_support_case_comments_id", ["id"]),
        ("support_case_comments", "ix_support_case_comments_tenant_id", ["tenant_id"]),
        ("support_case_comments", "ix_support_case_comments_case_id", ["case_id"]),
        ("support_case_comments", "ix_support_case_comments_author_id", ["author_id"]),
        ("support_case_comments", "ix_support_case_comments_tenant_case", ["tenant_id", "case_id"]),
        ("support_case_events", "ix_support_case_events_id", ["id"]),
        ("support_case_events", "ix_support_case_events_tenant_id", ["tenant_id"]),
        ("support_case_events", "ix_support_case_events_case_id", ["case_id"]),
        ("support_case_events", "ix_support_case_events_created_by_id", ["created_by_id"]),
        ("support_case_events", "ix_support_case_events_tenant_case", ["tenant_id", "case_id"]),
        ("support_case_events", "ix_support_case_events_tenant_type", ["tenant_id", "event_type"]),
    ]
    for table_name, index_name, columns in indexes:
        if not _index_exists(bind, table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=False)

    if bind.dialect.name == "postgresql" and not _index_exists(bind, "support_cases", "ix_support_cases_active_tenant"):
        op.create_index("ix_support_cases_active_tenant", "support_cases", ["tenant_id"], unique=False, postgresql_where=sa.text("closed_at IS NULL"))

    op.execute(
        sa.text(
            """
            INSERT INTO modules (name, base_route, description, is_enabled)
            VALUES ('support_cases', '/dashboard/support/cases', 'Customer support cases', 1)
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
            WHERE modules.name = 'support_cases'
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
            WHERE modules.name = 'support_cases'
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
                0,
                CASE WHEN roles.level >= 90 THEN 1 ELSE 0 END,
                CASE WHEN roles.level >= 100 THEN 1 ELSE 0 END
            FROM roles
            CROSS JOIN modules
            WHERE modules.name = 'support_cases'
            ON CONFLICT (role_id, module_id) DO NOTHING
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute(sa.text("DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'support_cases')"))
    op.execute(sa.text("DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'support_cases')"))
    op.execute(sa.text("DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = 'support_cases')"))
    op.execute(sa.text("DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name = 'support_cases')"))
    op.execute(sa.text("DELETE FROM modules WHERE name = 'support_cases'"))
    for table_name in ("support_case_events", "support_case_comments", "support_cases"):
        if _table_exists(bind, table_name):
            op.drop_table(table_name)
