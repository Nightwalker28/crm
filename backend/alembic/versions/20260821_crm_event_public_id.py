"""add crm_events.public_id, the event identity webhooks will expose

Revision ID: 20260821_crm_event_public_id
Revises: 20260820_call_logs
Create Date: 2026-09-30

08-webhooks-events.md Phase 1. The internal primary key is sequential and shared across
tenants, so sending it outside would reveal platform-wide event volume. A random public
ID is additive: internal consumers (automations, Slack/Teams alerts, the admin history)
keep using `id`.

No backfill. Existing events predate every webhook subscription, so none of them can be
delivered, and giving them identities would rewrite the whole table for nothing. New rows
get a UUID from the ORM default.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260821_crm_event_public_id"
down_revision: Union[str, None] = "20260820_call_logs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("crm_events", sa.Column("public_id", sa.String(length=36), nullable=True))
    op.create_index("ix_crm_events_public_id", "crm_events", ["public_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_crm_events_public_id", table_name="crm_events")
    op.drop_column("crm_events", "public_id")
