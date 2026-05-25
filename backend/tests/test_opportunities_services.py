import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.sales.services import opportunities_services


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


if __name__ == "__main__":
    unittest.main()
