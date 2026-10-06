"""add call_logs, the provider-neutral call record

Revision ID: 20260820_call_logs
Revises: 20260819_drop_stage_check
Create Date: 2026-09-30

07-telephony.md Phase 1. A new table only: nothing existing is read, moved or relabelled.
Calls logged before this through the Timeline's Call follow-up stay `record_follow_ups`
rows with `channel = 'call'`; they carry no outcome, direction or duration, so turning
them into call logs would invent facts (07 §15).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260820_call_logs"
down_revision: Union[str, None] = "20260819_drop_stage_check"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "call_logs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("source_module_key", sa.String(length=100), nullable=False),
        sa.Column("source_entity_id", sa.String(length=100), nullable=False),
        sa.Column("contact_id", sa.BigInteger(), nullable=True),
        sa.Column("capture", sa.String(length=20), server_default="manual", nullable=False),
        sa.Column("direction", sa.String(length=20), nullable=False),
        sa.Column("outcome", sa.String(length=30), nullable=False),
        sa.Column("phone_number", sa.String(length=64), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("follow_up_task_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("capture IN ('manual')", name="ck_call_logs_capture"),
        sa.CheckConstraint("direction IN ('outbound', 'inbound')", name="ck_call_logs_direction"),
        sa.CheckConstraint(
            "outcome IN ('connected', 'left_voicemail', 'left_message', 'no_answer', 'busy', 'wrong_number')",
            name="ck_call_logs_outcome",
        ),
        sa.CheckConstraint("duration_seconds IS NULL OR duration_seconds >= 0", name="ck_call_logs_duration"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["contact_id"], ["sales_contacts.contact_id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_call_logs_id", "call_logs", ["id"], unique=False)
    op.create_index("ix_call_logs_tenant_id", "call_logs", ["tenant_id"], unique=False)
    op.create_index("ix_call_logs_actor_user_id", "call_logs", ["actor_user_id"], unique=False)
    op.create_index("ix_call_logs_follow_up_task_id", "call_logs", ["follow_up_task_id"], unique=False)
    # The Activity adapter's two lookups: calls logged on a record, and calls naming a
    # contact. Both end in the keyset order (occurred_at, id).
    op.create_index(
        "ix_call_logs_tenant_source",
        "call_logs",
        ["tenant_id", "source_module_key", "source_entity_id", "occurred_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_call_logs_tenant_contact",
        "call_logs",
        ["tenant_id", "contact_id", "occurred_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_call_logs_tenant_contact", table_name="call_logs")
    op.drop_index("ix_call_logs_tenant_source", table_name="call_logs")
    op.drop_index("ix_call_logs_follow_up_task_id", table_name="call_logs")
    op.drop_index("ix_call_logs_actor_user_id", table_name="call_logs")
    op.drop_index("ix_call_logs_tenant_id", table_name="call_logs")
    op.drop_index("ix_call_logs_id", table_name="call_logs")
    op.drop_table("call_logs")
