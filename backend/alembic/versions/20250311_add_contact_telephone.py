"""Add contact telephone to sales contacts"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20250311_add_contact_telephone"
down_revision = "20250217_sales_opps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sales_contacts", sa.Column("contact_telephone", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("sales_contacts", "contact_telephone")
