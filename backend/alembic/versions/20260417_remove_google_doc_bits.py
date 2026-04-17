"""remove unused google docs and token storage

Revision ID: 20260417_remove_google_doc_bits
Revises: 20260417_team_module_access
Create Date: 2026-04-17
"""

from alembic import op


revision = "20260417_remove_google_doc_bits"
down_revision = "20260417_team_module_access"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS user_google_tokens")


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS user_google_tokens (
            id BIGINT PRIMARY KEY,
            user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            access_token_enc TEXT NOT NULL,
            refresh_token_enc TEXT NULL,
            scopes TEXT NULL,
            token_type VARCHAR(50) NULL,
            expires_at TIMESTAMP NULL,
            created_at TIMESTAMP NULL,
            updated_at TIMESTAMP NULL
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS ix_user_google_tokens_id ON user_google_tokens (id)")
