import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from fastapi.responses import JSONResponse

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
                 patch.object(
                     io_search_api,
                     "get_finance_user_scope",
                     return_value=SimpleNamespace(user_id_filter=7),
                 ):
                with self.assertRaises(HTTPException) as exc:
                    io_search_api.get_downloadable_insertion_order(db, current_user, "IO-1")

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Invalid file location.")


class FinanceUploadNegativeTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_multiple_docx_rejects_conflicting_duplicate_actions(self):
        db = FakeFinanceDB()
        current_user = SimpleNamespace(id=7)
        upload = UploadFile(file=io.BytesIO(b"dummy"), filename="sample.docx")

        with self.assertRaises(HTTPException) as exc:
            await io_search_api.upload_multiple_docx(
                db,
                current_user,
                [upload],
                replace_duplicates=True,
                skip_duplicates=True,
                create_new_records=False,
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertIn("Choose only one", exc.exception.detail)

    async def test_upload_multiple_docx_returns_409_when_existing_duplicates_need_confirmation(self):
        db = FakeFinanceDB(duplicate_campaigns=["Campaign A"])
        current_user = SimpleNamespace(id=7)
        upload = UploadFile(file=io.BytesIO(b"dummy"), filename="campaign-a.docx")

        with patch.object(
            io_search_api,
            "parse_io_files",
            return_value=[{"file_name": "campaign-a.docx", "Campaign Name": "Campaign A"}],
        ), patch.object(io_search_api, "persist_records_to_db") as persist_mock:
            response = await io_search_api.upload_multiple_docx(
                db,
                current_user,
                [upload],
                replace_duplicates=False,
                skip_duplicates=False,
                create_new_records=False,
            )

        self.assertIsInstance(response, JSONResponse)
        self.assertEqual(response.status_code, 409)
        self.assertIn(b"requires_confirmation", response.body)
        self.assertIn(b"Campaign A", response.body)
        persist_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
