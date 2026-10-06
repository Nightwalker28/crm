"""The one field system (13b Phase 2): types, storage, references, rules and custom modules."""

import unittest
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import field_types
from app.core.database import Base
from app.core.field_types import FieldContext, FieldValueError
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.custom_modules_schema import CustomModuleRecordRequest
from app.modules.platform.models import CustomModuleDefinition, CustomModuleRecord, FieldDefinition, FieldValue
from app.modules.platform.schema import CustomFieldDefinitionCreateRequest
from app.modules.platform.services import custom_fields, custom_modules, picklists
from app.modules.sales.models import SalesLead, SalesOrganization
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Tenant, User, UserStatus


def shape(field_type: str, **extra):
    defaults = {"label": "Field", "field_key": "field", "config": None, "lookup_module_key": None, "picklist_key": None}
    return SimpleNamespace(field_type=field_type, **{**defaults, **extra})


class FieldTypeTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([Tenant(id=10, slug="t", name="T"), Tenant(id=20, slug="o", name="O"),
                         User(id=1, tenant_id=10, email="a@example.com", first_name="Ann", is_active=UserStatus.active)])
        self.db.commit()
        self.ctx = FieldContext(self.db, 10)

    def tearDown(self):
        self.db.close()

    def test_every_type_has_a_storage_column(self):
        for key in field_types.FIELD_TYPES:
            self.assertIn(field_types.storage_column(key), field_types.STORAGE_COLUMNS.values())
        self.assertEqual(field_types.field_type("textarea").key, "long_text")

    def test_numbers_dates_and_booleans_normalize_or_refuse(self):
        self.assertEqual(field_types.normalize(shape("currency"), "1,234.5", self.ctx), Decimal("1234.50"))
        self.assertEqual(field_types.normalize(shape("percent"), "12.5%", self.ctx), Decimal("12.5"))
        self.assertEqual(field_types.normalize(shape("date"), "2026-10-06", self.ctx), date(2026, 10, 6))
        self.assertTrue(field_types.normalize(shape("boolean"), "yes", self.ctx))
        with self.assertRaises(FieldValueError):
            field_types.normalize(shape("number"), "2.5", self.ctx)
        with self.assertRaises(FieldValueError):
            field_types.normalize(shape("number", config={"max": 10}), "11", self.ctx)
        with self.assertRaises(FieldValueError):
            field_types.normalize(shape("email"), "not-an-email", self.ctx)
        with self.assertRaises(FieldValueError):
            field_types.normalize(shape("url"), "example.com", self.ctx)

    def test_picklists_and_multi_picklists_store_keys(self):
        self.assertEqual(field_types.normalize(shape("picklist", picklist_key="industry"), "Retail", self.ctx), "retail")
        self.assertEqual(
            field_types.normalize(shape("multi_picklist", picklist_key="lead_source"), "Website; Referral; website", self.ctx),
            ["website", "referral"],
        )
        with self.assertRaises(FieldValueError):
            field_types.normalize(shape("picklist", picklist_key="industry"), "Space mining", self.ctx)

    def test_references_stay_inside_the_tenant(self):
        self.db.add_all([SalesOrganization(org_id=5, tenant_id=10, org_name="Acme"), SalesOrganization(org_id=6, tenant_id=20, org_name="Other")])
        self.db.commit()
        lookup = shape("lookup", lookup_module_key="sales_organizations")
        self.assertEqual(field_types.normalize(lookup, {"id": 5}, self.ctx), 5)
        with self.assertRaises(FieldValueError):
            field_types.normalize(lookup, 6, self.ctx)
        self.assertEqual(field_types.normalize(shape("user"), "1", self.ctx), 1)
        labels = field_types.reference_labels(self.db, 10, {"sales_organizations": {5}, "users": {1}})
        self.assertEqual(labels[("sales_organizations", 5)], "Acme")
        self.assertEqual(labels[("users", 1)], "Ann")


class CustomFieldServiceTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([Tenant(id=10, slug="t", name="T")])
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def _field(self, **payload):
        return custom_fields.create_custom_field_definition(
            self.db, tenant_id=10, module_key=payload.pop("module_key", "sales_leads"),
            payload=CustomFieldDefinitionCreateRequest(**payload),
        )

    def test_create_supports_every_module_and_a_local_picklist(self):
        field = self._field(label="Tier", field_type="picklist", picklist_values=["Gold", "Silver"], module_key="purchase_orders")
        self.assertEqual(field.picklist_key, "tier")
        self.assertEqual([value.key for value in picklists.get_picklist(self.db, 10, "tier").values], ["gold", "silver"])
        with self.assertRaises(HTTPException):
            self._field(label="Nowhere", field_type="text", module_key="not_a_module")
        with self.assertRaises(HTTPException):
            self._field(label="Lookup", field_type="lookup", lookup_module_key="sales_leads")

    def test_values_round_trip_required_unique_and_auto_number(self):
        self._field(label="Budget", field_type="currency")
        self._field(label="Code", field_type="text", is_unique=True)
        self._field(label="Ref", field_type="auto_number", config={"prefix": "REF"})
        self._field(label="Needed", field_type="text", is_required=True)
        for lead_id in (1, 2):
            self.db.add(SalesLead(lead_id=lead_id, tenant_id=10, primary_email=f"{lead_id}@example.com", status="new"))
        self.db.commit()

        with self.assertRaises(HTTPException) as caught:
            custom_fields.apply_custom_fields(self.db, tenant_id=10, module_key="sales_leads", record_id=1,
                                              payload={"budget": "10"}, partial=False)
        self.assertEqual(caught.exception.detail[0]["loc"], ["body", "custom_fields", "needed"])

        values = custom_fields.apply_custom_fields(self.db, tenant_id=10, module_key="sales_leads", record_id=1,
                                                   payload={"budget": "10", "code": "A1", "needed": "x"}, partial=False)
        self.assertEqual(values["budget"], 10.0)
        self.assertTrue(values["ref"].startswith("REF-"))
        with self.assertRaises(HTTPException):
            custom_fields.apply_custom_fields(self.db, tenant_id=10, module_key="sales_leads", record_id=2,
                                              payload={"code": "A1", "needed": "y"}, partial=False)

        updated = custom_fields.apply_custom_fields(self.db, tenant_id=10, module_key="sales_leads", record_id=1,
                                                    payload={"budget": None}, partial=True)
        self.assertNotIn("budget", updated)
        self.assertEqual(updated["code"], "A1")
        self.assertEqual(updated["ref"], values["ref"], "an auto-number is assigned once")

    def test_system_writes_skip_required_fields(self):
        self._field(label="Needed", field_type="text", is_required=True)
        values = custom_fields.apply_custom_fields(self.db, tenant_id=10, module_key="sales_leads", record_id=3,
                                                   payload=None, partial=False, enforce_required=False)
        self.assertEqual(values, {})

    def test_bulk_load_labels_references_once(self):
        self.db.add(SalesOrganization(org_id=5, tenant_id=10, org_name="Acme"))
        self._field(label="Partner", field_type="lookup", lookup_module_key="sales_organizations")
        custom_fields.apply_custom_fields(self.db, tenant_id=10, module_key="sales_leads", record_id=7, payload={"partner": 5}, partial=False)
        loaded = custom_fields.load_custom_field_values_bulk(self.db, tenant_id=10, module_key="sales_leads", record_ids=[7, 8])
        self.assertEqual(loaded, {7: {"partner": {"id": 5, "label": "Acme"}}})


class CustomModuleValueTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.db.add_all([Tenant(id=10, slug="t", name="T"), Module(id=30, name="custom_10_assets", base_route="/dashboard/custom/assets", is_enabled=1)])
        self.db.flush()
        self.definition = CustomModuleDefinition(id=3, tenant_id=10, key="assets", name="Assets", module_id=30, is_active=True)
        self.db.add(self.definition)
        self.db.flush()
        for index, (key, kind, extra) in enumerate([
            ("serial", "text", {"is_unique": True}),
            ("legacy", "text", {}),
            ("off", "text", {"is_active": False}),
        ]):
            self.db.add(FieldDefinition(tenant_id=10, module_key="custom_10_assets", custom_module_id=3, field_key=key,
                                        label=key.title(), field_type=kind, sort_order=index, **extra))
        self.db.commit()
        self.db.refresh(self.definition)

    def tearDown(self):
        self.db.close()

    def _record(self, record_id: int, values: dict):
        record = CustomModuleRecord(id=record_id, tenant_id=10, custom_module_id=3, title=f"Asset {record_id}")
        self.db.add(record)
        self.db.flush()
        custom_modules._write_values(self.db, definition=self.definition, record=record, payload_values=values)
        self.db.commit()
        return record

    def test_values_live_in_the_one_field_system(self):
        record = self._record(1, {"serial": "SN-1", "legacy": "L"})
        rows = self.db.query(FieldValue).filter(FieldValue.record_id == 1, FieldValue.module_key == "custom_10_assets").all()
        self.assertEqual({row.value_text for row in rows}, {"SN-1", "L"})
        self.assertEqual(custom_modules.serialize_records(self.db, self.definition, [record])[0].values, {"serial": "SN-1", "legacy": "L"})

    def test_unknown_keys_are_refused_on_values(self):
        record = CustomModuleRecord(id=2, tenant_id=10, custom_module_id=3, title="Asset 2")
        self.db.add(record)
        self.db.flush()
        with self.assertRaises(HTTPException) as caught:
            custom_modules._write_values(self.db, definition=self.definition, record=record, payload_values={"missing": "x"})
        self.assertEqual(caught.exception.detail[0]["loc"], ["body", "values", "missing"])

    def test_unique_ignores_deleted_records(self):
        first = self._record(1, {"serial": "SN-1"})
        with self.assertRaises(HTTPException):
            self._record(2, {"serial": "SN-1"})
        self.db.rollback()
        first.deleted_at = date(2026, 1, 1)
        self.db.commit()
        self._record(3, {"serial": "SN-1"})

    def test_partial_write_keeps_omitted_fields(self):
        record = self._record(1, {"serial": "SN-1", "legacy": "L"})
        custom_modules._write_values(self.db, definition=self.definition, record=record, payload_values={"legacy": "M"}, partial=True)
        self.db.commit()
        values = custom_modules.serialize_records(self.db, self.definition, [record])[0].values
        self.assertEqual(values, {"serial": "SN-1", "legacy": "M"})
        self.assertIsInstance(CustomModuleRecordRequest(values={"serial": "x"}).values, dict)


if __name__ == "__main__":
    unittest.main()
