"""Optimize Postgres search and hot query indexes"""

from alembic import op


# revision identifiers, used by Alembic.
revision = "20260411_pg_search"
down_revision = "20260411_add_auth_token_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_users_search_trgm
        ON users
        USING gin (
          lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || coalesce(email, '')) gin_trgm_ops
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_users_team_role_status
        ON users (team_id, role_id, is_active)
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_sales_contacts_search_trgm
        ON sales_contacts
        USING gin (
          lower(
            coalesce(first_name, '') || ' ' ||
            coalesce(last_name, '') || ' ' ||
            coalesce(contact_telephone, '') || ' ' ||
            coalesce(primary_email, '') || ' ' ||
            coalesce(current_title, '') || ' ' ||
            coalesce(region, '') || ' ' ||
            coalesce(country, '') || ' ' ||
            coalesce(linkedin_url, '')
          ) gin_trgm_ops
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_sales_contacts_created_time
        ON sales_contacts (created_time DESC)
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_sales_organizations_search_trgm
        ON sales_organizations
        USING gin (
          lower(
            coalesce(org_name, '') || ' ' ||
            coalesce(website, '') || ' ' ||
            coalesce(primary_email, '') || ' ' ||
            coalesce(industry, '') || ' ' ||
            coalesce(billing_city, '') || ' ' ||
            coalesce(billing_country, '')
          ) gin_trgm_ops
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_sales_organizations_created_time
        ON sales_organizations (created_time DESC)
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_sales_opportunities_search_trgm
        ON sales_opportunities
        USING gin (
          lower(
            coalesce(opportunity_name, '') || ' ' ||
            coalesce(client, '') || ' ' ||
            coalesce(sales_stage, '') || ' ' ||
            coalesce(campaign_type, '') || ' ' ||
            coalesce(target_geography, '') || ' ' ||
            coalesce(target_audience, '') || ' ' ||
            coalesce(tactics, '')
          ) gin_trgm_ops
        )
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_sales_opportunities_created_time
        ON sales_opportunities (created_time DESC)
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_scope_updated
        ON finance_io (module_id, user_id, updated_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_scope_campaign
        ON finance_io (module_id, campaign_name)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_dates
        ON finance_io (start_date, end_date)
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


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_finance_io_search_trgm")
    op.execute("DROP INDEX IF EXISTS ix_finance_io_dates")
    op.execute("DROP INDEX IF EXISTS ix_finance_io_scope_campaign")
    op.execute("DROP INDEX IF EXISTS ix_finance_io_scope_updated")
    op.execute("DROP INDEX IF EXISTS ix_sales_opportunities_created_time")
    op.execute("DROP INDEX IF EXISTS ix_sales_opportunities_search_trgm")
    op.execute("DROP INDEX IF EXISTS ix_sales_organizations_created_time")
    op.execute("DROP INDEX IF EXISTS ix_sales_organizations_search_trgm")
    op.execute("DROP INDEX IF EXISTS ix_sales_contacts_created_time")
    op.execute("DROP INDEX IF EXISTS ix_sales_contacts_search_trgm")
    op.execute("DROP INDEX IF EXISTS ix_users_team_role_status")
    op.execute("DROP INDEX IF EXISTS ix_users_search_trgm")
