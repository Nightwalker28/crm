"""Tax rates and groups (13d §3.1).

Kept apart from `finance.models` so the catalog, sales and purchasing models, which point at
a rate from items, accounts and lines, can load them without importing the finance documents.
"""

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, Numeric, String, TIMESTAMP, func, text
from sqlalchemy.orm import relationship

from app.core.database import Base


class FinanceTaxRate(Base):
    """A rate, or a group whose rate is the sum of its members' (no compounding)."""

    __tablename__ = "finance_tax_rates"
    __table_args__ = (
        CheckConstraint("kind IN ('rate', 'group')", name="ck_finance_tax_rates_kind"),
        CheckConstraint("rate >= 0 AND rate <= 100", name="ck_finance_tax_rates_rate_range"),
        Index("uq_finance_tax_rates_tenant_name", "tenant_id", "name", unique=True),
        Index("ix_finance_tax_rates_tenant_active", "tenant_id", "is_active"),
        # One default per side; the service clears the old one when another is chosen.
        Index("uq_finance_tax_rates_default_sales", "tenant_id", unique=True,
              postgresql_where=text("is_default_sales"), sqlite_where=text("is_default_sales = 1")),
        Index("uq_finance_tax_rates_default_purchases", "tenant_id", unique=True,
              postgresql_where=text("is_default_purchases"), sqlite_where=text("is_default_purchases = 1")),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    kind = Column(String(10), nullable=False, default="rate", server_default="rate")
    # A group's rate is cached from its members whenever they change.
    rate = Column(Numeric(8, 4), nullable=False, default=0, server_default="0")
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    is_default_sales = Column(Boolean, nullable=False, default=False, server_default="false")
    is_default_purchases = Column(Boolean, nullable=False, default=False, server_default="false")
    created_by = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    members = relationship(
        "FinanceTaxGroupMember",
        foreign_keys="FinanceTaxGroupMember.group_id",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="FinanceTaxGroupMember.sort_order",
    )


class FinanceTaxGroupMember(Base):
    __tablename__ = "finance_tax_group_members"
    __table_args__ = (
        Index("uq_finance_tax_group_members_pair", "group_id", "rate_id", unique=True),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    group_id = Column(BigInteger, ForeignKey("finance_tax_rates.id", ondelete="CASCADE"), nullable=False, index=True)
    rate_id = Column(BigInteger, ForeignKey("finance_tax_rates.id", ondelete="RESTRICT"), nullable=False, index=True)
    sort_order = Column(Integer, nullable=False, default=0, server_default="0")

    rate = relationship("FinanceTaxRate", foreign_keys=[rate_id], lazy="selectin")
