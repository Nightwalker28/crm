"""backfill contract number counters

Revision ID: 20260714_contract_numbers
Revises: 20260713_setup_token_indexes
Create Date: 2026-06-26
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260714_contract_numbers"
down_revision: Union[str, None] = "20260713_setup_token_indexes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table_name: str) -> bool:
    return table_name in sa.inspect(bind).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "crm_number_counters") or not _table_exists(bind, "contracts"):
        return
    if bind.dialect.name == "postgresql":
        op.execute(
            sa.text(
                """
                INSERT INTO crm_number_counters (tenant_id, scope, period, next_value)
                SELECT tenant_id,
                       'contracts',
                       substring(contract_number from :period_pattern) AS period,
                       max((substring(contract_number from :sequence_pattern))::integer) + 1 AS next_value
                FROM contracts
                WHERE contract_number ~ :number_pattern
                GROUP BY tenant_id, period
                ON CONFLICT (tenant_id, scope, period)
                DO UPDATE SET next_value = greatest(crm_number_counters.next_value, EXCLUDED.next_value)
                """
            ).bindparams(
                period_pattern=r"^CTR-([0-9]{8})-[0-9]+$",
                sequence_pattern=r"^CTR-[0-9]{8}-([0-9]+)$",
                number_pattern=r"^CTR-[0-9]{8}-[0-9]+$",
            )
        )
        return

    op.execute(
        sa.text(
            """
            INSERT INTO crm_number_counters (tenant_id, scope, period, next_value)
            SELECT tenant_id,
                   'contracts',
                   substr(contract_number, 5, 8) AS period,
                   max(CAST(substr(contract_number, 14) AS INTEGER)) + 1 AS next_value
            FROM contracts
            WHERE contract_number LIKE 'CTR-________-%'
              AND length(contract_number) >= 14
            GROUP BY tenant_id, period
            ON CONFLICT (tenant_id, scope, period)
            DO UPDATE SET next_value = max(crm_number_counters.next_value, excluded.next_value)
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    if _table_exists(bind, "crm_number_counters"):
        op.execute(sa.text("DELETE FROM crm_number_counters WHERE scope = 'contracts'"))
