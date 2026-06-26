import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.user_management.models import Module, TenantModuleConfig, TenantSidebarTab
from app.modules.user_management.services import auth


class FakeQuery:
    def __init__(self, result):
        self.result = result

    def filter(self, *_args):
        return self

    def order_by(self, *_args):
        return self

    def all(self):
        return self.result


class FakeDB:
    def __init__(self, *, modules):
        self.modules = modules

    def query(self, entity):
        if entity is TenantModuleConfig:
            return FakeQuery([])
        if entity is TenantSidebarTab:
            return FakeQuery([])
        if entity is Module:
            return FakeQuery(self.modules)
        raise AssertionError(f"Unexpected query entity: {entity}")


class AuthModuleAccessTests(unittest.TestCase):
    def test_accessible_modules_do_not_force_schema_enabled_flag(self):
        module = SimpleNamespace(id=1, name="sales", is_enabled=1)
        schema = SimpleNamespace(is_enabled=False)
        user = SimpleNamespace(id=1, tenant_id=10, role_id=1, _token_role_level=100)

        with patch(
            "app.modules.user_management.services.auth.is_module_enabled_for_tenant",
            return_value=True,
        ), patch(
            "app.modules.user_management.services.auth.build_module_schema",
            return_value=schema,
        ):
            result = auth.get_user_accessible_modules(user, FakeDB(modules=[module]))

        self.assertEqual(result, [schema])
        self.assertFalse(result[0].is_enabled)


if __name__ == "__main__":
    unittest.main()
