"""Add profile and company fields"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260413_profile_company"
down_revision = "20260413_io_generic_v1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone_number", sa.String(length=50), nullable=True))
    op.add_column("users", sa.Column("job_title", sa.String(length=150), nullable=True))
    op.add_column("users", sa.Column("timezone", sa.String(length=100), nullable=True))
    op.add_column("users", sa.Column("bio", sa.Text(), nullable=True))

    op.create_table(
        "company_profiles",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=150), nullable=False),
        sa.Column("primary_email", sa.String(length=150), nullable=True),
        sa.Column("website", sa.String(length=255), nullable=True),
        sa.Column("primary_phone", sa.String(length=50), nullable=True),
        sa.Column("industry", sa.String(length=120), nullable=True),
        sa.Column("country", sa.String(length=120), nullable=True),
        sa.Column("billing_address", sa.Text(), nullable=True),
        sa.Column("logo_url", sa.String(length=500), nullable=True),
        sa.Column("updated_by", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=True),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_company_profiles_id"), "company_profiles", ["id"], unique=False)

    op.execute(
        """
        INSERT INTO company_profiles (id, name)
        VALUES (1, 'Your Company')
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_company_profiles_id"), table_name="company_profiles")
    op.drop_table("company_profiles")
    op.drop_column("users", "bio")
    op.drop_column("users", "timezone")
    op.drop_column("users", "job_title")
    op.drop_column("users", "phone_number")
