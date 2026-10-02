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

    def test_public_order_is_idempotent_and_decrements_stock_once(self):
        key, _raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Bookings", "scopes": ["catalog:read", "orders:write"], "allowed_origins": []},
        )
        item = product_services.create_product(
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
        payload = {
            "external_reference": "wp-order-100",
            "source_platform": "wordpress",
            "customer_name": "Buyer",
            "customer_email": "buyer@example.com",
            "line_items": [{"slug": "room-a", "quantity": "2"}],
            "metadata": {"checkout_url": "https://example.com/order/100"},
        }

        order, replayed = services.create_public_order(
            self.db,
            tenant_id=10,
            api_key_id=key.id,
            payload=payload,
        )
        second_order, second_replayed = services.create_public_order(
            self.db,
            tenant_id=10,
            api_key_id=key.id,
            payload=payload,
        )
        self.db.refresh(item)

        self.assertFalse(replayed)
        self.assertTrue(second_replayed)
        self.assertEqual(order.id, second_order.id)
        self.assertEqual(order.status, "submitted")
        self.assertEqual(str(item.stock_quantity), "2.0000")
        self.assertEqual(str(order.subtotal_amount), "100.0000")
        activity = (
            self.db.query(platform_models.ActivityLog)
            .filter(platform_models.ActivityLog.action == "website_order.submitted")
            .one()
        )
        self.assertEqual(activity.after_state["status"], "submitted")

    def test_website_order_can_be_converted_to_pos_invoice_once(self):
        key, _raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Bookings", "scopes": ["catalog:read", "orders:write"], "allowed_origins": []},
        )
        product_services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "slug": "starter",
                "name": "Starter",
                "currency": "USD",
                "public_unit_price": "25.00",
                "stock_status": "in_stock",
                "stock_quantity": "5",
                "is_public": True,
                "is_active": True,
            },
        )
        order, _replayed = services.create_public_order(
            self.db,
            tenant_id=10,
            api_key_id=key.id,
            payload={
                "external_reference": "wp-order-200",
                "source_platform": "wordpress",
                "customer_name": "Buyer",
                "customer_email": "buyer@example.com",
                "line_items": [{"slug": "starter", "quantity": "2"}],
            },
        )
        current_user = type("UserCtx", (), {"id": 7, "tenant_id": 10, "role_id": None, "team_id": None})()

        invoice, already_existing = services.create_pos_invoice_for_order(self.db, current_user=current_user, order_id=order.id)
        second_invoice, second_existing = services.create_pos_invoice_for_order(self.db, current_user=current_user, order_id=order.id)

        self.assertFalse(already_existing)
        self.assertTrue(second_existing)
        self.assertEqual(invoice.id, second_invoice.id)
        self.assertEqual(str(invoice.total_amount), "50.00")
        self.assertEqual(invoice.customer_email, "buyer@example.com")

    def test_update_order_status_persists_and_logs_activity(self):
        key, _raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Portal", "scopes": ["orders:write"], "allowed_origins": []},
        )
        product_services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "slug": "review-item",
                "name": "Review Item",
                "currency": "USD",
                "public_unit_price": "20.00",
                "stock_status": "in_stock",
                "stock_quantity": "5",
                "is_public": True,
                "is_active": True,
            },
        )
        order, _replayed = services.create_public_order(
            self.db,
            tenant_id=10,
            api_key_id=key.id,
            payload={
                "external_reference": "portal-order-200",
                "source_platform": "client_portal",
                "customer_email": "buyer@example.com",
                "line_items": [{"slug": "review-item", "quantity": "1"}],
            },
        )
        order.status = "submitted"
        self.db.add(order)
        self.db.commit()
        current_user = type("UserCtx", (), {"id": 7, "tenant_id": 10, "role_id": None, "team_id": None})()

        updated = services.update_order_status(self.db, current_user=current_user, order_id=order.id, status_value="under_review")

        self.assertEqual(updated.status, "under_review")
        activity = (
            self.db.query(platform_models.ActivityLog)
            .filter(platform_models.ActivityLog.action == "website_order.status_updated")
            .one()
        )
        self.assertEqual(activity.tenant_id, 10)
        self.assertEqual(activity.actor_user_id, 7)
        self.assertEqual(activity.before_state["status"], "submitted")
        self.assertEqual(activity.after_state["status"], "under_review")

    def test_cancelling_or_rejecting_an_order_returns_its_stock_and_closes_it(self):
        from app.modules.catalog.models import CatalogProduct
        from app.modules.inventory.models import InventoryStockMove

        key, _raw_key = services.create_api_key(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Shop", "scopes": ["orders:write"], "allowed_origins": []},
        )
        product = product_services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "slug": "stocked-item",
                "name": "Stocked Item",
                "currency": "USD",
                "public_unit_price": "10.00",
                "stock_status": "in_stock",
                "stock_quantity": "5",
                "is_public": True,
                "is_active": True,
            },
        )
        current_user = type("UserCtx", (), {"id": 7, "tenant_id": 10, "role_id": None, "team_id": None})()
        orders = []
        for reference in ("shop-cancel", "shop-reject"):
            order, _replayed = services.create_public_order(
                self.db,
                tenant_id=10,
                api_key_id=key.id,
                payload={"external_reference": reference, "line_items": [{"slug": "stocked-item", "quantity": "2"}]},
            )
            orders.append(order)
        self.assertEqual(self.db.get(CatalogProduct, product.id).stock_quantity, Decimal("1"))

        services.update_order_status(self.db, current_user=current_user, order_id=orders[0].id, status_value="cancelled")
        services.update_order_status(self.db, current_user=current_user, order_id=orders[1].id, status_value="rejected")

        self.db.expire_all()
        self.assertEqual(self.db.get(CatalogProduct, product.id).stock_quantity, Decimal("5"))
        reversals = self.db.query(InventoryStockMove).filter(InventoryStockMove.move_type == "reversal").all()
        self.assertEqual(sorted(move.source_id for move in reversals), sorted(order.id for order in orders))
        self.assertTrue(all(move.quantity == Decimal("2") and move.created_by == 7 for move in reversals))

        for order, next_status in ((orders[0], "confirmed"), (orders[1], "cancelled")):
            with self.assertRaises(Exception) as exc:
                services.update_order_status(self.db, current_user=current_user, order_id=order.id, status_value=next_status)
            self.assertEqual(exc.exception.status_code, 409)
        self.db.rollback()
        self.assertEqual(self.db.get(CatalogProduct, product.id).stock_quantity, Decimal("5"))

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
        services.create_public_order(self.db, tenant_id=10, api_key_id=key.id, payload=payload)

        with self.assertRaises(Exception):
            services.create_public_order(
                self.db,
                tenant_id=10,
                api_key_id=key.id,
                payload={**payload, "line_items": [{"slug": "starter-package", "quantity": "2"}]},
            )

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
