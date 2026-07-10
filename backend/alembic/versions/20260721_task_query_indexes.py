"""add tenant task list indexes

Revision ID: 20260721_task_query_indexes
Revises: 20260720_sales_timestamps
Create Date: 2026-07-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260721_task_query_indexes"
down_revision: Union[str, None] = "20260720_sales_timestamps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


INDEXES = (
    ("ix_tasks_tenant_status", ["tenant_id", "status"]),
    ("ix_tasks_tenant_due_at", ["tenant_id", "due_at"]),
)


def _index_exists(bind, index_name: str) -> bool:
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes("tasks")}


def upgrade() -> None:
    bind = op.get_bind()
    for index_name, columns in INDEXES:
        if not _index_exists(bind, index_name):
            op.create_index(index_name, "tasks", columns)


def downgrade() -> None:
    bind = op.get_bind()
    for index_name, _columns in reversed(INDEXES):
        if _index_exists(bind, index_name):
            op.drop_index(index_name, table_name="tasks")
