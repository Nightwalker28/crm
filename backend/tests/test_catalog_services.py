import io
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.catalog.services import service_services as services
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.user_management.models import Tenant


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


class CatalogServiceServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Tenant(id=99, slug="other", name="Other"),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_service_crud_is_tenant_scoped_and_soft_deleted(self):
        service = services.create_service(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "name": "Implementation Package",
                "description": "Setup and onboarding",
                "currency": "usd",
                "public_unit_price": "499.00",
                "is_active": True,
            },
        )
        services.create_service(
            self.db,
            tenant_id=99,
            actor_user_id=None,
            payload={
                "name": "Other Service",
                "public_unit_price": "12.00",
            },
        )

        service = services.update_service(
            self.db,
            service=service,
            actor_user_id=None,
            payload={"description": "Updated setup", "is_active": False},
        )

        listed, total = services.list_services(self.db, tenant_id=10)
        self.assertEqual(total, 1)
        self.assertEqual(listed[0].id, service.id)
        self.assertEqual(listed[0].currency, "USD")
        self.assertEqual(str(listed[0].public_unit_price), "499.0000")
        self.assertEqual(listed[0].description, "Updated setup")
        self.assertEqual(listed[0].is_active, 0)

        active, active_total = services.list_services(self.db, tenant_id=10, include_inactive=False)
        self.assertEqual(active_total, 0)
        self.assertEqual(active, [])

        services.soft_delete_service(self.db, service=service, actor_user_id=None)
        listed, total = services.list_services(self.db, tenant_id=10)
        self.assertEqual(total, 0)
        deleted, deleted_total = services.list_deleted_services(self.db, tenant_id=10)
        self.assertEqual(deleted_total, 1)
        self.assertEqual(deleted[0].id, service.id)

        restored = services.restore_service(self.db, service=deleted[0], actor_user_id=None)
        self.assertIsNone(restored.deleted_at)

    def test_get_service_is_tenant_scoped(self):
        service = services.create_service(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Consulting", "public_unit_price": "99.00"},
        )

        found = services.get_service_or_404(self.db, tenant_id=10, service_id=service.id)
        self.assertEqual(found.id, service.id)

        with self.assertRaises(HTTPException) as exc:
            services.get_service_or_404(self.db, tenant_id=99, service_id=service.id)

        self.assertEqual(exc.exception.status_code, 404)

    async def test_service_media_uses_upload_helper_and_serializes_media_url(self):
        service = services.create_service(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"name": "Design Review", "public_unit_price": "25.00"},
        )
        upload = UploadFile(
            file=io.BytesIO(PNG_BYTES),
            filename="service.png",
            headers=Headers({"content-type": "image/png"}),
        )

        with patch(
            "app.modules.catalog.services.service_services.persist_media_file",
            return_value="media/catalog-services/tenant-10/service-1/service.png",
        ) as persist_mock:
            updated = await services.upload_service_media(
                self.db,
                service=service,
                actor_user_id=1,
                file=upload,
            )

        persist_mock.assert_called_once()
        serialized = services.serialize_service(updated)
        self.assertEqual(serialized["media_url"], "/media/catalog-services/tenant-10/service-1/service.png")
        self.assertEqual(serialized["media_original_filename"], "service.png")

    async def test_service_media_rejects_non_images(self):
        service = services.create_service(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"name": "Design Review", "public_unit_price": "25.00"},
        )
        upload = UploadFile(
            file=io.BytesIO(b"not an image"),
            filename="service.txt",
            headers=Headers({"content-type": "text/plain"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await services.upload_service_media(
                self.db,
                service=service,
                actor_user_id=1,
                file=upload,
            )

        self.assertEqual(exc.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
