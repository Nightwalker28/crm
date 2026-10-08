"""13c §3.5 (Step 7, F4 slice 4.3): purchase order lines take services, non-stock products and
a discount; unit costs default from the vendor's last price."""

import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.inventory.models import InventoryStockMove
from app.modules.inventory.services.stock_ledger import ensure_default_warehouse, ensure_product_levels
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.purchasing.models import PurchaseBill, PurchaseOrder
from app.modules.purchasing.services import bill_services, purchase_order_services as orders, receipt_services
from app.modules.sales.models import SalesOrganization
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus

TENANT = 10


class PurchasingFixture(unittest.TestCase):
    """A tenant with two vendors, a tracked camera, a non-stock kit and a service; shared by the
    13c purchasing tests (RFQs, vendor returns, vendor credits)."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=TENANT, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=TENANT, email="buyer@example.com", is_active=UserStatus.active),
            SalesOrganization(org_id=5, tenant_id=TENANT, org_name="Lens Supply", primary_email="a@lens.test", is_vendor=1, assigned_to=1),
            SalesOrganization(org_id=6, tenant_id=TENANT, org_name="Grip Supply", primary_email="b@grip.test", is_vendor=1, assigned_to=1),
            CatalogProduct(id=1, tenant_id=TENANT, name="Camera", currency="USD", public_unit_price=10, track_inventory=1, stock_quantity=0, cost_price=4),
            CatalogProduct(id=2, tenant_id=TENANT, name="Cleaning kit", currency="USD", public_unit_price=3, track_inventory=0, cost_price=1),
            CatalogService(id=3, tenant_id=TENANT, name="Calibration", currency="USD", public_unit_price=80, cost_price=50),
            CatalogService(id=9, tenant_id=20, name="Foreign service", currency="USD", public_unit_price=1),
        ])
        self.db.commit()
        ensure_default_warehouse(self.db, tenant_id=TENANT)
        ensure_product_levels(self.db, tenant_id=TENANT, product_id=1)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def save(self, lines, vendor_id=5) -> PurchaseOrder:
        order = orders.save_order(self.db, tenant_id=TENANT, actor_user_id=1, payload={"vendor_id": vendor_id, "lines": lines})
        self.db.commit()
        return order

    def place(self, order) -> PurchaseOrder:
        orders.mark_ordered(self.db, tenant_id=TENANT, actor_user_id=1, order_id=order.id)
        self.db.commit()
        return order

    def receive_all(self, order):
        receipt = receipt_services.save_receipt(self.db, tenant_id=TENANT, actor_user_id=1, payload={"order_id": order.id})
        receipt_services.post_receipt(self.db, tenant_id=TENANT, actor_user_id=1, receipt_id=receipt.id)
        self.db.commit()
        return receipt

    def bill_all(self, order, reference="INV-1"):
        bill = bill_services.save_bill(self.db, tenant_id=TENANT, actor_user_id=1, payload={"order_id": order.id, "vendor_invoice_number": reference})
        bill_services.post_bill(self.db, tenant_id=TENANT, actor_user_id=1, bill_id=bill.id)
        self.db.commit()
        return bill


class PurchaseOrderLineTests(PurchasingFixture):
    def mixed(self):
        return self.place(self.save([
            {"product_id": 1, "quantity": "10", "unit_cost": "5", "discount_amount": "5"},
            {"product_id": 2, "quantity": "4", "unit_cost": "1.5"},
            {"catalog_service_id": 3, "quantity": "1", "unit_cost": "60"},
        ]))

    def test_lines_take_products_services_and_a_discount(self):
        order = self.mixed()
        camera, kit, calibration = sorted(order.lines, key=lambda line: line.sort_order)
        self.assertEqual(camera.line_total, Decimal("45.00"))
        self.assertEqual(camera.net_unit_cost, Decimal("4.5000"))
        self.assertTrue(kit.needs_receipt)
        self.assertFalse(calibration.needs_receipt)
        self.assertEqual(calibration.item_name, "Calibration")
        self.assertEqual(order.subtotal, Decimal("111.00"))

    def test_a_line_is_one_item_and_stays_in_the_tenant(self):
        for line, status in (({"product_id": 1, "catalog_service_id": 3, "quantity": "1"}, 400), ({"quantity": "1"}, 400),
                             ({"catalog_service_id": 9, "quantity": "1"}, 404)):
            with self.subTest(line=line), self.assertRaises(HTTPException) as caught:
                self.save([line])
            self.assertEqual(caught.exception.status_code, status)
            self.db.rollback()

    def test_a_discount_cannot_exceed_its_line(self):
        with self.assertRaises(HTTPException):
            self.save([{"product_id": 1, "quantity": "1", "unit_cost": "5", "discount_amount": "6"}])

    def test_services_are_billable_once_placed_and_never_received(self):
        order = self.mixed()
        self.assertEqual(order.bill_status, "to_bill")
        rows = bill_services.billing_lines(self.db, order=order)
        service = next(line for line in order.lines if line.catalog_service_id)
        self.assertEqual(rows[service.id]["to_bill"], Decimal("1"))
        with self.assertRaises(HTTPException) as caught:
            receipt_services.save_receipt(self.db, tenant_id=TENANT, actor_user_id=1,
                                          payload={"order_id": order.id, "lines": [{"order_line_id": service.id, "quantity": "1"}]})
        self.assertIn("service", caught.exception.detail)

    def test_a_non_stock_product_is_received_without_a_stock_move(self):
        order = self.mixed()
        receipt = receipt_services.save_receipt(self.db, tenant_id=TENANT, actor_user_id=1, payload={"order_id": order.id})
        self.db.commit()
        self.assertEqual(len(receipt.lines), 2)  # the camera and the kit; never the service
        receipt_services.post_receipt(self.db, tenant_id=TENANT, actor_user_id=1, receipt_id=receipt.id)
        self.db.commit()
        moves = self.db.query(InventoryStockMove).filter(InventoryStockMove.source_type == "purchase_receipt").all()
        self.assertEqual([(move.product_id, move.quantity) for move in moves], [(1, Decimal("10"))])
        # Received at the cost after the discount.
        self.assertEqual(moves[0].unit_cost, Decimal("4.5000"))
        self.db.refresh(order)
        self.assertEqual(order.receipt_status, "received")

    def test_a_bill_matches_the_net_cost_and_names_the_service(self):
        order = self.mixed()
        receipt = receipt_services.save_receipt(self.db, tenant_id=TENANT, actor_user_id=1, payload={"order_id": order.id})
        receipt_services.post_receipt(self.db, tenant_id=TENANT, actor_user_id=1, receipt_id=receipt.id)
        bill = bill_services.save_bill(self.db, tenant_id=TENANT, actor_user_id=1, payload={"order_id": order.id, "vendor_invoice_number": "INV-1"})
        self.db.commit()
        by_name = {line.description: line for line in bill.lines}
        self.assertEqual(by_name["Camera"].unit_cost, Decimal("4.5000"))
        self.assertEqual(by_name["Calibration"].catalog_service_id, 3)
        self.assertEqual(bill.match_status, "matched")

    def test_unit_cost_defaults_to_the_vendors_last_price_then_the_item_cost(self):
        self.assertEqual(orders.line_cost_default(self.db, tenant_id=TENANT, vendor_id=5, product_id=1), Decimal("4"))
        self.place(self.save([{"product_id": 1, "quantity": "1", "unit_cost": "4.25"}]))
        self.assertEqual(orders.line_cost_default(self.db, tenant_id=TENANT, vendor_id=5, product_id=1), Decimal("4.25"))
        # Another vendor has no history: the product's cost.
        self.assertEqual(orders.line_cost_default(self.db, tenant_id=TENANT, vendor_id=6, product_id=1), Decimal("4"))
        self.db.add(PurchaseBill(tenant_id=TENANT, number="B-1", vendor_id=5, vendor_invoice_number="X", bill_date=date.today(), status="posted"))
        self.db.flush()
        from app.modules.purchasing.models import PurchaseBillLine

        bill = self.db.query(PurchaseBill).filter(PurchaseBill.number == "B-1").one()
        self.db.add(PurchaseBillLine(tenant_id=TENANT, bill_id=bill.id, catalog_product_id=1, description="Camera", quantity=1, unit_cost=Decimal("3.90")))
        self.db.commit()
        self.assertEqual(orders.line_cost_default(self.db, tenant_id=TENANT, vendor_id=5, product_id=1), Decimal("3.9"))
        # A line saved without a cost takes the default.
        order = self.save([{"catalog_service_id": 3, "quantity": "2"}])
        self.assertEqual(order.lines[0].unit_cost, Decimal("50"))

    def test_recent_vendors_come_first(self):
        self.save([{"product_id": 1, "quantity": "1", "unit_cost": "1"}], vendor_id=6)
        self.save([{"product_id": 1, "quantity": "1", "unit_cost": "1"}], vendor_id=5)
        self.assertEqual(orders.recent_vendor_ids(self.db, tenant_id=TENANT)[:2], [5, 6])

    def test_incoming_stock_counts_products_only(self):
        self.mixed()
        incoming = orders.incoming(self.db, tenant_id=TENANT)
        self.assertEqual(set(product for product, _warehouse in incoming), {1, 2})


if __name__ == "__main__":
    unittest.main()
