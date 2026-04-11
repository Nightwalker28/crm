"""Add password hash to users"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260411_add_user_password_hash"
down_revision = "20250311_add_contact_telephone"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "password_hash")
