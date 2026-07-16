import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.v1.router import router
from app.bootstrap.seed import DEFAULT_MODULES
from app.core.access_control import PermissionPolicy
from app.core.database import Base
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.crm_events import safe_publish_crm_event
from app.modules.user_management.models import (
    Department,
    DepartmentModulePermission,
    Module,
    Role,
    RoleModulePermission,
    Tenant,
    Team,
    User,
    UserStatus,
)


class PermissionPolicyTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                Role(id=10, tenant_id=10, name="User", level=10),
                Role(id=99, tenant_id=99, name="Other User", level=10),
                Department(id=10, tenant_id=10, name="Sales"),
                Department(id=99, tenant_id=99, name="Other Sales"),
                Team(id=10, tenant_id=10, department_id=10, name="Sales Team"),
                Module(id=10, name="sales_orders", base_route="/dashboard/sales/orders"),
                User(id=10, tenant_id=10, role_id=10, team_id=10, email="user@example.test", is_active=UserStatus.active),
                User(id=11, tenant_id=10, role_id=10, department_id=99, email="mismatch@example.test", is_active=UserStatus.active),
                User(id=12, tenant_id=10, role_id=99, email="role-mismatch@example.test", is_active=UserStatus.active),
                RoleModulePermission(id=10, role_id=10, module_id=10, can_view=1, can_create=1, can_delete=0),
                RoleModulePermission(id=99, role_id=99, module_id=10, can_view=1, can_create=1),
                DepartmentModulePermission(id=10, department_id=10, module_id=10),
                DepartmentModulePermission(id=99, department_id=99, module_id=10),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_policy_allows_assigned_action_and_denies_missing_action(self):
        user = self.db.query(User).filter(User.id == 10).one()
        policy = PermissionPolicy(self.db, user)

        self.assertTrue(policy.can_view_module("sales_orders"))
        self.assertTrue(policy.can_perform_action("sales_orders", "create"))
        self.assertFalse(policy.can_perform_action("sales_orders", "delete"))

    def test_policy_denies_cross_tenant_department_assignment(self):
        user = self.db.query(User).filter(User.id == 11).one()

        self.assertFalse(PermissionPolicy(self.db, user).can_view_module("sales_orders"))

    def test_policy_denies_cross_tenant_role_assignment(self):
        user = self.db.query(User).filter(User.id == 12).one()

        self.assertFalse(PermissionPolicy(self.db, user).can_perform_action("sales_orders", "create"))


class SharedHelperTests(unittest.TestCase):
    def test_safe_log_activity_rolls_back_and_does_not_raise(self):
        db = Mock()
        with (
            patch("app.modules.platform.services.activity_logs.log_activity", side_effect=RuntimeError("timeline failed")),
            patch("app.modules.platform.services.activity_logs.logger.exception"),
        ):
            result = safe_log_activity(
                db,
                tenant_id=10,
                actor_user_id=1,
                module_key="support_cases",
                entity_type="support_case",
                entity_id=7,
                action="create",
            )

        self.assertIsNone(result)
        db.rollback.assert_called_once()

    def test_standard_event_publisher_adds_entity_context(self):
        db = Mock()
        with patch("app.modules.platform.services.crm_events.safe_emit_crm_event", return_value=SimpleNamespace(id=1)) as emit:
            event = safe_publish_crm_event(
                db,
                tenant_id=10,
                actor_user_id=1,
                event_type="case.status_changed",
                entity_type="support_case",
                entity_id=7,
                payload={"to": "resolved"},
            )

        self.assertEqual(event.id, 1)
        self.assertEqual(emit.call_args.kwargs["payload"], {"entity_type": "support_case", "entity_id": "7", "to": "resolved"})

    def test_standard_event_publisher_rejects_unregistered_names(self):
        with self.assertRaises(ValueError):
            safe_publish_crm_event(
                Mock(),
                tenant_id=10,
                actor_user_id=1,
                event_type="case.magic",
                entity_type="support_case",
                entity_id=7,
            )


class ModuleRegistrationChecklistTests(unittest.TestCase):
    def test_recent_operational_modules_are_registered_end_to_end(self):
        expected = {
            "sales_orders": ("/api/v1/sales/orders", "/dashboard/sales/orders"),
            "support_cases": ("/api/v1/support/cases", "/dashboard/support/cases"),
            "contracts": ("/api/v1/contracts", "/dashboard/contracts"),
        }
        seeded_modules = {module["name"]: module["base_route"] for module in DEFAULT_MODULES}
        api_paths = {
            context.path
            for route in router.routes
            for context in (
                route.effective_route_contexts()
                if hasattr(route, "effective_route_contexts")
                else (route,)
            )
        }

        for module_key, (api_prefix, dashboard_route) in expected.items():
            with self.subTest(module_key=module_key):
                self.assertIn(module_key, seeded_modules)
                self.assertEqual(seeded_modules[module_key], dashboard_route)
                self.assertTrue(any(path == api_prefix or path.startswith(f"{api_prefix}/") for path in api_paths))


if __name__ == "__main__":
    unittest.main()
