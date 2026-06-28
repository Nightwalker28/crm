"""add search and hot-path indexes

Revision ID: 20260717_search_hot_indexes
Revises: 20260716_fin_pos_number
Create Date: 2026-06-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260717_search_hot_indexes"
down_revision: Union[str, None] = "20260716_fin_pos_number"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PG_TRGM_INDEXES = (
    (
        "ix_support_cases_search_trgm",
        "support_cases",
        "lower(coalesce(case_number, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, '') || ' ' || coalesce(source, ''))",
    ),
    (
        "ix_contracts_search_trgm",
        "contracts",
        "lower(coalesce(contract_number, '') || ' ' || coalesce(title, '') || ' ' || coalesce(status, ''))",
    ),
)

BTREE_INDEXES = (
    (
        "ix_support_cases_open_sla_due",
        "support_cases",
        ["tenant_id", "sla_due_at"],
        "closed_at IS NULL AND sla_due_at IS NOT NULL",
    ),
    (
        "ix_contracts_tenant_expiration_open",
        "contracts",
        ["tenant_id", "expiration_date"],
        "expiration_date IS NOT NULL AND status NOT IN ('expired', 'cancelled')",
    ),
)


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _create_btree_index(bind, *, name: str, table_name: str, columns: list[str], where_clause: str) -> None:
    if not _table_exists(bind, table_name) or _index_exists(bind, table_name, name):
        return
    op.create_index(
        name,
        table_name,
        columns,
        postgresql_where=sa.text(where_clause),
        sqlite_where=sa.text(where_clause),
    )


def upgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            for name, table_name, expression in PG_TRGM_INDEXES:
                if not _table_exists(bind, table_name) or _index_exists(bind, table_name, name):
                    continue
                op.execute(sa.text(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table_name} USING GIN (({expression}) gin_trgm_ops)"))
            for name, table_name, columns, where_clause in BTREE_INDEXES:
                if not _table_exists(bind, table_name) or _index_exists(bind, table_name, name):
                    continue
                op.execute(sa.text(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table_name} ({', '.join(columns)}) WHERE {where_clause}"))
        return

    for name, table_name, columns, where_clause in BTREE_INDEXES:
        _create_btree_index(bind, name=name, table_name=table_name, columns=columns, where_clause=where_clause)


def downgrade() -> None:
    bind = op.get_bind()

    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            for name, table_name, _expression in reversed(PG_TRGM_INDEXES):
                if _index_exists(bind, table_name, name):
                    op.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
            for name, table_name, _columns, _where_clause in reversed(BTREE_INDEXES):
                if _index_exists(bind, table_name, name):
                    op.execute(sa.text(f"DROP INDEX CONCURRENTLY IF EXISTS {name}"))
        return

    for name, table_name, _columns, _where_clause in reversed(BTREE_INDEXES):
        if _index_exists(bind, table_name, name):
            op.drop_index(name, table_name=table_name)
