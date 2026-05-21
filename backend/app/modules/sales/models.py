from sqlalchemy import BigInteger, Boolean, CheckConstraint, Column, Computed, Date, DateTime, ForeignKey, Index, Numeric, Text, func, TIMESTAMP, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import expression

from app.core.database import Base
from app.modules.client_portal.models import CustomerGroup  # noqa: F401


def _get_custom_field_cache(record) -> dict | None:
    return getattr(record, "_custom_field_cache", None)


def _set_custom_field_cache(record, value: dict | None) -> None:
    record._custom_field_cache = value or None


# organization model

class SalesOrganization(Base):
    __tablename__ = "sales_organizations"
    __table_args__ = (
        Index("ix_sales_organizations_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )
    
    org_id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
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

    created_time = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
    )
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

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
    customer_group = relationship("CustomerGroup", lazy="joined")

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

# contacts model

class SalesContact(Base):
    __tablename__ = "sales_contacts"
    __table_args__ = (
        Index("ix_sales_contacts_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )

    contact_id = Column(BigInteger, primary_key=True, index=True)
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
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
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
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)
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

    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="joined")
    last_contacted_by = relationship("User", foreign_keys=[last_contacted_by_user_id], lazy="joined")
    organization = relationship("SalesOrganization", lazy="joined")
    customer_group = relationship("CustomerGroup", lazy="joined")

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
    )

    lead_id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
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
    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_contacted_channel = Column(Text, nullable=True)
    last_contacted_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)
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

    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="joined")
    last_contacted_by = relationship("User", foreign_keys=[last_contacted_by_user_id], lazy="joined")

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
    )

    quote_id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    quote_number = Column(Text, nullable=False, index=True)
    title = Column(Text, nullable=True)
    customer_name = Column(Text, nullable=False)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True)
    organization_id = Column(BigInteger, ForeignKey("sales_organizations.org_id", ondelete="SET NULL"), nullable=True)
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
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)
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

    contact = relationship("SalesContact", lazy="joined")
    organization = relationship("SalesOrganization", lazy="joined")
    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="joined")

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


class SalesOpportunity(Base):
    __tablename__ = "sales_opportunities"
    __table_args__ = (
        CheckConstraint(
            "sales_stage IS NULL OR sales_stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'closed_won', 'closed_lost')",
            name="ck_sales_opportunities_sales_stage",
        ),
        Index("ix_sales_opportunities_tenant_stage_active", "tenant_id", "sales_stage", postgresql_where=text("deleted_at IS NULL")),
        Index("ix_sales_opportunities_tenant_contact", "tenant_id", "contact_id"),
        Index("ix_sales_opportunities_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )

    opportunity_id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
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

    created_time = Column(
        TIMESTAMP(timezone=True),
        server_default=func.now(),
    )
    last_contacted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    last_contacted_channel = Column(Text, nullable=True)
    last_contacted_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    contact = relationship("SalesContact", lazy="joined")
    organization = relationship("SalesOrganization", lazy="joined")
    assigned_user = relationship("User", foreign_keys=[assigned_to], lazy="joined")
    last_contacted_by = relationship("User", foreign_keys=[last_contacted_by_user_id], lazy="joined")

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
