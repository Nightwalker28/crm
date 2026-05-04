from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class CustomerGroup(Base):
    __tablename__ = "customer_groups"
    __table_args__ = (
        UniqueConstraint("tenant_id", "group_key", name="uq_customer_groups_tenant_key"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    group_key = Column(String(80), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    discount_type = Column(String(20), nullable=False, server_default="none")
    discount_value = Column(Numeric(10, 4), nullable=True)
    is_default = Column(SmallInteger, nullable=False, server_default="0", index=True)
    is_active = Column(SmallInteger, nullable=False, server_default="1", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    tenant = relationship("Tenant")


class ClientAccount(Base):
    __tablename__ = "client_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "email", name="uq_client_accounts_tenant_email"),
        CheckConstraint(
            "(contact_id IS NOT NULL AND organization_id IS NULL) OR "
            "(contact_id IS NULL AND organization_id IS NOT NULL)",
            name="ck_client_accounts_one_linked_record",
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="CASCADE"), nullable=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="CASCADE"), nullable=True, index=True)
    email = Column(String(150), nullable=False, index=True)
    password_hash = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, server_default="pending", index=True)
    setup_token_hash = Column(String(64), nullable=True, unique=True, index=True)
    setup_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    last_login_at = Column(DateTime(timezone=True), nullable=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    updated_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    tenant = relationship("Tenant")
    contact = relationship("SalesContact")
    organization = relationship("SalesOrganization")
    creator = relationship("User", foreign_keys=[created_by_user_id])
    updated_by = relationship("User", foreign_keys=[updated_by_user_id])
