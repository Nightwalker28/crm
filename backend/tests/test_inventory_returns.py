import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.inventory.models import InventoryStockLevel, InventoryStockMove
from app.modules.inventory.services import delivery_services, return_services
from app.modules.inventory.services.reservation_services import order_fulfilment
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, post_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import CrmEvent, UserNotification
from app.modules.platform.services.report_catalog import BUILT_IN_SOURCES
from app.modules.platform.services.report_templates import REPORT_TEMPLATES
from app.modules.sales.services.orders_services import create_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class ReturnTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            User(id=2, tenant_id=10, email="clerk@example.com", is_active=UserStatus.active),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
        ])
        self.db.commit()
        self.main = ensure_default_warehouse(self.db, tenant_id=10)
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(product_id=1, warehouse_id=self.main.id, quantity=Decimal(40),
            move_type="opening", source_type="test", source_id=1, source_line_id=1, reason="Opening")])
        self.db.commit()
        self.order = create_sales_order(self.db, {"status": "confirmed", "items": [
            {"catalog_product_id": 1, "name": "Camera", "quantity": "40", "unit_price": "1"}]}, self.user)
        self.delivery = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={"order_id": self.order.id})
        self.db.commit()
        delivery_services.post_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=self.delivery.id)
        self.db.commit()
        self.line = self.delivery.lines[0]

    def tearDown(self):
        self.db.close()

    def on_hand(self):
        self.db.expire_all()
        return Decimal(self.db.query(InventoryStockLevel).filter_by(product_id=1, warehouse_id=self.main.id).one().on_hand)

    def make_return(self, *lines, reason="Damaged in transit"):
        doc = return_services.save_return(self.db, tenant_id=10, actor_user_id=2, payload={
            "delivery_id": self.delivery.id, "reason": reason,
            "lines": [{"delivery_line_id": self.line.id, "quantity": str(quantity), "restock": restock} for quantity, restock in lines]})
        self.db.commit()
        return doc

    def test_a_partly_restocked_return_adds_only_the_restocked_units(self):
        self.assertEqual(self.on_hand(), Decimal(0))
        # Two lines for one delivery line are not allowed, so restock is per return here.
        restocked = self.make_return((3, True))
        damaged = self.make_return((2, False), reason="Broken")
        for doc in (restocked, damaged):
            return_services.receive_return(self.db, tenant_id=10, actor_user_id=2, return_id=doc.id)
            self.db.commit()
        self.assertEqual(self.on_hand(), Decimal(3))
        moves = self.db.query(InventoryStockMove).filter_by(source_type="inventory_return").all()
        self.assertEqual([(move.move_type, Decimal(move.quantity)) for move in moves], [("return", Decimal(3))])
        summary = order_fulfilment(self.db, tenant_id=10, order=self.order)
        self.assertEqual((summary["lines"][0]["delivered"], summary["lines"][0]["returned"]), (Decimal(40), Decimal(5)))
        self.assertEqual(self.order.status, "fulfilled")
        events = [row.event_type for row in self.db.query(CrmEvent).all()]
        self.assertEqual(events.count("inventory.return_received"), 2)

        # Only 35 of the 40 shipped can still come back.
        with self.assertRaises(HTTPException) as error:
            self.make_return((36, True))
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("35", error.exception.detail)
        self.db.rollback()

    def test_cancelling_a_received_return_takes_its_stock_back_out(self):
        doc = self.make_return((4, True))
        return_services.receive_return(self.db, tenant_id=10, actor_user_id=2, return_id=doc.id)
        self.db.commit()
        return_services.cancel_return(self.db, tenant_id=10, actor_user_id=2, return_id=doc.id, reason="Logged twice")
        self.db.commit()
        self.assertEqual(self.on_hand(), Decimal(0))
        self.assertEqual(order_fulfilment(self.db, tenant_id=10, order=self.order)["lines"][0]["returned"], Decimal(0))

    def test_a_delivery_with_returns_cannot_be_cancelled(self):
        self.make_return((1, True))
        with self.assertRaises(HTTPException) as error:
            delivery_services.cancel_delivery(self.db, tenant_id=10, actor_user_id=1, delivery_id=self.delivery.id, reason="Mistake")
        self.assertEqual(error.exception.status_code, 409)

    def test_a_new_return_defaults_to_everything_that_can_come_back(self):
        doc = return_services.save_return(self.db, tenant_id=10, actor_user_id=2, payload={"delivery_id": self.delivery.id, "reason": "Unwanted"})
        self.assertEqual([(Decimal(line.quantity), bool(line.restock)) for line in doc.lines], [(Decimal(40), True)])

    def test_returns_are_tenant_scoped_and_need_a_posted_delivery(self):
        with self.assertRaises(HTTPException) as error:
            return_services.save_return(self.db, tenant_id=20, actor_user_id=2, payload={"delivery_id": self.delivery.id, "reason": "x"})
        self.assertEqual(error.exception.status_code, 404)
        self.db.rollback()
        return_services.receive_return(self.db, tenant_id=10, actor_user_id=2, return_id=self.make_return((1, True)).id)
        self.db.commit()
        second = create_sales_order(self.db, {"status": "confirmed", "items": [{"catalog_product_id": 1, "name": "Camera", "quantity": "1", "unit_price": "1"}]}, self.user)
        draft = delivery_services.save_delivery(self.db, tenant_id=10, actor_user_id=1, payload={"order_id": second.id})
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            return_services.save_return(self.db, tenant_id=10, actor_user_id=2, payload={"delivery_id": draft.id, "reason": "x"})
        self.assertEqual(error.exception.status_code, 409)

    def test_reports_cover_deliveries_backorders_and_returns(self):
        for key in ("inventory_deliveries", "inventory_backorders", "inventory_returns"):
            self.assertIn(key, BUILT_IN_SOURCES)
        templates = {template["key"]: template["module_key"] for template in REPORT_TEMPLATES}
        self.assertEqual(templates["backorders-by-product"], "inventory_backorders")
        self.assertEqual(templates["returns-by-reason"], "inventory_returns")
        user = SimpleNamespace(id=1, tenant_id=10)
        source = BUILT_IN_SOURCES["inventory_backorders"]
        self.assertEqual(source.base_query(self.db, user, None).count(), 0)
        second = create_sales_order(self.db, {"status": "confirmed", "items": [{"catalog_product_id": 1, "name": "Camera", "quantity": "2", "unit_price": "1"}]}, self.user)
        rows = source.base_query(self.db, user, None).all()
        self.assertEqual([row.order_id for row in rows], [second.id])

    def test_stock_arriving_for_a_waiting_order_tells_its_owner_it_is_ready(self):
        waiting = create_sales_order(self.db, {"status": "confirmed", "items": [{"catalog_product_id": 1, "name": "Camera", "quantity": "2", "unit_price": "1"}]}, self.user)
        self.db.query(UserNotification).delete()
        self.db.commit()
        doc = self.make_return((2, True))
        return_services.receive_return(self.db, tenant_id=10, actor_user_id=2, return_id=doc.id)
        self.db.commit()
        notice = self.db.query(UserNotification).filter_by(user_id=1).one()
        self.assertIn(waiting.order_number, notice.title)


if __name__ == "__main__":
    unittest.main()
