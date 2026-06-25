"""add tenant-scoped crm number counters

Revision ID: 20260710_number_counters
Revises: 20260709_doc_storage
Create Date: 2026-06-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260710_number_counters"
down_revision: Union[str, None] = "20260709_doc_storage"
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
    if not _table_exists(bind, "crm_number_counters"):
        op.create_table(
            "crm_number_counters",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("scope", sa.String(length=100), nullable=False),
            sa.Column("period", sa.String(length=20), nullable=False),
            sa.Column("next_value", sa.Integer(), server_default="1", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "scope", "period", name="uq_crm_number_counters_tenant_scope_period"),
        )
    if not _index_exists(bind, "crm_number_counters", "ix_crm_number_counters_tenant_scope"):
        op.create_index("ix_crm_number_counters_tenant_scope", "crm_number_counters", ["tenant_id", "scope"], unique=False)
    if not _index_exists(bind, "crm_number_counters", "ix_crm_number_counters_tenant_id"):
        op.create_index("ix_crm_number_counters_tenant_id", "crm_number_counters", ["tenant_id"], unique=False)
    if not _index_exists(bind, "crm_number_counters", "ix_crm_number_counters_id"):
        op.create_index("ix_crm_number_counters_id", "crm_number_counters", ["id"], unique=False)
    _backfill_existing_counters(bind)


def _backfill_existing_counters(bind) -> None:
    if bind.dialect.name == "postgresql":
        sources = (
            ("sales_quotes", "sales_quotes", "quote_number", "Q"),
            ("sales_orders", "sales_orders", "order_number", "SO"),
            ("support_cases", "support_cases", "case_number", "CASE"),
        )
        for scope, table_name, column_name, prefix in sources:
            if not _table_exists(bind, table_name):
                continue
            op.execute(
                sa.text(
                    f"""
                    INSERT INTO crm_number_counters (tenant_id, scope, period, next_value)
                    SELECT tenant_id,
                           :scope,
                           substring({column_name} from :period_pattern) AS period,
                           max((substring({column_name} from :sequence_pattern))::integer) + 1 AS next_value
                    FROM {table_name}
                    WHERE {column_name} ~ :number_pattern
                    GROUP BY tenant_id, period
                    ON CONFLICT (tenant_id, scope, period)
                    DO UPDATE SET next_value = greatest(crm_number_counters.next_value, EXCLUDED.next_value)
                    """
                ).bindparams(
                    scope=scope,
                    period_pattern=f"^{prefix}-([0-9]{{8}})-[0-9]+$",
                    sequence_pattern=f"^{prefix}-[0-9]{{8}}-([0-9]+)$",
                    number_pattern=f"^{prefix}-[0-9]{{8}}-[0-9]+$",
                )
            )
        return

    sources = (
        ("sales_quotes", "sales_quotes", "quote_number", "Q-", 3, 12),
        ("sales_orders", "sales_orders", "order_number", "SO-", 4, 13),
        ("support_cases", "support_cases", "case_number", "CASE-", 6, 15),
    )
    for scope, table_name, column_name, prefix, period_start, sequence_start in sources:
        if not _table_exists(bind, table_name):
            continue
        op.execute(
            sa.text(
                f"""
                INSERT INTO crm_number_counters (tenant_id, scope, period, next_value)
                SELECT tenant_id,
                       :scope,
                       substr({column_name}, :period_start, 8) AS period,
                       max(CAST(substr({column_name}, :sequence_start) AS INTEGER)) + 1 AS next_value
                FROM {table_name}
                WHERE {column_name} LIKE :prefix_like
                  AND length({column_name}) >= :minimum_length
                GROUP BY tenant_id, period
                ON CONFLICT (tenant_id, scope, period)
                DO UPDATE SET next_value = max(crm_number_counters.next_value, excluded.next_value)
                """
            ).bindparams(
                scope=scope,
                period_start=period_start,
                sequence_start=sequence_start,
                prefix_like=f"{prefix}________-%",
                minimum_length=sequence_start,
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "crm_number_counters"):
        for index_name in (
            "ix_crm_number_counters_id",
            "ix_crm_number_counters_tenant_id",
            "ix_crm_number_counters_tenant_scope",
        ):
            if _index_exists(bind, "crm_number_counters", index_name):
                op.drop_index(index_name, table_name="crm_number_counters")
        op.drop_table("crm_number_counters")
