import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.finance.services import io_search_api


class FakeFinanceQuery:
    def __init__(self, record=None, duplicate_campaigns=None):
        self.record = record
        self.duplicate_campaigns = duplicate_campaigns or []

    def filter(self, *args, **kwargs):
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

    def query(self, *_args, **_kwargs):
        return FakeFinanceQuery(self.record, self.duplicate_campaigns)


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
        current_user = SimpleNamespace(id=7)

        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir) / "uploads" / "io-search"
            upload_root.mkdir(parents=True, exist_ok=True)

            with patch.object(io_search_api, "IO_SEARCH_UPLOAD_DIR", upload_root), \
                 patch.object(io_search_api, "get_finance_module_id", return_value=1), \
                 patch.object(
                     io_search_api,
                     "get_finance_user_scope",
                     return_value=SimpleNamespace(user_id_filter=7),
                 ):
                with self.assertRaises(HTTPException) as exc:
                    io_search_api.get_downloadable_insertion_order(db, current_user, "IO-1")

        self.assertEqual(exc.exception.status_code, 403)
        self.assertEqual(exc.exception.detail, "Access denied.")

    def test_get_downloadable_insertion_order_sanitizes_fallback_file_name(self):
        record = SimpleNamespace(
            file_path=None,
            file_name="../nested/order.docx",
        )
        db = FakeFinanceDB(record)
        current_user = SimpleNamespace(id=7)

        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir) / "uploads" / "io-search"
            upload_root.mkdir(parents=True, exist_ok=True)
            target = upload_root / "order.docx"
            target.write_bytes(b"docx")

            with patch.object(io_search_api, "IO_SEARCH_UPLOAD_DIR", upload_root), \
                 patch.object(io_search_api, "get_finance_module_id", return_value=1), \
                 patch.object(
                     io_search_api,
                     "get_finance_user_scope",
                     return_value=SimpleNamespace(user_id_filter=7),
                 ):
                file_path, file_name = io_search_api.get_downloadable_insertion_order(db, current_user, "IO-1")

        self.assertEqual(file_path.name, "order.docx")
        self.assertEqual(file_name, "order.docx")


if __name__ == "__main__":
    unittest.main()
