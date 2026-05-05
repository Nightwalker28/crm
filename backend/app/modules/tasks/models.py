from sqlalchemy import BigInteger, CheckConstraint, Column, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
from sqlalchemy.orm import relationship

from app.core.database import Base


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(
            "status IN ('todo', 'in_progress', 'blocked', 'completed')",
            name="ck_tasks_status",
        ),
        CheckConstraint(
            "priority IN ('high', 'medium', 'low')",
            name="ck_tasks_priority",
        ),
        Index("ix_tasks_active_tenant", "tenant_id", postgresql_where=text("deleted_at IS NULL")),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    status = Column(String(32), nullable=False, server_default="todo", index=True)
    priority = Column(String(32), nullable=False, server_default="medium", index=True)
    start_at = Column(DateTime(timezone=True), nullable=True)
    due_at = Column(DateTime(timezone=True), nullable=True, index=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    source_module_key = Column(String(100), nullable=True, index=True)
    source_entity_id = Column(String(100), nullable=True, index=True)
    source_label = Column(String(255), nullable=True)
    created_by_user_id = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    updated_by_user_id = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assigned_by_user_id = Column(
        BigInteger,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    assigned_at = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    creator = relationship("User", foreign_keys=[created_by_user_id], lazy="joined")
    updated_by = relationship("User", foreign_keys=[updated_by_user_id], lazy="joined")
    assigned_by = relationship("User", foreign_keys=[assigned_by_user_id], lazy="joined")
    assignees = relationship(
        "TaskAssignee",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class TaskAssignee(Base):
    __tablename__ = "task_assignees"
    __table_args__ = (
        UniqueConstraint("tenant_id", "task_id", "assignee_key", name="uq_task_assignees_task_key"),
    )

    id = Column(BigInteger, primary_key=True, index=True, autoincrement=True)
    tenant_id = Column(
        BigInteger,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    task_id = Column(
        BigInteger,
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assignee_type = Column(String(20), nullable=False, index=True)
    assignee_key = Column(String(64), nullable=False, index=True)
    user_id = Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    team_id = Column(BigInteger, ForeignKey("teams.id", ondelete="CASCADE"), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    task = relationship("Task", back_populates="assignees")
    user = relationship("User", lazy="joined")
    team = relationship("Team", lazy="joined")

    @property
    def label(self) -> str:
        if self.assignee_type == "user" and self.user:
            full_name = " ".join(
                part for part in [self.user.first_name, self.user.last_name] if part
            ).strip()
            return full_name or self.user.email or f"User {self.user_id}"
        if self.assignee_type == "team" and self.team:
            return self.team.name
        return self.assignee_key
