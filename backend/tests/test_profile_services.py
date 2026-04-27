import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.user_management.services import profile


class FakeDB:
    def __init__(self):
        self.added = []
        self.committed = False
        self.refreshed = []

    def add(self, value):
        self.added.append(value)

    def commit(self):
        self.committed = True

    def refresh(self, value):
        self.refreshed.append(value)


class CompanyOperatingCurrencyCacheTests(unittest.TestCase):
    def test_get_company_operating_currencies_uses_cache_without_profile_query(self):
        user = SimpleNamespace(tenant_id=4)

        with patch.object(profile, "cache_get_json", return_value=["usd", "eur"]), \
             patch.object(profile, "get_or_create_company_profile") as get_profile:
            currencies = profile.get_company_operating_currencies(None, user)

        self.assertEqual(currencies, ["USD", "EUR"])
        get_profile.assert_not_called()

    def test_get_company_operating_currencies_populates_cache_on_miss(self):
        user = SimpleNamespace(tenant_id=5)
        company_profile = SimpleNamespace(operating_currencies=["usd", "gbp"])

        with patch.object(profile, "cache_get_json", return_value=None), \
             patch.object(profile, "cache_set_json") as cache_set, \
             patch.object(profile, "get_or_create_company_profile", return_value=company_profile):
            currencies = profile.get_company_operating_currencies(None, user)

        self.assertEqual(currencies, ["USD", "GBP"])
        cache_set.assert_called_once_with(
            "company-operating-currencies:5",
            ["USD", "GBP"],
            ttl_seconds=profile.COMPANY_OPERATING_CURRENCIES_CACHE_TTL_SECONDS,
        )

    def test_update_company_profile_invalidates_currency_cache_after_commit(self):
        db = FakeDB()
        user = SimpleNamespace(id=9, tenant_id=6)
        company_profile = SimpleNamespace(
            name="Old",
            primary_email=None,
            website=None,
            primary_phone=None,
            industry=None,
            country=None,
            billing_address=None,
            logo_url=None,
            operating_currencies=["USD"],
            updated_by=None,
        )

        with patch.object(profile, "get_or_create_company_profile", return_value=company_profile), \
             patch.object(profile, "cache_delete") as cache_delete:
            updated = profile.update_company_profile(
                db,
                user,
                {"operating_currencies": ["eur", "usd"]},
            )

        self.assertIs(updated, company_profile)
        self.assertTrue(db.committed)
        self.assertEqual(company_profile.operating_currencies, ["EUR", "USD"])
        cache_delete.assert_called_once_with("company-operating-currencies:6")


if __name__ == "__main__":
    unittest.main()
