from sqlalchemy import BigInteger, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship

from app.core.database import Base


class InventoryWarehouse(Base):
    __tablename__ = "inventory_warehouses"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_inventory_warehouse_tenant_code"),
        Index("uq_inventory_warehouse_default", "tenant_id", unique=True, postgresql_where=text("is_default = 1 AND deleted_at IS NULL"), sqlite_where=text("is_default = 1 AND deleted_at IS NULL")),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(40), nullable=False)
    name = Column(String(120), nullable=False)
    address = Column(Text)
    is_default = Column(SmallInteger, nullable=False, server_default="0")
    is_active = Column(SmallInteger, nullable=False, server_default="1")
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class InventoryStockLevel(Base):
    __tablename__ = "inventory_stock_levels"
    __table_args__ = (
        UniqueConstraint("tenant_id", "product_id", "warehouse_id", name="uq_inventory_level_tenant_product_warehouse"),
        CheckConstraint("on_hand >= 0", name="ck_inventory_level_nonnegative"),
        CheckConstraint("reserved >= 0", name="ck_inventory_level_reserved_nonnegative"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False, index=True)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False, index=True)
    on_hand = Column(Numeric(12, 4), nullable=False, server_default="0")
    reserved = Column(Numeric(12, 4), nullable=False, server_default="0")
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    product = relationship("CatalogProduct")
    warehouse = relationship("InventoryWarehouse")


class InventoryStockMove(Base):
    __tablename__ = "inventory_stock_moves"
    __table_args__ = (
        CheckConstraint("quantity <> 0", name="ck_inventory_move_nonzero"),
        Index("ix_inventory_moves_tenant_product_id", "tenant_id", "product_id", "id"),
        Index("ix_inventory_moves_tenant_warehouse_id", "tenant_id", "warehouse_id", "id"),
        Index("uq_inventory_move_source_line", "tenant_id", "source_type", "source_line_id", "move_type", unique=True, postgresql_where=text("source_line_id IS NOT NULL"), sqlite_where=text("source_line_id IS NOT NULL")),
        Index("uq_inventory_move_reversal", "reverses_move_id", unique=True, postgresql_where=text("reverses_move_id IS NOT NULL"), sqlite_where=text("reverses_move_id IS NOT NULL")),
        Index("ix_inventory_moves_tenant_order_item", "tenant_id", "sales_order_item_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False, index=True)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False, index=True)
    quantity = Column(Numeric(12, 4), nullable=False)
    move_type = Column(String(30), nullable=False)
    occurred_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    source_type = Column(String(50), nullable=False)
    source_id = Column(BigInteger, nullable=False)
    source_line_id = Column(BigInteger)
    reverses_move_id = Column(BigInteger, ForeignKey("inventory_stock_moves.id", ondelete="RESTRICT"))
    # E6 (12d §3.1-3.2): what one unit cost in the base currency, the signed value of the
    # move, the product's average once it posted, and where the cost came from.
    unit_cost = Column(Numeric(12, 4))
    value = Column(Numeric(18, 4))
    average_cost_after = Column(Numeric(12, 4))
    cost_source = Column(String(20))
    # The sales order line a delivery, legacy order move, return or their reversal served,
    # so cost of goods per line is a sum.
    sales_order_item_id = Column(Integer, ForeignKey("sales_order_items.id", ondelete="SET NULL"))
    on_hand_after = Column(Numeric(12, 4), nullable=False)
    reason = Column(String(120))
    note = Column(Text)
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    product = relationship("CatalogProduct")
    warehouse = relationship("InventoryWarehouse")


class InventoryAdjustment(Base):
    __tablename__ = "inventory_adjustments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_inventory_adjustment_number"),
        CheckConstraint("mode IN ('quantity', 'count')", name="ck_inventory_adjustment_mode"),
        CheckConstraint("status IN ('draft', 'posted', 'cancelled')", name="ck_inventory_adjustment_status"),
        Index("ix_inventory_adjustments_tenant_status_id", "tenant_id", "status", "id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    mode = Column(String(20), nullable=False, server_default="quantity")
    reason = Column(String(120), nullable=False)
    status = Column(String(20), nullable=False, server_default="draft")
    posted_at = Column(DateTime(timezone=True))
    posted_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    notes = Column(Text)
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    warehouse = relationship("InventoryWarehouse")
    lines = relationship("InventoryAdjustmentLine", back_populates="adjustment", cascade="all, delete-orphan")


class InventoryAdjustmentLine(Base):
    __tablename__ = "inventory_adjustment_lines"
    __table_args__ = (CheckConstraint("counted IS NULL OR counted >= 0", name="ck_inventory_adjustment_count_nonnegative"),)

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    adjustment_id = Column(BigInteger, ForeignKey("inventory_adjustments.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    expected = Column(Numeric(12, 4), nullable=False)
    counted = Column(Numeric(12, 4))
    delta = Column(Numeric(12, 4))
    # Required only for a product with no average yet (12d §3.2); otherwise unused.
    unit_cost = Column(Numeric(12, 4))

    adjustment = relationship("InventoryAdjustment", back_populates="lines")


class InventoryTransfer(Base):
    __tablename__ = "inventory_transfers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_inventory_transfer_number"),
        CheckConstraint("status IN ('draft', 'posted', 'cancelled')", name="ck_inventory_transfer_status"),
        CheckConstraint("from_warehouse_id <> to_warehouse_id", name="ck_inventory_transfer_distinct_warehouses"),
        Index("ix_inventory_transfers_tenant_status_id", "tenant_id", "status", "id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    from_warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    to_warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    status = Column(String(20), nullable=False, server_default="draft")
    notes = Column(Text)
    posted_at = Column(DateTime(timezone=True))
    posted_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    lines = relationship("InventoryTransferLine", back_populates="transfer", cascade="all, delete-orphan")
    from_warehouse = relationship("InventoryWarehouse", foreign_keys=[from_warehouse_id])
    to_warehouse = relationship("InventoryWarehouse", foreign_keys=[to_warehouse_id])


class InventoryTransferLine(Base):
    __tablename__ = "inventory_transfer_lines"
    __table_args__ = (
        UniqueConstraint("transfer_id", "product_id", name="uq_inventory_transfer_line_product"),
        CheckConstraint("quantity > 0", name="ck_inventory_transfer_positive_quantity"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    transfer_id = Column(BigInteger, ForeignKey("inventory_transfers.id", ondelete="CASCADE"), nullable=False, index=True)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)

    transfer = relationship("InventoryTransfer", back_populates="lines")


class InventoryReservation(Base):
    """A hold on stock for a confirmed sales order line; not a movement.

    `inventory_stock_levels.reserved` is the cached sum of these rows. Only the ledger
    service (`stock_ledger.py`) writes either.
    """

    __tablename__ = "inventory_reservations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "order_line_id", "warehouse_id", name="uq_inventory_reservation_line_warehouse"),
        CheckConstraint("quantity > 0", name="ck_inventory_reservation_positive"),
        Index("ix_inventory_reservations_tenant_product_warehouse", "tenant_id", "product_id", "warehouse_id"),
        Index("ix_inventory_reservations_tenant_order", "tenant_id", "order_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)
    order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False)
    order_line_id = Column(Integer, ForeignKey("sales_order_items.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)
    # Set by a user in the Reservations dialog; a shortage releases automatic holds first.
    manual = Column(SmallInteger, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    updated_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))



class InventoryDelivery(Base):
    """Goods leaving a warehouse for a sales order: one shipment, partial or complete."""

    __tablename__ = "inventory_deliveries"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_inventory_delivery_number"),
        CheckConstraint("status IN ('draft', 'posted', 'cancelled')", name="ck_inventory_delivery_status"),
        Index("ix_inventory_deliveries_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_inventory_deliveries_tenant_order", "tenant_id", "order_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    status = Column(String(20), nullable=False, server_default="draft")
    shipped_on = Column(Date)
    carrier = Column(String(120))
    tracking_number = Column(String(120))
    notes = Column(Text)
    posted_at = Column(DateTime(timezone=True))
    posted_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    cancel_reason = Column(String(120))
    # Created by the E3 migration for an order fulfilled before deliveries existed; its stock
    # moves are the order's `sales_order` moves, so cancelling it reverses those.
    migrated = Column(SmallInteger, nullable=False, server_default="0")
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    warehouse = relationship("InventoryWarehouse")
    lines = relationship("InventoryDeliveryLine", back_populates="delivery", cascade="all, delete-orphan", order_by="InventoryDeliveryLine.id")


class InventoryDeliveryLine(Base):
    __tablename__ = "inventory_delivery_lines"
    __table_args__ = (
        UniqueConstraint("delivery_id", "order_line_id", name="uq_inventory_delivery_line_order_line"),
        CheckConstraint("quantity > 0", name="ck_inventory_delivery_line_positive"),
        Index("ix_inventory_delivery_lines_tenant_order_line", "tenant_id", "order_line_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    delivery_id = Column(BigInteger, ForeignKey("inventory_deliveries.id", ondelete="CASCADE"), nullable=False, index=True)
    order_line_id = Column(Integer, ForeignKey("sales_order_items.id", ondelete="RESTRICT"), nullable=False)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)

    delivery = relationship("InventoryDelivery", back_populates="lines")



class InventoryReturn(Base):
    """Goods a customer sends back against a posted delivery. Stock comes back on receipt."""

    __tablename__ = "inventory_returns"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_inventory_return_number"),
        CheckConstraint("status IN ('draft', 'received', 'cancelled')", name="ck_inventory_return_status"),
        Index("ix_inventory_returns_tenant_status_id", "tenant_id", "status", "id"),
        Index("ix_inventory_returns_tenant_delivery", "tenant_id", "delivery_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    delivery_id = Column(BigInteger, ForeignKey("inventory_deliveries.id", ondelete="RESTRICT"), nullable=False)
    order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="RESTRICT"), nullable=False)
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=False)
    status = Column(String(20), nullable=False, server_default="draft")
    reason = Column(String(120), nullable=False)
    notes = Column(Text)
    received_at = Column(DateTime(timezone=True))
    received_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    cancel_reason = Column(String(120))
    deleted_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    lines = relationship("InventoryReturnLine", back_populates="return_doc", cascade="all, delete-orphan", order_by="InventoryReturnLine.id")


class InventoryReturnLine(Base):
    __tablename__ = "inventory_return_lines"
    __table_args__ = (
        UniqueConstraint("return_id", "delivery_line_id", name="uq_inventory_return_line_delivery_line"),
        CheckConstraint("quantity > 0", name="ck_inventory_return_line_positive"),
        Index("ix_inventory_return_lines_tenant_delivery_line", "tenant_id", "delivery_line_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    return_id = Column(BigInteger, ForeignKey("inventory_returns.id", ondelete="CASCADE"), nullable=False, index=True)
    delivery_line_id = Column(BigInteger, ForeignKey("inventory_delivery_lines.id", ondelete="RESTRICT"), nullable=False)
    order_line_id = Column(Integer, ForeignKey("sales_order_items.id", ondelete="RESTRICT"), nullable=False)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    quantity = Column(Numeric(12, 4), nullable=False)
    # Off for damaged goods: the return is recorded, nothing goes back into sellable stock.
    restock = Column(SmallInteger, nullable=False, server_default="1")

    return_doc = relationship("InventoryReturn", back_populates="lines")


# Reservations point at sales order lines; load those tables wherever inventory's are.
import app.modules.sales.models  # noqa: E402, F401


class InventoryRevaluation(Base):
    """A value-only change to a tracked product's stock (12d §3.1): a manual *Revalue*, or a
    bill whose price differs from the receipt. Final: corrected by another revaluation."""

    __tablename__ = "inventory_revaluations"
    __table_args__ = (
        UniqueConstraint("tenant_id", "number", name="uq_inventory_revaluation_number"),
        CheckConstraint("kind IN ('manual', 'bill_variance', 'migration')", name="ck_inventory_revaluation_kind"),
        Index("ix_inventory_revaluations_tenant_product_id", "tenant_id", "product_id", "id"),
        Index("uq_inventory_revaluation_reversal", "reverses_id", unique=True, postgresql_where=text("reverses_id IS NOT NULL"), sqlite_where=text("reverses_id IS NOT NULL")),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    number = Column(String(50), nullable=False)
    product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="RESTRICT"), nullable=False)
    kind = Column(String(20), nullable=False)
    # A posted bill line; no foreign key, because purchasing's models import these.
    bill_line_id = Column(BigInteger)
    on_hand = Column(Numeric(12, 4), nullable=False)
    average_before = Column(Numeric(12, 4))
    average_after = Column(Numeric(12, 4))
    # Value moved into (+) or out of (-) stock, and the part charged to goods already sold.
    stock_change = Column(Numeric(18, 4), nullable=False, server_default="0")
    cogs_change = Column(Numeric(18, 4), nullable=False, server_default="0")
    reason = Column(String(500), nullable=False)
    reverses_id = Column(BigInteger, ForeignKey("inventory_revaluations.id", ondelete="RESTRICT"))
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    product = relationship("CatalogProduct")
