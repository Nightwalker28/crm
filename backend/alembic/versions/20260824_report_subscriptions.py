"""Tenant sender and scheduled report subscriptions.

Revision ID: 20260824_report_subscriptions
Revises: 20260823_report_dashboards
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260824_report_subscriptions"
down_revision: Union[str, None] = "20260823_report_dashboards"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_mail_settings",
        sa.Column("tenant_id", sa.BigInteger(), primary_key=True),
        sa.Column("sender_email", sa.String(255), nullable=False),
        sa.Column("smtp_host", sa.String(255), nullable=False),
        sa.Column("smtp_port", sa.Integer(), nullable=False),
        sa.Column("smtp_security", sa.String(20), nullable=False),
        sa.Column("smtp_username", sa.String(255), nullable=False),
        sa.Column("encrypted_password", sa.Text(), nullable=False),
        sa.Column("encrypted_password_key_version", sa.String(32), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "report_subscriptions",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("target_type", sa.String(20), nullable=False),
        sa.Column("target_id", sa.BigInteger(), nullable=False),
        sa.Column("frequency", sa.String(20), nullable=False),
        sa.Column("hour", sa.Integer(), nullable=False),
        sa.Column("minute", sa.Integer(), server_default="0", nullable=False),
        sa.Column("weekday", sa.Integer(), nullable=True),
        sa.Column("day_of_month", sa.Integer(), nullable=True),
        sa.Column("timezone", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_status", sa.String(20), nullable=True),
        sa.Column("last_error", sa.String(255), nullable=True),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.CheckConstraint("target_type IN ('report', 'dashboard')", name="ck_report_subscription_target"),
        sa.CheckConstraint("frequency IN ('daily', 'weekly', 'monthly')", name="ck_report_subscription_frequency"),
        sa.UniqueConstraint("tenant_id", "user_id", "target_type", "target_id", name="uq_report_subscription_user_target"),
    )
    op.create_index("ix_report_subscriptions_id", "report_subscriptions", ["id"])
    op.create_index("ix_report_subscriptions_tenant_id", "report_subscriptions", ["tenant_id"])
    op.create_index("ix_report_subscriptions_user_id", "report_subscriptions", ["user_id"])
    op.create_index("ix_report_subscriptions_due", "report_subscriptions", ["next_run_at"])
    op.create_table(
        "report_subscription_deliveries",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("tenant_id", sa.BigInteger(), nullable=False),
        sa.Column("subscription_id", sa.BigInteger(), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), server_default="queued", nullable=False),
        sa.Column("error", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subscription_id"], ["report_subscriptions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("subscription_id", "scheduled_for", name="uq_report_delivery_slot"),
    )
    op.create_index("ix_report_subscription_deliveries_id", "report_subscription_deliveries", ["id"])
    op.create_index("ix_report_subscription_deliveries_tenant_id", "report_subscription_deliveries", ["tenant_id"])
    op.create_index("ix_report_subscription_deliveries_subscription_id", "report_subscription_deliveries", ["subscription_id"])


def downgrade() -> None:
    op.drop_table("report_subscription_deliveries")
    op.drop_table("report_subscriptions")
    op.drop_table("tenant_mail_settings")
