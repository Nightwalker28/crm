import unittest
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory import models as inventory_models  # noqa: F401
from app.modules.inventory.models import InventoryStockLevel, InventoryStockMove, InventoryWarehouse
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, post_moves, reverse_moves
from app.modules.user_management import models as user_models  # noqa: F401
from app.modules.user_management.models import Tenant


class InventoryLedgerTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=2, tenant_id=20, name="Other", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
        ])
        self.db.commit()
        self.main = ensure_default_warehouse(self.db, tenant_id=10)
        self.other = ensure_default_warehouse(self.db, tenant_id=20)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def move(self, quantity, *, product_id=1, warehouse_id=None, source_line_id=1, move_type="adjustment"):
        return MoveSpec(product_id=product_id, warehouse_id=warehouse_id or self.main.id,
                        quantity=Decimal(str(quantity)), move_type=move_type,
                        source_type="inventory_adjustment", source_id=1, source_line_id=source_line_id, reason="Test")

    def test_balances_equal_ledger_and_retries_do_not_double_count(self):
        first = post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[self.move("5")])[0]
        retry = post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[self.move("5")])[0]
        self.assertEqual(first.id, retry.id)
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[self.move("-2", source_line_id=2)])
        self.db.commit()
        level = self.db.query(InventoryStockLevel).filter_by(tenant_id=10, product_id=1, warehouse_id=self.main.id).one()
        moves = self.db.query(InventoryStockMove).filter_by(tenant_id=10, product_id=1).all()
        self.assertEqual(Decimal(level.on_hand), sum((Decimal(move.quantity) for move in moves), Decimal(0)))
        self.assertEqual(Decimal(self.db.get(CatalogProduct, 1).stock_quantity), Decimal(3))
        self.assertEqual(len(moves), 2)

    def test_negative_refusal_names_shortfall_and_keeps_balance(self):
        with self.assertRaises(HTTPException) as error:
            post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[self.move("-2")])
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("Camera", error.exception.detail)
        self.assertIn("Main", error.exception.detail)
        self.assertIn("2", error.exception.detail)
        self.db.rollback()
        self.assertEqual(self.db.query(InventoryStockMove).count(), 0)

    def test_cross_tenant_product_and_warehouse_are_hidden(self):
        for spec in (self.move(1, product_id=2), self.move(1, warehouse_id=self.other.id)):
            with self.assertRaises(HTTPException) as error:
                post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[spec])
            self.assertEqual(error.exception.status_code, 404)
            self.db.rollback()

    def test_reversal_is_linked_and_idempotent(self):
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[self.move(4)])
        self.db.commit()
        reversal = reverse_moves(self.db, tenant_id=10, actor_user_id=None, source_type="inventory_adjustment", source_id=1, reason="Cancelled")[0]
        again = reverse_moves(self.db, tenant_id=10, actor_user_id=None, source_type="inventory_adjustment", source_id=1, reason="Cancelled")[0]
        self.assertEqual(reversal.id, again.id)
        self.assertEqual(Decimal(self.db.get(CatalogProduct, 1).stock_quantity), Decimal(0))
        self.assertEqual(self.db.query(InventoryStockMove).filter_by(tenant_id=10).count(), 2)


if __name__ == "__main__":
    unittest.main()
