"""Remove global user email uniqueness

Revision ID: 20260712_user_email_scope
Revises: 20260711_token_timestamps
Create Date: 2026-06-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260712_user_email_scope"
down_revision: Union[str, None] = "20260711_token_timestamps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return sa.inspect(bind).has_table(table_name)


def _unique_constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return any(
        constraint["name"] == constraint_name
        for constraint in sa.inspect(bind).get_unique_constraints(table_name)
    )


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return any(index["name"] == index_name for index in sa.inspect(bind).get_indexes(table_name))


def _drop_global_email_uniques(bind) -> None:
    if not _table_exists(bind, "users"):
        return

    inspector = sa.inspect(bind)
    for constraint in inspector.get_unique_constraints("users"):
        if constraint.get("column_names") == ["email"]:
            op.drop_constraint(constraint["name"], "users", type_="unique")

    for index in inspector.get_indexes("users"):
        if index.get("unique") and index.get("column_names") == ["email"]:
            if bind.dialect.name == "postgresql":
                op.execute(sa.text(f'DROP INDEX IF EXISTS "{index["name"]}"'))
            else:
                op.drop_index(index["name"], table_name="users")


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "users"):
        return

    _drop_global_email_uniques(bind)
    if not _unique_constraint_exists(bind, "users", "uq_users_tenant_email"):
        op.create_unique_constraint("uq_users_tenant_email", "users", ["tenant_id", "email"])
    if not _index_exists(bind, "users", "ix_users_email"):
        op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "users"):
        return

    if _unique_constraint_exists(bind, "users", "uq_users_tenant_email"):
        op.drop_constraint("uq_users_tenant_email", "users", type_="unique")
    if _index_exists(bind, "users", "ix_users_email"):
        op.drop_index(op.f("ix_users_email"), table_name="users")
    op.create_unique_constraint("users_email_key", "users", ["email"])
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=False)
