"""13d §3.2 (Step 7, F5 slice 5.2): section and note lines, a percent discount, optional quote
lines and a unit on document lines."""

import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.services import credit_note_services, pos_invoice_services
from app.modules.finance.services.invoicing_services import draft_from_sources, invoicing_lines
from app.modules.inventory.services.stock_ledger import ensure_default_warehouse
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.purchasing.services import purchase_order_services as orders
from app.modules.sales.models import SalesOrganization
from app.modules.sales.services.orders_services import convert_quote_to_order, create_sales_order
from app.modules.sales.services.quotes_services import create_sales_quote
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus

TENANT = 10


class LineEditorTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT)
        self.db.add_all([
            Tenant(id=TENANT, slug="main", name="Main"),
            User(id=1, tenant_id=TENANT, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=TENANT, name="Main", operating_currencies=["USD"], base_currency="USD"),
            SalesOrganization(org_id=5, tenant_id=TENANT, org_name="Acme", primary_email="ap@acme.test", assigned_to=1),
            SalesOrganization(org_id=7, tenant_id=TENANT, org_name="Lens Supply", primary_email="s@lens.test", is_vendor=1, assigned_to=1),
            CatalogProduct(id=1, tenant_id=TENANT, name="Cable", currency="USD", public_unit_price=2, track_inventory=0, unit="metre", cost_price=1),
            CatalogService(id=2, tenant_id=TENANT, name="Install", currency="USD", public_unit_price=50, unit="hour"),
        ])
        self.db.commit()
        ensure_default_warehouse(self.db, tenant_id=TENANT)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_a_percent_discount_is_a_share_of_the_line(self):
        quote = create_sales_quote(self.db, {"customer_name": "Acme", "items": [
            {"name": "A", "quantity": "3", "unit_price": "33.33", "discount_percent": "10"}]}, self.user)
        line = quote.items[0]
        self.assertEqual(line.discount_percent, Decimal("10"))
        self.assertEqual(line.discount_amount, Decimal("10.00"))
        self.assertEqual(Decimal(quote.total_amount), Decimal("89.99"))
        with self.assertRaises(HTTPException):
            create_sales_quote(self.db, {"customer_name": "Acme", "items": [
                {"name": "A", "quantity": "1", "unit_price": "1", "discount_percent": "101"}]}, self.user)

    def test_sections_and_notes_carry_no_amounts(self):
        quote = create_sales_quote(self.db, {"customer_name": "Acme", "items": [
            {"name": "Hardware", "line_type": "section", "quantity": "5", "unit_price": "99", "catalog_product_id": 1},
            {"name": "Cable", "catalog_product_id": 1, "quantity": "10", "unit_price": "2"},
            {"name": "Cut to length on site.", "line_type": "note"},
        ]}, self.user)
        section, cable, note = quote.items
        self.assertEqual((section.line_type, section.line_total, section.catalog_product_id, section.tax_amount),
                         ("section", Decimal("0.00"), None, Decimal("0.00")))
        self.assertEqual(note.line_type, "note")
        self.assertEqual(Decimal(quote.total_amount), Decimal(cable.line_total))

    def test_optional_lines_stay_out_of_the_total_and_the_order(self):
        quote = create_sales_quote(self.db, {"customer_name": "Acme", "organization_id": 5, "status": "accepted", "items": [
            {"name": "Install", "catalog_service_id": 2, "quantity": "1", "unit_price": "50"},
            {"name": "Extended warranty", "quantity": "1", "unit_price": "30", "is_optional": True},
        ]}, self.user)
        self.assertEqual(Decimal(quote.total_amount), Decimal("50.00"))
        order = convert_quote_to_order(self.db, quote, self.user)
        self.db.commit()
        self.assertEqual([item.name for item in order.items], ["Install"])

    def test_an_invoice_from_an_order_brings_the_section_of_what_it_bills(self):
        order = create_sales_order(self.db, {"status": "confirmed", "organization_id": 5, "items": [
            {"name": "Labour", "line_type": "section"},
            {"name": "Install", "catalog_service_id": 2, "quantity": "2", "unit_price": "50"},
            {"name": "Parts", "line_type": "section"},
            {"name": "Note on parts", "line_type": "note"},
        ]}, self.user)
        self.db.commit()
        self.assertEqual([row["name"] for row in invoicing_lines(self.db, order=order)], ["Install"])
        invoice = draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        self.assertEqual([(line.line_type, line.description) for line in invoice.lines], [("section", "Labour"), ("item", "Install")])
        self.assertIsNone(invoice.lines[0].sales_order_item_id)
        self.assertIsNotNone(invoice.lines[1].sales_order_item_id)
        pos_invoice_services.issue_invoice(self.db, self.user, invoice.id)
        left = credit_note_services.creditable(self.db, invoice=invoice)
        self.assertNotIn(invoice.lines[0].id, left)

    def test_units_are_kept_and_po_lines_take_the_items(self):
        quote = create_sales_quote(self.db, {"customer_name": "Acme", "items": [
            {"name": "Cable", "catalog_product_id": 1, "quantity": "10", "unit_price": "2", "unit": "metre"},
            {"name": "Thing", "quantity": "1", "unit_price": "2", "unit": "unit"}]}, self.user)
        self.assertEqual([line.unit for line in quote.items], ["metre", None])
        order = orders.save_order(self.db, tenant_id=TENANT, actor_user_id=1, payload={"vendor_id": 7, "lines": [
            {"product_id": 1, "quantity": "100", "unit_cost": "1"}]})
        self.db.commit()
        self.assertEqual(order.lines[0].unit, "metre")


if __name__ == "__main__":
    unittest.main()
