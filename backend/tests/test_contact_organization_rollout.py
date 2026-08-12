"""Domain guarantees behind rolling Quick Create and the workspace to Contact and Organization.

Two things have to hold for the contextual surfaces to be safe:

1. Every module the new surfaces render resolves a layout, and no layout — seeded, stored, or
   field-config-filtered — can drop a field the create endpoint still requires.
2. A prefilled relationship is a hint. The linked id must belong to the caller's tenant and
   the caller must be allowed to view the linked module, whatever the surface sent.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.permissions import require_linked_record_access
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import (
    CustomFieldDefinition,
    CustomFieldValue,
    ModuleFieldConfig,
    RecordLayoutDefinition,
)
from app.modules.platform.services.record_layouts import (
    MODULE_LAYOUT_SEEDS,
    MODULE_SYSTEM_FIELDS,
    resolve_record_layout,
)
from app.modules.sales.routes.contacts_routes import _require_account_link_access
from app.modules.sales.routes.opportunities_routes import _require_relationship_link_access
from app.modules.sales.services.contacts_services import create_sales_contact
from app.modules.sales.services.opportunities_services import create_opportunity
from app.modules.sales.models import SalesContact, SalesOpportunity, SalesOrganization
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


ROLLED_OUT_SURFACES = {
    "sales_contacts": ("quick_create", "detail"),
    "sales_organizations": ("quick_create", "detail"),
    "sales_opportunities": ("quick_create",),
}


def resolved_fields(layout):
    return {field.field_key: field for section in layout.sections for field in section.fields}


class ContactOrganizationLayoutTests(unittest.TestCase):
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

    def resolve(self, module_key, surface, *, tenant_id=1, custom_fields=()):
        with patch(
            "app.modules.platform.services.record_layouts.list_custom_field_definitions",
            return_value=list(custom_fields),
        ):
            return resolve_record_layout(
                self.db,
                tenant_id=tenant_id,
                module_key=module_key,
                surface=surface,
            )

    def test_every_rolled_out_surface_resolves_from_a_seed(self):
        for module_key, surfaces in ROLLED_OUT_SURFACES.items():
            for surface in surfaces:
                with self.subTest(module_key=module_key, surface=surface):
                    layout = self.resolve(module_key, surface)
                    self.assertEqual(layout.source, "system")
                    self.assertEqual(layout.module_key, module_key)
                    self.assertTrue(layout.sections, "a seeded surface must render something")
                    self.assertEqual(
                        [section.position for section in layout.sections],
                        sorted(section.position for section in layout.sections),
                    )

    def test_seeds_only_reference_fields_the_module_actually_has(self):
        for module_key, surfaces in MODULE_LAYOUT_SEEDS.items():
            catalog = MODULE_SYSTEM_FIELDS[module_key]
            for surface, definition in surfaces.items():
                keys = {field.field_key for section in definition.sections for field in section.fields}
                with self.subTest(module_key=module_key, surface=surface):
                    self.assertEqual(keys - set(catalog), set())

    def test_quick_create_seeds_expose_every_domain_required_field(self):
        for module_key in ROLLED_OUT_SURFACES:
            with self.subTest(module_key=module_key):
                fields = resolved_fields(self.resolve(module_key, "quick_create"))
                required_keys = {
                    key for key, field in MODULE_SYSTEM_FIELDS[module_key].items() if field.required
                }
                self.assertTrue(required_keys, "each rolled-out module has at least one required field")
                for key in required_keys:
                    self.assertIn(key, fields)
                    self.assertTrue(fields[key].visible)
                    self.assertFalse(fields[key].readonly)
                    self.assertTrue(fields[key].required)

    def test_contact_quick_create_carries_the_account_and_owner_links(self):
        fields = resolved_fields(self.resolve("sales_contacts", "quick_create"))
        self.assertIn("organization_id", fields)
        self.assertIn("assigned_to", fields)
        self.assertEqual(fields["organization_id"].field_type, "organization_reference")
        # Quick Create stays quick: the guidance ceiling is 8 visible fields.
        self.assertLessEqual(len([field for field in fields.values() if field.visible]), 8)

    def test_opportunity_quick_create_requires_a_contact_and_stays_create_only(self):
        fields = resolved_fields(self.resolve("sales_opportunities", "quick_create"))
        self.assertTrue(fields["contact_id"].required)
        self.assertIn("organization_id", fields)

        # The Opportunity workspace, and so its detail layout, is a later slice.
        with self.assertRaises(HTTPException) as detail:
            self.resolve("sales_opportunities", "detail")
        self.assertEqual(detail.exception.status_code, 422)

    def test_disabled_field_config_hides_optional_fields_but_never_required_ones(self):
        self.db.add_all(
            [
                ModuleFieldConfig(
                    id=1,
                    tenant_id=1,
                    module_key="sales_organizations",
                    field_key="website",
                    label="Website",
                    is_enabled=False,
                    is_protected=False,
                ),
                ModuleFieldConfig(
                    id=2,
                    tenant_id=1,
                    module_key="sales_organizations",
                    field_key="primary_email",
                    label="Primary email",
                    is_enabled=False,
                    is_protected=False,
                ),
            ]
        )
        self.db.commit()

        fields = resolved_fields(self.resolve("sales_organizations", "quick_create"))
        self.assertNotIn("website", fields)
        self.assertIn("primary_email", fields)
        self.assertTrue(fields["primary_email"].visible)

    def test_detail_surfaces_are_read_only_and_absorb_custom_fields(self):
        custom = SimpleNamespace(
            field_key="account_tier",
            label="Account tier",
            field_type="text",
            is_required=False,
            placeholder=None,
            help_text=None,
        )
        for module_key in ("sales_contacts", "sales_organizations"):
            with self.subTest(module_key=module_key):
                fields = resolved_fields(self.resolve(module_key, "detail", custom_fields=[custom]))
                self.assertTrue(all(field.readonly for field in fields.values()))
                self.assertIn("custom:account_tier", fields)

    def test_stored_layout_is_tenant_scoped(self):
        stored = MODULE_LAYOUT_SEEDS["sales_contacts"]["detail"].model_dump(mode="json")
        self.db.add(
            RecordLayoutDefinition(
                tenant_id=1,
                module_key="sales_contacts",
                surface="detail",
                name="Tenant One Contact Details",
                is_default=True,
                version=3,
                sections=stored["sections"],
            )
        )
        self.db.commit()

        self.assertEqual(self.resolve("sales_contacts", "detail").source, "tenant")
        self.assertEqual(self.resolve("sales_contacts", "detail", tenant_id=2).source, "system")

    def test_stored_quick_create_that_drops_a_required_field_falls_back_to_the_seed(self):
        broken = MODULE_LAYOUT_SEEDS["sales_organizations"]["quick_create"].model_dump(mode="json")
        broken["sections"][0]["fields"] = [
            field for field in broken["sections"][0]["fields"] if field["field_key"] != "org_name"
        ]
        self.db.add(
            RecordLayoutDefinition(
                tenant_id=1,
                module_key="sales_organizations",
                surface="quick_create",
                name="Tenant One Account Quick Create",
                is_default=True,
                version=2,
                sections=broken["sections"],
            )
        )
        self.db.commit()

        layout = self.resolve("sales_organizations", "quick_create")
        self.assertEqual(layout.source, "system")
        self.assertIn("org_name", resolved_fields(layout))


class DeniedPolicy:
    """Stands in for the real policy: every module the test names is refused."""

    def __init__(self, denied_modules):
        self.denied_modules = denied_modules
        self.checked: list[tuple[str, str]] = []

    def __call__(self, db, user):
        return self

    def require_module(self, module_key):
        self.checked.append((module_key, "module"))
        if module_key in self.denied_modules:
            raise PermissionError("module not available")

    def require_action(self, module_key, action):
        self.checked.append((module_key, action))
        if module_key in self.denied_modules:
            raise PermissionError("action not permitted")


class LinkedRecordPermissionTests(unittest.TestCase):
    """UI hiding is not authorization: a prefilled id must still clear the linked module."""

    def link_access(self, module_key, *, denied):
        policy = DeniedPolicy(denied)
        with patch("app.core.permissions.PermissionPolicy", policy):
            require_linked_record_access(SimpleNamespace(), user=SimpleNamespace(), module_key=module_key)
        return policy

    def test_link_access_requires_module_availability_and_view_permission(self):
        policy = self.link_access("sales_organizations", denied=set())
        self.assertEqual(policy.checked, [("sales_organizations", "module"), ("sales_organizations", "view")])

    def test_link_access_is_refused_without_view_permission(self):
        with self.assertRaises(HTTPException) as denied:
            self.link_access("sales_organizations", denied={"sales_organizations"})
        self.assertEqual(denied.exception.status_code, 403)

    def test_contact_write_checks_the_account_link(self):
        calls: list[str] = []
        with patch(
            "app.modules.sales.routes.contacts_routes.require_linked_record_access",
            side_effect=lambda db, *, user, module_key: calls.append(module_key),
        ):
            _require_account_link_access(SimpleNamespace(), current_user=SimpleNamespace(), payload_data={})
            self.assertEqual(calls, [])

            _require_account_link_access(
                SimpleNamespace(),
                current_user=SimpleNamespace(),
                payload_data={"organization_id": 7},
            )
        self.assertEqual(calls, ["sales_organizations"])

    def test_opportunity_write_checks_both_relationship_links(self):
        calls: list[str] = []
        with patch(
            "app.modules.sales.routes.opportunities_routes.require_linked_record_access",
            side_effect=lambda db, *, user, module_key: calls.append(module_key),
        ):
            _require_relationship_link_access(
                SimpleNamespace(),
                current_user=SimpleNamespace(),
                payload_data={"contact_id": 3, "organization_id": 9},
            )
        self.assertEqual(calls, ["sales_contacts", "sales_organizations"])

    def test_opportunity_write_without_links_checks_nothing(self):
        calls: list[str] = []
        with patch(
            "app.modules.sales.routes.opportunities_routes.require_linked_record_access",
            side_effect=lambda db, *, user, module_key: calls.append(module_key),
        ):
            _require_relationship_link_access(
                SimpleNamespace(),
                current_user=SimpleNamespace(),
                payload_data={"contact_id": None, "organization_id": None},
            )
        self.assertEqual(calls, [])


class ContextualLinkTenantIsolationTests(unittest.TestCase):
    """A contextual default from another tenant must not become a link."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            engine,
            tables=[
                Tenant.__table__,
                User.__table__,
                CustomFieldDefinition.__table__,
                CustomFieldValue.__table__,
                SalesContact.__table__,
                SalesOrganization.__table__,
                SalesOpportunity.__table__,
            ],
        )
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=10, slug="ours", name="Ours"),
                Tenant(id=99, slug="theirs", name="Theirs"),
                User(
                    id=1,
                    tenant_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
                SalesOrganization(org_id=500, tenant_id=99, org_name="Foreign Account", primary_email="a@foreign.test"),
                SalesContact(contact_id=600, tenant_id=99, primary_email="person@foreign.test", assigned_to=1),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=10)

    def tearDown(self):
        self.db.close()

    def test_contact_create_rejects_a_cross_tenant_account(self):
        with self.assertRaises(HTTPException) as rejected:
            create_sales_contact(
                self.db,
                payload={
                    "primary_email": "new@example.com",
                    "organization_id": 500,
                    "custom_fields": {},
                },
                current_user=self.current_user,
            )
        self.assertEqual(rejected.exception.status_code, 400)
        self.assertEqual(rejected.exception.detail, "Organization not found")

    def test_opportunity_create_rejects_a_cross_tenant_contact(self):
        with self.assertRaises(HTTPException) as rejected:
            create_opportunity(
                self.db,
                {
                    "opportunity_name": "Foreign deal",
                    "contact_id": 600,
                    "custom_fields": {},
                },
                current_user=self.current_user,
            )
        self.assertEqual(rejected.exception.status_code, 400)
        self.assertEqual(rejected.exception.detail, "Contact not found")


if __name__ == "__main__":
    unittest.main()
