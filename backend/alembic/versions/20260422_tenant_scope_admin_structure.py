"""tenant scope admin structure

Revision ID: 20260422_admin_scope
Revises: 20260422_tenant_module_configs
Create Date: 2026-04-22 00:10:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260422_admin_scope"
down_revision = "20260422_tenant_module_configs"
branch_labels = None
depends_on = None


def _add_tenant_column(table_name: str) -> None:
    op.add_column(table_name, sa.Column("tenant_id", sa.BigInteger(), nullable=True))
    op.create_index(f"ix_{table_name}_tenant_id", table_name, ["tenant_id"])
    op.create_foreign_key(
        f"fk_{table_name}_tenant_id_tenants",
        table_name,
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.execute(f"UPDATE {table_name} SET tenant_id = 1 WHERE tenant_id IS NULL")
    op.alter_column(table_name, "tenant_id", nullable=False)


def upgrade() -> None:
    for table_name in ("roles", "departments", "teams"):
        _add_tenant_column(table_name)

    op.drop_constraint("roles_name_key", "roles", type_="unique")
    op.create_unique_constraint("uq_roles_tenant_name", "roles", ["tenant_id", "name"])
    op.create_unique_constraint("uq_departments_tenant_name", "departments", ["tenant_id", "name"])
    op.create_unique_constraint("uq_teams_tenant_name", "teams", ["tenant_id", "name"])


def downgrade() -> None:
    op.drop_constraint("uq_teams_tenant_name", "teams", type_="unique")
    op.drop_constraint("uq_departments_tenant_name", "departments", type_="unique")
    op.drop_constraint("uq_roles_tenant_name", "roles", type_="unique")
    op.create_unique_constraint("roles_name_key", "roles", ["name"])

    for table_name in ("teams", "departments", "roles"):
        op.drop_constraint(f"fk_{table_name}_tenant_id_tenants", table_name, type_="foreignkey")
        op.drop_index(f"ix_{table_name}_tenant_id", table_name=table_name)
        op.drop_column(table_name, "tenant_id")
