"""add sales lead scores

Revision ID: 20260614_lead_scores
Revises: 20260613_dashboard_layouts
Create Date: 2026-05-27
"""

from datetime import datetime, timedelta, timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260614_lead_scores"
down_revision: Union[str, None] = "20260613_dashboard_layouts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _coerce_optional(value) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _score_grade(score: int) -> str:
    if score >= 50:
        return "hot"
    if score >= 25:
        return "warm"
    return "cold"


def _calculate_score(row, now: datetime) -> tuple[int, str, list[dict]]:
    status = (row.status or "new").lower()
    if status in {"unqualified", "converted"}:
        return 0, "cold", [
            {
                "key": "inactive_status",
                "label": "Inactive status",
                "points": 0,
                "reason": "Converted and unqualified leads do not rank as active hot leads.",
            }
        ]

    factors: list[dict] = []
    score = 0

    def add_factor(key: str, label: str, points: int, reason: str, present: bool) -> None:
        nonlocal score
        if not present:
            return
        score += points
        factors.append({"key": key, "label": label, "points": points, "reason": reason})

    add_factor("has_email", "Has email", 10, "Lead has a reachable email address.", bool(_coerce_optional(row.primary_email)))
    add_factor("has_phone", "Has phone", 10, "Lead has a phone number for direct follow-up.", bool(_coerce_optional(row.phone)))
    add_factor("has_company", "Has company", 10, "Lead is attached to a company or account name.", bool(_coerce_optional(row.company)))
    add_factor("has_source", "Has source", 10, "Lead includes source attribution.", bool(_coerce_optional(row.source)))
    add_factor("contacted", "Contacted", 10, "Lead has already been contacted.", status in {"contacted", "qualified"})
    add_factor("qualified", "Qualified", 20, "Lead has been qualified by sales.", status == "qualified")

    if row.last_contacted_at:
        contacted_at = row.last_contacted_at
        if contacted_at.tzinfo is None:
            contacted_at = contacted_at.replace(tzinfo=timezone.utc)
        add_factor("recent_follow_up", "Recent follow-up", 10, "Lead has follow-up activity in the last 30 days.", contacted_at >= now - timedelta(days=30))

    normalized = max(0, min(score, 100))
    return normalized, _score_grade(normalized), factors


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "sales_lead_scores"):
        op.create_table(
            "sales_lead_scores",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("lead_id", sa.BigInteger(), nullable=False),
            sa.Column("score", sa.BigInteger(), server_default="0", nullable=False),
            sa.Column("grade", sa.Text(), server_default="cold", nullable=False),
            sa.Column("factors_json", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
            sa.Column("calculated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint("score >= 0 AND score <= 100", name="ck_sales_lead_scores_score_range"),
            sa.CheckConstraint("grade IN ('hot', 'warm', 'cold')", name="ck_sales_lead_scores_grade"),
            sa.ForeignKeyConstraint(["lead_id"], ["sales_leads.lead_id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("lead_id", name="uq_sales_lead_scores_lead_id"),
        )
    if not _index_exists(bind, "sales_lead_scores", "ix_sales_lead_scores_id"):
        op.create_index("ix_sales_lead_scores_id", "sales_lead_scores", ["id"], unique=False)
    if not _index_exists(bind, "sales_lead_scores", "ix_sales_lead_scores_tenant_id"):
        op.create_index("ix_sales_lead_scores_tenant_id", "sales_lead_scores", ["tenant_id"], unique=False)
    if not _index_exists(bind, "sales_lead_scores", "ix_sales_lead_scores_lead_id"):
        op.create_index("ix_sales_lead_scores_lead_id", "sales_lead_scores", ["lead_id"], unique=False)
    if not _index_exists(bind, "sales_lead_scores", "ix_sales_lead_scores_tenant_score"):
        op.create_index("ix_sales_lead_scores_tenant_score", "sales_lead_scores", ["tenant_id", "score"], unique=False)
    if not _index_exists(bind, "sales_lead_scores", "ix_sales_lead_scores_tenant_grade"):
        op.create_index("ix_sales_lead_scores_tenant_grade", "sales_lead_scores", ["tenant_id", "grade"], unique=False)

    leads = sa.table(
        "sales_leads",
        sa.column("lead_id"),
        sa.column("tenant_id"),
        sa.column("primary_email"),
        sa.column("phone"),
        sa.column("company"),
        sa.column("source"),
        sa.column("status"),
        sa.column("last_contacted_at"),
    )
    scores = sa.table(
        "sales_lead_scores",
        sa.column("tenant_id"),
        sa.column("lead_id"),
        sa.column("score"),
        sa.column("grade"),
        sa.column("factors_json"),
        sa.column("calculated_at"),
    )
    now = datetime.now(timezone.utc)
    rows = []
    for row in bind.execute(sa.select(leads)).all():
        score, grade, factors = _calculate_score(row, now)
        rows.append(
            {
                "tenant_id": row.tenant_id,
                "lead_id": row.lead_id,
                "score": score,
                "grade": grade,
                "factors_json": factors,
                "calculated_at": now,
            }
        )
    if rows:
        bind.execute(scores.insert(), rows)


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "sales_lead_scores"):
        for index_name in (
            "ix_sales_lead_scores_tenant_grade",
            "ix_sales_lead_scores_tenant_score",
            "ix_sales_lead_scores_lead_id",
            "ix_sales_lead_scores_tenant_id",
            "ix_sales_lead_scores_id",
        ):
            if _index_exists(bind, "sales_lead_scores", index_name):
                op.drop_index(index_name, table_name="sales_lead_scores")
        op.drop_table("sales_lead_scores")
