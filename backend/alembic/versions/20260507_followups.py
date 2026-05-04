"""Add CRM follow-up metadata

Revision ID: 20260507_followups
Revises: 20260506_doc_drive_conn
Create Date: 2026-05-07 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260507_followups"
down_revision: Union[str, None] = "20260506_doc_drive_conn"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, "sales_contacts", "last_contacted_at"):
        op.add_column("sales_contacts", sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index("ix_sales_contacts_last_contacted_at", "sales_contacts", ["last_contacted_at"])
    if not _column_exists(bind, "sales_contacts", "last_contacted_channel"):
        op.add_column("sales_contacts", sa.Column("last_contacted_channel", sa.Text(), nullable=True))
    if not _column_exists(bind, "sales_contacts", "last_contacted_by_user_id"):
        op.add_column("sales_contacts", sa.Column("last_contacted_by_user_id", sa.BigInteger(), nullable=True))
        op.create_index("ix_sales_contacts_last_contacted_by_user_id", "sales_contacts", ["last_contacted_by_user_id"])
        op.create_foreign_key(
            "fk_sales_contacts_last_contacted_by_user_id_users",
            "sales_contacts",
            "users",
            ["last_contacted_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if not _column_exists(bind, "sales_opportunities", "last_contacted_at"):
        op.add_column("sales_opportunities", sa.Column("last_contacted_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index("ix_sales_opportunities_last_contacted_at", "sales_opportunities", ["last_contacted_at"])
    if not _column_exists(bind, "sales_opportunities", "last_contacted_channel"):
        op.add_column("sales_opportunities", sa.Column("last_contacted_channel", sa.Text(), nullable=True))
    if not _column_exists(bind, "sales_opportunities", "last_contacted_by_user_id"):
        op.add_column("sales_opportunities", sa.Column("last_contacted_by_user_id", sa.BigInteger(), nullable=True))
        op.create_index("ix_sales_opportunities_last_contacted_by_user_id", "sales_opportunities", ["last_contacted_by_user_id"])
        op.create_foreign_key(
            "fk_sales_opportunities_last_contacted_by_user_id_users",
            "sales_opportunities",
            "users",
            ["last_contacted_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )

    if not _column_exists(bind, "tasks", "source_module_key"):
        op.add_column("tasks", sa.Column("source_module_key", sa.String(length=100), nullable=True))
        op.create_index("ix_tasks_source_module_key", "tasks", ["source_module_key"])
    if not _column_exists(bind, "tasks", "source_entity_id"):
        op.add_column("tasks", sa.Column("source_entity_id", sa.String(length=100), nullable=True))
        op.create_index("ix_tasks_source_entity_id", "tasks", ["source_entity_id"])
    if not _column_exists(bind, "tasks", "source_label"):
        op.add_column("tasks", sa.Column("source_label", sa.String(length=255), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if _column_exists(bind, "tasks", "source_label"):
        op.drop_column("tasks", "source_label")
    if _column_exists(bind, "tasks", "source_entity_id"):
        op.drop_index("ix_tasks_source_entity_id", table_name="tasks")
        op.drop_column("tasks", "source_entity_id")
    if _column_exists(bind, "tasks", "source_module_key"):
        op.drop_index("ix_tasks_source_module_key", table_name="tasks")
        op.drop_column("tasks", "source_module_key")

    if _column_exists(bind, "sales_opportunities", "last_contacted_by_user_id"):
        op.drop_constraint("fk_sales_opportunities_last_contacted_by_user_id_users", "sales_opportunities", type_="foreignkey")
        op.drop_index("ix_sales_opportunities_last_contacted_by_user_id", table_name="sales_opportunities")
        op.drop_column("sales_opportunities", "last_contacted_by_user_id")
    if _column_exists(bind, "sales_opportunities", "last_contacted_channel"):
        op.drop_column("sales_opportunities", "last_contacted_channel")
    if _column_exists(bind, "sales_opportunities", "last_contacted_at"):
        op.drop_index("ix_sales_opportunities_last_contacted_at", table_name="sales_opportunities")
        op.drop_column("sales_opportunities", "last_contacted_at")

    if _column_exists(bind, "sales_contacts", "last_contacted_by_user_id"):
        op.drop_constraint("fk_sales_contacts_last_contacted_by_user_id_users", "sales_contacts", type_="foreignkey")
        op.drop_index("ix_sales_contacts_last_contacted_by_user_id", table_name="sales_contacts")
        op.drop_column("sales_contacts", "last_contacted_by_user_id")
    if _column_exists(bind, "sales_contacts", "last_contacted_channel"):
        op.drop_column("sales_contacts", "last_contacted_channel")
    if _column_exists(bind, "sales_contacts", "last_contacted_at"):
        op.drop_index("ix_sales_contacts_last_contacted_at", table_name="sales_contacts")
        op.drop_column("sales_contacts", "last_contacted_at")
