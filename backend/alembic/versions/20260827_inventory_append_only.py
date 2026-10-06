"""Make stock moves immutable at the PostgreSQL boundary.

Revision ID: 20260827_inventory_append_only
Revises: 20260826_inventory_ledger
"""

from typing import Sequence, Union

from alembic import op

revision: str = "20260827_inventory_append_only"
down_revision: Union[str, None] = "20260826_inventory_ledger"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE FUNCTION prevent_inventory_stock_move_mutation() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'Inventory stock moves are append-only';
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("""
        CREATE TRIGGER inventory_stock_moves_append_only
        BEFORE UPDATE OR DELETE ON inventory_stock_moves
        FOR EACH ROW EXECUTE FUNCTION prevent_inventory_stock_move_mutation();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER inventory_stock_moves_append_only ON inventory_stock_moves")
    op.execute("DROP FUNCTION prevent_inventory_stock_move_mutation()")
