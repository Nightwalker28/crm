import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.inventory.models import InventoryDelivery, InventoryDeliveryLine, InventoryReservation, InventoryStockLevel, InventoryStockMove
from app.modules.inventory.services import delivery_services
from app.modules.inventory.services.reservation_services import order_fulfilment
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, post_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.sales.models import SalesOrder
from app.modules.sales.services.orders_services import build_orders_query, create_sales_order, update_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=2, tenant_id=10, name="Manual", currency="USD", public_unit_price=1, track_inventory=0),
        ])
        self.db.commit()
        self.main = ensure_default_warehouse(self.db, tenant_id=10)
        self.db.commit()
        self.next_line = 1000

    def tearDown(self):
        self.db.close()

    def stock(self, quantity, product_id=1):
        self.next_line += 1
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(
            product_id=product_id, warehouse_id=self.main.id, quantity=Decimal(str(quantity)), move_type="adjustment",
            source_type="inventory_adjustment", source_id=self.next_line, source_line_id=self.next_line, reason="Test")])
        self.db.commit()

    def order(self, *lines, status="confirmed"):
        order = create_sales_order(self.db, {"status": status, "items": [
            {"catalog_product_id": product_id, "name": f"Item {product_id}", "quantity": str(quantity), "unit_price": "1"}
            for product_id, quantity in lines
        ]}, self.user)
        # The service flushes; its caller commits (13a E5). Here the test is the caller.
        self.db.commit()
        return order

    def deliver(self, order, quantity, *, post=True):
        line = next(item for item in order.items if item.catalog_product_id == 1)
        doc = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "carrier": "DHL", "lines": [{"order_line_id": line.id, "quantity": str(quantity)}]})
        self.db.commit()
        if post:
            delivery_services.post_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=doc.id)
            self.db.commit()
        return doc

    def on_hand(self):
        self.db.expire_all()
        return Decimal(self.db.query(InventoryStockLevel).filter_by(tenant_id=10, product_id=1, warehouse_id=self.main.id).one().on_hand)

    def held(self, order):
        return sum((Decimal(row.quantity) for row in self.db.query(InventoryReservation).filter_by(order_id=order.id)), Decimal(0))

    def test_an_order_ships_in_two_deliveries_and_becomes_fulfilled(self):
        self.stock(100)
        order = self.order((1, 100))
        self.deliver(order, 40)
        self.db.refresh(order)
        self.assertEqual((order.status, order.delivery_status), ("confirmed", "partial"))
        self.assertEqual(self.held(order), Decimal(60))
        self.assertEqual(self.on_hand(), Decimal(60))
        summary = order_fulfilment(self.db, tenant_id=10, order=order)
        self.assertEqual((summary["lines"][0]["delivered"], summary["lines"][0]["to_deliver"]), (Decimal(40), Decimal(60)))
        second = self.deliver(order, 60)
        self.db.refresh(order)
        self.assertEqual((order.status, order.delivery_status), ("fulfilled", "delivered"))
        self.assertEqual(self.held(order), Decimal(0))
        self.assertEqual(self.on_hand(), Decimal(0))
        moves = self.db.query(InventoryStockMove).filter_by(source_type="inventory_delivery", source_id=second.id).all()
        self.assertEqual([(move.move_type, Decimal(move.quantity)) for move in moves], [("delivery", Decimal(-60))])

        # Undoing the second delivery reopens the order and re-reserves what came back.
        delivery_services.cancel_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=second.id, reason="Wrong pallet")
        self.db.commit()
        self.db.refresh(order)
        self.assertEqual((order.status, order.delivery_status), ("confirmed", "partial"))
        self.assertEqual(self.on_hand(), Decimal(60))
        self.assertEqual(self.held(order), Decimal(60))

    def test_close_remaining_releases_the_rest(self):
        self.stock(100)
        order = self.order((1, 100))
        self.deliver(order, 40)
        delivery_services.close_remaining(self.db, tenant_id=10, actor_user_id=1, order=order, reason="Customer took the rest elsewhere")
        self.db.commit()
        self.db.refresh(order)
        self.assertEqual((order.status, order.delivery_status), ("fulfilled", "closed"))
        self.assertEqual(self.held(order), Decimal(0))
        self.assertEqual(Decimal(self.db.query(InventoryStockLevel).filter_by(product_id=1).one().reserved), Decimal(0))
        self.assertEqual(order_fulfilment(self.db, tenant_id=10, order=order)["lines"][0]["to_deliver"], Decimal(0))

    def test_close_remaining_needs_a_delivery_and_cancelling_a_shipped_order_is_refused(self):
        self.stock(10)
        order = self.order((1, 5))
        with self.assertRaises(HTTPException) as error:
            delivery_services.close_remaining(self.db, tenant_id=10, actor_user_id=1, order=order, reason="x")
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        self.deliver(order, 2)
        for status in ("cancelled", "draft"):
            with self.assertRaises(HTTPException) as error:
                update_sales_order(self.db, order, {"status": status}, actor_user_id=1)
            self.assertEqual(error.exception.status_code, 409)
            self.db.rollback()

    def test_marking_fulfilled_posts_one_delivery_for_everything_left(self):
        self.stock(10)
        order = self.order((1, 4), (2, 1))
        updated = update_sales_order(self.db, order, {"status": "fulfilled"}, actor_user_id=1)
        self.db.commit()
        self.assertEqual((updated.status, updated.delivery_status), ("fulfilled", "delivered"))
        deliveries = self.db.query(InventoryDelivery).filter_by(order_id=order.id).all()
        self.assertEqual([(doc.status, len(doc.lines)) for doc in deliveries], [("posted", 1)])
        self.assertEqual(self.on_hand(), Decimal(6))

        short = self.order((1, 9))
        with self.assertRaises(HTTPException) as error:
            update_sales_order(self.db, short, {"status": "fulfilled"}, actor_user_id=1)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("Camera", error.exception.detail)
        self.db.rollback()
        self.assertEqual(self.on_hand(), Decimal(6))

    def test_an_order_without_stocked_lines_is_fulfilled_by_hand(self):
        order = self.order((2, 1))
        updated = update_sales_order(self.db, order, {"status": "fulfilled"}, actor_user_id=1)
        self.assertEqual((updated.status, updated.delivery_status), ("fulfilled", "none"))
        self.assertEqual(self.db.query(InventoryDelivery).count(), 0)

    def test_a_delivery_cannot_exceed_what_is_left_or_take_another_orders_stock(self):
        self.stock(5)
        first = self.order((1, 5))
        second = self.order((1, 3))
        with self.assertRaises(HTTPException) as error:
            self.deliver(first, 6)
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        with self.assertRaises(HTTPException) as error:
            self.deliver(second, 1)
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("reserved", error.exception.detail)
        self.db.rollback()
        self.assertEqual(self.on_hand(), Decimal(5))

    def test_a_new_delivery_ships_what_is_reserved_by_default(self):
        self.stock(3)
        order = self.order((1, 5))
        doc = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={"order_id": order.id})
        self.assertEqual([Decimal(line.quantity) for line in doc.lines], [Decimal(3)])
        self.db.rollback()
        nothing = self.order((1, 2))
        with self.assertRaises(HTTPException) as error:
            delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={"order_id": nothing.id})
        self.assertEqual(error.exception.status_code, 409)

    def test_a_delivered_line_keeps_its_product_and_cannot_shrink_or_go(self):
        self.stock(10)
        order = self.order((1, 5))
        self.deliver(order, 3)
        line = order.items[0]
        base = {"id": line.id, "name": "Camera", "unit_price": "1"}
        for items in (
            [{**base, "catalog_product_id": 1, "quantity": "2"}],
            [{**base, "catalog_product_id": 2, "quantity": "5"}],
            [{"name": "Other", "quantity": "1", "unit_price": "1"}],
        ):
            with self.assertRaises(HTTPException) as error:
                update_sales_order(self.db, order, {"items": items}, actor_user_id=1)
            self.assertEqual(error.exception.status_code, 409)
            self.db.rollback()
            self.db.refresh(order)
        updated = update_sales_order(self.db, order, {"items": [{**base, "catalog_product_id": 1, "quantity": "4"}]}, actor_user_id=1)
        self.assertEqual(self.held(updated), Decimal(1))

    def test_another_tenants_order_is_not_found(self):
        order = self.order((1, 1))
        with self.assertRaises(HTTPException) as error:
            delivery_services.save_delivery(self.db, tenant_id=20, actor_user_id=1, payload={"order_id": order.id, "lines": [{"order_line_id": order.items[0].id, "quantity": "1"}]})
        self.assertEqual(error.exception.status_code, 404)

    def test_waiting_for_stock_filter_finds_orders_short_of_stock(self):
        self.stock(5)
        ready = self.order((1, 5))
        waiting = self.order((1, 2))
        self.order((2, 1))
        rows = build_orders_query(self.db, tenant_id=10, all_filter_conditions=[{"field": "waiting_for_stock", "operator": "is", "value": True}]).all()
        self.assertEqual([row.id for row in rows], [waiting.id])
        to_deliver = build_orders_query(self.db, tenant_id=10, all_filter_conditions=[
            {"field": "status", "operator": "is", "value": "confirmed"}, {"field": "delivery_status", "operator": "is_not", "value": "none"}]).all()
        self.assertEqual(sorted(row.id for row in to_deliver), sorted([ready.id, waiting.id]))

    def test_cancelling_a_migrated_delivery_reverses_the_orders_old_fulfilment_moves(self):
        self.stock(5)
        order = self.order((1, 2), status="draft")
        line = order.items[0]
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(product_id=1, warehouse_id=self.main.id, quantity=Decimal(-2),
            move_type="sales_order", source_type="sales_order", source_id=order.id, source_line_id=line.id, reason="Order fulfilled")])
        self.db.query(SalesOrder).filter_by(id=order.id).update({"status": "fulfilled", "delivery_status": "delivered"})
        doc = InventoryDelivery(tenant_id=10, number=f"DEL-M-{order.id}", order_id=order.id, warehouse_id=self.main.id, status="posted", migrated=1)
        doc.lines = [InventoryDeliveryLine(tenant_id=10, order_line_id=line.id, product_id=1, quantity=Decimal(2))]
        self.db.add(doc)
        self.db.commit()
        delivery_services.cancel_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=doc.id, reason="Never shipped")
        self.db.commit()
        self.assertEqual(self.on_hand(), Decimal(5))
        self.db.refresh(order)
        self.assertEqual((order.status, order.delivery_status), ("confirmed", "pending"))
        self.assertEqual(self.held(order), Decimal(2))


if __name__ == "__main__":
    unittest.main()
