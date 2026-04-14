from sqlalchemy import Column, BigInteger, Text, Date, TIMESTAMP, func, ForeignKey, Numeric, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base


class FinanceIO(Base):
    __tablename__ = "finance_io"

    id = Column(BigInteger, primary_key=True, index=True)
    module_id = Column(BigInteger, nullable=False)

    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    io_number = Column(Text, nullable=False)
    external_reference = Column(Text, nullable=True)

    file_name = Column(Text, nullable=False)
    file_path = Column(Text, nullable=True)
    customer_contact_id = Column(
        BigInteger,
        ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_organization_id = Column(
        BigInteger,
        ForeignKey("sales_organizations.org_id", ondelete="SET NULL"),
        nullable=True,
    )
    customer_name = Column(Text, nullable=True)
    counterparty_reference = Column(Text, nullable=True)
    issue_date = Column(Date, nullable=True)
    effective_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(Text, nullable=False, server_default="draft")
    currency = Column(Text, nullable=False, server_default="USD")
    subtotal_amount = Column(Numeric(12, 2), nullable=True)
    tax_amount = Column(Numeric(12, 2), nullable=True)
    total_amount = Column(Numeric(12, 2), nullable=True)
    notes = Column(Text, nullable=True)
    custom_data = Column(JSON, nullable=True)
    deleted_at = Column(TIMESTAMP(timezone=True), nullable=True)

    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    assigned_user = relationship("User", lazy="joined")
    customer_contact = relationship("SalesContact", lazy="joined")
    customer_organization = relationship("SalesOrganization", lazy="joined")

    @property
    def custom_fields(self) -> dict | None:
        return self.custom_data
