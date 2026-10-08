"""13c §3.1 (Step 7, F4 slice 4.1): every ERP document has notes and its own history."""

import unittest
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.modules.inventory.models import InventoryAdjustment, InventoryWarehouse
from app.modules.platform.models import ActivityLog, RecordComment
from app.modules.platform.services.automation_registry import NOTE_MODULE_KEYS
from app.modules.platform.services.record_activity import (
    ACTIVITY_TYPES,
    ADAPTERS,
    DOCUMENT_MODULE_KEYS,
    _fetch_document_history,
    parse_types,
)
from app.modules.platform.services.record_comments import (
    RECORD_COMMENT_MODULES,
    create_record_comment,
    get_record_reference,
)
from tests.test_opportunity_stage_refs import StageRefFixture
from tests.test_sales_pipelines import OTHER_TENANT, TENANT


class DocumentRegistryTests(unittest.TestCase):
    def test_every_document_module_takes_notes(self):
        for module_key in DOCUMENT_MODULE_KEYS:
            config = RECORD_COMMENT_MODULES[module_key]
            self.assertEqual(config["label_field"], "number", module_key)
            self.assertIn("{entity_id}", config["record_path"], module_key)

    def test_documents_get_notes_and_history_only(self):
        for adapter in ADAPTERS:
            expected = adapter.type in {"document", "note"}
            self.assertEqual(adapter.applies("purchase_orders"), expected, adapter.type)

    def test_crm_records_never_get_the_document_source(self):
        adapter = next(adapter for adapter in ADAPTERS if adapter.type == "document")
        for module_key in ("sales_leads", "sales_orders", "finance_pos", "catalog_products"):
            self.assertFalse(adapter.applies(module_key), module_key)
        self.assertTrue(next(a for a in ADAPTERS if a.type == "email").applies("sales_leads"))

    def test_document_is_a_requestable_type(self):
        self.assertIn("document", ACTIVITY_TYPES)
        self.assertEqual(parse_types("document,note"), tuple(t for t in ACTIVITY_TYPES if t in {"document", "note"}))

    def test_automation_can_note_the_documents_it_triggers_on(self):
        for module_key in ("purchase_orders", "purchase_bills", "inventory_deliveries", "finance_payments"):
            self.assertIn(module_key, NOTE_MODULE_KEYS)


class DocumentHistoryTests(StageRefFixture):
    def setUp(self):
        super().setUp()
        self.db.add_all([
            InventoryWarehouse(id=1, tenant_id=TENANT, code="MAIN", name="Main", is_default=1),
            InventoryWarehouse(id=2, tenant_id=OTHER_TENANT, code="MAIN", name="Main", is_default=1),
        ])
        self.db.flush()
        self.db.add_all([
            InventoryAdjustment(id=10, tenant_id=TENANT, number="ADJ-0001", warehouse_id=1, mode="quantity", reason="Count", status="posted"),
            InventoryAdjustment(id=11, tenant_id=OTHER_TENANT, number="ADJ-9999", warehouse_id=2, mode="quantity", reason="Count", status="posted"),
        ])
        self.db.commit()

    def _log(self, *, tenant_id=TENANT, entity_id="10", action="post", description=None, minutes=0):
        self.db.add(ActivityLog(tenant_id=tenant_id, actor_user_id=1, module_key="inventory_adjustments", entity_type="inventory_adjustment",
                                entity_id=entity_id, action=action, description=description,
                                created_at=datetime.now(timezone.utc) + timedelta(minutes=minutes)))

    def _history(self, entity_id="10"):
        return _fetch_document_history(self.db, tenant_id=TENANT, module_key="inventory_adjustments", entity_id=entity_id,
                                       limit=20, cursor=None, viewer_user_id=1)

    def test_every_action_of_this_document_shows_newest_first(self):
        self._log(action="create", description="Create adjustment ADJ-0001", minutes=0)
        self._log(action="post", description="Post adjustment ADJ-0001", minutes=1)
        self._log(action="cancel", description=None, minutes=2)
        self.db.commit()
        items = self._history()
        self.assertEqual([item.title for item in items], ["Cancel", "Post adjustment ADJ-0001", "Create adjustment ADJ-0001"])
        self.assertEqual(items[0].meta, {"action": "cancel"})
        self.assertEqual(items[0].type, "document")

    def test_other_documents_and_tenants_stay_out(self):
        self._log(entity_id="10", description="Mine")
        self._log(entity_id="12", description="Another document")
        self._log(tenant_id=OTHER_TENANT, entity_id="10", description="Another tenant")
        self.db.commit()
        self.assertEqual([item.title for item in self._history()], ["Mine"])

    def test_note_audit_rows_do_not_repeat_the_notes(self):
        self._log(action="comment_added", description="Added a note on ADJ-0001")
        self._log(action="automation.note", description="Added automation note")
        self._log(action="post", description="Posted", minutes=1)
        self.db.commit()
        self.assertEqual([item.title for item in self._history()], ["Posted"])

    def test_a_note_lands_on_the_document_and_never_on_another_tenants(self):
        comment, record = create_record_comment(self.db, tenant_id=TENANT, actor_user_id=1, module_key="inventory_adjustments",
                                                entity_id="10", body="  Counted twice  ")
        self.assertEqual(record.number, "ADJ-0001")
        self.assertEqual(comment.body, "Counted twice")
        self.assertEqual(self.db.query(RecordComment).filter(RecordComment.module_key == "inventory_adjustments").count(), 1)
        with self.assertRaises(HTTPException) as caught:
            get_record_reference(self.db, tenant_id=TENANT, module_key="inventory_adjustments", entity_id="11")
        self.assertEqual(caught.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
