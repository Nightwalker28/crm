"""tenant scope existing platform modules

Revision ID: 20260420_tenant_scope
Revises: 20260420_tenants_auth_foundation
Create Date: 2026-04-20
"""

from alembic import op
import sqlalchemy as sa


revision = "20260420_tenant_scope"
down_revision = "20260420_tenants_auth_foundation"
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
    for table_name in (
        "company_profiles",
        "sales_organizations",
        "sales_contacts",
        "sales_opportunities",
        "finance_io",
        "activity_logs",
        "custom_field_definitions",
        "custom_field_values",
        "data_transfer_jobs",
        "user_notifications",
    ):
        _add_tenant_column(table_name)


def _drop_tenant_column(table_name: str) -> None:
    op.drop_constraint(f"fk_{table_name}_tenant_id_tenants", table_name, type_="foreignkey")
    op.drop_index(f"ix_{table_name}_tenant_id", table_name=table_name)
    op.drop_column(table_name, "tenant_id")


def downgrade() -> None:
    for table_name in (
        "user_notifications",
        "data_transfer_jobs",
        "custom_field_values",
        "custom_field_definitions",
        "activity_logs",
        "finance_io",
        "sales_opportunities",
        "sales_contacts",
        "sales_organizations",
        "company_profiles",
    ):
        _drop_tenant_column(table_name)
