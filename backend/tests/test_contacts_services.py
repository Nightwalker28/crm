import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.modules.sales.models import SalesContact
from app.modules.sales.services import contacts_services
from app.modules.user_management.models import User


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

    def test_create_sales_contact_duplicate_filter_uses_email_only_without_full_name(self):
        predicate_count = self._create_contact_and_capture_duplicate_filter_count(
            {
                "first_name": "Ada",
                "last_name": "",
                "primary_email": "ada@example.com",
            }
        )

        self.assertEqual(predicate_count, 1)

    def test_create_sales_contact_duplicate_filter_adds_name_when_full_name_exists(self):
        predicate_count = self._create_contact_and_capture_duplicate_filter_count(
            {
                "first_name": "Ada",
                "last_name": "Lovelace",
                "primary_email": "ada@example.com",
            }
        )

        self.assertEqual(predicate_count, 2)


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


if __name__ == "__main__":
    unittest.main()
