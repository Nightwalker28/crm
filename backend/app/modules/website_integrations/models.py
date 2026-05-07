from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
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


class WebsiteIntegrationApiKey(Base):
    __tablename__ = "website_integration_api_keys"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_website_integration_keys_tenant_name"),
        UniqueConstraint("key_hash", name="uq_website_integration_keys_hash"),
        CheckConstraint("status IN ('active', 'revoked')", name="ck_website_integration_keys_status"),
        Index(
            "ix_website_integration_keys_active_tenant",
            "tenant_id",
            postgresql_where=text("status = 'active'"),
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    key_prefix = Column(String(24), nullable=False, index=True)
    key_hash = Column(String(64), nullable=False)
    scopes = Column(JSON, nullable=True)
    allowed_origins = Column(JSON, nullable=True)
    status = Column(String(20), nullable=False, server_default="active", index=True)
    last_used_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    revoked_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    tenant = relationship("Tenant")
    creator = relationship("User", foreign_keys=[created_by_user_id])
    revoked_by = relationship("User", foreign_keys=[revoked_by_user_id])


class WebsiteCatalogItem(Base):
    __tablename__ = "website_catalog_items"
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_website_catalog_items_tenant_slug"),
        UniqueConstraint("tenant_id", "sku", name="uq_website_catalog_items_tenant_sku"),
        CheckConstraint("item_type IN ('product', 'service', 'bundle')", name="ck_website_catalog_items_type"),
        CheckConstraint(
            "stock_status IN ('untracked', 'in_stock', 'out_of_stock', 'preorder')",
            name="ck_website_catalog_items_stock_status",
        ),
        CheckConstraint("public_unit_price >= 0", name="ck_website_catalog_items_public_price_nonnegative"),
        CheckConstraint("stock_quantity IS NULL OR stock_quantity >= 0", name="ck_website_catalog_items_stock_nonnegative"),
        Index("ix_website_catalog_items_public_active", "tenant_id", "is_public", "is_active"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    item_type = Column(String(20), nullable=False, server_default="product", index=True)
    slug = Column(String(160), nullable=False, index=True)
    sku = Column(String(100), nullable=True, index=True)
    name = Column(String(180), nullable=False, index=True)
    description = Column(Text, nullable=True)
    currency = Column(String(3), nullable=False, server_default="USD")
    public_unit_price = Column(Numeric(12, 4), nullable=False)
    stock_status = Column(String(20), nullable=False, server_default="untracked", index=True)
    stock_quantity = Column(Numeric(12, 4), nullable=True)
    media_url = Column(String(500), nullable=True)
    metadata_json = Column(JSON, nullable=True)
    is_public = Column(SmallInteger, nullable=False, server_default="0", index=True)
    is_active = Column(SmallInteger, nullable=False, server_default="1", index=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False, index=True)

    tenant = relationship("Tenant")
    creator = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
