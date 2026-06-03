import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import create_pagination
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesOpportunity
from app.modules.sales.services import opportunities_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class FakeDB:
    def __init__(self):
        self.committed = False
        self.refreshed = []

    def commit(self):
        self.committed = True

    def refresh(self, value):
        self.refreshed.append(value)


class OpportunitySoftDeleteTests(unittest.TestCase):
    def test_delete_opportunity_sets_python_datetime(self):
        db = FakeDB()
        opportunity = SimpleNamespace(
            tenant_id=3,
            opportunity_id=11,
            deleted_at=None,
        )

        with patch.object(opportunities_services, "hydrate_custom_field_record", return_value=opportunity):
            result = opportunities_services.delete_opportunity(db, opportunity)

        self.assertIs(result, opportunity)
        self.assertTrue(db.committed)
        self.assertEqual(db.refreshed, [opportunity])
        self.assertIsInstance(opportunity.deleted_at, datetime)

    def test_update_opportunity_stage_normalizes_and_persists(self):
        db = FakeDB()
        opportunity = SimpleNamespace(
            tenant_id=3,
            opportunity_id=11,
            sales_stage="proposal",
        )

        with patch.object(opportunities_services, "hydrate_custom_field_record", return_value=opportunity):
            result = opportunities_services.update_opportunity_stage(db, opportunity, sales_stage="Closed Won")

        self.assertIs(result, opportunity)
        self.assertEqual(opportunity.sales_stage, "closed_won")
        self.assertTrue(db.committed)
        self.assertEqual(db.refreshed, [opportunity])

    def test_update_opportunity_stage_rejects_unsupported_stage(self):
        db = FakeDB()
        opportunity = SimpleNamespace(
            tenant_id=3,
            opportunity_id=11,
            sales_stage="proposal",
        )

        with self.assertRaises(HTTPException) as exc:
            opportunities_services.update_opportunity_stage(db, opportunity, sales_stage="verbal_yes")

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Unsupported opportunity stage")
        self.assertFalse(db.committed)
        self.assertEqual(opportunity.sales_stage, "proposal")


class OpportunityListTests(unittest.TestCase):
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

    def test_opportunity_list_sorts_before_pagination(self):
        self.db.add_all(
            [
                SalesOpportunity(
                    opportunity_id=103,
                    tenant_id=10,
                    opportunity_name="Zeta rollout",
                    client="Zeta",
                    sales_stage="lead",
                    assigned_to=1,
                ),
                SalesOpportunity(
                    opportunity_id=104,
                    tenant_id=10,
                    opportunity_name="Ada renewal",
                    client="Ada",
                    sales_stage="lead",
                    assigned_to=1,
                ),
                SalesOpportunity(
                    opportunity_id=105,
                    tenant_id=10,
                    opportunity_name="Mia expansion",
                    client="Mia",
                    sales_stage="lead",
                    assigned_to=1,
                ),
            ]
        )
        self.db.commit()

        opportunities, total_count = opportunities_services.list_opportunities(
            self.db,
            tenant_id=10,
            pagination=create_pagination(1, 2),
            sort_by="opportunity_name",
            sort_direction="asc",
        )

        self.assertEqual(total_count, 3)
        self.assertEqual(
            [opportunity.opportunity_name for opportunity in opportunities],
            ["Ada renewal", "Mia expansion"],
        )


if __name__ == "__main__":
    unittest.main()
