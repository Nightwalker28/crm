import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import Pagination
from app.modules.platform.models import ActivityLog
from app.modules.platform.services.activity_logs import list_activity_logs, log_activity
from app.modules.user_management import models as user_management_models  # noqa: F401


class ActivityLogTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_entity_id_is_normalized_at_model_and_service_boundary(self):
        entry = log_activity(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            module_key="sales_contacts",
            entity_type="sales_contact",
            entity_id=7,
            action="updated",
        )

        direct = ActivityLog(
            tenant_id=10,
            actor_user_id=None,
            module_key="sales_contacts",
            entity_type="sales_contact",
            entity_id=8,
            action="created",
        )
        self.db.add(direct)
        self.db.commit()

        items, total = list_activity_logs(
            self.db,
            tenant_id=10,
            pagination=Pagination(page=1, page_size=10, offset=0, limit=10),
            entity_id=7,
        )

        self.assertEqual(entry.entity_id, "7")
        self.assertEqual(direct.entity_id, "8")
        self.assertEqual(total, 1)
        self.assertEqual(items[0].entity_id, "7")


if __name__ == "__main__":
    unittest.main()
