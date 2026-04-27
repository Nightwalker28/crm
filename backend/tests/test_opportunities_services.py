import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

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


if __name__ == "__main__":
    unittest.main()
