from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class WhatsAppInteraction(Base):
    __tablename__ = "whatsapp_interactions"

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
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
    sent_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    actor = relationship("User")
    contact = relationship("SalesContact")
    template = relationship("MessageTemplate")
    follow_up_task = relationship("Task")
