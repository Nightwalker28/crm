import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.modules.client_portal import models as client_portal_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesContact, SalesLead, SalesOpportunity, SalesOrder, SalesOrganization, SalesQuote
from app.modules.user_management import models as user_management_models  # noqa: F401


class SalesModelLoaderTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

    def tearDown(self):
        self.db.close()

    def _compiled_base_query(self, model) -> str:
        return str(self.db.query(model).statement.compile(compile_kwargs={"literal_binds": True})).upper()

    def test_base_sales_model_queries_do_not_join_relationship_tables(self):
        for model in [SalesContact, SalesLead, SalesOpportunity, SalesQuote, SalesOrder]:
            with self.subTest(model=model.__name__):
                self.assertNotIn(" JOIN ", self._compiled_base_query(model))


class SalesOrganizationTimestampTests(unittest.TestCase):
    def test_sales_organization_updated_at_is_persisted_and_non_nullable(self):
        column = SalesOrganization.__table__.c.updated_at

        self.assertTrue(column.type.timezone)
        self.assertFalse(column.nullable)
        self.assertIsNotNone(column.server_default)
        self.assertIsNotNone(column.onupdate)


class SalesContactAssigneeModelTests(unittest.TestCase):
    def test_sales_contact_assignee_allows_user_delete_set_null(self):
        column = SalesContact.__table__.c.assigned_to
        foreign_key = next(iter(column.foreign_keys))

        self.assertTrue(column.nullable)
        self.assertEqual(foreign_key.ondelete, "SET NULL")


class SalesTimestampContractTests(unittest.TestCase):
    def test_primary_sales_created_timestamps_are_aware_server_defaults(self):
        for model, column_name in [
            (SalesOrganization, "created_time"),
            (SalesContact, "created_time"),
            (SalesLead, "created_time"),
            (SalesOpportunity, "created_time"),
            (SalesQuote, "created_time"),
            (SalesOrder, "created_at"),
        ]:
            with self.subTest(model=model.__name__, column=column_name):
                column = model.__table__.c[column_name]
                self.assertTrue(column.type.timezone)
                self.assertFalse(column.nullable)
                self.assertIsNotNone(column.server_default)

    def test_sales_soft_delete_timestamps_are_aware_and_nullable(self):
        for model in [SalesOrganization, SalesContact, SalesLead, SalesOpportunity, SalesQuote]:
            with self.subTest(model=model.__name__):
                column = model.__table__.c.deleted_at
                self.assertTrue(column.type.timezone)
                self.assertTrue(column.nullable)


if __name__ == "__main__":
    unittest.main()
