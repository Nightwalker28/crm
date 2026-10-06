import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.inventory.models import InventoryReservation, InventoryStockLevel
from app.modules.inventory.services import delivery_services
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, post_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.sales.services.orders_services import create_sales_order, update_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class E3FollowUpTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10, role_id=None, team_id=None)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=10, track_inventory=1, stock_quantity=0),
        ])
        self.db.commit()
        self.main = ensure_default_warehouse(self.db, tenant_id=10)
        self.db.commit()
        self.source_line = 0

    def tearDown(self):
        self.db.close()

    def stock(self, quantity):
        self.source_line += 1
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(product_id=1, warehouse_id=self.main.id, quantity=Decimal(str(quantity)),
            move_type="adjustment", source_type="inventory_adjustment", source_id=self.source_line, source_line_id=self.source_line, reason="Test")])
        self.db.commit()

    def order(self, quantity, priority="normal"):
        return create_sales_order(self.db, {"status": "confirmed", "priority": priority, "items": [
            {"catalog_product_id": 1, "name": "Camera", "quantity": str(quantity), "unit_price": "10"}]}, self.user)

    def held(self, order):
        return sum((Decimal(row.quantity) for row in self.db.query(InventoryReservation).filter_by(order_id=order.id)), Decimal(0))

    def on_hand(self):
        self.db.expire_all()
        return Decimal(self.db.query(InventoryStockLevel).filter_by(product_id=1, warehouse_id=self.main.id).one().on_hand)

    # Priority

    def test_arriving_stock_goes_to_the_most_urgent_waiting_order_first(self):
        older = self.order(2)
        urgent = self.order(2, priority="urgent")
        self.stock(2)
        self.assertEqual((self.held(older), self.held(urgent)), (Decimal(0), Decimal(2)))

    def test_a_shortage_releases_the_lowest_priority_hold_first(self):
        self.stock(4)
        high = self.order(2, priority="high")
        normal = self.order(2)
        update_sales_order(self.db, high, {"priority": "urgent"}, actor_user_id=1)
        self.stock(-2)
        self.assertEqual((self.held(high), self.held(normal)), (Decimal(2), Decimal(0)))

    def test_an_unknown_priority_is_refused(self):
        with self.assertRaises(HTTPException) as error:
            self.order(1, priority="asap")
        self.assertEqual(error.exception.status_code, 400)

    # Client-portal orders. 13 F1.3: a portal order is a draft sales order with source
    # `client_portal`; the team confirms it on the order page like any other order.

    def portal_order(self, quantity):
        order = create_sales_order(self.db, {"status": "draft", "source": "client_portal", "items": [
            {"catalog_product_id": 1, "name": "Camera", "quantity": str(quantity), "unit_price": "10"}]}, self.user)
        self.db.commit()
        return order

    def test_a_portal_order_holds_nothing_until_confirmed(self):
        self.stock(5)
        portal = self.portal_order(3)
        self.assertEqual((portal.source, portal.status, self.held(portal)), ("client_portal", "draft", Decimal(0)))

        confirmed = update_sales_order(self.db, portal, {"status": "confirmed"}, actor_user_id=1)
        self.db.commit()
        self.assertEqual(self.held(confirmed), Decimal(3))

    def test_cancelling_a_confirmed_portal_order_releases_its_holds(self):
        self.stock(5)
        portal = update_sales_order(self.db, self.portal_order(2), {"status": "confirmed"}, actor_user_id=1)
        self.db.commit()
        cancelled = update_sales_order(self.db, portal, {"status": "cancelled"}, actor_user_id=1)
        self.db.commit()
        self.assertEqual(self.held(cancelled), Decimal(0))
        self.assertEqual(Decimal(self.db.query(InventoryStockLevel).filter_by(product_id=1).one().reserved), Decimal(0))

    # Delivery note data

    def test_a_delivery_carries_its_ship_to_address(self):
        self.stock(2)
        order = self.order(1)
        update_sales_order(self.db, order, {"shipping_address": "1 Dock Road", "shipping_city": "Colombo"}, actor_user_id=1)
        doc = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={"order_id": order.id})
        self.db.commit()
        data = delivery_services.serialize_delivery(self.db, tenant_id=10, doc=doc)
        self.assertEqual(data["delivery_address"], "1 Dock Road\nColombo")


if __name__ == "__main__":
    unittest.main()
