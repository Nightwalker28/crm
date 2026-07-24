import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.user_management.models import Module, RoleModulePermission, TenantModuleConfig, TenantSidebarTab
from app.modules.user_management.services import auth


class FakeQuery:
    def __init__(self, result):
        self.result = result

    def filter(self, *_args):
        return self

    def join(self, *_args):
        return self

    def order_by(self, *_args):
        return self

    def all(self):
        return self.result


class FakeDB:
    def __init__(self, *, modules, permissions=None):
        self.modules = modules
        self.permissions = permissions or []

    def query(self, entity):
        if entity is TenantModuleConfig:
            return FakeQuery([])
        if entity is TenantSidebarTab:
            return FakeQuery([])
        if entity is Module:
            return FakeQuery(self.modules)
        if entity is RoleModulePermission:
            return FakeQuery(self.permissions)
        raise AssertionError(f"Unexpected query entity: {entity}")


class AuthModuleAccessTests(unittest.TestCase):
    def test_accessible_modules_do_not_force_schema_enabled_flag(self):
        module = SimpleNamespace(id=1, name="sales", is_enabled=1)
        schema = SimpleNamespace(is_enabled=False, model_dump=lambda: {
            "id": 1,
            "name": "sales",
            "is_enabled": False,
        })
        user = SimpleNamespace(id=1, tenant_id=10, role_id=1, _token_role_level=100)

        with patch(
            "app.modules.user_management.services.auth.is_module_enabled_for_tenant",
            return_value=True,
        ), patch(
            "app.modules.user_management.services.auth.build_module_schema",
            return_value=schema,
        ):
            result = auth.get_user_accessible_modules(user, FakeDB(modules=[module]))

        self.assertEqual(len(result), 1)
        self.assertFalse(result[0].is_enabled)
        self.assertTrue(result[0].actions.can_create)

    def test_accessible_modules_include_current_role_actions(self):
        module = SimpleNamespace(id=1, name="sales", is_enabled=1)
        schema = SimpleNamespace(model_dump=lambda: {
            "id": 1,
            "name": "sales",
            "is_enabled": True,
        })
        permission = SimpleNamespace(
            module_id=1,
            can_view=1,
            can_create=0,
            can_edit=1,
            can_delete=0,
            can_restore=0,
            can_export=1,
            can_configure=0,
        )
        user = SimpleNamespace(id=1, tenant_id=10, role_id=3, _token_role_level=10)

        with patch(
            "app.modules.user_management.services.auth.get_role_visible_modules",
            return_value=[module],
        ), patch(
            "app.modules.user_management.services.auth.is_module_enabled_for_tenant",
            return_value=True,
        ), patch(
            "app.modules.user_management.services.auth.user_has_module_assignment",
            return_value=True,
        ), patch(
            "app.modules.user_management.services.auth.build_module_schema",
            return_value=schema,
        ):
            result = auth.get_user_accessible_modules(
                user,
                FakeDB(modules=[module], permissions=[permission]),
            )

        self.assertEqual(len(result), 1)
        self.assertFalse(result[0].actions.can_create)
        self.assertTrue(result[0].actions.can_edit)
        self.assertTrue(result[0].actions.can_export)


if __name__ == "__main__":
    unittest.main()
