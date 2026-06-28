from sqlalchemy import BigInteger, CheckConstraint, Column, Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship

from app.core.database import Base


class Contract(Base):
    __tablename__ = "contracts"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'review', 'sent', 'partially_signed', 'signed', 'active', 'expired', 'cancelled')", name="ck_contracts_status"),
        UniqueConstraint("tenant_id", "contract_number", name="uq_contracts_tenant_number"),
        Index("ix_contracts_tenant_status", "tenant_id", "status"),
        Index("ix_contracts_tenant_owner", "tenant_id", "owner_id"),
        Index("ix_contracts_tenant_updated", "tenant_id", "updated_at"),
        Index("ix_contracts_tenant_expiration_open", "tenant_id", "expiration_date", postgresql_where=text("expiration_date IS NOT NULL AND status NOT IN ('expired', 'cancelled')"), sqlite_where=text("expiration_date IS NOT NULL AND status NOT IN ('expired', 'cancelled')")),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    contract_number = Column(String(80), nullable=False, index=True)
    title = Column(Text, nullable=False)
    status = Column(String(40), nullable=False, server_default="draft")
    organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True, index=True)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True, index=True)
    opportunity_id = Column(BigInteger, ForeignKey("sales_opportunities.opportunity_id", ondelete="SET NULL"), nullable=True, index=True)
    quote_id = Column(BigInteger, ForeignKey("sales_quotes.quote_id", ondelete="SET NULL"), nullable=True, index=True)
    order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    document_id = Column(BigInteger, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True)
    effective_date = Column(Date, nullable=True)
    expiration_date = Column(Date, nullable=True)
    renewal_date = Column(Date, nullable=True)
    value_amount = Column(Numeric(18, 2), nullable=True)
    currency = Column(String(10), nullable=True)
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    parties = relationship("ContractParty", back_populates="contract", cascade="all, delete-orphan", order_by="ContractParty.created_at")
    signers = relationship("ContractSigner", back_populates="contract", cascade="all, delete-orphan", order_by="ContractSigner.signing_order")
    events = relationship("ContractEvent", back_populates="contract", cascade="all, delete-orphan", order_by="ContractEvent.created_at")


class ContractParty(Base):
    __tablename__ = "contract_parties"
    __table_args__ = (
        Index("ix_contract_parties_tenant_contract", "tenant_id", "contract_id"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    contract_id = Column(Integer, ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(Text, nullable=False)
    email = Column(String(255), nullable=True)
    role = Column(String(80), nullable=False, server_default="counterparty")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    contract = relationship("Contract", back_populates="parties")


class ContractSigner(Base):
    __tablename__ = "contract_signers"
    __table_args__ = (
        CheckConstraint("status IN ('pending', 'sent', 'viewed', 'signed', 'declined', 'voided')", name="ck_contract_signers_status"),
        Index("ix_contract_signers_tenant_contract", "tenant_id", "contract_id"),
        Index("ix_contract_signers_tenant_status", "tenant_id", "status"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    contract_id = Column(Integer, ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False, index=True)
    party_id = Column(Integer, ForeignKey("contract_parties.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(Text, nullable=False)
    email = Column(String(255), nullable=False)
    signing_order = Column(Integer, nullable=False, server_default="1")
    status = Column(String(40), nullable=False, server_default="pending")
    signed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    contract = relationship("Contract", back_populates="signers")
    party = relationship("ContractParty")


class ContractEvent(Base):
    __tablename__ = "contract_events"
    __table_args__ = (
        Index("ix_contract_events_tenant_contract", "tenant_id", "contract_id"),
        Index("ix_contract_events_tenant_type", "tenant_id", "event_type"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    contract_id = Column(Integer, ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(String(100), nullable=False)
    payload_json = Column(JSON, nullable=False, server_default="{}")
    created_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    contract = relationship("Contract", back_populates="events")
