import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.platform.custom_modules_schema import CustomModuleCreate, CustomModuleFieldCreate
from app.modules.platform.models import (
    CustomModuleDefinition,
    CustomModuleFieldDefinition,
    CustomModuleRecord,
    CustomModuleRecordValue,
)
from app.modules.platform.services import custom_modules
from app.modules.user_management.models import (
    Department,
    DepartmentModulePermission,
    Module,
    Role,
    RoleModulePermission,
    Team,
    TeamModulePermission,
    TenantModuleConfig,
)


class FakeDB:
    def __init__(self):
        self.added = []
        self.flushed = False

    def add(self, value):
        self.added.append(value)

    def flush(self):
        self.flushed = True
        for value in self.added:
            if getattr(value, "id", None) is None:
                value.id = len(self.added)


class FirstResultQuery:
    def __init__(self, result):
        self.result = result

    def filter(self, *args):
        return self

    def first(self):
        return self.result


class ReservedModuleDB(FakeDB):
    def query(self, model):
        if model is CustomModuleDefinition:
            return FirstResultQuery(None)
        return FirstResultQuery(SimpleNamespace(id=42, name="tasks"))


class SeedAccessQuery:
    def __init__(self, db, target):
        self.db = db
        self.target = target

    def filter(self, *args):
        return self

    def first(self):
        if self.target is TenantModuleConfig:
            return self.db.tenant_config
        return None

    def all(self):
        if self.target is DepartmentModulePermission.department_id:
            return [(permission.department_id,) for permission in self.db.department_permissions]
        if self.target is TeamModulePermission.team_id:
            return [(permission.team_id,) for permission in self.db.team_permissions]
        if self.target is RoleModulePermission.role_id:
            return [(permission.role_id,) for permission in self.db.role_permissions]
        if self.target is Department:
            return self.db.departments
        if self.target is Team:
            return self.db.teams
        if self.target is Role:
            return self.db.roles
        return []


class SeedAccessDB:
    def __init__(self):
        self.tenant_config = None
        self.department_permissions = []
        self.team_permissions = []
        self.role_permissions = []
        self.departments = [SimpleNamespace(id=3, tenant_id=7)]
        self.teams = [SimpleNamespace(id=4, tenant_id=7)]
        self.roles = [SimpleNamespace(id=5, tenant_id=7, level=100)]

    def query(self, target):
        return SeedAccessQuery(self, target)

    def add(self, value):
        if isinstance(value, TenantModuleConfig):
            self.tenant_config = value
        elif isinstance(value, DepartmentModulePermission):
            self.department_permissions.append(value)
        elif isinstance(value, TeamModulePermission):
            self.team_permissions.append(value)
        elif isinstance(value, RoleModulePermission):
            self.role_permissions.append(value)


class CustomModuleFieldTests(unittest.TestCase):
    def test_add_field_normalizes_key_from_label(self):
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")
        db = FakeDB()

        field = custom_modules._add_field(
            db,
            definition=definition,
            payload=CustomModuleFieldCreate(label="Serial Number", field_type="text"),
        )

        self.assertEqual(field.key, "serial_number")
        self.assertEqual(field.tenant_id, 7)
        self.assertTrue(db.flushed)

    def test_add_field_rejects_duplicate_active_key(self):
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")
        definition.fields.append(
            CustomModuleFieldDefinition(
                id=9,
                tenant_id=7,
                custom_module_id=1,
                key="serial_number",
                label="Serial Number",
                field_type="text",
                is_active=True,
            )
        )

        with self.assertRaises(HTTPException) as exc:
            custom_modules._add_field(
                FakeDB(),
                definition=definition,
                payload=CustomModuleFieldCreate(label="Serial Number", field_type="text"),
            )

        self.assertEqual(exc.exception.status_code, 409)

    def test_add_field_rejects_unique_multi_select(self):
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")

        with self.assertRaises(HTTPException) as exc:
            custom_modules._add_field(
                FakeDB(),
                definition=definition,
                payload=CustomModuleFieldCreate(label="Tags", field_type="multi_select", is_unique=True),
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Multi-select fields cannot be unique")

    def test_create_module_rejects_built_in_module_key(self):
        with self.assertRaises(HTTPException) as exc:
            custom_modules.create_module(
                ReservedModuleDB(),
                tenant_id=7,
                actor_user_id=9,
                payload=CustomModuleCreate(name="Tasks"),
            )

        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(exc.exception.detail, "Custom module key is reserved")

    def test_seed_access_is_idempotent(self):
        db = SeedAccessDB()
        module = Module(id=42, name="custom_assets", base_route="custom/assets", is_enabled=1)

        custom_modules._seed_access(db, tenant_id=7, module=module)
        custom_modules._seed_access(db, tenant_id=7, module=module)

        self.assertIsNotNone(db.tenant_config)
        self.assertEqual(len(db.department_permissions), 1)
        self.assertEqual(len(db.team_permissions), 1)
        self.assertEqual(len(db.role_permissions), 1)

    def test_serialize_record_omits_deleted_and_inactive_fields(self):
        active_field = CustomModuleFieldDefinition(
            id=1,
            tenant_id=7,
            custom_module_id=1,
            key="serial_number",
            label="Serial Number",
            field_type="text",
            is_active=True,
        )
        deleted_field = CustomModuleFieldDefinition(
            id=2,
            tenant_id=7,
            custom_module_id=1,
            key="legacy_code",
            label="Legacy Code",
            field_type="text",
            is_active=True,
            deleted_at=datetime.now(timezone.utc),
        )
        inactive_field = CustomModuleFieldDefinition(
            id=3,
            tenant_id=7,
            custom_module_id=1,
            key="inactive_code",
            label="Inactive Code",
            field_type="text",
            is_active=False,
        )
        record = CustomModuleRecord(id=5, tenant_id=7, custom_module_id=1, title="Asset 1")
        record.values.extend(
            [
                CustomModuleRecordValue(field=active_field, text_value="SN-1"),
                CustomModuleRecordValue(field=deleted_field, text_value="OLD"),
                CustomModuleRecordValue(field=inactive_field, text_value="OFF"),
            ]
        )

        response = custom_modules.serialize_record(record)

        self.assertEqual(response.values, {"serial_number": "SN-1"})

    def test_partial_value_write_preserves_omitted_required_fields(self):
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")
        definition.fields.append(
            CustomModuleFieldDefinition(
                id=1,
                tenant_id=7,
                custom_module_id=1,
                key="serial_number",
                label="Serial Number",
                field_type="text",
                is_required=True,
                is_active=True,
            )
        )
        record = CustomModuleRecord(id=5, tenant_id=7, custom_module_id=1, title="Asset 1")

        custom_modules._write_values(
            FakeDB(),
            definition=definition,
            record=record,
            payload_values={},
            partial=True,
        )

        self.assertEqual(record.values, [])

    def test_value_write_rejects_unknown_field_keys(self):
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")
        record = CustomModuleRecord(id=5, tenant_id=7, custom_module_id=1, title="Asset 1")

        with self.assertRaises(HTTPException) as exc:
            custom_modules._write_values(
                FakeDB(),
                definition=definition,
                record=record,
                payload_values={"missing": "value"},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Unknown field: missing")

    def test_runtime_action_rejects_disabled_module_for_admin(self):
        definition = CustomModuleDefinition(
            id=1,
            tenant_id=7,
            key="assets",
            name="Assets",
            is_active=True,
            module=SimpleNamespace(id=3, is_enabled=0),
        )
        user = SimpleNamespace(id=9, tenant_id=7, role_id=1, _token_role_level=100)

        with patch(
            "app.modules.platform.services.custom_modules.is_module_enabled_for_tenant",
            return_value=False,
        ):
            with self.assertRaises(HTTPException) as exc:
                custom_modules._require_module_action(
                    FakeDB(),
                    user=user,
                    definition=definition,
                    action="view",
                )

        self.assertEqual(exc.exception.status_code, 403)
        self.assertEqual(exc.exception.detail, "This module is disabled")


if __name__ == "__main__":
    unittest.main()
