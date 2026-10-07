"""Role and team layout overrides (13b Phase 4 slice 4c, F3.5)."""

import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import RecordLayoutDefinition
from app.modules.platform.services.record_layouts import (
    BASE_SCOPE,
    LEAD_LAYOUT_SEEDS,
    LayoutScope,
    get_admin_record_layout,
    list_layout_overrides,
    publish_record_layout,
    reset_record_layout,
    resolve_record_layout,
    validate_layout_scope,
)
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Role, Team, Tenant


NO_CUSTOM_FIELDS = patch("app.modules.platform.services.record_layouts.list_custom_field_definitions", return_value=[])


class LayoutOverrideTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=1, slug="one", name="One"),
                Tenant(id=2, slug="two", name="Two"),
                Role(id=10, tenant_id=1, name="Sales rep", level=1),
                Role(id=20, tenant_id=2, name="Other tenant role", level=1),
                Team(id=30, tenant_id=1, name="Inside sales"),
            ]
        )
        self.db.commit()
        NO_CUSTOM_FIELDS.start()
        self.addCleanup(NO_CUSTOM_FIELDS.stop)

    def tearDown(self):
        self.db.close()

    def _layout(self, name: str, *, role_id=None, team_id=None, version=1, drop_last_section=False):
        sections = LEAD_LAYOUT_SEEDS["detail"].model_dump(mode="json")["sections"]
        if drop_last_section and len(sections) > 1:
            sections = sections[:-1]
        self.db.add(
            RecordLayoutDefinition(
                tenant_id=1,
                module_key="sales_leads",
                surface="detail",
                name=name,
                is_default=role_id is None and team_id is None,
                role_id=role_id,
                team_id=team_id,
                version=version,
                sections=sections,
            )
        )
        self.db.commit()

    def _resolve(self, *, role_id=None, team_id=None, tenant_id=1):
        return resolve_record_layout(
            self.db, tenant_id=tenant_id, module_key="sales_leads", surface="detail", role_id=role_id, team_id=team_id
        )

    def test_team_before_role_before_tenant_default(self):
        self._layout("Tenant default", version=2)
        self._layout("Rep layout", role_id=10, version=3)
        self._layout("Inside sales layout", team_id=30, version=4)
        self.assertEqual(self._resolve().name, "Tenant default")
        self.assertEqual(self._resolve(role_id=10).name, "Rep layout")
        self.assertEqual(self._resolve(role_id=10, team_id=30).name, "Inside sales layout")
        self.assertEqual(self._resolve(team_id=30).name, "Inside sales layout")

    def test_removing_an_override_falls_back_cleanly(self):
        self._layout("Tenant default", version=2)
        self._layout("Rep layout", role_id=10)
        self.assertEqual(self._resolve(role_id=10).name, "Rep layout")
        self.db.query(RecordLayoutDefinition).filter_by(role_id=10).delete()
        self.db.commit()
        self.assertEqual(self._resolve(role_id=10).name, "Tenant default")
        self.assertEqual(self._resolve(role_id=10, team_id=30).name, "Tenant default")

    def test_scope_must_belong_to_the_tenant_and_be_one_audience(self):
        with self.assertRaises(HTTPException) as other_tenant:
            validate_layout_scope(self.db, tenant_id=1, role_id=20, team_id=None)
        self.assertEqual(other_tenant.exception.status_code, 404)
        with self.assertRaises(HTTPException) as both:
            validate_layout_scope(self.db, tenant_id=1, role_id=10, team_id=30)
        self.assertEqual(both.exception.status_code, 422)
        self.assertEqual(validate_layout_scope(self.db, tenant_id=1, role_id=None, team_id=None), BASE_SCOPE)

    def test_new_override_starts_from_the_tenant_default_and_publishes_on_its_own(self):
        state = get_admin_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create")
        published = publish_record_layout(
            self.db,
            tenant_id=1,
            actor_user_id=None,
            module_key="sales_leads",
            surface="quick_create",
            definition=state.definition.model_copy(update={"name": "Workspace quick create"}),
            expected_version=None,
        )
        self.assertEqual(published.source, "tenant")

        scope = LayoutScope(team_id=30)
        fresh = get_admin_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create", scope=scope)
        self.assertEqual(fresh.inherits_from, "tenant")
        self.assertEqual(fresh.definition.name, "Workspace quick create")
        self.assertIsNone(fresh.expected_version)
        self.assertEqual(fresh.team_id, 30)

        override = publish_record_layout(
            self.db,
            tenant_id=1,
            actor_user_id=None,
            module_key="sales_leads",
            surface="quick_create",
            definition=fresh.definition.model_copy(update={"name": "Inside sales quick create"}),
            expected_version=None,
            scope=scope,
        )
        self.assertEqual(override.version, 1)
        # The tenant default is untouched and still the only default.
        default = get_admin_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create")
        self.assertEqual(default.definition.name, "Workspace quick create")
        overrides = list_layout_overrides(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create")
        self.assertEqual([(row["team_name"], row["version"]) for row in overrides], [("Inside sales", 1)])

        reset_record_layout(self.db, tenant_id=1, actor_user_id=None, module_key="sales_leads", surface="quick_create", scope=scope)
        self.assertEqual(list_layout_overrides(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create"), [])
        resolved = resolve_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create", team_id=30)
        self.assertEqual(resolved.name, "Workspace quick create")

    def test_overrides_do_not_leak_across_tenants(self):
        self._layout("Rep layout", role_id=10)
        self.assertEqual(self._resolve(role_id=10, tenant_id=2).source, "system")


if __name__ == "__main__":
    unittest.main()
