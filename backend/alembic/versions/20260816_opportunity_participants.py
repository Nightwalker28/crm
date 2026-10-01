"""make opportunity contact associations recoverable

Revision ID: 20260816_opp_participants
Revises: 20260815_opp_contacts
Create Date: 2026-08-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260816_opp_participants"
down_revision: Union[str, None] = "20260815_opp_contacts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Purely additive and nullable: every existing association keeps its current
    # meaning, and NULL `deleted_at` is exactly "still a participant", so no
    # backfill is needed and the rollout has no compatibility window.
    #
    # The primary partial unique index from the previous revision
    # (`uq_sales_opportunity_contacts_primary`, WHERE is_primary) is intentionally
    # left alone. Not adding `deleted_at IS NULL` to it means the database keeps
    # refusing a second primary even against a removed row, which is the invariant
    # the service wants: removing the primary participant is refused outright, so a
    # removed row must never be carrying the flag.
    op.add_column(
        "sales_opportunity_contacts",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "sales_opportunity_contacts",
        sa.Column("deleted_by_user_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_sales_opportunity_contacts_deleted_by",
        "sales_opportunity_contacts",
        "users",
        ["deleted_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    # Participant lists and the removed-participant list both filter on it.
    op.create_index(
        "ix_sales_opportunity_contacts_deleted_at",
        "sales_opportunity_contacts",
        ["deleted_at"],
        unique=False,
    )


def downgrade() -> None:
    # Dropping these columns turns every removed participant back into an active
    # one rather than deleting rows, so no relationship is lost — but a removal
    # performed while this revision was applied is silently undone. Purge removed
    # associations deliberately before downgrading if that matters.
    op.drop_index("ix_sales_opportunity_contacts_deleted_at", table_name="sales_opportunity_contacts")
    op.drop_constraint(
        "fk_sales_opportunity_contacts_deleted_by",
        "sales_opportunity_contacts",
        type_="foreignkey",
    )
    op.drop_column("sales_opportunity_contacts", "deleted_by_user_id")
    op.drop_column("sales_opportunity_contacts", "deleted_at")
