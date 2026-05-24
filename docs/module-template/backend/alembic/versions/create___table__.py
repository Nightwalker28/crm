"""create __display_name__ module

Revision ID: replace_with_revision
Revises: replace_with_down_revision
Create Date: YYYY-MM-DD
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "replace_with_revision"
down_revision: Union[str, None] = "replace_with_down_revision"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "__table__"):
        op.create_table(
            "__table__",
            sa.Column("__id_field__", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("status", sa.Text(), server_default="active", nullable=False),
            sa.Column("assigned_to", sa.BigInteger(), nullable=True),
            sa.Column("created_time", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "search_doc",
                sa.Text(),
                sa.Computed("lower(coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(status, ''))", persisted=True),
                nullable=True,
            ),
            sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("__id_field__"),
        )
        op.create_index(op.f("ix___table_____id_field__"), "__table__", ["__id_field__"], unique=False)
        op.create_index(op.f("ix___table___tenant_id"), "__table__", ["tenant_id"], unique=False)

    if not _index_exists(bind, "__table__", "ix___table___active_tenant"):
        op.create_index("ix___table___active_tenant", "__table__", ["tenant_id"], postgresql_where=sa.text("deleted_at IS NULL"))
    if not _index_exists(bind, "__table__", "ix___table___tenant_name_active"):
        op.create_index("ix___table___tenant_name_active", "__table__", ["tenant_id", "name"], postgresql_where=sa.text("deleted_at IS NULL"))
    if bind.dialect.name == "postgresql":
        op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix___table___search_doc_trgm_active ON __table__ USING GIN (search_doc gin_trgm_ops) WHERE deleted_at IS NULL"))

    op.execute(
        sa.text(
            """
            INSERT INTO modules (name, base_route, description, is_enabled)
            VALUES ('__MODULE_KEY__', '__route_prefix__', '__display_name__', 1)
            ON CONFLICT (name) DO UPDATE
            SET base_route = EXCLUDED.base_route,
                description = EXCLUDED.description,
                is_enabled = 1
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    op.execute(sa.text("DELETE FROM role_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = '__MODULE_KEY__')"))
    op.execute(sa.text("DELETE FROM team_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = '__MODULE_KEY__')"))
    op.execute(sa.text("DELETE FROM department_module_permissions WHERE module_id IN (SELECT id FROM modules WHERE name = '__MODULE_KEY__')"))
    op.execute(sa.text("DELETE FROM tenant_module_configs WHERE module_id IN (SELECT id FROM modules WHERE name = '__MODULE_KEY__')"))
    op.execute(sa.text("DELETE FROM module_field_configs WHERE module_key = '__MODULE_KEY__'"))
    op.execute(sa.text("DELETE FROM modules WHERE name = '__MODULE_KEY__'"))
    if _table_exists(bind, "__table__"):
        for index_name in (
            "ix___table___search_doc_trgm_active",
            "ix___table___tenant_name_active",
            "ix___table___active_tenant",
            op.f("ix___table___tenant_id"),
            op.f("ix___table_____id_field__"),
        ):
            if _index_exists(bind, "__table__", index_name):
                op.drop_index(index_name, table_name="__table__")
        op.drop_table("__table__")
