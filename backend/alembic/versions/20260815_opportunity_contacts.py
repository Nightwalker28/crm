"""add the opportunity contact association compatibility model

Revision ID: 20260815_opp_contacts
Revises: 20260814_mail_send
Create Date: 2026-08-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260815_opp_contacts"
down_revision: Union[str, None] = "20260814_mail_send"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Every populated `sales_opportunities.contact_id` must resolve to a contact in the
# same tenant. The foreign key already guarantees the row exists; it does not
# guarantee the tenant matches, and a mismatched row must not be quietly skipped.
INVALID_REFERENCE_SQL = sa.text(
    """
    SELECT o.opportunity_id, o.tenant_id, o.contact_id, c.tenant_id AS contact_tenant_id
    FROM sales_opportunities o
    LEFT JOIN sales_contacts c ON c.contact_id = o.contact_id
    WHERE o.contact_id IS NOT NULL
      AND (c.contact_id IS NULL OR c.tenant_id <> o.tenant_id)
    ORDER BY o.opportunity_id
    """
)

# Soft-deleted opportunities and soft-deleted contacts are both carried over: the
# association mirrors the stored reference, and serialization decides what to show.
#
# `created_by_user_id` stays NULL. The deal's assignee is not evidence of who
# established this link, and inventing an actor would corrupt the relationship
# history the later phases audit. `role_key` is 'other' for the same reason: the
# legacy column records no role.
BACKFILL_SQL = sa.text(
    """
    INSERT INTO sales_opportunity_contacts
        (tenant_id, opportunity_id, contact_id, role_key, is_primary, created_at, created_by_user_id)
    SELECT o.tenant_id, o.opportunity_id, o.contact_id, 'other', true, o.created_time, NULL
    FROM sales_opportunities o
    WHERE o.contact_id IS NOT NULL
    """
)


def assert_contact_references_are_valid(connection) -> None:
    invalid = connection.execute(INVALID_REFERENCE_SQL).fetchall()
    if not invalid:
        return
    sample = ", ".join(
        f"opportunity {row.opportunity_id} (tenant {row.tenant_id}) -> contact {row.contact_id}"
        for row in invalid[:10]
    )
    raise RuntimeError(
        f"{len(invalid)} opportunity contact reference(s) are missing or cross-tenant "
        f"and cannot be backfilled: {sample}. Repair the data before upgrading."
    )


def upgrade() -> None:
    op.create_table(
        "sales_opportunity_contacts",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("opportunity_id", sa.BigInteger(), nullable=False),
        sa.Column("contact_id", sa.BigInteger(), nullable=False),
        sa.Column("role_key", sa.Text(), server_default="other", nullable=False),
        sa.Column("is_primary", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.CheckConstraint(
            "role_key IN ('decision_maker', 'champion', 'technical', 'finance', "
            "'procurement', 'legal', 'influencer', 'other')",
            name="ck_sales_opportunity_contacts_role",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["opportunity_id"], ["sales_opportunities.opportunity_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["contact_id"], ["sales_contacts.contact_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("opportunity_id", "contact_id", name="uq_sales_opportunity_contacts_link"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_sales_opportunity_contacts_id", "sales_opportunity_contacts", ["id"], unique=False)
    op.create_index(
        "ix_sales_opportunity_contacts_tenant_id", "sales_opportunity_contacts", ["tenant_id"], unique=False
    )
    op.create_index(
        "ix_sales_opportunity_contacts_opportunity_id",
        "sales_opportunity_contacts",
        ["opportunity_id"],
        unique=False,
    )
    op.create_index(
        "ix_sales_opportunity_contacts_contact_id",
        "sales_opportunity_contacts",
        ["contact_id"],
        unique=False,
    )
    op.create_index(
        "ix_sales_opportunity_contacts_created_by_user_id",
        "sales_opportunity_contacts",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_sales_opportunity_contacts_contact",
        "sales_opportunity_contacts",
        ["tenant_id", "contact_id", "opportunity_id"],
        unique=False,
    )
    # At most one primary per opportunity, so the legacy contact_id mirror cannot
    # end up with two rows claiming to be it.
    op.create_index(
        "uq_sales_opportunity_contacts_primary",
        "sales_opportunity_contacts",
        ["opportunity_id"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
        sqlite_where=sa.text("is_primary"),
    )

    connection = op.get_bind()
    assert_contact_references_are_valid(connection)
    connection.execute(BACKFILL_SQL)


def downgrade() -> None:
    # `sales_opportunities.contact_id` still holds every primary contact, so
    # dropping this table loses only non-primary participants — relationships that
    # had no representation before this revision.
    op.drop_index("uq_sales_opportunity_contacts_primary", table_name="sales_opportunity_contacts")
    op.drop_index("ix_sales_opportunity_contacts_contact", table_name="sales_opportunity_contacts")
    op.drop_index(
        "ix_sales_opportunity_contacts_created_by_user_id", table_name="sales_opportunity_contacts"
    )
    op.drop_index("ix_sales_opportunity_contacts_contact_id", table_name="sales_opportunity_contacts")
    op.drop_index("ix_sales_opportunity_contacts_opportunity_id", table_name="sales_opportunity_contacts")
    op.drop_index("ix_sales_opportunity_contacts_tenant_id", table_name="sales_opportunity_contacts")
    op.drop_index("ix_sales_opportunity_contacts_id", table_name="sales_opportunity_contacts")
    op.drop_table("sales_opportunity_contacts")
