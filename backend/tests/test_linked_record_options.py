import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.services.linked_record_options import list_linked_record_user_options
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


if __name__ == "__main__":
    unittest.main()
