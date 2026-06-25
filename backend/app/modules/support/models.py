from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, JSON, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship

from app.core.database import Base


class SupportCase(Base):
    __tablename__ = "support_cases"
    __table_args__ = (
        CheckConstraint("status IN ('new', 'open', 'pending', 'resolved', 'closed')", name="ck_support_cases_status"),
        CheckConstraint("priority IN ('low', 'medium', 'high', 'urgent')", name="ck_support_cases_priority"),
        UniqueConstraint("tenant_id", "case_number", name="uq_support_cases_tenant_number"),
        Index("ix_support_cases_active_tenant", "tenant_id", postgresql_where=text("closed_at IS NULL")),
        Index("ix_support_cases_tenant_status", "tenant_id", "status"),
        Index("ix_support_cases_tenant_priority", "tenant_id", "priority"),
        Index("ix_support_cases_tenant_assignee", "tenant_id", "assigned_to_id"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    case_number = Column(Text, nullable=False, index=True)
    subject = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    category = Column(Text, nullable=True)
    status = Column(Text, nullable=False, server_default="new")
    priority = Column(Text, nullable=False, server_default="medium")
    source = Column(Text, nullable=True)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True, index=True)
    opportunity_id = Column(BigInteger, ForeignKey("sales_opportunities.opportunity_id", ondelete="SET NULL"), nullable=True, index=True)
    quote_id = Column(BigInteger, ForeignKey("sales_quotes.quote_id", ondelete="SET NULL"), nullable=True, index=True)
    order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_to_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    sla_due_at = Column(DateTime(timezone=True), nullable=True)
    first_response_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    closed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    contact = relationship("SalesContact", lazy="select")
    organization = relationship("SalesOrganization", lazy="select")
    opportunity = relationship("SalesOpportunity", lazy="select")
    quote = relationship("SalesQuote", lazy="select")
    order = relationship("SalesOrder", lazy="select")
    assigned_user = relationship("User", foreign_keys=[assigned_to_id], lazy="select")
    created_by = relationship("User", foreign_keys=[created_by_id], lazy="select")
    comments = relationship("SupportCaseComment", back_populates="case", cascade="all, delete-orphan", order_by="SupportCaseComment.created_at")
    events = relationship("SupportCaseEvent", back_populates="case", cascade="all, delete-orphan", order_by="SupportCaseEvent.created_at")


class SupportCaseComment(Base):
    __tablename__ = "support_case_comments"
    __table_args__ = (
        Index("ix_support_case_comments_tenant_case", "tenant_id", "case_id"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    case_id = Column(Integer, ForeignKey("support_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    body = Column(Text, nullable=False)
    is_internal = Column(Boolean, nullable=False, server_default="false")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    case = relationship("SupportCase", back_populates="comments")
    author = relationship("User", lazy="select")


class SupportCaseEvent(Base):
    __tablename__ = "support_case_events"
    __table_args__ = (
        Index("ix_support_case_events_tenant_case", "tenant_id", "case_id"),
        Index("ix_support_case_events_tenant_type", "tenant_id", "event_type"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    case_id = Column(Integer, ForeignKey("support_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(Text, nullable=False)
    payload_json = Column(JSON, nullable=False, server_default="{}")
    created_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    case = relationship("SupportCase", back_populates="events")
    created_by = relationship("User", lazy="select")
