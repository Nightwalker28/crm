"""add platform automation rules

Revision ID: 20260615_automation_rules
Revises: 20260614_lead_scores
Create Date: 2026-05-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260615_automation_rules"
down_revision: Union[str, None] = "20260614_lead_scores"
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
    if not _table_exists(bind, "automation_rules"):
        op.create_table(
            "automation_rules",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("name", sa.String(length=180), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
            sa.Column("trigger_event", sa.String(length=100), nullable=False),
            sa.Column("conditions_json", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
            sa.Column("actions_json", sa.JSON(), server_default=sa.text("'[]'::json"), nullable=False),
            sa.Column("created_by_id", sa.BigInteger(), nullable=True),
            sa.Column("updated_by_id", sa.BigInteger(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["updated_by_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _table_exists(bind, "automation_rule_runs"):
        op.create_table(
            "automation_rule_runs",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("rule_id", sa.BigInteger(), nullable=False),
            sa.Column("event_id", sa.BigInteger(), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False),
            sa.Column("input_json", sa.JSON(), nullable=True),
            sa.Column("result_json", sa.JSON(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["event_id"], ["crm_events.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["rule_id"], ["automation_rules.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
    if not _table_exists(bind, "automation_rule_dead_letters"):
        op.create_table(
            "automation_rule_dead_letters",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("tenant_id", sa.BigInteger(), nullable=False),
            sa.Column("rule_id", sa.BigInteger(), nullable=True),
            sa.Column("run_id", sa.BigInteger(), nullable=True),
            sa.Column("event_id", sa.BigInteger(), nullable=True),
            sa.Column("status", sa.String(length=30), server_default="open", nullable=False),
            sa.Column("payload_json", sa.JSON(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["event_id"], ["crm_events.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["rule_id"], ["automation_rules.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["run_id"], ["automation_rule_runs.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )

    indexes = [
        ("automation_rules", "ix_automation_rules_id", ["id"]),
        ("automation_rules", "ix_automation_rules_tenant_id", ["tenant_id"]),
        ("automation_rules", "ix_automation_rules_enabled", ["enabled"]),
        ("automation_rules", "ix_automation_rules_trigger_event", ["trigger_event"]),
        ("automation_rules", "ix_automation_rules_created_by_id", ["created_by_id"]),
        ("automation_rules", "ix_automation_rules_updated_by_id", ["updated_by_id"]),
        ("automation_rules", "ix_automation_rules_created_at", ["created_at"]),
        ("automation_rules", "ix_automation_rules_tenant_trigger_enabled", ["tenant_id", "trigger_event", "enabled"]),
        ("automation_rule_runs", "ix_automation_rule_runs_id", ["id"]),
        ("automation_rule_runs", "ix_automation_rule_runs_tenant_id", ["tenant_id"]),
        ("automation_rule_runs", "ix_automation_rule_runs_rule_id", ["rule_id"]),
        ("automation_rule_runs", "ix_automation_rule_runs_event_id", ["event_id"]),
        ("automation_rule_runs", "ix_automation_rule_runs_status", ["status"]),
        ("automation_rule_runs", "ix_automation_rule_runs_started_at", ["started_at"]),
        ("automation_rule_runs", "ix_automation_rule_runs_tenant_status", ["tenant_id", "status"]),
        ("automation_rule_runs", "ix_automation_rule_runs_rule_started", ["rule_id", "started_at"]),
        ("automation_rule_dead_letters", "ix_automation_rule_dead_letters_id", ["id"]),
        ("automation_rule_dead_letters", "ix_automation_rule_dead_letters_tenant_id", ["tenant_id"]),
        ("automation_rule_dead_letters", "ix_automation_rule_dead_letters_rule_id", ["rule_id"]),
        ("automation_rule_dead_letters", "ix_automation_rule_dead_letters_run_id", ["run_id"]),
        ("automation_rule_dead_letters", "ix_automation_rule_dead_letters_event_id", ["event_id"]),
        ("automation_rule_dead_letters", "ix_automation_rule_dead_letters_status", ["status"]),
        ("automation_rule_dead_letters", "ix_automation_rule_dead_letters_created_at", ["created_at"]),
        ("automation_rule_dead_letters", "ix_automation_dead_letters_tenant_status", ["tenant_id", "status"]),
        ("automation_rule_dead_letters", "ix_automation_dead_letters_rule_created", ["rule_id", "created_at"]),
    ]
    for table_name, index_name, columns in indexes:
        if not _index_exists(bind, table_name, index_name):
            op.create_index(index_name, table_name, columns, unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    for table_name, index_names in (
        (
            "automation_rule_dead_letters",
            (
                "ix_automation_dead_letters_rule_created",
                "ix_automation_dead_letters_tenant_status",
                "ix_automation_rule_dead_letters_created_at",
                "ix_automation_rule_dead_letters_status",
                "ix_automation_rule_dead_letters_event_id",
                "ix_automation_rule_dead_letters_run_id",
                "ix_automation_rule_dead_letters_rule_id",
                "ix_automation_rule_dead_letters_tenant_id",
                "ix_automation_rule_dead_letters_id",
            ),
        ),
        (
            "automation_rule_runs",
            (
                "ix_automation_rule_runs_rule_started",
                "ix_automation_rule_runs_tenant_status",
                "ix_automation_rule_runs_started_at",
                "ix_automation_rule_runs_status",
                "ix_automation_rule_runs_event_id",
                "ix_automation_rule_runs_rule_id",
                "ix_automation_rule_runs_tenant_id",
                "ix_automation_rule_runs_id",
            ),
        ),
        (
            "automation_rules",
            (
                "ix_automation_rules_tenant_trigger_enabled",
                "ix_automation_rules_created_at",
                "ix_automation_rules_updated_by_id",
                "ix_automation_rules_created_by_id",
                "ix_automation_rules_trigger_event",
                "ix_automation_rules_enabled",
                "ix_automation_rules_tenant_id",
                "ix_automation_rules_id",
            ),
        ),
    ):
        if _table_exists(bind, table_name):
            for index_name in index_names:
                if _index_exists(bind, table_name, index_name):
                    op.drop_index(index_name, table_name=table_name)
    for table_name in ("automation_rule_dead_letters", "automation_rule_runs", "automation_rules"):
        if _table_exists(bind, table_name):
            op.drop_table(table_name)
