"""add reports forecasting

Revision ID: 20260618_forecasting
Revises: 20260617_sales_orders
Create Date: 2026-05-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260618_forecasting"
down_revision: Union[str, None] = "20260617_sales_orders"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    inspector = sa.inspect(bind)
    constraints = inspector.get_check_constraints(table_name)
    return constraint_name in {constraint["name"] for constraint in constraints}


def upgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "sales_opportunities") and not _column_exists(bind, "sales_opportunities", "probability_percent"):
        op.add_column("sales_opportunities", sa.Column("probability_percent", sa.Numeric(5, 2), nullable=True))
    if bind.dialect.name != "sqlite" and not _constraint_exists(bind, "sales_opportunities", "ck_sales_opportunities_probability_range"):
        op.create_check_constraint(
            "ck_sales_opportunities_probability_range",
            "sales_opportunities",
            "probability_percent IS NULL OR (probability_percent >= 0 AND probability_percent <= 100)",
        )
    if not _index_exists(bind, "sales_opportunities", "ix_sales_opportunities_tenant_close_active"):
        if bind.dialect.name == "postgresql":
            op.create_index(
                "ix_sales_opportunities_tenant_close_active",
                "sales_opportunities",
                ["tenant_id", "expected_close_date"],
                postgresql_where=sa.text("deleted_at IS NULL"),
            )
        else:
            op.create_index("ix_sales_opportunities_tenant_close_active", "sales_opportunities", ["tenant_id", "expected_close_date"])

    if not _table_exists(bind, "forecast_snapshots"):
        op.create_table(
            "forecast_snapshots",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("period_start", sa.Date(), nullable=False),
            sa.Column("period_end", sa.Date(), nullable=False),
            sa.Column("owner_id", sa.BigInteger(), nullable=True),
            sa.Column("team_id", sa.BigInteger(), nullable=True),
            sa.Column("pipeline_key", sa.String(length=100), nullable=True),
            sa.Column("gross_pipeline_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("weighted_pipeline_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("commit_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("best_case_amount", sa.Numeric(18, 2), server_default="0", nullable=False),
            sa.Column("snapshot_json", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["team_id"], ["teams.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    indexes = [
        ("forecast_snapshots", "ix_forecast_snapshots_id", ["id"]),
        ("forecast_snapshots", "ix_forecast_snapshots_tenant_id", ["tenant_id"]),
        ("forecast_snapshots", "ix_forecast_snapshots_owner_id", ["owner_id"]),
        ("forecast_snapshots", "ix_forecast_snapshots_team_id", ["team_id"]),
        ("forecast_snapshots", "ix_forecast_snapshots_pipeline_key", ["pipeline_key"]),
        ("forecast_snapshots", "ix_forecast_snapshots_tenant_period", ["tenant_id", "period_start", "period_end"]),
        ("forecast_snapshots", "ix_forecast_snapshots_tenant_created", ["tenant_id", "created_at"]),
        ("forecast_snapshots", "ix_forecast_snapshots_tenant_owner", ["tenant_id", "owner_id"]),
        ("forecast_snapshots", "ix_forecast_snapshots_tenant_team", ["tenant_id", "team_id"]),
    ]
    for table_name, index_name, columns in indexes:
        if not _index_exists(bind, table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=False)

    if _table_exists(bind, "module_field_configs"):
        op.execute(
            sa.text(
                """
                INSERT INTO module_field_configs (
                    tenant_id, module_key, field_key, label, field_type, field_source,
                    is_enabled, is_protected, sort_order
                )
                SELECT tenants.id, 'sales_opportunities', 'probability_percent', 'Probability', 'number', 'system',
                    true, false, 34
                FROM tenants
                ON CONFLICT (tenant_id, module_key, field_key) DO NOTHING
                """
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "module_field_configs"):
        op.execute(
            sa.text(
                "DELETE FROM module_field_configs WHERE module_key = 'sales_opportunities' AND field_key = 'probability_percent'"
            )
        )
    for index_name in (
        "ix_forecast_snapshots_tenant_team",
        "ix_forecast_snapshots_tenant_owner",
        "ix_forecast_snapshots_tenant_created",
        "ix_forecast_snapshots_tenant_period",
        "ix_forecast_snapshots_pipeline_key",
        "ix_forecast_snapshots_team_id",
        "ix_forecast_snapshots_owner_id",
        "ix_forecast_snapshots_tenant_id",
        "ix_forecast_snapshots_id",
    ):
        if _index_exists(bind, "forecast_snapshots", index_name):
            op.drop_index(index_name, table_name="forecast_snapshots")
    if _table_exists(bind, "forecast_snapshots"):
        op.drop_table("forecast_snapshots")
    if _index_exists(bind, "sales_opportunities", "ix_sales_opportunities_tenant_close_active"):
        op.drop_index("ix_sales_opportunities_tenant_close_active", table_name="sales_opportunities")
    if bind.dialect.name != "sqlite" and _constraint_exists(bind, "sales_opportunities", "ck_sales_opportunities_probability_range"):
        op.drop_constraint("ck_sales_opportunities_probability_range", "sales_opportunities", type_="check")
    if _column_exists(bind, "sales_opportunities", "probability_percent"):
        op.drop_column("sales_opportunities", "probability_percent")
