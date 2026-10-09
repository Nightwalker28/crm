"""Receivables: recurring invoices, payment reminders, write-offs (13d §3.6)

- `finance_recurring_invoices`: a schedule and the invoice to make; invoices it issues name it
  (`finance_pos_invoices.recurring_invoice_id`).
- `finance_reminder_rules` (off until an admin turns one on, decision 12) and
  `finance_reminder_sends` (one per rule per invoice).
- `finance_write_offs`, cached on the invoice as `amount_written_off`.
- `sales_organizations.no_reminders`, `company_profiles.write_off_limit`.

Downgrade refuses while any write-off exists: dropping it would reopen a settled balance.

Revision ID: 20261020_receivables
Revises: 20261019_quote_lifecycle
Create Date: 2026-10-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261020_receivables"
down_revision: Union[str, None] = "20261019_quote_lifecycle"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "finance_recurring_invoices",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("customer_organization_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_contact_id", sa.BigInteger(), sa.ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True),
        sa.Column("customer_name", sa.Text(), nullable=False),
        sa.Column("customer_email", sa.Text(), nullable=True),
        sa.Column("currency", sa.String(10), nullable=False, server_default="USD"),
        sa.Column("tax_mode", sa.String(10), nullable=False, server_default="exclusive"),
        sa.Column("lines", sa.JSON(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("payment_terms", sa.Text(), nullable=True),
        sa.Column("frequency", sa.String(20), nullable=False, server_default="monthly"),
        sa.Column("interval_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("max_count", sa.Integer(), nullable=True),
        sa.Column("next_run_date", sa.Date(), nullable=True),
        sa.Column("issued_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("action", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_run_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')", name="ck_finance_recurring_invoices_frequency"),
        sa.CheckConstraint("interval_count >= 1 AND interval_count <= 52", name="ck_finance_recurring_invoices_interval"),
        sa.CheckConstraint("action IN ('draft', 'issue_and_send')", name="ck_finance_recurring_invoices_action"),
        sa.CheckConstraint("tax_mode IN ('exclusive', 'inclusive')", name="ck_finance_recurring_invoices_tax_mode"),
        sa.CheckConstraint("max_count IS NULL OR max_count >= 1", name="ck_finance_recurring_invoices_max_count"),
    )
    op.create_index("ix_finance_recurring_invoices_due", "finance_recurring_invoices", ["active", "next_run_date"],
                    postgresql_where=sa.text("deleted_at IS NULL"))
    op.create_index("ix_finance_recurring_invoices_tenant_id", "finance_recurring_invoices", ["tenant_id", "id"])

    op.add_column("finance_pos_invoices", sa.Column("recurring_invoice_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key("fk_finance_pos_invoices_recurring", "finance_pos_invoices", "finance_recurring_invoices",
                          ["recurring_invoice_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_finance_pos_invoices_recurring_invoice_id", "finance_pos_invoices", ["recurring_invoice_id"])
    op.add_column("finance_pos_invoices", sa.Column("amount_written_off", sa.Numeric(12, 2), nullable=False, server_default="0"))

    op.create_table(
        "finance_reminder_rules",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("days_offset", sa.Integer(), nullable=False),
        sa.Column("subject", sa.String(300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("attach_pdf", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("days_offset >= -60 AND days_offset <= 365", name="ck_finance_reminder_rules_offset"),
    )
    op.create_index("ix_finance_reminder_rules_tenant", "finance_reminder_rules", ["tenant_id", "days_offset"])

    op.create_table(
        "finance_reminder_sends",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("rule_id", sa.BigInteger(), sa.ForeignKey("finance_reminder_rules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", sa.BigInteger(), sa.ForeignKey("finance_pos_invoices.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient", sa.Text(), nullable=True),
        sa.Column("outcome", sa.String(20), nullable=False, server_default="sent"),
        sa.Column("detail", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("rule_id", "invoice_id", name="uq_finance_reminder_sends_rule_invoice"),
    )
    op.create_index("ix_finance_reminder_sends_tenant_invoice", "finance_reminder_sends", ["tenant_id", "invoice_id"])

    op.create_table(
        "finance_write_offs",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("invoice_id", sa.BigInteger(), sa.ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("amount > 0", name="ck_finance_write_offs_positive"),
    )
    op.create_index("ix_finance_write_offs_tenant_invoice", "finance_write_offs", ["tenant_id", "invoice_id"])

    op.add_column("sales_organizations", sa.Column("no_reminders", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("company_profiles", sa.Column("write_off_limit", sa.Numeric(12, 2), nullable=False, server_default="0"))


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM finance_write_offs LIMIT 1")).first():
        raise RuntimeError("Invoices have write-offs; they cannot be downgraded past 20261020_receivables")
    op.drop_column("company_profiles", "write_off_limit")
    op.drop_column("sales_organizations", "no_reminders")
    op.drop_index("ix_finance_write_offs_tenant_invoice", table_name="finance_write_offs")
    op.drop_table("finance_write_offs")
    op.drop_index("ix_finance_reminder_sends_tenant_invoice", table_name="finance_reminder_sends")
    op.drop_table("finance_reminder_sends")
    op.drop_index("ix_finance_reminder_rules_tenant", table_name="finance_reminder_rules")
    op.drop_table("finance_reminder_rules")
    op.drop_column("finance_pos_invoices", "amount_written_off")
    op.drop_index("ix_finance_pos_invoices_recurring_invoice_id", table_name="finance_pos_invoices")
    op.drop_constraint("fk_finance_pos_invoices_recurring", "finance_pos_invoices", type_="foreignkey")
    op.drop_column("finance_pos_invoices", "recurring_invoice_id")
    op.drop_index("ix_finance_recurring_invoices_tenant_id", table_name="finance_recurring_invoices")
    op.drop_index("ix_finance_recurring_invoices_due", table_name="finance_recurring_invoices")
    op.drop_table("finance_recurring_invoices")
