"""Add generic insertion order fields"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260413_io_generic_v1"
down_revision = "20260413_user_provisioning"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("finance_io", sa.Column("external_reference", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("customer_name", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("counterparty_reference", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("issue_date", sa.Date(), nullable=True))
    op.add_column("finance_io", sa.Column("effective_date", sa.Date(), nullable=True))
    op.add_column("finance_io", sa.Column("due_date", sa.Date(), nullable=True))
    op.add_column(
        "finance_io",
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
    )
    op.add_column(
        "finance_io",
        sa.Column("currency", sa.Text(), nullable=False, server_default="USD"),
    )
    op.add_column("finance_io", sa.Column("subtotal_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("finance_io", sa.Column("tax_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("finance_io", sa.Column("total_amount", sa.Numeric(12, 2), nullable=True))
    op.add_column("finance_io", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("legacy_payload", sa.Text(), nullable=True))
    op.add_column("finance_io", sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True))

    op.execute(
        """
        UPDATE finance_io
        SET
          external_reference = COALESCE(NULLIF(file_name, ''), external_reference),
          customer_name = COALESCE(NULLIF(client_name, ''), NULLIF(campaign_name, ''), file_name),
          counterparty_reference = COALESCE(NULLIF(campaign_name, ''), counterparty_reference),
          issue_date = COALESCE(start_date, issue_date),
          effective_date = COALESCE(start_date, effective_date),
          due_date = COALESCE(end_date, due_date),
          status = CASE
            WHEN campaign_name IS NOT NULL AND campaign_name <> '' THEN 'imported'
            ELSE COALESCE(status, 'draft')
          END,
          currency = COALESCE(NULLIF(currency, ''), 'USD'),
          total_amount = COALESCE(
            total_amount,
            NULLIF(regexp_replace(COALESCE(total_cost_of_project, ''), '[^0-9.\\-]', '', 'g'), '')::numeric
          ),
          notes = COALESCE(
            notes,
            CASE
              WHEN campaign_name IS NOT NULL AND campaign_name <> '' THEN 'Imported from the legacy insertion order workflow.'
              ELSE NULL
            END
          ),
          legacy_payload = COALESCE(
            legacy_payload,
            CAST(
              jsonb_strip_nulls(
                jsonb_build_object(
                  'client_name', client_name,
                  'campaign_name', campaign_name,
                  'campaign_type', campaign_type,
                  'total_leads', total_leads,
                  'seniority_split', seniority_split,
                  'cpl', cpl,
                  'total_cost_of_project', total_cost_of_project,
                  'target_persona', target_persona,
                  'domain_cap', domain_cap,
                  'target_geography', target_geography,
                  'delivery_format', delivery_format,
                  'account_manager', account_manager
                )
              ) AS text
            )
          )
        """
    )

    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_scope_active
        ON finance_io (module_id, user_id, deleted_at, updated_at DESC)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_finance_io_status_active
        ON finance_io (module_id, status, deleted_at)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_finance_io_status_active")
    op.execute("DROP INDEX IF EXISTS ix_finance_io_scope_active")
    op.drop_column("finance_io", "deleted_at")
    op.drop_column("finance_io", "legacy_payload")
    op.drop_column("finance_io", "notes")
    op.drop_column("finance_io", "total_amount")
    op.drop_column("finance_io", "tax_amount")
    op.drop_column("finance_io", "subtotal_amount")
    op.drop_column("finance_io", "currency")
    op.drop_column("finance_io", "status")
    op.drop_column("finance_io", "due_date")
    op.drop_column("finance_io", "effective_date")
    op.drop_column("finance_io", "issue_date")
    op.drop_column("finance_io", "counterparty_reference")
    op.drop_column("finance_io", "customer_name")
    op.drop_column("finance_io", "external_reference")
