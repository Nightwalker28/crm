"""13-final-fixes §7 Step 3: the backend halves of H11, H20/H22 and H27."""

import importlib.util
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from app.modules.inventory.models import InventoryAdjustment, InventoryWarehouse
from app.modules.inventory.services.inventory_services import document_numbers
from app.modules.platform.models import ActivityLog
from app.modules.platform.services.record_activity import ACTIVITY_TYPES, ADAPTERS, _fetch_lifecycle
from app.modules.sales.models import SalesLead, SalesOpportunity, SalesOrganization
from app.modules.sales.routes.leads_routes import _log_conversion_targets
from app.modules.sales.services.leads_services import convert_sales_lead
from app.modules.user_management.services.admin_modules import default_sidebar_tab_key, list_sidebar_tabs
from tests.test_opportunity_stage_refs import StageRefFixture
from tests.test_sales_pipelines import OTHER_TENANT, TENANT

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LeadConversionDealTests(StageRefFixture):
    """H11: the deal a conversion opens carries its value and close date, and every record the
    conversion touched says so on its own timeline."""

    def make_lead(self, lead_id=71, company="Prospect Ltd"):
        lead = SalesLead(lead_id=lead_id, tenant_id=TENANT, first_name="Nina", last_name="Park", company=company,
                         primary_email=f"nina{lead_id}@prospect.example", status="qualified", assigned_to=1)
        self.db.add(lead)
        self.db.commit()
        return lead

    def test_the_deal_takes_amount_currency_and_close_date(self):
        # The tenant's currencies, seeded rather than left to whichever earlier test happened to
        # cache them in this process.
        from app.modules.user_management.models import CompanyProfile

        self.db.add(CompanyProfile(id=1, tenant_id=TENANT, name="Prospect seller", operating_currencies=["USD"], base_currency="USD"))
        self.db.commit()
        result = convert_sales_lead(
            self.db,
            self.make_lead(),
            {"create_deal": True, "assigned_to": 1, "deal_amount": Decimal("1250.50"), "deal_currency": "usd",
             "deal_close_date": date(2026, 12, 31)},
            current_user=self.current_user,
        )
        deal = self.db.get(SalesOpportunity, result["deal_id"])
        self.assertEqual(deal.amount, Decimal("1250.50"))
        self.assertEqual(deal.currency_type, "USD")
        self.assertEqual(deal.expected_close_date, date(2026, 12, 31))

    def test_without_money_fields_the_deal_is_made_as_before(self):
        # Automation conversions send no amount or currency: the deal has no amount and starts in
        # the base currency, like any other deal (13b §3.5).
        result = convert_sales_lead(self.db, self.make_lead(), {"create_deal": True, "assigned_to": 1}, current_user=self.current_user)
        deal = self.db.get(SalesOpportunity, result["deal_id"])
        self.assertIsNone(deal.amount)
        self.assertTrue(deal.currency_type)
        self.assertIsNone(deal.expected_close_date)

    def test_each_record_gets_a_lifecycle_entry_and_the_timeline_links_its_siblings(self):
        # The account already exists by name, so it is reused; the contact and deal are new.
        self.db.add(SalesOrganization(org_id=400, tenant_id=TENANT, org_name="Prospect Ltd", assigned_to=1))
        self.db.commit()
        lead = self.make_lead()
        result = convert_sales_lead(self.db, lead, {"create_deal": True, "assigned_to": 1}, current_user=self.current_user)
        self.assertFalse(result["created_account"])
        _log_conversion_targets(self.db, current_user=self.current_user, result=result)

        rows = {row.module_key: row for row in self.db.query(ActivityLog).filter(ActivityLog.tenant_id == TENANT)}
        self.assertEqual(rows["sales_organizations"].action, "convert")
        self.assertEqual(rows["sales_organizations"].description, "Linked to lead Nina Park on conversion")
        self.assertEqual(rows["sales_contacts"].action, "create")
        self.assertEqual(rows["sales_opportunities"].description, "Created from lead Nina Park")

        items = _fetch_lifecycle(self.db, tenant_id=TENANT, module_key="sales_opportunities", entity_id=str(result["deal_id"]),
                                 limit=10, cursor=None, viewer_user_id=1)
        self.assertEqual([item.title for item in items], ["Created from lead Nina Park"])
        self.assertEqual(items[0].meta["lead_id"], lead.lead_id)
        self.assertEqual(items[0].meta["account_id"], 400)
        self.assertEqual(items[0].actor_name, "Ava")

    def test_the_lifecycle_adapter_reads_only_lifecycle_actions_of_this_tenant_and_record(self):
        for tenant_id, entity_id, action in [(TENANT, "5", "create"), (TENANT, "5", "update"), (TENANT, "6", "create"), (OTHER_TENANT, "5", "create")]:
            self.db.add(ActivityLog(tenant_id=tenant_id, module_key="sales_contacts", entity_type="sales_contact", entity_id=entity_id,
                                    action=action, description=f"{action} {entity_id}", created_at=datetime.now(timezone.utc)))
        self.db.commit()
        items = _fetch_lifecycle(self.db, tenant_id=TENANT, module_key="sales_contacts", entity_id="5", limit=10, cursor=None, viewer_user_id=1)
        self.assertEqual([item.title for item in items], ["create 5"])

    def test_lifecycle_is_registered_for_the_crm_records_only(self):
        self.assertIn("lifecycle", ACTIVITY_TYPES)
        adapter = next(adapter for adapter in ADAPTERS if adapter.type == "lifecycle")
        self.assertTrue(adapter.applies("sales_opportunities"))
        self.assertFalse(adapter.applies("catalog_products"))


class InventoryListTests(StageRefFixture):
    """H22: movements are named by their document's number, tenant-scoped."""

    def test_document_numbers_resolve_per_source_and_never_cross_tenants(self):
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
        moves = [
            SimpleNamespace(source_type="inventory_adjustment", source_id=10),
            SimpleNamespace(source_type="inventory_adjustment", source_id=11),
            SimpleNamespace(source_type="catalog_product", source_id=3),
        ]
        numbers = document_numbers(self.db, tenant_id=TENANT, moves=moves)
        self.assertEqual(numbers, {("inventory_adjustment", 10): "ADJ-0001"})


class SidebarTests(unittest.TestCase):
    """H27: the ERP modules default to their own sidebar groups, which are system tabs."""

    def test_erp_modules_default_to_their_groups(self):
        self.assertEqual(default_sidebar_tab_key("inventory_stock"), "inventory")
        self.assertEqual(default_sidebar_tab_key("inventory_valuation"), "inventory")
        self.assertEqual(default_sidebar_tab_key("purchase_orders"), "purchasing")
        self.assertEqual(default_sidebar_tab_key("tasks"), "workspace")
        self.assertEqual(default_sidebar_tab_key("custom_7"), "other")

    def test_the_groups_are_system_tabs(self):
        class _Query:
            def filter(self, *args, **kwargs):
                return self

            def order_by(self, *args, **kwargs):
                return self

            def all(self):
                return []

        tabs = {tab.key: tab for tab in list_sidebar_tabs(SimpleNamespace(query=lambda *args: _Query()), tenant_id=TENANT)}
        self.assertEqual(tabs["inventory"].label, "Inventory")
        self.assertTrue(tabs["purchasing"].is_system)

    def test_the_regroup_migration_follows_the_password_reset(self):
        migration = _load(VERSIONS_DIR / "20261006_sidebar_regroup.py", "sidebar_regroup_revision")
        self.assertLessEqual(len(migration.revision), 32)
        self.assertEqual(migration.down_revision, "20261005_password_reset")
        source = (VERSIONS_DIR / "20261006_sidebar_regroup.py").read_text()
        self.assertIn("'tasks', 'documents'", source)


if __name__ == "__main__":
    unittest.main()
