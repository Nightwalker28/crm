import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.finance.models import FinanceIO
from app.modules.finance.routes import io_search_routes
from app.modules.finance.schema import InsertionOrderCreateRequest, InsertionOrderUpdateRequest
from app.modules.finance.services import io_search_api
from app.modules.finance.repositories import io_repository
from app.modules.finance.services import io_search_services
from app.modules.user_management.models import Tenant, User, UserStatus


class FakeFinanceQuery:
    def __init__(self, record=None, duplicate_campaigns=None):
        self.record = record
        self.duplicate_campaigns = duplicate_campaigns or []
        self.filters = []

    def filter(self, *args, **kwargs):
        self.filters.extend(args)
        return self

    def distinct(self):
        return self

    def first(self):
        return self.record

    def __iter__(self):
        for campaign_name in self.duplicate_campaigns:
            yield SimpleNamespace(campaign_name=campaign_name)


class FakeFinanceDB:
    def __init__(self, record=None, duplicate_campaigns=None):
        self.record = record
        self.duplicate_campaigns = duplicate_campaigns or []
        self.last_query = None

    def query(self, *_args, **_kwargs):
        self.last_query = FakeFinanceQuery(self.record, self.duplicate_campaigns)
        return self.last_query


class FakeInsertionOrderQuery:
    def __init__(self):
        self.operations = []

    def count(self):
        self.operations.append("count")
        return 3

    def order_by(self, *args):
        self.operations.append("order_by_reset" if len(args) == 1 and args[0] is None else "order_by")
        return self

    def offset(self, value):
        self.operations.append(f"offset:{value}")
        return self

    def limit(self, value):
        self.operations.append(f"limit:{value}")
        return self

    def all(self):
        self.operations.append("all")
        return [SimpleNamespace(id=2, io_number="IO-002")]


class ModuleLookupDB:
    def __init__(self, module_id):
        self.module_id = module_id

    def query(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def scalar(self):
        return self.module_id


class FinanceModuleLookupTests(unittest.TestCase):
    def test_finance_module_lookup_returns_registered_id(self):
        self.assertEqual(io_search_services.get_finance_module_id(ModuleLookupDB(41)), 41)

    def test_finance_module_lookup_fails_without_registration(self):
        with self.assertRaisesRegex(LookupError, "finance_io"):
            io_search_services.get_finance_module_id(ModuleLookupDB(None))


class FinanceDownloadTests(unittest.TestCase):
    def test_get_generic_insertion_order_scopes_lookup_by_tenant(self):
        db = FakeFinanceDB()
        current_user = SimpleNamespace(id=7, tenant_id=42)
        record = SimpleNamespace(id=9)

        with patch.object(io_search_api, "get_finance_module_id", return_value=3), \
             patch.object(
                 io_search_api,
                 "get_finance_user_scope",
                 return_value=SimpleNamespace(user_id_filter=7),
             ), \
             patch.object(io_search_api, "get_insertion_order_or_404", return_value=record) as lookup_mock, \
             patch.object(io_search_api, "_serialize_finance_record_response", return_value={"id": 9}):
            result = io_search_api.get_generic_insertion_order(
                db,
                current_user,
                io_id=9,
                request=None,
            )

        self.assertEqual(result, {"id": 9})
        lookup_mock.assert_called_once_with(
            db,
            tenant_id=42,
            module_id=3,
            io_id=9,
            user_id=7,
        )

    def test_get_downloadable_insertion_order_blocks_path_escape(self):
        record = SimpleNamespace(
            file_path="../outside.docx",
            file_name="outside.docx",
        )
        db = FakeFinanceDB(record)
        current_user = SimpleNamespace(id=7, tenant_id=42)

        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir) / "uploads" / "io-search"
            upload_root.mkdir(parents=True, exist_ok=True)

            with patch.object(io_search_api, "get_io_search_upload_dir", return_value=upload_root), \
                 patch.object(io_search_api, "get_finance_module_id", return_value=1), \
                 patch.object(
                     io_search_api,
                     "get_finance_user_scope",
                     return_value=SimpleNamespace(user_id_filter=7),
                 ):
                with self.assertRaises(HTTPException) as exc:
                    io_search_api.get_downloadable_insertion_order(db, current_user, "IO-1")

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Invalid file location.")

    def test_get_downloadable_insertion_order_rejects_absolute_stored_path(self):
        record = SimpleNamespace(
            file_path="/tmp/outside.docx",
            file_name="outside.docx",
        )
        db = FakeFinanceDB(record)
        current_user = SimpleNamespace(id=7, tenant_id=42)

        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir) / "uploads" / "io-search"
            upload_root.mkdir(parents=True, exist_ok=True)

            with patch.object(io_search_api, "get_io_search_upload_dir", return_value=upload_root), \
                 patch.object(io_search_api, "get_finance_module_id", return_value=1), \
                 patch.object(
                     io_search_api,
                     "get_finance_user_scope",
                     return_value=SimpleNamespace(user_id_filter=7),
                 ):
                with self.assertRaises(HTTPException) as exc:
                    io_search_api.get_downloadable_insertion_order(db, current_user, "IO-1")

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Invalid file location.")

    def test_get_downloadable_insertion_order_sanitizes_fallback_file_name(self):
        record = SimpleNamespace(
            file_path=None,
            file_name="../nested/order.docx",
        )
        db = FakeFinanceDB(record)
        current_user = SimpleNamespace(id=7, tenant_id=42)

        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir) / "uploads" / "io-search"
            upload_root.mkdir(parents=True, exist_ok=True)
            target = upload_root / "order.docx"
            target.write_bytes(b"docx")

            with patch.object(io_search_api, "get_io_search_upload_dir", return_value=upload_root), \
                 patch.object(io_search_api, "get_finance_module_id", return_value=1), \
                 patch.object(
                     io_search_api,
                     "get_finance_user_scope",
                     return_value=SimpleNamespace(user_id_filter=7),
                 ):
                file_path, file_name = io_search_api.get_downloadable_insertion_order(db, current_user, "IO-1")

        self.assertEqual(file_path.name, "order.docx")
        self.assertEqual(file_name, "order.docx")

    def test_sanitize_file_name_strips_control_chars_and_collapses_repeated_dots(self):
        self.assertEqual(
            io_search_services.sanitize_file_name("..\\nested/\x00invoice.. final....pdf"),
            "invoice.-final.pdf",
        )
        self.assertEqual(io_search_services.sanitize_file_name("....docx"), "upload.docx")

    def test_get_downloadable_insertion_order_accepts_relative_stored_path(self):
        record = SimpleNamespace(
            file_path="tenant-42/order.pdf",
            file_name="order.pdf",
        )
        db = FakeFinanceDB(record)
        current_user = SimpleNamespace(id=7, tenant_id=42)

        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir) / "uploads" / "io-search"
            target = upload_root / "tenant-42" / "order.pdf"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"pdf")

            with patch.object(io_search_api, "get_io_search_upload_dir", return_value=upload_root), \
                 patch.object(io_search_api, "get_finance_module_id", return_value=1), \
                 patch.object(
                     io_search_api,
                     "get_finance_user_scope",
                     return_value=SimpleNamespace(user_id_filter=7),
                 ):
                file_path, file_name = io_search_api.get_downloadable_insertion_order(db, current_user, "IO-1")

        self.assertEqual(file_path, target)
        self.assertEqual(file_name, "order.pdf")
        self.assertTrue(any("finance_io.tenant_id" in str(condition) for condition in db.last_query.filters))

    def test_download_media_type_uses_file_extension(self):
        self.assertEqual(io_search_routes._download_media_type("order.pdf"), "application/pdf")
        self.assertEqual(
            io_search_routes._download_media_type("order.docx"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        self.assertEqual(io_search_routes._download_media_type("order.bin"), "application/octet-stream")

    def test_insertion_order_detail_serializes_optional_fields_as_none(self):
        record = SimpleNamespace(
            id=9,
            io_number="IO-9",
            customer_name="Acme",
            customer_contact_id=None,
            customer_organization_id=None,
            counterparty_reference=None,
            external_reference=None,
            issue_date=None,
            effective_date=None,
            due_date=None,
            start_date=None,
            end_date=None,
            status="draft",
            currency="USD",
            subtotal_amount=None,
            tax_amount=None,
            total_amount=None,
            notes=None,
            custom_data=None,
            file_name="order.pdf",
            user_id=None,
            assigned_user=None,
            created_at=None,
            updated_at=None,
        )

        payload = io_search_api._serialize_finance_record_response(
            record,
            request=None,
            current_user=SimpleNamespace(id=7),
        )

        self.assertIsNone(payload["customer_contact_id"])
        self.assertIsNone(payload["customer_organization_id"])
        self.assertIsNone(payload["total_amount"])
        self.assertIsNone(payload["custom_fields"])
        self.assertIsNone(payload["file_url"])
        self.assertEqual(payload["status"], "draft")
        self.assertEqual(payload["currency"], "USD")

    def test_upload_root_is_resolved_lazily_for_file_operations(self):
        with patch.object(io_search_services, "IO_SEARCH_UPLOAD_DIR", None), \
             patch.object(io_search_services.os, "getenv", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "IO_SEARCH_UPLOAD_DIR"):
                io_search_services.get_io_search_upload_dir()

    def test_overdue_event_emits_only_when_record_becomes_overdue(self):
        db = object()
        current_user = SimpleNamespace(id=7, tenant_id=42, first_name="Ada", last_name="Admin", email="ada@example.test")
        record = SimpleNamespace(
            id=12,
            io_number="IO-12",
            status="draft",
            due_date=None,
            total_amount=None,
            currency="USD",
            customer_name="Acme",
            customer_contact=None,
            customer_organization=None,
        )

        with patch.object(io_search_api, "safe_emit_crm_event") as emit:
            io_search_api._emit_invoice_overdue_event_if_needed(
                db,
                current_user=current_user,
                record=record,
            )

        emit.assert_not_called()

        record.due_date = date(2025, 1, 1)
        with patch.object(io_search_api, "safe_emit_crm_event") as emit:
            io_search_api._emit_invoice_overdue_event_if_needed(
                db,
                current_user=current_user,
                record=record,
                previous_state={"status": "draft", "due_date": None},
            )

        emit.assert_called_once()

        with patch.object(io_search_api, "safe_emit_crm_event") as emit:
            io_search_api._emit_invoice_overdue_event_if_needed(
                db,
                current_user=current_user,
                record=record,
                previous_state={"status": "draft", "due_date": "2025-01-01"},
            )

        emit.assert_not_called()


class FinanceInsertionOrderListTests(unittest.TestCase):
    def test_list_insertion_orders_sorts_before_pagination(self):
        query = FakeInsertionOrderQuery()
        pagination = SimpleNamespace(offset=10, limit=5)

        with patch.object(io_repository, "build_insertion_orders_query", return_value=query), \
             patch.object(io_repository, "hydrate_custom_field_records", side_effect=lambda _db, **kwargs: kwargs["records"]):
            records, total_count = io_repository.list_insertion_orders(
                object(),
                tenant_id=42,
                module_id=3,
                user_id=None,
                pagination=pagination,
                sort_by="io_number",
                sort_direction="asc",
            )

        self.assertEqual(total_count, 3)
        self.assertEqual([record.io_number for record in records], ["IO-002"])
        self.assertEqual(
            query.operations,
            ["count", "order_by_reset", "order_by", "offset:10", "limit:5", "all"],
        )

    def test_list_serializer_respects_requested_fields(self):
        item = io_search_routes._serialize_insertion_order_list_item(
            {
                "id": 1,
                "io_number": "IO-001",
                "customer_name": "Acme",
                "total_amount": 50.0,
                "notes": "private",
            },
            {"io_number"},
        )

        payload = item.model_dump(exclude_none=True)

        self.assertEqual(payload, {"id": 1, "io_number": "IO-001"})


class FinanceInsertionOrderOwnerTests(unittest.TestCase):
    """The insertion order was the one record type of the nine whose update contract could not
    carry a reassignment, so design.md 4.7's editable Owner needed the column made writable."""

    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="ada@example.test", first_name="Ada", last_name="Lovelace", is_active=UserStatus.active),
                User(id=2, tenant_id=10, email="grace@example.test", first_name="Grace", last_name="Hopper", is_active=UserStatus.active),
                User(id=3, tenant_id=99, email="other@example.test", first_name="Other", last_name="Tenant", is_active=UserStatus.active),
            ]
        )
        self.record = FinanceIO(
            id=1,
            tenant_id=10,
            module_id=1,
            user_id=1,
            io_number="IO-1",
            file_name="io.pdf",
            customer_name="Acme",
            status="draft",
            currency="USD",
        )
        self.db.add(self.record)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_owner_can_be_reassigned_within_the_tenant(self):
        updated = io_search_services.update_insertion_order(
            self.db,
            record=self.record,
            current_user=SimpleNamespace(id=1, tenant_id=10),
            data={"user_id": 2},
        )

        self.assertEqual(updated.user_id, 2)

    def test_owner_can_be_cleared(self):
        updated = io_search_services.update_insertion_order(
            self.db,
            record=self.record,
            current_user=SimpleNamespace(id=1, tenant_id=10),
            data={"user_id": None},
        )

        self.assertIsNone(updated.user_id)

    def test_owner_cannot_be_set_to_another_tenants_user(self):
        with self.assertRaises(HTTPException) as caught:
            io_search_services.update_insertion_order(
                self.db,
                record=self.record,
                current_user=SimpleNamespace(id=1, tenant_id=10),
                data={"user_id": 3},
            )

        self.assertEqual(caught.exception.status_code, 400)
        self.db.rollback()
        self.assertEqual(self.db.query(FinanceIO).one().user_id, 1)

    def test_detail_response_carries_the_owner_id(self):
        payload = io_search_api._serialize_finance_record_response(
            self.record,
            request=None,
            current_user=SimpleNamespace(id=1),
        )

        self.assertEqual(payload["user_id"], 1)


class FinanceInsertionOrderValidationTests(unittest.TestCase):
    def test_create_request_rejects_invalid_status(self):
        with self.assertRaises(ValidationError):
            InsertionOrderCreateRequest(customer_name="Acme", status="bogus")

    def test_update_request_rejects_invalid_status(self):
        with self.assertRaises(ValidationError):
            InsertionOrderUpdateRequest(status="bogus")

    def test_service_normalizes_status(self):
        self.assertEqual(io_search_services.normalize_io_status("ACTIVE"), "active")


if __name__ == "__main__":
    unittest.main()
