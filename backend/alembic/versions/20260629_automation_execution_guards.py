"""add automation execution guards

Revision ID: 20260629_automation_guards
Revises: 20260628_automation_metadata
Create Date: 2026-06-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260629_automation_guards"
down_revision: Union[str, None] = "20260628_automation_metadata"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _constraint_exists(bind, table_name: str, constraint_name: str) -> bool:
    constraints = sa.inspect(bind).get_unique_constraints(table_name)
    return constraint_name in {constraint["name"] for constraint in constraints}


def upgrade() -> None:
    bind = op.get_bind()
    op.execute(
        sa.text(
            """
            DELETE FROM automation_rule_runs AS duplicate
            USING automation_rule_runs AS keeper
            WHERE
                duplicate.rule_id = keeper.rule_id
                AND duplicate.event_id = keeper.event_id
                AND duplicate.event_id IS NOT NULL
                AND duplicate.id > keeper.id
            """
        )
    )
    if not _constraint_exists(bind, "automation_rule_runs", "uq_automation_rule_runs_rule_event"):
        op.create_unique_constraint("uq_automation_rule_runs_rule_event", "automation_rule_runs", ["rule_id", "event_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if _constraint_exists(bind, "automation_rule_runs", "uq_automation_rule_runs_rule_event"):
        op.drop_constraint("uq_automation_rule_runs_rule_event", "automation_rule_runs", type_="unique")
