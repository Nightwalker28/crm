"""Purchasing (ERP E4, `docs/crm-evolution/12b-erp-purchasing.md`): purchase orders to
vendors and the receipts that bring their stock in."""

from sqlalchemy import BigInteger, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.modules.catalog import models as _catalog_models  # noqa: F401
from app.modules.inventory import models as _inventory_models  # noqa: F401
from app.modules.sales import models as _sales_models  # noqa: F401


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_purchase_order_number"),
        CheckConstraint("status IN ('draft', 'ordered', 'received', 'closed', 'cancelled')", name="ck_purchase_order_status"),
        CheckConstraint("receipt_status IN ('none', 'partial', 'received')", name="ck_purchase_order_receipt_status"),
        CheckConstraint("bill_status IN ('none', 'to_bill', 'partial', 'billed')", name="ck_purchase_order_bill_status"),
        Index("ix_purchase_orders_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_purchase_orders_tenant_vendor", "tenant_id", "vendor_id"),
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
    __tablename__ = "purchase_order_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_purchase_order_line_positive"),
        CheckConstraint("unit_cost >= 0", name="ck_purchase_order_line_cost_nonnegative"),
        Index("ix_purchase_order_lines_tenant_product", "tenant_id", "product_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    order_id = Column(BigInteger, ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    description = Column(Text)
    quantity = Column(Numeric(12, 4), nullable=False)
    unit_cost = Column(Numeric(12, 4), nullable=False, server_default="0")
    line_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    order = relationship("PurchaseOrder", back_populates="lines")
    product = relationship("CatalogProduct", lazy="selectin")


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
