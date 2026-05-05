import unittest
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


if __name__ == "__main__":
    unittest.main()
