import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.models import (
    ActivityLog,
    CustomFieldDefinition,
    ModuleFieldConfig,
    RecordLayoutDefinition,
)
from app.modules.platform.record_layout_schema import (
    RecordLayoutDefinitionPayload,
    RecordLayoutFieldDefinition,
)
from app.modules.platform.routes.record_layouts import (
    admin_router,
    get_record_layout_admin_state,
    preview_record_layout_draft,
    publish_tenant_record_layout,
    reset_tenant_record_layout,
)
from app.modules.platform.services.record_layouts import (
    LEAD_LAYOUT_SEEDS,
    get_admin_record_layout,
    preview_record_layout,
    publish_record_layout,
    reset_record_layout,
    resolve_record_layout,
    validate_admin_module_and_surface,
)
from app.modules.user_management.models import Tenant, User


def _quick_create_draft(**overrides) -> RecordLayoutDefinitionPayload:
    draft = LEAD_LAYOUT_SEEDS["quick_create"].model_copy(deep=True)
    if overrides:
        return draft.model_copy(update=overrides)
    return draft


def _field(draft: RecordLayoutDefinitionPayload, field_key: str) -> RecordLayoutFieldDefinition:
    return next(field for section in draft.sections for field in section.fields if field.field_key == field_key)


class RecordLayoutAdminServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            engine,
            tables=[
                Tenant.__table__,
                User.__table__,
                ActivityLog.__table__,
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
        self.custom_fields = patch(
            "app.modules.platform.services.record_layouts.list_custom_field_definitions",
            return_value=[],
        )
        self.custom_fields.start()
        self.addCleanup(self.custom_fields.stop)

    def tearDown(self):
        self.db.close()

    def _publish(self, draft, *, tenant_id=1, expected_version=None, actor_user_id=None):
        return publish_record_layout(
            self.db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="sales_leads",
            surface="quick_create",
            definition=draft,
            expected_version=expected_version,
        )

    def test_admin_state_starts_from_the_system_default_with_a_locked_field_catalog(self):
        state = get_admin_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create")

        self.assertEqual(state.source, "system")
        self.assertIsNone(state.layout_id)
        self.assertIsNone(state.expected_version)
        self.assertTrue(state.validation.valid)
        self.assertEqual(state.definition.model_dump(), state.system_definition.model_dump())
        # Positions are dense so the builder can move fields by index without gaps.
        self.assertEqual([section.position for section in state.definition.sections], [0, 1])
        self.assertEqual([field.position for field in state.definition.sections[0].fields], [0, 1, 2, 3, 4])

        catalog = {field.field_key: field for field in state.available_fields}
        self.assertIn("notes", catalog)
        self.assertTrue(catalog["primary_email"].locked)
        self.assertIsNotNone(catalog["primary_email"].locked_reason)
        self.assertFalse(catalog["notes"].locked)

    def test_admin_state_reports_field_config_state_without_blocking(self):
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

        state = get_admin_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create")

        catalog = {field.field_key: field for field in state.available_fields}
        self.assertFalse(catalog["phone"].enabled)
        self.assertTrue(state.validation.valid)
        self.assertTrue(
            any("Field Config" in warning for warning in state.validation.warnings),
            state.validation.warnings,
        )

    def test_preview_validates_and_resolves_without_persisting(self):
        draft = _quick_create_draft()
        draft.sections[1].fields.append(RecordLayoutFieldDefinition(field_key="notes", position=2, width="full"))

        preview = preview_record_layout(
            self.db,
            tenant_id=1,
            module_key="sales_leads",
            surface="quick_create",
            definition=draft,
        )

        self.assertTrue(preview.validation.valid)
        self.assertIsNotNone(preview.resolved)
        keys = [field.field_key for section in preview.resolved.sections for field in section.fields]
        self.assertIn("notes", keys)
        self.assertEqual(preview.resolved.version, 1)
        # Nothing was written, so the runtime still resolves the system default.
        self.assertIsNone(
            self.db.query(RecordLayoutDefinition).filter(RecordLayoutDefinition.tenant_id == 1).first()
        )
        self.assertEqual(
            resolve_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create").source,
            "system",
        )

    def test_preview_separates_blocking_errors_from_warnings(self):
        draft = _quick_create_draft()
        _field(draft, "primary_email").visible = False

        preview = preview_record_layout(
            self.db,
            tenant_id=1,
            module_key="sales_leads",
            surface="quick_create",
            definition=draft,
        )

        self.assertFalse(preview.validation.valid)
        self.assertIsNone(preview.resolved)
        self.assertTrue(
            any("must remain visible and writable" in error for error in preview.validation.errors),
            preview.validation.errors,
        )
        # The hidden field is also worth a warning, but warnings never carry the blocking reason.
        self.assertNotIn(preview.validation.errors[0], preview.validation.warnings)

    def test_quick_create_length_produces_a_warning_but_still_publishes(self):
        draft = _quick_create_draft()
        extras = ["title", "source", "team_id", "next_follow_up_at", "tags", "notes"]
        for index, field_key in enumerate(extras):
            draft.sections[1].fields.append(
                RecordLayoutFieldDefinition(field_key=field_key, position=10 + index, width="full")
            )

        preview = preview_record_layout(
            self.db,
            tenant_id=1,
            module_key="sales_leads",
            surface="quick_create",
            definition=draft,
        )
        self.assertTrue(preview.validation.valid)
        self.assertTrue(
            any("keeps it quick" in warning for warning in preview.validation.warnings),
            preview.validation.warnings,
        )
        self.assertTrue(
            any("Long-form fields" in warning for warning in preview.validation.warnings),
            preview.validation.warnings,
        )

        state = self._publish(draft)
        self.assertEqual(state.source, "tenant")
        self.assertTrue(state.validation.valid)
        self.assertTrue(state.validation.warnings)

    def test_publish_is_versioned_scoped_to_the_tenant_and_visible_to_the_runtime(self):
        draft = _quick_create_draft()
        draft.sections[0].fields.reverse()
        for index, field in enumerate(draft.sections[0].fields):
            field.position = index

        first = self._publish(draft, actor_user_id=None)
        self.assertEqual(first.source, "tenant")
        self.assertEqual(first.version, 1)
        self.assertEqual(first.expected_version, 1)
        self.assertIsNotNone(first.layout_id)

        runtime = resolve_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create")
        self.assertEqual(runtime.source, "tenant")
        self.assertEqual(
            [field.field_key for field in runtime.sections[0].fields][:2],
            ["phone", "primary_email"],
        )

        second = self._publish(draft, expected_version=1)
        self.assertEqual(second.version, 2)
        self.assertEqual(
            self.db.query(RecordLayoutDefinition).filter(RecordLayoutDefinition.tenant_id == 1).count(),
            1,
        )

        # Tenant two is untouched by tenant one's publish.
        other = get_admin_record_layout(self.db, tenant_id=2, module_key="sales_leads", surface="quick_create")
        self.assertEqual(other.source, "system")
        self.assertIsNone(other.expected_version)
        self.assertEqual(
            resolve_record_layout(self.db, tenant_id=2, module_key="sales_leads", surface="quick_create").source,
            "system",
        )

    def test_publish_rejects_a_stale_expected_version(self):
        self._publish(_quick_create_draft())

        with self.assertRaises(HTTPException) as first_write:
            self._publish(_quick_create_draft(), expected_version=None)
        self.assertEqual(first_write.exception.status_code, 409)

        with self.assertRaises(HTTPException) as stale:
            self._publish(_quick_create_draft(), expected_version=99)
        self.assertEqual(stale.exception.status_code, 409)
        self.assertEqual(stale.exception.detail["current_version"], 1)

    def test_publish_rejects_blocking_errors_with_a_structured_detail(self):
        draft = _quick_create_draft()
        _field(draft, "primary_email").readonly = True

        with self.assertRaises(HTTPException) as blocked:
            self._publish(draft)

        self.assertEqual(blocked.exception.status_code, 422)
        self.assertTrue(blocked.exception.detail["errors"])
        self.assertIn("warnings", blocked.exception.detail)
        self.assertIsNone(
            self.db.query(RecordLayoutDefinition).filter(RecordLayoutDefinition.tenant_id == 1).first()
        )

    def test_publish_rejects_a_definition_that_does_not_match_the_path(self):
        draft = _quick_create_draft().model_copy(update={"surface": "detail"})

        with self.assertRaises(HTTPException) as mismatch:
            self._publish(draft)
        self.assertEqual(mismatch.exception.status_code, 422)

    def test_publish_rejects_unknown_field_keys_from_another_tenant(self):
        draft = _quick_create_draft()
        draft.sections[1].fields.append(
            RecordLayoutFieldDefinition(field_key="custom:not_owned", position=9, width="full")
        )

        with self.assertRaises(HTTPException) as blocked:
            self._publish(draft)
        self.assertEqual(blocked.exception.status_code, 422)
        self.assertTrue(
            any("Unknown layout field keys" in error for error in blocked.exception.detail["errors"]),
            blocked.exception.detail,
        )

    def test_reset_removes_the_tenant_default_and_is_idempotent(self):
        self._publish(_quick_create_draft())

        state = reset_record_layout(
            self.db,
            tenant_id=1,
            actor_user_id=None,
            module_key="sales_leads",
            surface="quick_create",
        )
        self.assertEqual(state.source, "system")
        self.assertIsNone(state.expected_version)
        self.assertEqual(
            self.db.query(RecordLayoutDefinition).filter(RecordLayoutDefinition.tenant_id == 1).count(),
            0,
        )
        self.assertEqual(
            resolve_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create").source,
            "system",
        )

        again = reset_record_layout(
            self.db,
            tenant_id=1,
            actor_user_id=None,
            module_key="sales_leads",
            surface="quick_create",
        )
        self.assertEqual(again.source, "system")

    def test_reset_only_touches_the_calling_tenant(self):
        self._publish(_quick_create_draft(), tenant_id=1)
        self._publish(_quick_create_draft(), tenant_id=2)

        reset_record_layout(
            self.db,
            tenant_id=1,
            actor_user_id=None,
            module_key="sales_leads",
            surface="quick_create",
        )

        self.assertEqual(
            get_admin_record_layout(self.db, tenant_id=2, module_key="sales_leads", surface="quick_create").source,
            "tenant",
        )

    def test_publish_and_reset_are_audited(self):
        self.db.add(User(id=5, tenant_id=1, email="admin@example.com", password_hash="x"))
        self.db.commit()

        self._publish(_quick_create_draft(), actor_user_id=5)
        reset_record_layout(
            self.db,
            tenant_id=1,
            actor_user_id=5,
            module_key="sales_leads",
            surface="quick_create",
        )

        entries = (
            self.db.query(ActivityLog)
            .filter(ActivityLog.entity_type == "record_layout")
            .order_by(ActivityLog.id.asc())
            .all()
        )
        self.assertEqual([entry.action for entry in entries], ["publish", "reset"])
        self.assertTrue(all(entry.tenant_id == 1 and entry.actor_user_id == 5 for entry in entries))
        self.assertEqual(entries[0].entity_id, "sales_leads:quick_create")
        self.assertIsNotNone(entries[1].before_state)

    def test_stored_layout_that_cannot_be_read_is_reported_and_replaceable(self):
        self.db.add(
            RecordLayoutDefinition(
                tenant_id=1,
                module_key="sales_leads",
                surface="quick_create",
                name="Broken",
                is_default=True,
                version=7,
                sections=[{"id": "bad id", "label": "Broken", "position": 0, "region": "main", "fields": []}],
            )
        )
        self.db.commit()

        state = get_admin_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create")
        self.assertEqual(state.source, "system")
        self.assertEqual(state.expected_version, 7)
        self.assertTrue(
            any("could not be read" in warning for warning in state.validation.warnings),
            state.validation.warnings,
        )

        published = self._publish(_quick_create_draft(), expected_version=7)
        self.assertEqual(published.source, "tenant")
        self.assertEqual(published.version, 8)

    def test_administration_is_bounded_to_the_proven_lead_quick_create_surface(self):
        with self.assertRaises(HTTPException) as other_module:
            validate_admin_module_and_surface("sales_contacts", "quick_create")
        self.assertEqual(other_module.exception.status_code, 404)

        for surface in ("detail", "full_form"):
            with self.assertRaises(HTTPException) as other_surface:
                validate_admin_module_and_surface("sales_leads", surface)
            self.assertEqual(other_surface.exception.status_code, 422)


class RecordLayoutAdminRouteTests(unittest.TestCase):
    def _capture_access(self):
        calls: list[tuple[str, str]] = []

        def module_dependency(module_key):
            def check(**_kwargs):
                calls.append((module_key, "module"))
            return check

        def action_dependency(module_key, action):
            def check(**_kwargs):
                calls.append((module_key, action))
            return check

        return calls, module_dependency, action_dependency

    def test_every_admin_route_requires_module_configure_access(self):
        draft = LEAD_LAYOUT_SEEDS["quick_create"]
        user = SimpleNamespace(id=3, tenant_id=7)
        cases = [
            lambda: get_record_layout_admin_state(
                "sales_leads", "quick_create", db=SimpleNamespace(), current_user=user
            ),
            lambda: preview_record_layout_draft(
                "sales_leads",
                "quick_create",
                SimpleNamespace(definition=draft),
                db=SimpleNamespace(),
                current_user=user,
            ),
            lambda: publish_tenant_record_layout(
                "sales_leads",
                "quick_create",
                SimpleNamespace(definition=draft, expected_version=None),
                db=SimpleNamespace(),
                current_user=user,
            ),
            lambda: reset_tenant_record_layout(
                "sales_leads", "quick_create", db=SimpleNamespace(), current_user=user
            ),
        ]

        for case in cases:
            calls, module_dependency, action_dependency = self._capture_access()
            with (
                patch(
                    "app.modules.platform.routes.record_layouts.require_module_access",
                    side_effect=module_dependency,
                ),
                patch(
                    "app.modules.platform.routes.record_layouts.require_action_access",
                    side_effect=action_dependency,
                ),
                patch("app.modules.platform.routes.record_layouts.get_admin_record_layout", return_value=None),
                patch("app.modules.platform.routes.record_layouts.preview_record_layout", return_value=None),
                patch("app.modules.platform.routes.record_layouts.publish_record_layout", return_value=None),
                patch("app.modules.platform.routes.record_layouts.reset_record_layout", return_value=None),
            ):
                case()
            self.assertEqual(calls, [("sales_leads", "module"), ("sales_leads", "configure")])

    def test_admin_routes_are_registered(self):
        paths = {
            (route.path, tuple(sorted(route.methods)))
            for route in admin_router.routes
            if hasattr(route, "path") and hasattr(route, "methods")
        }
        self.assertIn(("/admin/record-layouts/{module_key}/{surface}", ("GET",)), paths)
        self.assertIn(("/admin/record-layouts/{module_key}/{surface}", ("PUT",)), paths)
        self.assertIn(("/admin/record-layouts/{module_key}/{surface}", ("DELETE",)), paths)
        self.assertIn(("/admin/record-layouts/{module_key}/{surface}/preview", ("POST",)), paths)


if __name__ == "__main__":
    unittest.main()
