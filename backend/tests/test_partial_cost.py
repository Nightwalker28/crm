"""A partly costed product stays *Cost missing* until revalued (13a H8)."""

import unittest
from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.inventory.services import valuation_services
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, ensure_product_levels, post_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus


class PartialCostTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=10, name="Main", operating_currencies=["USD"]),
            CatalogProduct(id=1, tenant_id=10, name="CRM Pro License", currency="USD", public_unit_price=50, track_inventory=1, stock_quantity=0),
        ])
        self.db.commit()
        self.warehouse = ensure_default_warehouse(self.db, tenant_id=10)
        ensure_product_levels(self.db, tenant_id=10, product_id=1)
        self.db.commit()
        self.source = 0

    def tearDown(self):
        self.db.close()

    def move(self, quantity, unit_cost=None):
        self.source += 1
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(
            product_id=1, warehouse_id=self.warehouse.id, quantity=Decimal(quantity), move_type="adjustment",
            source_type="inventory_adjustment", source_id=self.source, source_line_id=self.source,
            unit_cost=Decimal(unit_cost) if unit_cost is not None else None, cost_source="manual" if unit_cost is not None else None)])
        self.db.commit()

    def row(self):
        return next(row for row in valuation_services.valuation_rows(self.db, tenant_id=10) if row["product_id"] == 1)

    def test_uncosted_units_keep_the_product_cost_missing_until_revalued(self):
        self.move(80)          # opening stock with no cost
        self.move(3, "21")     # 3 received at 21: the average is 0.759, a partial figure
        row = self.row()
        self.assertTrue(row["cost_missing"])
        self.assertTrue(row["cost_partial"])
        self.assertEqual(row["uncosted_quantity"], Decimal("80"))
        self.assertEqual(valuation_services.valuation_summary(self.db, tenant_id=10)["cost_missing"], 1)
        self.assertTrue(valuation_services.product_valuation(self.db, product=self.db.get(CatalogProduct, 1))["cost_partial"])

        self.move(-83 + 73)    # 10 out: the uncosted share falls with them
        self.assertEqual(self.row()["uncosted_quantity"], Decimal("70.3614"))

        valuation_services.revalue(self.db, tenant_id=10, actor_user_id=1, product_id=1, average_cost="20", reason="Counted")
        self.db.commit()
        row = self.row()
        self.assertFalse(row["cost_missing"])
        self.assertFalse(row["cost_partial"])


if __name__ == "__main__":
    unittest.main()
