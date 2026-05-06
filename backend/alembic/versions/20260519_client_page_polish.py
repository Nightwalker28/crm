"""Add client page branding and proposal sections

Revision ID: 20260519_client_page_polish
Revises: 20260518_user_role_index
Create Date: 2026-05-19 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260519_client_page_polish"
down_revision: Union[str, None] = "20260518_user_role_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    bind = op.get_bind()
    if _table_exists(bind, table_name) and not _column_exists(bind, table_name, column.name):
        op.add_column(table_name, column)


def _drop_column_if_exists(table_name: str, column_name: str) -> None:
    bind = op.get_bind()
    if _column_exists(bind, table_name, column_name):
        op.drop_column(table_name, column_name)


def upgrade() -> None:
    _add_column_if_missing("client_pages", sa.Column("proposal_sections", sa.JSON(), nullable=True))
    _add_column_if_missing("client_pages", sa.Column("brand_settings", sa.JSON(), nullable=True))


def downgrade() -> None:
    _drop_column_if_exists("client_pages", "brand_settings")
    _drop_column_if_exists("client_pages", "proposal_sections")
