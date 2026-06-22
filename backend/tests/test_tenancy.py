import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.core import tenancy


class DeploymentLicenseCacheTests(unittest.TestCase):
    def setUp(self):
        tenancy.get_verified_deployment_license.cache_clear()

    def tearDown(self):
        tenancy.get_verified_deployment_license.cache_clear()

    def test_verified_deployment_license_cache_requires_explicit_clear_for_patched_settings(self):
        with patch.object(tenancy.settings, "DEPLOYMENT_LICENSE", "token-a"), \
             patch.object(tenancy.settings, "DEPLOYMENT_LICENSE_PUBLIC_KEY", "public-key"), \
             patch.object(
                 tenancy.jwt,
                 "decode",
                 return_value={"deployment_mode": "cloud", "license_id": "a"},
             ) as decode:
            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "a"},
            )

        with patch.object(tenancy.settings, "DEPLOYMENT_LICENSE", "token-b"), \
             patch.object(tenancy.settings, "DEPLOYMENT_LICENSE_PUBLIC_KEY", "public-key"), \
             patch.object(
                 tenancy.jwt,
                 "decode",
                 return_value={"deployment_mode": "cloud", "license_id": "b"},
             ):
            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "a"},
            )
            decode.assert_called_once()

            tenancy.get_verified_deployment_license.cache_clear()

            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "b"},
            )

    def test_verified_deployment_license_cache_refreshes_after_ttl(self):
        with patch.object(tenancy.settings, "DEPLOYMENT_LICENSE", "token-a"), \
             patch.object(tenancy.settings, "DEPLOYMENT_LICENSE_PUBLIC_KEY", "public-key"), \
             patch.object(tenancy.settings, "DEPLOYMENT_LICENSE_CACHE_TTL_SECONDS", 10), \
             patch.object(tenancy.time, "monotonic", side_effect=[100.0, 105.0, 111.0]), \
             patch.object(
                 tenancy.jwt,
                 "decode",
                 side_effect=[
                     {"deployment_mode": "cloud", "license_id": "a"},
                     {"deployment_mode": "cloud", "license_id": "b"},
                 ],
             ) as decode:
            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "a"},
            )
            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "a"},
            )
            self.assertEqual(
                tenancy.get_verified_deployment_license(),
                {"deployment_mode": "cloud", "license_id": "b"},
            )

        self.assertEqual(decode.call_count, 2)


class TenantContextCacheTests(unittest.TestCase):
    def test_resolve_request_tenant_context_uses_shared_cache(self):
        cached_payload = {
            "id": 10,
            "slug": "acme",
            "name": "Acme",
            "is_active": True,
        }
        request = SimpleNamespace(headers={"host": "CRM.Example.com:443"})

        with patch.object(tenancy, "is_cloud_mode_enabled", return_value=True), \
             patch.object(tenancy, "is_auth_tenant_resolution_enabled", return_value=False), \
             patch.object(tenancy, "cache_get_json", return_value=cached_payload) as cache_get, \
             patch.object(tenancy, "resolve_request_tenant") as resolve:
            context = tenancy.resolve_request_tenant_context_cached(SimpleNamespace(), request)

        self.assertEqual(context.id, 10)
        self.assertEqual(context.slug, "acme")
        cache_get.assert_called_once_with("tenant-context:host:crm.example.com")
        resolve.assert_not_called()

    def test_resolve_request_tenant_context_stores_shared_cache_miss(self):
        tenant = SimpleNamespace(id=10, slug="acme", name="Acme", is_active=1)
        request = SimpleNamespace(headers={"host": "crm.example.com"})

        with patch.object(tenancy, "is_cloud_mode_enabled", return_value=True), \
             patch.object(tenancy, "is_auth_tenant_resolution_enabled", return_value=False), \
             patch.object(tenancy, "cache_get_json", return_value=None), \
             patch.object(tenancy, "resolve_request_tenant", return_value=tenant), \
             patch.object(tenancy, "cache_set_json") as cache_set:
            context = tenancy.resolve_request_tenant_context_cached(SimpleNamespace(), request)

        self.assertEqual(context.id, 10)
        cache_set.assert_called_once_with(
            "tenant-context:host:crm.example.com",
            {"id": 10, "slug": "acme", "name": "Acme", "is_active": True},
            ttl_seconds=tenancy.TENANT_CONTEXT_CACHE_TTL_SECONDS,
        )

    def test_invalidate_tenant_context_cache_deletes_host_or_prefix(self):
        with patch.object(tenancy, "cache_delete") as delete, \
             patch.object(tenancy, "cache_delete_prefix") as delete_prefix:
            tenancy.invalidate_tenant_context_cache("https://CRM.Example.com/path")
            tenancy.invalidate_tenant_context_cache()

        delete.assert_called_once_with("tenant-context:host:crm.example.com")
        delete_prefix.assert_called_once_with("tenant-context:")


if __name__ == "__main__":
    unittest.main()
