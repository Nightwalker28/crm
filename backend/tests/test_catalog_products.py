import io
import unittest
from unittest.mock import patch

from fastapi import HTTPException, UploadFile
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from starlette.datastructures import Headers

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.catalog.services import product_services as services
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.user_management.models import Tenant


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16


class CatalogProductServiceTests(unittest.IsolatedAsyncioTestCase):
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

    def test_product_crud_is_tenant_scoped_and_soft_deleted(self):
        product = services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={
                "name": "Starter Package",
                "sku": "STARTER",
                "currency": "usd",
                "public_unit_price": "99.00",
                "stock_status": "in_stock",
                "stock_quantity": "5",
                "is_active": True,
            },
        )
        services.create_product(
            self.db,
            tenant_id=99,
            actor_user_id=None,
            payload={
                "name": "Other Product",
                "sku": "STARTER",
                "public_unit_price": "12.00",
                "stock_status": "untracked",
            },
        )

        products, total = services.list_products(self.db, tenant_id=10)
        self.assertEqual(total, 1)
        self.assertEqual(products[0].id, product.id)
        self.assertEqual(products[0].currency, "USD")
        self.assertEqual(str(products[0].stock_quantity), "5.0000")

        services.soft_delete_product(self.db, product=product, actor_user_id=None)
        products, total = services.list_products(self.db, tenant_id=10)
        self.assertEqual(total, 0)
        deleted, deleted_total = services.list_deleted_products(self.db, tenant_id=10)
        self.assertEqual(deleted_total, 1)
        self.assertEqual(deleted[0].id, product.id)

        restored = services.restore_product(self.db, product=deleted[0], actor_user_id=None)
        self.assertIsNone(restored.deleted_at)

    def test_soft_deleted_product_slug_can_be_reused_but_restore_conflicts(self):
        original = services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Starter Package", "public_unit_price": "99.00", "stock_status": "untracked"},
        )
        services.soft_delete_product(self.db, product=original, actor_user_id=None)

        replacement = services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Starter Package", "public_unit_price": "109.00", "stock_status": "untracked"},
        )

        self.assertEqual(replacement.slug, original.slug)
        with self.assertRaises(HTTPException) as exc:
            services.restore_product(self.db, product=original, actor_user_id=None)

        self.assertEqual(exc.exception.status_code, 409)
        self.assertIsNotNone(original.deleted_at)

    def test_duplicate_sku_is_rejected_within_tenant_only(self):
        payload = {
            "name": "Starter Package",
            "sku": "DUP",
            "public_unit_price": "99.00",
            "stock_status": "untracked",
        }
        services.create_product(self.db, tenant_id=10, actor_user_id=None, payload=payload)
        services.create_product(self.db, tenant_id=99, actor_user_id=None, payload=payload)

        with self.assertRaises(HTTPException) as exc:
            services.create_product(self.db, tenant_id=10, actor_user_id=None, payload={**payload, "name": "Duplicate"})

        self.assertEqual(exc.exception.status_code, 409)

    def test_direct_service_rejects_invalid_stock_status_and_boolean(self):
        with self.assertRaises(HTTPException) as stock_exc:
            services.create_product(
                self.db,
                tenant_id=10,
                actor_user_id=None,
                payload={"name": "Camera", "public_unit_price": "25.00", "stock_status": "invalid"},
            )
        self.assertEqual(stock_exc.exception.status_code, 400)
        self.assertEqual(stock_exc.exception.detail, "Invalid stock status")

        product = services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Camera", "public_unit_price": "25.00", "stock_status": "untracked"},
        )
        with self.assertRaises(HTTPException) as bool_exc:
            services.update_product(self.db, product=product, actor_user_id=None, payload={"is_public": "false"})

        self.assertEqual(bool_exc.exception.status_code, 400)
        self.assertEqual(bool_exc.exception.detail, "is_public must be a boolean")

    def test_list_products_sorts_before_limit(self):
        services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Basic Camera", "public_unit_price": "25.00", "stock_status": "untracked"},
        )
        services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Pro Camera", "public_unit_price": "250.00", "stock_status": "untracked"},
        )
        services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=None,
            payload={"name": "Mid Camera", "public_unit_price": "125.00", "stock_status": "untracked"},
        )

        products, total = services.list_products(
            self.db,
            tenant_id=10,
            limit=1,
            sort_by="public_unit_price",
            sort_direction="desc",
        )

        self.assertEqual(total, 3)
        self.assertEqual([product.name for product in products], ["Pro Camera"])

    async def test_product_media_uses_upload_helper_and_serializes_media_url(self):
        product = services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"name": "Camera", "public_unit_price": "25.00", "stock_status": "untracked"},
        )
        upload = UploadFile(
            file=io.BytesIO(PNG_BYTES),
            filename="camera.png",
            headers=Headers({"content-type": "image/png"}),
        )

        with patch(
            "app.modules.catalog.services.product_services.persist_media_file",
            return_value="media/catalog-products/tenant-10/product-1/camera.png",
        ) as persist_mock:
            updated = await services.upload_product_media(
                self.db,
                product=product,
                actor_user_id=1,
                file=upload,
            )

        persist_mock.assert_called_once()
        serialized = services.serialize_product(updated)
        self.assertEqual(serialized["media_url"], "/media/catalog-products/tenant-10/product-1/camera.png")
        self.assertEqual(serialized["media_original_filename"], "camera.png")

    async def test_product_media_deletes_new_file_on_commit_failure_only(self):
        product = services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"name": "Camera", "public_unit_price": "25.00", "stock_status": "untracked"},
        )
        product.media_path = "media/catalog-products/tenant-10/product-1/old.png"
        self.db.add(product)
        self.db.commit()
        upload = UploadFile(
            file=io.BytesIO(PNG_BYTES),
            filename="camera.png",
            headers=Headers({"content-type": "image/png"}),
        )

        with patch(
            "app.modules.catalog.services.product_services.persist_media_file",
            return_value="media/catalog-products/tenant-10/product-1/new.png",
        ), patch.object(self.db, "commit", side_effect=RuntimeError("commit failed")), patch(
            "app.modules.catalog.services.product_services.delete_local_media_file"
        ) as delete_mock:
            with self.assertRaisesRegex(RuntimeError, "commit failed"):
                await services.upload_product_media(
                    self.db,
                    product=product,
                    actor_user_id=1,
                    file=upload,
                )

        delete_mock.assert_called_once_with("media/catalog-products/tenant-10/product-1/new.png")

    async def test_product_media_rejects_non_images(self):
        product = services.create_product(
            self.db,
            tenant_id=10,
            actor_user_id=1,
            payload={"name": "Camera", "public_unit_price": "25.00", "stock_status": "untracked"},
        )
        upload = UploadFile(
            file=io.BytesIO(b"not an image"),
            filename="camera.txt",
            headers=Headers({"content-type": "text/plain"}),
        )

        with self.assertRaises(HTTPException) as exc:
            await services.upload_product_media(
                self.db,
                product=product,
                actor_user_id=1,
                file=upload,
            )

        self.assertEqual(exc.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
