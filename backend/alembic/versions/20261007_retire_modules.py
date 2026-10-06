"""Retire insertion orders, contracts and support cases; one order model; invoices at /invoices

13-final-fixes.md §7 Step 5 (F1). Lynk has no production tenants yet, so retired modules go
outright: no archive, no alias, no delayed drop (owner, 2026-10-05).

- F1.2: insertion orders (`finance_io`) are removed. Contracts and support cases, on hold
  since 2026-08-20, are removed with them. Their tables, module rows (and so their
  permissions and tenant configs, which cascade), and every row other tables keep under their
  module keys or entity types go.
- F1.3 (13a C5, A3): a website or client-portal order is a sales order with a `source`.
  `website_integration_orders` and its lines are dropped, with `website_catalog_items`, a
  pre-E1 catalog nothing read any more. Website orders are now confirmed sales orders and
  portal orders draft ones, so an invoice no longer has a `website_order` source.
- F1.1: invoices live at `/dashboard/finance/invoices`.

Revision ID: 20261007_retire_modules
Revises: 20261006_sidebar_regroup
Create Date: 2026-10-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261007_retire_modules"
down_revision: Union[str, None] = "20261006_sidebar_regroup"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


RETIRED_MODULES = ("finance_io", "contracts", "support_cases")
RETIRED_ENTITY_TYPES = (
    "finance_io",
    "finance_insertion_order",
    "contract",
    "support_case",
    "website_order",
    "client_order",
)
RETIRED_TRIGGERS = (
    "invoice.overdue",
    "case.created",
    "case.status_changed",
    "contract.status_changed",
    "ticket.created",
    "ticket.status_changed",
    "ticket.priority_changed",
    "ticket.replied",
)
# Children first.
RETIRED_TABLES = (
    "website_integration_order_lines",
    "website_integration_orders",
    "website_catalog_items",
    "contract_signers",
    "contract_events",
    "contract_parties",
    "contracts",
    "support_case_comments",
    "support_case_events",
    "support_cases",
    "finance_io",
)


def _in(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    bind = op.get_bind()

    # Rows other tables keep for the retired modules.
    module_key_tables = bind.execute(
        sa.text(
            "SELECT table_name FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND column_name = 'module_key'"
        )
    ).scalars().all()
    for table in module_key_tables:
        bind.execute(sa.text(f'DELETE FROM "{table}" WHERE module_key IN ({_in(RETIRED_MODULES)})'))
    bind.execute(sa.text(f"DELETE FROM activity_logs WHERE entity_type IN ({_in(RETIRED_ENTITY_TYPES)})"))
    bind.execute(sa.text(f"DELETE FROM crm_events WHERE entity_type IN ({_in(RETIRED_ENTITY_TYPES)})"))
    bind.execute(
        sa.text(
            f"DELETE FROM automation_rules WHERE trigger_event IN ({_in(RETIRED_TRIGGERS)}) "
            "OR CAST(actions_json AS TEXT) LIKE '%assign_support_case%'"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE tasks SET source_module_key = NULL, source_entity_id = NULL, source_label = NULL "
            f"WHERE source_module_key IN ({_in(RETIRED_MODULES)})"
        )
    )
    bind.execute(
        sa.text(
            "DELETE FROM user_notifications WHERE link_url LIKE '/dashboard/finance/insertion-orders%' "
            "OR link_url LIKE '/dashboard/contracts%' OR link_url LIKE '/dashboard/support/%'"
        )
    )
    # Permissions, department/team access and tenant configs cascade from the module row.
    bind.execute(sa.text(f"DELETE FROM modules WHERE name IN ({_in(RETIRED_MODULES)})"))

    for table in RETIRED_TABLES:
        op.drop_table(table)

    # F1.1: invoices at /invoices.
    bind.execute(sa.text("UPDATE modules SET base_route = '/dashboard/finance/invoices' WHERE name = 'finance_pos'"))

    # F1.3: an invoice's source is manual, POS or a sales order.
    bind.execute(sa.text("UPDATE finance_pos_invoices SET source = 'manual' WHERE source = 'website_order'"))
    op.drop_constraint("ck_finance_pos_invoice_source", "finance_pos_invoices", type_="check")
    op.create_check_constraint(
        "ck_finance_pos_invoice_source",
        "finance_pos_invoices",
        "source IN ('manual', 'pos', 'sales_order')",
    )

    # F1.3: where a sales order came from.
    op.add_column("sales_orders", sa.Column("source", sa.Text(), nullable=False, server_default="crm"))
    op.add_column("sales_orders", sa.Column("channel", sa.Text(), nullable=True))
    op.add_column("sales_orders", sa.Column("external_reference", sa.Text(), nullable=True))
    op.add_column("sales_orders", sa.Column("request_hash", sa.Text(), nullable=True))
    op.add_column(
        "sales_orders",
        sa.Column(
            "integration_key_id",
            sa.BigInteger(),
            sa.ForeignKey("website_integration_api_keys.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "sales_orders",
        sa.Column("client_account_id", sa.BigInteger(), sa.ForeignKey("client_accounts.id", ondelete="SET NULL"), nullable=True),
    )
    op.create_check_constraint("ck_sales_orders_source", "sales_orders", "source IN ('crm', 'website', 'client_portal')")
    op.create_index("ix_sales_orders_source", "sales_orders", ["source"])
    op.create_index("ix_sales_orders_integration_key_id", "sales_orders", ["integration_key_id"])
    op.create_index("ix_sales_orders_client_account_id", "sales_orders", ["client_account_id"])
    op.create_index(
        "uq_sales_orders_tenant_external_reference",
        "sales_orders",
        ["tenant_id", "external_reference"],
        unique=True,
        postgresql_where=sa.text("external_reference IS NOT NULL"),
    )


def downgrade() -> None:
    raise NotImplementedError("The retired modules' tables are dropped for good; restore from a backup instead.")
