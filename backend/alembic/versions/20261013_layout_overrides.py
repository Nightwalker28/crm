"""Role and team layout overrides (13b Phase 4 slice 4c, F3.5, 09 Phase 3)

`record_layout_definitions` gains `role_id` and `team_id` (at most one). An override is a
complete layout for that role or team; resolution is team → role → tenant default → product
default. The tenant default keeps its one-per-surface index, now limited to rows without a
scope, and each role or team gets at most one override per surface. Layout names stop being
unique: an override starts as a copy of the layout it overrides.

Revision ID: 20261013_layout_overrides
Revises: 20261012_picklist_deps
Create Date: 2026-10-06
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261013_layout_overrides"
down_revision: Union[str, None] = "20261012_picklist_deps"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "record_layout_definitions"


def upgrade() -> None:
    op.add_column(TABLE, sa.Column("role_id", sa.BigInteger(), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=True))
    op.add_column(TABLE, sa.Column("team_id", sa.BigInteger(), sa.ForeignKey("teams.id", ondelete="CASCADE"), nullable=True))
    op.create_index("ix_record_layout_definitions_role_id", TABLE, ["role_id"])
    op.create_index("ix_record_layout_definitions_team_id", TABLE, ["team_id"])
    op.create_check_constraint("ck_record_layout_defs_one_scope", TABLE, "role_id IS NULL OR team_id IS NULL")
    op.drop_constraint("uq_record_layout_defs_tenant_module_surface_name", TABLE, type_="unique")
    op.drop_index("uq_record_layout_defs_default", table_name=TABLE)
    op.create_index(
        "uq_record_layout_defs_default",
        TABLE,
        ["tenant_id", "module_key", "surface"],
        unique=True,
        postgresql_where=sa.text("is_default AND role_id IS NULL AND team_id IS NULL"),
        sqlite_where=sa.text("is_default = 1 AND role_id IS NULL AND team_id IS NULL"),
    )
    op.create_index(
        "uq_record_layout_defs_role",
        TABLE,
        ["tenant_id", "module_key", "surface", "role_id"],
        unique=True,
        postgresql_where=sa.text("role_id IS NOT NULL"),
        sqlite_where=sa.text("role_id IS NOT NULL"),
    )
    op.create_index(
        "uq_record_layout_defs_team",
        TABLE,
        ["tenant_id", "module_key", "surface", "team_id"],
        unique=True,
        postgresql_where=sa.text("team_id IS NOT NULL"),
        sqlite_where=sa.text("team_id IS NOT NULL"),
    )


def downgrade() -> None:
    raise NotImplementedError(
        "Overrides cannot be folded back into one layout per surface; restore from a backup instead."
    )
