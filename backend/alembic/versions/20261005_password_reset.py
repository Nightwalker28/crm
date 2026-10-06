"""Password reset and session revocation (13 F0.7 B3).

`user_setup_tokens.purpose` tells an invite link ("setup") from a forgot-password link
("reset"); existing rows are invites. `users.sessions_revoked_at` lets a password change
refuse access tokens issued before it.

Revision ID: 20261005_password_reset
Revises: 20261004_invoice_line_tenant
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20261005_password_reset"
down_revision: Union[str, None] = "20261004_invoice_line_tenant"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "user_setup_tokens",
        sa.Column("purpose", sa.String(length=16), nullable=False, server_default="setup"),
    )
    op.add_column("users", sa.Column("sessions_revoked_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "sessions_revoked_at")
    op.drop_column("user_setup_tokens", "purpose")
