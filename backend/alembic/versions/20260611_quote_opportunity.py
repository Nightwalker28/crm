"""link sales quotes to opportunities

Revision ID: 20260611_quote_opportunity
Revises: 20260610_sales_quotes
Create Date: 2026-05-25
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260611_quote_opportunity"
down_revision: Union[str, None] = "20260610_sales_quotes"
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


def _fk_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return constraint_name in {fk["name"] for fk in sa.inspect(bind).get_foreign_keys(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "sales_quotes"):
        return

    if not _column_exists(bind, "sales_quotes", "opportunity_id"):
        op.add_column("sales_quotes", sa.Column("opportunity_id", sa.BigInteger(), nullable=True))

    if not _fk_exists(bind, "sales_quotes", "fk_sales_quotes_opportunity_id"):
        op.create_foreign_key(
            "fk_sales_quotes_opportunity_id",
            "sales_quotes",
            "sales_opportunities",
            ["opportunity_id"],
            ["opportunity_id"],
            ondelete="SET NULL",
        )

    if not _index_exists(bind, "sales_quotes", "ix_sales_quotes_tenant_opportunity"):
        op.create_index("ix_sales_quotes_tenant_opportunity", "sales_quotes", ["tenant_id", "opportunity_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "sales_quotes") or not _column_exists(bind, "sales_quotes", "opportunity_id"):
        return

    if _index_exists(bind, "sales_quotes", "ix_sales_quotes_tenant_opportunity"):
        op.drop_index("ix_sales_quotes_tenant_opportunity", table_name="sales_quotes")
    if _fk_exists(bind, "sales_quotes", "fk_sales_quotes_opportunity_id"):
        op.drop_constraint("fk_sales_quotes_opportunity_id", "sales_quotes", type_="foreignkey")
    op.drop_column("sales_quotes", "opportunity_id")
