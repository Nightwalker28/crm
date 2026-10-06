"""E5: invoices become documents; payments, credit notes and vendor bills.

Plan: docs/crm-evolution/12c-erp-invoicing.md. Existing invoices keep their numbers; a
`paid` status becomes `issued` (payment status says paid); an invoice marked `refunded`
becomes void; every invoice with money against it gets one migrated payment for that amount.

Revision ID: 20260904_invoicing
Revises: 20260903_purchasing
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260904_invoicing"
down_revision: Union[str, None] = "20260903_purchasing"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _id_column():
    return sa.Column("id", sa.BigInteger(), primary_key=True)


def _tenant_column():
    return sa.Column("tenant_id", sa.BigInteger(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _add_preset(bind, module_key: str, name: str, conditions: list[dict]) -> None:
    """Users who already have views for a module get a new preset once (as E3 and E4 did)."""
    columns_by_user: dict[int, list] = {}
    for view in bind.execute(sa.text("SELECT user_id, config FROM user_saved_views WHERE module_key = :module_key"), {"module_key": module_key}).fetchall():
        config = view.config if isinstance(view.config, dict) else json.loads(view.config or "{}")
        meta = config.get("_meta") if isinstance(config.get("_meta"), dict) else {}
        if meta.get("system_default") or view.user_id not in columns_by_user:
            columns_by_user[view.user_id] = config.get("visible_columns") if isinstance(config.get("visible_columns"), list) else []
    slug = name.lower().replace(" ", "-")
    for user_id, columns in columns_by_user.items():
        config = {"visible_columns": columns, "sort": None, "display": None, "filters": {"search": "", "logic": "all", "conditions": [], "any_conditions": [],
            "all_conditions": [{"id": f"{slug}-{index}", "values": None, **condition} for index, condition in enumerate(conditions)]}}
        bind.execute(sa.text("INSERT INTO user_saved_views (user_id, module_key, name, config, is_default) VALUES (:user_id, :module_key, :name, CAST(:config AS JSON), 0)"),
            {"user_id": user_id, "module_key": module_key, "name": name, "config": json.dumps(config)})


def upgrade() -> None:
    bind = op.get_bind()

    # Settings and Account terms -------------------------------------------------------------
    op.add_column("company_profiles", sa.Column("invoicing_policy", sa.String(20), nullable=False, server_default="delivered"))
    op.add_column("company_profiles", sa.Column("default_payment_terms_days", sa.Integer(), nullable=True))
    op.add_column("sales_organizations", sa.Column("payment_terms_days", sa.Integer(), nullable=True))

    # Invoices ---------------------------------------------------------------------------------
    op.drop_constraint("ck_finance_pos_invoice_status", "finance_pos_invoices", type_="check")
    op.drop_constraint("ck_finance_pos_invoice_payment_status", "finance_pos_invoices", type_="check")
    op.alter_column("finance_pos_invoices", "invoice_number", existing_type=sa.Text(), nullable=True)
    op.add_column("finance_pos_invoices", sa.Column("source", sa.String(20), nullable=False, server_default="manual"))
    op.add_column("finance_pos_invoices", sa.Column("sales_order_id", sa.Integer(), sa.ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True))
    op.add_column("finance_pos_invoices", sa.Column("amount_credited", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("finance_pos_invoices", sa.Column("balance_due", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("finance_pos_invoices", sa.Column("issued_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("finance_pos_invoices", sa.Column("issued_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True))
    op.add_column("finance_pos_invoices", sa.Column("voided_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("finance_pos_invoices", sa.Column("void_reason", sa.String(500), nullable=True))
    op.create_index("ix_finance_pos_invoices_tenant_order", "finance_pos_invoices", ["tenant_id", "sales_order_id"])

    op.execute("UPDATE finance_pos_invoices SET source = 'website_order' WHERE id IN (SELECT pos_invoice_id FROM website_integration_orders WHERE pos_invoice_id IS NOT NULL)")
    op.execute("UPDATE finance_pos_invoices SET status = 'void', voided_at = COALESCE(updated_at, now()), void_reason = 'Marked refunded before invoices became documents' WHERE payment_status = 'refunded'")
    op.execute("UPDATE finance_pos_invoices SET status = 'issued' WHERE status = 'paid'")
    op.execute("UPDATE finance_pos_invoices SET issued_at = COALESCE(created_at, now()), issued_by = user_id WHERE status IN ('issued', 'void')")

    op.add_column("finance_pos_invoice_lines", sa.Column("sales_order_item_id", sa.Integer(), sa.ForeignKey("sales_order_items.id", ondelete="SET NULL"), nullable=True))
    op.add_column("finance_pos_invoice_lines", sa.Column("delivery_line_id", sa.BigInteger(), sa.ForeignKey("inventory_delivery_lines.id", ondelete="SET NULL"), nullable=True))
    op.add_column("finance_pos_invoice_lines", sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.add_column("finance_pos_invoice_lines", sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"))
    op.create_check_constraint("ck_finance_pos_invoice_lines_discount_nonnegative", "finance_pos_invoice_lines", "discount_amount >= 0")
    op.create_check_constraint("ck_finance_pos_invoice_lines_tax_nonnegative", "finance_pos_invoice_lines", "tax_amount >= 0")
    op.create_index("ix_finance_pos_invoice_lines_order_item", "finance_pos_invoice_lines", ["sales_order_item_id"])

    # Credit notes -----------------------------------------------------------------------------
    op.create_table(
        "finance_credit_notes",
        _id_column(), _tenant_column(),
        sa.Column("number", sa.String(50)),
        sa.Column("invoice_id", sa.BigInteger(), sa.ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("return_id", sa.BigInteger(), sa.ForeignKey("inventory_returns.id", ondelete="SET NULL")),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("reason", sa.String(500)),
        sa.Column("issue_date", sa.Date()),
        sa.Column("currency", sa.String(10), nullable=False, server_default="USD"),
        sa.Column("subtotal_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("refund_due", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()),
        sa.Column("issued_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("issued_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("voided_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("void_reason", sa.String(500)),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("deleted_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('draft', 'issued', 'void')", name="ck_finance_credit_note_status"),
    )
    op.create_index("ix_finance_credit_notes_tenant_id", "finance_credit_notes", ["tenant_id"])
    op.create_index("ix_finance_credit_notes_tenant_status_id", "finance_credit_notes", ["tenant_id", "status", "id"])
    op.create_index("ix_finance_credit_notes_tenant_invoice", "finance_credit_notes", ["tenant_id", "invoice_id"])
    op.create_index("uq_finance_credit_notes_tenant_number", "finance_credit_notes", ["tenant_id", "number"], unique=True,
                    postgresql_where=sa.text("number IS NOT NULL"))

    op.create_table(
        "finance_credit_note_lines",
        _id_column(), _tenant_column(),
        sa.Column("credit_note_id", sa.BigInteger(), sa.ForeignKey("finance_credit_notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_line_id", sa.BigInteger(), sa.ForeignKey("finance_pos_invoice_lines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("return_line_id", sa.BigInteger(), sa.ForeignKey("inventory_return_lines.id", ondelete="SET NULL")),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("discount_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("quantity > 0", name="ck_finance_credit_note_lines_quantity_positive"),
        sa.CheckConstraint("unit_price >= 0", name="ck_finance_credit_note_lines_price_nonnegative"),
        sa.CheckConstraint("discount_amount >= 0", name="ck_finance_credit_note_lines_discount_nonnegative"),
        sa.CheckConstraint("tax_amount >= 0", name="ck_finance_credit_note_lines_tax_nonnegative"),
    )
    op.create_index("ix_finance_credit_note_lines_tenant_id", "finance_credit_note_lines", ["tenant_id"])
    op.create_index("ix_finance_credit_note_lines_credit_note_id", "finance_credit_note_lines", ["credit_note_id"])
    op.create_index("ix_finance_credit_note_lines_invoice_line", "finance_credit_note_lines", ["invoice_line_id"])

    op.create_table(
        "finance_credit_allocations",
        _id_column(), _tenant_column(),
        sa.Column("credit_note_id", sa.BigInteger(), sa.ForeignKey("finance_credit_notes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", sa.BigInteger(), sa.ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("amount > 0", name="ck_finance_credit_allocations_positive"),
    )
    op.create_index("ix_finance_credit_allocations_tenant_id", "finance_credit_allocations", ["tenant_id"])
    op.create_index("ix_finance_credit_allocations_tenant_invoice", "finance_credit_allocations", ["tenant_id", "invoice_id"])
    op.create_index("ix_finance_credit_allocations_tenant_credit_note", "finance_credit_allocations", ["tenant_id", "credit_note_id"])

    # Vendor bills -----------------------------------------------------------------------------
    op.add_column("purchase_orders", sa.Column("bill_status", sa.String(20), nullable=False, server_default="none"))
    op.create_check_constraint("ck_purchase_order_bill_status", "purchase_orders", "bill_status IN ('none', 'to_bill', 'partial', 'billed')")
    op.execute("UPDATE purchase_orders SET bill_status = 'to_bill' WHERE id IN (SELECT order_id FROM purchase_receipts WHERE status = 'posted')")

    op.create_table(
        "purchase_bills",
        _id_column(), _tenant_column(),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("vendor_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="RESTRICT"), nullable=False),
        sa.Column("order_id", sa.BigInteger(), sa.ForeignKey("purchase_orders.id", ondelete="RESTRICT")),
        sa.Column("receipt_id", sa.BigInteger(), sa.ForeignKey("purchase_receipts.id", ondelete="SET NULL")),
        sa.Column("vendor_invoice_number", sa.String(120), nullable=False),
        sa.Column("bill_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date()),
        sa.Column("currency", sa.String(10), nullable=False, server_default="USD"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("payment_status", sa.String(20), nullable=False, server_default="unpaid"),
        sa.Column("match_status", sa.String(20), nullable=False, server_default="none"),
        sa.Column("subtotal", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("tax_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("amount_paid", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("balance_due", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("notes", sa.Text()),
        sa.Column("posted_at", sa.DateTime(timezone=True)),
        sa.Column("posted_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("voided_at", sa.DateTime(timezone=True)),
        sa.Column("void_reason", sa.String(500)),
        sa.Column("owner_id", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "number", name="uq_purchase_bill_number"),
        sa.CheckConstraint("status IN ('draft', 'posted', 'void')", name="ck_purchase_bill_status"),
        sa.CheckConstraint("payment_status IN ('unpaid', 'partial', 'paid')", name="ck_purchase_bill_payment_status"),
        sa.CheckConstraint("match_status IN ('none', 'matched', 'variance')", name="ck_purchase_bill_match_status"),
    )
    op.create_index("ix_purchase_bills_tenant_id", "purchase_bills", ["tenant_id"])
    op.create_index("ix_purchase_bills_tenant_status_id", "purchase_bills", ["tenant_id", "status", "id"])
    op.create_index("ix_purchase_bills_tenant_vendor", "purchase_bills", ["tenant_id", "vendor_id"])
    op.create_index("ix_purchase_bills_tenant_order", "purchase_bills", ["tenant_id", "order_id"])

    op.create_table(
        "purchase_bill_lines",
        _id_column(), _tenant_column(),
        sa.Column("bill_id", sa.BigInteger(), sa.ForeignKey("purchase_bills.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order_line_id", sa.BigInteger(), sa.ForeignKey("purchase_order_lines.id", ondelete="RESTRICT")),
        sa.Column("receipt_line_id", sa.BigInteger(), sa.ForeignKey("purchase_receipt_lines.id", ondelete="SET NULL")),
        sa.Column("catalog_product_id", sa.BigInteger(), sa.ForeignKey("catalog_products.id", ondelete="SET NULL")),
        sa.Column("catalog_service_id", sa.BigInteger(), sa.ForeignKey("catalog_services.id", ondelete="SET NULL")),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(12, 4), nullable=False),
        sa.Column("unit_cost", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("po_unit_cost", sa.Numeric(12, 4)),
        sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("line_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("quantity > 0", name="ck_purchase_bill_line_positive"),
        sa.CheckConstraint("unit_cost >= 0", name="ck_purchase_bill_line_cost_nonnegative"),
        sa.CheckConstraint("tax_amount >= 0", name="ck_purchase_bill_line_tax_nonnegative"),
        sa.CheckConstraint("catalog_product_id IS NULL OR catalog_service_id IS NULL", name="ck_purchase_bill_line_one_catalog_link"),
    )
    op.create_index("ix_purchase_bill_lines_tenant_id", "purchase_bill_lines", ["tenant_id"])
    op.create_index("ix_purchase_bill_lines_bill_id", "purchase_bill_lines", ["bill_id"])
    op.create_index("ix_purchase_bill_lines_tenant_order_line", "purchase_bill_lines", ["tenant_id", "order_line_id"])

    # Payments ---------------------------------------------------------------------------------
    op.create_table(
        "finance_payments",
        _id_column(), _tenant_column(),
        sa.Column("number", sa.String(50), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False, server_default="payment"),
        sa.Column("status", sa.String(20), nullable=False, server_default="posted"),
        sa.Column("organization_id", sa.BigInteger(), sa.ForeignKey("sales_organizations.org_id", ondelete="SET NULL")),
        sa.Column("contact_id", sa.BigInteger(), sa.ForeignKey("sales_contacts.contact_id", ondelete="SET NULL")),
        sa.Column("party_name", sa.Text()),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False, server_default="USD"),
        sa.Column("paid_on", sa.Date(), nullable=False),
        sa.Column("method", sa.String(100)),
        sa.Column("reference", sa.String(200)),
        sa.Column("notes", sa.Text()),
        sa.Column("voided_at", sa.TIMESTAMP(timezone=True)),
        sa.Column("void_reason", sa.String(500)),
        sa.Column("created_by", sa.BigInteger(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("direction IN ('received', 'made')", name="ck_finance_payments_direction"),
        sa.CheckConstraint("kind IN ('payment', 'refund')", name="ck_finance_payments_kind"),
        sa.CheckConstraint("status IN ('posted', 'void')", name="ck_finance_payments_status"),
        sa.CheckConstraint("amount > 0", name="ck_finance_payments_amount_positive"),
    )
    op.create_index("ix_finance_payments_tenant_id", "finance_payments", ["tenant_id"])
    op.create_index("uq_finance_payments_tenant_number", "finance_payments", ["tenant_id", "number"], unique=True)
    op.create_index("ix_finance_payments_tenant_status_id", "finance_payments", ["tenant_id", "status", "id"])

    op.create_table(
        "finance_payment_allocations",
        _id_column(), _tenant_column(),
        sa.Column("payment_id", sa.BigInteger(), sa.ForeignKey("finance_payments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("invoice_id", sa.BigInteger(), sa.ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT")),
        sa.Column("credit_note_id", sa.BigInteger(), sa.ForeignKey("finance_credit_notes.id", ondelete="RESTRICT")),
        sa.Column("bill_id", sa.BigInteger(), sa.ForeignKey("purchase_bills.id", ondelete="RESTRICT")),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.CheckConstraint("amount > 0", name="ck_finance_payment_allocations_positive"),
        sa.CheckConstraint(
            "(CASE WHEN invoice_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN credit_note_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN bill_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_finance_payment_allocations_one_target",
        ),
    )
    op.create_index("ix_finance_payment_allocations_tenant_id", "finance_payment_allocations", ["tenant_id"])
    op.create_index("ix_finance_payment_allocations_payment_id", "finance_payment_allocations", ["payment_id"])
    op.create_index("ix_finance_payment_allocations_tenant_invoice", "finance_payment_allocations", ["tenant_id", "invoice_id"])
    op.create_index("ix_finance_payment_allocations_tenant_credit_note", "finance_payment_allocations", ["tenant_id", "credit_note_id"])
    op.create_index("ix_finance_payment_allocations_tenant_bill", "finance_payment_allocations", ["tenant_id", "bill_id"])

    # One migrated payment per invoice with money against it, for exactly that amount.
    op.execute(
        """
        INSERT INTO finance_payments (tenant_id, number, direction, kind, status, organization_id, contact_id, party_name,
                                      amount, currency, paid_on, method, reference, created_by, created_at, updated_at)
        SELECT tenant_id, 'PAY-M' || id, 'received', 'payment', 'posted', customer_organization_id, customer_contact_id, customer_name,
               amount_paid, currency, CAST(COALESCE(updated_at, created_at, now()) AS DATE), payment_method,
               'Recorded before payments were records', user_id, now(), now()
        FROM finance_pos_invoices
        WHERE amount_paid > 0 AND status = 'issued'
        """
    )
    op.execute(
        """
        INSERT INTO finance_payment_allocations (tenant_id, payment_id, invoice_id, amount)
        SELECT p.tenant_id, p.id, i.id, p.amount
        FROM finance_payments p JOIN finance_pos_invoices i ON p.number = 'PAY-M' || i.id AND p.tenant_id = i.tenant_id
        """
    )
    op.execute("UPDATE finance_pos_invoices SET amount_paid = 0 WHERE status <> 'issued'")
    op.execute("UPDATE finance_pos_invoices SET amount_paid = LEAST(amount_paid, total_amount)")
    op.execute("UPDATE finance_pos_invoices SET balance_due = CASE WHEN status = 'issued' THEN total_amount - amount_paid ELSE 0 END")
    op.execute(
        """
        UPDATE finance_pos_invoices SET payment_status = CASE
            WHEN status = 'issued' AND balance_due <= 0 THEN 'paid'
            WHEN amount_paid > 0 THEN 'partial'
            ELSE 'unpaid' END
        """
    )
    op.create_check_constraint("ck_finance_pos_invoice_status", "finance_pos_invoices", "status IN ('draft', 'issued', 'void')")
    op.create_check_constraint("ck_finance_pos_invoice_payment_status", "finance_pos_invoices", "payment_status IN ('unpaid', 'partial', 'paid')")
    op.create_check_constraint("ck_finance_pos_invoice_source", "finance_pos_invoices", "source IN ('manual', 'pos', 'sales_order', 'website_order')")

    # Orders: nothing was ever invoiced from one, so the status is whether anything is
    # invoiceable yet under the default policy (tracked products as delivered).
    op.add_column("sales_orders", sa.Column("invoice_status", sa.Text(), nullable=False, server_default="none"))
    op.create_check_constraint("ck_sales_orders_invoice_status", "sales_orders",
                               "invoice_status IN ('none', 'pending', 'to_invoice', 'partial', 'invoiced')")
    op.execute(
        """
        UPDATE sales_orders o SET invoice_status = CASE
            WHEN EXISTS (
                SELECT 1 FROM sales_order_items i
                LEFT JOIN catalog_products p ON p.id = i.catalog_product_id AND p.tenant_id = i.tenant_id
                WHERE i.order_id = o.id AND i.quantity > 0
                  AND (p.id IS NULL OR p.track_inventory = 0 OR p.deleted_at IS NOT NULL
                       OR COALESCE((SELECT SUM(dl.quantity) FROM inventory_delivery_lines dl JOIN inventory_deliveries d ON d.id = dl.delivery_id
                                    WHERE dl.order_line_id = i.id AND d.status = 'posted'), 0)
                        - COALESCE((SELECT SUM(rl.quantity) FROM inventory_return_lines rl JOIN inventory_returns r ON r.id = rl.return_id
                                    WHERE rl.order_line_id = i.id AND r.status = 'received'), 0) > 0)
            ) THEN 'to_invoice'
            WHEN EXISTS (SELECT 1 FROM sales_order_items i WHERE i.order_id = o.id) THEN 'pending'
            ELSE 'none' END
        WHERE o.status IN ('confirmed', 'fulfilled')
        """
    )

    _add_preset(bind, "sales_orders", "To invoice", [{"field": "invoice_status", "operator": "is", "value": "to_invoice"}])
    _add_preset(bind, "finance_pos", "Overdue", [{"field": "overdue", "operator": "is", "value": True}])


def downgrade() -> None:
    op.execute("DELETE FROM user_saved_views WHERE module_key = 'sales_orders' AND name = 'To invoice'")
    op.execute("DELETE FROM user_saved_views WHERE module_key = 'finance_pos' AND name = 'Overdue'")
    op.drop_constraint("ck_sales_orders_invoice_status", "sales_orders", type_="check")
    op.drop_column("sales_orders", "invoice_status")
    for table in ("finance_payment_allocations", "finance_payments", "purchase_bill_lines", "purchase_bills",
                  "finance_credit_allocations", "finance_credit_note_lines", "finance_credit_notes"):
        op.drop_table(table)
    op.drop_constraint("ck_purchase_order_bill_status", "purchase_orders", type_="check")
    op.drop_column("purchase_orders", "bill_status")
    op.drop_index("ix_finance_pos_invoice_lines_order_item", table_name="finance_pos_invoice_lines")
    op.drop_constraint("ck_finance_pos_invoice_lines_tax_nonnegative", "finance_pos_invoice_lines", type_="check")
    op.drop_constraint("ck_finance_pos_invoice_lines_discount_nonnegative", "finance_pos_invoice_lines", type_="check")
    for column in ("tax_amount", "discount_amount", "delivery_line_id", "sales_order_item_id"):
        op.drop_column("finance_pos_invoice_lines", column)
    op.drop_constraint("ck_finance_pos_invoice_source", "finance_pos_invoices", type_="check")
    op.drop_constraint("ck_finance_pos_invoice_status", "finance_pos_invoices", type_="check")
    op.drop_constraint("ck_finance_pos_invoice_payment_status", "finance_pos_invoices", type_="check")
    op.execute("UPDATE finance_pos_invoices SET status = 'paid' WHERE status = 'issued' AND payment_status = 'paid'")
    op.execute("UPDATE finance_pos_invoices SET invoice_number = 'DRAFT-' || id WHERE invoice_number IS NULL")
    op.drop_index("ix_finance_pos_invoices_tenant_order", table_name="finance_pos_invoices")
    for column in ("void_reason", "voided_at", "issued_by", "issued_at", "balance_due", "amount_credited", "sales_order_id", "source"):
        op.drop_column("finance_pos_invoices", column)
    op.alter_column("finance_pos_invoices", "invoice_number", existing_type=sa.Text(), nullable=False)
    op.create_check_constraint("ck_finance_pos_invoice_status", "finance_pos_invoices", "status IN ('draft', 'issued', 'paid', 'void')")
    op.create_check_constraint("ck_finance_pos_invoice_payment_status", "finance_pos_invoices", "payment_status IN ('unpaid', 'partial', 'paid', 'refunded')")
    op.drop_column("sales_organizations", "payment_terms_days")
    op.drop_column("company_profiles", "default_payment_terms_days")
    op.drop_column("company_profiles", "invoicing_policy")
