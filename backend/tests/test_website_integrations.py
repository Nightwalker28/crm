import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core import cache
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.catalog.services import product_services, service_services
from app.modules.documents import models as documents_models  # noqa: F401
from app.modules.finance import models as finance_models  # noqa: F401
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Tenant, User
from app.modules.website_integrations import models as website_models  # noqa: F401
from app.modules.website_integrations.routes import website_integration_routes
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
                User(id=7, tenant_id=10, email="admin@example.com"),
                CompanyProfile(id=1, tenant_id=10, name="Default Co", operating_currencies=["USD"]),
            ]
        )
        self.db.commit()

    def tearDown(self):
        cache._local_cache.clear()
        self.db.close()

    def test_api_key_resolves_tenant_and_only_returns_public_active_catalog(self):
        _key, raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "WordPress", "scopes": ["catalog:read"], "allowed_origins": []},
        )
        product_services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
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
        service_services.create_service(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "slug": "private-consulting",
                "name": "Private Consulting",
                "currency": "USD",
                "public_unit_price": "250.00",
                "is_public": False,
                "is_active": True,
            },
        )
        product_services.create_product(
            self.db,
            tenant_id=99,
            actor_user_id=None,
            payload={
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
        self.assertEqual(items[0].catalog_product_id, items[0].id)
        self.assertIsNone(items[0].catalog_service_id)
        self.assertEqual(str(items[0].stock_quantity), "5.0000")

    def test_public_api_key_scope_is_enforced_and_last_used_is_tracked(self):
        key, raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Catalog Only", "scopes": ["catalog:read"], "allowed_origins": []},
        )

        resolved = services.resolve_public_api_key(self.db, api_key=raw_key, required_scope=services.DEFAULT_CATALOG_READ_SCOPE)
        self.assertEqual(resolved.id, key.id)
        self.assertIsNotNone(resolved.last_used_at)

        with self.assertRaises(Exception) as exc:
            services.resolve_public_api_key(self.db, api_key=raw_key, required_scope=services.ORDER_WRITE_SCOPE)
        self.assertEqual(exc.exception.status_code, 403)

    def test_allowed_origin_rejects_untrusted_browser_origins(self):
        allowed_request = SimpleNamespace(headers={"origin": "https://shop.example.com"})
        blocked_request = SimpleNamespace(headers={"origin": "https://attacker.example"})
        server_request = SimpleNamespace(headers={})

        website_integration_routes._check_allowed_origin(allowed_request, ["https://shop.example.com"])
        website_integration_routes._check_allowed_origin(server_request, ["https://shop.example.com"])
        with self.assertRaises(Exception) as exc:
            website_integration_routes._check_allowed_origin(blocked_request, ["https://shop.example.com"])

        self.assertEqual(exc.exception.status_code, 403)

    def test_public_api_request_audit_log_redacts_secret(self):
        key, raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Audited", "scopes": ["catalog:read"], "allowed_origins": ["https://shop.example.com"]},
        )
        resolved = services.resolve_public_api_key(self.db, api_key=raw_key)

        services.log_public_api_request(
            self.db,
            key=resolved,
            operation="catalog_list",
            metadata={"origin": "https://shop.example.com", "limit": 25},
        )

        activity = (
            self.db.query(platform_models.ActivityLog)
            .filter(platform_models.ActivityLog.action == "public_api.catalog_list")
            .one()
        )
        self.assertEqual(activity.tenant_id, 10)
        self.assertIsNone(activity.actor_user_id)
        self.assertEqual(activity.entity_type, "integration_api_key")
        self.assertEqual(activity.after_state["key_prefix"], key.key_prefix)
        self.assertEqual(activity.after_state["metadata"]["origin"], "https://shop.example.com")
        self.assertNotIn(raw_key, str(activity.after_state))

    def test_revoked_api_key_is_rejected(self):
        key, raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "WordPress", "scopes": ["catalog:read"], "allowed_origins": []},
        )
        services.revoke_api_key(self.db, key=key, actor_user_id=None)

        created_event = (
            self.db.query(platform_models.ActivityLog)
            .filter(platform_models.ActivityLog.action == "api_key.created")
            .one()
        )
        revoked_event = (
            self.db.query(platform_models.ActivityLog)
            .filter(platform_models.ActivityLog.action == "api_key.revoked")
            .one()
        )
        self.assertEqual(created_event.tenant_id, 10)
        self.assertEqual(revoked_event.tenant_id, 10)
        self.assertNotIn(raw_key, str(created_event.after_state))
        self.assertNotIn(raw_key, str(revoked_event.before_state))
        self.assertNotIn(raw_key, str(revoked_event.after_state))

        with self.assertRaises(Exception):
            services.resolve_public_api_key(self.db, api_key=raw_key)

    def test_rotate_api_key_replaces_secret_and_logs_safe_event(self):
        key, original_raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=7,
            payload={"name": "WordPress", "scopes": ["catalog:read"], "allowed_origins": []},
        )

        rotated_key, rotated_raw_key = services.rotate_api_key(self.db, key=key, actor_user_id=7)

        self.assertNotEqual(original_raw_key, rotated_raw_key)
        self.assertEqual(rotated_key.status, "active")
        self.assertEqual(services.resolve_public_api_key(self.db, api_key=rotated_raw_key).id, key.id)
        with self.assertRaises(Exception):
            services.resolve_public_api_key(self.db, api_key=original_raw_key)
        activity = (
            self.db.query(platform_models.ActivityLog)
            .filter(platform_models.ActivityLog.action == "api_key.rotated")
            .one()
        )
        self.assertEqual(activity.tenant_id, 10)
        self.assertEqual(activity.actor_user_id, 7)
        self.assertNotIn(original_raw_key, str(activity.before_state))
        self.assertNotIn(original_raw_key, str(activity.after_state))
        self.assertNotIn(rotated_raw_key, str(activity.before_state))
        self.assertNotIn(rotated_raw_key, str(activity.after_state))

    def _order_key(self):
        key, _raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Shop", "scopes": ["catalog:read", "orders:write"], "allowed_origins": []},
        )
        return key

    def _room(self):
        return product_services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "slug": "room-a",
                "sku": "ROOM-A",
                "name": "Room A",
                "currency": "USD",
                "public_unit_price": "50.00",
                "stock_status": "in_stock",
                "stock_quantity": "4",
                "is_public": True,
                "is_active": True,
            },
        )

    def test_public_order_becomes_a_confirmed_sales_order_once(self):
        # 13 F1.3: a website order is a sales order with source `website`; it holds stock
        # like any confirmed order, and a resubmission returns the same order.
        from app.modules.inventory.models import InventoryReservation
        from app.modules.sales.models import SalesContact, SalesOrder

        key = self._order_key()
        item = self._room()
        payload = {
            "external_reference": "wp-order-100",
            "source_platform": "wordpress",
            "customer_name": "Buyer Person",
            "customer_email": "Buyer@Example.com",
            "line_items": [{"slug": "room-a", "quantity": "2"}],
        }

        order, replayed = services.create_public_order(self.db, key=key, payload=payload)
        second_order, second_replayed = services.create_public_order(self.db, key=key, payload=payload)
        self.db.refresh(item)

        self.assertIsInstance(order, SalesOrder)
        self.assertFalse(replayed)
        self.assertTrue(second_replayed)
        self.assertEqual(order.id, second_order.id)
        self.assertEqual(self.db.query(SalesOrder).count(), 1)
        self.assertEqual(
            (order.source, order.channel, order.external_reference, order.status, order.integration_key_id),
            ("website", "wordpress", "wp-order-100", "confirmed", key.id),
        )
        self.assertEqual(Decimal(order.grand_total), Decimal("100"))
        held = sum(Decimal(row.quantity) for row in self.db.query(InventoryReservation).filter_by(order_id=order.id))
        self.assertEqual(held, Decimal("2"))
        self.assertEqual(Decimal(item.stock_quantity), Decimal("4"))
        contact = self.db.get(SalesContact, order.contact_id)
        self.assertEqual((contact.primary_email, contact.first_name, contact.last_name), ("buyer@example.com", "Buyer", "Person"))
        self.assertEqual(
            self.db.query(platform_models.ActivityLog)
            .filter(platform_models.ActivityLog.module_key == "sales_orders", platform_models.ActivityLog.entity_id == str(order.id))
            .count(),
            1,
        )

    def test_public_order_reuses_the_buyers_contact(self):
        from app.modules.sales.models import SalesContact

        self.db.add(SalesContact(contact_id=501, tenant_id=10, first_name="Known", primary_email="known@example.com"))
        self.db.commit()
        self._room()

        order, _replayed = services.create_public_order(
            self.db,
            key=self._order_key(),
            payload={"external_reference": "wp-order-300", "customer_email": "KNOWN@example.com", "line_items": [{"sku": "ROOM-A", "quantity": "1"}]},
        )

        self.assertEqual(order.contact_id, 501)
        self.assertEqual(self.db.query(SalesContact).count(), 1)

    def test_public_order_rejects_duplicate_reference_with_different_payload(self):
        key, _raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Bookings", "scopes": ["orders:write"], "allowed_origins": []},
        )
        product_services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "slug": "starter-package",
                "name": "Starter Package",
                "currency": "USD",
                "public_unit_price": "99.00",
                "stock_status": "in_stock",
                "stock_quantity": "5",
                "is_public": True,
                "is_active": True,
            },
        )
        payload = {
            "external_reference": "wp-order-101",
            "line_items": [{"slug": "starter-package", "quantity": "1"}],
        }
        services.create_public_order(self.db, key=key, payload=payload)

        with self.assertRaises(Exception):
            services.create_public_order(
                self.db,
                key=key,
                payload={**payload, "line_items": [{"slug": "starter-package", "quantity": "2"}]},
            )

    def test_crm_routes_use_module_permissions_not_admin(self):
        # 13a B7: the CRM-user routes clear the module's access layers, not an admin check.
        import inspect

        self.assertNotIn("require_admin", inspect.getsource(website_integration_routes))
        self.assertEqual(len(website_integration_routes.router.dependencies), 1)
        for route in website_integration_routes.router.routes:
            closures = [dep.call for dep in route.dependant.dependencies if getattr(dep.call, "__closure__", None)]
            actions = {
                cell.cell_contents
                for call in closures
                for cell in call.__closure__
                if isinstance(cell.cell_contents, str)
            }
            self.assertTrue(actions & {"view", "configure"}, route.path)

    def test_hash_payload_preserves_decimal_scale(self):
        self.assertNotEqual(
            services._hash_payload({"line_items": [{"quantity": Decimal("1.10")}]}),
            services._hash_payload({"line_items": [{"quantity": Decimal("1.1")}]}),
        )

    def test_integration_rate_limit_rejects_after_configured_limit(self):
        key, _raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Limited", "scopes": ["catalog:read"], "allowed_origins": []},
        )

        with patch.object(services.settings, "WEBSITE_INTEGRATION_RATE_LIMIT_COUNT", 2), \
             patch.object(services.settings, "WEBSITE_INTEGRATION_RATE_LIMIT_WINDOW_SECONDS", 60), \
             patch.object(cache.settings, "REDIS_URL", None):
            services.check_integration_rate_limit(key, operation="catalog_read")
            services.check_integration_rate_limit(key, operation="catalog_read")
            with self.assertRaises(Exception) as exc:
                services.check_integration_rate_limit(key, operation="catalog_read")

        self.assertEqual(exc.exception.status_code, 429)


if __name__ == "__main__":
    unittest.main()
