"""allow contact assignee deletion

Revision ID: 20260719_contact_assignee
Revises: 20260718_sales_org_updated_at
Create Date: 2026-07-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260719_contact_assignee"
down_revision: Union[str, None] = "20260718_sales_org_updated_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _assigned_to_foreign_keys(bind) -> list[str]:
    if not _table_exists(bind, "sales_contacts"):
        return []
    names: list[str] = []
    for foreign_key in sa.inspect(bind).get_foreign_keys("sales_contacts"):
        if foreign_key.get("constrained_columns") == ["assigned_to"] and foreign_key.get("referred_table") == "users":
            name = foreign_key.get("name")
            if name:
                names.append(name)
    return names


def _drop_assigned_to_foreign_keys(bind) -> None:
    for name in _assigned_to_foreign_keys(bind):
        op.drop_constraint(name, "sales_contacts", type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, "sales_contacts", "assigned_to"):
        return

    _drop_assigned_to_foreign_keys(bind)
    op.alter_column(
        "sales_contacts",
        "assigned_to",
        existing_type=sa.BigInteger(),
        nullable=True,
    )
    op.create_foreign_key(
        "fk_sales_contacts_assigned_to_users",
        "sales_contacts",
        "users",
        ["assigned_to"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, "sales_contacts", "assigned_to"):
        return

    _drop_assigned_to_foreign_keys(bind)
    op.alter_column(
        "sales_contacts",
        "assigned_to",
        existing_type=sa.BigInteger(),
        nullable=False,
    )
    op.create_foreign_key(
        "sales_contacts_assigned_to_fkey",
        "sales_contacts",
        "users",
        ["assigned_to"],
        ["id"],
        ondelete="RESTRICT",
    )
