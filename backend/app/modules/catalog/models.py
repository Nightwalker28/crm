from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class CatalogCategory(Base):
    """A grouping for products and services (Odoo categories, Salesforce product families).

    One level of nesting: a category may have a parent, and that parent may not have one.
    Configuration rather than an operational record, so a delete is a real delete, refused
    while any product or service still uses the category.
    """

    __tablename__ = "catalog_categories"
    __table_args__ = (
        Index("ix_catalog_categories_tenant_parent", "tenant_id", "parent_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_id = Column(BigInteger, ForeignKey("catalog_categories.id", ondelete="RESTRICT"), nullable=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, server_default="0")
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    parent = relationship("CatalogCategory", remote_side=[id], lazy="selectin")

    @property
    def full_name(self) -> str:
        return f"{self.parent.name} / {self.name}" if self.parent is not None else self.name


class CatalogProduct(Base):
    __tablename__ = "catalog_products"
    __table_args__ = (
        UniqueConstraint("tenant_id", "sku", name="uq_catalog_products_tenant_sku"),
        CheckConstraint(
            "stock_status IN ('untracked', 'in_stock', 'out_of_stock', 'preorder')",
            name="ck_catalog_products_stock_status",
        ),
        CheckConstraint("public_unit_price >= 0", name="ck_catalog_products_public_price_nonnegative"),
        CheckConstraint("stock_quantity IS NULL OR stock_quantity >= 0", name="ck_catalog_products_stock_nonnegative"),
        CheckConstraint("cost_price IS NULL OR cost_price >= 0", name="ck_catalog_products_cost_nonnegative"),
        CheckConstraint("reorder_point >= 0", name="ck_catalog_products_reorder_point_nonnegative"),
        CheckConstraint("reorder_quantity >= 0", name="ck_catalog_products_reorder_quantity_nonnegative"),
        Index(
            "uq_catalog_products_active_tenant_barcode",
            "tenant_id",
            "barcode",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND barcode IS NOT NULL"),
            sqlite_where=text("deleted_at IS NULL AND barcode IS NOT NULL"),
        ),
        Index("ix_catalog_products_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_catalog_products_tenant_active", "tenant_id", "is_active", postgresql_where=text("deleted_at IS NULL")),
        Index(
            "uq_catalog_products_active_tenant_slug",
            "tenant_id",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND slug IS NOT NULL"),
            sqlite_where=text("deleted_at IS NULL AND slug IS NOT NULL"),
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(180), nullable=False, index=True)
    slug = Column(String(160), nullable=True, index=True)
    description = Column(Text, nullable=True)
    sku = Column(String(100), nullable=True, index=True)
    currency = Column(String(3), nullable=False, server_default="USD")
    public_unit_price = Column(Numeric(12, 4), nullable=False, server_default="0")
    stock_status = Column(String(20), nullable=False, server_default="untracked", index=True)
    stock_quantity = Column(Numeric(12, 4), nullable=True)
    track_inventory = Column(SmallInteger, nullable=False, server_default="0")
    reorder_point = Column(Numeric(12, 4), nullable=False, server_default="0")
    reorder_quantity = Column(Numeric(12, 4), nullable=False, server_default="0")
    category_id = Column(BigInteger, ForeignKey("catalog_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    cost_price = Column(Numeric(12, 4), nullable=True)
    unit = Column(String(40), nullable=False, server_default="unit")
    barcode = Column(String(100), nullable=True)
    is_public = Column(SmallInteger, nullable=False, server_default="0", index=True)
    is_active = Column(SmallInteger, nullable=False, server_default="1", index=True)
    media_path = Column(String(500), nullable=True)
    media_content_type = Column(String(120), nullable=True)
    media_original_filename = Column(String(255), nullable=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    tenant = relationship("Tenant")
    creator = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
    category = relationship("CatalogCategory", lazy="selectin")


class CatalogService(Base):
    __tablename__ = "catalog_services"
    __table_args__ = (
        CheckConstraint("public_unit_price >= 0", name="ck_catalog_services_public_price_nonnegative"),
        CheckConstraint("cost_price IS NULL OR cost_price >= 0", name="ck_catalog_services_cost_nonnegative"),
        Index(
            "uq_catalog_services_active_tenant_sku",
            "tenant_id",
            "sku",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND sku IS NOT NULL"),
            sqlite_where=text("deleted_at IS NULL AND sku IS NOT NULL"),
        ),
        Index("ix_catalog_services_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_catalog_services_tenant_active", "tenant_id", "is_active", postgresql_where=text("deleted_at IS NULL")),
        Index(
            "uq_catalog_services_active_tenant_slug",
            "tenant_id",
            "slug",
            unique=True,
            postgresql_where=text("deleted_at IS NULL AND slug IS NOT NULL"),
            sqlite_where=text("deleted_at IS NULL AND slug IS NOT NULL"),
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(180), nullable=False, index=True)
    slug = Column(String(160), nullable=True, index=True)
    description = Column(Text, nullable=True)
    sku = Column(String(100), nullable=True, index=True)
    currency = Column(String(3), nullable=False, server_default="USD")
    public_unit_price = Column(Numeric(12, 4), nullable=False, server_default="0")
    category_id = Column(BigInteger, ForeignKey("catalog_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    cost_price = Column(Numeric(12, 4), nullable=True)
    unit = Column(String(40), nullable=False, server_default="unit")
    is_public = Column(SmallInteger, nullable=False, server_default="0", index=True)
    is_active = Column(SmallInteger, nullable=False, server_default="1", index=True)
    media_path = Column(String(500), nullable=True)
    media_content_type = Column(String(120), nullable=True)
    media_original_filename = Column(String(255), nullable=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    tenant = relationship("Tenant")
    creator = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
    category = relationship("CatalogCategory", lazy="selectin")
