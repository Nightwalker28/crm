"""reference pipeline and stage rows from opportunities and backfill them

Revision ID: 20260818_opp_stage_refs
Revises: 20260817_sales_pipelines
Create Date: 2026-09-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260818_opp_stage_refs"
down_revision: Union[str, None] = "20260817_sales_pipelines"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PIPELINE_MODULE_KEY = "sales_opportunities"

# Every deal, soft-deleted ones included (they can be restored), joins its tenant's
# default pipeline. The previous revision seeded one for every tenant.
BACKFILL_PIPELINE_SQL = sa.text(
    """
    UPDATE sales_opportunities
    SET pipeline_id = (
        SELECT p.id FROM sales_pipelines p
        WHERE p.tenant_id = sales_opportunities.tenant_id
          AND p.module_key = :module_key
          AND p.is_default
    )
    WHERE pipeline_id IS NULL
    """
)

# Resolution is by stable key, exactly as the service resolves it. A NULL
# `sales_stage` stays unstaged rather than being assigned a guessed stage.
BACKFILL_STAGE_SQL = sa.text(
    """
    UPDATE sales_opportunities
    SET pipeline_stage_id = (
        SELECT s.id FROM sales_pipeline_stages s
        WHERE s.pipeline_id = sales_opportunities.pipeline_id
          AND s.key = sales_opportunities.sales_stage
    )
    WHERE sales_stage IS NOT NULL AND pipeline_stage_id IS NULL
    """
)

UNRESOLVED_SQL = sa.text(
    """
    SELECT opportunity_id, tenant_id, sales_stage, pipeline_id, pipeline_stage_id
    FROM sales_opportunities
    WHERE pipeline_id IS NULL
       OR (sales_stage IS NOT NULL AND pipeline_stage_id IS NULL)
    ORDER BY opportunity_id
    """
)


def backfill_stage_references(connection) -> None:
    connection.execute(BACKFILL_PIPELINE_SQL, {"module_key": PIPELINE_MODULE_KEY})
    connection.execute(BACKFILL_STAGE_SQL)


def assert_every_opportunity_resolved(connection) -> None:
    unresolved = connection.execute(UNRESOLVED_SQL).fetchall()
    if not unresolved:
        return
    sample = ", ".join(
        f"opportunity {row.opportunity_id} (tenant {row.tenant_id}, stage {row.sales_stage!r})"
        for row in unresolved[:10]
    )
    raise RuntimeError(
        f"{len(unresolved)} opportunit(ies) could not be matched to a pipeline stage: {sample}. "
        "Repair the data before upgrading."
    )


def upgrade() -> None:
    op.add_column("sales_opportunities", sa.Column("pipeline_id", sa.BigInteger(), nullable=True))
    op.add_column("sales_opportunities", sa.Column("pipeline_stage_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "sales_opportunities_pipeline_id_fkey",
        "sales_opportunities",
        "sales_pipelines",
        ["pipeline_id"],
        ["id"],
    )
    op.create_foreign_key(
        "sales_opportunities_pipeline_stage_id_fkey",
        "sales_opportunities",
        "sales_pipeline_stages",
        ["pipeline_stage_id"],
        ["id"],
    )
    op.create_index("ix_sales_opportunities_pipeline_id", "sales_opportunities", ["pipeline_id"], unique=False)
    op.create_index(
        "ix_sales_opportunities_tenant_pipeline_stage_active",
        "sales_opportunities",
        ["tenant_id", "pipeline_stage_id"],
        unique=False,
        postgresql_where=sa.text("deleted_at IS NULL"),
    )

    connection = op.get_bind()
    backfill_stage_references(connection)
    assert_every_opportunity_resolved(connection)


def downgrade() -> None:
    # `sales_stage` still holds every deal's stage key, so dropping the references
    # loses nothing that the previous revision could represent.
    op.drop_index("ix_sales_opportunities_tenant_pipeline_stage_active", table_name="sales_opportunities")
    op.drop_index("ix_sales_opportunities_pipeline_id", table_name="sales_opportunities")
    op.drop_constraint("sales_opportunities_pipeline_stage_id_fkey", "sales_opportunities", type_="foreignkey")
    op.drop_constraint("sales_opportunities_pipeline_id_fkey", "sales_opportunities", type_="foreignkey")
    op.drop_column("sales_opportunities", "pipeline_stage_id")
    op.drop_column("sales_opportunities", "pipeline_id")
