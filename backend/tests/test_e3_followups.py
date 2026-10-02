import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.inventory.models import InventoryDelivery, InventoryReservation, InventoryStockLevel
from app.modules.inventory.services import delivery_services
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, post_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.sales.models import SalesOrder
from app.modules.sales.services.orders_services import create_sales_order, update_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus
from app.modules.website_integrations.models import WebsiteIntegrationOrder, WebsiteIntegrationOrderLine
from app.modules.website_integrations.services import website_integration_services as website


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

    # Client-portal orders

    def portal_order(self, quantity, reference):
        order = WebsiteIntegrationOrder(tenant_id=10, external_reference=reference, source_platform="client_portal", status="submitted",
            request_hash="x", currency="USD", subtotal_amount=Decimal(10) * quantity, metadata_json={"source": "client_portal", "details": "Blue please"})
        order.line_items = [WebsiteIntegrationOrderLine(tenant_id=10, catalog_product_id=1, item_type="product", name="Camera",
            quantity=Decimal(quantity), currency="USD", unit_price_snapshot=Decimal(10), line_total=Decimal(10) * quantity)]
        self.db.add(order)
        self.db.commit()
        return order

    def status(self, order, value):
        return website.update_order_status(self.db, current_user=self.user, order_id=order.id, status_value=value)

    def test_a_portal_order_holds_nothing_until_confirmed_then_ships_on_completion(self):
        self.stock(5)
        portal = self.portal_order(3, "portal-1")
        self.status(portal, "under_review")
        self.assertIsNone(self.db.get(WebsiteIntegrationOrder, portal.id).sales_order_id)
        self.assertEqual(self.db.query(InventoryReservation).count(), 0)

        self.status(portal, "confirmed")
        linked = self.db.get(SalesOrder, self.db.get(WebsiteIntegrationOrder, portal.id).sales_order_id)
        self.assertEqual((linked.status, self.held(linked)), ("confirmed", Decimal(3)))
        self.assertIn("portal-1", linked.notes)

        with self.assertRaises(HTTPException) as error:
            self.status(portal, "under_review")
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()

        self.status(portal, "completed")
        self.db.expire_all()
        linked = self.db.get(SalesOrder, linked.id)
        self.assertEqual((linked.status, linked.delivery_status), ("fulfilled", "delivered"))
        self.assertEqual(self.on_hand(), Decimal(2))
        self.assertEqual(self.db.query(InventoryDelivery).filter_by(order_id=linked.id, status="posted").count(), 1)

    def test_rejecting_a_confirmed_portal_order_releases_its_holds(self):
        self.stock(5)
        portal = self.portal_order(2, "portal-2")
        self.status(portal, "confirmed")
        self.status(portal, "rejected")
        self.db.expire_all()
        linked = self.db.get(SalesOrder, self.db.get(WebsiteIntegrationOrder, portal.id).sales_order_id)
        self.assertEqual(linked.status, "cancelled")
        self.assertEqual(self.held(linked), Decimal(0))
        self.assertEqual(Decimal(self.db.query(InventoryStockLevel).filter_by(product_id=1).one().reserved), Decimal(0))

    def test_a_shipped_portal_order_cannot_be_cancelled(self):
        self.stock(5)
        portal = self.portal_order(2, "portal-3")
        self.status(portal, "confirmed")
        linked_id = self.db.get(WebsiteIntegrationOrder, portal.id).sales_order_id
        line = self.db.get(SalesOrder, linked_id).items[0]
        doc = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={"order_id": linked_id, "lines": [{"order_line_id": line.id, "quantity": "1"}]})
        delivery_services.post_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=doc.id)
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            self.status(portal, "cancelled")
        self.assertEqual(error.exception.status_code, 409)

    def test_completing_a_short_portal_order_is_refused_but_it_stays_confirmed(self):
        self.stock(1)
        portal = self.portal_order(3, "portal-4")
        with self.assertRaises(HTTPException) as error:
            self.status(portal, "completed")
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        refreshed = self.db.get(WebsiteIntegrationOrder, portal.id)
        self.assertIsNotNone(refreshed.sales_order_id)
        self.assertEqual(refreshed.status, "submitted")
        self.assertEqual(self.held(self.db.get(SalesOrder, refreshed.sales_order_id)), Decimal(1))

    def test_website_api_orders_are_unchanged(self):
        self.stock(5)
        api_order = self.portal_order(1, "wp-1")
        api_order.source_platform = "wordpress"
        self.db.commit()
        self.status(api_order, "confirmed")
        self.assertIsNone(self.db.get(WebsiteIntegrationOrder, api_order.id).sales_order_id)

    # Delivery note data

    def test_a_delivery_carries_its_ship_to_address(self):
        self.stock(2)
        order = self.order(1)
        update_sales_order(self.db, order, {"delivery_address": "1 Dock Road\nColombo"}, actor_user_id=1)
        doc = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={"order_id": order.id})
        self.db.commit()
        data = delivery_services.serialize_delivery(self.db, tenant_id=10, doc=doc)
        self.assertEqual(data["delivery_address"], "1 Dock Road\nColombo")


if __name__ == "__main__":
    unittest.main()
