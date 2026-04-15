from sqlalchemy import BigInteger, Boolean, Column, Date, DateTime, ForeignKey, Text, func, TIMESTAMP
from sqlalchemy.orm import relationship
from sqlalchemy.sql import expression

from app.core.database import Base

# organization model

class SalesOrganization(Base):
    __tablename__ = "sales_organizations"
    
    org_id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
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

    @property
    def custom_data(self) -> dict | None:
        return getattr(self, "_custom_field_cache", None)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        self._custom_field_cache = value or None

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value

# contacts model

class SalesContact(Base):
    __tablename__ = "sales_contacts"

    contact_id = Column(BigInteger, primary_key=True, index=True)
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
    created_time = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    assigned_user = relationship("User", lazy="joined")
    organization = relationship("SalesOrganization", lazy="joined")

    @property
    def custom_data(self) -> dict | None:
        return getattr(self, "_custom_field_cache", None)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        self._custom_field_cache = value or None

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value

    @property
    def organization_name(self) -> str | None:
        return self.organization.org_name if self.organization else None


class SalesOpportunity(Base):
    __tablename__ = "sales_opportunities"

    opportunity_id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
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
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    contact = relationship("SalesContact", lazy="joined")
    organization = relationship("SalesOrganization", lazy="joined")
    assigned_user = relationship("User", lazy="joined")

    @property
    def custom_data(self) -> dict | None:
        return getattr(self, "_custom_field_cache", None)

    @custom_data.setter
    def custom_data(self, value: dict | None) -> None:
        self._custom_field_cache = value or None

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data

    @custom_fields.setter
    def custom_fields(self, value: dict | None) -> None:
        self.custom_data = value
