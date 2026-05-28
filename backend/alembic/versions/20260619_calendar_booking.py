"""add calendar booking links

Revision ID: 20260619_booking_links
Revises: 20260618_forecasting
Create Date: 2026-05-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260619_booking_links"
down_revision: Union[str, None] = "20260618_forecasting"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    if not _table_exists(bind, table_name):
        return False
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "meeting_booking_types"):
        op.create_table(
            "meeting_booking_types",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("owner_id", sa.BigInteger(), nullable=False),
            sa.Column("name", sa.String(length=160), nullable=False),
            sa.Column("slug", sa.String(length=120), nullable=False),
            sa.Column("duration_minutes", sa.Integer(), server_default="30", nullable=False),
            sa.Column("buffer_before_minutes", sa.Integer(), server_default="0", nullable=False),
            sa.Column("buffer_after_minutes", sa.Integer(), server_default="0", nullable=False),
            sa.Column("timezone", sa.String(length=100), server_default="UTC", nullable=False),
            sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("slug", name="uq_meeting_booking_types_slug"),
        )
    if not _table_exists(bind, "meeting_booking_availability"):
        op.create_table(
            "meeting_booking_availability",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("booking_type_id", sa.BigInteger(), nullable=False),
            sa.Column("weekday", sa.Integer(), nullable=False),
            sa.Column("start_time", sa.Time(), nullable=False),
            sa.Column("end_time", sa.Time(), nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.CheckConstraint("weekday >= 0 AND weekday <= 6", name="ck_meeting_booking_availability_weekday"),
            sa.ForeignKeyConstraint(["booking_type_id"], ["meeting_booking_types.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _table_exists(bind, "meeting_booking_questions"):
        op.create_table(
            "meeting_booking_questions",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("booking_type_id", sa.BigInteger(), nullable=False),
            sa.Column("label", sa.String(length=255), nullable=False),
            sa.Column("field_type", sa.String(length=40), server_default="text", nullable=False),
            sa.Column("required", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.ForeignKeyConstraint(["booking_type_id"], ["meeting_booking_types.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _table_exists(bind, "meeting_bookings"):
        op.create_table(
            "meeting_bookings",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("booking_type_id", sa.BigInteger(), nullable=False),
            sa.Column("calendar_event_id", sa.BigInteger(), nullable=True),
            sa.Column("guest_name", sa.String(length=160), nullable=False),
            sa.Column("guest_email", sa.String(length=255), nullable=False),
            sa.Column("guest_note", sa.Text(), nullable=True),
            sa.Column("answers_json", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
            sa.Column("start_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("end_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("timezone", sa.String(length=100), nullable=False),
            sa.Column("status", sa.String(length=30), server_default="confirmed", nullable=False),
            sa.Column("booked_date", sa.Date(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["booking_type_id"], ["meeting_booking_types.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["calendar_event_id"], ["calendar_events.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "booking_type_id", "start_at", name="uq_meeting_bookings_type_start"),
        )

    indexes = [
        ("meeting_booking_types", "ix_meeting_booking_types_id", ["id"]),
        ("meeting_booking_types", "ix_meeting_booking_types_tenant_id", ["tenant_id"]),
        ("meeting_booking_types", "ix_meeting_booking_types_owner_id", ["owner_id"]),
        ("meeting_booking_types", "ix_meeting_booking_types_slug", ["slug"]),
        ("meeting_booking_types", "ix_meeting_booking_types_enabled", ["enabled"]),
        ("meeting_booking_types", "ix_meeting_booking_types_tenant_owner", ["tenant_id", "owner_id"]),
        ("meeting_booking_types", "ix_meeting_booking_types_tenant_enabled", ["tenant_id", "enabled"]),
        ("meeting_booking_availability", "ix_meeting_booking_availability_id", ["id"]),
        ("meeting_booking_availability", "ix_meeting_booking_availability_tenant_id", ["tenant_id"]),
        ("meeting_booking_availability", "ix_meeting_booking_availability_booking_type_id", ["booking_type_id"]),
        ("meeting_booking_availability", "ix_meeting_booking_availability_type_weekday", ["booking_type_id", "weekday"]),
        ("meeting_booking_questions", "ix_meeting_booking_questions_id", ["id"]),
        ("meeting_booking_questions", "ix_meeting_booking_questions_tenant_id", ["tenant_id"]),
        ("meeting_booking_questions", "ix_meeting_booking_questions_booking_type_id", ["booking_type_id"]),
        ("meeting_booking_questions", "ix_meeting_booking_questions_type", ["booking_type_id", "sort_order"]),
        ("meeting_bookings", "ix_meeting_bookings_id", ["id"]),
        ("meeting_bookings", "ix_meeting_bookings_tenant_id", ["tenant_id"]),
        ("meeting_bookings", "ix_meeting_bookings_booking_type_id", ["booking_type_id"]),
        ("meeting_bookings", "ix_meeting_bookings_calendar_event_id", ["calendar_event_id"]),
        ("meeting_bookings", "ix_meeting_bookings_guest_email", ["guest_email"]),
        ("meeting_bookings", "ix_meeting_bookings_start_at", ["start_at"]),
        ("meeting_bookings", "ix_meeting_bookings_end_at", ["end_at"]),
        ("meeting_bookings", "ix_meeting_bookings_status", ["status"]),
        ("meeting_bookings", "ix_meeting_bookings_booked_date", ["booked_date"]),
        ("meeting_bookings", "ix_meeting_bookings_tenant_start", ["tenant_id", "start_at"]),
        ("meeting_bookings", "ix_meeting_bookings_event", ["calendar_event_id"]),
    ]
    for table_name, index_name, columns in indexes:
        if not _index_exists(bind, table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    for table_name, index_names in (
        (
            "meeting_bookings",
            (
                "ix_meeting_bookings_event",
                "ix_meeting_bookings_tenant_start",
                "ix_meeting_bookings_booked_date",
                "ix_meeting_bookings_status",
                "ix_meeting_bookings_end_at",
                "ix_meeting_bookings_start_at",
                "ix_meeting_bookings_guest_email",
                "ix_meeting_bookings_calendar_event_id",
                "ix_meeting_bookings_booking_type_id",
                "ix_meeting_bookings_tenant_id",
                "ix_meeting_bookings_id",
            ),
        ),
        ("meeting_booking_questions", ("ix_meeting_booking_questions_type", "ix_meeting_booking_questions_booking_type_id", "ix_meeting_booking_questions_tenant_id", "ix_meeting_booking_questions_id")),
        ("meeting_booking_availability", ("ix_meeting_booking_availability_type_weekday", "ix_meeting_booking_availability_booking_type_id", "ix_meeting_booking_availability_tenant_id", "ix_meeting_booking_availability_id")),
        (
            "meeting_booking_types",
            (
                "ix_meeting_booking_types_tenant_enabled",
                "ix_meeting_booking_types_tenant_owner",
                "ix_meeting_booking_types_enabled",
                "ix_meeting_booking_types_slug",
                "ix_meeting_booking_types_owner_id",
                "ix_meeting_booking_types_tenant_id",
                "ix_meeting_booking_types_id",
            ),
        ),
    ):
        if _table_exists(bind, table_name):
            for index_name in index_names:
                if _index_exists(bind, table_name, index_name):
                    op.drop_index(index_name, table_name=table_name)
    for table_name in ("meeting_bookings", "meeting_booking_questions", "meeting_booking_availability", "meeting_booking_types"):
        if _table_exists(bind, table_name):
            op.drop_table(table_name)
