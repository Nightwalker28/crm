import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.calendar.models import UserCalendarConnection
from app.modules.documents.models import DocumentStorageConnection
from app.modules.finance import models as finance_models  # noqa: F401
from app.modules.mail.models import UserMailConnection
from app.modules.platform.models import DataTransferJob, IntegrationConnection, NotificationChannel, TenantBackupRun, TenantBackupSettings
from app.modules.platform.services.integrations_registry import (
    list_integration_connections,
    list_integration_health,
    list_provider_registry,
    list_sync_runs,
    record_sync_run,
    seed_provider_registry,
    upsert_integration_connection,
)
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.sales import models as sales_models  # noqa: F401
from app.modules.website_integrations.models import WebsiteIntegrationApiKey


class IntegrationsRegistryTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_seed_provider_registry_is_idempotent(self):
        seed_provider_registry(self.db)
        seed_provider_registry(self.db)

        providers = list_provider_registry(self.db)

        self.assertEqual(len(providers), 11)
        self.assertEqual(len({provider.key for provider in providers}), 11)
        self.assertEqual(next(provider for provider in providers if provider.key == "google_mail").metadata_json["config_href"], "/dashboard/settings/integrations")
        self.assertEqual(next(provider for provider in providers if provider.key == "backup_destinations").metadata_json["config_href"], "/dashboard/settings/backups")
        self.assertEqual(next(provider for provider in providers if provider.key == "microsoft_onedrive").metadata_json["source"], "documents")

    def test_health_derives_existing_connections_inside_tenant(self):
        now = datetime.now(timezone.utc)
        self.db.add_all(
            [
                UserMailConnection(id=1, tenant_id=10, user_id=1, provider="google", status="connected", last_synced_at=now),
                UserMailConnection(id=2, tenant_id=99, user_id=2, provider="google", status="connected"),
                UserCalendarConnection(id=1, tenant_id=10, user_id=1, provider="microsoft", status="connected", scopes=["Calendars.ReadWrite"], token_expires_at=now),
                DocumentStorageConnection(id=1, tenant_id=10, user_id=1, provider="microsoft_onedrive", status="connected", scopes=["Files.ReadWrite.AppFolder"]),
                WebsiteIntegrationApiKey(id=1, tenant_id=10, name="WordPress", key_prefix="lynk_live", key_hash="a" * 64, status="active"),
                WebsiteIntegrationApiKey(id=2, tenant_id=99, name="Other", key_prefix="lynk_other", key_hash="b" * 64, status="active"),
                NotificationChannel(id=1, tenant_id=10, provider="slack", webhook_url="https://hooks.slack.example/test", is_active=True),
                DataTransferJob(id=1, tenant_id=10, actor_user_id=1, module_key="calendar", operation_type="sync", status="queued"),
                DataTransferJob(id=2, tenant_id=10, actor_user_id=1, module_key="calendar", operation_type="sync", status="failed", error_message="Calendar queue failed"),
            ]
        )
        self.db.commit()

        health = {item["provider"].key: item["connection"] for item in list_integration_health(self.db, tenant_id=10)}

        self.assertEqual(health["google_mail"]["status"], "connected")
        self.assertEqual(health["google_mail"]["connection_count"], 1)
        self.assertEqual(health["google_mail"]["last_sync_at"], now.replace(tzinfo=None))
        self.assertEqual(health["google_mail"]["credential_state"], "valid")
        self.assertEqual(health["google_mail"]["health_status"], "healthy")
        self.assertEqual(health["microsoft_calendar"]["status"], "reconnect_required")
        self.assertEqual(health["microsoft_calendar"]["credential_state"], "expired")
        self.assertEqual(health["microsoft_calendar"]["health_status"], "reconnect_required")
        self.assertEqual(health["microsoft_calendar"]["scopes"], ["Calendars.ReadWrite"])
        self.assertEqual(health["microsoft_calendar"]["queued_jobs"], 1)
        self.assertEqual(health["microsoft_calendar"]["failed_jobs"], 1)
        self.assertIn("Calendar", health["microsoft_calendar"]["help_text"])
        self.assertEqual(health["microsoft_onedrive"]["status"], "connected")
        self.assertEqual(health["microsoft_onedrive"]["scopes"], ["Files.ReadWrite.AppFolder"])
        self.assertEqual(health["website_api"]["connection_count"], 1)
        self.assertEqual(health["slack_webhooks"]["status"], "connected")
        self.assertEqual(health["microsoft_mail"]["status"], "disconnected")

    def test_registry_connections_are_tenant_scoped_and_hide_private_settings(self):
        seed_provider_registry(self.db)
        upsert_integration_connection(
            self.db,
            tenant_id=10,
            provider_key="google_drive",
            status="connected",
            settings_json={"label": "Shared Drive", "scope_summary": "drive.file", "last_failure_reason": "Shared drive permission failed", "access_token": "do-not-return"},
        )
        upsert_integration_connection(self.db, tenant_id=99, provider_key="google_drive", status="connected")

        connections = list_integration_connections(self.db, tenant_id=10)

        self.assertEqual(len(connections), 1)
        self.assertEqual(connections[0]["provider_key"], "google_drive")
        self.assertEqual(
            connections[0]["settings_json"],
            {"label": "Shared Drive", "last_failure_reason": "Shared drive permission failed", "scope_summary": "drive.file"},
        )
        self.assertEqual(connections[0]["scopes"], ["drive.file"])
        self.assertEqual(connections[0]["last_failure_reason"], "Shared drive permission failed")
        self.assertEqual(connections[0]["queued_jobs"], 0)
        self.assertEqual(connections[0]["failed_jobs"], 0)
        self.assertIn("Google Drive", connections[0]["help_text"])

    def test_backup_destination_health_surfaces_runs_and_destination_errors(self):
        now = datetime.now(timezone.utc)
        self.db.add(
            TenantBackupSettings(
                id=1,
                tenant_id=10,
                enabled=True,
                frequency="daily",
                scope="full_tenant",
                selected_modules=[],
                retention_count=3,
                destination="google_drive",
                include_documents=True,
                next_run_at=now,
            )
        )
        self.db.add_all(
            [
                TenantBackupRun(
                    id=1,
                    tenant_id=10,
                    requested_by_user_id=1,
                    settings_id=1,
                    scope="full_tenant",
                    modules_included=[],
                    status="completed",
                    completed_at=now,
                    destination="google_drive",
                    destination_upload_status="uploaded",
                    metadata_json={},
                ),
                TenantBackupRun(
                    id=2,
                    tenant_id=10,
                    requested_by_user_id=1,
                    settings_id=1,
                    scope="full_tenant",
                    modules_included=[],
                    status="failed",
                    error_message="Backup artifact upload failed",
                    destination="google_drive",
                    destination_upload_status="failed",
                    metadata_json={},
                ),
                TenantBackupRun(
                    id=3,
                    tenant_id=99,
                    requested_by_user_id=2,
                    scope="full_tenant",
                    modules_included=[],
                    status="failed",
                    error_message="Other tenant failure",
                    destination="google_drive",
                    destination_upload_status="failed",
                    metadata_json={},
                ),
            ]
        )
        self.db.commit()

        health = {item["provider"].key: item["connection"] for item in list_integration_health(self.db, tenant_id=10)}

        self.assertEqual(health["backup_destinations"]["status"], "error")
        self.assertEqual(health["backup_destinations"]["connection_count"], 1)
        self.assertEqual(health["backup_destinations"]["failed_jobs"], 1)
        self.assertEqual(health["backup_destinations"]["last_failure_reason"], "Backup artifact upload failed")
        self.assertEqual(health["backup_destinations"]["settings_json"]["destination"], "google_drive")
        self.assertIn("backup settings", health["backup_destinations"]["help_text"].lower())

    def test_sync_runs_are_tenant_scoped_and_filterable(self):
        seed_provider_registry(self.db)
        tenant_connection = upsert_integration_connection(self.db, tenant_id=10, provider_key="google_drive", status="connected")
        other_connection = upsert_integration_connection(self.db, tenant_id=99, provider_key="website_api", status="connected")
        expected = record_sync_run(self.db, connection=tenant_connection, status="completed", result_json={"items": 3})
        record_sync_run(self.db, connection=other_connection, status="failed", error_message="nope")

        runs = list_sync_runs(self.db, tenant_id=10, provider_key="google_drive")

        self.assertEqual([run.id for run in runs], [expected.id])
        self.assertEqual(runs[0].result_json, {"items": 3})


if __name__ == "__main__":
    unittest.main()
