"""drop the legacy fixed-list check on sales_opportunities.sales_stage

Revision ID: 20260819_drop_stage_check
Revises: 20260818_opp_stage_refs
Create Date: 2026-09-29

Phase 4 of 04-pipelines-kanban. Every reader and writer of a deal's stage now goes
through `sales_pipeline_stages` (`assign_opportunity_stage`, the stage facts, the
semantic SQL clauses), and `sales_stage` is kept only as the mirrored stable key. The
check pinned that key to the six seeded stages, which is what stopped a tenant from
adding one. Validity is now the stage row: `assign_opportunity_stage` only writes a
key that exists in the deal's own tenant's pipeline.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260819_drop_stage_check"
down_revision: Union[str, None] = "20260818_opp_stage_refs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


CONSTRAINT_NAME = "ck_sales_opportunities_sales_stage"
LEGACY_STAGE_KEYS = ("lead", "qualified", "proposal", "negotiation", "closed_won", "closed_lost")

NON_LEGACY_STAGE_SQL = sa.text(
    """
    SELECT sales_stage, COUNT(*) AS record_count
    FROM sales_opportunities
    WHERE sales_stage IS NOT NULL AND sales_stage NOT IN :legacy_keys
    GROUP BY sales_stage
    ORDER BY sales_stage
    """
).bindparams(sa.bindparam("legacy_keys", expanding=True))


def assert_downgrade_is_safe(connection) -> None:
    """A downgrade re-adds the fixed list, so it must not strand a tenant's own stages."""

    rows = connection.execute(NON_LEGACY_STAGE_SQL, {"legacy_keys": list(LEGACY_STAGE_KEYS)}).fetchall()
    if rows:
        sample = ", ".join(f"{row.sales_stage!r} ({row.record_count})" for row in rows[:10])
        raise RuntimeError(
            f"Deals use stages outside the legacy list ({sample}); move them to a legacy stage "
            "before downgrading past 20260819_drop_stage_check."
        )


def upgrade() -> None:
    op.drop_constraint(CONSTRAINT_NAME, "sales_opportunities", type_="check")


def downgrade() -> None:
    assert_downgrade_is_safe(op.get_bind())
    keys = ", ".join(f"'{key}'" for key in LEGACY_STAGE_KEYS)
    op.create_check_constraint(
        CONSTRAINT_NAME,
        "sales_opportunities",
        f"sales_stage IS NULL OR sales_stage IN ({keys})",
    )
