from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
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
    access_token_key_version = Column(String(32), nullable=True)
    refresh_token = Column(Text, nullable=True)
    refresh_token_key_version = Column(String(32), nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    provider_mailbox_id = Column(String(255), nullable=True)
    provider_mailbox_name = Column(String(255), nullable=True)
    imap_host = Column(String(255), nullable=True)
    imap_port = Column(BigInteger, nullable=True)
    imap_security = Column(String(20), nullable=True)
    imap_username = Column(String(255), nullable=True)
    smtp_host = Column(String(255), nullable=True)
    smtp_port = Column(BigInteger, nullable=True)
    smtp_security = Column(String(20), nullable=True)
    smtp_username = Column(String(255), nullable=True)
    encrypted_password = Column(Text, nullable=True)
    encrypted_password_key_version = Column(String(32), nullable=True)
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
        # Thread lookup for association propagation. Provider thread ids are
        # only unique inside one mailbox, so the connection is part of the key.
        Index(
            "ix_mail_messages_connection_thread",
            "tenant_id",
            "connection_id",
            "provider_thread_id",
        ),
        # The duplicate-send guard. An outbound send claims its row under this
        # key before the provider is called, so a retry of the same compose
        # attempt finds the claim instead of sending a second message.
        Index(
            "uq_mail_messages_idempotency",
            "tenant_id",
            "owner_user_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
            sqlite_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    # SQLite only autoincrements INTEGER primary keys; the variant keeps the
    # PostgreSQL column a BIGINT while letting tests insert without an id.
    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
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
    # Outbound send lifecycle: `sending` (claimed, provider call in progress),
    # `sent`, or `failed`. Inbound messages leave it NULL — they were never
    # sent from here, and a synced message has no send outcome to report.
    send_status = Column(String(20), nullable=True, index=True)
    send_error_code = Column(String(40), nullable=True)
    send_error_detail = Column(Text, nullable=True)
    idempotency_key = Column(String(64), nullable=True)
    # Template provenance only. The body is composed and edited by the user;
    # this records which template it started from.
    template_id = Column(BigInteger, ForeignKey("message_templates.id", ondelete="SET NULL"), nullable=True, index=True)
    # Attachment manifest (document id, filename, content type, size). File
    # bytes stay in the documents module; this never stores content.
    attachments = Column(JSON, nullable=True)
    # Denormalized mirror of the `primary` row in `mail_record_associations`.
    # `MailRecordAssociation` is the authoritative link set; these columns keep
    # the primary contextual record available to inbox rendering and search
    # without a join. Write them only through the mail association service.
    source_module_key = Column(String(100), nullable=True, index=True)
    source_entity_id = Column(String(100), nullable=True, index=True)
    source_label = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    owner = relationship("User", foreign_keys=[owner_user_id])
    connection = relationship("UserMailConnection", back_populates="messages")
    associations = relationship(
        "MailRecordAssociation",
        back_populates="message",
        cascade="all, delete-orphan",
    )


class MailRecordAssociation(Base):
    """Explicit CRM linkage between one mail message and one CRM record.

    A message can carry several associations (for example a Contact and the
    Opportunity it belongs to). Exactly one of them may be ``primary`` — the
    contextual record the message was sent from, or the record a user
    designated as its home. Everything else is ``related``.

    Every row is created deliberately: by sending with record context, or by an
    explicit link action. Nothing here is inferred from sender addresses, and
    the projection in ``platform/services/record_activity.py`` only reads what
    this table already states.
    """

    __tablename__ = "mail_record_associations"
    __table_args__ = (
        # One link per (message, record). Re-linking is idempotent rather than
        # duplicated, which keeps the record feed free of repeated messages.
        UniqueConstraint(
            "tenant_id",
            "message_id",
            "module_key",
            "entity_id",
            name="uq_mail_record_associations_link",
        ),
        # At most one primary per message, enforced in the database so a race
        # between two link calls cannot leave two primaries behind.
        Index(
            "uq_mail_record_associations_primary",
            "tenant_id",
            "message_id",
            unique=True,
            postgresql_where=text("association_type = 'primary'"),
            sqlite_where=text("association_type = 'primary'"),
        ),
        # Record -> messages lookup for the activity projection and the
        # record-scoped mail reads that build on it.
        Index(
            "ix_mail_record_associations_record",
            "tenant_id",
            "module_key",
            "entity_id",
            "message_id",
        ),
        CheckConstraint(
            "association_type IN ('primary', 'related')",
            name="ck_mail_record_associations_type",
        ),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id = Column(BigInteger, ForeignKey("mail_messages.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False)
    entity_id = Column(String(100), nullable=False)
    association_type = Column(String(20), nullable=False, server_default="related")
    record_label = Column(String(255), nullable=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    message = relationship("MailMessage", back_populates="associations")
    created_by = relationship("User", foreign_keys=[created_by_user_id])
