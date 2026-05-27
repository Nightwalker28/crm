import unittest
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import create_pagination
from app.modules.sales.models import SalesLead, SalesLeadScore
from app.modules.sales.services.leads_services import calculate_lead_score, list_sales_leads, update_sales_lead
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class LeadScoringTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                User(
                    id=1,
                    tenant_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_calculate_lead_score_grades_missing_and_high_quality_leads(self):
        cold_lead = SalesLead(tenant_id=10, primary_email="cold@example.com", status="new")
        hot_lead = SalesLead(
            tenant_id=10,
            primary_email="hot@example.com",
            phone="555-0100",
            company="Acme",
            source="Referral",
            status="qualified",
            last_contacted_at=datetime.now(timezone.utc) - timedelta(days=1),
        )

        cold_score, cold_grade, cold_factors = calculate_lead_score(cold_lead)
        hot_score, hot_grade, hot_factors = calculate_lead_score(hot_lead)

        self.assertEqual(cold_score, 10)
        self.assertEqual(cold_grade, "cold")
        self.assertEqual([factor["key"] for factor in cold_factors], ["has_email"])
        self.assertEqual(hot_score, 80)
        self.assertEqual(hot_grade, "hot")
        self.assertIn("recent_follow_up", {factor["key"] for factor in hot_factors})

    def test_unqualified_and_converted_leads_do_not_rank_hot(self):
        for status in ["unqualified", "converted"]:
            lead = SalesLead(
                tenant_id=10,
                primary_email=f"{status}@example.com",
                phone="555-0100",
                company="Acme",
                source="Referral",
                status=status,
                last_contacted_at=datetime.now(timezone.utc),
            )

            score, grade, factors = calculate_lead_score(lead)

            self.assertEqual(score, 0)
            self.assertEqual(grade, "cold")
            self.assertEqual(factors[0]["key"], "inactive_status")

    def test_update_recalculates_existing_score_record(self):
        lead = SalesLead(lead_id=100, tenant_id=10, primary_email="ada@example.com", status="new", assigned_to=1)
        lead.score_record = SalesLeadScore(id=200, tenant_id=10, lead_id=100, score=10, grade="cold", factors_json=[])
        self.db.add(lead)
        self.db.commit()

        updated = update_sales_lead(
            self.db,
            lead,
            {
                "phone": "555-0100",
                "company": "Analytical Engines",
                "source": "Referral",
                "status": "qualified",
                "last_contacted_at": datetime.now(timezone.utc),
            },
        )

        self.assertEqual(updated.score, 80)
        self.assertEqual(updated.score_grade, "hot")
        self.assertIn("qualified", {factor["key"] for factor in updated.score_factors})

    def test_lead_list_filters_by_score_and_grade(self):
        cold = SalesLead(lead_id=101, tenant_id=10, primary_email="cold@example.com", status="new", assigned_to=1)
        cold.score_record = SalesLeadScore(id=201, tenant_id=10, lead_id=101, score=10, grade="cold", factors_json=[])
        hot = SalesLead(lead_id=102, tenant_id=10, primary_email="hot@example.com", status="qualified", assigned_to=1)
        hot.score_record = SalesLeadScore(id=202, tenant_id=10, lead_id=102, score=80, grade="hot", factors_json=[])
        self.db.add_all([cold, hot])
        self.db.commit()

        leads, total_count = list_sales_leads(
            self.db,
            tenant_id=10,
            pagination=create_pagination(1, 20),
            all_filter_conditions=[
                {"field": "score", "operator": "gte", "value": 50},
                {"field": "score_grade", "operator": "is", "value": "hot"},
            ],
        )

        self.assertEqual(total_count, 1)
        self.assertEqual([lead.lead_id for lead in leads], [hot.lead_id])


if __name__ == "__main__":
    unittest.main()
