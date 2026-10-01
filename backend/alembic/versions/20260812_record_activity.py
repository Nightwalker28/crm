"""add record follow-ups and record-activity projection indexes

Revision ID: 20260812_record_activity
Revises: 20260810_record_layouts
Create Date: 2026-08-12
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260812_record_activity"
down_revision: Union[str, None] = "20260810_record_layouts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


VALID_CHANNELS = ("whatsapp", "email", "call")


def _backfill_follow_ups() -> None:
    """Copy logged follow-up outcomes out of the audit store.

    ``activity_logs`` rows are left untouched: they remain the audit record of
    the change. This only seeds the interaction table so existing history is
    visible in the relationship feed instead of being reconstructed from audit.
    """

    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            """
            SELECT id, tenant_id, actor_user_id, module_key, entity_id, action,
                   after_state, created_at
            FROM activity_logs
            WHERE action LIKE 'follow\\_up.%' ESCAPE '\\'
            ORDER BY id
            """
        )
    ).mappings()

    insert = sa.text(
        """
        INSERT INTO record_follow_ups
            (tenant_id, actor_user_id, module_key, entity_id, channel, note,
             follow_up_task_id, occurred_at, created_at)
        VALUES
            (:tenant_id, :actor_user_id, :module_key, :entity_id, :channel, :note,
             NULL, :occurred_at, :occurred_at)
        """
    )

    batch: list[dict] = []
    for row in rows:
        channel = row["action"].split(".", 1)[1]
        if channel not in VALID_CHANNELS:
            continue
        after_state = row["after_state"]
        note = after_state.get("note") if isinstance(after_state, dict) else None
        batch.append(
            {
                "tenant_id": row["tenant_id"],
                "actor_user_id": row["actor_user_id"],
                "module_key": row["module_key"],
                "entity_id": str(row["entity_id"]),
                "channel": channel,
                "note": note,
                "occurred_at": row["created_at"],
            }
        )
        if len(batch) >= 500:
            bind.execute(insert, batch)
            batch = []
    if batch:
        bind.execute(insert, batch)


def upgrade() -> None:
    op.create_table(
        "record_follow_ups",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=False),
        sa.Column("channel", sa.String(length=20), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("follow_up_task_id", sa.BigInteger(), nullable=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "channel IN ('whatsapp', 'email', 'call')",
            name="ck_record_follow_ups_channel",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_record_follow_ups_id", "record_follow_ups", ["id"], unique=False)
    op.create_index("ix_record_follow_ups_tenant_id", "record_follow_ups", ["tenant_id"], unique=False)
    op.create_index("ix_record_follow_ups_actor_user_id", "record_follow_ups", ["actor_user_id"], unique=False)
    op.create_index("ix_record_follow_ups_module_key", "record_follow_ups", ["module_key"], unique=False)
    op.create_index("ix_record_follow_ups_entity_id", "record_follow_ups", ["entity_id"], unique=False)
    op.create_index("ix_record_follow_ups_channel", "record_follow_ups", ["channel"], unique=False)
    op.create_index("ix_record_follow_ups_follow_up_task_id", "record_follow_ups", ["follow_up_task_id"], unique=False)
    op.create_index("ix_record_follow_ups_occurred_at", "record_follow_ups", ["occurred_at"], unique=False)
    op.create_index(
        "ix_record_follow_ups_tenant_record",
        "record_follow_ups",
        ["tenant_id", "module_key", "entity_id", "occurred_at", "id"],
        unique=False,
    )

    _backfill_follow_ups()

    op.create_index(
        "ix_record_comments_tenant_record",
        "record_comments",
        ["tenant_id", "module_key", "entity_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_tasks_tenant_source",
        "tasks",
        ["tenant_id", "source_module_key", "source_entity_id", "created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_calendar_events_tenant_source",
        "calendar_events",
        ["tenant_id", "source_module_key", "source_entity_id", "start_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_mail_messages_tenant_source",
        "mail_messages",
        ["tenant_id", "source_module_key", "source_entity_id", "id"],
        unique=False,
    )
    op.create_index(
        "ix_whatsapp_interactions_tenant_source",
        "whatsapp_interactions",
        ["tenant_id", "source_module_key", "source_entity_id", "sent_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_whatsapp_interactions_tenant_source", table_name="whatsapp_interactions")
    op.drop_index("ix_mail_messages_tenant_source", table_name="mail_messages")
    op.drop_index("ix_calendar_events_tenant_source", table_name="calendar_events")
    op.drop_index("ix_tasks_tenant_source", table_name="tasks")
    op.drop_index("ix_record_comments_tenant_record", table_name="record_comments")

    # Dropping record_follow_ups discards notes captured after the backfill.
    # The paired activity_logs rows survive, so the audit trail is not lost.
    op.drop_index("ix_record_follow_ups_tenant_record", table_name="record_follow_ups")
    op.drop_index("ix_record_follow_ups_occurred_at", table_name="record_follow_ups")
    op.drop_index("ix_record_follow_ups_follow_up_task_id", table_name="record_follow_ups")
    op.drop_index("ix_record_follow_ups_channel", table_name="record_follow_ups")
    op.drop_index("ix_record_follow_ups_entity_id", table_name="record_follow_ups")
    op.drop_index("ix_record_follow_ups_module_key", table_name="record_follow_ups")
    op.drop_index("ix_record_follow_ups_actor_user_id", table_name="record_follow_ups")
    op.drop_index("ix_record_follow_ups_tenant_id", table_name="record_follow_ups")
    op.drop_index("ix_record_follow_ups_id", table_name="record_follow_ups")
    op.drop_table("record_follow_ups")
