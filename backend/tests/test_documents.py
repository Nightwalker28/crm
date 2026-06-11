import io
import asyncio
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app.core.database import Base
from app.modules.documents.models import Document, DocumentClientShare, DocumentLink, DocumentVersion
from app.modules.documents.services import storage_backends
from app.modules.documents.services.storage_backends import LocalDocumentStorage, MicrosoftOneDriveDocumentStorage
from app.modules.documents.services.document_services import (
    get_client_document_share_or_404,
    list_document_templates,
    list_client_documents,
    list_document_versions,
    list_documents,
    log_client_document_download,
    log_client_document_view,
    read_document_upload,
    revoke_document_client_share,
    resolve_document_storage_path,
    share_document_with_client,
    serialize_client_document_share,
    update_document_template_status,
    upload_document_version,
)
from app.modules.platform.models import ActivityLog
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


    async def test_read_document_upload_accepts_docx_with_valid_signature(self):
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w") as archive:
            archive.writestr("[Content_Types].xml", "<Types />")
            archive.writestr("word/document.xml", "<document />")
        upload = UploadFile(
            file=io.BytesIO(content.getvalue()),
            filename="proposal.docx",
            headers=Headers({"content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),
        )

        _, extension, content_type, filename = await read_document_upload(upload)

        self.assertEqual(extension, "docx")
        self.assertEqual(content_type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        self.assertEqual(filename, "proposal.docx")

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

    async def test_read_document_upload_rejects_content_type_mismatch(self):
        upload = UploadFile(
            file=io.BytesIO(b"%PDF-1.7\ncontent\n%%EOF"),
            filename="proposal.pdf",
            headers=Headers({"content-type": "text/plain"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await read_document_upload(upload)

        self.assertEqual(exc.exception.detail, "Document content type does not match file extension.")

    async def test_read_document_upload_rejects_polyglot_text(self):
        upload = UploadFile(
            file=io.BytesIO(b"%PDF-1.7\ncontent\n%%EOF"),
            filename="proposal.txt",
            headers=Headers({"content-type": "text/plain"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await read_document_upload(upload)

        self.assertEqual(exc.exception.detail, "Document content does not match file extension.")


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

    def test_list_documents_sorts_before_limit(self):
        self.db.add_all(
            [
                Document(
                    id=3,
                    tenant_id=10,
                    uploaded_by_user_id=1,
                    title="Alpha",
                    original_filename="alpha.pdf",
                    content_type="application/pdf",
                    extension="pdf",
                    file_size_bytes=2_000,
                    storage_provider="local",
                    storage_path="documents/tenant-10/alpha.pdf",
                    created_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
                    updated_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
                ),
                Document(
                    id=4,
                    tenant_id=10,
                    uploaded_by_user_id=1,
                    title="Zulu",
                    original_filename="zulu.pdf",
                    content_type="application/pdf",
                    extension="pdf",
                    file_size_bytes=500,
                    storage_provider="local",
                    storage_path="documents/tenant-10/zulu.pdf",
                    created_at=datetime(2024, 1, 2, tzinfo=timezone.utc),
                    updated_at=datetime(2024, 1, 2, tzinfo=timezone.utc),
                ),
            ]
        )
        self.db.commit()

        documents, total = list_documents(
            self.db,
            tenant_id=10,
            limit=1,
            sort_by="file_size_bytes",
            sort_direction="desc",
        )

        self.assertEqual(total, 3)
        self.assertEqual([document.title for document in documents], ["Alpha"])

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

    def test_resolve_document_storage_path_rejects_traversal(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir)
            docs_root = upload_root / "documents"
            docs_root.mkdir()
            escaped = upload_root / "outside.pdf"
            escaped.write_bytes(b"%PDF-1.7\ncontent")

            document = Document(storage_provider="local", storage_path="../outside.pdf")
            with patch.object(storage_backends, "UPLOADS_DIR", upload_root), \
                 patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", docs_root), \
                 self.assertRaises(HTTPException) as exc:
                resolve_document_storage_path(document)

        self.assertEqual(exc.exception.status_code, 404)

    def test_resolve_document_storage_path_rejects_legacy_traversal(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir)
            docs_root = upload_root / "documents"
            media_root = upload_root / "media"
            docs_root.mkdir()
            media_root.mkdir()
            escaped = media_root / "private.pdf"
            escaped.write_bytes(b"%PDF-1.7\ncontent")

            document = Document(storage_provider="local", storage_path="documents/tenant-10/../../media/private.pdf")
            with patch.object(storage_backends, "UPLOADS_DIR", upload_root), \
                 patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", docs_root), \
                 self.assertRaises(HTTPException) as exc:
                resolve_document_storage_path(document)

        self.assertEqual(exc.exception.status_code, 404)

    def test_resolve_document_storage_path_rejects_absolute_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir) / "uploads"
            docs_root = upload_root / "documents"
            docs_root.mkdir(parents=True)
            escaped = Path(tmpdir) / "outside.pdf"
            escaped.write_bytes(b"%PDF-1.7\ncontent")

            document = Document(storage_provider="local", storage_path=str(escaped))
            with patch.object(storage_backends, "UPLOADS_DIR", upload_root), \
                 patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", docs_root), \
                 self.assertRaises(HTTPException) as exc:
                resolve_document_storage_path(document)

        self.assertEqual(exc.exception.status_code, 404)

    def test_local_storage_saves_path_relative_to_document_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir)
            docs_root = upload_root / "documents"
            with patch.object(storage_backends, "UPLOADS_DIR", upload_root), \
                 patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", docs_root):
                stored = LocalDocumentStorage().save(tenant_id=10, extension="pdf", content=b"%PDF-1.7\ncontent")
                resolved = LocalDocumentStorage().resolve_path(stored.storage_path)

        self.assertTrue(stored.storage_path.startswith("tenant-10/"))
        self.assertNotIn("documents/", stored.storage_path)
        self.assertEqual(resolved.name, Path(stored.storage_path).name)

    def test_template_filter_returns_only_marked_documents(self):
        document = update_document_template_status(
            self.db,
            tenant_id=10,
            document_id=1,
            is_template=True,
            template_category="Proposals",
        )

        templates, total = list_document_templates(self.db, tenant_id=10)

        self.assertTrue(document.is_template)
        self.assertEqual(document.template_category, "Proposals")
        self.assertEqual(total, 1)
        self.assertEqual([item.id for item in templates], [1])

    def test_upload_document_version_preserves_previous_version_and_updates_current(self):
        unlinked = Document(
            id=3,
            tenant_id=10,
            uploaded_by_user_id=1,
            title="Contract",
            original_filename="contract-v1.pdf",
            content_type="application/pdf",
            extension="pdf",
            file_size_bytes=19,
            storage_provider="local",
            storage_path="tenant-10/contract-v1.pdf",
        )
        self.db.add(unlinked)
        self.db.add(
            DocumentVersion(
                id=1,
                tenant_id=10,
                document_id=3,
                version_number=1,
                storage_key="tenant-10/contract-v1.pdf",
                file_name="contract-v1.pdf",
                mime_type="application/pdf",
                size_bytes=19,
                uploaded_by_id=1,
            )
        )
        self.db.commit()
        unlinked.current_version_id = 1
        self.db.add(unlinked)
        self.db.commit()
        upload = UploadFile(
            file=io.BytesIO(b"%PDF-1.7\nupdated\n%%EOF"),
            filename="contract-v2.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )
        user = SimpleNamespace(id=1, tenant_id=10)

        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir)
            docs_root = upload_root / "documents"
            with patch.object(storage_backends, "UPLOADS_DIR", upload_root), \
                 patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", docs_root):
                document = asyncio.run(
                    upload_document_version(
                        self.db,
                        tenant_id=10,
                        document_id=3,
                        file=upload,
                        current_user=user,
                    )
                )

        versions = list_document_versions(self.db, document=document)

        self.assertEqual(document.original_filename, "contract-v2.pdf")
        self.assertEqual(document.file_size_bytes, len(b"%PDF-1.7\nupdated\n%%EOF"))
        self.assertEqual([version.version_number for version in versions], [2, 1])
        self.assertEqual(document.current_version_id, versions[0].id)
        self.assertEqual(versions[1].storage_key, "tenant-10/contract-v1.pdf")

    def test_client_document_share_scopes_lists_and_revokes(self):
        share = share_document_with_client(
            self.db,
            tenant_id=10,
            document_id=1,
            payload={"contact_id": 7, "organization_id": None, "expires_at": None},
            current_user=None,
        )
        client_shares = list_client_documents(self.db, tenant_id=10, contact_id=7, organization_id=None)
        serialized = serialize_client_document_share(client_shares[0])

        self.assertEqual(share.document_id, 1)
        self.assertEqual([item.document_id for item in client_shares], [1])
        self.assertEqual(serialized["title"], "Proposal")
        with self.assertRaises(HTTPException) as exc:
            get_client_document_share_or_404(self.db, tenant_id=10, contact_id=8, organization_id=None, document_id=1)
        self.assertEqual(exc.exception.status_code, 404)

        revoked = revoke_document_client_share(self.db, tenant_id=10, document_id=1, share_id=share.id, current_user=None)
        self.assertIsNotNone(revoked.revoked_at)
        self.assertEqual(list_client_documents(self.db, tenant_id=10, contact_id=7, organization_id=None), [])

    def test_expired_client_document_share_is_hidden(self):
        self.db.add(
            DocumentClientShare(
                id=10,
                tenant_id=10,
                document_id=1,
                contact_id=7,
                expires_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
                created_by_user_id=1,
            )
        )
        self.db.commit()

        self.assertEqual(list_client_documents(self.db, tenant_id=10, contact_id=7, organization_id=None), [])

    def test_client_document_download_is_audited(self):
        share = share_document_with_client(
            self.db,
            tenant_id=10,
            document_id=1,
            payload={"contact_id": 7},
            current_user=None,
        )
        share = get_client_document_share_or_404(self.db, tenant_id=10, contact_id=7, organization_id=None, document_id=1)

        log_client_document_view(self.db, share=share, client_account_id=22)
        log_client_document_download(self.db, share=share, client_account_id=22)

        entries = (
            self.db.query(ActivityLog)
            .filter(ActivityLog.action.in_(["portal.document.viewed", "portal.document.downloaded"]))
            .order_by(ActivityLog.id.asc())
            .all()
        )
        self.assertEqual([entry.action for entry in entries], ["portal.document.viewed", "portal.document.downloaded"])
        for entry in entries:
            self.assertEqual(entry.tenant_id, 10)
            self.assertEqual(entry.entity_id, "1")
            self.assertEqual(entry.after_state["client_account_id"], 22)


class MicrosoftOneDriveStorageTests(unittest.TestCase):
    def test_upload_uses_graph_drive_content_endpoint(self):
        backend = MicrosoftOneDriveDocumentStorage(access_token="token")
        response = SimpleNamespace(ok=True, content=b"{}", json=lambda: {"id": "drive-item-id"})

        with patch.object(storage_backends.requests, "put", return_value=response) as put_mock:
            stored = backend.save(
                tenant_id=10,
                extension="pdf",
                content=b"%PDF-1.7\n%%EOF",
                filename="proposal.pdf",
                content_type="application/pdf",
            )

        self.assertEqual(stored.provider, "microsoft_onedrive")
        self.assertEqual(stored.storage_path, "drive-item-id")
        self.assertIn("/me/drive/special/approot:/", put_mock.call_args.args[0])
        self.assertTrue(put_mock.call_args.args[0].endswith(":/content"))


if __name__ == "__main__":
    unittest.main()
