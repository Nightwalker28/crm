"""record outbound send state, idempotency, template and attachments on mail messages

Revision ID: 20260814_mail_send
Revises: 20260813_mail_assoc
Create Date: 2026-08-14
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260814_mail_send"
down_revision: Union[str, None] = "20260813_mail_assoc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("mail_messages", sa.Column("send_status", sa.String(length=20), nullable=True))
    op.add_column("mail_messages", sa.Column("send_error_code", sa.String(length=40), nullable=True))
    op.add_column("mail_messages", sa.Column("send_error_detail", sa.Text(), nullable=True))
    op.add_column("mail_messages", sa.Column("idempotency_key", sa.String(length=64), nullable=True))
    op.add_column("mail_messages", sa.Column("template_id", sa.BigInteger(), nullable=True))
    op.add_column("mail_messages", sa.Column("attachments", sa.JSON(), nullable=True))

    # Deterministic backfill. Every pre-existing outbound row was only written
    # after its provider call returned, so `sent` is the true outcome. Inbound
    # and synced rows keep NULL: they have no send outcome to report, and
    # stamping one would invent history.
    op.execute(sa.text("UPDATE mail_messages SET send_status = 'sent' WHERE direction = 'outbound'"))

    op.create_foreign_key(
        "fk_mail_messages_template_id",
        "mail_messages",
        "message_templates",
        ["template_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_mail_messages_send_status", "mail_messages", ["send_status"], unique=False)
    op.create_index("ix_mail_messages_template_id", "mail_messages", ["template_id"], unique=False)
    # Partial unique index: the duplicate-send guard applies only to rows that
    # claimed a key, so historical rows and synced inbound mail are unaffected.
    op.create_index(
        "uq_mail_messages_idempotency",
        "mail_messages",
        ["tenant_id", "owner_user_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
        sqlite_where=sa.text("idempotency_key IS NOT NULL"),
    )


def downgrade() -> None:
    # Send state, template provenance, and the attachment manifest are dropped
    # with these columns; the messages, their provider ids, and their record
    # associations all survive.
    op.drop_index("uq_mail_messages_idempotency", table_name="mail_messages")
    op.drop_index("ix_mail_messages_template_id", table_name="mail_messages")
    op.drop_index("ix_mail_messages_send_status", table_name="mail_messages")
    op.drop_constraint("fk_mail_messages_template_id", "mail_messages", type_="foreignkey")
    op.drop_column("mail_messages", "attachments")
    op.drop_column("mail_messages", "template_id")
    op.drop_column("mail_messages", "idempotency_key")
    op.drop_column("mail_messages", "send_error_detail")
    op.drop_column("mail_messages", "send_error_code")
    op.drop_column("mail_messages", "send_status")
