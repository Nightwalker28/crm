import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.sales.services import io_automation_services


def make_opportunity():
    return SimpleNamespace(
        opportunity_name="ACME Launch",
        client="ACME",
        start_date=date(2026, 1, 1),
        expected_close_date=date(2026, 2, 1),
        campaign_type=None,
        total_leads=None,
        cpl=None,
        total_cost_of_project=None,
        target_geography=None,
        target_audience=None,
        domain_cap=None,
        tactics=None,
        delivery_format=None,
        assigned_user=None,
        contact=None,
        organization=None,
    )


class IOAutomationTests(unittest.TestCase):
    def test_create_finance_io_requires_template_config(self):
        opportunity = make_opportunity()

        with patch.object(io_automation_services.settings, "GOOGLE_DOCS_TEMPLATE_ID", None), \
             patch.object(io_automation_services.settings, "GOOGLE_DRIVE_IO_FOLDER_ID", "folder-1"):
            with self.assertRaises(HTTPException) as exc:
                io_automation_services.create_finance_io_from_opportunity(
                    None,
                    opportunity=opportunity,
                    user_id=7,
                )

        self.assertEqual(exc.exception.status_code, 500)
        self.assertEqual(exc.exception.detail, "GOOGLE_DOCS_TEMPLATE_ID is not configured")

    def test_create_finance_io_requires_user_email_for_folder_restriction(self):
        opportunity = make_opportunity()
        fake_user = SimpleNamespace(id=7, first_name="Ada", last_name="Lovelace", email=None)
        fake_db = SimpleNamespace(
            query=lambda *_args, **_kwargs: SimpleNamespace(
                filter=lambda *a, **k: SimpleNamespace(first=lambda: fake_user)
            )
        )

        with patch.object(io_automation_services.settings, "GOOGLE_DOCS_TEMPLATE_ID", "template-1"), \
             patch.object(io_automation_services.settings, "GOOGLE_DRIVE_IO_FOLDER_ID", "folder-1"), \
             patch.object(io_automation_services, "get_valid_google_access_token", return_value="token"), \
             patch.object(io_automation_services, "_build_services", return_value=("docs", "drive")):
            with self.assertRaises(HTTPException) as exc:
                io_automation_services.create_finance_io_from_opportunity(
                    fake_db,
                    opportunity=opportunity,
                    user_id=7,
                )

        self.assertEqual(exc.exception.status_code, 500)
        self.assertEqual(exc.exception.detail, "User email is required to restrict IO folders")


if __name__ == "__main__":
    unittest.main()
