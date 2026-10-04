"""Account CSV import stays inside the importing tenant (13a A1, G2)."""

import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.sales.models import SalesOrganization
from app.modules.sales.services.organizations_services import import_organizations_from_csv
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus

CSV = b"org_name,primary_email\nAcme,new@acme.test\n"


class OrganizationImportTenancyTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            User(id=2, tenant_id=20, email="other@example.com", is_active=UserStatus.active),
            SalesOrganization(org_id=5, tenant_id=20, org_name="Acme", primary_email="theirs@acme.test"),
        ])
        self.db.commit()
        self.user = SimpleNamespace(id=1, tenant_id=10)

    def tearDown(self):
        self.db.close()

    def test_another_tenants_account_is_not_a_duplicate(self):
        # Before the fix this raised 409 and named the other tenant's account.
        result = import_organizations_from_csv(self.db, CSV, self.user)

        self.assertEqual(result["new_rows"], 1)
        mine = self.db.query(SalesOrganization).filter(SalesOrganization.tenant_id == 10).one()
        self.assertEqual(mine.primary_email, "new@acme.test")

    def test_skip_mode_still_creates_when_only_another_tenant_has_the_name(self):
        result = import_organizations_from_csv(self.db, CSV, self.user, skip_duplicates=True)

        self.assertEqual(result["new_rows"], 1)
        theirs = self.db.get(SalesOrganization, 5)
        self.assertEqual(theirs.primary_email, "theirs@acme.test")


if __name__ == "__main__":
    unittest.main()
