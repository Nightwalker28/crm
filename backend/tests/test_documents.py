import io
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app.core.database import Base
from app.modules.documents.models import Document, DocumentClientShare, DocumentLink, DocumentStorageConnection, DocumentUploadOperation, DocumentVersion
from app.modules.documents.repositories import documents_repository
from app.modules.documents.services import storage_backends
from app.modules.documents.services.storage_backends import (
    GoogleDriveDocumentStorage,
    LocalDocumentStorage,
    MicrosoftOneDriveDocumentStorage,
    _safe_provider_filename,
)
from app.modules.documents.services import document_services
from app.modules.documents.services.document_services import (
    create_document,
    _document_provider_filename,
    _create_drive_oauth_state,
    _refresh_google_drive_access_token,
    get_client_document_share_or_404,
    list_document_templates,
    list_client_documents,
    list_documents_cursor,
    list_document_versions,
    list_documents,
    log_client_document_download,
    log_client_document_view,
    read_document_upload,
    revoke_document_client_share,
    resolve_document_storage_path,
    resolve_document_view,
    share_document_with_client,
    serialize_client_document_share,
    update_document_template_status,
    upload_document_version,
)
from app.modules.platform.models import ActivityLog
from app.modules.sales.models import SalesContact
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Role, Tenant, User, UserStatus


class DocumentUploadValidationTests(unittest.IsolatedAsyncioTestCase):
    def test_provider_filename_prefers_display_name_and_preserves_validated_extension(self):
        requested = _document_provider_filename(
            display_name="Customer Proposal",
            legacy_title=None,
            original_filename="proposal.pdf",
        )

        self.assertEqual(_safe_provider_filename(requested, "pdf"), "Customer Proposal.pdf")

    def test_provider_filename_defaults_to_original_and_sanitizes_path_characters(self):
        requested = _document_provider_filename(
            display_name=None,
            legacy_title=None,
            original_filename="Quarterly Report.pdf",
        )

        self.assertEqual(_safe_provider_filename(requested, "pdf"), "Quarterly Report.pdf")
        self.assertEqual(_safe_provider_filename("../CON:Q4", "pdf"), "_CON_Q4.pdf")
        self.assertEqual(_safe_provider_filename("CON", "pdf"), "_CON.pdf")

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

    async def test_read_document_upload_rejects_oversized_file_while_reading(self):
        upload = UploadFile(
            file=io.BytesIO(b"%PDF-1.7\ncontent\n%%EOF"),
            filename="proposal.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )

        with patch.object(document_services.settings, "DOCUMENT_MAX_UPLOAD_BYTES", 5):
            with self.assertRaises(HTTPException) as exc:
                await read_document_upload(upload)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Document exceeds the 5 byte upload limit.")

    async def test_read_document_upload_rejects_empty_file(self):
        upload = UploadFile(
            file=io.BytesIO(b""),
            filename="empty.txt",
            headers=Headers({"content-type": "text/plain"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await read_document_upload(upload)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Uploaded document is empty.")

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
                    storage_path="tenant-10/proposal.pdf",
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
                    storage_path="tenant-99/other.pdf",
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
                    storage_path="tenant-10/alpha.pdf",
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
                    storage_path="tenant-10/zulu.pdf",
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

    def test_list_documents_cursor_uses_linked_record_access_check(self):
        current_user = SimpleNamespace(id=1, tenant_id=10)

        with patch.object(document_services, "_require_linked_record_access") as require_access, \
             patch.object(documents_repository, "list_documents_cursor", return_value=[]) as list_cursor:
            documents = list_documents_cursor(
                self.db,
                tenant_id=10,
                module_key="sales_contacts",
                entity_id=7,
                limit=10,
                current_user=current_user,
            )

        self.assertEqual(documents, [])
        require_access.assert_called_once_with(
            self.db,
            user=current_user,
            module_key="sales_contacts",
            entity_id=7,
            action="view",
        )
        list_cursor.assert_called_once()

    def test_resolve_document_storage_path_stays_under_documents_root(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir)
            docs_root = upload_root / "documents"
            docs_root.mkdir()
            target = docs_root / "tenant-10" / "proposal.pdf"
            target.parent.mkdir()
            target.write_bytes(b"%PDF-1.7\ncontent")

            document = Document(storage_provider="local", storage_path="tenant-10/proposal.pdf")
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

    def test_resolve_document_storage_path_rejects_legacy_documents_prefix(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir)
            docs_root = upload_root / "documents"
            target = docs_root / "tenant-10" / "proposal.pdf"
            target.parent.mkdir(parents=True)
            target.write_bytes(b"%PDF-1.7\ncontent")

            document = Document(storage_provider="local", storage_path="documents/tenant-10/proposal.pdf")
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

    def test_get_document_include_deleted_keeps_active_rows_visible(self):
        active = documents_repository.get_document(self.db, tenant_id=10, document_id=1, include_deleted=True)

        self.assertIsNotNone(active)
        self.assertIsNone(active.deleted_at)

    def test_get_deleted_document_is_deleted_only(self):
        self.db.query(Document).filter(Document.id == 1).update({"deleted_at": datetime(2024, 1, 1, tzinfo=timezone.utc)})
        self.db.commit()

        deleted = documents_repository.get_deleted_document(self.db, tenant_id=10, document_id=1)
        active = documents_repository.get_document(self.db, tenant_id=10, document_id=1)

        self.assertIsNotNone(deleted)
        self.assertIsNone(active)

    def test_drive_oauth_state_uses_numeric_dates_and_safe_return_path(self):
        tenant = SimpleNamespace(id=10)
        user = SimpleNamespace(id=1)

        token = _create_drive_oauth_state(
            tenant=tenant,
            user=user,
            frontend_origin="https://app.example.com/",
            return_path="/dashboard/documents?next=unsafe#fragment",
        )
        payload = document_services.decode_drive_oauth_state(token)

        self.assertIsInstance(payload["iat"], int)
        self.assertIsInstance(payload["exp"], int)
        self.assertEqual(payload["frontend_origin"], "https://app.example.com")
        self.assertEqual(payload["return_path"], "/dashboard/documents")

    def test_drive_oauth_state_rejects_invalid_origin(self):
        token = _create_drive_oauth_state(
            tenant=SimpleNamespace(id=10),
            user=SimpleNamespace(id=1),
            frontend_origin="https://app.example.com",
            return_path="/dashboard/documents",
        )
        with patch.object(document_services.jwt, "decode", return_value={**document_services.jwt.decode(token, document_services.settings.JWT_SECRET, algorithms=[document_services.settings.JWT_ALGORITHM]), "frontend_origin": "javascript:alert(1)"}):
            payload = document_services.decode_drive_oauth_state(token)

        self.assertIsNone(payload)

    def test_drive_token_refresh_rechecks_connection_after_lock(self):
        connection = SimpleNamespace(id=5)
        db = SimpleNamespace(refresh=Mock())

        with patch.object(document_services, "_usable_connection_access_token", side_effect=[None, "fresh-token"]) as usable_mock, \
             patch.object(document_services, "cache_acquire_lock", return_value="lock-token") as acquire_mock, \
             patch.object(document_services, "cache_release_lock") as release_mock, \
             patch.object(document_services.requests, "post") as post_mock:
            token = _refresh_google_drive_access_token(db, connection)

        self.assertEqual(token, "fresh-token")
        acquire_mock.assert_called_once_with("document-storage-token-refresh:5", ttl_seconds=30)
        release_mock.assert_called_once_with("document-storage-token-refresh:5", "lock-token")
        db.refresh.assert_called_once_with(connection)
        self.assertEqual(usable_mock.call_count, 2)
        post_mock.assert_not_called()

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
                document = upload_document_version(
                    self.db,
                    tenant_id=10,
                    document_id=3,
                    file=upload,
                    current_user=user,
                )

        versions = list_document_versions(self.db, document=document)

        self.assertEqual(document.original_filename, "contract-v2.pdf")
        self.assertEqual(document.file_size_bytes, len(b"%PDF-1.7\nupdated\n%%EOF"))
        self.assertEqual([version.version_number for version in versions], [2, 1])
        self.assertEqual(document.current_version_id, versions[0].id)
        self.assertEqual(versions[0].tenant_id, 10)
        self.assertEqual(versions[1].storage_key, "tenant-10/contract-v1.pdf")
        entry = self.db.query(ActivityLog).filter(ActivityLog.action == "version.create").one()
        self.assertEqual(entry.tenant_id, 10)
        self.assertEqual(entry.before_state["document_id"], 3)
        self.assertEqual(entry.after_state["document_id"], 3)
        self.assertNotIn("links", entry.before_state)
        self.assertNotIn("client_shares", entry.after_state)

    def test_template_update_audit_uses_slim_document_state(self):
        document = update_document_template_status(
            self.db,
            tenant_id=10,
            document_id=1,
            is_template=True,
            template_category="Proposals",
            current_user=None,
        )

        entry = self.db.query(ActivityLog).filter(ActivityLog.action == "template.update").one()
        self.assertEqual(entry.tenant_id, 10)
        self.assertEqual(entry.before_state["document_id"], document.id)
        self.assertEqual(entry.after_state["document_id"], document.id)
        self.assertNotIn("links", entry.before_state)
        self.assertNotIn("client_shares", entry.after_state)

    def test_create_document_deletes_storage_when_database_write_fails(self):
        upload = UploadFile(
            file=io.BytesIO(b"%PDF-1.7\ncontent\n%%EOF"),
            filename="proposal.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )
        user = SimpleNamespace(id=1, tenant_id=10)

        with tempfile.TemporaryDirectory() as tmpdir:
            upload_root = Path(tmpdir)
            docs_root = upload_root / "documents"
            with patch.object(storage_backends, "UPLOADS_DIR", upload_root), \
                 patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", docs_root), \
                 patch.object(self.db, "flush", side_effect=RuntimeError("boom")):
                with self.assertRaisesRegex(RuntimeError, "boom"):
                    create_document(
                        self.db,
                        tenant_id=10,
                        user_id=1,
                        file=upload,
                        current_user=user,
                    )
            remaining_files = list(docs_root.rglob("*")) if docs_root.exists() else []

        self.assertEqual([path for path in remaining_files if path.is_file()], [])

    def test_idempotent_upload_reuses_completed_document_and_supports_multiple_associations(self):
        self.db.add_all([
            Module(id=100, name="sales_contacts", base_route="/dashboard/sales/contacts", is_enabled=1),
            SalesContact(contact_id=8, tenant_id=10, primary_email="second@example.com", assigned_to=1),
        ])
        self.db.commit()
        user = self.db.get(User, 1)

        def upload():
            return UploadFile(
                file=io.BytesIO(b"%PDF-1.7\ncontent\n%%EOF"),
                filename="proposal.pdf",
                headers=Headers({"content-type": "application/pdf"}),
            )

        with tempfile.TemporaryDirectory() as tmpdir, \
             patch.object(storage_backends, "UPLOADS_DIR", Path(tmpdir)), \
             patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", Path(tmpdir) / "documents"):
            first = create_document(
                self.db,
                tenant_id=10,
                user_id=1,
                file=upload(),
                current_user=None,
                idempotency_key="upload-key-1234",
                associations=[
                    {"module_key": "sales_contacts", "entity_id": "7"},
                    {"module_key": "sales_contacts", "entity_id": "8"},
                ],
            )
            second = create_document(
                self.db,
                tenant_id=10,
                user_id=1,
                file=upload(),
                current_user=user,
                idempotency_key="upload-key-1234",
            )
            stored_files = [path for path in (Path(tmpdir) / "documents").rglob("*") if path.is_file()]

        self.assertEqual(first.id, second.id)
        self.assertEqual({link.entity_id for link in first.links}, {"7", "8"})
        self.assertEqual(len(stored_files), 1)
        operation = self.db.query(DocumentUploadOperation).filter_by(idempotency_key="upload-key-1234").one()
        self.assertEqual(operation.status, "completed")

    def test_batch_metadata_is_persisted_and_serializable(self):
        upload = UploadFile(
            file=io.BytesIO(b"customer notes"),
            filename="notes.txt",
            headers=Headers({"content-type": "text/plain"}),
        )
        with tempfile.TemporaryDirectory() as tmpdir, \
             patch.object(storage_backends, "UPLOADS_DIR", Path(tmpdir)), \
             patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", Path(tmpdir) / "documents"):
            document = create_document(
                self.db,
                tenant_id=10,
                user_id=1,
                file=upload,
                display_name="Customer notes",
                description="Shared batch description",
                category="Brief",
                tags=["customer", "priority", "customer"],
                current_user=None,
            )

        self.assertEqual(document.display_name, "Customer notes")
        self.assertEqual(document.description, "Shared batch description")
        self.assertEqual(document.category, "Brief")
        self.assertEqual(document.tags, ["customer", "priority"])

    def test_upload_rejects_tenant_quota_exhaustion_before_storage_write(self):
        upload = UploadFile(
            file=io.BytesIO(b"quota test"),
            filename="quota.txt",
            headers=Headers({"content-type": "text/plain"}),
        )
        with patch.object(document_services.settings, "DOCUMENT_TENANT_STORAGE_LIMIT_BYTES", 1), \
             patch.object(document_services, "_store_document_content") as store_mock, \
             self.assertRaises(HTTPException) as exc:
            create_document(self.db, tenant_id=10, user_id=1, file=upload, current_user=None)

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Tenant document storage limit exceeded.")
        store_mock.assert_not_called()

    def test_upload_completes_with_safe_warning_when_one_association_cannot_be_created(self):
        self.db.add(Module(id=100, name="sales_contacts", base_route="/dashboard/sales/contacts", is_enabled=1))
        self.db.commit()
        upload = UploadFile(
            file=io.BytesIO(b"%PDF-1.7\ncontent\n%%EOF"),
            filename="proposal.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )

        with tempfile.TemporaryDirectory() as tmpdir, \
             patch.object(storage_backends, "UPLOADS_DIR", Path(tmpdir)), \
             patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", Path(tmpdir) / "documents"):
            document = create_document(
                self.db,
                tenant_id=10,
                user_id=1,
                file=upload,
                current_user=None,
                idempotency_key="partial-link-1234",
                associations=[
                    {"module_key": "sales_contacts", "entity_id": "7"},
                    {"module_key": "sales_contacts", "entity_id": "999"},
                ],
            )

        self.assertEqual({link.entity_id for link in document.links}, {"7"})
        self.assertEqual(document.association_failures, [{
            "module_key": "sales_contacts",
            "entity_id": "999",
            "message": "Record could not be linked.",
        }])
        operation = self.db.query(DocumentUploadOperation).filter_by(idempotency_key="partial-link-1234").one()
        self.assertEqual(operation.status, "completed")
        self.assertEqual(operation.association_failures, document.association_failures)

    def test_cloud_version_retains_its_own_provider_reference(self):
        connection = DocumentStorageConnection(
            id=51,
            tenant_id=10,
            user_id=1,
            provider="google_drive",
            status="connected",
        )
        document = Document(
            id=51,
            tenant_id=10,
            uploaded_by_user_id=1,
            title="Cloud contract",
            original_filename="contract-v1.pdf",
            content_type="application/pdf",
            extension="pdf",
            file_size_bytes=19,
            storage_provider="google_drive",
            storage_path="google-v1",
            provider_file_id="google-v1",
            provider_account_id=51,
        )
        self.db.add_all([connection, document])
        self.db.commit()
        stored = document_services.StoredDocument(
            provider="google_drive",
            storage_path="google-v2",
            provider_file_id="google-v2",
            provider_parent_id="folder-id",
            provider_path="Cloud contract.pdf",
            external_web_url="https://drive.google.com/file/d/google-v2/view",
            provider_created_at=datetime(2026, 8, 5, 10, 15, tzinfo=timezone.utc),
        )
        upload = UploadFile(
            file=io.BytesIO(b"%PDF-1.7\nupdated\n%%EOF"),
            filename="contract-v2.pdf",
            headers=Headers({"content-type": "application/pdf"}),
        )

        with patch.object(document_services, "_store_document_content", return_value=(stored, connection.id)):
            updated = upload_document_version(
                self.db,
                tenant_id=10,
                document_id=document.id,
                file=upload,
                current_user=SimpleNamespace(id=1, tenant_id=10),
            )

        version = list_document_versions(self.db, document=updated)[0]
        self.assertEqual(version.storage_provider, "google_drive")
        self.assertEqual(version.provider_file_id, "google-v2")
        self.assertEqual(version.provider_account_id, connection.id)
        self.assertEqual(version.external_web_url, "https://drive.google.com/file/d/google-v2/view")

    def test_cloud_view_uses_trusted_provider_url_and_marks_lost_connection(self):
        connection = DocumentStorageConnection(id=50, tenant_id=10, user_id=1, provider="google_drive", status="connected")
        document = Document(
            id=50,
            tenant_id=10,
            uploaded_by_user_id=1,
            title="Cloud proposal",
            display_name="Cloud proposal",
            original_filename="proposal.pdf",
            content_type="application/pdf",
            extension="pdf",
            file_size_bytes=20,
            storage_provider="google_drive",
            storage_path="google-file-id",
            provider_file_id="google-file-id",
            provider_status="available",
            external_web_url=None,
        )
        self.db.add_all([connection, document])
        self.db.commit()

        backend = Mock()
        backend.get_reference.return_value = {
            "status": "available",
            "provider_file_id": "google-file-id",
            "provider_parent_id": "folder-id",
            "provider_path": "remote.pdf",
            "external_web_url": "https://drive.google.com/file/d/google-file-id/view",
            "provider_created_at": datetime(2026, 8, 5, 10, 15, tzinfo=timezone.utc),
        }
        with patch.object(document_services, "_google_drive_backend_for_user", return_value=backend):
            view = resolve_document_view(self.db, document=document, current_user=SimpleNamespace(id=1, tenant_id=10))
        self.assertEqual(view["kind"], "external")
        self.assertEqual(view["url"], "https://drive.google.com/file/d/google-file-id/view")
        self.assertEqual(document.provider_account_id, connection.id)
        self.assertEqual(document.provider_parent_id, "folder-id")

        connection.status = "disconnected"
        self.db.add(connection)
        self.db.commit()
        with self.assertRaises(HTTPException) as exc:
            resolve_document_view(self.db, document=document, current_user=SimpleNamespace(id=1, tenant_id=10))
        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(document.provider_status, "permission_lost")

    def test_retry_reconciles_provider_upload_after_crm_persistence_failure(self):
        user = SimpleNamespace(id=1, tenant_id=10)

        def upload():
            return UploadFile(
                file=io.BytesIO(b"%PDF-1.7\nretry-content\n%%EOF"),
                filename="retry.pdf",
                headers=Headers({"content-type": "application/pdf"}),
            )

        original_commit = self.db.commit
        commit_count = 0

        def fail_document_commit_once():
            nonlocal commit_count
            commit_count += 1
            if commit_count == 3:
                raise RuntimeError("database unavailable")
            return original_commit()

        with tempfile.TemporaryDirectory() as tmpdir, \
             patch.object(storage_backends, "UPLOADS_DIR", Path(tmpdir)), \
             patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", Path(tmpdir) / "documents"), \
             patch.object(self.db, "commit", side_effect=fail_document_commit_once):
            with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                create_document(
                    self.db,
                    tenant_id=10,
                    user_id=1,
                    file=upload(),
                    current_user=user,
                    idempotency_key="retry-key-1234",
                )
            operation = self.db.query(DocumentUploadOperation).filter_by(idempotency_key="retry-key-1234").one()
            self.assertEqual(operation.status, "orphaned")

            document = create_document(
                self.db,
                tenant_id=10,
                user_id=1,
                file=upload(),
                current_user=user,
                idempotency_key="retry-key-1234",
            )
            stored_files = [path for path in (Path(tmpdir) / "documents").rglob("*") if path.is_file()]

        self.assertEqual(document.original_filename, "retry.pdf")
        self.assertEqual(len(stored_files), 1)
        self.assertEqual(operation.status, "completed")

    def test_upload_document_version_deletes_new_storage_when_database_write_fails(self):
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
                id=10,
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
        unlinked.current_version_id = 10
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
            old_file = docs_root / "tenant-10" / "contract-v1.pdf"
            old_file.parent.mkdir(parents=True)
            old_file.write_bytes(b"%PDF-1.7\nold\n%%EOF")
            with patch.object(storage_backends, "UPLOADS_DIR", upload_root), \
                 patch.object(storage_backends, "DOCUMENT_STORAGE_DIR", docs_root), \
                 patch.object(self.db, "flush", side_effect=RuntimeError("boom")):
                with self.assertRaisesRegex(RuntimeError, "boom"):
                    upload_document_version(
                        self.db,
                        tenant_id=10,
                        document_id=3,
                        file=upload,
                        current_user=user,
                    )
            remaining_files = sorted(path.relative_to(docs_root).as_posix() for path in docs_root.rglob("*") if path.is_file())

        self.assertEqual(remaining_files, ["tenant-10/contract-v1.pdf"])

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

    def test_document_download_audit_uses_slim_state(self):
        document = documents_repository.get_document(self.db, tenant_id=10, document_id=1)

        document_services.log_document_download(self.db, document=document, current_user=SimpleNamespace(id=1))

        entry = self.db.query(ActivityLog).filter(ActivityLog.action == "download").one()
        self.assertEqual(entry.after_state["document_id"], 1)
        self.assertNotIn("links", entry.after_state)
        self.assertNotIn("client_shares", entry.after_state)


class MicrosoftOneDriveStorageTests(unittest.TestCase):
    def test_reference_lookup_uses_graph_drive_items_endpoint(self):
        backend = MicrosoftOneDriveDocumentStorage(access_token="token")
        response = SimpleNamespace(
            ok=True,
            status_code=200,
            json=lambda: {
                "id": "drive-item-id",
                "name": "remote.pdf",
                "webUrl": "https://tenant.sharepoint.com/personal/user/Documents/remote.pdf",
                "parentReference": {"id": "parent-id", "path": "/drive/root:/Apps/Lynk"},
                "createdDateTime": "2026-08-05T10:15:00Z",
            },
        )

        with patch.object(storage_backends.requests, "get", return_value=response) as get_mock:
            reference = backend.get_reference("drive item/id")

        self.assertEqual(
            get_mock.call_args.args[0],
            f"{document_services.MICROSOFT_GRAPH_BASE}/me/drive/items/drive%20item%2Fid",
        )
        self.assertEqual(reference["status"], "available")
        self.assertEqual(reference["provider_parent_id"], "parent-id")
        self.assertEqual(reference["external_web_url"], "https://tenant.sharepoint.com/personal/user/Documents/remote.pdf")

    def test_upload_uses_graph_drive_content_endpoint(self):
        backend = MicrosoftOneDriveDocumentStorage(access_token="token")
        response = SimpleNamespace(ok=True, content=b"{}", json=lambda: {
            "id": "drive-item-id",
            "webUrl": "https://tenant.sharepoint.com/personal/user/Documents/file.pdf",
            "parentReference": {"id": "parent-id", "path": "/drive/root:/Apps/Lynk"},
            "createdDateTime": "2026-08-05T10:15:00Z",
        })

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
        self.assertEqual(stored.external_web_url, "https://tenant.sharepoint.com/personal/user/Documents/file.pdf")
        self.assertEqual(stored.provider_parent_id, "parent-id")
        self.assertEqual(stored.provider_created_at, datetime(2026, 8, 5, 10, 15, tzinfo=timezone.utc))
        self.assertIn("/me/drive/special/approot:/", put_mock.call_args.args[0])
        self.assertIn("proposal.pdf", put_mock.call_args.args[0])
        self.assertTrue(put_mock.call_args.args[0].endswith(":/content"))
        self.assertEqual(put_mock.call_args.kwargs["params"], {"@microsoft.graph.conflictBehavior": "rename"})


class GoogleDriveStorageTests(unittest.TestCase):
    def test_reference_lookup_uses_drive_files_endpoint(self):
        backend = GoogleDriveDocumentStorage(access_token="token")
        response = SimpleNamespace(
            ok=True,
            status_code=200,
            json=lambda: {
                "id": "google-file-id",
                "name": "remote.pdf",
                "webViewLink": "https://drive.google.com/file/d/google-file-id/view",
                "parents": ["folder-id"],
                "createdTime": "2026-08-05T10:15:00Z",
                "trashed": False,
            },
        )

        with patch.object(storage_backends.requests, "get", return_value=response) as get_mock:
            reference = backend.get_reference("google-file-id")

        self.assertEqual(get_mock.call_args.args[0], "https://www.googleapis.com/drive/v3/files/google-file-id")
        self.assertEqual(reference["status"], "available")
        self.assertEqual(reference["external_web_url"], "https://drive.google.com/file/d/google-file-id/view")

    def test_upload_persists_stable_google_view_metadata(self):
        backend = GoogleDriveDocumentStorage(access_token="token")
        response = SimpleNamespace(ok=True, content=b"{}", json=lambda: {
            "id": "google-file-id",
            "name": "remote.pdf",
            "webViewLink": "https://drive.google.com/file/d/google-file-id/view",
            "parents": ["folder-id"],
            "createdTime": "2026-08-05T10:15:00Z",
        })

        with patch.object(storage_backends.requests, "post", return_value=response) as post_mock:
            stored = backend.save(
                tenant_id=10,
                extension="pdf",
                content=b"%PDF-1.7\n%%EOF",
                filename="proposal.pdf",
                content_type="application/pdf",
            )

        self.assertEqual(stored.provider_file_id, "google-file-id")
        self.assertEqual(stored.provider_parent_id, "folder-id")
        self.assertEqual(stored.external_web_url, "https://drive.google.com/file/d/google-file-id/view")
        metadata_part = post_mock.call_args.kwargs["files"]["metadata"]
        self.assertIn('"name": "proposal.pdf"', metadata_part[1])

    def test_upload_rejects_untrusted_provider_view_url(self):
        backend = GoogleDriveDocumentStorage(access_token="token")
        response = SimpleNamespace(ok=True, content=b"{}", json=lambda: {
            "id": "google-file-id",
            "webViewLink": "https://attacker.example/doc",
        })

        with patch.object(storage_backends.requests, "post", return_value=response), self.assertRaises(HTTPException) as exc:
            backend.save(
                tenant_id=10,
                extension="pdf",
                content=b"%PDF-1.7\n%%EOF",
                filename="proposal.pdf",
                content_type="application/pdf",
            )

        self.assertEqual(exc.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
