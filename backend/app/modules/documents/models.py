from sqlalchemy import JSON, BigInteger, Column, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship

from app.core.database import Base


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    uploaded_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    title = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    original_filename = Column(String(255), nullable=False)
    content_type = Column(String(120), nullable=False)
    extension = Column(String(20), nullable=False, index=True)
    file_size_bytes = Column(BigInteger, nullable=False)
    storage_provider = Column(String(40), nullable=False, default="local", server_default="local", index=True)
    storage_path = Column(Text, nullable=False, unique=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    uploaded_by = relationship("User")
    links = relationship("DocumentLink", back_populates="document", cascade="all, delete-orphan")


class DocumentStorageConnection(Base):
    __tablename__ = "document_storage_connections"
    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "provider", name="uq_document_storage_connections_user_provider"),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider = Column(String(40), nullable=False, index=True)
    status = Column(String(20), nullable=False, server_default="connected", index=True)
    account_email = Column(String(255), nullable=True)
    scopes = Column(JSON, nullable=True)
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    provider_root_id = Column(String(255), nullable=True)
    provider_root_name = Column(String(255), nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    user = relationship("User")


class DocumentLink(Base):
    __tablename__ = "document_links"
    __table_args__ = (
        UniqueConstraint("tenant_id", "document_id", "module_key", "entity_id", name="uq_document_links_document_record"),
        Index("ix_document_links_module_entity", "module_key", "entity_id"),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id = Column(BigInteger, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    created_by_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    document = relationship("Document", back_populates="links")
    created_by = relationship("User")
