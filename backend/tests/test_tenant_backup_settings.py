import unittest
import json
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents.models import DocumentStorageConnection
from app.modules.platform.models import ActivityLog, TenantBackupRun, TenantBackupSettings, TenantRestoreRun
from app.modules.platform.services import tenant_backup_runs as tenant_backup_runs_service
from app.modules.platform.services.tenant_backup_runs import (
    create_manual_tenant_backup_run,
    delete_tenant_backup_artifact,
    run_due_tenant_backup_schedules,
)
from app.modules.platform.services.tenant_restore_runs import (
    execute_tenant_module_restore,
    execute_whole_tenant_restore,
    preview_tenant_module_restore,
    preview_whole_tenant_restore,
)
from app.modules.platform.services.tenant_backup_settings import (
    get_or_create_tenant_backup_settings,
    list_tenant_backup_destination_connections,
    update_tenant_backup_settings,
)
from app.modules.sales import models as sales_models  # noqa: F401
from app.modules.sales.models import SalesContact
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Tenant, TenantModuleConfig, User, UserStatus


def _replace_zip_json(path: str, member_name: str, payload: dict):
    original_path = Path(path)
    temp_path = original_path.with_suffix(".rewrite.zip")
    with zipfile.ZipFile(original_path, "r") as source, zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            if info.filename == member_name:
                continue
            target.writestr(info, source.read(info.filename))
        target.writestr(member_name, json.dumps(payload))
    temp_path.replace(original_path)


class TenantBackupSettingsTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_backup_dir = tenant_backup_runs_service.TENANT_BACKUP_UPLOAD_DIR
        tenant_backup_runs_service.TENANT_BACKUP_UPLOAD_DIR = Path(self.temp_dir.name)
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
                User(id=1, tenant_id=10, email="owner@example.com", first_name="Owner", last_name="User", is_active=UserStatus.active),
                User(id=2, tenant_id=99, email="other@example.com", first_name="Other", last_name="User", is_active=UserStatus.active),
                Module(id=1, name="sales_contacts", base_route="/dashboard/sales/contacts", is_enabled=1),
                Module(id=2, name="documents", base_route="/dashboard/documents", is_enabled=1),
                TenantModuleConfig(id=1, tenant_id=10, module_id=1, is_enabled=1),
                TenantModuleConfig(id=2, tenant_id=10, module_id=2, is_enabled=1),
                TenantModuleConfig(id=3, tenant_id=99, module_id=1, is_enabled=1),
            ]
        )
        self.db.commit()

    def tearDown(self):
        tenant_backup_runs_service.TENANT_BACKUP_UPLOAD_DIR = self.original_backup_dir
        self.temp_dir.cleanup()
        self.db.close()

    def test_get_creates_default_settings_per_tenant(self):
        settings = get_or_create_tenant_backup_settings(self.db, tenant_id=10, actor_user_id=1)

        self.assertEqual(settings.tenant_id, 10)
        self.assertFalse(settings.enabled)
        self.assertEqual(settings.frequency, "manual")
        self.assertEqual(settings.scope, "full_tenant")
        self.assertEqual(settings.selected_modules, [])
        self.assertEqual(settings.destination, "local_download")
        self.assertIsNone(settings.next_run_at)

    def test_update_selected_modules_is_tenant_scoped_and_audited(self):
        settings = update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "enabled": True,
                "frequency": "daily",
                "scope": "selected_modules",
                "selected_modules": ["sales_contacts", "documents", "sales_contacts"],
                "retention_count": 7,
                "destination": "local_download",
                "include_documents": False,
            },
        )

        self.assertEqual(settings.tenant_id, 10)
        self.assertEqual(settings.selected_modules, ["sales_contacts", "documents"])
        self.assertEqual(settings.retention_count, 7)
        self.assertFalse(settings.include_documents)
        self.assertIsNotNone(settings.next_run_at)
        self.assertEqual(self.db.query(TenantBackupSettings).filter(TenantBackupSettings.tenant_id == 99).count(), 0)

        activity = self.db.query(ActivityLog).one()
        self.assertEqual(activity.tenant_id, 10)
        self.assertEqual(activity.action, "backup.settings.updated")
        self.assertEqual(activity.module_key, "tenant_backups")

    def test_full_tenant_scope_clears_selected_modules(self):
        settings = update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "scope": "full_tenant",
                "selected_modules": ["sales_contacts"],
            },
        )

        self.assertEqual(settings.scope, "full_tenant")
        self.assertEqual(settings.selected_modules, [])

    def test_invalid_destination_is_rejected(self):
        with self.assertRaises(HTTPException) as ctx:
            update_tenant_backup_settings(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={"destination": "s3"},
            )

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("destination", ctx.exception.detail)

    def test_cloud_destination_requires_connected_admin_storage(self):
        with self.assertRaises(HTTPException) as ctx:
            update_tenant_backup_settings(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={"destination": "google_drive"},
            )

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Google Drive", ctx.exception.detail)

    def test_cloud_destination_accepts_connected_admin_storage(self):
        self.db.add(
            DocumentStorageConnection(
                id=1,
                tenant_id=10,
                user_id=1,
                provider="google_drive",
                status="connected",
                account_email="owner@example.com",
                access_token="encrypted",
                refresh_token="encrypted",
            )
        )
        self.db.commit()

        settings = update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"destination": "google_drive"},
        )

        self.assertEqual(settings.destination, "google_drive")

    def test_destination_connections_are_tenant_and_user_scoped_without_tokens(self):
        self.db.add_all(
            [
                DocumentStorageConnection(
                    id=1,
                    tenant_id=10,
                    user_id=1,
                    provider="google_drive",
                    status="connected",
                    account_email="owner@example.com",
                    access_token="secret-access",
                    refresh_token="secret-refresh",
                ),
                DocumentStorageConnection(
                    id=2,
                    tenant_id=99,
                    user_id=2,
                    provider="google_drive",
                    status="connected",
                    account_email="other@example.com",
                    access_token="other-secret",
                    refresh_token="other-secret",
                ),
            ]
        )
        self.db.commit()

        connections = list_tenant_backup_destination_connections(self.db, tenant_id=10, actor_user_id=1)

        self.assertEqual(len(connections), 1)
        self.assertEqual(connections[0]["destination"], "google_drive")
        self.assertEqual(connections[0]["account_email"], "owner@example.com")
        self.assertNotIn("access_token", connections[0])
        self.assertNotIn("refresh_token", connections[0])

    def test_selected_modules_requires_known_module_key(self):
        with self.assertRaises(HTTPException) as ctx:
            update_tenant_backup_settings(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={
                    "scope": "selected_modules",
                    "selected_modules": ["missing_module"],
                },
            )

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("Unknown module key", ctx.exception.detail)

    def test_manual_backup_run_creates_tenant_only_zip_artifact(self):
        self.db.add_all(
            [
                SalesContact(
                    contact_id=1,
                    tenant_id=10,
                    first_name="Tenant",
                    last_name="Contact",
                    primary_email="tenant@example.com",
                    assigned_to=1,
                ),
                SalesContact(
                    contact_id=2,
                    tenant_id=99,
                    first_name="Other",
                    last_name="Contact",
                    primary_email="other@example.com",
                    assigned_to=2,
                ),
            ]
        )
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "scope": "selected_modules",
                "selected_modules": ["sales_contacts"],
                "retention_count": 3,
                "include_documents": False,
            },
        )

        run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)

        self.assertEqual(run.status, "completed")
        self.assertEqual(run.backup_type, "tenant")
        self.assertEqual(run.modules_included, ["sales_contacts"])
        self.assertTrue(run.file_path)
        with zipfile.ZipFile(run.file_path) as zipf:
            metadata = json.loads(zipf.read("metadata.json"))
            contacts = json.loads(zipf.read("modules/sales_contacts.json"))

        self.assertEqual(metadata["backup_type"], "tenant")
        self.assertEqual(metadata["tenant_id"], "10")
        self.assertEqual(metadata["module_list"], ["sales_contacts"])
        self.assertEqual(metadata["record_counts"]["sales_contacts"], 1)
        self.assertEqual([row["contact_id"] for row in contacts], [1])
        self.assertEqual(self.db.query(TenantBackupSettings).filter(TenantBackupSettings.tenant_id == 10).one().last_run_at, run.completed_at)

    def test_manual_backup_run_uploads_to_connected_cloud_destination(self):
        self.db.add_all(
            [
                SalesContact(
                    contact_id=1,
                    tenant_id=10,
                    first_name="Tenant",
                    last_name="Contact",
                    primary_email="tenant@example.com",
                    assigned_to=1,
                ),
                DocumentStorageConnection(
                    id=1,
                    tenant_id=10,
                    user_id=1,
                    provider="google_drive",
                    status="connected",
                    account_email="owner@example.com",
                    access_token="encrypted",
                    refresh_token="encrypted",
                ),
            ]
        )
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "scope": "selected_modules",
                "selected_modules": ["sales_contacts"],
                "destination": "google_drive",
                "include_documents": False,
            },
        )

        def fake_upload(_db, **kwargs):
            self.assertEqual(kwargs["tenant_id"], 10)
            self.assertEqual(kwargs["user_id"], 1)
            self.assertEqual(kwargs["provider"], "google_drive")
            self.assertTrue(kwargs["filename"].endswith(".zip"))
            self.assertGreater(len(kwargs["content"]), 0)
            return {"provider": "google_drive", "storage_path": "drive-file-id"}

        original_upload = tenant_backup_runs_service.upload_document_storage_artifact
        tenant_backup_runs_service.upload_document_storage_artifact = fake_upload
        try:
            run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)
        finally:
            tenant_backup_runs_service.upload_document_storage_artifact = original_upload

        self.assertEqual(run.status, "completed")
        self.assertEqual(run.destination, "google_drive")
        self.assertEqual(run.destination_upload_status, "uploaded")
        self.assertEqual(run.storage_ref, "google_drive:drive-file-id")
        self.assertTrue(Path(run.file_path).exists())

    def test_manual_backup_run_keeps_local_artifact_when_cloud_upload_fails(self):
        self.db.add_all(
            [
                SalesContact(
                    contact_id=1,
                    tenant_id=10,
                    first_name="Tenant",
                    last_name="Contact",
                    primary_email="tenant@example.com",
                    assigned_to=1,
                ),
                DocumentStorageConnection(
                    id=1,
                    tenant_id=10,
                    user_id=1,
                    provider="microsoft_onedrive",
                    status="connected",
                    account_email="owner@example.com",
                    access_token="encrypted",
                    refresh_token="encrypted",
                ),
            ]
        )
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "scope": "selected_modules",
                "selected_modules": ["sales_contacts"],
                "destination": "onedrive",
                "include_documents": False,
            },
        )

        def failing_upload(**kwargs):
            raise HTTPException(status_code=400, detail="upload unavailable")

        original_upload = tenant_backup_runs_service.upload_document_storage_artifact
        tenant_backup_runs_service.upload_document_storage_artifact = failing_upload
        try:
            run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)
        finally:
            tenant_backup_runs_service.upload_document_storage_artifact = original_upload

        self.assertEqual(run.status, "completed")
        self.assertEqual(run.destination, "onedrive")
        self.assertEqual(run.destination_upload_status, "failed")
        self.assertIn("upload failed", run.error_message)
        self.assertTrue(Path(run.file_path).exists())

    def test_retention_cleanup_expires_old_artifacts_but_keeps_history(self):
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "scope": "selected_modules",
                "selected_modules": ["sales_contacts"],
                "retention_count": 3,
                "include_documents": False,
            },
        )
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="A", last_name="B", primary_email="a@example.com", assigned_to=1))
        self.db.commit()

        runs = [create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1) for _ in range(4)]

        expired = self.db.query(TenantBackupRun).filter(TenantBackupRun.id == runs[0].id).one()
        self.assertEqual(self.db.query(TenantBackupRun).filter(TenantBackupRun.tenant_id == 10).count(), 4)
        self.assertIsNone(expired.file_path)
        self.assertEqual(expired.destination_upload_status, "expired")

    def test_delete_tenant_backup_artifact_keeps_history_and_logs_audit(self):
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "scope": "selected_modules",
                "selected_modules": ["sales_contacts"],
                "retention_count": 3,
                "include_documents": False,
            },
        )
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="A", last_name="B", primary_email="delete@example.com", assigned_to=1))
        self.db.commit()
        run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)
        artifact_path = Path(run.file_path)

        deleted = delete_tenant_backup_artifact(self.db, tenant_id=10, actor_user_id=1, run_id=run.id)

        self.assertFalse(artifact_path.exists())
        self.assertIsNone(deleted.file_path)
        self.assertIsNone(deleted.storage_ref)
        self.assertEqual(deleted.destination_upload_status, "expired")
        self.assertEqual(self.db.query(TenantBackupRun).filter(TenantBackupRun.id == run.id).count(), 1)
        activity = self.db.query(ActivityLog).filter(ActivityLog.action == "backup.deleted").one()
        self.assertEqual(activity.tenant_id, 10)
        self.assertNotIn("file_path", json.dumps(activity.after_state))

    def test_due_tenant_backup_schedule_runs_enabled_non_manual_settings(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="A", last_name="B", primary_email="scheduled@example.com", assigned_to=1))
        self.db.commit()
        settings = update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "enabled": True,
                "frequency": "daily",
                "scope": "selected_modules",
                "selected_modules": ["sales_contacts"],
                "retention_count": 3,
                "include_documents": False,
            },
        )
        due_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        settings.next_run_at = due_at
        self.db.commit()

        result = run_due_tenant_backup_schedules(self.db, now=datetime.now(timezone.utc))

        self.assertEqual(result["scanned"], 1)
        self.assertEqual(result["started"], 1)
        self.assertEqual(result["completed"], 1)
        run = self.db.query(TenantBackupRun).filter(TenantBackupRun.tenant_id == 10).one()
        self.assertEqual(run.status, "completed")
        refreshed = self.db.query(TenantBackupSettings).filter(TenantBackupSettings.tenant_id == 10).one()
        self.assertIsNotNone(refreshed.next_run_at)
        self.assertGreater(refreshed.next_run_at.replace(tzinfo=timezone.utc), due_at)

    def test_due_tenant_backup_schedule_ignores_manual_frequency(self):
        settings = update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={
                "enabled": True,
                "frequency": "manual",
                "scope": "selected_modules",
                "selected_modules": ["sales_contacts"],
                "include_documents": False,
            },
        )
        settings.next_run_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        self.db.commit()

        result = run_due_tenant_backup_schedules(self.db, now=datetime.now(timezone.utc))

        self.assertEqual(result["scanned"], 0)
        self.assertEqual(self.db.query(TenantBackupRun).count(), 0)

    def test_restore_preview_validates_tenant_backup_and_counts_conflicts(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="Tenant", last_name="Contact", primary_email="tenant@example.com", assigned_to=1))
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"scope": "selected_modules", "selected_modules": ["sales_contacts"], "include_documents": False},
        )
        backup_run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)

        result = preview_tenant_module_restore(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            source_backup_run_id=backup_run.id,
            module_key="sales_contacts",
        )

        self.assertEqual(result["summary"]["total_rows"], 1)
        self.assertEqual(result["summary"]["existing_matches"], 1)
        self.assertEqual(result["metadata"]["backup_type"], "tenant")
        restore_run = self.db.query(TenantRestoreRun).one()
        self.assertEqual(restore_run.status, "previewed")
        self.assertEqual(restore_run.tenant_id, 10)

    def test_restore_update_existing_updates_only_current_tenant_rows(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="Backup", last_name="Contact", primary_email="backup@example.com", assigned_to=1))
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"scope": "selected_modules", "selected_modules": ["sales_contacts"], "include_documents": False},
        )
        backup_run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)
        contact = self.db.query(SalesContact).filter(SalesContact.tenant_id == 10, SalesContact.contact_id == 1).one()
        contact.first_name = "Changed"
        self.db.add(SalesContact(contact_id=2, tenant_id=99, first_name="Other", last_name="Contact", primary_email="other-restore@example.com", assigned_to=2))
        self.db.commit()

        restore_run = execute_tenant_module_restore(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            source_backup_run_id=backup_run.id,
            module_key="sales_contacts",
            mode="update_existing",
        )

        restored = self.db.query(SalesContact).filter(SalesContact.tenant_id == 10, SalesContact.contact_id == 1).one()
        other = self.db.query(SalesContact).filter(SalesContact.tenant_id == 99, SalesContact.contact_id == 2).one()
        self.assertEqual(restore_run.status, "completed")
        self.assertEqual(restore_run.summary["updated"], 1)
        self.assertEqual(restored.first_name, "Backup")
        self.assertEqual(other.first_name, "Other")

    def test_replace_restore_requires_confirmation(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="Backup", last_name="Contact", primary_email="backup@example.com", assigned_to=1))
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"scope": "selected_modules", "selected_modules": ["sales_contacts"], "include_documents": False},
        )
        backup_run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)

        with self.assertRaises(HTTPException) as ctx:
            execute_tenant_module_restore(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                source_backup_run_id=backup_run.id,
                module_key="sales_contacts",
                mode="replace_module_data",
            )

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("REPLACE sales_contacts", ctx.exception.detail)

    def test_restore_rejects_cross_tenant_backup_metadata(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="Tenant", last_name="Contact", primary_email="tenant-cross@example.com", assigned_to=1))
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"scope": "selected_modules", "selected_modules": ["sales_contacts"], "include_documents": False},
        )
        backup_run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)
        with zipfile.ZipFile(backup_run.file_path) as zipf:
            metadata = json.loads(zipf.read("metadata.json"))
        metadata["tenant_id"] = "99"
        _replace_zip_json(backup_run.file_path, "metadata.json", metadata)

        with self.assertRaises(HTTPException) as ctx:
            preview_tenant_module_restore(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                source_backup_run_id=backup_run.id,
                module_key="sales_contacts",
            )

        self.assertEqual(ctx.exception.status_code, 403)

    def test_whole_tenant_restore_preview_requires_full_tenant_backup(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="Tenant", last_name="Contact", primary_email="tenant-selected@example.com", assigned_to=1))
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"scope": "selected_modules", "selected_modules": ["sales_contacts"], "include_documents": False},
        )
        backup_run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)

        with self.assertRaises(HTTPException) as ctx:
            preview_whole_tenant_restore(self.db, tenant_id=10, actor_user_id=1, source_backup_run_id=backup_run.id)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("full-tenant backup", ctx.exception.detail)

    def test_whole_tenant_restore_preview_summarizes_modules(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="Tenant", last_name="Contact", primary_email="tenant-whole-preview@example.com", assigned_to=1))
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"scope": "full_tenant", "include_documents": False},
        )
        backup_run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)

        result = preview_whole_tenant_restore(self.db, tenant_id=10, actor_user_id=1, source_backup_run_id=backup_run.id)

        self.assertEqual(result["run"].restore_type, "tenant_whole")
        self.assertIn("sales_contacts", result["summary"]["modules"])
        self.assertEqual(result["summary"]["modules"]["sales_contacts"]["total_rows"], 1)

    def test_whole_tenant_restore_requires_strong_confirmation(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="Tenant", last_name="Contact", primary_email="tenant-confirm@example.com", assigned_to=1))
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"scope": "full_tenant", "include_documents": False},
        )
        backup_run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)

        with self.assertRaises(HTTPException) as ctx:
            execute_whole_tenant_restore(self.db, tenant_id=10, actor_user_id=1, source_backup_run_id=backup_run.id)

        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("RESTORE TENANT 10", ctx.exception.detail)

    def test_whole_tenant_restore_creates_safety_backup_and_restores_modules(self):
        self.db.add(SalesContact(contact_id=1, tenant_id=10, first_name="Backup", last_name="Contact", primary_email="tenant-whole@example.com", assigned_to=1))
        self.db.commit()
        update_tenant_backup_settings(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"scope": "full_tenant", "include_documents": False},
        )
        source_run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)
        contact = self.db.query(SalesContact).filter(SalesContact.tenant_id == 10, SalesContact.contact_id == 1).one()
        contact.first_name = "Changed"
        self.db.commit()

        restore_run = execute_whole_tenant_restore(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            source_backup_run_id=source_run.id,
            confirmation="RESTORE TENANT 10",
        )

        restored = self.db.query(SalesContact).filter(SalesContact.tenant_id == 10, SalesContact.contact_id == 1).one()
        self.assertEqual(restore_run.status, "completed")
        self.assertEqual(restore_run.restore_type, "tenant_whole")
        self.assertEqual(restore_run.summary["updated"], 1)
        self.assertEqual(restored.first_name, "Backup")
        safety_run_id = restore_run.summary["safety_backup_run_id"]
        safety_run = self.db.query(TenantBackupRun).filter(TenantBackupRun.id == safety_run_id).one()
        self.assertEqual(safety_run.scope, "full_tenant")
        self.assertEqual(safety_run.destination, "local_download")


if __name__ == "__main__":
    unittest.main()
