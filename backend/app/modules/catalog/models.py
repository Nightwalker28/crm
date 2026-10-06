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
    # The price quotes and orders start from; `public_unit_price` is the website's (13a C4).
    list_price = Column(Numeric(12, 4), nullable=True)
    tax_category = Column(String(100), nullable=True)
    weight = Column(Numeric(12, 4), nullable=True)
    weight_unit = Column(String(10), nullable=True)
    length = Column(Numeric(12, 4), nullable=True)
    width = Column(Numeric(12, 4), nullable=True)
    height = Column(Numeric(12, 4), nullable=True)
    dimension_unit = Column(String(10), nullable=True)
    stock_status = Column(String(20), nullable=False, server_default="untracked", index=True)
    stock_quantity = Column(Numeric(12, 4), nullable=True)
    track_inventory = Column(SmallInteger, nullable=False, server_default="0")
    reorder_point = Column(Numeric(12, 4), nullable=False, server_default="0")
    reorder_quantity = Column(Numeric(12, 4), nullable=False, server_default="0")
    category_id = Column(BigInteger, ForeignKey("catalog_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    # For tracked products, the moving average in the base currency, written only by the
    # stock ledger (12d §3.1); for untracked products, a manual cost as before.
    cost_price = Column(Numeric(12, 4), nullable=True)
    # Cached Σ move values + Σ revaluations for tracked products, in the base currency.
    stock_value = Column(Numeric(18, 4), nullable=False, server_default="0")
    unit = Column(String(40), nullable=False, server_default="unit")
    barcode = Column(String(100), nullable=True)
    # Purchasing (E4): who this is normally bought from, under which code, and how long it takes.
    preferred_vendor_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True, index=True)
    vendor_sku = Column(String(100), nullable=True)
    lead_time_days = Column(Integer, nullable=True)
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
    preferred_vendor = relationship("SalesOrganization", lazy="selectin")


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
    list_price = Column(Numeric(12, 4), nullable=True)
    tax_category = Column(String(100), nullable=True)
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


# Products point at their preferred vendor, an Account; load those tables wherever these are.
import app.modules.sales.models  # noqa: E402, F401


class CatalogItemImage(Base):
    """More pictures of a product or service, after its main image (13a C4)."""

    __tablename__ = "catalog_item_images"
    __table_args__ = (
        CheckConstraint("item_kind IN ('product', 'service')", name="ck_catalog_item_images_kind"),
        Index("ix_catalog_item_images_item", "tenant_id", "item_kind", "item_id", "position"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    item_kind = Column(String(10), nullable=False)
    item_id = Column(BigInteger, nullable=False)
    media_path = Column(String(500), nullable=False)
    media_content_type = Column(String(120), nullable=True)
    media_original_filename = Column(String(255), nullable=True)
    position = Column(Integer, nullable=False, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
