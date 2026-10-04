"""Regroup the sidebar for modules added after a tenant customised it; one spelling of Fulfilment

13a H27. ERP modules defaulted to the "other" sidebar tab, and Tasks and Documents were
stored as hidden ("none") in existing tenants, so a customised sidebar showed 13 ERP pages
under "Other" and no Tasks or Documents. Clearing the stored key lets each module take its
default group again (inventory, purchasing, workspace). An explicit custom tab a tenant chose
is left alone.

13a I4: the seeded order layout called its section "Fulfillment" while the pages said
"Fulfilment". The seed is corrected; stored layouts still holding the seeded label follow.

Revision ID: 20261006_sidebar_regroup
Revises: 20261005_password_reset
Create Date: 2026-10-04
"""

from typing import Sequence, Union

import json

import sqlalchemy as sa
from alembic import op


revision: str = "20261006_sidebar_regroup"
down_revision: Union[str, None] = "20261005_password_reset"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE tenant_module_configs
            SET sidebar_tab_key = NULL
            WHERE sidebar_tab_key = 'other'
              AND module_id IN (
                  SELECT id FROM modules WHERE name LIKE 'inventory\\_%' ESCAPE '\\' OR name LIKE 'purchase\\_%' ESCAPE '\\'
              )
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE tenant_module_configs
            SET sidebar_tab_key = NULL
            WHERE sidebar_tab_key = 'none'
              AND module_id IN (SELECT id FROM modules WHERE name IN ('tasks', 'documents'))
            """
        )
    )


    rows = bind.execute(
        sa.text("SELECT id, sections FROM record_layout_definitions WHERE module_key = 'sales_orders'")
    ).fetchall()
    for row_id, sections in rows:
        data = json.loads(sections) if isinstance(sections, str) else sections
        if not isinstance(data, list):
            continue
        changed = False
        for section in data:
            if isinstance(section, dict) and section.get("label") == "Fulfillment":
                section["label"] = "Fulfilment"
                changed = True
        if changed:
            bind.execute(
                sa.text("UPDATE record_layout_definitions SET sections = :sections WHERE id = :id").bindparams(
                    sa.bindparam("sections", type_=sa.JSON)
                ),
                {"sections": data, "id": row_id},
            )


def downgrade() -> None:
    # The cleared keys were defaults or a hidden state nobody chose on purpose; there is
    # nothing to put back.
    pass
