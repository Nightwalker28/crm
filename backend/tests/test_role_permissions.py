import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.user_management.models import Module, Role, RoleModulePermission, TenantModuleConfig
from app.modules.user_management.schema import (
    ModulePermissionSchema,
    RoleCreateRequest,
    RolePermissionActions,
    RolePermissionUpdateRequest,
)
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
        if self.model is RoleModulePermission:
            return self.db.permissions
        if self.model is TenantModuleConfig:
            return self.db.module_configs
        return []


class FakeDB:
    def __init__(self, *, modules, existing_role=None, permissions=None, module_configs=None):
        self.modules = modules
        self.existing_role = existing_role
        self.permissions = permissions or []
        self.module_configs = module_configs or []
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
        ), patch(
            "app.modules.user_management.services.role_permissions.safe_log_activity",
        ) as activity_mock:
            role = role_permissions.create_role(
                db,
                payload,
                tenant_id=7,
                actor_user_id=11,
            )

        permission_module_ids = [
            value.module_id
            for value in db.added
            if isinstance(value, RoleModulePermission)
        ]

        self.assertEqual(role.id, 42)
        self.assertEqual(permission_module_ids, [sales.id])
        self.assertTrue(db.committed)
        activity_mock.assert_called_once()
        self.assertEqual(activity_mock.call_args.kwargs["tenant_id"], 7)
        self.assertEqual(activity_mock.call_args.kwargs["actor_user_id"], 11)


class RolePermissionUpdateTests(unittest.TestCase):
    def test_product_area_uses_tenant_module_configuration(self):
        module = Module(id=1, name="sales_leads", is_enabled=1)
        db = FakeDB(
            modules=[module],
            module_configs=[TenantModuleConfig(tenant_id=7, module_id=1, sidebar_tab_key="enterprise")],
        )

        areas = role_permissions._product_areas_by_module(db, modules=[module], tenant_id=7)

        self.assertEqual(areas, {1: "enterprise"})

    def test_request_rejects_duplicate_module_updates(self):
        with self.assertRaises(ValidationError):
            RolePermissionUpdateRequest.model_validate(
                {
                    "permissions": [
                        {"module_id": 1, "actions": {"can_view": True}},
                        {"module_id": 1, "actions": {"can_edit": True}},
                    ]
                }
            )

    def test_invalid_module_is_rejected_before_existing_permissions_are_changed(self):
        role = Role(id=10, tenant_id=7, name="Manager", level=20)
        module = Module(id=1, name="sales_leads", is_enabled=1)
        existing = RoleModulePermission(
            id=100,
            role_id=role.id,
            module_id=module.id,
            can_view=1,
            can_edit=0,
        )
        db = FakeDB(modules=[module], existing_role=role, permissions=[existing])
        payload = RolePermissionUpdateRequest.model_validate(
            {
                "permissions": [
                    {"module_id": module.id, "actions": {"can_view": True, "can_edit": True}},
                    {"module_id": 999, "actions": {"can_view": True}},
                ]
            }
        )

        with patch(
            "app.modules.user_management.services.role_permissions._module_belongs_to_tenant_or_global",
            return_value=True,
        ), self.assertRaises(HTTPException) as raised:
            role_permissions.update_role_permissions(
                db,
                role.id,
                payload,
                tenant_id=7,
                actor_user_id=11,
            )

        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(existing.can_edit, 0)
        self.assertFalse(db.committed)

    def test_update_records_actor_and_before_after_permission_state(self):
        role = Role(id=10, tenant_id=7, name="Manager", level=20)
        module = Module(id=1, name="sales_leads", is_enabled=1)
        existing = RoleModulePermission(
            id=100,
            role_id=role.id,
            module_id=module.id,
            can_view=1,
            can_create=0,
            can_edit=0,
            can_delete=0,
            can_restore=0,
            can_export=0,
            can_configure=0,
        )
        db = FakeDB(modules=[module], existing_role=role, permissions=[existing])
        payload = RolePermissionUpdateRequest.model_validate(
            {
                "permissions": [
                    {
                        "module_id": module.id,
                        "actions": {
                            "can_view": True,
                            "can_create": True,
                            "can_edit": True,
                        },
                    }
                ]
            }
        )
        updated = [
            ModulePermissionSchema(
                module_id=module.id,
                module_name=module.name,
                product_area="sales",
                actions=RolePermissionActions(can_view=True, can_create=True, can_edit=True),
            )
        ]

        with patch(
            "app.modules.user_management.services.role_permissions._module_belongs_to_tenant_or_global",
            return_value=True,
        ), patch(
            "app.modules.user_management.services.role_permissions.get_role_permissions",
            return_value=updated,
        ), patch(
            "app.modules.user_management.services.role_permissions.safe_log_activity",
        ) as activity_mock:
            result = role_permissions.update_role_permissions(
                db,
                role.id,
                payload,
                tenant_id=7,
                actor_user_id=11,
            )

        self.assertEqual(result, updated)
        self.assertEqual(existing.can_create, 1)
        self.assertEqual(existing.can_edit, 1)
        self.assertTrue(db.committed)
        activity_mock.assert_called_once()
        activity = activity_mock.call_args.kwargs
        self.assertEqual(activity["tenant_id"], 7)
        self.assertEqual(activity["actor_user_id"], 11)
        self.assertEqual(activity["action"], "role.permissions.updated")
        self.assertFalse(activity["before_state"]["permissions"][0]["actions"]["can_edit"])
        self.assertTrue(activity["after_state"]["permissions"][0]["actions"]["can_edit"])


if __name__ == "__main__":
    unittest.main()
