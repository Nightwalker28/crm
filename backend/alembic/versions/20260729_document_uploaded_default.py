"""ensure uploaded document timestamps have a database default

Revision ID: 20260729_doc_uploaded_default
Revises: 20260728_cloud_doc_refs
Create Date: 2026-08-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260729_doc_uploaded_default"
down_revision: Union[str, None] = "20260728_cloud_doc_refs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "documents",
        "uploaded_at",
        existing_type=sa.DateTime(timezone=True),
        server_default=sa.func.now(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "documents",
        "uploaded_at",
        existing_type=sa.DateTime(timezone=True),
        server_default=None,
        existing_nullable=False,
    )
