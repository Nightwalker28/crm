from sqlalchemy import (
    JSON,
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship

from app.core.database import Base


class UserMailConnection(Base):
    __tablename__ = "user_mail_connections"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "provider", name="uq_user_mail_connections_user_provider"),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(20), nullable=False, index=True)
    status = Column(String(20), nullable=False, server_default="disconnected", index=True)
    account_email = Column(String(255), nullable=True)
    scopes = Column(JSON, nullable=True)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    provider_mailbox_id = Column(String(255), nullable=True)
    provider_mailbox_name = Column(String(255), nullable=True)
    sync_cursor = Column(Text, nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")
    messages = relationship("MailMessage", back_populates="connection")


class MailMessage(Base):
    __tablename__ = "mail_messages"
    __table_args__ = (
        UniqueConstraint("tenant_id", "connection_id", "provider_message_id", name="uq_mail_messages_provider_message"),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    owner_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    connection_id = Column(BigInteger, ForeignKey("user_mail_connections.id", ondelete="SET NULL"), nullable=True, index=True)
    provider = Column(String(20), nullable=True, index=True)
    provider_message_id = Column(String(255), nullable=True, index=True)
    provider_thread_id = Column(String(255), nullable=True, index=True)
    direction = Column(String(20), nullable=False, server_default="inbound", index=True)
    folder = Column(String(80), nullable=False, server_default="inbox", index=True)
    from_email = Column(String(255), nullable=True, index=True)
    from_name = Column(String(255), nullable=True)
    to_recipients = Column(JSON, nullable=True)
    cc_recipients = Column(JSON, nullable=True)
    bcc_recipients = Column(JSON, nullable=True)
    subject = Column(String(500), nullable=True, index=True)
    snippet = Column(Text, nullable=True)
    body_text = Column(Text, nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True, index=True)
    sent_at = Column(DateTime(timezone=True), nullable=True, index=True)
    source_module_key = Column(String(100), nullable=True, index=True)
    source_entity_id = Column(String(100), nullable=True, index=True)
    source_label = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    owner = relationship("User", foreign_keys=[owner_user_id])
    connection = relationship("UserMailConnection", back_populates="messages")
