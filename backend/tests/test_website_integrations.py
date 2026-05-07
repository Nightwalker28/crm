import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.user_management.models import Tenant
from app.modules.website_integrations import models as website_models  # noqa: F401
from app.modules.website_integrations.services import website_integration_services as services


class WebsiteIntegrationServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_api_key_resolves_tenant_and_only_returns_public_active_catalog(self):
        _key, raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "WordPress", "scopes": ["catalog:read"], "allowed_origins": []},
        )
        services.create_catalog_item(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "item_type": "product",
                "slug": "starter-package",
                "sku": "STARTER",
                "name": "Starter Package",
                "currency": "USD",
                "public_unit_price": "99.00",
                "stock_status": "in_stock",
                "stock_quantity": "5",
                "is_public": True,
                "is_active": True,
            },
        )
        services.create_catalog_item(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "item_type": "service",
                "slug": "private-consulting",
                "name": "Private Consulting",
                "currency": "USD",
                "public_unit_price": "250.00",
                "is_public": False,
                "is_active": True,
            },
        )
        services.create_catalog_item(
            self.db,
            tenant_id=99,
            actor_user_id=None,
            payload={
                "item_type": "product",
                "slug": "other-tenant-item",
                "name": "Other Tenant Item",
                "currency": "USD",
                "public_unit_price": "12.00",
                "is_public": True,
                "is_active": True,
            },
        )

        resolved = services.resolve_public_api_key(self.db, api_key=raw_key)
        items, total = services.list_catalog_items(
            self.db,
            tenant_id=resolved.tenant_id,
            include_private=False,
        )

        self.assertEqual(resolved.tenant_id, 10)
        self.assertEqual(total, 1)
        self.assertEqual(items[0].slug, "starter-package")
        self.assertEqual(str(items[0].stock_quantity), "5.0000")

    def test_revoked_api_key_is_rejected(self):
        key, raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "WordPress", "scopes": ["catalog:read"], "allowed_origins": []},
        )
        services.revoke_api_key(self.db, key=key, actor_user_id=None)

        with self.assertRaises(Exception):
            services.resolve_public_api_key(self.db, api_key=raw_key)


if __name__ == "__main__":
    unittest.main()
