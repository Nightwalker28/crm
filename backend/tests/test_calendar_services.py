import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.calendar.services import calendar_services


class FakeDB:
    def __init__(self):
        self.added = []
        self.commits = 0

    def add(self, item):
        self.added.append(item)

    def commit(self):
        self.commits += 1

    def refresh(self, item):
        return None


class CalendarGoogleSyncTests(unittest.TestCase):
    def test_google_app_calendar_rejects_invalid_provider_calendar_id(self):
        connection = SimpleNamespace(
            scopes=["https://www.googleapis.com/auth/calendar"],
            provider_calendar_id=None,
            provider_calendar_name=None,
            status="connected",
            last_error=None,
        )
        response = SimpleNamespace(
            ok=True,
            content=b"{}",
            json=lambda: {"id": "../../private", "summary": "CRM"},
        )
        db = FakeDB()

        with patch.object(calendar_services, "_ensure_google_access_token", return_value="token"), \
             patch.object(calendar_services.requests, "post", return_value=response):
            calendar_id = calendar_services._ensure_google_app_calendar(db, connection)

        self.assertIsNone(calendar_id)
        self.assertIsNone(connection.provider_calendar_id)
        self.assertEqual(connection.status, "error")
        self.assertEqual(connection.last_error, "Google returned an invalid calendar identifier.")
        self.assertEqual(db.commits, 1)


if __name__ == "__main__":
    unittest.main()
