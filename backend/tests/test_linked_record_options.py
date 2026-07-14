import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.services.linked_record_options import list_linked_record_team_options, list_linked_record_user_options
from app.modules.platform.routes.linked_record_options import get_linked_record_tag_options, get_linked_record_team_options, get_linked_record_user_options
from app.modules.platform.services.record_tags import hydrate_record_tags, list_record_tag_options, sync_record_tags
from app.modules.sales.models import SalesLead
from app.modules.sales.routes.leads_routes import _serialize_lead_list_item
from app.modules.sales.schema import SalesLeadResponse
from app.modules.user_management.models import Team, Tenant, User, UserStatus


class LinkedRecordOptionsTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                Team(id=10, tenant_id=10, name="Revenue"),
                Team(id=99, tenant_id=99, name="Other Revenue"),
                User(id=1, tenant_id=10, email="ada@example.test", first_name="Ada", last_name="Lovelace", is_active=UserStatus.active),
                User(id=2, tenant_id=10, email="inactive@example.test", first_name="Ada", last_name="Inactive", is_active=UserStatus.inactive),
                User(id=3, tenant_id=99, email="other@example.test", first_name="Ada", last_name="Other", is_active=UserStatus.active),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_user_options_are_active_and_tenant_scoped(self):
        options = list_linked_record_user_options(self.db, tenant_id=10, query="ada")

        self.assertEqual(options, [{"id": 1, "label": "Ada Lovelace", "email": "ada@example.test"}])

    def test_team_options_are_tenant_scoped(self):
        options = list_linked_record_team_options(self.db, tenant_id=10, query="revenue")

        self.assertEqual(options, [{"id": 10, "label": "Revenue"}])

    def test_user_options_enforce_the_requested_module_action(self):
        current_user = SimpleNamespace(tenant_id=10)

        with (
            patch("app.modules.platform.routes.linked_record_options.require_module_access") as require_module,
            patch("app.modules.platform.routes.linked_record_options.require_action_access") as require_action,
        ):
            require_module.return_value = lambda **_: None
            require_action.return_value = lambda **_: None

            result = get_linked_record_user_options(
                module_key="sales_leads",
                query="ada",
                action="edit",
                limit=10,
                db=self.db,
                current_user=current_user,
            )

        require_module.assert_called_once_with("sales_leads")
        require_action.assert_called_once_with("sales_leads", "edit")
        self.assertEqual(result["results"][0].label, "Ada Lovelace")

    def test_user_options_support_view_permission_for_list_filters(self):
        current_user = SimpleNamespace(tenant_id=10)

        with (
            patch("app.modules.platform.routes.linked_record_options.require_module_access") as require_module,
            patch("app.modules.platform.routes.linked_record_options.require_action_access") as require_action,
        ):
            require_module.return_value = lambda **_: None
            require_action.return_value = lambda **_: None

            get_linked_record_user_options(
                module_key="sales_leads",
                query="ada",
                action="view",
                limit=10,
                db=self.db,
                current_user=current_user,
            )

        require_module.assert_called_once_with("sales_leads")
        require_action.assert_called_once_with("sales_leads", "view")

    def test_team_options_enforce_the_requested_module_action(self):
        current_user = SimpleNamespace(tenant_id=10)

        with (
            patch("app.modules.platform.routes.linked_record_options.require_module_access") as require_module,
            patch("app.modules.platform.routes.linked_record_options.require_action_access") as require_action,
        ):
            require_module.return_value = lambda **_: None
            require_action.return_value = lambda **_: None

            result = get_linked_record_team_options(
                module_key="sales_leads",
                query="revenue",
                action="edit",
                limit=10,
                db=self.db,
                current_user=current_user,
            )

        require_module.assert_called_once_with("sales_leads")
        require_action.assert_called_once_with("sales_leads", "edit")
        self.assertEqual(result["results"][0].label, "Revenue")

    def test_record_tags_are_tenant_scoped_and_hydrated_in_display_order(self):
        lead = SalesLead(tenant_id=10, primary_email="tagged@example.com", assigned_to=1, team_id=10)
        self.db.add(lead)
        self.db.flush()
        sync_record_tags(
            self.db,
            tenant_id=10,
            module_key="sales_leads",
            entity_id=lead.lead_id,
            tags=["Warm", "Enterprise", "warm"],
        )
        sync_record_tags(
            self.db,
            tenant_id=99,
            module_key="sales_leads",
            entity_id=lead.lead_id,
            tags=["Other Tenant"],
        )
        sync_record_tags(
            self.db,
            tenant_id=10,
            module_key="support_cases",
            entity_id="case-1",
            tags=["Sensitive Support"],
        )
        self.db.commit()

        hydrate_record_tags(
            self.db,
            tenant_id=10,
            module_key="sales_leads",
            records=[lead],
            record_id_attr="lead_id",
        )

        self.assertEqual(lead.tags, ["Enterprise", "Warm"])
        self.assertEqual(
            list_record_tag_options(self.db, tenant_id=10, module_key="sales_leads", query="warm"),
            ["Warm"],
        )
        self.assertEqual(
            list_record_tag_options(self.db, tenant_id=10, module_key="sales_leads", query=""),
            ["Enterprise", "Warm"],
        )

    def test_tag_options_enforce_the_requested_module_action(self):
        current_user = SimpleNamespace(tenant_id=10)

        with (
            patch("app.modules.platform.routes.linked_record_options.require_module_access") as require_module,
            patch("app.modules.platform.routes.linked_record_options.require_action_access") as require_action,
        ):
            require_module.return_value = lambda **_: None
            require_action.return_value = lambda **_: None

            result = get_linked_record_tag_options(
                module_key="sales_leads",
                query="",
                action="create",
                limit=10,
                db=self.db,
                current_user=current_user,
            )

        require_module.assert_called_once_with("sales_leads")
        require_action.assert_called_once_with("sales_leads", "create")
        self.assertEqual(result, {"results": []})

    def test_lead_responses_expose_the_readable_owner_name(self):
        lead = SalesLead(tenant_id=10, primary_email="lead@example.com", assigned_to=1)
        self.db.add(lead)
        self.db.commit()
        self.db.refresh(lead)

        detail = SalesLeadResponse.model_validate(lead)
        list_item = _serialize_lead_list_item(lead, {"assigned_to", "assigned_to_name"})

        self.assertEqual(detail.assigned_to_name, "Ada Lovelace")
        self.assertEqual(list_item.assigned_to_name, "Ada Lovelace")


if __name__ == "__main__":
    unittest.main()
