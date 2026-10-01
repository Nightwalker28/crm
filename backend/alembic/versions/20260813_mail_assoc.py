"""add explicit CRM record associations for mail messages

Revision ID: 20260813_mail_assoc
Revises: 20260812_record_activity
Create Date: 2026-08-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260813_mail_assoc"
down_revision: Union[str, None] = "20260812_record_activity"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _backfill_primary_associations() -> None:
    """Promote the existing single link to a `primary` association row.

    ``mail_messages.source_module_key`` / ``source_entity_id`` were only ever
    written by an explicit link action or by sending from a record, so every
    populated pair is deterministic evidence of a deliberate link. Nothing is
    matched on sender address here, and rows without a stored link stay
    unlinked.

    The mirror columns are left in place: they remain the denormalized primary
    for inbox rendering and search.
    """

    op.execute(
        sa.text(
            """
            INSERT INTO mail_record_associations
                (tenant_id, message_id, module_key, entity_id, association_type,
                 record_label, created_by_user_id, created_at)
            SELECT tenant_id, id, source_module_key, source_entity_id, 'primary',
                   source_label, owner_user_id, created_at
            FROM mail_messages
            WHERE source_module_key IS NOT NULL
              AND source_module_key <> ''
              AND source_entity_id IS NOT NULL
              AND source_entity_id <> ''
            """
        )
    )


def upgrade() -> None:
    op.create_table(
        "mail_record_associations",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("message_id", sa.BigInteger(), nullable=False),
        sa.Column("module_key", sa.String(length=100), nullable=False),
        sa.Column("entity_id", sa.String(length=100), nullable=False),
        sa.Column("association_type", sa.String(length=20), server_default="related", nullable=False),
        sa.Column("record_label", sa.String(length=255), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "association_type IN ('primary', 'related')",
            name="ck_mail_record_associations_type",
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["mail_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint(
            "tenant_id",
            "message_id",
            "module_key",
            "entity_id",
            name="uq_mail_record_associations_link",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mail_record_associations_id", "mail_record_associations", ["id"], unique=False)
    op.create_index("ix_mail_record_associations_tenant_id", "mail_record_associations", ["tenant_id"], unique=False)
    op.create_index("ix_mail_record_associations_message_id", "mail_record_associations", ["message_id"], unique=False)
    op.create_index(
        "ix_mail_record_associations_created_by_user_id",
        "mail_record_associations",
        ["created_by_user_id"],
        unique=False,
    )
    op.create_index(
        "ix_mail_record_associations_record",
        "mail_record_associations",
        ["tenant_id", "module_key", "entity_id", "message_id"],
        unique=False,
    )
    # At most one primary per message, enforced in the database so concurrent
    # link calls cannot leave a message with two contextual records.
    op.create_index(
        "uq_mail_record_associations_primary",
        "mail_record_associations",
        ["tenant_id", "message_id"],
        unique=True,
        postgresql_where=sa.text("association_type = 'primary'"),
        sqlite_where=sa.text("association_type = 'primary'"),
    )

    _backfill_primary_associations()

    # Record -> message lookup now runs through mail_record_associations, which
    # carries its own covering index, so the source-column index added for the
    # activity projection has no remaining reader.
    op.drop_index("ix_mail_messages_tenant_source", table_name="mail_messages")
    op.create_index(
        "ix_mail_messages_connection_thread",
        "mail_messages",
        ["tenant_id", "connection_id", "provider_thread_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_mail_messages_connection_thread", table_name="mail_messages")
    op.create_index(
        "ix_mail_messages_tenant_source",
        "mail_messages",
        ["tenant_id", "source_module_key", "source_entity_id", "id"],
        unique=False,
    )

    # The mirror columns on mail_messages still hold every primary link, so
    # dropping this table loses only the additional `related` associations —
    # links that had no representation before this revision.
    op.drop_index("uq_mail_record_associations_primary", table_name="mail_record_associations")
    op.drop_index("ix_mail_record_associations_record", table_name="mail_record_associations")
    op.drop_index("ix_mail_record_associations_created_by_user_id", table_name="mail_record_associations")
    op.drop_index("ix_mail_record_associations_message_id", table_name="mail_record_associations")
    op.drop_index("ix_mail_record_associations_tenant_id", table_name="mail_record_associations")
    op.drop_index("ix_mail_record_associations_id", table_name="mail_record_associations")
    op.drop_table("mail_record_associations")
