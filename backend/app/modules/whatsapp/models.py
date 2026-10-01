from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class WhatsAppInteraction(Base):
    """One external-mode (click-to-chat) WhatsApp message Lynk prepared and opened.

    This table is the record of ``external_link`` mode and only that mode: every row
    means "an operator opened WhatsApp with this text for this number", never "a
    message was sent". Provider-backed messages (Meta Cloud API, 06 Phase 3) get
    their own tables with provider ids and statuses; they are not written here, and
    existing rows are never rewritten into them.
    """

    __tablename__ = "whatsapp_interactions"
    __table_args__ = (
        Index(
            "ix_whatsapp_interactions_tenant_source",
            "tenant_id",
            "source_module_key",
            "source_entity_id",
            "sent_at",
            "id",
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="CASCADE"), nullable=False, index=True)
    template_id = Column(BigInteger, ForeignKey("message_templates.id", ondelete="SET NULL"), nullable=True, index=True)
    follow_up_task_id = Column(BigInteger, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    phone_number = Column(String(64), nullable=False)
    message_body = Column(Text, nullable=False)
    whatsapp_url = Column(Text, nullable=False)
    source_module_key = Column(String(100), nullable=False, index=True, server_default="sales_contacts")
    source_entity_id = Column(String(100), nullable=False, index=True)
    # When the chat was prepared and opened. The column predates modes; it is not a
    # provider send time, and nothing confirms the operator pressed send.
    sent_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    actor = relationship("User")
    contact = relationship("SalesContact")
    template = relationship("MessageTemplate")
    follow_up_task = relationship("Task")
