from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
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
