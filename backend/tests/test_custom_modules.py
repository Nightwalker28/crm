import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.platform.custom_modules_schema import CustomModuleCreate, CustomModuleFieldCreate, CustomModuleFieldUpdate
from app.modules.platform.schema import ModuleFieldConfigUpdateRequest
from app.modules.platform.models import (
    CustomModuleDefinition,
    CustomModuleFieldDefinition,
    CustomModuleRecord,
    CustomModuleRecordValue,
)
from app.modules.platform.repositories import custom_modules_repository
from app.modules.platform.services import custom_modules
from app.modules.platform.services import module_fields
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


class EmptyQuery:
    def filter(self, *args):
        return self

    def first(self):
        return None


class FakeCustomModuleRecordQuery:
    def __init__(self):
        self.operations = []

    def count(self):
        self.operations.append("count")
        return 3

    def order_by(self, *args):
        self.operations.append("order_by_reset" if len(args) == 1 and args[0] is None else "order_by")
        return self

    def offset(self, value):
        self.operations.append(f"offset:{value}")
        return self

    def limit(self, value):
        self.operations.append(f"limit:{value}")
        return self

    def all(self):
        self.operations.append("all")
        return [SimpleNamespace(id=2, title="Asset B")]


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
    def test_list_records_sorts_before_pagination(self):
        query = FakeCustomModuleRecordQuery()
        definition = SimpleNamespace(id=1, tenant_id=7)

        with patch.object(custom_modules_repository, "build_records_query", return_value=query):
            records, total_count = custom_modules_repository.list_records(
                object(),
                definition=definition,
                offset=10,
                limit=5,
                sort_by="title",
                sort_direction="asc",
            )

        self.assertEqual(total_count, 3)
        self.assertEqual([record.title for record in records], ["Asset B"])
        self.assertEqual(
            query.operations,
            ["count", "order_by_reset", "order_by", "offset:10", "limit:5", "all"],
        )

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

    def test_add_field_rejects_disabled_protected_identifier(self):
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")

        with self.assertRaises(HTTPException) as exc:
            custom_modules._add_field(
                FakeDB(),
                definition=definition,
                payload=CustomModuleFieldCreate(label="Name", field_type="text", is_active=False),
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Protected identifier fields cannot be disabled")

    def test_update_field_rejects_disabling_protected_identifier(self):
        field = CustomModuleFieldDefinition(
            id=1,
            tenant_id=7,
            custom_module_id=1,
            key="name",
            label="Name",
            field_type="text",
            is_active=True,
        )
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")
        definition.fields.append(field)

        with patch("app.modules.platform.services.custom_modules._get_module_definition", return_value=definition):
            with self.assertRaises(HTTPException) as exc:
                custom_modules.update_field(
                    FakeDB(),
                    tenant_id=7,
                    module_id=1,
                    field_id=1,
                    actor_user_id=9,
                    payload=CustomModuleFieldUpdate(is_active=False),
                )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Protected identifier fields cannot be disabled")

    def test_serialize_module_marks_protected_fields(self):
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")
        definition.fields.extend(
            [
                CustomModuleFieldDefinition(
                    id=1,
                    tenant_id=7,
                    custom_module_id=1,
                    key="name",
                    label="Name",
                    field_type="text",
                    is_active=True,
                ),
                CustomModuleFieldDefinition(
                    id=2,
                    tenant_id=7,
                    custom_module_id=1,
                    key="serial_number",
                    label="Serial Number",
                    field_type="text",
                    is_active=True,
                ),
            ]
        )

        response = custom_modules._serialize_module(definition)

        fields = {field.key: field for field in response.fields}
        self.assertTrue(fields["name"].is_protected)
        self.assertFalse(fields["serial_number"].is_protected)

    def test_import_target_headers_do_not_parse_uploaded_csv(self):
        definition = CustomModuleDefinition(id=1, tenant_id=7, key="assets", name="Assets")
        definition.fields.extend(
            [
                CustomModuleFieldDefinition(
                    id=2,
                    tenant_id=7,
                    custom_module_id=1,
                    key="serial_number",
                    label="Serial Number",
                    field_type="text",
                    sort_order=2,
                    is_active=True,
                ),
                CustomModuleFieldDefinition(
                    id=1,
                    tenant_id=7,
                    custom_module_id=1,
                    key="asset_tag",
                    label="Asset Tag",
                    field_type="text",
                    sort_order=1,
                    is_active=True,
                ),
            ]
        )
        user = SimpleNamespace(id=9, tenant_id=7)

        with patch("app.modules.platform.services.custom_modules._get_module_definition", return_value=definition):
            with patch("app.modules.platform.services.custom_modules._require_module_action"):
                with patch("app.modules.platform.services.custom_modules.rows_from_csv_bytes", side_effect=AssertionError("csv parsed")):
                    headers = custom_modules.import_target_headers(FakeDB(), module_key="assets", current_user=user)

        self.assertEqual(headers, ["title", "asset_tag", "serial_number"])

    def test_module_field_config_rejects_disabled_identifier(self):
        with self.assertRaises(HTTPException) as exc:
            module_fields.update_module_field_config(
                FakeDB(),
                tenant_id=7,
                module_key="sales_contacts",
                field_key="contact_id",
                payload=ModuleFieldConfigUpdateRequest(label="Contact ID", is_enabled=False),
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Protected identifier fields cannot be disabled")

    def test_module_field_config_allows_disabling_system_field(self):
        class ModuleFieldConfigDB(FakeDB):
            def query(self, model):
                return EmptyQuery()

            def commit(self):
                self.committed = True

            def refresh(self, value):
                value.id = value.id or 1

        db = ModuleFieldConfigDB()

        response = module_fields.update_module_field_config(
            db,
            tenant_id=7,
            module_key="sales_contacts",
            field_key="linkedin_url",
            payload=ModuleFieldConfigUpdateRequest(
                label="LinkedIn",
                field_type="text",
                field_source="system",
                is_enabled=False,
                sort_order=8,
            ),
        )

        self.assertFalse(response.is_enabled)
        self.assertFalse(response.is_protected)
        self.assertEqual(response.field_key, "linkedin_url")
        self.assertTrue(db.committed)

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
