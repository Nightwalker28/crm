from sqlalchemy import CheckConstraint, Column, BigInteger, Integer, String, Text, Date, TIMESTAMP, func, ForeignKey, Index, Numeric, text
from sqlalchemy.orm import relationship
from app.core.database import Base
# Invoices, credit notes and payments point at orders, deliveries, returns and bills; their
# tables must be in the metadata whenever these are.
from app.modules.inventory import models as _inventory_models  # noqa: F401
from app.modules.purchasing import models as _purchasing_models  # noqa: F401
from app.modules.sales import models as _sales_models  # noqa: F401


class FinanceIO(Base):
    __tablename__ = "finance_io"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'issued', 'active', 'completed', 'cancelled', 'imported')",
            name="ck_finance_io_status",
        ),
        Index("ix_finance_io_tenant_status_active", "tenant_id", "status", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_finance_io_tenant_contact", "tenant_id", "customer_contact_id"),
        Index("ix_finance_io_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("uq_finance_io_active_number", "tenant_id", "module_id", "io_number", unique=True, postgresql_where=text("deleted_at IS NULL")),
    )

    id = Column(BigInteger, primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_id = Column(BigInteger, nullable=False)

    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    io_number = Column(Text, nullable=False)
    external_reference = Column(Text, nullable=True)

    file_name = Column(Text, nullable=False)
    file_path = Column(Text, nullable=True)
    customer_contact_id = Column(
        BigInteger,
        ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_organization_id = Column(
        BigInteger,
        ForeignKey("sales_organizations.org_id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_name = Column(Text, nullable=True)
    counterparty_reference = Column(Text, nullable=True)
    issue_date = Column(Date, nullable=True)
    effective_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(Text, nullable=False, server_default="draft")
    currency = Column(Text, nullable=False, server_default="USD")
    subtotal_amount = Column(Numeric(12, 2), nullable=True)
    tax_amount = Column(Numeric(12, 2), nullable=True)
    total_amount = Column(Numeric(12, 2), nullable=True)
    notes = Column(Text, nullable=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    assigned_user = relationship("User", lazy="selectin")
    customer_contact = relationship("SalesContact", lazy="selectin")
    customer_organization = relationship("SalesOrganization", lazy="selectin")

    # Runtime cache populated by custom-field hydration. Values are persisted in
    # platform custom-field tables, so services must hydrate this last before
    # serializing and must not treat it as durable across session refreshes.
    @property
    def custom_data(self) -> dict | None:
        return getattr(self, "_custom_field_cache", None)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        self._custom_field_cache = value or None

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value


class FinancePosInvoice(Base):
    __tablename__ = "finance_pos_invoices"
    __table_args__ = (
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
            "source IN ('manual', 'pos', 'sales_order', 'website_order')",
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
    discount_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    tax_rate = Column(Numeric(8, 4), nullable=False, server_default="0")
    tax_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    total_amount = Column(Numeric(12, 2), nullable=False, server_default="0")
    # Cached from allocations by `invoice_balances.refresh_invoice_balance` only.
    amount_paid = Column(Numeric(12, 2), nullable=False, server_default="0")
    amount_credited = Column(Numeric(12, 2), nullable=False, server_default="0")
    balance_due = Column(Numeric(12, 2), nullable=False, server_default="0")
    payment_terms = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    issued_at = Column(TIMESTAMP(timezone=True), nullable=True)
    issued_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    voided_at = Column(TIMESTAMP(timezone=True), nullable=True)
    void_reason = Column(String(500), nullable=True)
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


class FinancePosInvoiceLine(Base):
    __tablename__ = "finance_pos_invoice_lines"
    __table_args__ = (
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
    line_total = Column(Numeric(12, 2), nullable=False, server_default="0")
    sort_order = Column(BigInteger, nullable=False, server_default="0")

    invoice = relationship("FinancePosInvoice", back_populates="lines")


class FinanceCreditNote(Base):
    """A credit against one issued invoice (12c §3.3). It reaches invoices only through
    `FinanceCreditAllocation` rows, so applying credit elsewhere later is additive."""

    __tablename__ = "finance_credit_notes"
    __table_args__ = (
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
            " + (CASE WHEN bill_id IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_finance_payment_allocations_one_target",
        ),
        Index("ix_finance_payment_allocations_tenant_invoice", "tenant_id", "invoice_id"),
        Index("ix_finance_payment_allocations_tenant_credit_note", "tenant_id", "credit_note_id"),
        Index("ix_finance_payment_allocations_tenant_bill", "tenant_id", "bill_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    payment_id = Column(BigInteger, ForeignKey("finance_payments.id", ondelete="CASCADE"), nullable=False, index=True)
    invoice_id = Column(BigInteger, ForeignKey("finance_pos_invoices.id", ondelete="RESTRICT"), nullable=True)
    credit_note_id = Column(BigInteger, ForeignKey("finance_credit_notes.id", ondelete="RESTRICT"), nullable=True)
    bill_id = Column(BigInteger, ForeignKey("purchase_bills.id", ondelete="RESTRICT"), nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)

    payment = relationship("FinancePayment", back_populates="allocations")
