import unittest
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.client_portal import models as client_portal_models  # noqa: F401
from app.modules.documents import models as documents_models  # noqa: F401
from app.modules.platform.models import ForecastSnapshot
from app.modules.platform.services import module_reports
from app.modules.sales.models import SalesOpportunity
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Team, Tenant, User, UserStatus


class FakeSavedReportQuery:
    def __init__(self):
        self.operations = []

    def filter(self, *args):
        self.operations.append("filter")
        return self

    def order_by(self, *args):
        self.operations.append("order_by_reset" if len(args) == 1 and args[0] is None else "order_by")
        return self

    def all(self):
        self.operations.append("all")
        return [
            SimpleNamespace(
                id=2,
                module_key="sales_leads",
                name="Lead Report",
                config={},
                created_at=datetime(2026, 1, 1),
                updated_at=datetime(2026, 1, 2),
            )
        ]


class FakeSavedReportDB:
    def __init__(self, query):
        self.query_obj = query

    def query(self, *_args):
        return self.query_obj


class SavedReportListTests(unittest.TestCase):
    def test_saved_reports_apply_sort_before_fetching(self):
        query = FakeSavedReportQuery()

        results = module_reports.list_saved_reports(
            FakeSavedReportDB(query),
            SimpleNamespace(id=1, tenant_id=10),
            sort_by="name",
            sort_direction="asc",
        )

        self.assertEqual(results[0]["name"], "Lead Report")
        self.assertEqual(query.operations, ["filter", "order_by_reset", "order_by", "all"])


class ForecastReportTests(unittest.TestCase):
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
                Team(id=7, tenant_id=10, name="Enterprise"),
                User(
                    id=1,
                    tenant_id=10,
                    team_id=7,
                    email="owner@example.com",
                    first_name="Ada",
                    last_name="Lovelace",
                    is_active=UserStatus.active,
                ),
                SalesOpportunity(
                    opportunity_id=1,
                    tenant_id=10,
                    opportunity_name="Explicit probability",
                    client="Acme",
                    assigned_to=1,
                    sales_stage="proposal",
                    expected_close_date=date(2026, 6, 10),
                    probability_percent=Decimal("60"),
                    total_cost_of_project="1000",
                ),
                SalesOpportunity(
                    opportunity_id=2,
                    tenant_id=10,
                    opportunity_name="Stage probability",
                    client="Beta",
                    assigned_to=1,
                    sales_stage="negotiation",
                    expected_close_date=date(2026, 6, 11),
                    total_cost_of_project="2000",
                ),
                SalesOpportunity(
                    opportunity_id=3,
                    tenant_id=10,
                    opportunity_name="Won",
                    client="Gamma",
                    assigned_to=1,
                    sales_stage="closed_won",
                    expected_close_date=date(2026, 6, 12),
                    total_cost_of_project="500",
                ),
                SalesOpportunity(
                    opportunity_id=4,
                    tenant_id=10,
                    opportunity_name="Lost",
                    client="Delta",
                    assigned_to=1,
                    sales_stage="closed_lost",
                    expected_close_date=date(2026, 6, 13),
                    total_cost_of_project="9999",
                ),
                SalesOpportunity(
                    opportunity_id=5,
                    tenant_id=99,
                    opportunity_name="Other tenant",
                    client="Other",
                    sales_stage="negotiation",
                    expected_close_date=date(2026, 6, 10),
                    total_cost_of_project="9999",
                ),
                SalesOpportunity(
                    opportunity_id=6,
                    tenant_id=10,
                    opportunity_name="Out of period",
                    client="Future",
                    sales_stage="negotiation",
                    expected_close_date=date(2026, 8, 1),
                    total_cost_of_project="9999",
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_forecast_uses_explicit_probability_then_stage_default(self):
        summary = module_reports.generate_forecast_summary(
            self.db,
            self.user,
            period_start=date(2026, 6, 1),
            period_end=date(2026, 6, 30),
        )

        self.assertEqual(summary["open_opportunity_count"], 2)
        self.assertEqual(summary["won_opportunity_count"], 1)
        self.assertEqual(summary["gross_pipeline_amount"], Decimal("3000.00"))
        self.assertEqual(summary["weighted_pipeline_amount"], Decimal("2100.00"))
        self.assertEqual(summary["commit_amount"], Decimal("2000.00"))
        self.assertEqual(summary["best_case_amount"], Decimal("3000.00"))
        self.assertEqual(summary["actual_revenue_amount"], Decimal("500.00"))
        self.assertNotIn("9999.00", {str(row["gross_pipeline_amount"]) for row in summary["by_stage"]})

    def test_snapshot_persists_json_without_blocking_summary(self):
        snapshot = module_reports.create_forecast_snapshot(
            self.db,
            self.user,
            period_start=date(2026, 6, 1),
            period_end=date(2026, 6, 30),
        )

        persisted = self.db.query(ForecastSnapshot).filter(ForecastSnapshot.id == snapshot.id).one()
        self.assertEqual(persisted.tenant_id, 10)
        self.assertEqual(persisted.weighted_pipeline_amount, Decimal("2100.00"))
        self.assertEqual(persisted.snapshot_json["weighted_pipeline_amount"], 2100.0)
        self.assertEqual(persisted.snapshot_json["period_start"], "2026-06-01")


if __name__ == "__main__":
    unittest.main()
