"""13c §3.3 (owner decision 6): sales order import, one CSV row per line."""

import unittest
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import ActivityLog
from app.modules.sales.models import SalesContact, SalesOrder, SalesOrganization
from app.modules.sales.services.orders_import import import_orders_from_csv
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus

HEADER = "order_reference,account,contact_email,currency,item,description,quantity,unit_price,discount_amount\n"


class SalesOrderImportTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="default", name="Default"),
            Tenant(id=99, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", is_active=UserStatus.active),
            SalesOrganization(org_id=5, tenant_id=10, org_name="Acme Ltd", primary_email="buy@acme.test", assigned_to=1),
            SalesOrganization(org_id=6, tenant_id=10, org_name="Other Co", primary_email="buy@other.test", assigned_to=1),
            SalesOrganization(org_id=7, tenant_id=99, org_name="Foreign Ltd", primary_email="x@foreign.test"),
            SalesContact(contact_id=30, tenant_id=10, first_name="Ada", primary_email="ada@acme.test", organization_id=5),
            CatalogProduct(id=1, tenant_id=10, name="Camera", sku="CAM-1", currency="USD", public_unit_price=120, track_inventory=0),
            CatalogService(id=2, tenant_id=10, name="Setup", sku="SVC-1", currency="USD", public_unit_price=50),
            CatalogProduct(id=3, tenant_id=99, name="Foreign camera", sku="FCAM", currency="USD", public_unit_price=1),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def run_import(self, body: str) -> dict:
        return import_orders_from_csv(self.db, (HEADER + body).encode(), current_user=self.user)

    def test_rows_sharing_a_reference_become_one_draft_order(self):
        summary = self.run_import(
            "EXT-1,Acme Ltd,ada@acme.test,usd,CAM-1,Body only,2,100,10\n"
            "EXT-1,Acme Ltd,ada@acme.test,usd,Setup,,1,,\n"
            "EXT-2,Other Co,,,cam-1,,1,,\n"
        )
        self.assertEqual((summary["new_rows"], summary["failed_rows"]), (3, 0))
        first = self.db.query(SalesOrder).filter(SalesOrder.external_reference == "EXT-1").one()
        self.assertEqual((first.status, first.organization_id, first.contact_id, first.currency), ("draft", 5, 30, "USD"))
        lines = sorted(first.items, key=lambda line: line.sort_order)
        self.assertEqual([(line.catalog_product_id, line.catalog_service_id) for line in lines], [(1, None), (None, 2)])
        self.assertEqual(lines[0].line_total, Decimal("190.00"))
        # No price in the file: the item's list price.
        self.assertEqual(lines[1].unit_price, Decimal("50"))
        self.assertEqual(self.db.query(ActivityLog).filter(ActivityLog.module_key == "sales_orders", ActivityLog.entity_id == str(first.id)).count(), 1)

    def test_one_bad_row_refuses_its_whole_order_only(self):
        summary = self.run_import(
            "EXT-1,Acme Ltd,,,CAM-1,,1,,\n"
            "EXT-1,Acme Ltd,,,NOPE,,1,,\n"
            "EXT-2,Acme Ltd,,,CAM-1,,1,,\n"
        )
        self.assertEqual((summary["new_rows"], summary["failed_rows"]), (1, 2))
        self.assertEqual([row.external_reference for row in self.db.query(SalesOrder).all()], ["EXT-2"])
        reasons = {failure["reason"] for failure in summary["failures"]}
        self.assertEqual(reasons, {"No product or service has the SKU or name 'NOPE'"})

    def test_another_tenants_records_are_never_matched(self):
        summary = self.run_import("EXT-1,Foreign Ltd,,,CAM-1,,1,,\nEXT-2,Acme Ltd,,,FCAM,,1,,\n")
        self.assertEqual(summary["new_rows"], 0)
        self.assertEqual(self.db.query(SalesOrder).count(), 0)

    def test_rows_of_one_order_must_agree_and_a_contact_must_belong_to_the_account(self):
        summary = self.run_import(
            "EXT-1,Acme Ltd,,,CAM-1,,1,,\nEXT-1,Other Co,,,CAM-1,,1,,\n"
            "EXT-2,Other Co,ada@acme.test,,CAM-1,,1,,\n"
        )
        self.assertEqual(summary["new_rows"], 0)
        reasons = sorted({failure["reason"] for failure in summary["failures"]})
        self.assertEqual(reasons, ["The rows of this order disagree on account", "ada@acme.test belongs to another account"])

    def test_importing_the_same_file_twice_skips_what_it_made(self):
        body = "EXT-1,Acme Ltd,,,CAM-1,,1,,\n"
        self.run_import(body)
        summary = self.run_import(body)
        self.assertEqual((summary["new_rows"], summary["skipped_rows"]), (0, 1))
        self.assertEqual(self.db.query(SalesOrder).count(), 1)

    def test_missing_reference_quantity_or_number_is_reported_per_row(self):
        summary = self.run_import(",Acme Ltd,,,CAM-1,,1,,\nEXT-3,Acme Ltd,,,CAM-1,,abc,,\nEXT-4,Acme Ltd,,,CAM-1,,0,,\n")
        self.assertEqual(summary["new_rows"], 0)
        reasons = [failure["reason"] for failure in summary["failures"]]
        self.assertIn("order_reference is required", reasons)
        self.assertIn("quantity must be a number, not 'abc'", reasons)
        self.assertIn("quantity must be more than zero", reasons)


if __name__ == "__main__":
    unittest.main()
