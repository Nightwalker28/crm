"""Field rules: an administrator's required and read-only standard fields (13b Phase 4, F3.4)."""

import unittest
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.models import FieldDefinition, ModuleFieldConfig, RecordLayoutDefinition
from app.modules.platform.schema import ModuleFieldConfigUpdateRequest
from app.modules.platform.services.module_fields import (
    enforce_field_rules,
    module_field_rules,
    update_module_field_config,
)
from app.modules.platform.services.record_layouts import resolve_record_layout
from app.modules.user_management.models import Tenant


class FieldRulesTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(
            engine,
            tables=[
                Tenant.__table__,
                FieldDefinition.__table__,
                ModuleFieldConfig.__table__,
                RecordLayoutDefinition.__table__,
            ],
        )
        self.db = sessionmaker(bind=engine)()
        self.db.add_all(
            [
                Tenant(id=1, slug="tenant-one", name="Tenant One"),
                Tenant(id=2, slug="tenant-two", name="Tenant Two"),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _set(self, field_key, tenant_id=1, module_key="sales_leads", **rules):
        # SQLite does not autoincrement a BigInteger key, so the row gets an id up front.
        exists = (
            self.db.query(ModuleFieldConfig)
            .filter_by(tenant_id=tenant_id, module_key=module_key, field_key=field_key)
            .first()
        )
        if exists is None:
            self.db.add(
                ModuleFieldConfig(
                    id=self.db.query(ModuleFieldConfig).count() + 1,
                    tenant_id=tenant_id,
                    module_key=module_key,
                    field_key=field_key,
                    label=field_key.title(),
                    is_enabled=True,
                )
            )
            self.db.commit()
        return update_module_field_config(
            self.db,
            tenant_id=tenant_id,
            module_key=module_key,
            field_key=field_key,
            payload=ModuleFieldConfigUpdateRequest(label=field_key.replace("_", " ").title(), **rules),
        )

    def test_rules_are_stored_and_returned(self):
        saved = self._set("company", is_required=True)
        self.assertTrue(saved.is_required)
        self.assertFalse(saved.is_readonly)
        rules = module_field_rules(self.db, tenant_id=1, module_key="sales_leads")
        self.assertTrue(rules["company"].required)

    def test_impossible_combinations_are_refused_and_leave_the_session_clean(self):
        self._set("company", is_required=True)
        with self.assertRaises(HTTPException) as both:
            self._set("company", is_readonly=True)
        self.assertEqual(both.exception.status_code, 400)
        with self.assertRaises(HTTPException) as hidden:
            self._set("company", is_enabled=False)
        self.assertEqual(hidden.exception.status_code, 400)
        config = self.db.query(ModuleFieldConfig).filter_by(field_key="company").one()
        self.assertTrue(config.is_required)
        self.assertFalse(config.is_readonly)
        self.assertTrue(config.is_enabled)

    def test_protected_and_custom_fields_cannot_take_standard_rules(self):
        with self.assertRaises(HTTPException):
            self._set("org_name", module_key="sales_organizations", is_readonly=True)
        with self.assertRaises(HTTPException):
            self._set("custom:budget", is_required=True)

    def test_create_requires_and_drops_read_only(self):
        self._set("company", is_required=True)
        self._set("notes", is_readonly=True)
        with self.assertRaises(HTTPException) as missing:
            enforce_field_rules(self.db, tenant_id=1, module_key="sales_leads", payload={"first_name": "Ada", "company": "  "})
        self.assertEqual(missing.exception.status_code, 422)
        self.assertIn("Company", missing.exception.detail)

        result = enforce_field_rules(
            self.db,
            tenant_id=1,
            module_key="sales_leads",
            payload={"first_name": "Ada", "company": "CTO", "notes": "typed anyway"},
        )
        self.assertEqual(result, {"first_name": "Ada", "company": "CTO"})

    def test_update_refuses_emptying_required_and_changing_read_only(self):
        self._set("company", is_required=True)
        self._set("notes", is_readonly=True)
        lead = SimpleNamespace(company="Acme", notes="kept")

        # A partial update that leaves the required field alone passes.
        self.assertEqual(
            enforce_field_rules(self.db, tenant_id=1, module_key="sales_leads", payload={"phone": "1"}, existing=lead),
            {"phone": "1"},
        )
        with self.assertRaises(HTTPException):
            enforce_field_rules(self.db, tenant_id=1, module_key="sales_leads", payload={"company": ""}, existing=lead)
        with self.assertRaises(HTTPException) as changed:
            enforce_field_rules(self.db, tenant_id=1, module_key="sales_leads", payload={"notes": "edited"}, existing=lead)
        self.assertIn("Read-only", changed.exception.detail)
        # A full form sends the unchanged read-only value back; it is dropped, not refused.
        self.assertEqual(
            enforce_field_rules(
                self.db, tenant_id=1, module_key="sales_leads", payload={"notes": "kept", "company": "CEO"}, existing=lead
            ),
            {"company": "CEO"},
        )

    def test_rules_are_tenant_scoped(self):
        self._set("company", is_required=True)
        self.assertEqual(module_field_rules(self.db, tenant_id=2, module_key="sales_leads"), {})
        self.assertEqual(
            enforce_field_rules(self.db, tenant_id=2, module_key="sales_leads", payload={"first_name": "Ada"}),
            {"first_name": "Ada"},
        )

    def test_layouts_show_rules_and_quick_create_gains_a_newly_required_field(self):
        self._set("notes", is_required=True)
        self._set("source", is_readonly=True)
        quick = resolve_record_layout(self.db, tenant_id=1, module_key="sales_leads", surface="quick_create")
        fields = {field.field_key: field for section in quick.sections for field in section.fields}
        self.assertTrue(fields["notes"].required)
        self.assertTrue(fields["source"].readonly)

        other = resolve_record_layout(self.db, tenant_id=2, module_key="sales_leads", surface="quick_create")
        other_keys = {field.field_key for section in other.sections for field in section.fields}
        self.assertNotIn("notes", other_keys)


    def test_erp_writes_check_only_what_the_client_sent(self):
        """Orders and ERP documents dump their whole request model on update (13b Phase 4c)."""
        from unittest.mock import patch

        from app.modules.platform.services.write_rules import apply_user_write_rules

        self._set("reference", module_key="purchase_orders", is_readonly=True)
        self._set("vendor_notes", module_key="purchase_orders", is_required=True)
        order = SimpleNamespace(reference="PO-REF-1", vendor_notes="Net 30")
        with patch("app.modules.platform.services.write_rules.enforce_picklist_dependencies", side_effect=lambda db, **kw: kw["payload"]):
            # `reference` defaulted to None and `vendor_notes` was not sent: neither counts.
            result = apply_user_write_rules(
                self.db, tenant_id=1, module_key="purchase_orders",
                payload={"reference": None, "vendor_notes": None, "expected_date": "2026-10-10"},
                existing=order, record_id=7, submitted_keys={"expected_date"},
            )
            self.assertEqual(result["expected_date"], "2026-10-10")
            with self.assertRaises(HTTPException):
                apply_user_write_rules(
                    self.db, tenant_id=1, module_key="purchase_orders",
                    payload={"reference": "PO-REF-2"}, existing=order, record_id=7, submitted_keys={"reference"},
                )
            with self.assertRaises(HTTPException):
                apply_user_write_rules(self.db, tenant_id=1, module_key="purchase_orders", payload={"vendor_notes": ""})


    def test_imports_drop_read_only_and_check_required_on_create_and_overwrite(self):
        from app.modules.platform.services.module_fields import ImportFieldRules

        self._set("company", is_required=True)
        self._set("notes", is_readonly=True)
        rules = ImportFieldRules(self.db, tenant_id=1, module_key="sales_leads")
        row = {"first_name": "Ada", "company": "", "notes": "from the file"}
        self.assertIn("Company", rules.apply(dict(row)))
        payload = {"first_name": "Ada", "company": "Acme", "notes": "from the file"}
        self.assertIsNone(rules.apply(payload))
        self.assertNotIn("notes", payload)
        existing = SimpleNamespace(company="Acme")
        self.assertIsNone(rules.apply({"company": ""}, existing=existing))  # merge keeps the stored value
        self.assertIsNotNone(rules.apply({"company": ""}, existing=existing, overwrite=True))
        self.assertIsNone(ImportFieldRules(self.db, tenant_id=2, module_key="sales_leads").apply({"company": ""}))


if __name__ == "__main__":
    unittest.main()
