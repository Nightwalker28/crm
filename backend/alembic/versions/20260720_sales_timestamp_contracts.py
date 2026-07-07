"""normalize sales timestamp contracts

Revision ID: 20260720_sales_timestamps
Revises: 20260719_contact_assignee
Create Date: 2026-07-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260720_sales_timestamps"
down_revision: Union[str, None] = "20260719_contact_assignee"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CREATED_TIME_TABLES = ("sales_organizations", "sales_opportunities")


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in CREATED_TIME_TABLES:
        if not _column_exists(bind, table_name, "created_time"):
            continue
        op.execute(
            sa.text(
                f"UPDATE {table_name} "
                "SET created_time = CURRENT_TIMESTAMP "
                "WHERE created_time IS NULL"
            )
        )
        op.alter_column(
            table_name,
            "created_time",
            existing_type=sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        )


def downgrade() -> None:
    bind = op.get_bind()
    for table_name in reversed(CREATED_TIME_TABLES):
        if not _column_exists(bind, table_name, "created_time"):
            continue
        op.alter_column(
            table_name,
            "created_time",
            existing_type=sa.DateTime(timezone=True),
            nullable=True,
            server_default=sa.func.now(),
        )
