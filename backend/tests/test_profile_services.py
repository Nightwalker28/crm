import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import UploadFile
from pydantic import ValidationError
from starlette.datastructures import Headers

from app.modules.user_management.schema import CompanyProfileUpdateRequest, UserProfileUpdateRequest
from app.modules.user_management.services import profile


class FakeDB:
    def __init__(self, *, commit_error: Exception | None = None):
        self.added = []
        self.committed = False
        self.refreshed = []
        self.rolled_back = False
        self.commit_error = commit_error

    def add(self, value):
        self.added.append(value)

    def commit(self):
        if self.commit_error:
            raise self.commit_error
        self.committed = True

    def rollback(self):
        self.rolled_back = True

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


class ProfileAssetMutationTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def image_upload(filename: str = "profile.png", content_type: str = "image/png") -> UploadFile:
        return UploadFile(
            file=io.BytesIO(b"\x89PNG\r\n\x1a\npayload"),
            filename=filename,
            headers=Headers({"content-type": content_type}),
        )

    def test_ordinary_profile_and_company_updates_ignore_asset_urls(self):
        user = SimpleNamespace(
            first_name="Old",
            last_name=None,
            photo_url="https://cdn.example.com/photo.png",
            phone_number=None,
            job_title=None,
            timezone=None,
            bio=None,
        )
        company = SimpleNamespace(
            name="Old company",
            primary_email=None,
            website=None,
            primary_phone=None,
            industry=None,
            country=None,
            billing_address=None,
            logo_url="https://cdn.example.com/logo.png",
            operating_currencies=["USD"],
            updated_by=None,
        )

        profile.update_user_profile(FakeDB(), user, {"first_name": "New", "photo_url": "https://evil.test/a.png"})
        with patch.object(profile, "get_or_create_company_profile", return_value=company):
            profile.update_company_profile(
                FakeDB(),
                SimpleNamespace(id=7, tenant_id=1),
                {"name": "New company", "logo_url": "https://evil.test/b.png"},
            )

        self.assertEqual(user.first_name, "New")
        self.assertEqual(user.photo_url, "https://cdn.example.com/photo.png")
        self.assertEqual(company.name, "New company")
        self.assertEqual(company.logo_url, "https://cdn.example.com/logo.png")

    def test_update_schemas_reject_asset_url_fields(self):
        with self.assertRaises(ValidationError):
            UserProfileUpdateRequest.model_validate({"photo_url": "https://evil.test/photo.png"})
        with self.assertRaises(ValidationError):
            CompanyProfileUpdateRequest.model_validate({"logo_url": "https://evil.test/logo.png"})

    async def test_upload_user_photo_replaces_reference_then_cleans_old_managed_file(self):
        db = FakeDB()
        user = SimpleNamespace(id=7, photo_url="/media/profile-assets/user-7/old.png")

        with patch.object(profile, "persist_media_file", return_value="media/profile-assets/user-7/new.png"), \
             patch.object(profile, "delete_managed_media_file") as delete_mock:
            updated = await profile.upload_user_photo(db, user, self.image_upload())

        self.assertIs(updated, user)
        self.assertTrue(db.committed)
        self.assertEqual(user.photo_url, "/media/profile-assets/user-7/new.png")
        delete_mock.assert_called_once_with(
            "/media/profile-assets/user-7/old.png",
            category="profile-assets",
            owner_key="user-7",
        )

    async def test_upload_company_logo_uses_tenant_company_record(self):
        db = FakeDB()
        company = SimpleNamespace(id=12, logo_url=None, updated_by=None)
        actor = SimpleNamespace(id=9, tenant_id=4)

        with patch.object(profile, "get_or_create_company_profile", return_value=company), \
             patch.object(profile, "persist_media_file", return_value="media/company-assets/company-12/new.png"), \
             patch.object(profile, "delete_managed_media_file") as delete_mock:
            updated = await profile.upload_company_logo(db, actor, self.image_upload("logo.png"))

        self.assertIs(updated, company)
        self.assertEqual(company.logo_url, "/media/company-assets/company-12/new.png")
        self.assertEqual(company.updated_by, 9)
        delete_mock.assert_called_once_with(None, category="company-assets", owner_key="company-12")

    async def test_failed_persistence_cleans_new_file_without_deleting_old_file(self):
        db = FakeDB(commit_error=RuntimeError("database unavailable"))
        user = SimpleNamespace(id=7, photo_url="/media/profile-assets/user-7/old.png")

        with patch.object(profile, "persist_media_file", return_value="media/profile-assets/user-7/new.png"), \
             patch.object(profile, "delete_managed_media_file") as delete_mock:
            with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                await profile.upload_user_photo(db, user, self.image_upload())

        self.assertTrue(db.rolled_back)
        self.assertEqual(user.photo_url, "/media/profile-assets/user-7/old.png")
        delete_mock.assert_called_once_with(
            "/media/profile-assets/user-7/new.png",
            category="profile-assets",
            owner_key="user-7",
        )

    def test_remove_user_photo_clears_reference_before_owner_scoped_cleanup(self):
        db = FakeDB()
        user = SimpleNamespace(id=7, photo_url="https://cdn.example.com/legacy-photo.png")

        with patch.object(profile, "delete_managed_media_file") as delete_mock:
            updated = profile.remove_user_photo(db, user)

        self.assertIsNone(updated.photo_url)
        self.assertTrue(db.committed)
        delete_mock.assert_called_once_with(
            "https://cdn.example.com/legacy-photo.png",
            category="profile-assets",
            owner_key="user-7",
        )

    def test_remove_company_logo_clears_tenant_company_reference(self):
        db = FakeDB()
        company = SimpleNamespace(id=12, logo_url="/media/company-assets/company-12/old.png", updated_by=None)
        actor = SimpleNamespace(id=9, tenant_id=4)

        with patch.object(profile, "get_or_create_company_profile", return_value=company), \
             patch.object(profile, "delete_managed_media_file") as delete_mock:
            updated = profile.remove_company_logo(db, actor)

        self.assertIsNone(updated.logo_url)
        self.assertEqual(updated.updated_by, 9)
        delete_mock.assert_called_once_with(
            "/media/company-assets/company-12/old.png",
            category="company-assets",
            owner_key="company-12",
        )


if __name__ == "__main__":
    unittest.main()
