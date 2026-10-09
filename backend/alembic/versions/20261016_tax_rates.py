"""Tax rates and groups; every document line computes its tax from a rate (13d §3.1)

Adds `finance_tax_rates` and `finance_tax_group_members`; sales and purchase default rates on
products and services; `tax_exempt` on accounts; a company default `tax_mode` and one per
sales document; `tax_rate_id` and `tax_manual` on the lines of quotes, orders, invoices,
credit notes, POs, bills and vendor credits; tax on PO lines and totals on POs.

Backfill, so that no issued total changes (13d decision 5):
- every existing line is `tax_manual`: its typed tax is kept as is;
- an invoice's header discount and header tax rate (from POS) are spread over its lines in
  proportion to their net amounts, the last line taking the remainder, and the header rate
  column is dropped. Credit notes, which carried the same header amounts pro rata, are
  spread the same way. Each invoice keeps its total;
- quotes, orders, invoices and credit notes get one definition of their totals: subtotal
  is the lines before discount, discount the lines' discounts (H16);
- stored invoice layouts lose the header `tax_rate` field.

Downgrade refuses once any rate exists or any line computes its tax.

Revision ID: 20261016_tax_rates
Revises: 20261015_vendor_documents
Create Date: 2026-10-09
"""

from __future__ import annotations

import json
from decimal import ROUND_HALF_UP, Decimal
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261016_tax_rates"
down_revision: Union[str, None] = "20261015_vendor_documents"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CENT = Decimal("0.01")

LINE_TABLES = (
    "sales_quote_items",
    "sales_order_items",
    "finance_pos_invoice_lines",
    "finance_credit_note_lines",
    "purchase_order_lines",
    "purchase_bill_lines",
    "purchase_vendor_credit_lines",
)
MODE_TABLES = ("sales_quotes", "sales_orders", "finance_pos_invoices", "finance_credit_notes")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(CENT, rounding=ROUND_HALF_UP)


def _spread(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    """`total` over `weights` in proportion, to the cent; the last share takes the remainder."""
    whole = sum(weights, Decimal(0))
    if not weights:
        return []
    if whole <= 0:
        return [Decimal(0)] * (len(weights) - 1) + [total]
    shares, left = [], total
    for index, weight in enumerate(weights):
        share = left if index == len(weights) - 1 else _money(total * weight / whole)
        shares.append(share)
        left -= share
    return shares


def _spread_header(bind, *, header_table: str, line_table: str, fk: str, header_discount_sql: str, header_tax_sql: str) -> None:
    """Move each document's header discount and header tax onto its lines and restate its
    subtotal and discount as the lines' (13d §3.1). Totals do not change."""
    headers = bind.execute(sa.text(
        f"SELECT id, {header_discount_sql} AS header_discount, {header_tax_sql} AS header_tax, total_amount FROM {header_table}"
    )).mappings().all()
    for header in headers:
        lines = bind.execute(sa.text(
            f"SELECT id, quantity, unit_price, discount_amount, tax_amount FROM {line_table} WHERE {fk} = :id ORDER BY sort_order, id"
        ), {"id": header["id"]}).mappings().all()
        if not lines:
            continue
        gross = [_money(Decimal(line["quantity"]) * Decimal(line["unit_price"])) for line in lines]
        nets = [gross[index] - _money(line["discount_amount"]) for index, line in enumerate(lines)]
        discounts = _spread(_money(header["header_discount"]), nets)
        taxes = _spread(_money(header["header_tax"]), [nets[index] - discounts[index] for index in range(len(lines))])
        subtotal = discount_total = tax_total = Decimal(0)
        for index, line in enumerate(lines):
            discount = _money(line["discount_amount"]) + discounts[index]
            tax = _money(line["tax_amount"]) + taxes[index]
            bind.execute(sa.text(
                f"UPDATE {line_table} SET discount_amount = :discount, tax_amount = :tax, line_total = :total WHERE id = :id"
            ), {"discount": discount, "tax": tax, "total": gross[index] - discount + tax, "id": line["id"]})
            subtotal += gross[index]
            discount_total += discount
            tax_total += tax
        bind.execute(sa.text(
            f"UPDATE {header_table} SET subtotal_amount = :subtotal, discount_amount = :discount, tax_amount = :tax WHERE id = :id"
        ), {"subtotal": subtotal, "discount": discount_total, "tax": tax_total, "id": header["id"]})


def upgrade() -> None:
    op.create_table(
        "finance_tax_rates",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False, server_default="rate"),
        sa.Column("rate", sa.Numeric(8, 4), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_default_sales", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_default_purchases", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('rate', 'group')", name="ck_finance_tax_rates_kind"),
        sa.CheckConstraint("rate >= 0 AND rate <= 100", name="ck_finance_tax_rates_rate_range"),
    )
    op.create_index("ix_finance_tax_rates_tenant_id", "finance_tax_rates", ["tenant_id"])
    op.create_index("uq_finance_tax_rates_tenant_name", "finance_tax_rates", ["tenant_id", "name"], unique=True)
    op.create_index("ix_finance_tax_rates_tenant_active", "finance_tax_rates", ["tenant_id", "is_active"])
    op.create_index("uq_finance_tax_rates_default_sales", "finance_tax_rates", ["tenant_id"], unique=True,
                    postgresql_where=sa.text("is_default_sales"))
    op.create_index("uq_finance_tax_rates_default_purchases", "finance_tax_rates", ["tenant_id"], unique=True,
                    postgresql_where=sa.text("is_default_purchases"))
    op.create_table(
        "finance_tax_group_members",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_id", sa.BigInteger(), sa.ForeignKey("finance_tax_rates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rate_id", sa.BigInteger(), sa.ForeignKey("finance_tax_rates.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_finance_tax_group_members_tenant_id", "finance_tax_group_members", ["tenant_id"])
    op.create_index("ix_finance_tax_group_members_group_id", "finance_tax_group_members", ["group_id"])
    op.create_index("ix_finance_tax_group_members_rate_id", "finance_tax_group_members", ["rate_id"])
    op.create_index("uq_finance_tax_group_members_pair", "finance_tax_group_members", ["group_id", "rate_id"], unique=True)

    for table in ("catalog_products", "catalog_services"):
        for column in ("tax_rate_id", "purchase_tax_rate_id"):
            op.add_column(table, sa.Column(column, sa.BigInteger(), nullable=True))
            op.create_foreign_key(f"fk_{table}_{column}", table, "finance_tax_rates", [column], ["id"], ondelete="SET NULL")
    op.add_column("sales_organizations", sa.Column("tax_exempt", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("sales_organizations", sa.Column("tax_exempt_reason", sa.Text(), nullable=True))
    op.add_column("company_profiles", sa.Column("default_tax_mode", sa.String(10), nullable=False, server_default="exclusive"))
    for table in MODE_TABLES:
        column_type = sa.Text() if table.startswith("sales_") else sa.String(10)
        op.add_column(table, sa.Column("tax_mode", column_type, nullable=False, server_default="exclusive"))
        op.create_check_constraint(f"ck_{table}_tax_mode", table, "tax_mode IN ('exclusive', 'inclusive')")
    for table in LINE_TABLES:
        op.add_column(table, sa.Column("tax_rate_id", sa.BigInteger(), nullable=True))
        op.create_foreign_key(f"fk_{table}_tax_rate", table, "finance_tax_rates", ["tax_rate_id"], ["id"], ondelete="RESTRICT")
        op.add_column(table, sa.Column("tax_manual", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("purchase_order_lines", sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.create_check_constraint("ck_purchase_order_line_tax_nonnegative", "purchase_order_lines", "tax_amount >= 0")
    op.add_column("purchase_orders", sa.Column("tax_total", sa.Numeric(18, 2), nullable=False, server_default="0"))
    op.add_column("purchase_orders", sa.Column("total", sa.Numeric(18, 2), nullable=False, server_default="0"))

    bind = op.get_bind()
    # Existing tax was typed: keep it (decision 5).
    for table in LINE_TABLES:
        bind.execute(sa.text(f"UPDATE {table} SET tax_manual = true"))
    bind.execute(sa.text("UPDATE purchase_orders SET total = subtotal"))
    # PO lines were net of discount with no tax; they stay so (line_total = net + 0).

    # Invoices: header discount and header-rate tax onto the lines; one definition of totals.
    _spread_header(
        bind, header_table="finance_pos_invoices", line_table="finance_pos_invoice_lines", fk="invoice_id",
        header_discount_sql="discount_amount",
        header_tax_sql="tax_amount - COALESCE((SELECT SUM(l.tax_amount) FROM finance_pos_invoice_lines l "
                       "WHERE l.invoice_id = finance_pos_invoices.id), 0)",
    )
    _spread_header(
        bind, header_table="finance_credit_notes", line_table="finance_credit_note_lines", fk="credit_note_id",
        header_discount_sql="discount_amount",
        header_tax_sql="tax_amount - COALESCE((SELECT SUM(l.tax_amount) FROM finance_credit_note_lines l "
                       "WHERE l.credit_note_id = finance_credit_notes.id), 0)",
    )
    op.drop_column("finance_pos_invoices", "tax_rate")

    # Stored invoice layouts lose the header tax rate field.
    rows = bind.execute(sa.text("SELECT id, sections FROM record_layout_definitions WHERE module_key = 'finance_pos'")).mappings().all()
    for row in rows:
        sections = row["sections"]
        if isinstance(sections, str):
            sections = json.loads(sections)
        changed = False
        for section in sections or []:
            fields = section.get("fields") or []
            kept = [field for field in fields if field.get("field_key") != "tax_rate"]
            if len(kept) != len(fields):
                section["fields"] = [{**field, "position": index} for index, field in enumerate(kept)]
                changed = True
        if changed:
            bind.execute(sa.text("UPDATE record_layout_definitions SET sections = :sections WHERE id = :id"),
                         {"sections": json.dumps(sections), "id": row["id"]})


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM finance_tax_rates LIMIT 1")).first():
        raise RuntimeError("Tax rates exist; remove them before downgrading 20261016_tax_rates")
    for table in LINE_TABLES:
        if bind.execute(sa.text(f"SELECT 1 FROM {table} WHERE tax_manual = false LIMIT 1")).first():
            raise RuntimeError(f"{table} has computed tax; it cannot be downgraded past 20261016_tax_rates")
    if bind.execute(sa.text("SELECT 1 FROM purchase_order_lines WHERE tax_amount <> 0 LIMIT 1")).first():
        raise RuntimeError("Purchase order lines carry tax; remove it before downgrading 20261016_tax_rates")
    if bind.execute(sa.text("SELECT 1 FROM sales_quotes WHERE tax_mode = 'inclusive' UNION ALL SELECT 1 FROM sales_orders "
                            "WHERE tax_mode = 'inclusive' UNION ALL SELECT 1 FROM finance_pos_invoices WHERE tax_mode = 'inclusive' LIMIT 1")).first():
        raise RuntimeError("Documents use tax-inclusive prices; they cannot be downgraded past 20261016_tax_rates")
    op.add_column("finance_pos_invoices", sa.Column("tax_rate", sa.Numeric(8, 4), nullable=False, server_default="0"))
    # The header discount was spread onto the lines and stays there; the header shows none.
    bind.execute(sa.text("UPDATE finance_pos_invoices SET discount_amount = 0, subtotal_amount = total_amount - tax_amount"))
    bind.execute(sa.text("UPDATE finance_credit_notes SET discount_amount = 0, subtotal_amount = total_amount - tax_amount"))
    op.drop_column("purchase_orders", "total")
    op.drop_column("purchase_orders", "tax_total")
    op.drop_constraint("ck_purchase_order_line_tax_nonnegative", "purchase_order_lines", type_="check")
    op.drop_column("purchase_order_lines", "tax_amount")
    for table in LINE_TABLES:
        op.drop_column(table, "tax_manual")
        op.drop_constraint(f"fk_{table}_tax_rate", table, type_="foreignkey")
        op.drop_column(table, "tax_rate_id")
    for table in MODE_TABLES:
        op.drop_constraint(f"ck_{table}_tax_mode", table, type_="check")
        op.drop_column(table, "tax_mode")
    op.drop_column("company_profiles", "default_tax_mode")
    op.drop_column("sales_organizations", "tax_exempt_reason")
    op.drop_column("sales_organizations", "tax_exempt")
    for table in ("catalog_products", "catalog_services"):
        for column in ("tax_rate_id", "purchase_tax_rate_id"):
            op.drop_constraint(f"fk_{table}_{column}", table, type_="foreignkey")
            op.drop_column(table, column)
    op.drop_table("finance_tax_group_members")
    op.drop_table("finance_tax_rates")
