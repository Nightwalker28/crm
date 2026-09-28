"""add configurable sales pipelines and seed each tenant's default

Revision ID: 20260817_sales_pipelines
Revises: 20260816_opp_participants
Create Date: 2026-09-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260817_sales_pipelines"
down_revision: Union[str, None] = "20260816_opp_participants"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PIPELINE_MODULE_KEY = "sales_opportunities"
PIPELINE_NAME = "Sales pipeline"

# Frozen copy of the legacy catalog in `app/modules/sales/opportunity_stages.py` as
# of this revision. A migration must seed what the check constraint allowed then,
# not whatever the catalog says later. Keys match `sales_opportunities.sales_stage`
# exactly, so every stored value resolves by key; probabilities are the weights the
# forecast report hardcoded.
SEED_STAGES = [
    ("lead", "Lead", 0, "open", "10"),
    ("qualified", "Qualified", 1, "ongoing", "25"),
    ("proposal", "Proposal", 2, "ongoing", "50"),
    ("negotiation", "Negotiation", 3, "ongoing", "75"),
    ("closed_won", "Closed won", 4, "won", "100"),
    ("closed_lost", "Closed lost", 5, "lost", "0"),
]

# Every tenant gets one default pipeline, including tenants with no opportunities
# yet, so the resolver never has to invent configuration for an existing tenant.
SEED_PIPELINES_SQL = sa.text(
    """
    INSERT INTO sales_pipelines (tenant_id, module_key, name, is_default, is_active, created_at, updated_at)
    SELECT t.id, :module_key, :name, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM tenants t
    WHERE NOT EXISTS (
        SELECT 1 FROM sales_pipelines p
        WHERE p.tenant_id = t.id AND p.module_key = :module_key AND p.is_default
    )
    ORDER BY t.id
    """
)

SEED_STAGE_SQL = sa.text(
    """
    INSERT INTO sales_pipeline_stages
        (tenant_id, pipeline_id, key, label, position, semantic_type, probability, is_active, created_at, updated_at)
    SELECT p.tenant_id, p.id, :key, :label, :position, :semantic_type,
           CAST(:probability AS NUMERIC(5, 2)), true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM sales_pipelines p
    WHERE p.module_key = :module_key AND p.is_default
      AND NOT EXISTS (
        SELECT 1 FROM sales_pipeline_stages s WHERE s.pipeline_id = p.id AND s.key = :key
      )
    ORDER BY p.id
    """
)

# The check constraint already limits `sales_stage` to the seeded keys; this makes
# the orphan check explicit rather than trusting that constraint was never bypassed.
ORPHAN_STAGE_SQL = sa.text(
    """
    SELECT o.sales_stage, COUNT(*) AS record_count
    FROM sales_opportunities o
    WHERE o.sales_stage IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM sales_pipelines p
        JOIN sales_pipeline_stages s ON s.pipeline_id = p.id
        WHERE p.tenant_id = o.tenant_id
          AND p.module_key = :module_key
          AND p.is_default
          AND s.key = o.sales_stage
      )
    GROUP BY o.sales_stage
    ORDER BY o.sales_stage
    """
)


def seed_default_pipelines(connection) -> None:
    connection.execute(SEED_PIPELINES_SQL, {"module_key": PIPELINE_MODULE_KEY, "name": PIPELINE_NAME})
    for key, label, position, semantic_type, probability in SEED_STAGES:
        connection.execute(
            SEED_STAGE_SQL,
            {
                "module_key": PIPELINE_MODULE_KEY,
                "key": key,
                "label": label,
                "position": position,
                "semantic_type": semantic_type,
                "probability": probability,
            },
        )


def assert_no_orphan_stage_values(connection) -> None:
    orphans = connection.execute(ORPHAN_STAGE_SQL, {"module_key": PIPELINE_MODULE_KEY}).fetchall()
    if not orphans:
        return
    sample = ", ".join(f"{row.sales_stage!r} ({row.record_count})" for row in orphans[:10])
    raise RuntimeError(
        f"{len(orphans)} stored opportunity stage value(s) have no stage in their tenant's "
        f"default pipeline: {sample}. Repair the data before upgrading."
    )


def upgrade() -> None:
    op.create_table(
        "sales_pipelines",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("module_key", sa.Text(), server_default=PIPELINE_MODULE_KEY, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_default", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("NOT is_default OR is_active", name="ck_sales_pipelines_default_active"),
        sa.CheckConstraint(f"module_key IN ('{PIPELINE_MODULE_KEY}')", name="ck_sales_pipelines_module"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "module_key", "name", name="uq_sales_pipelines_name"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sales_pipelines_id", "sales_pipelines", ["id"], unique=False)
    op.create_index("ix_sales_pipelines_tenant_id", "sales_pipelines", ["tenant_id"], unique=False)
    op.create_index(
        "uq_sales_pipelines_default",
        "sales_pipelines",
        ["tenant_id", "module_key"],
        unique=True,
        postgresql_where=sa.text("is_default"),
        sqlite_where=sa.text("is_default"),
    )

    op.create_table(
        "sales_pipeline_stages",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("pipeline_id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("semantic_type", sa.Text(), nullable=False),
        sa.Column("probability", sa.Numeric(5, 2), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "semantic_type IN ('open', 'ongoing', 'won', 'lost')",
            name="ck_sales_pipeline_stages_semantic",
        ),
        sa.CheckConstraint(
            "probability >= 0 AND probability <= 100",
            name="ck_sales_pipeline_stages_probability",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pipeline_id"], ["sales_pipelines.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("pipeline_id", "key", name="uq_sales_pipeline_stages_key"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sales_pipeline_stages_id", "sales_pipeline_stages", ["id"], unique=False)
    op.create_index("ix_sales_pipeline_stages_tenant_id", "sales_pipeline_stages", ["tenant_id"], unique=False)
    op.create_index("ix_sales_pipeline_stages_pipeline_id", "sales_pipeline_stages", ["pipeline_id"], unique=False)
    op.create_index(
        "ix_sales_pipeline_stages_pipeline_position",
        "sales_pipeline_stages",
        ["tenant_id", "pipeline_id", "position"],
        unique=False,
    )

    connection = op.get_bind()
    seed_default_pipelines(connection)
    assert_no_orphan_stage_values(connection)


def downgrade() -> None:
    # Nothing references these tables yet (Opportunity references arrive in
    # Phase 2), and `sales_opportunities.sales_stage` still holds every record's
    # stage, so dropping them loses only stage configuration edits.
    op.drop_index("ix_sales_pipeline_stages_pipeline_position", table_name="sales_pipeline_stages")
    op.drop_index("ix_sales_pipeline_stages_pipeline_id", table_name="sales_pipeline_stages")
    op.drop_index("ix_sales_pipeline_stages_tenant_id", table_name="sales_pipeline_stages")
    op.drop_index("ix_sales_pipeline_stages_id", table_name="sales_pipeline_stages")
    op.drop_table("sales_pipeline_stages")
    op.drop_index("uq_sales_pipelines_default", table_name="sales_pipelines")
    op.drop_index("ix_sales_pipelines_tenant_id", table_name="sales_pipelines")
    op.drop_index("ix_sales_pipelines_id", table_name="sales_pipelines")
    op.drop_table("sales_pipelines")
