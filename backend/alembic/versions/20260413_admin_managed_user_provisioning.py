"""Add admin-managed auth mode and setup tokens"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260413_user_provisioning"
down_revision = "20260411_pg_search"
branch_labels = None
depends_on = None


user_auth_mode = sa.Enum("manual_only", "manual_or_google", name="user_auth_mode")


def upgrade() -> None:
    bind = op.get_bind()
    user_auth_mode.create(bind, checkfirst=True)

    op.add_column(
        "users",
        sa.Column(
            "auth_mode",
            user_auth_mode,
            nullable=False,
            server_default="manual_or_google",
        ),
    )

    op.create_table(
        "user_setup_tokens",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_setup_tokens_token_hash"), "user_setup_tokens", ["token_hash"], unique=True)
    op.create_index(op.f("ix_user_setup_tokens_user_id"), "user_setup_tokens", ["user_id"], unique=False)

    op.execute("UPDATE users SET is_active = 'inactive' WHERE is_active = 'pending'")
    op.alter_column("users", "is_active", server_default="inactive")


def downgrade() -> None:
    op.drop_index(op.f("ix_user_setup_tokens_user_id"), table_name="user_setup_tokens")
    op.drop_index(op.f("ix_user_setup_tokens_token_hash"), table_name="user_setup_tokens")
    op.drop_table("user_setup_tokens")
    op.alter_column("users", "is_active", server_default="pending")
    op.drop_column("users", "auth_mode")
    user_auth_mode.drop(op.get_bind(), checkfirst=True)
