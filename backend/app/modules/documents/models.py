from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class Document(Base):
    __tablename__ = "documents"

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


class DocumentLink(Base):
    __tablename__ = "document_links"
    __table_args__ = (
        UniqueConstraint("tenant_id", "document_id", "module_key", "entity_id", name="uq_document_links_document_record"),
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
