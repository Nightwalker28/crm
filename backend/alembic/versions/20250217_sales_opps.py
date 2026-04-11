"""Add sales opportunities table"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20250217_sales_opps"
down_revision = "20241209_dept_mod_perms"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sales_opportunities",
        sa.Column("opportunity_id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("opportunity_name", sa.Text(), nullable=False),
        sa.Column("client", sa.Text(), nullable=False),
        sa.Column("sales_stage", sa.Text(), nullable=True),
        sa.Column("contact_id", sa.BigInteger(), nullable=True),
        sa.Column("organization_id", sa.BigInteger(), nullable=True),
        sa.Column("assigned_to", sa.BigInteger(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("expected_close_date", sa.Date(), nullable=True),
        sa.Column("campaign_type", sa.Text(), nullable=True),
        sa.Column("total_leads", sa.Text(), nullable=True),
        sa.Column("cpl", sa.Text(), nullable=True),
        sa.Column("total_cost_of_project", sa.Text(), nullable=True),
        sa.Column("currency_type", sa.Text(), nullable=True),
        sa.Column("target_geography", sa.Text(), nullable=True),
        sa.Column("target_audience", sa.Text(), nullable=True),
        sa.Column("domain_cap", sa.Text(), nullable=True),
        sa.Column("tactics", sa.Text(), nullable=True),
        sa.Column("delivery_format", sa.Text(), nullable=True),
        sa.Column("attachments", sa.Text(), nullable=True),
        sa.Column("created_time", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["contact_id"], ["sales_contacts.contact_id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["sales_organizations.org_id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_to"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("opportunity_id"),
    )
    op.create_index(
        op.f("ix_sales_opportunities_opportunity_id"),
        "sales_opportunities",
        ["opportunity_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_sales_opportunities_opportunity_id"),
        table_name="sales_opportunities",
    )
    op.drop_table("sales_opportunities")
