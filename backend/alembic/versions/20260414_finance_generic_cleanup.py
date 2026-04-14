"""remove legacy finance insertion order columns

Revision ID: 20260414_finance_generic_cleanup
Revises: 20260414_custom_fields
Create Date: 2026-04-14 18:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260414_finance_generic_cleanup"
down_revision = "20260414_custom_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_finance_io_search_trgm")
    op.execute("DROP INDEX IF EXISTS ix_finance_io_scope_campaign")

    op.drop_column("finance_io", "legacy_payload")
    op.drop_column("finance_io", "client_name")
    op.drop_column("finance_io", "campaign_name")
    op.drop_column("finance_io", "campaign_type")
    op.drop_column("finance_io", "total_leads")
    op.drop_column("finance_io", "seniority_split")
    op.drop_column("finance_io", "cpl")
    op.drop_column("finance_io", "total_cost_of_project")
    op.drop_column("finance_io", "target_persona")
    op.drop_column("finance_io", "domain_cap")
    op.drop_column("finance_io", "target_geography")
    op.drop_column("finance_io", "delivery_format")
    op.drop_column("finance_io", "account_manager")

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_search_trgm
        ON finance_io
        USING gin (
          lower(
            coalesce(io_number, '') || ' ' ||
            coalesce(customer_name, '') || ' ' ||
            coalesce(counterparty_reference, '') || ' ' ||
            coalesce(external_reference, '') || ' ' ||
            coalesce(status, '') || ' ' ||
            coalesce(currency, '') || ' ' ||
            coalesce(file_name, '') || ' ' ||
            coalesce(notes, '')
          ) gin_trgm_ops
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_finance_io_search_trgm")

    op.add_column("finance_io", sa.Column("account_manager", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("delivery_format", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("target_geography", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("domain_cap", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("target_persona", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("total_cost_of_project", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("cpl", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("seniority_split", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("total_leads", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("campaign_type", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("campaign_name", sa.Text(), nullable=False, server_default=""))
    op.add_column("finance_io", sa.Column("client_name", sa.Text(), nullable=False, server_default=""))
    op.add_column("finance_io", sa.Column("legacy_payload", sa.Text(), nullable=True))

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_scope_campaign
        ON finance_io (module_id, campaign_name)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_search_trgm
        ON finance_io
        USING gin (
          lower(
            coalesce(file_name, '') || ' ' ||
            coalesce(client_name, '') || ' ' ||
            coalesce(campaign_name, '') || ' ' ||
            coalesce(campaign_type, '') || ' ' ||
            coalesce(total_leads, '') || ' ' ||
            coalesce(seniority_split, '') || ' ' ||
            coalesce(cpl, '') || ' ' ||
            coalesce(total_cost_of_project, '') || ' ' ||
            coalesce(target_persona, '') || ' ' ||
            coalesce(domain_cap, '') || ' ' ||
            coalesce(target_geography, '') || ' ' ||
            coalesce(delivery_format, '') || ' ' ||
            coalesce(account_manager, '')
          ) gin_trgm_ops
        )
        """
    )
