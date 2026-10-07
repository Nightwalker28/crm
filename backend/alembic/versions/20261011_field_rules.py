"""Field rules: an administrator can make a standard field required or read-only (13b Phase 4, F3.4)

`module_field_configs` gains `is_required` and `is_readonly` next to `is_enabled` (visibility).
They only ever add strictness: a field the domain needs stays required whatever the config says.

Revision ID: 20261011_field_rules
Revises: 20261010_standard_records
Create Date: 2026-10-06
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261011_field_rules"
down_revision: Union[str, None] = "20261010_standard_records"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "module_field_configs",
        sa.Column("is_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "module_field_configs",
        sa.Column("is_readonly", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("module_field_configs", "is_readonly")
    op.drop_column("module_field_configs", "is_required")
