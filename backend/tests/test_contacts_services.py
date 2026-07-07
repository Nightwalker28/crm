import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.pagination import create_pagination
from app.modules.client_portal import models as client_portal_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesContact
from app.modules.sales.schema import SalesContactResponse
from app.modules.sales.services import contacts_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus


class FakeQuery:
    def __init__(self, db, entity):
        self.db = db
        self.entity = entity

    def filter(self, *conditions):
        self.db.filters.append(conditions)
        return self

    def first(self):
        if self.entity is User.id:
            return (1,)
        return None

    def distinct(self):
        return self

    def all(self):
        return []

    def __iter__(self):
        return iter([])


class FakeDB:
    def __init__(self):
        self.filters = []
        self.added = []
        self.bulk_inserts = []
        self.committed = False

    def query(self, *entities):
        entity = entities[0] if len(entities) == 1 else entities
        return FakeQuery(self, entity)

    def add(self, value):
        if isinstance(value, SalesContact) and value.contact_id is None:
            value.contact_id = 99
        self.added.append(value)

    def flush(self):
        return None

    def commit(self):
        self.committed = True

    def refresh(self, _value):
        return None

    def bulk_insert_mappings(self, model, mappings):
        self.bulk_inserts.append((model, mappings))


class IntegrityErrorDB(FakeDB):
    def __init__(self):
        super().__init__()
        self.rolled_back = False

    def commit(self):
        self.committed = True

    def flush(self):
        raise IntegrityError("update sales_contacts", {}, Exception("duplicate email"))

    def rollback(self):
        self.rolled_back = True


class CreateSalesContactDuplicateFilterTests(unittest.TestCase):
    def _create_contact_and_capture_duplicate_filter_count(self, payload):
        db = FakeDB()
        current_user = SimpleNamespace(id=7, tenant_id=1)
        predicate_counts = []

        def fake_or_(*predicates):
            predicate_counts.append(len(predicates))
            return ("or", predicates)

        with patch.object(contacts_services, "or_", side_effect=fake_or_), \
             patch.object(contacts_services, "validate_custom_field_payload", return_value={}), \
             patch.object(contacts_services, "save_custom_field_values"), \
             patch.object(contacts_services, "hydrate_custom_field_record", side_effect=lambda *args, **kwargs: kwargs["record"]):
            contacts_services.create_sales_contact(db, payload, current_user)

        return predicate_counts[-1]

    def test_create_sales_contact_duplicate_filter_uses_email_only_without_any_name(self):
        predicate_count = self._create_contact_and_capture_duplicate_filter_count(
            {
                "first_name": "",
                "last_name": "",
                "primary_email": "ada@example.com",
            }
        )

        self.assertEqual(predicate_count, 1)

    def test_create_sales_contact_duplicate_filter_adds_name_when_partial_name_exists(self):
        predicate_count = self._create_contact_and_capture_duplicate_filter_count(
            {
                "first_name": "Ada",
                "last_name": "",
                "primary_email": "ada@example.com",
            }
        )

        self.assertEqual(predicate_count, 2)

    def test_create_sales_contact_duplicate_filter_adds_name_when_full_name_exists(self):
        predicate_count = self._create_contact_and_capture_duplicate_filter_count(
            {
                "first_name": "Ada",
                "last_name": "Lovelace",
                "primary_email": "ada@example.com",
            }
        )

        self.assertEqual(predicate_count, 2)


class SalesContactSchemaTests(unittest.TestCase):
    def test_contact_response_allows_null_assignee_after_user_delete(self):
        contact = SimpleNamespace(
            contact_id=42,
            first_name="Ada",
            last_name="Lovelace",
            contact_telephone=None,
            linkedin_url=None,
            current_title=None,
            region=None,
            country=None,
            email_opt_out=False,
            organization_id=None,
            custom_fields=None,
            primary_email="ada@example.com",
            assigned_to=None,
            customer_group_id=None,
            customer_group=None,
            created_time=datetime(2026, 7, 7, 10, 30),
            last_contacted_at=None,
            last_contacted_channel=None,
            last_contacted_by_user_id=None,
            whatsapp_last_contacted_at=None,
            organization_name=None,
        )

        response = SalesContactResponse.model_validate(contact)

        self.assertIsNone(response.assigned_to)


class CreateSalesContactTransactionTests(unittest.TestCase):
    def test_create_sales_contact_flushes_custom_fields_before_single_commit(self):
        db = FakeDB()
        db.events = []
        db.commits = 0
        current_user = SimpleNamespace(id=7, tenant_id=1)
        payload = {
            "first_name": "Ada",
            "last_name": "Lovelace",
            "primary_email": "ada@example.com",
            "custom_fields": {"tier": "enterprise"},
        }
        saved_calls = []

        def add_with_event(value):
            db.events.append("add")
            if isinstance(value, SalesContact) and value.contact_id is None:
                value.contact_id = 99
            db.added.append(value)

        def flush_with_event():
            db.events.append("flush")

        def commit_with_event():
            db.events.append("commit")
            db.commits += 1
            db.committed = True

        def refresh_with_event(_value):
            db.events.append("refresh")

        def fake_save_custom_field_values(*args, **kwargs):
            db.events.append("save_custom_fields")
            saved_calls.append(kwargs)

        db.add = add_with_event
        db.flush = flush_with_event
        db.commit = commit_with_event
        db.refresh = refresh_with_event

        with patch.object(contacts_services, "validate_custom_field_payload", return_value={"tier": "enterprise"}), \
             patch.object(contacts_services, "save_custom_field_values", side_effect=fake_save_custom_field_values), \
             patch.object(contacts_services, "hydrate_custom_field_record", side_effect=lambda *args, **kwargs: kwargs["record"]):
            contact = contacts_services.create_sales_contact(db, payload, current_user)

        self.assertEqual(contact.contact_id, 99)
        self.assertEqual(db.events, ["add", "flush", "save_custom_fields", "commit", "refresh"])
        self.assertEqual(db.commits, 1)
        self.assertEqual(saved_calls[0]["tenant_id"], 1)
        self.assertEqual(saved_calls[0]["record_id"], 99)
        self.assertEqual(saved_calls[0]["values"], {"tier": "enterprise"})


class ImportContactsBulkInsertTests(unittest.TestCase):
    def test_import_contacts_bulk_inserts_new_rows_with_tenant_scope(self):
        db = FakeDB()
        csv_bytes = (
            b"primary_email,first_name,last_name,assigned_to\n"
            b"ada@example.com,Ada,Lovelace,7\n"
            b"grace@example.com,Grace,Hopper,7\n"
        )

        summary = contacts_services.import_contacts_from_csv(
            db,
            csv_bytes,
            tenant_id=3,
            default_assigned_to=7,
        )

        self.assertEqual(summary["new_rows"], 2)
        self.assertEqual(len(db.bulk_inserts), 1)
        model, mappings = db.bulk_inserts[0]
        self.assertIs(model, SalesContact)
        self.assertEqual([row["tenant_id"] for row in mappings], [3, 3])
        self.assertFalse(any(isinstance(item, SalesContact) for item in db.added))
        self.assertTrue(db.committed)


class UpdateSalesContactIntegrityTests(unittest.TestCase):
    def test_update_sales_contact_rejects_null_assignee(self):
        contact = SimpleNamespace(
            tenant_id=1,
            contact_id=44,
            assigned_to=7,
        )

        with self.assertRaises(HTTPException) as exc:
            contacts_services.update_sales_contact(FakeDB(), contact, {"assigned_to": None})

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "assigned_to cannot be null")

    def test_update_sales_contact_returns_duplicate_error_on_unique_race(self):
        db = IntegrityErrorDB()
        contact = SalesContact(
            contact_id=12,
            tenant_id=3,
            primary_email="old@example.com",
            assigned_to=7,
        )

        with self.assertRaises(HTTPException) as exc:
            contacts_services.update_sales_contact(
                db,
                contact,
                {"primary_email": "new@example.com"},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Another contact already uses this email")
        self.assertTrue(db.rolled_back)


class ExportContactsTests(unittest.TestCase):
    def test_export_contacts_materializes_rows_before_csv_writer_iterates(self):
        contacts = [
            SimpleNamespace(
                contact_id=12,
                first_name="Ada",
                last_name="Lovelace",
                contact_telephone=None,
                linkedin_url=None,
                primary_email="ada@example.com",
                current_title=None,
                region=None,
                country=None,
                email_opt_out=False,
                assigned_to=7,
                organization_id=None,
                created_time=datetime(2026, 1, 2, 3, 4, 5),
            )
        ]
        captured_rows = []

        def fake_csv_writer(*, headers, rows):
            captured_rows.append(rows)
            return b"csv"

        with patch.object(contacts_services, "dict_rows_to_csv_bytes", side_effect=fake_csv_writer):
            content = contacts_services.export_contacts_to_csv(iter(contacts))

        self.assertEqual(content, b"csv")
        self.assertIsInstance(captured_rows[0], list)
        self.assertEqual(captured_rows[0][0]["contact_id"], 12)
        self.assertEqual(captured_rows[0][0]["created_time"], "2026-01-02T03:04:05")


class ListSalesContactsTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                User(
                    id=1,
                    tenant_id=10,
                    email="owner@example.com",
                    first_name="Owner",
                    last_name="User",
                    is_active=UserStatus.active,
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_contact_list_sorts_before_pagination(self):
        self.db.add_all(
            [
                SalesContact(
                    contact_id=103,
                    tenant_id=10,
                    first_name="Zoe",
                    primary_email="zoe@example.com",
                    assigned_to=1,
                ),
                SalesContact(
                    contact_id=104,
                    tenant_id=10,
                    first_name="Ada",
                    primary_email="ada@example.com",
                    assigned_to=1,
                ),
                SalesContact(
                    contact_id=105,
                    tenant_id=10,
                    first_name="Mia",
                    primary_email="mia@example.com",
                    assigned_to=1,
                ),
            ]
        )
        self.db.commit()

        contacts, total_count = contacts_services.list_sales_contacts(
            self.db,
            tenant_id=10,
            pagination=create_pagination(1, 2),
            sort_by="first_name",
            sort_direction="asc",
        )

        self.assertEqual(total_count, 3)
        self.assertEqual([contact.first_name for contact in contacts], ["Ada", "Mia"])

    def test_create_sales_contact_detects_first_name_only_duplicate(self):
        self.db.add(
            SalesContact(
                contact_id=201,
                tenant_id=10,
                first_name="Ada",
                last_name=None,
                primary_email="existing@example.com",
                assigned_to=1,
            )
        )
        self.db.commit()

        with patch.object(contacts_services, "validate_custom_field_payload", return_value={}):
            with self.assertRaises(HTTPException) as exc:
                contacts_services.create_sales_contact(
                    self.db,
                    {
                        "first_name": " Ada ",
                        "primary_email": "new@example.com",
                    },
                    SimpleNamespace(id=1, tenant_id=10),
                )

        self.assertEqual(exc.exception.status_code, 409)
        self.assertIn("already exists", exc.exception.detail)


if __name__ == "__main__":
    unittest.main()
