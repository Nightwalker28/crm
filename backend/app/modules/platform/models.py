from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, JSON, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(BigInteger, primary_key=True, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    module_key = Column(String(100), nullable=False, index=True)
    entity_type = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=False, index=True)
    action = Column(String(100), nullable=False, index=True)
    description = Column(Text, nullable=True)
    before_state = Column(JSON, nullable=True)
    after_state = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    actor = relationship("User")
