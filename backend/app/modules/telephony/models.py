from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.orm import relationship

from app.core.database import Base


# How the row came to exist. `manual` is the only capture today (07 Phase 1): an operator
# reported a call that happened outside Lynk — dialled through `tel:`, from a desk phone
# or a mobile. A provider phase (07 Phase 3) adds its own capture value and the provider
# identity columns beside it; it never rewrites a manual row.
CALL_CAPTURES = ("manual",)
CALL_DIRECTIONS = ("outbound", "inbound")
# HubSpot's default call outcomes, the set operators already know.
CALL_OUTCOMES = ("connected", "left_voicemail", "left_message", "no_answer", "busy", "wrong_number")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class CallLog(Base):
    """One call, as the CRM knows it. Provider-neutral: no provider appears in its name.

    A manual row is what the operator reported — direction, outcome, when, how long,
    who was on the line — and nothing more. Lynk did not place it, hear it or time it,
    so nothing on the row claims it did.

    Linkage is explicit, as every Activity source's is (02). ``source_module_key`` /
    ``source_entity_id`` is the record the call was logged on; ``contact_id`` is the
    person spoken with when the operator named one, so the call also lands on that
    contact's own Timeline. Neither is ever inferred from a phone number.
    """

    __tablename__ = "call_logs"
    __table_args__ = (
        CheckConstraint(_in("capture", CALL_CAPTURES), name="ck_call_logs_capture"),
        CheckConstraint(_in("direction", CALL_DIRECTIONS), name="ck_call_logs_direction"),
        CheckConstraint(_in("outcome", CALL_OUTCOMES), name="ck_call_logs_outcome"),
        CheckConstraint("duration_seconds IS NULL OR duration_seconds >= 0", name="ck_call_logs_duration"),
        Index(
            "ix_call_logs_tenant_source",
            "tenant_id",
            "source_module_key",
            "source_entity_id",
            "occurred_at",
            "id",
        ),
        Index("ix_call_logs_tenant_contact", "tenant_id", "contact_id", "occurred_at", "id"),
    )

    id = Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(BigInteger, ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True)
    actor_user_id = Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    source_module_key = Column(String(100), nullable=False)
    source_entity_id = Column(String(100), nullable=False)
    contact_id = Column(BigInteger, ForeignKey("sales_contacts.contact_id", ondelete="SET NULL"), nullable=True)
    capture = Column(String(20), nullable=False, server_default="manual")
    direction = Column(String(20), nullable=False)
    outcome = Column(String(30), nullable=False)
    # The number on file for whoever was called, copied when the call was logged. Stored
    # as the record holds it: nothing dials it and nothing matches on it in this phase.
    phone_number = Column(String(64), nullable=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    duration_seconds = Column(Integer, nullable=True)
    note = Column(Text, nullable=True)
    # A soft reference, like `record_follow_ups.follow_up_task_id`.
    follow_up_task_id = Column(BigInteger, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    actor = relationship("User")
    contact = relationship("SalesContact")
