import unittest
from unittest.mock import patch

from app.modules.user_management.models import Module, Role, RoleModulePermission
from app.modules.user_management.schema import RoleCreateRequest
from app.modules.user_management.services import role_permissions


class FakeQuery:
    def __init__(self, db, model):
        self.db = db
        self.model = model

    def filter(self, *conditions):
        return self

    def first(self):
        if self.model is Role:
            return self.db.existing_role
        return None

    def all(self):
        if self.model is Module:
            return self.db.modules
        return []


class FakeDB:
    def __init__(self, *, modules, existing_role=None):
        self.modules = modules
        self.existing_role = existing_role
        self.added = []
        self.committed = False

    def query(self, model):
        return FakeQuery(self, model)

    def add(self, value):
        self.added.append(value)

    def flush(self):
        for value in self.added:
            if isinstance(value, Role) and value.id is None:
                value.id = 42

    def commit(self):
        self.committed = True

    def refresh(self, _value):
        return None


class RolePermissionCreationTests(unittest.TestCase):
    def test_create_role_only_grants_permissions_for_tenant_enabled_modules(self):
        sales = Module(id=1, name="sales", is_enabled=1)
        finance = Module(id=2, name="finance", is_enabled=1)
        db = FakeDB(modules=[sales, finance])
        payload = RoleCreateRequest(name="Ops Lead", template_key="superuser")

        with patch(
            "app.modules.user_management.services.role_permissions.is_module_enabled_for_tenant",
            side_effect=lambda _db, tenant_id, module: module.name == "sales",
        ):
            role = role_permissions.create_role(db, payload, tenant_id=7)

        permission_module_ids = [
            value.module_id
            for value in db.added
            if isinstance(value, RoleModulePermission)
        ]

        self.assertEqual(role.id, 42)
        self.assertEqual(permission_module_ids, [sales.id])
        self.assertTrue(db.committed)


if __name__ == "__main__":
    unittest.main()
