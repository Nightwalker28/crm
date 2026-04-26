"""Use bigint primary key for user setup tokens

Revision ID: 20260427_setup_token_bigint
Revises: 20260423_mail_user_connect
Create Date: 2026-04-27 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = "20260427_setup_token_bigint"
down_revision = "20260423_mail_user_connect"
branch_labels = None
depends_on = None


TABLE_NAME = "user_setup_tokens"
SEQUENCE_NAME = "user_setup_tokens_id_seq"


def _id_column(bind):
    inspector = sa.inspect(bind)
    if not inspector.has_table(TABLE_NAME):
        return None

    for column in inspector.get_columns(TABLE_NAME):
        if column["name"] == "id":
            return column

    return None


def _primary_key_name(bind):
    pk = sa.inspect(bind).get_pk_constraint(TABLE_NAME)
    return pk.get("name") if pk else None


def _has_index(bind, index_name: str) -> bool:
    return any(index["name"] == index_name for index in sa.inspect(bind).get_indexes(TABLE_NAME))


def upgrade() -> None:
    bind = op.get_bind()
    id_column = _id_column(bind)
    if id_column is None or isinstance(id_column["type"], sa.BigInteger):
        if id_column is not None and not _has_index(bind, "ix_user_setup_tokens_id"):
            op.create_index(op.f("ix_user_setup_tokens_id"), TABLE_NAME, ["id"], unique=False)
        return

    pk_name = _primary_key_name(bind)
    if pk_name:
        op.drop_constraint(pk_name, TABLE_NAME, type_="primary")

    op.add_column(TABLE_NAME, sa.Column("id_bigint", sa.BigInteger(), nullable=True))

    if bind.dialect.name == "postgresql":
        op.execute(f'CREATE SEQUENCE IF NOT EXISTS "{SEQUENCE_NAME}"')
        op.execute(
            """
            WITH numbered AS (
                SELECT
                    ctid,
                    row_number() OVER (ORDER BY created_at, token_hash) AS new_id
                FROM user_setup_tokens
            )
            UPDATE user_setup_tokens AS token
            SET id_bigint = numbered.new_id
            FROM numbered
            WHERE token.ctid = numbered.ctid
            """
        )
        op.execute(
            """
            SELECT setval(
                'user_setup_tokens_id_seq',
                COALESCE((SELECT MAX(id_bigint) FROM user_setup_tokens), 0) + 1,
                false
            )
            """
        )
    else:
        op.execute("UPDATE user_setup_tokens SET id_bigint = rowid")

    op.alter_column(TABLE_NAME, "id_bigint", nullable=False, existing_type=sa.BigInteger())
    op.drop_column(TABLE_NAME, "id")
    op.alter_column(
        TABLE_NAME,
        "id_bigint",
        new_column_name="id",
        existing_type=sa.BigInteger(),
        nullable=False,
    )

    if bind.dialect.name == "postgresql":
        op.alter_column(
            TABLE_NAME,
            "id",
            existing_type=sa.BigInteger(),
            server_default=sa.text("nextval('user_setup_tokens_id_seq'::regclass)"),
        )
        op.execute('ALTER SEQUENCE "user_setup_tokens_id_seq" OWNED BY user_setup_tokens.id')

    op.create_primary_key(op.f("pk_user_setup_tokens"), TABLE_NAME, ["id"])
    op.create_index(op.f("ix_user_setup_tokens_id"), TABLE_NAME, ["id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    id_column = _id_column(bind)
    if id_column is None or isinstance(id_column["type"], sa.String):
        return

    if _has_index(bind, "ix_user_setup_tokens_id"):
        op.drop_index(op.f("ix_user_setup_tokens_id"), table_name=TABLE_NAME)

    pk_name = _primary_key_name(bind)
    if pk_name:
        op.drop_constraint(pk_name, TABLE_NAME, type_="primary")

    if bind.dialect.name == "postgresql":
        op.alter_column(
            TABLE_NAME,
            "id",
            existing_type=sa.BigInteger(),
            server_default=None,
        )

    op.add_column(TABLE_NAME, sa.Column("id_string", sa.String(length=36), nullable=True))
    op.execute("UPDATE user_setup_tokens SET id_string = CAST(id AS VARCHAR(36))")
    op.alter_column(TABLE_NAME, "id_string", nullable=False, existing_type=sa.String(length=36))
    op.drop_column(TABLE_NAME, "id")
    op.alter_column(
        TABLE_NAME,
        "id_string",
        new_column_name="id",
        existing_type=sa.String(length=36),
        nullable=False,
    )
    op.create_primary_key(op.f("pk_user_setup_tokens"), TABLE_NAME, ["id"])

    if bind.dialect.name == "postgresql":
        op.execute(f'DROP SEQUENCE IF EXISTS "{SEQUENCE_NAME}"')
