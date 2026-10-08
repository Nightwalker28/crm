"""Vendor documents: RFQs, vendor returns and vendor credits (13c §3.6–3.8, D12)

- `purchase_orders`: the status `sent` (an RFQ sent to the vendor), `sent_at` / `sent_by`, and
  `rfq_group_id` tying alternatives asked of several vendors together.
- `purchase_vendor_returns` (+ lines): goods sent back against a posted receipt.
- `purchase_vendor_credits` (+ lines, + allocations to bills): what a vendor owes back.
- `finance_payment_allocations.vendor_credit_id`: a vendor's refund of a credit; the one-target
  check widens to four targets.

Existing rows need nothing: no PO is `sent` yet and the new tables start empty.

Revision ID: 20261015_vendor_documents
Revises: 20261014_po_lines
Create Date: 2026-10-08
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261015_vendor_documents"
down_revision: Union[str, None] = "20261014_po_lines"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PK = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
OLD_TARGETS = ("(CASE WHEN invoice_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN credit_note_id IS NULL THEN 0 ELSE 1 END)"
               " + (CASE WHEN bill_id IS NULL THEN 0 ELSE 1 END) = 1")
NEW_TARGETS = ("(CASE WHEN invoice_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN credit_note_id IS NULL THEN 0 ELSE 1 END)"
               " + (CASE WHEN bill_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN vendor_credit_id IS NULL THEN 0 ELSE 1 END) = 1")


def _stamps() -> list[sa.Column]:
    return [
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.drop_constraint("ck_purchase_order_status", "purchase_orders", type_="check")
    op.create_check_constraint("ck_purchase_order_status", "purchase_orders",
                               "status IN ('draft', 'sent', 'ordered', 'received', 'closed', 'cancelled')")
    op.add_column("purchase_orders", sa.Column("sent_at", sa.DateTime(timezone=True)))
    op.add_column("purchase_orders", sa.Column("sent_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")))
    op.add_column("purchase_orders", sa.Column("rfq_group_id", sa.BigInteger(), sa.ForeignKey("purchase_orders.id", ondelete="SET NULL")))
    op.create_index("ix_purchase_orders_tenant_rfq_group", "purchase_orders", ["tenant_id", "rfq_group_id"])

    op.create_table(
        "purchase_vendor_returns",
        sa.Column("id", PK, primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("vendor_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("order_id", sa.BigInteger(), sa.ForeignKey("purchase_orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("receipt_id", sa.BigInteger(), sa.ForeignKey("purchase_receipts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("warehouse_id", sa.BigInteger(), sa.ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("resolution", sa.String(20), nullable=False, server_default="credit"),
        sa.Column("reason", sa.String(120), nullable=False),
        sa.Column("notes", sa.Text()),
        sa.Column("shipped_at", sa.DateTime(timezone=True)),
        sa.Column("shipped_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("cancel_reason", sa.String(120)),
        sa.Column("owner_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        *_stamps(),
        sa.UniqueConstraint("tenant_id", "number", name="uq_purchase_vendor_return_number"),
        sa.CheckConstraint("status IN ('draft', 'shipped', 'cancelled')", name="ck_purchase_vendor_return_status"),
        sa.CheckConstraint("resolution IN ('credit', 'replace')", name="ck_purchase_vendor_return_resolution"),
    )
    op.create_index("ix_purchase_vendor_returns_tenant_status_id", "purchase_vendor_returns", ["tenant_id", "status", "id"])
    op.create_index("ix_purchase_vendor_returns_tenant_receipt", "purchase_vendor_returns", ["tenant_id", "receipt_id"])

    op.create_table(
        "purchase_vendor_return_lines",
        sa.Column("id", PK, primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("return_id", sa.BigInteger(), sa.ForeignKey("purchase_vendor_returns.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("receipt_line_id", sa.BigInteger(), sa.ForeignKey("purchase_receipt_lines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("order_line_id", sa.BigInteger(), sa.ForeignKey("purchase_order_lines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12, 4)),
        sa.UniqueConstraint("return_id", "receipt_line_id", name="uq_purchase_vendor_return_line_receipt_line"),
        sa.CheckConstraint("quantity > 0", name="ck_purchase_vendor_return_line_positive"),
    )
    op.create_index("ix_purchase_vendor_return_lines_tenant_receipt_line", "purchase_vendor_return_lines", ["tenant_id", "receipt_line_id"])

    op.create_table(
        "purchase_vendor_credits",
        sa.Column("id", PK, primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("number", sa.String(50)),
        sa.Column("vendor_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("bill_id", sa.BigInteger(), sa.ForeignKey("purchase_bills.id", ondelete="SET NULL")),
        sa.Column("vendor_return_id", sa.BigInteger(), sa.ForeignKey("purchase_vendor_returns.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("vendor_reference", sa.String(120)),
        sa.Column("credit_date", sa.Date()),
        sa.Column("currency", sa.String(10), nullable=False, server_default="USD"),
        sa.Column("exchange_rate", sa.Numeric(18, 8)),
        sa.Column("subtotal", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("tax_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("credit_remaining", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("reason", sa.String(500)),
        sa.Column("notes", sa.Text()),
        sa.Column("issued_at", sa.DateTime(timezone=True)),
        sa.Column("issued_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("voided_at", sa.DateTime(timezone=True)),
        sa.Column("void_reason", sa.String(500)),
        sa.Column("owner_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        *_stamps(),
        sa.CheckConstraint("status IN ('draft', 'issued', 'void')", name="ck_purchase_vendor_credit_status"),
    )
    op.create_index("ix_purchase_vendor_credits_tenant_status_id", "purchase_vendor_credits", ["tenant_id", "status", "id"])
    op.create_index("ix_purchase_vendor_credits_tenant_vendor", "purchase_vendor_credits", ["tenant_id", "vendor_id"])
    op.create_index("uq_purchase_vendor_credits_tenant_number", "purchase_vendor_credits", ["tenant_id", "number"], unique=True,
                    postgresql_where=sa.text("number IS NOT NULL"), sqlite_where=sa.text("number IS NOT NULL"))

    op.create_table(
        "purchase_vendor_credit_lines",
        sa.Column("id", PK, primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("credit_id", sa.BigInteger(), sa.ForeignKey("purchase_vendor_credits.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("bill_line_id", sa.BigInteger(), sa.ForeignKey("purchase_bill_lines.id", ondelete="RESTRICT")),
        sa.Column("vendor_return_line_id", sa.BigInteger(), sa.ForeignKey("purchase_vendor_return_lines.id", ondelete="SET NULL")),
        sa.Column("catalog_product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="SET NULL")),
        sa.Column("catalog_service_id", sa.BigInteger(), sa.ForeignKey("catalog_services.id", ondelete="SET NULL")),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("quantity > 0", name="ck_purchase_vendor_credit_line_positive"),
        sa.CheckConstraint("unit_cost >= 0", name="ck_purchase_vendor_credit_line_cost_nonnegative"),
        sa.CheckConstraint("tax_amount >= 0", name="ck_purchase_vendor_credit_line_tax_nonnegative"),
        sa.CheckConstraint("catalog_product_id IS NULL OR catalog_service_id IS NULL", name="ck_purchase_vendor_credit_line_one_catalog_link"),
    )
    op.create_index("ix_purchase_vendor_credit_lines_tenant_bill_line", "purchase_vendor_credit_lines", ["tenant_id", "bill_line_id"])

    op.create_table(
        "purchase_vendor_credit_allocations",
        sa.Column("id", PK, primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("credit_id", sa.BigInteger(), sa.ForeignKey("purchase_vendor_credits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bill_id", sa.BigInteger(), sa.ForeignKey("purchase_bills.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("amount > 0", name="ck_purchase_vendor_credit_allocations_positive"),
    )
    op.create_index("ix_purchase_vendor_credit_allocations_tenant_bill", "purchase_vendor_credit_allocations", ["tenant_id", "bill_id"])
    op.create_index("ix_purchase_vendor_credit_allocations_tenant_credit", "purchase_vendor_credit_allocations", ["tenant_id", "credit_id"])

    # A vendor credit that corrects a price revalues stock like a bill variance (13c §3.6).
    op.add_column("inventory_revaluations", sa.Column("vendor_credit_line_id", sa.BigInteger()))
    op.drop_constraint("ck_inventory_revaluation_kind", "inventory_revaluations", type_="check")
    op.create_check_constraint("ck_inventory_revaluation_kind", "inventory_revaluations",
                               "kind IN ('manual', 'bill_variance', 'vendor_credit', 'migration')")

    op.add_column("finance_payment_allocations", sa.Column(
        "vendor_credit_id", sa.BigInteger(), sa.ForeignKey("purchase_vendor_credits.id", ondelete="RESTRICT"), nullable=True))
    op.create_index("ix_finance_payment_allocations_tenant_vendor_credit", "finance_payment_allocations", ["tenant_id", "vendor_credit_id"])
    op.drop_constraint("ck_finance_payment_allocations_one_target", "finance_payment_allocations", type_="check")
    op.create_check_constraint("ck_finance_payment_allocations_one_target", "finance_payment_allocations", NEW_TARGETS)


def downgrade() -> None:
    bind = op.get_bind()
    for table in ("purchase_vendor_credits", "purchase_vendor_returns"):
        if bind.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first():
            raise RuntimeError(f"{table} has rows; remove them before downgrading 20261015_vendor_documents")
    if bind.execute(sa.text("SELECT 1 FROM purchase_orders WHERE status = 'sent' OR rfq_group_id IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("Purchase orders use RFQ statuses or groups; resolve them before downgrading 20261015_vendor_documents")
    op.drop_constraint("ck_finance_payment_allocations_one_target", "finance_payment_allocations", type_="check")
    op.create_check_constraint("ck_finance_payment_allocations_one_target", "finance_payment_allocations", OLD_TARGETS)
    op.drop_index("ix_finance_payment_allocations_tenant_vendor_credit", table_name="finance_payment_allocations")
    op.drop_column("finance_payment_allocations", "vendor_credit_id")
    op.drop_constraint("ck_inventory_revaluation_kind", "inventory_revaluations", type_="check")
    op.create_check_constraint("ck_inventory_revaluation_kind", "inventory_revaluations", "kind IN ('manual', 'bill_variance', 'migration')")
    op.drop_column("inventory_revaluations", "vendor_credit_line_id")
    op.drop_table("purchase_vendor_credit_allocations")
    op.drop_table("purchase_vendor_credit_lines")
    op.drop_table("purchase_vendor_credits")
    op.drop_table("purchase_vendor_return_lines")
    op.drop_table("purchase_vendor_returns")
    op.drop_index("ix_purchase_orders_tenant_rfq_group", table_name="purchase_orders")
    op.drop_column("purchase_orders", "rfq_group_id")
    op.drop_column("purchase_orders", "sent_by")
    op.drop_column("purchase_orders", "sent_at")
    op.drop_constraint("ck_purchase_order_status", "purchase_orders", type_="check")
    op.create_check_constraint("ck_purchase_order_status", "purchase_orders",
                               "status IN ('draft', 'ordered', 'received', 'closed', 'cancelled')")
