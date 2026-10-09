"""13d §3.1 (Step 7, F5 slice 5.1): tax rates and groups, the shared line computation, which rate
a line gets, the tax summary, and tax flowing from quote to order to invoice and PO to bill."""

import importlib.util
import pathlib
import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct, CatalogService
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.services import pos_invoice_services, tax_rates
from app.modules.finance.services.document_amounts import compute_line, document_totals
from app.modules.finance.services.invoicing_services import draft_from_sources
from app.modules.inventory.services.stock_ledger import ensure_default_warehouse
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.purchasing.services import bill_services, purchase_order_services as orders
from app.modules.sales.models import SalesOrganization
from app.modules.sales.services.orders_services import convert_quote_to_order, create_sales_order, update_sales_order
from app.modules.sales.services.quotes_services import create_sales_quote, update_sales_quote
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus

TENANT = 10


class ComputeLineTests(unittest.TestCase):
    def test_exclusive_adds_the_rate_to_the_net(self):
        line = compute_line(quantity=Decimal("3"), unit_price=Decimal("33.33"), discount=Decimal("9.99"), rate=Decimal("10"))
        self.assertEqual((line.gross, line.discount, line.net, line.tax, line.total),
                         (Decimal("99.99"), Decimal("9.99"), Decimal("90.00"), Decimal("9.00"), Decimal("99.00")))

    def test_inclusive_takes_the_tax_out_of_the_price(self):
        line = compute_line(quantity=Decimal("1"), unit_price=Decimal("110"), rate=Decimal("10"), inclusive=True)
        self.assertEqual((line.net, line.tax, line.total), (Decimal("100.00"), Decimal("10.00"), Decimal("110.00")))
        self.assertEqual(line.gross - line.discount + line.tax, line.total)

    def test_inclusive_with_a_discount_keeps_the_identity(self):
        line = compute_line(quantity=Decimal("2"), unit_price=Decimal("55"), discount=Decimal("11"), rate=Decimal("10"), inclusive=True)
        self.assertEqual(line.total, Decimal("99.00"))
        self.assertEqual(line.net, Decimal("90.00"))
        self.assertEqual(line.gross - line.discount + line.tax, line.total)

    def test_manual_keeps_the_typed_tax(self):
        line = compute_line(quantity=Decimal("1"), unit_price=Decimal("10"), tax=Decimal("1.234"))
        self.assertEqual(line.tax, Decimal("1.23"))
        with self.assertRaises(HTTPException):
            compute_line(quantity=Decimal("1"), unit_price=Decimal("10"), tax=Decimal("11"), inclusive=True)

    def test_rounding_is_half_up_per_line(self):
        line = compute_line(quantity=Decimal("1"), unit_price=Decimal("0.05"), rate=Decimal("10"))
        self.assertEqual(line.tax, Decimal("0.01"))

    def test_totals_add_up(self):
        lines = [compute_line(quantity=Decimal("1"), unit_price=Decimal("10"), rate=Decimal("5")),
                 compute_line(quantity=Decimal("2"), unit_price=Decimal("5"), discount=Decimal("1"), rate=Decimal("20"))]
        totals = document_totals(lines)
        self.assertEqual(totals["subtotal"] - totals["discount"] + totals["tax"], totals["total"])


class TaxFixture(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT)
        self.db.add_all([
            Tenant(id=TENANT, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=TENANT, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=TENANT, name="Main", operating_currencies=["USD"], base_currency="USD"),
            SalesOrganization(org_id=5, tenant_id=TENANT, org_name="Acme", primary_email="ap@acme.test", assigned_to=1),
            SalesOrganization(org_id=6, tenant_id=TENANT, org_name="Charity", primary_email="c@charity.test", tax_exempt=True, assigned_to=1),
            SalesOrganization(org_id=7, tenant_id=TENANT, org_name="Lens Supply", primary_email="s@lens.test", is_vendor=1, assigned_to=1),
        ])
        self.db.commit()
        self.vat = self.rate("VAT 20%", "20", is_default_sales=True, is_default_purchases=True)
        self.reduced = self.rate("Reduced 5%", "5")
        self.db.add_all([
            CatalogProduct(id=1, tenant_id=TENANT, name="Book", currency="USD", public_unit_price=10, track_inventory=0,
                           tax_rate_id=self.reduced.id, purchase_tax_rate_id=self.reduced.id, cost_price=4),
            CatalogService(id=2, tenant_id=TENANT, name="Setup", currency="USD", public_unit_price=50),
        ])
        self.db.commit()
        ensure_default_warehouse(self.db, tenant_id=TENANT)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def rate(self, name, value, **flags):
        rate = tax_rates.create_tax_rate(self.db, tenant_id=TENANT, actor_user_id=1, payload={"name": name, "rate": value, **flags})
        self.db.commit()
        return rate


class TaxRateSettingsTests(TaxFixture):
    def test_one_default_per_side(self):
        other = self.rate("Zero", "0", is_default_sales=True)
        self.db.refresh(self.vat)
        self.assertTrue(other.is_default_sales)
        self.assertFalse(self.vat.is_default_sales)
        self.assertTrue(self.vat.is_default_purchases)

    def test_a_group_sums_its_members_and_the_summary_splits_it(self):
        state = self.rate("State 6%", "6")
        city = self.rate("City 2%", "2")
        group = tax_rates.create_tax_rate(self.db, tenant_id=TENANT, actor_user_id=1,
                                          payload={"name": "State + city", "kind": "group", "member_ids": [state.id, city.id]})
        self.db.commit()
        self.assertEqual(Decimal(group.rate), Decimal("8"))
        quote = create_sales_quote(self.db, {"customer_name": "Acme", "organization_id": 5, "items": [
            {"name": "Thing", "quantity": "1", "unit_price": "100", "tax_rate_id": group.id}]}, self.user)
        self.assertEqual(Decimal(quote.tax_amount), Decimal("8.00"))
        summary = {row["name"]: row["tax"] for row in quote.tax_summary}
        self.assertEqual(summary, {"State 6%": Decimal("6.00"), "City 2%": Decimal("2.00")})

    def test_a_rate_in_use_cannot_change_or_be_deleted(self):
        create_sales_quote(self.db, {"customer_name": "Acme", "items": [{"name": "A", "quantity": "1", "unit_price": "10"}]}, self.user)
        self.db.refresh(self.vat)
        with self.assertRaises(HTTPException) as error:
            tax_rates.update_tax_rate(self.db, self.vat, actor_user_id=1, payload={"rate": "21"})
        self.assertEqual(error.exception.status_code, 409)
        with self.assertRaises(HTTPException):
            tax_rates.delete_tax_rate(self.db, self.vat, actor_user_id=1)
        tax_rates.update_tax_rate(self.db, self.vat, actor_user_id=1, payload={"is_active": False})
        self.assertFalse(self.vat.is_default_sales)

    def test_an_inactive_rate_is_refused_on_new_lines(self):
        tax_rates.update_tax_rate(self.db, self.reduced, actor_user_id=1, payload={"is_active": False})
        self.db.commit()
        with self.assertRaises(HTTPException):
            create_sales_quote(self.db, {"customer_name": "Acme", "items": [
                {"name": "A", "quantity": "1", "unit_price": "10", "tax_rate_id": self.reduced.id}]}, self.user)

    def test_another_tenants_rate_is_refused(self):
        foreign = tax_rates.create_tax_rate(self.db, tenant_id=20, actor_user_id=None, payload={"name": "Foreign", "rate": "1"})
        self.db.commit()
        with self.assertRaises(HTTPException):
            create_sales_quote(self.db, {"customer_name": "Acme", "items": [
                {"name": "A", "quantity": "1", "unit_price": "10", "tax_rate_id": foreign.id}]}, self.user)


class LineRateTests(TaxFixture):
    def quote(self, items, **header):
        return create_sales_quote(self.db, {"customer_name": "Acme", "organization_id": 5, "items": items, **header}, self.user)

    def test_precedence_line_then_exempt_then_item_then_default(self):
        quote = self.quote([
            {"name": "Chosen", "quantity": "1", "unit_price": "100", "tax_rate_id": self.reduced.id},
            {"catalog_product_id": 1, "name": "Book", "quantity": "1", "unit_price": "100"},
            {"name": "Free text", "quantity": "1", "unit_price": "100"},
        ])
        rates = [line.tax_rate_id for line in quote.items]
        self.assertEqual(rates, [self.reduced.id, self.reduced.id, self.vat.id])
        self.assertEqual([line.tax_amount for line in quote.items], [Decimal("5.00"), Decimal("5.00"), Decimal("20.00")])
        exempt = create_sales_quote(self.db, {"customer_name": "Charity", "organization_id": 6, "items": [
            {"catalog_product_id": 1, "name": "Book", "quantity": "1", "unit_price": "100"}]}, self.user)
        self.assertIsNone(exempt.items[0].tax_rate_id)
        self.assertEqual(Decimal(exempt.tax_amount), Decimal("0.00"))

    def test_manual_and_no_tax(self):
        quote = self.quote([
            {"name": "Typed", "quantity": "1", "unit_price": "100", "tax_amount": "7"},
            {"name": "None", "quantity": "1", "unit_price": "100", "tax_manual": True, "tax_amount": "0"},
        ])
        self.assertEqual([(line.tax_manual, line.tax_amount) for line in quote.items], [(True, Decimal("7.00")), (True, Decimal("0.00"))])

    def test_switching_to_inclusive_recomputes_the_lines(self):
        quote = self.quote([{"name": "A", "quantity": "1", "unit_price": "120"}])
        self.assertEqual(Decimal(quote.total_amount), Decimal("144.00"))
        quote = update_sales_quote(self.db, quote, {"tax_mode": "inclusive"})
        self.assertEqual(Decimal(quote.total_amount), Decimal("120.00"))
        self.assertEqual(Decimal(quote.tax_amount), Decimal("20.00"))
        self.assertEqual(Decimal(quote.subtotal_amount), Decimal("100.00"))

    def test_the_company_default_mode_applies(self):
        profile = self.db.get(CompanyProfile, 1)
        profile.default_tax_mode = "inclusive"
        self.db.commit()
        quote = self.quote([{"name": "A", "quantity": "1", "unit_price": "120"}])
        self.assertEqual(quote.tax_mode, "inclusive")
        self.assertEqual(Decimal(quote.total_amount), Decimal("120.00"))


class FlowTests(TaxFixture):
    def test_quote_to_order_to_invoice_keeps_the_rate_and_amounts(self):
        quote = create_sales_quote(self.db, {"customer_name": "Acme", "organization_id": 5, "status": "accepted", "items": [
            {"name": "Setup", "catalog_service_id": 2, "quantity": "3", "unit_price": "33.33", "discount_amount": "9.99"}]}, self.user)
        # A later rate change on the item must not reach the order.
        self.db.get(CatalogService, 2).tax_rate_id = self.reduced.id
        self.db.commit()
        order = convert_quote_to_order(self.db, quote, self.user)
        self.db.commit()
        line = order.items[0]
        self.assertEqual((line.tax_rate_id, line.tax_amount, line.line_total), (self.vat.id, Decimal("18.00"), Decimal("108.00")))
        self.assertEqual(Decimal(order.grand_total), Decimal(quote.total_amount))
        invoice = draft_from_sources(self.db, self.user, sources=[{"order_id": order.id}])
        self.assertEqual(invoice.lines[0].tax_rate_id, self.vat.id)
        self.assertEqual(Decimal(invoice.subtotal_amount), Decimal("99.99"))
        self.assertEqual(Decimal(invoice.discount_amount), Decimal("9.99"))
        self.assertEqual(Decimal(invoice.total_amount), Decimal("108.00"))

    def test_an_order_with_an_untouched_line_keeps_its_tax_on_a_mode_change(self):
        order = create_sales_order(self.db, {"status": "draft", "organization_id": 5, "items": [
            {"name": "A", "quantity": "1", "unit_price": "100"}]}, self.user)
        self.db.commit()
        order = update_sales_order(self.db, order, {"tax_mode": "inclusive"})
        self.assertEqual(Decimal(order.grand_total), Decimal("100.00"))
        self.assertEqual(order.items[0].tax_rate_id, self.vat.id)

    def test_an_invoice_line_takes_the_default_rate(self):
        invoice = pos_invoice_services.create_invoice(self.db, self.user, {
            "customer_name": "Acme", "customer_organization_id": 5, "lines": [{"description": "Work", "quantity": 1, "unit_price": 50}]})
        self.assertEqual(Decimal(invoice.tax_amount), Decimal("10.00"))
        self.assertEqual(invoice.tax_summary[0]["name"], "VAT 20%")

    def test_po_tax_reaches_the_bill(self):
        order = orders.save_order(self.db, tenant_id=TENANT, actor_user_id=1, payload={"vendor_id": 7, "lines": [
            {"product_id": 1, "quantity": "10", "unit_cost": "4"}]})
        self.db.commit()
        line = order.lines[0]
        self.assertEqual((line.tax_rate_id, line.tax_amount, line.net_unit_cost), (self.reduced.id, Decimal("2.00"), Decimal("4.0000")))
        self.assertEqual((Decimal(order.subtotal), Decimal(order.tax_total), Decimal(order.total)),
                         (Decimal("40.00"), Decimal("2.00"), Decimal("42.00")))
        orders.mark_ordered(self.db, tenant_id=TENANT, actor_user_id=1, order_id=order.id)
        self.db.commit()
        bill = bill_services.save_bill(self.db, tenant_id=TENANT, actor_user_id=1, payload={"order_id": order.id, "vendor_invoice_number": "S-1"})
        self.db.commit()
        self.assertEqual(bill.lines[0].tax_rate_id, self.reduced.id)
        self.assertEqual(Decimal(bill.tax_total), Decimal("2.00"))


class MigrationSpreadTests(unittest.TestCase):
    def test_spread_gives_the_remainder_to_the_last_line(self):
        path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20261016_tax_rates.py"
        spec = importlib.util.spec_from_file_location("tax_rates_migration", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        shares = module._spread(Decimal("10.00"), [Decimal("1"), Decimal("1"), Decimal("1")])
        self.assertEqual(shares, [Decimal("3.33"), Decimal("3.33"), Decimal("3.34")])
        self.assertEqual(module._spread(Decimal("5"), [Decimal("0")]), [Decimal("5")])


if __name__ == "__main__":
    unittest.main()
