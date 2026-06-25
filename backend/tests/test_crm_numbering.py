import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.models import CrmNumberCounter
from app.modules.platform.services.numbering import allocate_business_number
from app.modules.sales.models import SalesOrder, SalesQuote
from app.modules.sales.services.orders_services import create_sales_order
from app.modules.sales.services.quotes_services import create_sales_quote
from app.modules.support.models import SupportCase
from app.modules.support.services.cases_services import create_support_case
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class CrmNumberingTests(unittest.TestCase):
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
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_allocator_sequences_by_tenant_scope_and_day(self):
        timestamp = datetime(2026, 6, 25, 12, 0, tzinfo=timezone.utc)

        first = allocate_business_number(self.db, tenant_id=10, scope="sales_quotes", prefix="Q", timestamp=timestamp)
        second = allocate_business_number(self.db, tenant_id=10, scope="sales_quotes", prefix="Q", timestamp=timestamp)
        other_scope = allocate_business_number(self.db, tenant_id=10, scope="sales_orders", prefix="SO", timestamp=timestamp)
        other_tenant = allocate_business_number(self.db, tenant_id=99, scope="sales_quotes", prefix="Q", timestamp=timestamp)

        self.assertEqual(first, "Q-20260625-0001")
        self.assertEqual(second, "Q-20260625-0002")
        self.assertEqual(other_scope, "SO-20260625-0001")
        self.assertEqual(other_tenant, "Q-20260625-0001")
        counters = self.db.query(CrmNumberCounter).order_by(CrmNumberCounter.tenant_id, CrmNumberCounter.scope).all()
        self.assertEqual(len(counters), 3)

    def test_quote_order_and_support_use_distinct_counter_scopes(self):
        quote = create_sales_quote(
            self.db,
            {
                "customer_name": "Acme",
                "currency": "USD",
            },
            self.user,
        )
        order = create_sales_order(
            self.db,
            {
                "currency": "USD",
            },
            self.user,
        )
        case = create_support_case(self.db, {"subject": "Need help"}, self.user)

        self.assertTrue(quote.quote_number.startswith("Q-"))
        self.assertTrue(order.order_number.startswith("SO-"))
        self.assertTrue(case.case_number.startswith("CASE-"))
        self.assertEqual(self.db.query(SalesQuote).count(), 1)
        self.assertEqual(self.db.query(SalesOrder).count(), 1)
        self.assertEqual(self.db.query(SupportCase).count(), 1)
        self.assertEqual(
            {counter.scope for counter in self.db.query(CrmNumberCounter).all()},
            {"sales_quotes", "sales_orders", "support_cases"},
        )


if __name__ == "__main__":
    unittest.main()
