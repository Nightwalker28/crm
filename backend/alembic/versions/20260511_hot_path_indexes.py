"""Add hot-path operational indexes

Revision ID: 20260511_hot_path_indexes
Revises: 20260510_client_pages
Create Date: 2026-05-11 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260511_hot_path_indexes"
down_revision: Union[str, None] = "20260510_client_pages"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    inspector = sa.inspect(bind)
    if table_name not in inspector.get_table_names():
        return False
    return index_name in {index["name"] for index in inspector.get_indexes(table_name)}


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    bind = op.get_bind()
    if _table_exists(bind, table_name) and not _index_exists(bind, table_name, index_name):
        op.create_index(index_name, table_name, columns)


def _drop_index_if_exists(index_name: str, table_name: str) -> None:
    bind = op.get_bind()
    if _index_exists(bind, table_name, index_name):
        op.drop_index(index_name, table_name=table_name)


def upgrade() -> None:
    _create_index_if_missing("ix_refresh_tokens_user_jti", "refresh_tokens", ["user_id", "token_jti"])
    _create_index_if_missing("ix_refresh_tokens_expires_at", "refresh_tokens", ["expires_at"])

    _create_index_if_missing("ix_activity_logs_module_entity", "activity_logs", ["module_key", "entity_id"])

    _create_index_if_missing("ix_user_notifications_user_status", "user_notifications", ["user_id", "status"])
    _create_index_if_missing("ix_user_notifications_user_created", "user_notifications", ["user_id", "created_at"])

    _create_index_if_missing("ix_user_saved_views_user_module", "user_saved_views", ["user_id", "module_key"])

    _create_index_if_missing("ix_custom_field_values_module_record", "custom_field_values", ["module_key", "record_id"])
    _create_index_if_missing(
        "ix_custom_field_values_definition_record",
        "custom_field_values",
        ["field_definition_id", "record_id"],
    )


def downgrade() -> None:
    _drop_index_if_exists("ix_custom_field_values_definition_record", "custom_field_values")
    _drop_index_if_exists("ix_custom_field_values_module_record", "custom_field_values")

    _drop_index_if_exists("ix_user_saved_views_user_module", "user_saved_views")

    _drop_index_if_exists("ix_user_notifications_user_created", "user_notifications")
    _drop_index_if_exists("ix_user_notifications_user_status", "user_notifications")

    _drop_index_if_exists("ix_activity_logs_module_entity", "activity_logs")

    _drop_index_if_exists("ix_refresh_tokens_expires_at", "refresh_tokens")
    _drop_index_if_exists("ix_refresh_tokens_user_jti", "refresh_tokens")
