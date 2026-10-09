from sqlalchemy import JSON, Boolean, CheckConstraint, Column, BigInteger, Integer, String, Text, Date, TIMESTAMP, func, ForeignKey, Index, Numeric, UniqueConstraint, text
from sqlalchemy.orm import relationship
from app.core.database import Base
# Invoices, credit notes and payments point at orders, deliveries, returns and bills; their
# tables must be in the metadata whenever these are.
from app.modules.inventory import models as _inventory_models  # noqa: F401
from app.modules.purchasing import models as _purchasing_models  # noqa: F401
from app.modules.sales import models as _sales_models  # noqa: F401
from app.modules.finance.tax_models import FinanceTaxGroupMember, FinanceTaxRate  # noqa: F401


class FinancePosInvoice(Base):
    __tablename__ = "finance_pos_invoices"
    __table_args__ = (
        CheckConstraint("tax_mode IN ('exclusive', 'inclusive')", name="ck_finance_pos_invoices_tax_mode"),
        # E5 (12c-erp-invoicing.md §3): an issued invoice is final; `void` ends it. Payment
        # status is derived from payment and credit allocations, never written by an edit.
        CheckConstraint(
            "status IN ('draft', 'issued', 'void')",
            name="ck_finance_pos_invoice_status",
        ),
        CheckConstraint(
            "payment_status IN ('unpaid', 'partial', 'paid')",
            name="ck_finance_pos_invoice_payment_status",
        ),
        CheckConstraint(
            "source IN ('manual', 'pos', 'sales_order')",
            name="ck_finance_pos_invoice_source",
        ),
        CheckConstraint(
            "template_id IN ('modern', 'classic', 'compact')",
            name="ck_finance_pos_invoice_template",
        ),
        Index("ix_finance_pos_invoices_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_finance_pos_invoices_tenant_status_active", "tenant_id", "status", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_finance_pos_invoices_tenant_contact_active", "tenant_id", "customer_contact_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_finance_pos_invoices_tenant_org_active", "tenant_id", "customer_organization_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_finance_pos_invoices_tenant_order", "tenant_id", "sales_order_id"),
        Index(
            "uq_finance_pos_invoices_active_tenant_number",
            "tenant_id",
            "invoice_number",
            unique=True,
            postgresql_where=text("deleted_at IS NULL"),
            sqlite_where=text("deleted_at IS NULL"),
        ),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    customer_contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True)
    customer_organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True)

    # Given at issue (`INV-YYYYMMDD-NNNN`, per tenant); a draft has none.
    invoice_number = Column(Text, nullable=True)
    mode = Column(Text, nullable=False, server_default="pos")
    source = Column(String(20), nullable=False, server_default="manual")
    # The order this invoice was made from. Each line also names its own order line, so an
    # invoice spanning several orders later needs no change to the lines.
    sales_order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True)
    status = Column(Text, nullable=False, server_default="issued")
    payment_status = Column(Text, nullable=False, server_default="unpaid")
    payment_method = Column(Text, nullable=True)
    template_id = Column(Text, nullable=False, server_default="modern")
    accent_color = Column(Text, nullable=False, server_default="#14b8a6")

    customer_name = Column(Text, nullable=False)
    customer_email = Column(Text, nullable=True)
    customer_address = Column(Text, nullable=True)
    issue_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    currency = Column(Text, nullable=False, server_default="USD")
    subtotal_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    # The lines' discounts (13d §3.1: one definition of totals on every document).
    discount_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    # 13d §3.1: `exclusive` adds tax to the prices; `inclusive` prices already contain it.
    tax_mode = Column(String(10), nullable=False, default="exclusive", server_default="exclusive")
    tax_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    total_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    # Cached from allocations by `invoice_balances.refresh_invoice_balance` only.
    amount_paid = Column(Numeric(12, 2), nullable=False, server_default="0")
    amount_credited = Column(Numeric(12, 2), nullable=False, server_default="0")
    # 13d §3.6: balances written off (`finance_write_offs`), counted like credit.
    amount_written_off = Column(Numeric(12, 2), nullable=False, default=0, server_default="0")
    balance_due = Column(Numeric(12, 2), nullable=False, server_default="0")
    payment_terms = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    issued_at = Column(TIMESTAMP(timezone=True), nullable=True)
    issued_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    voided_at = Column(TIMESTAMP(timezone=True), nullable=True)
    void_reason = Column(String(500), nullable=True)
    # 13d §3.6: the recurring profile that issued this invoice, if any.
    recurring_invoice_id = Column(BigInteger, ForeignKey("finance_recurring_invoices.id", ondelete="SET NULL"), nullable=True, index=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    assigned_user = relationship("User", lazy="selectin", foreign_keys=[user_id])
    customer_contact = relationship("SalesContact", lazy="selectin")
    customer_organization = relationship("SalesOrganization", lazy="selectin")
    lines = relationship(
        "FinancePosInvoiceLine",
        back_populates="invoice",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="FinancePosInvoiceLine.sort_order",
    )

    @property
    def tax_summary(self) -> list[dict]:
        """Tax by rate over the lines (13d §3.1)."""
        from app.modules.finance.services.tax_rates import document_tax_summary

        return document_tax_summary(self, self.lines)


class FinancePosInvoiceLine(Base):
    __tablename__ = "finance_pos_invoice_lines"
    __table_args__ = (
        CheckConstraint("discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)", name="ck_finance_pos_invoice_lines_discount_percent"),
        CheckConstraint("line_type IN ('item', 'section', 'note')", name="ck_finance_pos_invoice_lines_line_type"),
        CheckConstraint("quantity > 0", name="ck_finance_pos_invoice_lines_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_finance_pos_invoice_lines_unit_price_nonnegative"),
        CheckConstraint("line_total >= 0", name="ck_finance_pos_invoice_lines_total_nonnegative"),
        CheckConstraint("discount_amount >= 0", name="ck_finance_pos_invoice_lines_discount_nonnegative"),
        CheckConstraint("tax_amount >= 0", name="ck_finance_pos_invoice_lines_tax_nonnegative"),
        Index("ix_finance_pos_invoice_lines_invoice", "invoice_id", "sort_order"),
        Index("ix_finance_pos_invoice_lines_order_item", "sales_order_item_id"),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id = Column(BigInteger, ForeignKey("finance_pos_invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    catalog_product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="SET NULL"), nullable=True)
    catalog_service_id = Column(BigInteger, ForeignKey("catalog_services.id", ondelete="SET NULL"), nullable=True)
    # The order line (and, from a delivery, the delivery line) this line invoices.
    sales_order_item_id = Column(Integer, ForeignKey("sales_order_items.id", ondelete="SET NULL"), nullable=True)
    delivery_line_id = Column(BigInteger, ForeignKey("inventory_delivery_lines.id", ondelete="SET NULL"), nullable=True)
    description = Column(Text, nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False, server_default="1")
    unit_price = Column(Numeric(12, 4), nullable=False, server_default="0")
    discount_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    tax_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    # 13d §3.1: the rate the tax was computed from; `tax_manual` keeps a typed amount as is.
    tax_rate_id = Column(BigInteger, ForeignKey("finance_tax_rates.id", ondelete="RESTRICT"), nullable=True)
    tax_manual = Column(Boolean, nullable=False, default=False, server_default="false")
    # 13d §3.2: `item`, or a `section` heading / `note` that carries no amounts and is skipped by
    # fulfilment, invoicing and stock. `discount_percent` set = the discount is that share of the line.
    line_type = Column(Text, nullable=False, default="item", server_default="item")
    discount_percent = Column(Numeric(7, 4), nullable=True)
    unit = Column(Text, nullable=True)
    line_total = Column(Numeric(12, 2), nullable=False, server_default="0")
    sort_order = Column(BigInteger, nullable=False, server_default="0")

    invoice = relationship("FinancePosInvoice", back_populates="lines")


class FinanceCreditNote(Base):
    """A credit against one issued invoice (12c §3.3). It reaches invoices only through
    `FinanceCreditAllocation` rows, so applying credit elsewhere later is additive."""

    __tablename__ = "finance_credit_notes"
    __table_args__ = (
        CheckConstraint("tax_mode IN ('exclusive', 'inclusive')", name="ck_finance_credit_notes_tax_mode"),
        CheckConstraint("status IN ('draft', 'issued', 'void')", name="ck_finance_credit_note_status"),
        Index("ix_finance_credit_notes_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_finance_credit_notes_tenant_invoice", "tenant_id", "invoice_id"),
        Index("uq_finance_credit_notes_tenant_number", "tenant_id", "number", unique=True,
              postgresql_where=text("number IS NOT NULL"), sqlite_where=text("number IS NOT NULL")),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=True)
    invoice_id = Column(BigInteger, ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT"), nullable=False)
    return_id = Column(BigInteger, ForeignKey("inventory_returns.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, server_default="draft")
    reason = Column(String(500), nullable=True)
    issue_date = Column(Date, nullable=True)
    currency = Column(String(10), nullable=False, server_default="USD")
    subtotal_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    discount_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    tax_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    # 13d §3.1: `exclusive` adds tax to the prices; `inclusive` prices already contain it.
    tax_mode = Column(String(10), nullable=False, default="exclusive", server_default="exclusive")
    total_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    # Cached: total − credit allocations − posted refund allocations.
    refund_due = Column(Numeric(12, 2), nullable=False, server_default="0")
    notes = Column(Text, nullable=True)
    issued_at = Column(TIMESTAMP(timezone=True), nullable=True)
    issued_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    voided_at = Column(TIMESTAMP(timezone=True), nullable=True)
    void_reason = Column(String(500), nullable=True)
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    invoice = relationship("FinancePosInvoice", lazy="selectin")
    lines = relationship("FinanceCreditNoteLine", back_populates="credit_note", cascade="all, delete-orphan",
                         order_by="FinanceCreditNoteLine.sort_order")

    @property
    def tax_summary(self) -> list[dict]:
        """Tax by rate over the lines (13d §3.1)."""
        from app.modules.finance.services.tax_rates import document_tax_summary

        return document_tax_summary(self, self.lines)


class FinanceCreditNoteLine(Base):
    __tablename__ = "finance_credit_note_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_finance_credit_note_lines_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_finance_credit_note_lines_price_nonnegative"),
        CheckConstraint("discount_amount >= 0", name="ck_finance_credit_note_lines_discount_nonnegative"),
        CheckConstraint("tax_amount >= 0", name="ck_finance_credit_note_lines_tax_nonnegative"),
        Index("ix_finance_credit_note_lines_invoice_line", "invoice_line_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    credit_note_id = Column(BigInteger, ForeignKey("finance_credit_notes.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_line_id = Column(BigInteger, ForeignKey("finance_pos_invoice_lines.id", ondelete="RESTRICT"), nullable=False)
    return_line_id = Column(BigInteger, ForeignKey("inventory_return_lines.id", ondelete="SET NULL"), nullable=True)
    description = Column(Text, nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)
    unit_price = Column(Numeric(12, 4), nullable=False, server_default="0")
    discount_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    tax_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    # 13d §3.1: the rate the tax was computed from; `tax_manual` keeps a typed amount as is.
    tax_rate_id = Column(BigInteger, ForeignKey("finance_tax_rates.id", ondelete="RESTRICT"), nullable=True)
    tax_manual = Column(Boolean, nullable=False, default=False, server_default="false")
    unit = Column(Text, nullable=True)
    line_total = Column(Numeric(12, 2), nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    credit_note = relationship("FinanceCreditNote", back_populates="lines")


class FinanceCreditAllocation(Base):
    """Credit applied to an invoice. E5 makes one per issued credit note, to its own invoice."""

    __tablename__ = "finance_credit_allocations"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_finance_credit_allocations_positive"),
        Index("ix_finance_credit_allocations_tenant_invoice", "tenant_id", "invoice_id"),
        Index("ix_finance_credit_allocations_tenant_credit_note", "tenant_id", "credit_note_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    credit_note_id = Column(BigInteger, ForeignKey("finance_credit_notes.id", ondelete="CASCADE"), nullable=False)
    invoice_id = Column(BigInteger, ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())


class FinancePayment(Base):
    """Money received from a customer or paid to a vendor (12c §3.1, §5a).

    The header holds the money; allocations say what it settles. E5 creates exactly one
    allocation for the whole amount, but nothing here assumes it, so one payment over
    several documents, or an unapplied balance, is additive later.
    """

    __tablename__ = "finance_payments"
    __table_args__ = (
        CheckConstraint("direction IN ('received', 'made')", name="ck_finance_payments_direction"),
        CheckConstraint("kind IN ('payment', 'refund')", name="ck_finance_payments_kind"),
        CheckConstraint("status IN ('posted', 'void')", name="ck_finance_payments_status"),
        CheckConstraint("amount > 0", name="ck_finance_payments_amount_positive"),
        Index("uq_finance_payments_tenant_number", "tenant_id", "number", unique=True),
        Index("ix_finance_payments_tenant_status_id", "tenant_id", "status", "id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    direction = Column(String(20), nullable=False)
    kind = Column(String(20), nullable=False, server_default="payment")
    status = Column(String(20), nullable=False, server_default="posted")
    organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True)
    party_name = Column(Text, nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)
    currency = Column(String(10), nullable=False, server_default="USD")
    paid_on = Column(Date, nullable=False)
    method = Column(String(100), nullable=True)
    reference = Column(String(200), nullable=True)
    notes = Column(Text, nullable=True)
    voided_at = Column(TIMESTAMP(timezone=True), nullable=True)
    void_reason = Column(String(500), nullable=True)
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    allocations = relationship("FinancePaymentAllocation", back_populates="payment", cascade="all, delete-orphan",
                               order_by="FinancePaymentAllocation.id", lazy="selectin")
    organization = relationship("SalesOrganization", lazy="selectin")
    contact = relationship("SalesContact", lazy="selectin")


class FinancePaymentAllocation(Base):
    __tablename__ = "finance_payment_allocations"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_finance_payment_allocations_positive"),
        CheckConstraint(
            "(CASE WHEN invoice_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN credit_note_id IS NULL THEN 0 ELSE 1 END)"
            " + (CASE WHEN bill_id IS NULL THEN 0 ELSE 1 END) + (CASE WHEN vendor_credit_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_finance_payment_allocations_one_target",
        ),
        Index("ix_finance_payment_allocations_tenant_invoice", "tenant_id", "invoice_id"),
        Index("ix_finance_payment_allocations_tenant_credit_note", "tenant_id", "credit_note_id"),
        Index("ix_finance_payment_allocations_tenant_bill", "tenant_id", "bill_id"),
        Index("ix_finance_payment_allocations_tenant_vendor_credit", "tenant_id", "vendor_credit_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    payment_id = Column(BigInteger, ForeignKey("finance_payments.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id = Column(BigInteger, ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT"), nullable=True)
    credit_note_id = Column(BigInteger, ForeignKey("finance_credit_notes.id", ondelete="RESTRICT"), nullable=True)
    bill_id = Column(BigInteger, ForeignKey("purchase_bills.id", ondelete="RESTRICT"), nullable=True)
    # A vendor's refund of a vendor credit (13c §3.6): a `received` payment of kind `refund`.
    vendor_credit_id = Column(BigInteger, ForeignKey("purchase_vendor_credits.id", ondelete="RESTRICT"), nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)

    payment = relationship("FinancePayment", back_populates="allocations")


class FinanceRecurringInvoice(Base):
    """A recurring invoice profile (13d §3.6, decision 10): a schedule and the invoice to make.
    The invoices it issues are ordinary invoices that name it (`recurring_invoice_id`)."""

    __tablename__ = "finance_recurring_invoices"
    __table_args__ = (
        CheckConstraint("frequency IN ('weekly', 'monthly', 'quarterly', 'yearly')", name="ck_finance_recurring_invoices_frequency"),
        CheckConstraint("interval_count >= 1 AND interval_count <= 52", name="ck_finance_recurring_invoices_interval"),
        CheckConstraint("action IN ('draft', 'issue_and_send')", name="ck_finance_recurring_invoices_action"),
        CheckConstraint("tax_mode IN ('exclusive', 'inclusive')", name="ck_finance_recurring_invoices_tax_mode"),
        CheckConstraint("max_count IS NULL OR max_count >= 1", name="ck_finance_recurring_invoices_max_count"),
        Index("ix_finance_recurring_invoices_due", "active", "next_run_date", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_finance_recurring_invoices_tenant_id", "tenant_id", "id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    customer_organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True)
    customer_contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True)
    customer_name = Column(Text, nullable=False)
    customer_email = Column(Text, nullable=True)
    currency = Column(String(10), nullable=False, server_default="USD")
    tax_mode = Column(String(10), nullable=False, default="exclusive", server_default="exclusive")
    # The invoice lines, in the shape `create_invoice` takes.
    lines = Column(JSON, nullable=False, default=list)
    notes = Column(Text, nullable=True)
    payment_terms = Column(Text, nullable=True)
    frequency = Column(String(20), nullable=False, server_default="monthly")
    interval_count = Column(Integer, nullable=False, default=1, server_default="1")
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)
    max_count = Column(Integer, nullable=True)
    next_run_date = Column(Date, nullable=True)
    issued_count = Column(Integer, nullable=False, default=0, server_default="0")
    action = Column(String(20), nullable=False, server_default="draft")
    active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    last_run_at = Column(TIMESTAMP(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    customer_organization = relationship("SalesOrganization", lazy="selectin")
    customer_contact = relationship("SalesContact", lazy="selectin")


class FinanceReminderRule(Base):
    """A payment reminder (13d §3.6): sent `days_offset` days from an unpaid invoice's due date
    (negative = before). Off until an admin turns it on (decision 12)."""

    __tablename__ = "finance_reminder_rules"
    __table_args__ = (
        CheckConstraint("days_offset >= -60 AND days_offset <= 365", name="ck_finance_reminder_rules_offset"),
        Index("ix_finance_reminder_rules_tenant", "tenant_id", "days_offset"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    days_offset = Column(Integer, nullable=False)
    subject = Column(String(300), nullable=False)
    body = Column(Text, nullable=False)
    attach_pdf = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    active = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class FinanceReminderSend(Base):
    """One reminder sent for one rule and one invoice: the scan's "once" (13d §3.6)."""

    __tablename__ = "finance_reminder_sends"
    __table_args__ = (
        UniqueConstraint("rule_id", "invoice_id", name="uq_finance_reminder_sends_rule_invoice"),
        Index("ix_finance_reminder_sends_tenant_invoice", "tenant_id", "invoice_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    rule_id = Column(BigInteger, ForeignKey("finance_reminder_rules.id", ondelete="CASCADE"), nullable=False)
    invoice_id = Column(BigInteger, ForeignKey("finance_pos_invoices.id", ondelete="CASCADE"), nullable=False)
    recipient = Column(Text, nullable=True)
    # `sent`, or `skipped` with why (no address, no sender): a skipped one is not retried.
    outcome = Column(String(20), nullable=False, server_default="sent")
    detail = Column(Text, nullable=True)
    sent_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())


class FinanceWriteOff(Base):
    """A balance written off an issued invoice (13d §3.6, decision 11). Counted like a credit in
    `refresh_invoice_balance`; F7 posts it to a write-off account."""

    __tablename__ = "finance_write_offs"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_finance_write_offs_positive"),
        Index("ix_finance_write_offs_tenant_invoice", "tenant_id", "invoice_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id = Column(BigInteger, ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    reason = Column(String(500), nullable=False)
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())

