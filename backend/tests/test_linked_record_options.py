import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.services.linked_record_options import list_linked_record_user_options
from app.modules.platform.routes.linked_record_options import get_linked_record_user_options
from app.modules.sales.models import SalesLead
from app.modules.sales.routes.leads_routes import _serialize_lead_list_item
from app.modules.sales.schema import SalesLeadResponse
from app.modules.user_management.models import Tenant, User, UserStatus


class LinkedRecordOptionsTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
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
