import unittest
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import create_pagination
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.sales.services.orders_services import convert_quote_to_order, create_sales_order, get_order_by_quote, list_sales_orders
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class SalesOrderTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
                User(id=2, tenant_id=99, email="other@example.com", first_name="Other", last_name="User", is_active=UserStatus.active),
                SalesOrganization(org_id=20, tenant_id=10, org_name="Acme", primary_email="hello@acme.test"),
                SalesContact(contact_id=30, tenant_id=10, first_name="Ada", primary_email="ada@acme.test", assigned_to=1, organization_id=20),
                SalesOpportunity(opportunity_id=40, tenant_id=10, opportunity_name="Acme Pilot", client="Ada", contact_id=30, organization_id=20),
                SalesQuote(
                    quote_id=50,
                    tenant_id=10,
                    quote_number="Q-500",
                    title="Pilot package",
                    customer_name="Acme",
                    contact_id=30,
                    organization_id=20,
                    opportunity_id=40,
                    status="accepted",
                    currency="USD",
                    subtotal_amount=Decimal("1000"),
                    discount_amount=Decimal("50"),
                    tax_amount=Decimal("95"),
                    total_amount=Decimal("1045"),
                    assigned_to=1,
                ),
                SalesQuote(
                    quote_id=51,
                    tenant_id=10,
                    quote_number="Q-501",
                    customer_name="Acme",
                    status="draft",
                    currency="USD",
                    total_amount=Decimal("100"),
                ),
                SalesQuote(
                    quote_id=99,
                    tenant_id=99,
                    quote_number="Q-999",
                    customer_name="Other",
                    status="accepted",
                    currency="USD",
                    total_amount=Decimal("500"),
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_accepted_quote_converts_to_order_with_snapshot_item(self):
        quote = self.db.query(SalesQuote).filter(SalesQuote.quote_id == 50).one()

        order = convert_quote_to_order(self.db, quote, self.user)

        self.assertEqual(order.tenant_id, 10)
        self.assertEqual(order.quote_id, 50)
        self.assertEqual(order.status, "confirmed")
        self.assertEqual(order.currency, "USD")
        self.assertEqual(order.grand_total, Decimal("1045.00"))
        self.assertEqual(len(order.items), 1)
        self.assertEqual(order.items[0].name, "Pilot package")
        self.assertEqual(order.items[0].line_total, Decimal("1045.00"))
        self.assertEqual(get_order_by_quote(self.db, tenant_id=10, quote_id=50).id, order.id)

    def test_draft_quote_cannot_convert(self):
        quote = self.db.query(SalesQuote).filter(SalesQuote.quote_id == 51).one()

        with self.assertRaises(HTTPException) as exc:
            convert_quote_to_order(self.db, quote, self.user)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Only accepted quotes can be converted to orders")

    def test_duplicate_quote_conversion_is_blocked(self):
        quote = self.db.query(SalesQuote).filter(SalesQuote.quote_id == 50).one()
        convert_quote_to_order(self.db, quote, self.user)

        with self.assertRaises(HTTPException) as exc:
            convert_quote_to_order(self.db, quote, self.user)

        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(self.db.query(SalesOrder).filter(SalesOrder.quote_id == 50).count(), 1)

    def test_create_order_rejects_cross_tenant_quote(self):
        with self.assertRaises(HTTPException) as exc:
            create_sales_order(
                self.db,
                {
                    "quote_id": 99,
                    "order_number": "SO-X",
                    "currency": "USD",
                    "grand_total": "500",
                    "items": [{"name": "Manual item", "line_total": "500"}],
                },
                self.user,
            )

        self.assertEqual(exc.exception.status_code, 404)

    def test_order_list_sorts_before_pagination(self):
        self.db.add_all(
            [
                SalesOrder(
                    id=61,
                    tenant_id=10,
                    order_number="SO-103",
                    status="confirmed",
                    currency="USD",
                    grand_total=Decimal("300.00"),
                    owner_id=1,
                ),
                SalesOrder(
                    id=62,
                    tenant_id=10,
                    order_number="SO-101",
                    status="confirmed",
                    currency="USD",
                    grand_total=Decimal("100.00"),
                    owner_id=1,
                ),
                SalesOrder(
                    id=63,
                    tenant_id=10,
                    order_number="SO-102",
                    status="confirmed",
                    currency="USD",
                    grand_total=Decimal("200.00"),
                    owner_id=1,
                ),
            ]
        )
        self.db.commit()

        orders, total_count = list_sales_orders(
            self.db,
            tenant_id=10,
            pagination=create_pagination(1, 2),
            sort_by="order_number",
            sort_direction="asc",
        )

        self.assertEqual(total_count, 3)
        self.assertEqual([order.order_number for order in orders], ["SO-101", "SO-102"])


if __name__ == "__main__":
    unittest.main()
