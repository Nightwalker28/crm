import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, UploadFile

from app.modules.sales.services import opportunities_api


class OpportunityAttachmentTests(unittest.IsolatedAsyncioTestCase):
    async def test_upload_cleans_up_written_files_when_db_update_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            attachments_dir = Path(tmpdir) / "uploads" / "opportunities-attachments"
            attachments_dir.mkdir(parents=True, exist_ok=True)
            opportunity = SimpleNamespace(attachments=None)
            with patch.object(opportunities_api, "OPPORTUNITY_ATTACHMENTS_DIR", attachments_dir), \
                 patch.object(opportunities_api, "get_opportunity_or_404", return_value=opportunity), \
                 patch.object(opportunities_api, "update_opportunity", side_effect=RuntimeError("db failed")):
                upload = UploadFile(file=io.BytesIO(b"hello"), filename="spec.pdf")

                with self.assertRaises(RuntimeError):
                    await opportunities_api.upload_opportunity_attachments(
                        None,
                        opportunity_id=9,
                        files=[upload],
                    )

            self.assertEqual(list(attachments_dir.iterdir()), [])

    def test_delete_rejects_path_traversal_before_file_removal(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            attachments_dir = Path(tmpdir) / "uploads" / "opportunities-attachments"
            attachments_dir.mkdir(parents=True, exist_ok=True)
            outside_file = Path(tmpdir) / "escape.txt"
            outside_file.write_text("secret")
            relative_escape = "../escape.txt"
            opportunity = SimpleNamespace(attachments=[relative_escape])

            with patch.object(opportunities_api, "OPPORTUNITY_ATTACHMENTS_DIR", attachments_dir), \
                 patch.object(opportunities_api, "get_opportunity_or_404", return_value=opportunity), \
                 patch.object(opportunities_api, "update_opportunity") as update_mock:
                with self.assertRaises(HTTPException) as exc:
                    opportunities_api.delete_opportunity_attachments(
                        None,
                        opportunity_id=9,
                        attachments=[relative_escape],
                    )

            self.assertEqual(exc.exception.status_code, 400)
            self.assertEqual(exc.exception.detail, "Invalid attachment location.")
            self.assertTrue(outside_file.is_file())
            update_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
