from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, String, Text, UniqueConstraint, func, text
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
    unit_cost = Column(Numeric(12, 4))
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
