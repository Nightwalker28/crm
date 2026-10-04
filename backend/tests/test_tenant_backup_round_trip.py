"""Tenant backup → restore round trip (13-final-fixes F0.2, 13a I1, A2, G1).

Every backup set must export, and a whole-tenant restore must bring back child rows, not
only parents: order lines, deal participants, pipelines and stages, invoice lines, and
document versions and links.
"""

import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog.models import CatalogProduct
from app.modules.documents.models import Document, DocumentLink, DocumentVersion
from app.modules.finance.models import FinancePosInvoice, FinancePosInvoiceLine
from app.modules.finance.services import pos_invoice_services
from app.modules.inventory.services.stock_ledger import MoveSpec, ensure_default_warehouse, ensure_product_levels, post_moves
from app.modules.platform import models as platform_models  # noqa: F401
from app.modules.platform.services import tenant_backup_runs as tenant_backup_runs_service
from app.modules.platform.services.tenant_backup_runs import MODULE_CHILD_EXPORTS, SUPPORTED_MODULE_EXPORTS, create_manual_tenant_backup_run
from app.modules.platform.services.tenant_backup_settings import update_tenant_backup_settings
from app.modules.platform.services.tenant_restore_runs import execute_tenant_module_restore, execute_whole_tenant_restore
from app.modules.sales.models import (
    SalesContact,
    SalesOpportunity,
    SalesOpportunityContact,
    SalesOrder,
    SalesOrderItem,
    SalesOrganization,
    SalesPipeline,
    SalesPipelineStage,
)
from app.modules.sales.services.orders_services import create_sales_order
from app.modules.sales.services.pipelines_services import ensure_default_opportunity_pipeline
from app.modules.tasks.models import Task
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import CompanyProfile, Module, Tenant, TenantModuleConfig, User, UserStatus


class TenantBackupRoundTripTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_backup_dir = tenant_backup_runs_service.TENANT_BACKUP_UPLOAD_DIR
        tenant_backup_runs_service.TENANT_BACKUP_UPLOAD_DIR = Path(self.temp_dir.name)
        self.user = SimpleNamespace(id=1, tenant_id=10)
        self.db.add_all([
            Tenant(id=10, slug="main", name="Main"),
            Tenant(id=20, slug="other", name="Other"),
            User(id=1, tenant_id=10, email="owner@example.com", is_active=UserStatus.active),
            CompanyProfile(id=1, tenant_id=10, name="Main", operating_currencies=["USD"]),
            SalesOrganization(org_id=5, tenant_id=10, org_name="Acme", primary_email="ap@acme.test"),
            SalesContact(contact_id=7, tenant_id=10, first_name="Ada", last_name="Buyer", primary_email="ada@acme.test", assigned_to=1),
            SalesContact(contact_id=8, tenant_id=10, first_name="Ben", last_name="Finance", primary_email="ben@acme.test", assigned_to=1),
            CatalogProduct(id=1, tenant_id=10, name="Camera", currency="USD", public_unit_price=10, cost_price=Decimal("6"),
                           track_inventory=1, stock_quantity=0),
            Task(id=1, tenant_id=10, title="Call Ada"),
        ])
        for index, module_key in enumerate(SUPPORTED_MODULE_EXPORTS, start=1):
            self.db.add(Module(id=index, name=module_key, base_route=f"/{module_key}", is_enabled=1))
            self.db.add(TenantModuleConfig(id=index, tenant_id=10, module_id=index, is_enabled=1))
        self.db.commit()

        warehouse = ensure_default_warehouse(self.db, tenant_id=10)
        ensure_product_levels(self.db, tenant_id=10, product_id=1)
        post_moves(self.db, tenant_id=10, actor_user_id=None, moves=[MoveSpec(
            product_id=1, warehouse_id=warehouse.id, quantity=Decimal(20), move_type="opening",
            source_type="catalog_product", source_id=1, source_line_id=1, unit_cost=Decimal("6"))])
        self.db.commit()

        pipeline = ensure_default_opportunity_pipeline(self.db, 10)
        self.stage_key = pipeline.stages[1].key
        self.db.add(SalesOpportunity(
            opportunity_id=3, tenant_id=10, opportunity_name="Cameras for Acme", client="Acme", organization_id=5,
            contact_id=7, pipeline_id=pipeline.id, pipeline_stage_id=pipeline.stages[1].id, sales_stage=self.stage_key))
        self.db.add_all([
            SalesOpportunityContact(id=1, tenant_id=10, opportunity_id=3, contact_id=7, role_key="decision_maker", is_primary=True),
            SalesOpportunityContact(id=2, tenant_id=10, opportunity_id=3, contact_id=8, role_key="influencer", is_primary=False),
        ])
        self.db.commit()

        self.order = create_sales_order(self.db, {"status": "draft", "organization_id": 5, "items": [
            {"catalog_product_id": 1, "name": "Camera", "quantity": "2", "unit_price": "10"},
            {"name": "Setup", "quantity": "1", "unit_price": "50"},
        ]}, self.user)
        self.invoice = pos_invoice_services.create_invoice(self.db, self.user, {
            "customer_name": "Acme", "customer_organization_id": 5, "currency": "USD", "issue": True,
            "lines": [{"description": "Service", "quantity": 2, "unit_price": "40"}]})

        self.db.add(Document(
            id=1, tenant_id=10, uploaded_by_user_id=1, title="Proposal", original_filename="proposal.pdf",
            content_type="application/pdf", extension="pdf", file_size_bytes=16, storage_provider="local",
            storage_path="tenant-10/proposal.pdf"))
        self.db.add_all([
            DocumentVersion(id=1, tenant_id=10, document_id=1, version_number=1, storage_key="tenant-10/proposal-v1.pdf",
                            file_name="proposal.pdf", mime_type="application/pdf", size_bytes=16),
            DocumentLink(id=1, tenant_id=10, document_id=1, module_key="sales_opportunities", entity_id="3"),
        ])
        self.db.commit()

    def tearDown(self):
        tenant_backup_runs_service.TENANT_BACKUP_UPLOAD_DIR = self.original_backup_dir
        self.temp_dir.cleanup()
        self.db.close()

    def snapshot(self) -> dict:
        """Row counts for every backed-up table, plus the money that must survive."""
        self.db.expire_all()
        models = [model for _file, model in SUPPORTED_MODULE_EXPORTS.values()]
        models += [model for children in MODULE_CHILD_EXPORTS.values() for _file, model in children]
        counts = {model.__tablename__: self.db.query(model).filter(model.tenant_id == 10).count() for model in models}
        counts["order_line_total"] = self.db.query(func.sum(SalesOrderItem.line_total)).filter(SalesOrderItem.tenant_id == 10).scalar()
        counts["invoice_line_total"] = self.db.query(func.sum(FinancePosInvoiceLine.line_total)).filter(FinancePosInvoiceLine.tenant_id == 10).scalar()
        counts["invoice_total"] = self.db.query(func.sum(FinancePosInvoice.total_amount)).filter(FinancePosInvoice.tenant_id == 10).scalar()
        counts["primary_participants"] = self.db.query(SalesOpportunityContact).filter(
            SalesOpportunityContact.tenant_id == 10, SalesOpportunityContact.is_primary.is_(True)).count()
        return counts

    def full_backup(self):
        update_tenant_backup_settings(self.db, tenant_id=10, actor_user_id=1, payload={"scope": "full_tenant", "include_documents": False})
        run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)
        self.assertEqual(run.status, "completed", run.error_message)
        return run

    def test_every_backup_set_exports(self):
        # I1: one table without tenant_id failed every backup since E5.
        for module_key in SUPPORTED_MODULE_EXPORTS:
            with self.subTest(module_key=module_key):
                update_tenant_backup_settings(self.db, tenant_id=10, actor_user_id=1, payload={
                    "scope": "selected_modules", "selected_modules": [module_key], "include_documents": False})
                run = create_manual_tenant_backup_run(self.db, tenant_id=10, actor_user_id=1)
                self.assertEqual(run.status, "completed", run.error_message)

    def test_whole_tenant_round_trip_restores_children(self):
        before = self.snapshot()
        self.assertEqual(before["sales_order_items"], 2)
        self.assertEqual(before["sales_opportunity_contacts"], 2)
        self.assertEqual(before["finance_pos_invoice_lines"], 1)
        self.assertEqual(before["document_versions"], 1)
        source = self.full_backup()

        # Lose the children, and recreate the pipeline under new ids.
        for model in (SalesOrderItem, SalesOpportunityContact, FinancePosInvoiceLine, DocumentVersion, DocumentLink):
            self.db.query(model).filter(model.tenant_id == 10).delete()
        self.db.query(SalesOpportunity).filter(SalesOpportunity.tenant_id == 10).delete()
        self.db.query(SalesPipelineStage).filter(SalesPipelineStage.tenant_id == 10).delete()
        self.db.query(SalesPipeline).filter(SalesPipeline.tenant_id == 10).delete()
        self.db.commit()
        recreated = ensure_default_opportunity_pipeline(self.db, 10)
        self.db.add(SalesPipelineStage(id=500, tenant_id=10, pipeline_id=recreated.id, key="zz_unused", label="Unused",
                                       position=99, semantic_type="open", probability=0))
        self.db.commit()
        recreated_stage = next(stage for stage in recreated.stages if stage.key == self.stage_key)

        restore = execute_whole_tenant_restore(self.db, tenant_id=10, actor_user_id=1, source_backup_run_id=source.id,
                                               confirmation="RESTORE TENANT 10")
        self.assertEqual(restore.status, "completed", restore.error_message)

        after = self.snapshot()
        # The extra stage added after the backup is kept; everything else matches.
        after["sales_pipeline_stages"] -= 1
        self.assertEqual(after, before)
        deal = self.db.get(SalesOpportunity, 3)
        self.assertEqual(deal.pipeline_id, recreated.id)
        self.assertEqual(deal.pipeline_stage_id, recreated_stage.id)
        order = self.db.get(SalesOrder, self.order.id)
        self.assertEqual(sorted(item.name for item in order.items), ["Camera", "Setup"])
        invoice = self.db.get(FinancePosInvoice, self.invoice.id)
        self.assertEqual([line.description for line in invoice.lines], ["Service"])

    def test_module_restore_brings_back_lines_of_an_existing_order(self):
        source = self.full_backup()
        self.db.query(SalesOrderItem).filter(SalesOrderItem.order_id == self.order.id).delete()
        self.db.commit()

        restore = execute_tenant_module_restore(self.db, tenant_id=10, actor_user_id=1, source_backup_run_id=source.id,
                                                module_key="sales_orders", mode="create_missing")

        self.assertEqual(restore.status, "completed", restore.error_message)
        self.assertEqual(restore.summary["created"], 2)
        self.db.expire_all()
        self.assertEqual(self.db.query(SalesOrderItem).filter(SalesOrderItem.order_id == self.order.id).count(), 2)

    def test_create_missing_keeps_the_current_primary_participant(self):
        source = self.full_backup()
        self.db.query(SalesOpportunityContact).filter(SalesOpportunityContact.id == 1).delete()
        self.db.query(SalesOpportunityContact).filter(SalesOpportunityContact.id == 2).update({"is_primary": True})
        self.db.commit()

        restore = execute_tenant_module_restore(self.db, tenant_id=10, actor_user_id=1, source_backup_run_id=source.id,
                                                module_key="sales_opportunities", mode="create_missing")

        self.assertEqual(restore.status, "completed", restore.error_message)
        self.db.expire_all()
        participants = {row.contact_id: row.is_primary for row in self.db.query(SalesOpportunityContact).filter(SalesOpportunityContact.tenant_id == 10)}
        self.assertEqual(participants, {7: False, 8: True})


if __name__ == "__main__":
    unittest.main()
