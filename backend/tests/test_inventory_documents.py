import unittest
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.inventory import models as inventory_models  # noqa: F401
from app.modules.inventory.models import InventoryAdjustment, InventoryStockLevel, InventoryStockMove, InventoryTransfer, InventoryWarehouse
from app.modules.inventory.services import document_services as documents
from app.modules.inventory.services.stock_ledger import MoveSpec, post_moves
from app.modules.inventory.services.opening_import import import_opening_stock
from app.modules.platform.models import CrmEvent
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.user_management import models as user_models  # noqa: F401
from app.modules.catalog.models import CatalogProduct
from app.modules.user_management.models import Tenant


class InventoryDocumentTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"), Tenant(id=20, slug="other", name="Other"),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=2, tenant_id=10, name="Lens", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
            CatalogProduct(id=3, tenant_id=20, name="Private", currency="USD", public_unit_price=1, track_inventory=1, stock_quantity=0),
            InventoryWarehouse(id=1, tenant_id=10, code="MAIN", name="Main", is_default=1),
            InventoryWarehouse(id=2, tenant_id=10, code="SIDE", name="Side"),
            InventoryWarehouse(id=3, tenant_id=20, code="MAIN", name="Other", is_default=1),
        ])
        self.db.commit()
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[
            MoveSpec(product_id=1, warehouse_id=1, quantity=Decimal(10), move_type="opening", source_type="catalog_product", source_id=1, source_line_id=1),
            MoveSpec(product_id=2, warehouse_id=1, quantity=Decimal(5), move_type="opening", source_type="catalog_product", source_id=2, source_line_id=2),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def balance(self, product_id=1, warehouse_id=1):
        row = self.db.query(InventoryStockLevel).filter_by(tenant_id=10, product_id=product_id, warehouse_id=warehouse_id).first()
        return Decimal(row.on_hand) if row else Decimal(0)

    def test_count_posts_only_differences_and_reverses(self):
        doc = documents.save_adjustment(self.db, tenant_id=10, actor_user_id=None, payload={
            "warehouse_id": 1, "mode": "count", "reason": "Cycle count", "notes": None,
            "lines": [{"product_id": 1, "counted": Decimal(8)}, {"product_id": 2, "counted": Decimal(5)}],
        })
        self.assertEqual(doc.status, "draft")
        documents.post_adjustment(self.db, tenant_id=10, actor_user_id=None, document_id=doc.id)
        self.assertEqual(self.balance(), Decimal(8))
        self.assertEqual(self.balance(2), Decimal(5))
        moves = self.db.query(InventoryStockMove).filter_by(source_type="inventory_adjustment", source_id=doc.id).all()
        self.assertEqual(len(moves), 1)
        self.assertEqual(Decimal(moves[0].quantity), Decimal(-2))
        documents.cancel_document(self.db, tenant_id=10, actor_user_id=None, kind="adjustments", document_id=doc.id, reason="Wrong count")
        self.assertEqual(self.balance(), Decimal(10))
        self.assertEqual(self.db.get(InventoryAdjustment, doc.id).status, "cancelled")
        with self.assertRaises(HTTPException) as error:
            documents.cancel_document(self.db, tenant_id=10, actor_user_id=None, kind="adjustments", document_id=doc.id, reason="Again")
        self.assertEqual(error.exception.status_code, 409)

    def test_count_rejects_stale_snapshot(self):
        doc = documents.save_adjustment(self.db, tenant_id=10, actor_user_id=None, payload={
            "warehouse_id": 1, "mode": "count", "reason": "Count", "notes": None,
            "lines": [{"product_id": 1, "counted": Decimal(8)}],
        })
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(product_id=1, warehouse_id=1, quantity=Decimal(-1), move_type="adjustment", source_type="inventory_adjustment", source_id=999, source_line_id=999)])
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            documents.post_adjustment(self.db, tenant_id=10, actor_user_id=None, document_id=doc.id)
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        self.assertEqual(self.balance(), Decimal(9))
        self.assertEqual(self.db.get(InventoryAdjustment, doc.id).status, "draft")
        # Saving the draft again refreshes the snapshot, and the count then posts against it.
        refreshed = documents.save_adjustment(self.db, tenant_id=10, actor_user_id=None, document_id=doc.id, payload={
            "warehouse_id": 1, "mode": "count", "reason": "Count", "notes": None,
            "lines": [{"product_id": 1, "counted": Decimal(8)}],
        })
        self.assertEqual((Decimal(refreshed.lines[0].expected), Decimal(refreshed.lines[0].delta)), (Decimal(9), Decimal(-1)))
        documents.post_adjustment(self.db, tenant_id=10, actor_user_id=None, document_id=doc.id)
        self.assertEqual(self.balance(), Decimal(8))

    def test_transfer_posts_two_legs_and_cancel_refuses_consumed_destination(self):
        doc = documents.save_transfer(self.db, tenant_id=10, actor_user_id=None, payload={
            "from_warehouse_id": 1, "to_warehouse_id": 2, "notes": "Move stock",
            "lines": [{"product_id": 1, "quantity": Decimal(4)}],
        })
        documents.post_transfer(self.db, tenant_id=10, actor_user_id=None, document_id=doc.id)
        self.assertEqual((self.balance(), self.balance(warehouse_id=2)), (Decimal(6), Decimal(4)))
        self.assertEqual(Decimal(self.db.get(CatalogProduct, 1).stock_quantity), Decimal(10))
        moves = self.db.query(InventoryStockMove).filter_by(source_type="inventory_transfer", source_id=doc.id).all()
        self.assertEqual({move.move_type for move in moves}, {"transfer_out", "transfer_in"})
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(product_id=1, warehouse_id=2, quantity=Decimal(-4), move_type="adjustment", source_type="inventory_adjustment", source_id=999, source_line_id=999)])
        self.db.commit()
        with self.assertRaises(HTTPException) as error:
            documents.cancel_document(self.db, tenant_id=10, actor_user_id=None, kind="transfers", document_id=doc.id, reason="Undo")
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        self.assertEqual(self.db.get(InventoryTransfer, doc.id).status, "posted")
        self.assertEqual((self.balance(), self.balance(warehouse_id=2)), (Decimal(6), Decimal(0)))

    def test_transfer_cancel_restores_both_warehouses(self):
        doc = documents.save_transfer(self.db, tenant_id=10, actor_user_id=None, payload={
            "from_warehouse_id": 1, "to_warehouse_id": 2, "notes": None,
            "lines": [{"product_id": 1, "quantity": Decimal(4)}],
        })
        documents.post_transfer(self.db, tenant_id=10, actor_user_id=None, document_id=doc.id)
        documents.cancel_document(self.db, tenant_id=10, actor_user_id=None, kind="transfers", document_id=doc.id, reason="Returned")
        self.assertEqual((self.balance(), self.balance(warehouse_id=2)), (Decimal(10), Decimal(0)))
        self.assertEqual(self.db.get(InventoryTransfer, doc.id).status, "cancelled")

    def test_cross_tenant_links_and_draft_recovery(self):
        payload = {"from_warehouse_id": 1, "to_warehouse_id": 2, "notes": None, "lines": [{"product_id": 3, "quantity": Decimal(1)}]}
        with self.assertRaises(HTTPException) as error:
            documents.save_transfer(self.db, tenant_id=10, actor_user_id=None, payload=payload)
        self.assertEqual(error.exception.status_code, 404)
        self.db.rollback()
        payload["lines"] = [{"product_id": 1, "quantity": Decimal(1)}]
        doc = documents.save_transfer(self.db, tenant_id=10, actor_user_id=None, payload=payload)
        documents.delete_draft(self.db, tenant_id=10, actor_user_id=None, kind="transfers", document_id=doc.id)
        self.assertIsNotNone(self.db.get(InventoryTransfer, doc.id).deleted_at)
        documents.restore_draft(self.db, tenant_id=10, actor_user_id=None, kind="transfers", document_id=doc.id)
        self.assertIsNone(self.db.get(InventoryTransfer, doc.id).deleted_at)

    def test_removed_draft_is_listed_and_restored_from_the_recycle_bin(self):
        from types import SimpleNamespace
        from app.core.pagination import create_pagination
        from app.modules.platform.services.recycle_bin import list_recycle_items, restore_recycle_item

        doc = documents.save_adjustment(self.db, tenant_id=10, actor_user_id=None, payload={
            "warehouse_id": 1, "mode": "quantity", "reason": "Shrinkage", "notes": None,
            "lines": [{"product_id": 1, "delta": Decimal(-1)}],
        })
        documents.delete_draft(self.db, tenant_id=10, actor_user_id=None, kind="adjustments", document_id=doc.id)
        listed = list_recycle_items(self.db, pagination=create_pagination(1, 25), module_key="inventory_adjustments", tenant_id=10)
        self.assertEqual([(item["record_id"], item["title"], item["subtitle"]) for item in listed["results"]], [(doc.id, doc.number, "Main")])
        other_tenant = list_recycle_items(self.db, pagination=create_pagination(1, 25), module_key="inventory_adjustments", tenant_id=20)
        self.assertEqual(other_tenant["results"], [])
        with self.assertRaises(HTTPException):
            restore_recycle_item(self.db, module_key="inventory_adjustments", record_id=doc.id, current_user=SimpleNamespace(id=None, tenant_id=20))
        self.db.rollback()
        restored = restore_recycle_item(self.db, module_key="inventory_adjustments", record_id=doc.id, current_user=SimpleNamespace(id=None, tenant_id=10))
        self.assertFalse(restored["is_deleted"])
        self.assertEqual(self.balance(), Decimal(10))

    def test_warehouse_with_a_live_draft_cannot_be_removed(self):
        from app.modules.inventory.services.inventory_services import delete_warehouse

        doc = documents.save_transfer(self.db, tenant_id=10, actor_user_id=None, payload={
            "from_warehouse_id": 1, "to_warehouse_id": 2, "notes": None, "lines": [{"product_id": 1, "quantity": Decimal(1)}],
        })
        with self.assertRaises(HTTPException) as error:
            delete_warehouse(self.db, tenant_id=10, actor_user_id=None, warehouse_id=2)
        self.assertEqual(error.exception.status_code, 409)
        self.db.rollback()
        documents.delete_draft(self.db, tenant_id=10, actor_user_id=None, kind="transfers", document_id=doc.id)
        delete_warehouse(self.db, tenant_id=10, actor_user_id=None, warehouse_id=2)
        self.assertIsNotNone(self.db.get(InventoryWarehouse, 2).deleted_at)

    def test_inventory_backup_set_leaves_the_catalog_alone(self):
        from app.modules.platform.services.tenant_backup_runs import MODULE_CHILD_EXPORTS

        tables = {model.__tablename__ for _name, model in MODULE_CHILD_EXPORTS["inventory_stock"]}
        self.assertFalse({"catalog_products", "catalog_categories"} & tables)
        self.assertIn("inventory_stock_moves", tables)

    def test_draft_edit_replaces_lines_without_touching_stock(self):
        payload = {"from_warehouse_id": 1, "to_warehouse_id": 2, "notes": None, "lines": [{"product_id": 1, "quantity": Decimal(1)}]}
        doc = documents.save_transfer(self.db, tenant_id=10, actor_user_id=None, payload=payload)
        payload["lines"] = [{"product_id": 1, "quantity": Decimal(2)}, {"product_id": 2, "quantity": Decimal(1)}]
        updated = documents.save_transfer(self.db, tenant_id=10, actor_user_id=None, payload=payload, document_id=doc.id)
        self.assertEqual({line.product_id: Decimal(line.quantity) for line in updated.lines}, {1: Decimal(2), 2: Decimal(1)})
        self.assertEqual(self.balance(), Decimal(10))
        self.assertEqual(self.db.query(InventoryStockMove).filter_by(source_type="inventory_transfer").count(), 0)

    def test_low_stock_event_fires_once_until_recovery(self):
        product = self.db.get(CatalogProduct, 1)
        product.reorder_point = Decimal(8)
        self.db.commit()
        for source_id, change in ((101, -2), (102, -1), (103, 4), (104, -4)):
            post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(
                product_id=1, warehouse_id=1, quantity=Decimal(change), move_type="adjustment",
                source_type="inventory_adjustment", source_id=source_id, source_line_id=source_id)])
            self.db.commit()
        events = self.db.query(CrmEvent).filter_by(tenant_id=10, event_type="inventory.stock_low").order_by(CrmEvent.id).all()
        self.assertEqual(len(events), 2)
        self.assertEqual([event.payload["available"] for event in events], ["8.0000", "7.0000"])

    def test_opening_csv_posts_an_adjustment_with_captured_cost(self):
        product = self.db.get(CatalogProduct, 1)
        product.sku = "CAM"
        self.db.commit()
        summary = import_opening_stock(self.db, tenant_id=10, actor_user_id=None, job_id=41,
            file_bytes=b"SKU,warehouse code,quantity,unit cost\nCAM,SIDE,3,17.50\n")
        self.db.commit()
        self.assertEqual(summary["rows"], 1)
        self.assertEqual(self.balance(warehouse_id=2), Decimal(3))
        move = self.db.query(InventoryStockMove).filter_by(tenant_id=10, warehouse_id=2, move_type="opening").one()
        self.assertEqual(Decimal(move.unit_cost), Decimal("17.50"))
        with self.assertRaises(HTTPException):
            import_opening_stock(self.db, tenant_id=10, actor_user_id=None, job_id=42,
                file_bytes=b"SKU,warehouse code,quantity,unit cost\nCAM,SIDE,3,17.50\n")
        self.db.rollback()


if __name__ == "__main__":
    unittest.main()
