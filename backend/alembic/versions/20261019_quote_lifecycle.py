"""Quote lifecycle: revisions, acceptance, conversion and a validity period (13d §3.5)

Quote statuses gain `superseded` (a revision replaced it) and `converted` (an order was made
from it). Quotes gain `revision`, `revised_from_id`, the signer's name, time and drawn
signature, and a decline note (the reason stays in `lost_reason`). The company gets
`quote_validity_days` (30). Quotes already converted into an order become `converted`, so
they lock as new ones do.

Downgrade refuses while any quote is superseded; converted quotes go back to accepted.

Revision ID: 20261019_quote_lifecycle
Revises: 20261018_document_pdfs
Create Date: 2026-10-09
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20261019_quote_lifecycle"
down_revision: Union[str, None] = "20261018_document_pdfs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("ck_sales_quotes_status", "sales_quotes", type_="check")
    op.create_check_constraint("ck_sales_quotes_status", "sales_quotes",
                               "status IN ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded', 'converted')")
    op.add_column("sales_quotes", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("sales_quotes", sa.Column("revised_from_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key("fk_sales_quotes_revised_from", "sales_quotes", "sales_quotes", ["revised_from_id"], ["quote_id"], ondelete="SET NULL")
    op.add_column("sales_quotes", sa.Column("accepted_by_name", sa.Text(), nullable=True))
    op.add_column("sales_quotes", sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sales_quotes", sa.Column("signature_data", sa.Text(), nullable=True))
    op.add_column("sales_quotes", sa.Column("decline_note", sa.Text(), nullable=True))
    op.add_column("company_profiles", sa.Column("quote_validity_days", sa.Integer(), nullable=False, server_default="30"))
    op.execute("UPDATE sales_quotes SET status = 'converted' WHERE status = 'accepted' AND quote_id IN "
               "(SELECT quote_id FROM sales_orders WHERE quote_id IS NOT NULL)")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM sales_quotes WHERE status = 'superseded' LIMIT 1")).first():
        raise RuntimeError("Quotes have been revised; they cannot be downgraded past 20261019_quote_lifecycle")
    op.execute("UPDATE sales_quotes SET status = 'accepted' WHERE status = 'converted'")
    op.drop_column("company_profiles", "quote_validity_days")
    op.drop_column("sales_quotes", "decline_note")
    op.drop_column("sales_quotes", "signature_data")
    op.drop_column("sales_quotes", "accepted_at")
    op.drop_column("sales_quotes", "accepted_by_name")
    op.drop_constraint("fk_sales_quotes_revised_from", "sales_quotes", type_="foreignkey")
    op.drop_column("sales_quotes", "revised_from_id")
    op.drop_column("sales_quotes", "revision")
    op.drop_constraint("ck_sales_quotes_status", "sales_quotes", type_="check")
    op.create_check_constraint("ck_sales_quotes_status", "sales_quotes", "status IN ('draft', 'sent', 'accepted', 'declined', 'expired')")
