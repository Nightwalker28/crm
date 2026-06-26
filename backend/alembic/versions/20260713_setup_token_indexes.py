"""Add setup token cleanup indexes

Revision ID: 20260713_setup_token_indexes
Revises: 20260712_user_email_scope
Create Date: 2026-06-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260713_setup_token_indexes"
down_revision: Union[str, None] = "20260712_user_email_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE_NAME = "user_setup_tokens"


def _table_exists(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return any(index["name"] == index_name for index in sa.inspect(bind).get_indexes(table_name))


def _create_index_if_missing(index_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if _index_exists(bind, TABLE_NAME, index_name):
        return
    op.create_index(index_name, TABLE_NAME, columns, unique=False)


def _drop_index_if_exists(index_name: str) -> None:
    bind = op.get_bind()
    if _index_exists(bind, TABLE_NAME, index_name):
        op.drop_index(index_name, table_name=TABLE_NAME)


def upgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE_NAME):
        return
    _create_index_if_missing("ix_user_setup_tokens_expires_at", ["expires_at"])
    _create_index_if_missing("ix_user_setup_tokens_consumed_expires", ["consumed_at", "expires_at"])
    _create_index_if_missing("ix_user_setup_tokens_user_consumed", ["user_id", "consumed_at"])


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE_NAME):
        return
    _drop_index_if_exists("ix_user_setup_tokens_user_consumed")
    _drop_index_if_exists("ix_user_setup_tokens_consumed_expires")
    _drop_index_if_exists("ix_user_setup_tokens_expires_at")
