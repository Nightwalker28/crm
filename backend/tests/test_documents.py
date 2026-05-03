import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app.core.database import Base
from app.modules.documents.models import Document, DocumentLink
from app.modules.documents.services import storage_backends
from app.modules.documents.services.document_services import (
    list_documents,
    read_document_upload,
    resolve_document_storage_path,
)
from app.modules.sales.models import SalesContact
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Role, Tenant, User, UserStatus


class DocumentUploadValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_read_document_upload_accepts_pdf_with_valid_signature(self):
        upload = UploadFile(
            file=io.BytesIO(b"%PDF-1.7\ncontent\n%%EOF"),
            filename="proposal.PDF",
            headers=Headers({"content-type": "application/pdf"}),
        )

        content, extension, content_type, filename = await read_document_upload(upload)

        self.assertEqual(content, b"%PDF-1.7\ncontent\n%%EOF")
        self.assertEqual(extension, "pdf")
        self.assertEqual(content_type, "application/pdf")
        self.assertEqual(filename, "proposal.PDF")

    async def test_read_document_upload_rejects_disallowed_extension(self):
        upload = UploadFile(
            file=io.BytesIO(b"not a document"),
            filename="script.exe",
            headers=Headers({"content-type": "application/octet-stream"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await read_document_upload(upload)

        self.assertEqual(exc.exception.status_code, 400)

    async def test_read_document_upload_rejects_fake_pdf(self):
        upload = UploadFile(
            file=io.BytesIO(b"plain text"),
            filename="proposal.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await read_document_upload(upload)

        self.assertEqual(exc.exception.detail, "Uploaded PDF content is invalid.")


class DocumentServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Role(id=1, tenant_id=10, name="Admin", level=100),
                User(
                    id=1,
                    tenant_id=10,
                    email="admin@example.com",
                    first_name="Ava",
                    last_name="Admin",
                    role_id=1,
                    is_active=UserStatus.active,
                ),
                SalesContact(
                    contact_id=7,
                    tenant_id=10,
                    primary_email="lead@example.com",
                    assigned_to=1,
                ),
                Document(
                    id=1,
                    tenant_id=10,
                    uploaded_by_user_id=1,
                    title="Proposal",
                    original_filename="proposal.pdf",
                    content_type="application/pdf",
                    extension="pdf",
                    file_size_bytes=16,
                    storage_provider="local",
                    storage_path="documents/tenant-10/proposal.pdf",
                ),
                Document(
                    id=2,
                    tenant_id=99,
                    uploaded_by_user_id=None,
                    title="Other tenant",
                    original_filename="other.pdf",
                    content_type="application/pdf",
                    extension="pdf",
                    file_size_bytes=16,
                    storage_provider="local",
                    storage_path="documents/tenant-99/other.pdf",
                ),
                DocumentLink(
                    id=1,
                    tenant_id=10,
                    document_id=1,
                    module_key="sales_contacts",
                    entity_id="7",
                    created_by_user_id=1,
                ),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_list_documents_is_tenant_scoped_and_filters_record_links(self):
        documents, total = list_documents(
            self.db,
            tenant_id=10,
            module_key="sales_contacts",
            entity_id=7,
        )

        self.assertEqual(total, 1)
        self.assertEqual([document.title for document in documents], ["Proposal"])
        self.assertEqual(documents[0].links[0].module_key, "sales_contacts")

    def test_resolve_document_storage_path_stays_under_documents_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir)
            docs_root = upload_root / "documents"
            docs_root.mkdir()
            target = docs_root / "tenant-10" / "proposal.pdf"
            target.parent.mkdir()
            target.write_bytes(b"%PDF-1.7\ncontent")

            document = Document(storage_provider="local", storage_path="documents/tenant-10/proposal.pdf")
            with patch.object(storage_backends, "UPLOADS_DIR", upload_root), \
                 patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", docs_root):
                resolved = resolve_document_storage_path(document)

        self.assertEqual(resolved.name, "proposal.pdf")


if __name__ == "__main__":
    unittest.main()
