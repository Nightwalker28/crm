from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, Computed, Date, DateTime, ForeignKey, ForeignKeyConstraint, Index, Integer, JSON, Numeric, SmallInteger, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import expression

from app.core.custom_field_cache import CustomFieldsMixin
from app.core.database import Base
from app.modules.catalog.models import CatalogProduct, CatalogService  # noqa: F401 - line items point at the catalog
from app.modules.client_portal.models import ClientAccount, CustomerGroup  # noqa: F401 - portal orders name their account
from app.modules.inventory.models import InventoryWarehouse  # noqa: F401 - orders hold stock in a warehouse
from app.modules.website_integrations.models import WebsiteIntegrationApiKey  # noqa: F401 - website orders name their key
from app.modules.sales.opportunity_contact_roles import (
    DEFAULT_OPPORTUNITY_CONTACT_ROLE,
    OPPORTUNITY_CONTACT_ROLE_CHECK_SQL,
)
from app.modules.sales.opportunity_stages import (
    OPPORTUNITY_PIPELINE_MODULE_KEY,
    PIPELINE_MODULE_CHECK_SQL,
    PIPELINE_STAGE_SEMANTIC_CHECK_SQL,
)


# organization model

class SalesOrganization(CustomFieldsMixin, Base):
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
    account_type = Column(Text, nullable=True)
    # In the company's base currency (13a A4, A11).
    annual_revenue = Column(Numeric(18, 2), nullable=True)
    employee_count = Column(Integer, nullable=True)

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

    # Structured addresses (13a C2): `*_address` is the street line.
    billing_address = Column(Text, nullable=True)
    billing_street2 = Column(Text, nullable=True)
    billing_city = Column(Text, nullable=True)
    billing_state = Column(Text, nullable=True)
    billing_postal_code = Column(Text, nullable=True)
    billing_country = Column(Text, nullable=True)
    shipping_address = Column(Text, nullable=True)
    shipping_street2 = Column(Text, nullable=True)
    shipping_city = Column(Text, nullable=True)
    shipping_state = Column(Text, nullable=True)
    shipping_postal_code = Column(Text, nullable=True)
    shipping_country = Column(Text, nullable=True)
    # A vendor is an Account that sells to us (12-erp-inventory.md §7 decision 6); the same
    # company can be a customer too.
    is_vendor = Column(SmallInteger, nullable=False, server_default="0")
    # Days from an invoice's or bill's date to its due date (12c §3.5); none uses the
    # company default.
    payment_terms_days = Column(Integer, nullable=True)
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
    def assigned_to_name(self) -> str | None:
        if not self.assigned_user:
            return None
        full_name = " ".join(part for part in [self.assigned_user.first_name, self.assigned_user.last_name] if part).strip()
        return full_name or self.assigned_user.email

# contacts model

class SalesContact(CustomFieldsMixin, Base):
    __tablename__ = "sales_contacts"
    __table_args__ = (
        Index("ix_sales_contacts_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        CheckConstraint(
            "primary_email IS NOT NULL OR contact_telephone IS NOT NULL OR mobile_phone IS NOT NULL",
            name="ck_sales_contacts_reachable",
        ),
    )

    contact_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    salutation = Column(Text, nullable=True)
    first_name = Column(Text, nullable=True)
    last_name = Column(Text, nullable=True)
    # The work phone; the column keeps its first name (13b §3.5).
    contact_telephone = Column(Text, nullable=True)
    mobile_phone = Column(Text, nullable=True)
    linkedin_url = Column(Text, nullable=True)
    primary_email = Column(Text, nullable=True, index=True)
    current_title = Column(Text, nullable=True)
    region = Column(Text, nullable=True)
    # The mailing address; `country` is its country (an ISO code).
    mailing_address = Column(Text, nullable=True)
    mailing_street2 = Column(Text, nullable=True)
    mailing_city = Column(Text, nullable=True)
    mailing_state = Column(Text, nullable=True)
    mailing_postal_code = Column(Text, nullable=True)
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
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_contacted_channel = Column(Text, nullable=True)
    last_contacted_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    whatsapp_last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    search_doc = Column(
        Text,
        Computed(
            "lower(coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' || "
            "coalesce(contact_telephone, '') || ' ' || coalesce(mobile_phone, '') || ' ' || coalesce(primary_email, '') || ' ' || "
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
    def organization_name(self) -> str | None:
        return self.organization.org_name if self.organization else None


class SalesLead(CustomFieldsMixin, Base):
    __tablename__ = "sales_leads"
    __table_args__ = (
        # A lead can be phone-only (13a A9): it needs an email or a phone, not both.
        CheckConstraint(
            "primary_email IS NOT NULL OR phone IS NOT NULL OR mobile_phone IS NOT NULL",
            name="ck_sales_leads_reachable",
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
    primary_email = Column(Text, nullable=True, index=True)
    phone = Column(Text, nullable=True)
    mobile_phone = Column(Text, nullable=True)
    title = Column(Text, nullable=True)
    source = Column(Text, nullable=True)
    status = Column(Text, nullable=False, server_default="new")
    notes = Column(Text, nullable=True)
    assigned_to = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
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
            "coalesce(phone, '') || ' ' || coalesce(mobile_phone, '') || ' ' || coalesce(title, '') || ' ' || "
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


class SalesQuote(CustomFieldsMixin, Base):
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
        UniqueConstraint("tenant_id", "quote_id", name="uq_sales_quotes_tenant_quote_id"),
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
    # Copied from the account when it is chosen, editable on the document (13a C3).
    billing_address = Column(Text, nullable=True)
    billing_street2 = Column(Text, nullable=True)
    billing_city = Column(Text, nullable=True)
    billing_state = Column(Text, nullable=True)
    billing_postal_code = Column(Text, nullable=True)
    billing_country = Column(Text, nullable=True)
    shipping_address = Column(Text, nullable=True)
    shipping_street2 = Column(Text, nullable=True)
    shipping_city = Column(Text, nullable=True)
    shipping_state = Column(Text, nullable=True)
    shipping_postal_code = Column(Text, nullable=True)
    shipping_country = Column(Text, nullable=True)
    customer_po_reference = Column(Text, nullable=True)
    terms_and_conditions = Column(Text, nullable=True)
    shipping_method = Column(Text, nullable=True)
    shipping_charge = Column(Numeric(18, 2), nullable=False, server_default="0")
    # Why the customer declined, from the `lost_reason` picklist.
    lost_reason = Column(Text, nullable=True)
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

    @property
    def assigned_to_name(self) -> str | None:
        """The owner's name, so the record spine draws a person rather than `assigned_to: 7`."""

        if not self.assigned_user:
            return None
        return " ".join(
            part for part in [self.assigned_user.first_name, self.assigned_user.last_name] if part
        ).strip() or self.assigned_user.email
    items = relationship("SalesQuoteItem", back_populates="quote", cascade="all, delete-orphan", order_by="SalesQuoteItem.sort_order")
    proposal_documents = relationship("SalesQuoteDocument", back_populates="quote", cascade="all, delete-orphan")


class SalesQuoteItem(Base):
    __tablename__ = "sales_quote_items"
    __table_args__ = (
        ForeignKeyConstraint(
            ["tenant_id", "quote_id"],
            ["sales_quotes.tenant_id", "sales_quotes.quote_id"],
            name="fk_sales_quote_items_tenant_quote",
            ondelete="CASCADE",
        ),
        CheckConstraint("quantity > 0", name="ck_sales_quote_items_quantity_positive"),
        CheckConstraint("unit_price >= 0", name="ck_sales_quote_items_unit_price_nonnegative"),
        CheckConstraint("discount_amount >= 0", name="ck_sales_quote_items_discount_nonnegative"),
        CheckConstraint("tax_amount >= 0", name="ck_sales_quote_items_tax_nonnegative"),
        CheckConstraint("line_total >= 0", name="ck_sales_quote_items_total_nonnegative"),
        CheckConstraint(
            "catalog_product_id IS NULL OR catalog_service_id IS NULL",
            name="ck_sales_quote_items_one_catalog_link",
        ),
        Index("ix_sales_quote_items_tenant_quote", "tenant_id", "quote_id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    tenant_id = Column(BigInteger, nullable=False)
    quote_id = Column(BigInteger, nullable=False)
    # The catalog item the line was picked from. The line keeps its own name and price, so a
    # catalog change never rewrites a sent quote; a free-text line has neither link.
    catalog_product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="SET NULL"), nullable=True, index=True)
    catalog_service_id = Column(BigInteger, ForeignKey("catalog_services.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    quantity = Column(Numeric(18, 4), nullable=False, server_default="1")
    unit_price = Column(Numeric(18, 2), nullable=False, server_default="0")
    discount_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    tax_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    line_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    quote = relationship("SalesQuote", back_populates="items")


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
        CheckConstraint(
            "delivery_status IN ('none', 'pending', 'partial', 'delivered', 'closed')",
            name="ck_sales_orders_delivery_status",
        ),
        CheckConstraint("priority IN ('urgent', 'high', 'normal')", name="ck_sales_orders_priority"),
        CheckConstraint(
            "invoice_status IN ('none', 'pending', 'to_invoice', 'partial', 'invoiced')",
            name="ck_sales_orders_invoice_status",
        ),
        Index("ix_sales_orders_tenant_status", "tenant_id", "status"),
        Index("ix_sales_orders_tenant_quote", "tenant_id", "quote_id"),
        Index("ix_sales_orders_tenant_created", "tenant_id", "created_at"),
        CheckConstraint("source IN ('crm', 'website', 'client_portal')", name="ck_sales_orders_source"),
        # A shop's order reference is unique per tenant, so a retried submission finds its order.
        Index(
            "uq_sales_orders_tenant_external_reference",
            "tenant_id",
            "external_reference",
            unique=True,
            postgresql_where=text("external_reference IS NOT NULL"),
            sqlite_where=text("external_reference IS NOT NULL"),
        ),
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
    delivery_date = Column(Date, nullable=True)
    payment_terms = Column(Text, nullable=True)
    # Base-currency units per one unit of `currency`, for margin only (12d §3.3); NULL when
    # the order is in the base currency or no rate was given.
    exchange_rate = Column(Numeric(18, 8), nullable=True)
    # Where the order's stock is held and shipped from; NULL means the default warehouse.
    warehouse_id = Column(BigInteger, ForeignKey("inventory_warehouses.id", ondelete="RESTRICT"), nullable=True, index=True)
    # Cached from deliveries for lists and saved views: none (nothing stocked), pending,
    # partial, delivered, or closed (the rest was deliberately not shipped).
    delivery_status = Column(Text, nullable=False, server_default="none")
    # Cached by `invoicing_services.refresh_invoice_status` (12c §3.2): none (draft or
    # cancelled) · pending (nothing to invoice yet) · to_invoice · partial · invoiced.
    invoice_status = Column(Text, nullable=False, server_default="none")
    # Arriving stock goes to waiting orders by priority, then oldest first.
    priority = Column(Text, nullable=False, server_default="normal")
    remaining_closed_at = Column(DateTime(timezone=True), nullable=True)
    remaining_close_reason = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    # Copied from the account when it is chosen, editable on the document (13a C3).
    billing_address = Column(Text, nullable=True)
    billing_street2 = Column(Text, nullable=True)
    billing_city = Column(Text, nullable=True)
    billing_state = Column(Text, nullable=True)
    billing_postal_code = Column(Text, nullable=True)
    billing_country = Column(Text, nullable=True)
    shipping_address = Column(Text, nullable=True)
    shipping_street2 = Column(Text, nullable=True)
    shipping_city = Column(Text, nullable=True)
    shipping_state = Column(Text, nullable=True)
    shipping_postal_code = Column(Text, nullable=True)
    shipping_country = Column(Text, nullable=True)
    customer_po_reference = Column(Text, nullable=True)
    terms_and_conditions = Column(Text, nullable=True)
    shipping_method = Column(Text, nullable=True)
    shipping_charge = Column(Numeric(18, 2), nullable=False, server_default="0")
    # Why the order was cancelled, from the `lost_reason` picklist.
    lost_reason = Column(Text, nullable=True)
    # Where the order came from (13 F1.3): crm (staff, or a converted quote), website (the
    # public integration API) or client_portal. `channel` names the shop platform the website
    # sent; `external_reference` is its order reference and `request_hash` the submitted body,
    # so a retried submission returns the same order instead of a second one.
    source = Column(Text, nullable=False, server_default="crm", index=True)
    channel = Column(Text, nullable=True)
    external_reference = Column(Text, nullable=True)
    request_hash = Column(Text, nullable=True)
    integration_key_id = Column(BigInteger, ForeignKey("website_integration_api_keys.id", ondelete="SET NULL"), nullable=True, index=True)
    client_account_id = Column(BigInteger, ForeignKey("client_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
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
    owner_user = relationship("User", foreign_keys=[owner_id], lazy="selectin")
    warehouse = relationship("InventoryWarehouse", lazy="selectin")
    items = relationship("SalesOrderItem", back_populates="order", cascade="all, delete-orphan", order_by="SalesOrderItem.sort_order")

    @property
    def warehouse_name(self) -> str | None:
        return self.warehouse.name if self.warehouse else None

    @property
    def organization_name(self) -> str | None:
        return self.organization.org_name if self.organization else None

    @property
    def contact_name(self) -> str | None:
        if not self.contact:
            return None
        return " ".join(part for part in [self.contact.first_name, self.contact.last_name] if part).strip() or self.contact.primary_email

    @property
    def opportunity_name(self) -> str | None:
        return self.opportunity.opportunity_name if self.opportunity else None

    @property
    def quote_number(self) -> str | None:
        """The originating quote's number. Without it the rail can only draw `Quote #12`."""

        return self.quote.quote_number if self.quote else None

    @property
    def owner_name(self) -> str | None:
        if not self.owner_user:
            return None
        return " ".join(part for part in [self.owner_user.first_name, self.owner_user.last_name] if part).strip() or self.owner_user.email


class SalesOrderItem(Base):
    __tablename__ = "sales_order_items"
    __table_args__ = (
        Index("ix_sales_order_items_tenant_order", "tenant_id", "order_id"),
        CheckConstraint(
            "catalog_product_id IS NULL OR catalog_service_id IS NULL",
            name="ck_sales_order_items_one_catalog_link",
        ),
    )

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    order_id = Column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    catalog_product_id = Column(BigInteger, ForeignKey("catalog_products.id", ondelete="SET NULL"), nullable=True, index=True)
    catalog_service_id = Column(BigInteger, ForeignKey("catalog_services.id", ondelete="SET NULL"), nullable=True, index=True)
    name = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    quantity = Column(Numeric(18, 4), nullable=False, server_default="1")
    unit_price = Column(Numeric(18, 2), nullable=False, server_default="0")
    discount_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    tax_amount = Column(Numeric(18, 2), nullable=False, server_default="0")
    line_total = Column(Numeric(18, 2), nullable=False, server_default="0")
    sort_order = Column(Integer, nullable=False, server_default="0")

    order = relationship("SalesOrder", back_populates="items")


class SalesOpportunity(CustomFieldsMixin, Base):
    __tablename__ = "sales_opportunities"
    __table_args__ = (
        CheckConstraint(
            "probability_percent IS NULL OR (probability_percent >= 0 AND probability_percent <= 100)",
            name="ck_sales_opportunities_probability_range",
        ),
        CheckConstraint("amount IS NULL OR amount >= 0", name="ck_sales_opportunities_amount"),
        # A deal belongs to an account, a contact, or both (13a H13).
        CheckConstraint("organization_id IS NOT NULL OR contact_id IS NOT NULL", name="ck_sales_opportunities_party"),
        Index("ix_sales_opportunities_tenant_stage_active", "tenant_id", "sales_stage", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_opportunities_tenant_close_active", "tenant_id", "expected_close_date", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_opportunities_tenant_contact", "tenant_id", "contact_id"),
        Index("ix_sales_opportunities_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
        # Board columns and "stage in use" counts group live deals by stage row.
        Index(
            "ix_sales_opportunities_tenant_pipeline_stage_active",
            "tenant_id",
            "pipeline_stage_id",
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    opportunity_id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    opportunity_name = Column(Text, nullable=False)
    # The stage's stable key, mirrored from `pipeline_stage_id` by the pipeline service.
    # Kept for filters, search, export and the API's `sales_stage` field. Since Phase 4
    # it is no longer pinned to the six seeded keys; the stage row is what makes it valid.
    sales_stage = Column(Text, nullable=True)
    # Nullable during compatibility: a NULL pipeline means the tenant default, a NULL
    # stage means unstaged. Only `pipelines_services.assign_opportunity_stage` writes them.
    pipeline_id = Column(BigInteger, ForeignKey("sales_pipelines.id"), nullable=True, index=True)
    pipeline_stage_id = Column(BigInteger, ForeignKey("sales_pipeline_stages.id"), nullable=True)

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
    # The deal's value in `currency_type` (13a A4, C1); the agency fields that were here are
    # custom fields now, in the tenants that used them.
    amount = Column(Numeric(18, 2), nullable=True)
    currency_type = Column(Text, nullable=True)
    deal_type = Column(Text, nullable=True)
    source = Column(Text, nullable=True)
    next_step = Column(Text, nullable=True)
    lost_reason = Column(Text, nullable=True)
    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_contacted_channel = Column(Text, nullable=True)
    last_contacted_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    contact = relationship("SalesContact", lazy="selectin")
    organization = relationship("SalesOrganization", lazy="selectin")
    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="selectin")
    pipeline_stage = relationship("SalesPipelineStage", lazy="selectin")
    last_contacted_by = relationship("User", foreign_keys=[last_contacted_by_user_id], lazy="selectin")
    contact_associations = relationship(
        "SalesOpportunityContact",
        back_populates="opportunity",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

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


class SalesOpportunityContact(Base):
    """Every contact involved in a deal, with the role they play in it.

    A B2B deal routinely runs through a champion, a decision maker, a technical
    evaluator, and procurement. `sales_opportunities.contact_id` can only hold one
    of them, so it stays as the legacy primary field and the row flagged
    `is_primary` here mirrors it for the compatibility period. Domain services own
    that mirror; nothing writes this table directly.

    Rows are tenant-denormalized: the partial primary uniqueness index and the
    contact -> opportunities lookup both run without joining the parent, and the
    service validates the tenant against the opportunity on every write.
    """

    __tablename__ = "sales_opportunity_contacts"
    __table_args__ = (
        # A contact appears on a deal once, so a duplicate participant is rejected
        # by the database rather than by whichever caller happens to check first.
        UniqueConstraint("opportunity_id", "contact_id", name="uq_sales_opportunity_contacts_link"),
        # At most one primary per opportunity, enforced in the database so two
        # concurrent legacy `contact_id` writes cannot leave a deal with two.
        Index(
            "uq_sales_opportunity_contacts_primary",
            "opportunity_id",
            unique=True,
            postgresql_where=text("is_primary"),
            sqlite_where=text("is_primary"),
        ),
        # Contact -> deals, for the relationship rails that read from the contact side.
        Index(
            "ix_sales_opportunity_contacts_contact",
            "tenant_id",
            "contact_id",
            "opportunity_id",
        ),
        CheckConstraint(OPPORTUNITY_CONTACT_ROLE_CHECK_SQL, name="ck_sales_opportunity_contacts_role"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    opportunity_id = Column(
        BigInteger,
        ForeignKey("sales_opportunities.opportunity_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    contact_id = Column(
        BigInteger,
        ForeignKey("sales_contacts.contact_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role_key = Column(Text, nullable=False, server_default=DEFAULT_OPPORTUNITY_CONTACT_ROLE)
    is_primary = Column(Boolean, nullable=False, server_default=expression.false())

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    # Removing a participant is recoverable: the row is retained so the link, its
    # role, and who established it survive, and re-adding the same contact revives
    # this row rather than creating a second one under the unique link constraint.
    # The primary partial unique index above deliberately ignores `deleted_at`, so
    # a removed row can never sit on the primary flag.
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    opportunity = relationship("SalesOpportunity", back_populates="contact_associations")
    contact = relationship("SalesContact", lazy="selectin")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
    deleted_by = relationship("User", foreign_keys=[deleted_by_user_id])


class SalesPipeline(Base):
    """A tenant's configurable sales pipeline (04-pipelines-kanban, Phase 1).

    Pipelines are sales-domain configuration, not generic metadata, so
    `module_key` is constrained to the modules that have one. A pipeline is
    deactivated rather than deleted, because historical records keep pointing at
    its stages.
    """

    __tablename__ = "sales_pipelines"
    __table_args__ = (
        UniqueConstraint("tenant_id", "module_key", "name", name="uq_sales_pipelines_name"),
        # One default per tenant and module, enforced in the database so two
        # concurrent first-use seeds cannot both win.
        Index(
            "uq_sales_pipelines_default",
            "tenant_id",
            "module_key",
            unique=True,
            postgresql_where=text("is_default"),
            sqlite_where=text("is_default"),
        ),
        CheckConstraint("NOT is_default OR is_active", name="ck_sales_pipelines_default_active"),
        CheckConstraint(PIPELINE_MODULE_CHECK_SQL, name="ck_sales_pipelines_module"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(Text, nullable=False, server_default=OPPORTUNITY_PIPELINE_MODULE_KEY)
    name = Column(Text, nullable=False)
    is_default = Column(Boolean, nullable=False, server_default=expression.false())
    is_active = Column(Boolean, nullable=False, server_default=expression.true())
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    stages = relationship(
        "SalesPipelineStage",
        back_populates="pipeline",
        order_by="(SalesPipelineStage.position, SalesPipelineStage.id)",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class SalesPipelineStage(Base):
    """One stage of a pipeline.

    `key` is the stable machine identity and is never renamed; `label` is what an
    administrator edits. Business logic reads `semantic_type` or `key`, never the
    label. An inactive stage stays so records that sat in it remain readable.
    """

    __tablename__ = "sales_pipeline_stages"
    __table_args__ = (
        UniqueConstraint("pipeline_id", "key", name="uq_sales_pipeline_stages_key"),
        Index("ix_sales_pipeline_stages_pipeline_position", "tenant_id", "pipeline_id", "position"),
        CheckConstraint(PIPELINE_STAGE_SEMANTIC_CHECK_SQL, name="ck_sales_pipeline_stages_semantic"),
        CheckConstraint("probability >= 0 AND probability <= 100", name="ck_sales_pipeline_stages_probability"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    pipeline_id = Column(
        BigInteger,
        ForeignKey("sales_pipelines.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    key = Column(Text, nullable=False)
    label = Column(Text, nullable=False)
    position = Column(Integer, nullable=False, server_default="0")
    semantic_type = Column(Text, nullable=False)
    probability = Column(Numeric(5, 2), nullable=False, server_default="0")
    is_active = Column(Boolean, nullable=False, server_default=expression.true())
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    pipeline = relationship("SalesPipeline", back_populates="stages")
