"""add automation domain metadata

Revision ID: 20260628_automation_metadata
Revises: 20260627_whole_tenant_restore
Create Date: 2026-06-09
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260628_automation_metadata"
down_revision: Union[str, None] = "20260627_whole_tenant_restore"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


RULE_TRIGGER_MODULE_SQL = """
CASE
    WHEN trigger_event LIKE 'lead.%' THEN 'sales_leads'
    WHEN trigger_event LIKE 'opportunity.%' OR trigger_event LIKE 'deal.%' THEN 'sales_opportunities'
    WHEN trigger_event LIKE 'quote.%' THEN 'sales_quotes'
    WHEN trigger_event LIKE 'order.%' THEN 'sales_orders'
    WHEN trigger_event LIKE 'booking.%' THEN 'calendar'
    WHEN trigger_event LIKE 'ticket.%' OR trigger_event LIKE 'case.%' THEN 'support_cases'
    WHEN trigger_event LIKE 'document.%' THEN 'documents'
    WHEN trigger_event LIKE 'task.%' THEN 'tasks'
    WHEN trigger_event LIKE 'invoice.%' THEN 'finance_io'
    ELSE NULL
END
"""


def _column_exists(bind, table_name: str, column_name: str) -> bool:
    return column_name in {column["name"] for column in sa.inspect(bind).get_columns(table_name)}


def _index_exists(bind, table_name: str, index_name: str) -> bool:
    return index_name in {index["name"] for index in sa.inspect(bind).get_indexes(table_name)}


def _add_column_if_missing(bind, table_name: str, column: sa.Column) -> None:
    if not _column_exists(bind, table_name, column.name):
        op.add_column(table_name, column)


def _create_index_if_missing(bind, index_name: str, table_name: str, columns: list[str]) -> None:
    if not _index_exists(bind, table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=False)


def upgrade() -> None:
    bind = op.get_bind()
    _add_column_if_missing(bind, "automation_rules", sa.Column("module_key", sa.String(length=100), nullable=True))
    _add_column_if_missing(
        bind,
        "automation_rules",
        sa.Column("condition_mode", sa.String(length=10), server_default="all", nullable=False),
    )
    _add_column_if_missing(bind, "automation_rule_runs", sa.Column("trigger_event_key", sa.String(length=100), nullable=True))
    _add_column_if_missing(bind, "automation_rule_runs", sa.Column("source_module_key", sa.String(length=100), nullable=True))
    _add_column_if_missing(bind, "automation_rule_runs", sa.Column("source_record_id", sa.String(length=100), nullable=True))
    _add_column_if_missing(bind, "automation_rule_runs", sa.Column("step_results_json", sa.JSON(), nullable=True))
    _add_column_if_missing(bind, "automation_rule_runs", sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))

    op.execute(sa.text(f"UPDATE automation_rules SET module_key = {RULE_TRIGGER_MODULE_SQL} WHERE module_key IS NULL"))
    op.execute(
        sa.text(
            """
            UPDATE automation_rule_runs AS runs
            SET
                trigger_event_key = COALESCE(runs.trigger_event_key, events.event_type),
                source_module_key = COALESCE(runs.source_module_key, events.entity_type),
                source_record_id = COALESCE(runs.source_record_id, events.entity_id),
                completed_at = COALESCE(runs.completed_at, runs.finished_at)
            FROM crm_events AS events
            WHERE runs.event_id = events.id
            """
        )
    )

    _create_index_if_missing(bind, "ix_automation_rules_module_key", "automation_rules", ["module_key"])
    _create_index_if_missing(bind, "ix_automation_rule_runs_trigger_event_key", "automation_rule_runs", ["trigger_event_key"])
    _create_index_if_missing(bind, "ix_automation_rule_runs_source_module_key", "automation_rule_runs", ["source_module_key"])
    _create_index_if_missing(bind, "ix_automation_rule_runs_source_record_id", "automation_rule_runs", ["source_record_id"])


def downgrade() -> None:
    bind = op.get_bind()
    for index_name in (
        "ix_automation_rule_runs_source_record_id",
        "ix_automation_rule_runs_source_module_key",
        "ix_automation_rule_runs_trigger_event_key",
        "ix_automation_rules_module_key",
    ):
        table_name = "automation_rules" if index_name == "ix_automation_rules_module_key" else "automation_rule_runs"
        if _index_exists(bind, table_name, index_name):
            op.drop_index(index_name, table_name=table_name)

    for table_name, column_names in (
        ("automation_rule_runs", ("completed_at", "step_results_json", "source_record_id", "source_module_key", "trigger_event_key")),
        ("automation_rules", ("condition_mode", "module_key")),
    ):
        for column_name in column_names:
            if _column_exists(bind, table_name, column_name):
                op.drop_column(table_name, column_name)
