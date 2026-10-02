import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.catalog.services import product_services
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.inventory.models import InventoryReservation, InventoryStockLevel, InventoryStockMove
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, ensure_product_levels, post_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import CrmEvent
from app.modules.purchasing.models import PurchaseOrder
from app.modules.purchasing.services import purchase_order_services as orders
from app.modules.purchasing.services import receipt_services as receipts
from app.modules.purchasing.services import reorder_services as reorder
from app.modules.sales.models import SalesOrganization
from app.modules.sales.schema import SalesOrganizationUpdate
from app.modules.sales.services.organizations_services import update_existing_organization
from app.modules.sales.services.orders_services import create_sales_order
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class PurchasingTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="buyer@example.com", is_active=UserStatus.active),
            SalesOrganization(org_id=5, tenant_id=10, org_name="Lens Supply", primary_email="a@lens.test", is_vendor=1),
            SalesOrganization(org_id=6, tenant_id=10, org_name="A Customer", primary_email="c@cust.test", is_vendor=0),
            SalesOrganization(org_id=7, tenant_id=20, org_name="Foreign Vendor", primary_email="f@x.test", is_vendor=1),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=10, cost_price=Decimal("6.5"),
                           track_inventory=1, stock_quantity=0, reorder_point=5, reorder_quantity=10, preferred_vendor_id=5),
            CatalogProduct(id=2, tenant_id=10, name="Manual", currency="USD", public_unit_price=1, track_inventory=0),
            CatalogProduct(id=3, tenant_id=20, name="Foreign", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=4, tenant_id=10, name="Tripod", currency="USD", public_unit_price=5, track_inventory=1, stock_quantity=0, reorder_point=2),
        ])
        self.db.commit()
        self.main = ensure_default_warehouse(self.db, tenant_id=10)
        # Creating a tracked product through the service gives it zero balances; these rows
        # were inserted directly, so do the same.
        for product_id in (1, 4):
            ensure_product_levels(self.db, tenant_id=10, product_id=product_id)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def po(self, quantity=10, unit_cost="7.25", product_id=1, place=True):
        order = orders.save_order(self.db, tenant_id=10, actor_user_id=1, payload={
            "vendor_id": 5, "lines": [{"product_id": product_id, "quantity": str(quantity), "unit_cost": unit_cost}]})
        self.db.commit()
        if place:
            orders.mark_ordered(self.db, tenant_id=10, actor_user_id=1, order_id=order.id)
            self.db.commit()
        return order

    def receive(self, order, quantity):
        receipt = receipts.save_receipt(self.db, tenant_id=10, actor_user_id=1, payload={
            "order_id": order.id, "lines": [{"order_line_id": order.lines[0].id, "quantity": str(quantity)}]})
        self.db.commit()
        receipts.post_receipt(self.db, tenant_id=10, actor_user_id=1, receipt_id=receipt.id)
        self.db.commit()
        return receipt

    def on_hand(self, product_id=1):
        self.db.expire_all()
        return Decimal(self.db.query(InventoryStockLevel).filter_by(product_id=product_id, warehouse_id=self.main.id).one().on_hand)

    def test_a_purchase_order_is_received_in_two_parts_at_its_cost(self):
        order = self.po()
        self.assertEqual(orders.incoming(self.db, tenant_id=10), {(1, self.main.id): Decimal(10)})
        self.receive(order, 4)
        self.db.refresh(order)
        self.assertEqual((order.status, order.receipt_status), ("ordered", "partial"))
        self.assertEqual(orders.incoming(self.db, tenant_id=10), {(1, self.main.id): Decimal(6)})
        self.receive(order, 6)
        self.db.refresh(order)
        self.assertEqual((order.status, order.receipt_status), ("received", "received"))
        self.assertEqual(self.on_hand(), Decimal(10))
        moves = self.db.query(InventoryStockMove).filter_by(source_type="purchase_receipt").all()
        self.assertEqual({(move.move_type, Decimal(move.unit_cost)) for move in moves}, {("receipt", Decimal("7.25"))})
        self.assertEqual(orders.incoming(self.db, tenant_id=10), {})

    def test_a_receipt_fills_waiting_sales_orders_first(self):
        sales_order = create_sales_order(self.db, {"status": "confirmed", "items": [{"catalog_product_id": 1, "name": "Camera", "quantity": "2", "unit_price": "10"}]}, self.user)
        order = self.po(3)
        self.receive(order, 3)
        held = sum((Decimal(row.quantity) for row in self.db.query(InventoryReservation).filter_by(order_id=sales_order.id)), Decimal(0))
        self.assertEqual(held, Decimal(2))
        event = self.db.query(CrmEvent).filter_by(event_type="purchase.receipt_posted").one()
        self.assertEqual(Decimal(event.payload["backorders_filled"]), Decimal(2))

    def test_cancelling_a_receipt_reverses_it_and_reopens_the_order(self):
        order = self.po(5)
        first = self.receive(order, 2)
        orders.close_remaining(self.db, tenant_id=10, actor_user_id=1, order_id=order.id, reason="Vendor ran out")
        self.db.commit()
        self.assertEqual(orders.incoming(self.db, tenant_id=10), {})
        receipts.cancel_receipt(self.db, tenant_id=10, actor_user_id=1, receipt_id=first.id, reason="Wrong product")
        self.db.commit()
        self.db.refresh(order)
        self.assertEqual((order.status, order.receipt_status), ("ordered", "none"))
        self.assertEqual(self.on_hand(), Decimal(0))
        self.assertEqual(orders.incoming(self.db, tenant_id=10), {(1, self.main.id): Decimal(5)})

    def test_over_receipt_and_early_close_are_refused(self):
        order = self.po(5)
        with self.assertRaises(HTTPException) as error:
            self.receive(order, 6)
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        with self.assertRaises(HTTPException) as error:
            orders.close_remaining(self.db, tenant_id=10, actor_user_id=1, order_id=order.id, reason="x")
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()

    def test_cancelling_is_allowed_only_before_anything_arrives(self):
        untouched = self.po(5)
        orders.cancel_order(self.db, tenant_id=10, actor_user_id=1, order_id=untouched.id, reason="Duplicate")
        self.db.commit()
        self.assertEqual(self.db.get(PurchaseOrder, untouched.id).status, "cancelled")
        started = self.po(5)
        self.receive(started, 1)
        with self.assertRaises(HTTPException) as error:
            orders.cancel_order(self.db, tenant_id=10, actor_user_id=1, order_id=started.id, reason="x")
        self.assertEqual(error.exception.status_code, 409)

    def test_vendors_and_products_are_validated_in_the_tenant(self):
        cases = [
            ({"vendor_id": 6, "lines": [{"product_id": 1, "quantity": "1", "unit_cost": "1"}]}, 400),  # not a vendor
            ({"vendor_id": 7, "lines": [{"product_id": 1, "quantity": "1", "unit_cost": "1"}]}, 404),  # other tenant
            ({"vendor_id": 5, "lines": [{"product_id": 2, "quantity": "1", "unit_cost": "1"}]}, 400),  # untracked
            ({"vendor_id": 5, "lines": [{"product_id": 3, "quantity": "1", "unit_cost": "1"}]}, 404),  # other tenant
        ]
        for payload, code in cases:
            with self.assertRaises(HTTPException) as error:
                orders.save_order(self.db, tenant_id=10, actor_user_id=1, payload=payload)
            self.assertEqual(error.exception.status_code, code)
            self.db.rollback()

    def test_a_placed_order_is_locked_and_a_draft_can_be_removed_and_restored(self):
        placed = self.po(2)
        with self.assertRaises(HTTPException) as error:
            orders.save_order(self.db, tenant_id=10, actor_user_id=1, order_id=placed.id, payload={
                "vendor_id": 5, "lines": [{"product_id": 1, "quantity": "9", "unit_cost": "1"}]})
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        draft = self.po(2, place=False)
        orders.delete_draft(self.db, tenant_id=10, actor_user_id=1, order_id=draft.id)
        self.db.commit()
        self.assertIsNone(orders.get_order(self.db, tenant_id=10, order_id=draft.id))
        orders.restore_draft(self.db, tenant_id=10, actor_user_id=1, order_id=draft.id)
        self.db.commit()
        self.assertIsNotNone(orders.get_order(self.db, tenant_id=10, order_id=draft.id))

    def test_reorder_suggests_what_falls_to_the_reorder_point_counting_backorders_and_incoming(self):
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(product_id=1, warehouse_id=self.main.id, quantity=Decimal(2),
            move_type="opening", source_type="test", source_id=1, source_line_id=1)])
        self.db.commit()
        rows = {row["product_id"]: row for row in reorder.suggestions(self.db, tenant_id=10)}
        self.assertEqual((rows[1]["projected"], rows[1]["suggested"]), (Decimal(2), Decimal(10)))
        self.assertEqual(rows[4]["suggested"], Decimal(2))
        self.po(10)
        rows = {row["product_id"]: row for row in reorder.suggestions(self.db, tenant_id=10)}
        self.assertNotIn(1, rows)
        # A backorder bigger than what is coming brings it back.
        create_sales_order(self.db, {"status": "confirmed", "items": [{"catalog_product_id": 1, "name": "Camera", "quantity": "9", "unit_price": "10"}]}, self.user)
        rows = {row["product_id"]: row for row in reorder.suggestions(self.db, tenant_id=10)}
        self.assertEqual((rows[1]["backordered"], rows[1]["incoming"], rows[1]["projected"]), (Decimal(7), Decimal(10), Decimal(3)))

    def test_drafting_from_reorder_groups_by_preferred_vendor_and_needs_one(self):
        with self.assertRaises(HTTPException) as error:
            reorder.create_draft_orders(self.db, tenant_id=10, actor_user_id=1, rows=[
                {"product_id": 1, "warehouse_id": self.main.id, "quantity": "10"}, {"product_id": 4, "warehouse_id": self.main.id, "quantity": "2"}])
        self.assertEqual(error.exception.status_code, 409)
        self.assertIn("Tripod", error.exception.detail)
        self.db.rollback()
        created = reorder.create_draft_orders(self.db, tenant_id=10, actor_user_id=1, rows=[{"product_id": 1, "warehouse_id": self.main.id, "quantity": "10"}])
        self.db.commit()
        self.assertEqual([(order.vendor_id, order.status, Decimal(order.lines[0].unit_cost)) for order in created], [(5, "draft", Decimal("6.5"))])

    def test_accounts_and_products_carry_the_vendor_fields(self):
        customer = self.db.get(SalesOrganization, 6)
        update_existing_organization(self.db, customer, SalesOrganizationUpdate(is_vendor=True), tenant_id=10)
        self.assertEqual(self.db.get(SalesOrganization, 6).is_vendor, 1)
        with self.assertRaises(HTTPException) as error:
            product_services.update_product(self.db, product=self.db.get(CatalogProduct, 4), actor_user_id=1, payload={"preferred_vendor_id": 7})
        self.assertEqual(error.exception.status_code, 400)
        self.db.rollback()
        updated = product_services.update_product(self.db, product=self.db.get(CatalogProduct, 4), actor_user_id=1,
            payload={"preferred_vendor_id": 6, "vendor_sku": " TRI-9 ", "lead_time_days": 4})
        self.assertEqual((updated.preferred_vendor_id, updated.vendor_sku, updated.lead_time_days), (6, "TRI-9", 4))


if __name__ == "__main__":
    unittest.main()
