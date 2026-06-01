import unittest
from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.finance import models as finance_models  # noqa: F401
from app.modules.mail.models import UserMailConnection
from app.modules.platform.models import IntegrationConnection, NotificationChannel
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

        self.assertEqual(len(providers), 9)
        self.assertEqual(len({provider.key for provider in providers}), 9)
        self.assertEqual(next(provider for provider in providers if provider.key == "google_mail").metadata_json["config_href"], "/dashboard/mail")

    def test_health_derives_existing_connections_inside_tenant(self):
        now = datetime.now(timezone.utc)
        self.db.add_all(
            [
                UserMailConnection(id=1, tenant_id=10, user_id=1, provider="google", status="connected", last_synced_at=now),
                UserMailConnection(id=2, tenant_id=99, user_id=2, provider="google", status="connected"),
                WebsiteIntegrationApiKey(id=1, tenant_id=10, name="WordPress", key_prefix="lynk_live", key_hash="a" * 64, status="active"),
                WebsiteIntegrationApiKey(id=2, tenant_id=99, name="Other", key_prefix="lynk_other", key_hash="b" * 64, status="active"),
                NotificationChannel(id=1, tenant_id=10, provider="slack", webhook_url="https://hooks.slack.example/test", is_active=True),
            ]
        )
        self.db.commit()

        health = {item["provider"].key: item["connection"] for item in list_integration_health(self.db, tenant_id=10)}

        self.assertEqual(health["google_mail"]["status"], "connected")
        self.assertEqual(health["google_mail"]["connection_count"], 1)
        self.assertEqual(health["google_mail"]["last_sync_at"], now.replace(tzinfo=None))
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
            settings_json={"label": "Shared Drive", "access_token": "do-not-return"},
        )
        upsert_integration_connection(self.db, tenant_id=99, provider_key="google_drive", status="connected")

        connections = list_integration_connections(self.db, tenant_id=10)

        self.assertEqual(len(connections), 1)
        self.assertEqual(connections[0]["provider_key"], "google_drive")
        self.assertEqual(connections[0]["settings_json"], {"label": "Shared Drive"})

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
