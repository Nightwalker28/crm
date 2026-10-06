"""Deal totals never add different currencies (13a H5)."""

import unittest
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.inventory.services.costing import BaseCurrencyTotals
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.services.module_reports import generate_crm_dashboard_summary
from app.modules.sales.models import SalesOpportunity, SalesOrder
from app.modules.sales.services import opportunities_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User, UserStatus


class DealCurrencyTotalsTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=10, name="Main", operating_currencies=["USD"], base_currency="USD"),
            # The tenant's last EUR rate, from an order: 1 EUR = 1.10 USD.
            SalesOrder(id=1, tenant_id=10, order_number="SO-1", currency="EUR", exchange_rate=Decimal("1.10")),
            SalesOpportunity(organization_id=1, opportunity_id=1, tenant_id=10, opportunity_name="A", sales_stage="lead",
                             amount="1000", currency_type="usd"),
            SalesOpportunity(organization_id=1, opportunity_id=2, tenant_id=10, opportunity_name="B", sales_stage="lead",
                             amount="500", currency_type="EUR"),
            SalesOpportunity(organization_id=1, opportunity_id=3, tenant_id=10, opportunity_name="C", sales_stage="lead",
                             amount="185000", currency_type="LKR"),
            SalesOpportunity(organization_id=1, opportunity_id=4, tenant_id=10, opportunity_name="D", sales_stage="lead",
                             amount="20", currency_type=None),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_converter_uses_the_last_rate_and_leaves_out_currencies_without_one(self):
        totals = BaseCurrencyTotals(self.db, tenant_id=10)
        self.assertEqual(totals.convert(Decimal("500"), "eur"), Decimal("550.00"))
        self.assertEqual(totals.convert(Decimal("20"), None), Decimal("20"))
        self.assertIsNone(totals.convert(Decimal("185000"), "LKR"))
        self.assertEqual(totals.summary(), {"currency": "USD", "unconverted_count": 1, "unconverted_currencies": ["LKR"]})

    def test_pipeline_summary_is_in_base_currency(self):
        summary = opportunities_services.summarize_opportunity_pipeline(self.db, tenant_id=10)

        lead = next(stage for stage in summary["stages"] if stage["stage_key"] == "lead")
        self.assertEqual(lead["count"], 4)
        self.assertEqual(lead["total_value"], 1570.0)  # 1000 + 550 + 20; the LKR deal is left out
        self.assertEqual(lead["unconverted_count"], 1)
        self.assertEqual(summary["currency"], "USD")
        self.assertEqual(summary["unconverted_currencies"], ["LKR"])

    def test_dashboard_pipeline_value_is_in_base_currency(self):
        user = SimpleNamespace(id=1, tenant_id=10)
        from unittest.mock import patch
        from app.modules.platform.services import module_reports

        with patch.object(module_reports, "_has_module_view_access", side_effect=lambda _db, _user, key: key == "sales_opportunities"):
            summary = generate_crm_dashboard_summary(self.db, user)

        self.assertEqual(summary["pipeline_value"], 1570.0)
        self.assertEqual(summary["currency"], "USD")
        self.assertEqual(summary["unconverted_deals"], 1)
        self.assertEqual(summary["forecast_summary"]["currency"], "USD")


if __name__ == "__main__":
    unittest.main()
