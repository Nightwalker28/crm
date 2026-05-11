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


class CatalogProduct(Base):
    __tablename__ = "catalog_products"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_catalog_products_tenant_slug"),
        UniqueConstraint("tenant_id", "sku", name="uq_catalog_products_tenant_sku"),
        CheckConstraint(
            "stock_status IN ('untracked', 'in_stock', 'out_of_stock', 'preorder')",
            name="ck_catalog_products_stock_status",
        ),
        CheckConstraint("public_unit_price >= 0", name="ck_catalog_products_public_price_nonnegative"),
        CheckConstraint("stock_quantity IS NULL OR stock_quantity >= 0", name="ck_catalog_products_stock_nonnegative"),
        Index("ix_catalog_products_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_catalog_products_tenant_active", "tenant_id", "is_active", postgresql_where=text("deleted_at IS NULL")),
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


class CatalogService(Base):
    __tablename__ = "catalog_services"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_catalog_services_tenant_slug"),
        CheckConstraint("public_unit_price >= 0", name="ck_catalog_services_public_price_nonnegative"),
        Index("ix_catalog_services_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_catalog_services_tenant_active", "tenant_id", "is_active", postgresql_where=text("deleted_at IS NULL")),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(180), nullable=False, index=True)
    slug = Column(String(160), nullable=True, index=True)
    description = Column(Text, nullable=True)
    currency = Column(String(3), nullable=False, server_default="USD")
    public_unit_price = Column(Numeric(12, 4), nullable=False, server_default="0")
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
