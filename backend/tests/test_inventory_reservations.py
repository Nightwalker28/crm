import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.inventory.models import InventoryReservation, InventoryStockLevel, InventoryWarehouse
from app.modules.inventory.services.reservation_services import order_fulfilment, product_reservations
from app.modules.inventory.services.stock_ledger import (
    MoveSpec, ensure_default_warehouse, post_moves, rebuild_reservations, reservation_version, reserve_for_order, set_reservations,
)
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import ActivityLog, UserNotification
from app.modules.sales.models import SalesOrder
from app.modules.sales.services.orders_services import create_sales_order, update_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class ReservationTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            User(id=2, tenant_id=10, email="planner@example.com", is_active=UserStatus.active),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=2, tenant_id=10, name="Lens", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=3, tenant_id=20, name="Foreign", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
        ])
        self.db.commit()
        self.main = ensure_default_warehouse(self.db, tenant_id=10)
        self.db.commit()
        self.next_line = 100

    def tearDown(self):
        self.db.close()

    def stock(self, quantity, *, product_id=1, warehouse_id=None, actor=None):
        self.next_line += 1
        post_moves(self.db, tenant_id=10, actor_user_id=actor, moves=[MoveSpec(
            product_id=product_id, warehouse_id=warehouse_id or self.main.id, quantity=Decimal(str(quantity)),
            move_type="adjustment", source_type="inventory_adjustment", source_id=self.next_line,
            source_line_id=self.next_line, reason="Test")])
        self.db.commit()

    def order(self, *lines, status="confirmed", warehouse_id=None):
        payload = {"status": status, "items": [
            {"catalog_product_id": product_id, "name": f"Item {product_id}", "quantity": str(quantity), "unit_price": "1"}
            for product_id, quantity in lines
        ]}
        if warehouse_id:
            payload["warehouse_id"] = warehouse_id
        order = create_sales_order(self.db, payload, self.user)
        # The service flushes; its caller commits (13a E5). Here the test is the caller.
        self.db.commit()
        return order

    def held(self, order):
        return {row.order_line_id: Decimal(row.quantity) for row in self.db.query(InventoryReservation).filter_by(order_id=order.id)}

    def level(self, product_id=1, warehouse_id=None):
        return self.db.query(InventoryStockLevel).filter_by(tenant_id=10, product_id=product_id, warehouse_id=warehouse_id or self.main.id).one()

    def assert_invariant(self):
        self.db.expire_all()
        for level in self.db.query(InventoryStockLevel).all():
            rows = self.db.query(InventoryReservation).filter_by(tenant_id=level.tenant_id, product_id=level.product_id, warehouse_id=level.warehouse_id).all()
            self.assertEqual(Decimal(level.reserved), sum((Decimal(row.quantity) for row in rows), Decimal(0)))
            self.assertLessEqual(Decimal(level.reserved), Decimal(level.on_hand))

    def test_confirmed_orders_hold_oldest_first_and_new_stock_fills_waiting_lines(self):
        self.stock(5)
        first = self.order((1, 5))
        second = self.order((1, 3))
        self.assertEqual(list(self.held(first).values()), [Decimal(5)])
        self.assertEqual(self.held(second), {})
        summary = order_fulfilment(self.db, tenant_id=10, order=second)
        self.assertEqual(summary["availability"], "waiting")
        self.assertEqual(summary["lines"][0]["waiting"], Decimal(3))

        self.stock(3)
        self.assertEqual(list(self.held(second).values()), [Decimal(3)])
        self.assertEqual(order_fulfilment(self.db, tenant_id=10, order=second)["availability"], "reserved")
        self.assertEqual(Decimal(self.level().reserved), Decimal(8))
        self.assert_invariant()

    def test_draft_orders_hold_nothing_and_confirming_reserves(self):
        self.stock(4)
        order = self.order((1, 2), status="draft")
        self.assertEqual(self.held(order), {})
        update_sales_order(self.db, order, {"status": "confirmed"}, actor_user_id=1)
        self.assertEqual(list(self.held(order).values()), [Decimal(2)])
        update_sales_order(self.db, order, {"status": "cancelled"}, actor_user_id=1)
        self.assertEqual(self.held(order), {})
        self.assert_invariant()

    def test_a_count_that_finds_less_releases_the_newest_automatic_hold_and_tells_its_owner(self):
        self.stock(6)
        older = self.order((1, 3))
        newer = self.order((1, 3))
        self.stock(-2)
        self.assertEqual(list(self.held(older).values()), [Decimal(3)])
        self.assertEqual(list(self.held(newer).values()), [Decimal(1)])
        notice = self.db.query(UserNotification).filter_by(user_id=1, category="sales_order_reservation").one()
        self.assertIn(newer.order_number, notice.message)
        self.assertIn("2 units of Camera", notice.message)
        self.assertEqual(self.db.query(ActivityLog).filter_by(entity_id=str(newer.id), action="sales_order.reservation_changed").count(), 1)
        self.assert_invariant()

    def test_planned_outbound_moves_cannot_take_held_stock(self):
        self.stock(3)
        self.order((1, 2))
        for move_type in ("delivery", "transfer_out", "sales_order"):
            with self.assertRaises(HTTPException) as error:
                post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(
                    product_id=1, warehouse_id=self.main.id, quantity=Decimal(-2), move_type=move_type,
                    source_type="test", source_id=1, source_line_id=1)])
            self.assertEqual(error.exception.status_code, 409)
            self.assertIn("short by 1", error.exception.detail)
            self.db.rollback()
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(
            product_id=1, warehouse_id=self.main.id, quantity=Decimal(-1), move_type="sales_order",
            source_type="test", source_id=1, source_line_id=1)])
        self.db.commit()
        self.assert_invariant()

    def test_editing_lines_keeps_their_ids_and_resizes_holds(self):
        self.stock(10)
        order = self.order((1, 4), (2, 1))
        camera_line, lens_line = sorted(order.items, key=lambda line: line.sort_order)
        updated = update_sales_order(self.db, order, {"items": [
            {"id": camera_line.id, "catalog_product_id": 1, "name": "Camera", "quantity": "2", "unit_price": "1"},
        ]}, actor_user_id=1)
        self.assertEqual([line.id for line in updated.items], [camera_line.id])
        self.assertEqual(self.held(updated), {camera_line.id: Decimal(2)})
        self.assertEqual(Decimal(self.level().reserved), Decimal(2))
        with self.assertRaises(HTTPException) as error:
            update_sales_order(self.db, updated, {"items": [{"id": lens_line.id, "name": "Gone", "quantity": "1", "unit_price": "1"}]}, actor_user_id=1)
        self.assertEqual(error.exception.status_code, 400)
        self.db.rollback()
        self.assert_invariant()

    def test_changing_the_order_warehouse_moves_its_holds(self):
        self.stock(2)
        second = InventoryWarehouse(tenant_id=10, code="EAST", name="East")
        self.db.add(second)
        self.db.commit()
        self.stock(5, warehouse_id=second.id)
        order = self.order((1, 3))
        self.assertEqual(list(self.held(order).values()), [Decimal(2)])
        update_sales_order(self.db, order, {"warehouse_id": second.id}, actor_user_id=1)
        rows = self.db.query(InventoryReservation).filter_by(order_id=order.id).all()
        self.assertEqual([(row.warehouse_id, Decimal(row.quantity)) for row in rows], [(second.id, Decimal(3))])
        self.assertEqual(Decimal(self.level().reserved), Decimal(0))
        self.assert_invariant()

    def test_fulfilling_uses_the_orders_own_holds_but_not_another_orders(self):
        self.stock(5)
        first = self.order((1, 3))
        second = self.order((1, 2))
        update_sales_order(self.db, first, {"status": "fulfilled"}, actor_user_id=1)
        self.assertEqual(Decimal(self.level().on_hand), Decimal(2))
        self.assertEqual(list(self.held(second).values()), [Decimal(2)])
        third = self.order((1, 1))
        with self.assertRaises(HTTPException) as error:
            update_sales_order(self.db, third, {"status": "fulfilled"}, actor_user_id=1)
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        self.assert_invariant()

    def test_users_can_move_holds_to_a_more_urgent_order(self):
        self.stock(6)
        older = self.order((1, 3))
        middle = self.order((1, 3))
        urgent = self.order((1, 3))
        version = reservation_version(self.db, tenant_id=10, product_id=1, warehouse_id=self.main.id)
        older_line, urgent_line = older.items[0].id, urgent.items[0].id
        set_reservations(self.db, tenant_id=10, actor_user_id=2, product_id=1, warehouse_id=self.main.id,
            holds=[(older_line, Decimal(0)), (urgent_line, Decimal(3))], expected_version=version)
        self.db.commit()
        self.assertEqual(self.held(older), {})
        self.assertEqual(self.held(urgent), {urgent_line: Decimal(3)})
        self.assertTrue(self.db.query(InventoryReservation).filter_by(order_line_id=urgent_line).one().manual)
        self.assertEqual(self.db.query(UserNotification).filter_by(user_id=1, category="sales_order_reservation").count(), 1)

        # A shortage now releases the middle order's automatic hold before the manual one.
        self.stock(-2)
        self.assertEqual(list(self.held(middle).values()), [Decimal(1)])
        self.assertEqual(self.held(urgent), {urgent_line: Decimal(3)})
        listing = product_reservations(self.db, tenant_id=10, product_id=1, warehouse_id=None)
        self.assertEqual([line["order_id"] for line in listing["lines"]], [older.id, middle.id, urgent.id])
        self.assertEqual(listing["available"], Decimal(0))
        self.assert_invariant()

    def test_reservation_edits_are_validated(self):
        self.stock(4)
        older = self.order((1, 3))
        newer = self.order((1, 3))
        line_a, line_b = older.items[0].id, newer.items[0].id
        version = reservation_version(self.db, tenant_id=10, product_id=1, warehouse_id=self.main.id)
        cases = [
            ([(line_b, Decimal(2))], "stale", 409),
            ([(line_a, Decimal(3)), (line_b, Decimal(2))], version, 409),  # above on hand
            ([(line_b, Decimal(4))], version, 409),  # above what the line needs
            ([(999, Decimal(1))], version, 404),
        ]
        for holds, token, code in cases:
            with self.assertRaises(HTTPException) as error:
                set_reservations(self.db, tenant_id=10, actor_user_id=1, product_id=1, warehouse_id=self.main.id, holds=holds, expected_version=token)
            self.assertEqual(error.exception.status_code, code)
            self.db.rollback()
        for product_id in (3, 99):
            with self.assertRaises(HTTPException) as error:
                set_reservations(self.db, tenant_id=10, actor_user_id=1, product_id=product_id, warehouse_id=self.main.id, holds=[(line_a, Decimal(0))], expected_version=version)
            self.assertEqual(error.exception.status_code, 404)
            self.db.rollback()
        self.assert_invariant()

    def test_rebuild_drops_holds_that_no_longer_apply_and_clamps_to_stock(self):
        self.stock(5)
        kept = self.order((1, 3))
        dropped = self.order((1, 2))
        # A restore can rewrite an order's status underneath its holds.
        self.db.query(SalesOrder).filter_by(id=dropped.id).update({"status": "cancelled"})
        self.db.query(InventoryStockLevel).filter_by(product_id=1).update({"reserved": 0})
        self.db.commit()
        rebuild_reservations(self.db, tenant_id=10)
        self.db.commit()
        self.assertEqual(self.held(dropped), {})
        self.assertEqual(list(self.held(kept).values()), [Decimal(3)])
        self.assertEqual(Decimal(self.level().reserved), Decimal(3))
        self.assert_invariant()

    def test_reserving_another_tenants_order_is_refused(self):
        order = self.order((1, 1))
        with self.assertRaises(HTTPException) as error:
            reserve_for_order(self.db, tenant_id=20, order=order)
        self.assertEqual(error.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
