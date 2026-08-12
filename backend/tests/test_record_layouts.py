import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.models import CustomFieldDefinition, ModuleFieldConfig, RecordLayoutDefinition
from app.modules.platform.record_layout_schema import RecordLayoutDefinitionPayload
from app.modules.platform.routes.record_layouts import get_resolved_record_layout, router as record_layouts_router
from app.modules.platform.services.record_layouts import (
    LEAD_LAYOUT_SEEDS,
    resolve_record_layout,
    validate_layout_definition,
    validate_module_and_surface,
)
from app.modules.user_management.models import Tenant


class RecordLayoutResolverTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            engine,
            tables=[
                Tenant.__table__,
                CustomFieldDefinition.__table__,
                ModuleFieldConfig.__table__,
                RecordLayoutDefinition.__table__,
            ],
        )
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=1, slug="tenant-one", name="Tenant One"),
                Tenant(id=2, slug="tenant-two", name="Tenant Two"),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_system_fallback_is_versioned_ordered_and_protects_required_field(self):
        self.db.add(
            ModuleFieldConfig(
                id=1,
                tenant_id=1,
                module_key="sales_leads",
                field_key="phone",
                label="Phone",
                is_enabled=False,
                is_protected=False,
            )
        )
        self.db.commit()

        with patch(
            "app.modules.platform.services.record_layouts.list_custom_field_definitions",
            return_value=[
                SimpleNamespace(
                    field_key="qualification_note",
                    label="Qualification note",
                    field_type="long_text",
                    is_required=True,
                    placeholder="Why is this lead qualified?",
                    help_text="Required by this workspace.",
                )
            ],
        ):
            result = resolve_record_layout(
                self.db,
                tenant_id=1,
                module_key="sales_leads",
                surface="quick_create",
            )

        self.assertEqual(result.source, "system")
        self.assertEqual(result.version, 1)
        self.assertEqual([section.position for section in result.sections], [0, 1, 2])
        fields = [field for section in result.sections for field in section.fields]
        keys = [field.field_key for field in fields]
        self.assertNotIn("phone", keys)
        self.assertIn("primary_email", keys)
        self.assertIn("custom:qualification_note", keys)
        required = {field.field_key: field.required for field in fields}
        self.assertTrue(required["primary_email"])
        self.assertTrue(required["custom:qualification_note"])

    def test_detail_fallback_appends_tenant_custom_fields_and_is_read_only(self):
        definitions = {
            1: [
                SimpleNamespace(
                    field_key="renewal_tier",
                    label="Renewal tier",
                    field_type="text",
                    is_required=False,
                    placeholder=None,
                    help_text="Tenant one field.",
                )
            ],
            2: [],
        }
        with patch(
            "app.modules.platform.services.record_layouts.list_custom_field_definitions",
            side_effect=lambda _db, *, tenant_id, **_kwargs: definitions[tenant_id],
        ):
            tenant_one = resolve_record_layout(
                self.db,
                tenant_id=1,
                module_key="sales_leads",
                surface="detail",
            )
            tenant_two = resolve_record_layout(
                self.db,
                tenant_id=2,
                module_key="sales_leads",
                surface="detail",
            )

        tenant_one_fields = [field for section in tenant_one.sections for field in section.fields]
        tenant_two_keys = [field.field_key for section in tenant_two.sections for field in section.fields]
        custom = next(field for field in tenant_one_fields if field.field_key == "custom:renewal_tier")
        self.assertEqual(custom.label, "Renewal tier")
        self.assertTrue(custom.readonly)
        self.assertTrue(all(field.readonly for field in tenant_one_fields))
        self.assertNotIn("custom:renewal_tier", tenant_two_keys)

    def test_tenant_default_is_scoped_and_stale_fields_are_omitted_with_warning(self):
        tenant_layout = LEAD_LAYOUT_SEEDS["detail"].model_dump(mode="json")
        tenant_layout["sections"][0]["fields"].insert(
            0,
            {"field_key": "custom:deleted_field", "position": 99, "width": "half", "visible": True},
        )
        self.db.add(
            RecordLayoutDefinition(
                tenant_id=1,
                module_key="sales_leads",
                surface="detail",
                name="Tenant One Detail",
                is_default=True,
                version=4,
                sections=tenant_layout["sections"],
            )
        )
        self.db.commit()

        with patch(
            "app.modules.platform.services.record_layouts.list_custom_field_definitions",
            return_value=[],
        ):
            tenant_one = resolve_record_layout(
                self.db,
                tenant_id=1,
                module_key="sales_leads",
                surface="detail",
            )
            tenant_two = resolve_record_layout(
                self.db,
                tenant_id=2,
                module_key="sales_leads",
                surface="detail",
            )

        self.assertEqual(tenant_one.source, "tenant")
        self.assertEqual(tenant_one.version, 4)
        self.assertIn("Omitted stale field reference: custom:deleted_field", tenant_one.warnings)
        self.assertEqual(tenant_two.source, "system")
        self.assertEqual(tenant_two.version, 1)

    def test_invalid_stored_layout_fails_safe_to_system_fallback(self):
        self.db.add(
            RecordLayoutDefinition(
                tenant_id=1,
                module_key="sales_leads",
                surface="quick_create",
                name="Broken",
                is_default=True,
                version=2,
                sections=[{"id": "bad id", "label": "Broken", "position": 0, "region": "main", "fields": []}],
            )
        )
        self.db.commit()

        with patch(
            "app.modules.platform.services.record_layouts.list_custom_field_definitions",
            return_value=[],
        ):
            result = resolve_record_layout(
                self.db,
                tenant_id=1,
                module_key="sales_leads",
                surface="quick_create",
            )

        self.assertEqual(result.source, "system")
        self.assertEqual(result.version, 1)
        self.assertIn("Stored layout is invalid; using the system fallback", result.warnings)

    def test_stored_quick_create_falls_back_when_required_field_is_hidden_or_read_only(self):
        stored = LEAD_LAYOUT_SEEDS["quick_create"].model_copy(deep=True)
        email = next(field for section in stored.sections for field in section.fields if field.field_key == "primary_email")
        email.visible = False
        record = RecordLayoutDefinition(
            tenant_id=1,
            module_key="sales_leads",
            surface="quick_create",
            name="Unsafe Quick Create",
            is_default=True,
            version=3,
            sections=[section.model_dump(mode="json") for section in stored.sections],
        )
        self.db.add(record)
        self.db.commit()

        with patch(
            "app.modules.platform.services.record_layouts.list_custom_field_definitions",
            return_value=[],
        ):
            hidden_result = resolve_record_layout(
                self.db,
                tenant_id=1,
                module_key="sales_leads",
                surface="quick_create",
            )

            email.visible = True
            email.readonly = True
            record.sections = [section.model_dump(mode="json") for section in stored.sections]
            record.version = 4
            self.db.commit()
            read_only_result = resolve_record_layout(
                self.db,
                tenant_id=1,
                module_key="sales_leads",
                surface="quick_create",
            )

        for result in (hidden_result, read_only_result):
            self.assertEqual(result.source, "system")
            self.assertIsNone(result.layout_id)
            self.assertEqual(result.version, 1)
            resolved_email = next(
                field for section in result.sections for field in section.fields if field.field_key == "primary_email"
            )
            self.assertTrue(resolved_email.visible)
            self.assertFalse(resolved_email.readonly)

    def test_definition_validation_rejects_unknown_and_hidden_required_fields(self):
        unknown = LEAD_LAYOUT_SEEDS["quick_create"].model_copy(deep=True)
        unknown.sections[0].fields.append(
            type(unknown.sections[0].fields[0])(field_key="custom:not_owned", position=20)
        )
        hidden = LEAD_LAYOUT_SEEDS["quick_create"].model_copy(deep=True)
        email = next(field for section in hidden.sections for field in section.fields if field.field_key == "primary_email")
        email.visible = False

        with patch(
            "app.modules.platform.services.record_layouts.list_custom_field_definitions",
            return_value=[],
        ):
            with self.assertRaisesRegex(ValueError, "Unknown layout field keys"):
                validate_layout_definition(self.db, tenant_id=1, definition=unknown)
            with self.assertRaisesRegex(ValueError, "Required Quick Create fields must remain visible"):
                validate_layout_definition(self.db, tenant_id=1, definition=hidden)

    def test_definition_schema_rejects_extra_properties_and_duplicate_positions(self):
        payload = LEAD_LAYOUT_SEEDS["detail"].model_dump(mode="json")
        payload["arbitrary_expression"] = "window.alert(1)"
        with self.assertRaises(ValidationError):
            RecordLayoutDefinitionPayload.model_validate(payload)

        payload.pop("arbitrary_expression")
        payload["sections"][0]["fields"][1]["position"] = payload["sections"][0]["fields"][0]["position"]
        with self.assertRaises(ValidationError):
            RecordLayoutDefinitionPayload.model_validate(payload)

    def test_module_and_surface_are_bounded_to_adopted_modules(self):
        for module_key in ("sales_leads", "sales_contacts", "sales_organizations"):
            for surface in ("quick_create", "detail"):
                self.assertEqual(
                    validate_module_and_surface(module_key, surface),
                    (module_key, surface),
                )
        self.assertEqual(
            validate_module_and_surface("sales_opportunities", "quick_create"),
            ("sales_opportunities", "quick_create"),
        )

        with self.assertRaises(HTTPException) as unadopted_module:
            validate_module_and_surface("sales_quotes", "detail")
        self.assertEqual(unadopted_module.exception.status_code, 404)

        with self.assertRaises(HTTPException) as future_surface:
            validate_module_and_surface("sales_leads", "full_form")
        self.assertEqual(future_surface.exception.status_code, 422)

        # The Opportunity workspace, and so its detail layout, belongs to a later slice.
        with self.assertRaises(HTTPException) as unseeded_surface:
            validate_module_and_surface("sales_opportunities", "detail")
        self.assertEqual(unseeded_surface.exception.status_code, 422)


class RecordLayoutRouteTests(unittest.TestCase):
    def test_runtime_route_requires_surface_specific_action(self):
        calls: list[tuple[str, str]] = []

        def module_dependency(module_key):
            def check(**_kwargs):
                calls.append((module_key, "module"))
            return check

        def action_dependency(module_key, action):
            def check(**_kwargs):
                calls.append((module_key, action))
            return check

        resolved = LEAD_LAYOUT_SEEDS["quick_create"]
        with (
            patch("app.modules.platform.routes.record_layouts.require_module_access", side_effect=module_dependency),
            patch("app.modules.platform.routes.record_layouts.require_action_access", side_effect=action_dependency),
            patch("app.modules.platform.routes.record_layouts.resolve_record_layout", return_value=resolved),
        ):
            get_resolved_record_layout(
                "sales_leads",
                "quick_create",
                db=SimpleNamespace(),
                current_user=SimpleNamespace(tenant_id=7),
            )
        self.assertEqual(calls, [("sales_leads", "module"), ("sales_leads", "create")])

        calls.clear()
        with (
            patch("app.modules.platform.routes.record_layouts.require_module_access", side_effect=module_dependency),
            patch("app.modules.platform.routes.record_layouts.require_action_access", side_effect=action_dependency),
            patch("app.modules.platform.routes.record_layouts.resolve_record_layout", return_value=resolved),
        ):
            get_resolved_record_layout(
                "sales_leads",
                "detail",
                db=SimpleNamespace(),
                current_user=SimpleNamespace(tenant_id=7),
            )
        self.assertEqual(calls, [("sales_leads", "module"), ("sales_leads", "view")])

    def test_runtime_route_is_registered(self):
        paths = {route.path for route in record_layouts_router.routes if hasattr(route, "path")}
        self.assertIn("/record-layouts/{module_key}/{surface}/resolved", paths)


if __name__ == "__main__":
    unittest.main()
