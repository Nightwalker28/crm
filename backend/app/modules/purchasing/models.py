"""Purchasing (ERP E4, `docs/crm-evolution/12b-erp-purchasing.md`): purchase orders to
vendors and the receipts that bring their stock in; RFQs, vendor returns and vendor credits
(13c §3.6–3.8)."""

from sqlalchemy import BigInteger, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.modules.catalog import models as _catalog_models  # noqa: F401
from app.modules.inventory import models as _inventory_models  # noqa: F401
from app.modules.sales import models as _sales_models  # noqa: F401


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_purchase_order_number"),
        # `draft` is a request for quotation and `sent` one sent to the vendor (13c §3.8).
        CheckConstraint("status IN ('draft', 'sent', 'ordered', 'received', 'closed', 'cancelled')", name="ck_purchase_order_status"),
        CheckConstraint("receipt_status IN ('none', 'partial', 'received')", name="ck_purchase_order_receipt_status"),
        CheckConstraint("bill_status IN ('none', 'to_bill', 'partial', 'billed')", name="ck_purchase_order_bill_status"),
        Index("ix_purchase_orders_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_purchase_orders_tenant_vendor", "tenant_id", "vendor_id"),
        Index("ix_purchase_orders_tenant_rfq_group", "tenant_id", "rfq_group_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    vendor_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="RESTRICT"), nullable=False)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    currency = Column(String(10), nullable=False, server_default="USD")
    # Base-currency units per one unit of `currency`; NULL when they are the same (12d §3.1).
    exchange_rate = Column(Numeric(18, 8))
    status = Column(String(20), nullable=False, server_default="draft")
    receipt_status = Column(String(20), nullable=False, server_default="none")
    # Cached by `bill_services.refresh_bill_status` (12c §3.2): none · to_bill · partial · billed.
    bill_status = Column(String(20), nullable=False, server_default="none")
    expected_date = Column(Date)
    vendor_reference = Column(String(120))
    notes = Column(Text)
    subtotal = Column(Numeric(18, 2), nullable=False, server_default="0")
    ordered_at = Column(DateTime(timezone=True))
    ordered_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    sent_at = Column(DateTime(timezone=True))
    sent_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    # RFQs asked of several vendors for the same need share the first one's id (13c §3.8).
    rfq_group_id = Column(BigInteger, ForeignKey("purchase_orders.id", ondelete="SET NULL"))
    closed_at = Column(DateTime(timezone=True))
    close_reason = Column(String(500))
    cancel_reason = Column(String(120))
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    vendor = relationship("SalesOrganization", lazy="selectin")
    warehouse = relationship("InventoryWarehouse", lazy="selectin")
    lines = relationship("PurchaseOrderLine", back_populates="order", cascade="all, delete-orphan", order_by="PurchaseOrderLine.sort_order")


class PurchaseOrderLine(Base):
    """A product or a service bought (13c §3.5). Products are received (tracked ones into
    stock); services are billed on the ordered quantity and never received."""

    __tablename__ = "purchase_order_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_purchase_order_line_positive"),
        CheckConstraint("unit_cost >= 0", name="ck_purchase_order_line_cost_nonnegative"),
        CheckConstraint("discount_amount >= 0", name="ck_purchase_order_line_discount_nonnegative"),
        CheckConstraint("(product_id IS NULL) <> (catalog_service_id IS NULL)", name="ck_purchase_order_line_one_item"),
        Index("ix_purchase_order_lines_tenant_product", "tenant_id", "product_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    order_id = Column(BigInteger, ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=True)
    catalog_service_id = Column(BigInteger, ForeignKey("catalog_services.id", ondelete="RESTRICT"), nullable=True)
    description = Column(Text)
    quantity = Column(Numeric(12, 4), nullable=False)
    unit_cost = Column(Numeric(12, 4), nullable=False, server_default="0")
    # An amount off the line, as on bills and sales lines; line_total = quantity × cost − discount.
    discount_amount = Column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    line_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    order = relationship("PurchaseOrder", back_populates="lines")
    product = relationship("CatalogProduct", lazy="selectin")
    service = relationship("CatalogService", lazy="selectin")

    @property
    def item_name(self) -> str:
        item = self.product or self.service
        return item.name if item is not None else "Item"

    @property
    def needs_receipt(self) -> bool:
        """Products are received; services are not."""
        return self.product_id is not None

    @property
    def net_unit_cost(self):
        """The unit cost after the line's discount: what a receipt costs stock at and a bill
        matches against."""
        from decimal import Decimal

        quantity = Decimal(self.quantity or 0)
        cost = Decimal(self.unit_cost or 0)
        if not quantity:
            return cost
        return (cost - Decimal(self.discount_amount or 0) / quantity).quantize(Decimal("0.0001"))


class PurchaseReceipt(Base):
    __tablename__ = "purchase_receipts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_purchase_receipt_number"),
        CheckConstraint("status IN ('draft', 'posted', 'cancelled')", name="ck_purchase_receipt_status"),
        Index("ix_purchase_receipts_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_purchase_receipts_tenant_order", "tenant_id", "order_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    order_id = Column(BigInteger, ForeignKey("purchase_orders.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    status = Column(String(20), nullable=False, server_default="draft")
    received_on = Column(Date)
    vendor_delivery_ref = Column(String(120))
    notes = Column(Text)
    posted_at = Column(DateTime(timezone=True))
    posted_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    cancel_reason = Column(String(120))
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    lines = relationship("PurchaseReceiptLine", back_populates="receipt", cascade="all, delete-orphan", order_by="PurchaseReceiptLine.id")


class PurchaseReceiptLine(Base):
    __tablename__ = "purchase_receipt_lines"
    __table_args__ = (
        UniqueConstraint("receipt_id", "order_line_id", name="uq_purchase_receipt_line_order_line"),
        CheckConstraint("quantity > 0", name="ck_purchase_receipt_line_positive"),
        Index("ix_purchase_receipt_lines_tenant_order_line", "tenant_id", "order_line_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    receipt_id = Column(BigInteger, ForeignKey("purchase_receipts.id", ondelete="CASCADE"), nullable=False, index=True)
    order_line_id = Column(BigInteger, ForeignKey("purchase_order_lines.id", ondelete="RESTRICT"), nullable=False)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)

    receipt = relationship("PurchaseReceipt", back_populates="lines")


class PurchaseBill(Base):
    """A vendor's invoice (12c-erp-invoicing.md §3): from a purchase order, a receipt, or
    blank for services and expenses. Each line names its own PO line, so a bill over several
    purchase orders later needs no change to the lines."""

    __tablename__ = "purchase_bills"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_purchase_bill_number"),
        CheckConstraint("status IN ('draft', 'posted', 'void')", name="ck_purchase_bill_status"),
        CheckConstraint("payment_status IN ('unpaid', 'partial', 'paid')", name="ck_purchase_bill_payment_status"),
        CheckConstraint("match_status IN ('none', 'matched', 'variance')", name="ck_purchase_bill_match_status"),
        Index("ix_purchase_bills_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_purchase_bills_tenant_vendor", "tenant_id", "vendor_id"),
        Index("ix_purchase_bills_tenant_order", "tenant_id", "order_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    vendor_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="RESTRICT"), nullable=False)
    order_id = Column(BigInteger, ForeignKey("purchase_orders.id", ondelete="RESTRICT"), nullable=True)
    receipt_id = Column(BigInteger, ForeignKey("purchase_receipts.id", ondelete="SET NULL"), nullable=True)
    vendor_invoice_number = Column(String(120), nullable=False)
    bill_date = Column(Date, nullable=False)
    due_date = Column(Date)
    currency = Column(String(10), nullable=False, server_default="USD")
    status = Column(String(20), nullable=False, server_default="draft")
    payment_status = Column(String(20), nullable=False, server_default="unpaid")
    match_status = Column(String(20), nullable=False, server_default="none")
    subtotal = Column(Numeric(18, 2), nullable=False, server_default="0")
    tax_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    total = Column(Numeric(18, 2), nullable=False, server_default="0")
    # Cached from payment allocations by `bill_services.refresh_bill_balance` only.
    amount_paid = Column(Numeric(18, 2), nullable=False, server_default="0")
    balance_due = Column(Numeric(18, 2), nullable=False, server_default="0")
    notes = Column(Text)
    posted_at = Column(DateTime(timezone=True))
    posted_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    voided_at = Column(DateTime(timezone=True))
    void_reason = Column(String(500))
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    vendor = relationship("SalesOrganization", lazy="selectin")
    order = relationship("PurchaseOrder", lazy="selectin")
    lines = relationship("PurchaseBillLine", back_populates="bill", cascade="all, delete-orphan", order_by="PurchaseBillLine.sort_order")


class PurchaseBillLine(Base):
    __tablename__ = "purchase_bill_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_purchase_bill_line_positive"),
        CheckConstraint("unit_cost >= 0", name="ck_purchase_bill_line_cost_nonnegative"),
        CheckConstraint("tax_amount >= 0", name="ck_purchase_bill_line_tax_nonnegative"),
        CheckConstraint("catalog_product_id IS NULL OR catalog_service_id IS NULL", name="ck_purchase_bill_line_one_catalog_link"),
        Index("ix_purchase_bill_lines_tenant_order_line", "tenant_id", "order_line_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    bill_id = Column(BigInteger, ForeignKey("purchase_bills.id", ondelete="CASCADE"), nullable=False, index=True)
    order_line_id = Column(BigInteger, ForeignKey("purchase_order_lines.id", ondelete="RESTRICT"), nullable=True)
    receipt_line_id = Column(BigInteger, ForeignKey("purchase_receipt_lines.id", ondelete="SET NULL"), nullable=True)
    catalog_product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="SET NULL"), nullable=True)
    catalog_service_id = Column(BigInteger, ForeignKey("catalog_services.id", ondelete="SET NULL"), nullable=True)
    description = Column(Text, nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)
    unit_cost = Column(Numeric(12, 4), nullable=False, server_default="0")
    # The PO line's cost when the line was made, so a price variance stays visible.
    po_unit_cost = Column(Numeric(12, 4))
    tax_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    line_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    bill = relationship("PurchaseBill", back_populates="lines")


class PurchaseVendorReturn(Base):
    """Goods sent back to a vendor against a posted receipt (13c §3.7). Shipping it takes the
    stock out at the receipt's cost. `resolution` says what the vendor owes back: a credit, or
    the goods again (the quantity returns to *to receive* on the purchase order)."""

    __tablename__ = "purchase_vendor_returns"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_purchase_vendor_return_number"),
        CheckConstraint("status IN ('draft', 'shipped', 'cancelled')", name="ck_purchase_vendor_return_status"),
        CheckConstraint("resolution IN ('credit', 'replace')", name="ck_purchase_vendor_return_resolution"),
        Index("ix_purchase_vendor_returns_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_purchase_vendor_returns_tenant_receipt", "tenant_id", "receipt_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    vendor_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="RESTRICT"), nullable=False)
    order_id = Column(BigInteger, ForeignKey("purchase_orders.id", ondelete="RESTRICT"), nullable=False)
    receipt_id = Column(BigInteger, ForeignKey("purchase_receipts.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    status = Column(String(20), nullable=False, default="draft", server_default="draft")
    resolution = Column(String(20), nullable=False, default="credit", server_default="credit")
    reason = Column(String(120), nullable=False)
    notes = Column(Text)
    shipped_at = Column(DateTime(timezone=True))
    shipped_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    cancel_reason = Column(String(120))
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    vendor = relationship("SalesOrganization", lazy="selectin")
    lines = relationship("PurchaseVendorReturnLine", back_populates="return_doc", cascade="all, delete-orphan",
                         order_by="PurchaseVendorReturnLine.id")


class PurchaseVendorReturnLine(Base):
    __tablename__ = "purchase_vendor_return_lines"
    __table_args__ = (
        UniqueConstraint("return_id", "receipt_line_id", name="uq_purchase_vendor_return_line_receipt_line"),
        CheckConstraint("quantity > 0", name="ck_purchase_vendor_return_line_positive"),
        Index("ix_purchase_vendor_return_lines_tenant_receipt_line", "tenant_id", "receipt_line_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    return_id = Column(BigInteger, ForeignKey("purchase_vendor_returns.id", ondelete="CASCADE"), nullable=False, index=True)
    receipt_line_id = Column(BigInteger, ForeignKey("purchase_receipt_lines.id", ondelete="RESTRICT"), nullable=False)
    order_line_id = Column(BigInteger, ForeignKey("purchase_order_lines.id", ondelete="RESTRICT"), nullable=False)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)
    # Base currency per unit, from the receipt's move: what the stock goes out at.
    unit_cost = Column(Numeric(12, 4))

    return_doc = relationship("PurchaseVendorReturn", back_populates="lines")
    product = relationship("CatalogProduct", lazy="selectin")


class PurchaseVendorCredit(Base):
    """What a vendor owes back (13c §3.6): from a bill, a vendor return, or on its own. It
    reaches bills only through `PurchaseVendorCreditAllocation` rows and is refunded through
    payment allocations, as customer credit notes are. It never moves stock; a vendor return does."""

    __tablename__ = "purchase_vendor_credits"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'issued', 'void')", name="ck_purchase_vendor_credit_status"),
        Index("ix_purchase_vendor_credits_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_purchase_vendor_credits_tenant_vendor", "tenant_id", "vendor_id"),
        Index("uq_purchase_vendor_credits_tenant_number", "tenant_id", "number", unique=True,
              postgresql_where=text("number IS NOT NULL"), sqlite_where=text("number IS NOT NULL")),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    # Allocated on issue, as credit notes are.
    number = Column(String(50), nullable=True)
    vendor_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="RESTRICT"), nullable=False)
    bill_id = Column(BigInteger, ForeignKey("purchase_bills.id", ondelete="SET NULL"), nullable=True)
    vendor_return_id = Column(BigInteger, ForeignKey("purchase_vendor_returns.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default="draft", server_default="draft")
    vendor_reference = Column(String(120))
    credit_date = Column(Date)
    currency = Column(String(10), nullable=False, server_default="USD")
    exchange_rate = Column(Numeric(18, 8))
    subtotal = Column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    tax_total = Column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    total = Column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    # Cached: total − bill allocations − posted refunds (`refresh_vendor_credit_balance`).
    credit_remaining = Column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    reason = Column(String(500))
    notes = Column(Text)
    issued_at = Column(DateTime(timezone=True))
    issued_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    voided_at = Column(DateTime(timezone=True))
    void_reason = Column(String(500))
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    vendor = relationship("SalesOrganization", lazy="selectin")
    lines = relationship("PurchaseVendorCreditLine", back_populates="credit", cascade="all, delete-orphan",
                         order_by="PurchaseVendorCreditLine.sort_order")


class PurchaseVendorCreditLine(Base):
    __tablename__ = "purchase_vendor_credit_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_purchase_vendor_credit_line_positive"),
        CheckConstraint("unit_cost >= 0", name="ck_purchase_vendor_credit_line_cost_nonnegative"),
        CheckConstraint("tax_amount >= 0", name="ck_purchase_vendor_credit_line_tax_nonnegative"),
        CheckConstraint("catalog_product_id IS NULL OR catalog_service_id IS NULL", name="ck_purchase_vendor_credit_line_one_catalog_link"),
        Index("ix_purchase_vendor_credit_lines_tenant_bill_line", "tenant_id", "bill_line_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    credit_id = Column(BigInteger, ForeignKey("purchase_vendor_credits.id", ondelete="CASCADE"), nullable=False, index=True)
    bill_line_id = Column(BigInteger, ForeignKey("purchase_bill_lines.id", ondelete="RESTRICT"), nullable=True)
    vendor_return_line_id = Column(BigInteger, ForeignKey("purchase_vendor_return_lines.id", ondelete="SET NULL"), nullable=True)
    catalog_product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="SET NULL"), nullable=True)
    catalog_service_id = Column(BigInteger, ForeignKey("catalog_services.id", ondelete="SET NULL"), nullable=True)
    description = Column(Text, nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)
    unit_cost = Column(Numeric(12, 4), nullable=False, default=0, server_default="0")
    tax_amount = Column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    line_total = Column(Numeric(18, 2), nullable=False, default=0, server_default="0")
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")

    credit = relationship("PurchaseVendorCredit", back_populates="lines")


class PurchaseVendorCreditAllocation(Base):
    """Vendor credit applied to a bill (13c §3.6)."""

    __tablename__ = "purchase_vendor_credit_allocations"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_purchase_vendor_credit_allocations_positive"),
        Index("ix_purchase_vendor_credit_allocations_tenant_bill", "tenant_id", "bill_id"),
        Index("ix_purchase_vendor_credit_allocations_tenant_credit", "tenant_id", "credit_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    credit_id = Column(BigInteger, ForeignKey("purchase_vendor_credits.id", ondelete="CASCADE"), nullable=False)
    bill_id = Column(BigInteger, ForeignKey("purchase_bills.id", ondelete="RESTRICT"), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False)
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
