"""add module import duplicate mode

Revision ID: 20260418_import_duplicate_mode
Revises: 20260417_team_module_access
Create Date: 2026-04-18
"""

from alembic import op
import sqlalchemy as sa


revision = "20260418_import_duplicate_mode"
down_revision = "20260417_remove_google_doc_bits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "modules",
        sa.Column("import_duplicate_mode", sa.String(length=20), nullable=False, server_default="skip"),
    )


def downgrade() -> None:
    op.drop_column("modules", "import_duplicate_mode")
