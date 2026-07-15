from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, Computed, Date, DateTime, ForeignKey, Index, Integer, JSON, Numeric, Text, func, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import expression

from app.core.database import Base
from app.modules.client_portal.models import CustomerGroup  # noqa: F401
from app.modules.sales.opportunity_stages import OPPORTUNITY_STAGE_CHECK_SQL


def _get_custom_field_cache(record) -> dict | None:
    return getattr(record, "_custom_field_cache", None)


def _set_custom_field_cache(record, value: dict | None) -> None:
    # Custom fields are persisted in CustomFieldValue rows; model instances only carry hydrated response data.
    record._custom_field_cache = value or None


# organization model

class SalesOrganization(Base):
    __tablename__ = "sales_organizations"
    __table_args__ = (
        Index("ix_sales_organizations_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )
    
    org_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    org_name = Column(Text, nullable=False)
    website = Column(Text, nullable=True)

    primary_phone = Column(Text, nullable=True)
    secondary_phone = Column(Text, nullable=True)
    primary_email = Column(Text, nullable=True)
    secondary_email = Column(Text, nullable=True)

    industry = Column(Text, nullable=True)
    annual_revenue = Column(Text, nullable=True)

    assigned_to = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_group_id = Column(
        BigInteger,
        ForeignKey("customer_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    billing_address = Column(Text, nullable=True)
    billing_city = Column(Text, nullable=True)
    billing_state = Column(Text, nullable=True)
    billing_postal_code = Column(Text, nullable=True)
    billing_country = Column(Text, nullable=True)
    search_doc = Column(
        Text,
        Computed(
            "lower(coalesce(org_name, '') || ' ' || coalesce(website, '') || ' ' || "
            "coalesce(primary_email, '') || ' ' || coalesce(industry, '') || ' ' || "
            "coalesce(billing_city, '') || ' ' || coalesce(billing_country, ''))",
            persisted=True,
        ),
        nullable=True,
    )
    customer_group = relationship("CustomerGroup", lazy="selectin")
    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="selectin")

    @property
    def custom_data(self) -> dict | None:
        return _get_custom_field_cache(self)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        _set_custom_field_cache(self, value)

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value

    @property
    def assigned_to_name(self) -> str | None:
        if not self.assigned_user:
            return None
        full_name = " ".join(part for part in [self.assigned_user.first_name, self.assigned_user.last_name] if part).strip()
        return full_name or self.assigned_user.email

# contacts model

class SalesContact(Base):
    __tablename__ = "sales_contacts"
    __table_args__ = (
        Index("ix_sales_contacts_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )

    contact_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    first_name = Column(Text, nullable=True)
    last_name = Column(Text, nullable=True)
    contact_telephone = Column(Text, nullable=True)
    linkedin_url = Column(Text, nullable=True)
    primary_email = Column(Text, nullable=False, index=True)
    current_title = Column(Text, nullable=True)
    region = Column(Text, nullable=True)
    country = Column(Text, nullable=True)
    email_opt_out = Column(Boolean, nullable=False, server_default=expression.false())
    assigned_to = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    organization_id = Column(
        BigInteger,
        ForeignKey("sales_organizations.org_id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_group_id = Column(
        BigInteger,
        ForeignKey("customer_groups.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_contacted_channel = Column(Text, nullable=True)
    last_contacted_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    whatsapp_last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    search_doc = Column(
        Text,
        Computed(
            "lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || "
            "coalesce(contact_telephone, '') || ' ' || coalesce(primary_email, '') || ' ' || "
            "coalesce(current_title, '') || ' ' || coalesce(region, '') || ' ' || "
            "coalesce(country, '') || ' ' || coalesce(linkedin_url, ''))",
            persisted=True,
        ),
        nullable=True,
    )

    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="selectin")
    last_contacted_by = relationship("User", foreign_keys=[last_contacted_by_user_id], lazy="selectin")

    @property
    def assigned_to_name(self) -> str | None:
        if not self.assigned_user:
            return None
        full_name = " ".join(part for part in [self.assigned_user.first_name, self.assigned_user.last_name] if part).strip()
        return full_name or self.assigned_user.email
    organization = relationship("SalesOrganization", lazy="selectin")
    customer_group = relationship("CustomerGroup", lazy="selectin")

    @property
    def custom_data(self) -> dict | None:
        return _get_custom_field_cache(self)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        _set_custom_field_cache(self, value)

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value

    @property
    def organization_name(self) -> str | None:
        return self.organization.org_name if self.organization else None


class SalesLead(Base):
    __tablename__ = "sales_leads"
    __table_args__ = (
        CheckConstraint(
            "status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted')",
            name="ck_sales_leads_status",
        ),
        Index("ix_sales_leads_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_leads_tenant_status_active", "tenant_id", "status", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_leads_tenant_team_active", "tenant_id", "team_id", postgresql_where=text("deleted_at IS NULL")),
        Index(
            "ix_sales_leads_tenant_next_follow_up_active",
            "tenant_id",
            "next_follow_up_at",
            postgresql_where=text("deleted_at IS NULL AND next_follow_up_at IS NOT NULL"),
        ),
    )

    lead_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    first_name = Column(Text, nullable=True)
    last_name = Column(Text, nullable=True)
    company = Column(Text, nullable=True)
    primary_email = Column(Text, nullable=False, index=True)
    phone = Column(Text, nullable=True)
    title = Column(Text, nullable=True)
    source = Column(Text, nullable=True)
    status = Column(Text, nullable=False, server_default="new")
    notes = Column(Text, nullable=True)
    assigned_to = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    next_follow_up_at = Column(DateTime(timezone=True), nullable=True)
    last_contacted_channel = Column(Text, nullable=True)
    last_contacted_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    search_doc = Column(
        Text,
        Computed(
            "lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || "
            "coalesce(company, '') || ' ' || coalesce(primary_email, '') || ' ' || "
            "coalesce(phone, '') || ' ' || coalesce(title, '') || ' ' || "
            "coalesce(source, '') || ' ' || coalesce(status, ''))",
            persisted=True,
        ),
        nullable=True,
    )

    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="selectin")
    team = relationship("Team", foreign_keys=[team_id], lazy="selectin")
    last_contacted_by = relationship("User", foreign_keys=[last_contacted_by_user_id], lazy="selectin")
    score_record = relationship("SalesLeadScore", back_populates="lead", uselist=False, lazy="selectin", cascade="all, delete-orphan")

    @property
    def custom_data(self) -> dict | None:
        return _get_custom_field_cache(self)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        _set_custom_field_cache(self, value)

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value

    @property
    def assigned_to_name(self) -> str | None:
        if not self.assigned_user:
            return None
        full_name = " ".join(part for part in [self.assigned_user.first_name, self.assigned_user.last_name] if part).strip()
        return full_name or self.assigned_user.email

    @property
    def team_name(self) -> str | None:
        return self.team.name if self.team else None

    @property
    def tags(self) -> list[str]:
        return list(getattr(self, "_record_tags_cache", []))

    @property
    def next_follow_up_is_overdue(self) -> bool:
        if self.next_follow_up_at is None:
            return False
        follow_up_at = self.next_follow_up_at
        if follow_up_at.tzinfo is None:
            follow_up_at = follow_up_at.replace(tzinfo=timezone.utc)
        return follow_up_at < datetime.now(timezone.utc)

    @property
    def score(self) -> int | None:
        return self.score_record.score if self.score_record else None

    @property
    def score_grade(self) -> str | None:
        return self.score_record.grade if self.score_record else None

    @property
    def score_factors(self) -> list[dict] | None:
        return self.score_record.factors_json if self.score_record else None

    @property
    def score_calculated_at(self):
        return self.score_record.calculated_at if self.score_record else None


class SalesLeadScore(Base):
    __tablename__ = "sales_lead_scores"
    __table_args__ = (
        CheckConstraint("score >= 0 AND score <= 100", name="ck_sales_lead_scores_score_range"),
        CheckConstraint("grade IN ('hot', 'warm', 'cold')", name="ck_sales_lead_scores_grade"),
        Index("ix_sales_lead_scores_tenant_score", "tenant_id", "score"),
        Index("ix_sales_lead_scores_tenant_grade", "tenant_id", "grade"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    lead_id = Column(BigInteger, ForeignKey("sales_leads.lead_id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    score = Column(BigInteger, nullable=False, server_default="0")
    grade = Column(Text, nullable=False, server_default="cold")
    factors_json = Column(JSON, nullable=False, server_default="[]")
    calculated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    lead = relationship("SalesLead", back_populates="score_record")


class SalesQuote(Base):
    __tablename__ = "sales_quotes"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'sent', 'accepted', 'declined', 'expired')",
            name="ck_sales_quotes_status",
        ),
        Index("ix_sales_quotes_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_quotes_tenant_status_active", "tenant_id", "status", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_quotes_tenant_contact", "tenant_id", "contact_id"),
        Index("ix_sales_quotes_tenant_organization", "tenant_id", "organization_id"),
        Index("ix_sales_quotes_tenant_opportunity", "tenant_id", "opportunity_id"),
    )

    quote_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    quote_number = Column(Text, nullable=False, index=True)
    title = Column(Text, nullable=True)
    customer_name = Column(Text, nullable=False)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True)
    organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True)
    opportunity_id = Column(BigInteger, ForeignKey("sales_opportunities.opportunity_id", ondelete="SET NULL"), nullable=True)
    status = Column(Text, nullable=False, server_default="draft")
    issue_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    currency = Column(Text, nullable=False, server_default="USD")
    subtotal_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    discount_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    tax_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    total_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    notes = Column(Text, nullable=True)
    assigned_to = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    search_doc = Column(
        Text,
        Computed(
            "lower(coalesce(quote_number, '') || ' ' || coalesce(title, '') || ' ' || "
            "coalesce(customer_name, '') || ' ' || coalesce(status, '') || ' ' || "
            "coalesce(currency, '') || ' ' || coalesce(notes, ''))",
            persisted=True,
        ),
        nullable=True,
    )

    contact = relationship("SalesContact", lazy="selectin")
    organization = relationship("SalesOrganization", lazy="selectin")
    opportunity = relationship("SalesOpportunity", lazy="selectin")
    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="selectin")
    proposal_documents = relationship("SalesQuoteDocument", back_populates="quote", cascade="all, delete-orphan")

    @property
    def custom_data(self) -> dict | None:
        return _get_custom_field_cache(self)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        _set_custom_field_cache(self, value)

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value


class SalesQuoteDocument(Base):
    __tablename__ = "sales_quote_documents"
    __table_args__ = (
        CheckConstraint(
            "status IN ('generated', 'sent', 'expired')",
            name="ck_sales_quote_documents_status",
        ),
        Index("ix_sales_quote_documents_tenant_quote", "tenant_id", "quote_id"),
        Index("ix_sales_quote_documents_tenant_status", "tenant_id", "status"),
        Index("ix_sales_quote_documents_token_hash", "public_token_hash"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    quote_id = Column(BigInteger, ForeignKey("sales_quotes.quote_id", ondelete="CASCADE"), nullable=False, index=True)
    document_id = Column(BigInteger, ForeignKey("documents.id", ondelete="SET NULL"), nullable=True, index=True)
    template_name = Column(Text, nullable=False, server_default="default_quote_proposal")
    status = Column(Text, nullable=False, server_default="generated")
    title = Column(Text, nullable=False)
    content_text = Column(Text, nullable=False)
    public_token_hash = Column(Text, nullable=True, unique=True)
    public_expires_at = Column(DateTime(timezone=True), nullable=True)
    sent_to = Column(Text, nullable=True)
    generated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    quote = relationship("SalesQuote", back_populates="proposal_documents")


class SalesQuoteOpenEvent(Base):
    __tablename__ = "sales_quote_open_events"
    __table_args__ = (
        CheckConstraint(
            "event_type IN ('sent', 'opened', 'viewed', 'downloaded')",
            name="ck_sales_quote_open_events_type",
        ),
        Index("ix_sales_quote_open_events_tenant_quote", "tenant_id", "quote_id"),
        Index("ix_sales_quote_open_events_document", "quote_document_id"),
        Index("ix_sales_quote_open_events_occurred", "tenant_id", "occurred_at"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    quote_id = Column(BigInteger, ForeignKey("sales_quotes.quote_id", ondelete="CASCADE"), nullable=False, index=True)
    quote_document_id = Column(Integer, ForeignKey("sales_quote_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type = Column(Text, nullable=False)
    recipient_email = Column(Text, nullable=True)
    ip_hash = Column(Text, nullable=True)
    user_agent_hash = Column(Text, nullable=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    quote = relationship("SalesQuote", lazy="selectin")
    document = relationship("SalesQuoteDocument", lazy="selectin")


class SalesOrder(Base):
    __tablename__ = "sales_orders"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'confirmed', 'fulfilled', 'cancelled')",
            name="ck_sales_orders_status",
        ),
        Index("ix_sales_orders_tenant_status", "tenant_id", "status"),
        Index("ix_sales_orders_tenant_quote", "tenant_id", "quote_id"),
        Index("ix_sales_orders_tenant_created", "tenant_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    order_number = Column(Text, nullable=False, index=True)
    quote_id = Column(BigInteger, ForeignKey("sales_quotes.quote_id", ondelete="SET NULL"), nullable=True, unique=True, index=True)
    organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True, index=True)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True, index=True)
    opportunity_id = Column(BigInteger, ForeignKey("sales_opportunities.opportunity_id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(Text, nullable=False, server_default="confirmed")
    currency = Column(Text, nullable=False, server_default="USD")
    subtotal = Column(Numeric(18, 2), nullable=False, server_default="0")
    tax_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    discount_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    grand_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    owner_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_by_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    search_doc = Column(
        Text,
        Computed(
            "lower(coalesce(order_number, '') || ' ' || coalesce(status, '') || ' ' || coalesce(currency, ''))",
            persisted=True,
        ),
        nullable=True,
    )

    quote = relationship("SalesQuote", lazy="selectin")
    organization = relationship("SalesOrganization", lazy="selectin")
    contact = relationship("SalesContact", lazy="selectin")
    opportunity = relationship("SalesOpportunity", lazy="selectin")
    items = relationship("SalesOrderItem", back_populates="order", cascade="all, delete-orphan", order_by="SalesOrderItem.sort_order")


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"
    __table_args__ = (
        Index("ix_sales_order_items_tenant_order", "tenant_id", "order_id"),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    quantity = Column(Numeric(18, 4), nullable=False, server_default="1")
    unit_price = Column(Numeric(18, 2), nullable=False, server_default="0")
    discount_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    tax_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    line_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    order = relationship("SalesOrder", back_populates="items")


class SalesOpportunity(Base):
    __tablename__ = "sales_opportunities"
    __table_args__ = (
        CheckConstraint(OPPORTUNITY_STAGE_CHECK_SQL, name="ck_sales_opportunities_sales_stage"),
        CheckConstraint(
            "probability_percent IS NULL OR (probability_percent >= 0 AND probability_percent <= 100)",
            name="ck_sales_opportunities_probability_range",
        ),
        Index("ix_sales_opportunities_tenant_stage_active", "tenant_id", "sales_stage", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_opportunities_tenant_close_active", "tenant_id", "expected_close_date", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_opportunities_tenant_contact", "tenant_id", "contact_id"),
        Index("ix_sales_opportunities_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )

    opportunity_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    opportunity_name = Column(Text, nullable=False)
    client = Column(Text, nullable=False)
    sales_stage = Column(Text, nullable=True)

    contact_id = Column(
        BigInteger,
        ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"),
        nullable=True,
    )
    organization_id = Column(
        BigInteger,
        ForeignKey("sales_organizations.org_id", ondelete="SET NULL"),
        nullable=True,
    )
    assigned_to = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    start_date = Column(Date, nullable=True)
    expected_close_date = Column(Date, nullable=True)
    probability_percent = Column(Numeric(5, 2), nullable=True)
    campaign_type = Column(Text, nullable=True)
    total_leads = Column(Text, nullable=True)
    cpl = Column(Text, nullable=True)
    total_cost_of_project = Column(Text, nullable=True)
    currency_type = Column(Text, nullable=True)
    target_geography = Column(Text, nullable=True)
    target_audience = Column(Text, nullable=True)
    domain_cap = Column(Text, nullable=True)
    tactics = Column(Text, nullable=True)
    delivery_format = Column(Text, nullable=True)
    attachments = Column(Text, nullable=True)

    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_contacted_channel = Column(Text, nullable=True)
    last_contacted_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    contact = relationship("SalesContact", lazy="selectin")
    organization = relationship("SalesOrganization", lazy="selectin")
    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="selectin")
    last_contacted_by = relationship("User", foreign_keys=[last_contacted_by_user_id], lazy="selectin")

    @property
    def custom_data(self) -> dict | None:
        return _get_custom_field_cache(self)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        _set_custom_field_cache(self, value)

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value

    @property
    def assigned_to_name(self) -> str | None:
        if not self.assigned_user:
            return None
        full_name = " ".join(
            part for part in [self.assigned_user.first_name, self.assigned_user.last_name] if part
        ).strip()
        return full_name or self.assigned_user.email

    @property
    def organization_name(self) -> str | None:
        return self.organization.org_name if self.organization else None

    @property
    def contact_name(self) -> str | None:
        if not self.contact:
            return None
        full_name = " ".join(part for part in [self.contact.first_name, self.contact.last_name] if part).strip()
        return full_name or self.contact.primary_email
