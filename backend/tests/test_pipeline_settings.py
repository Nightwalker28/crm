"""Pipeline configuration endpoints (04-pipelines-kanban, frontend Phase 2's backend).

Administrators may rename, re-weight, reclassify, deactivate/reactivate and reorder
stages. The stable key never changes, the pipeline always keeps somewhere for a new
deal to go, and every change is tenant-scoped, `configure`-gated and audited.
"""

import unittest
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from fastapi.routing import APIRoute
from pydantic import ValidationError

from app.modules.platform.models import ActivityLog
from app.modules.sales.models import SalesOpportunity
from app.modules.sales.opportunity_stages import OPPORTUNITY_STAGE_ORDER
from app.modules.sales.routes import pipelines_routes
from app.modules.sales.schema import SalesPipelineStageUpdate
from app.modules.sales.services import pipelines_services
from app.modules.sales.services.opportunities_services import update_opportunity_stage
from tests.test_opportunity_stage_refs import StageRefFixture
from tests.test_sales_pipelines import OTHER_TENANT, TENANT


class StageUpdateTests(StageRefFixture):
    def update(self, key, **changes):
        stage = pipelines_services.update_pipeline_stage(self.db, TENANT, self.stage(key).id, changes)
        self.db.commit()
        return stage

    def assert_rejected(self, key, status_code=400, **changes):
        with self.assertRaises(HTTPException) as caught:
            pipelines_services.update_pipeline_stage(self.db, TENANT, self.stage(key).id, changes)
        self.db.rollback()
        self.assertEqual(caught.exception.status_code, status_code)
        return caught.exception

    def test_rename_reweight_and_reclassify_keep_the_stable_key(self):
        stage = self.update("proposal", label="  Pricing  ", probability=Decimal("60"), semantic_type="ONGOING")
        self.assertEqual((stage.key, stage.label, stage.probability, stage.semantic_type), ("proposal", "Pricing", Decimal("60"), "ongoing"))

    def test_the_key_is_not_part_of_the_update_contract(self):
        self.assertNotIn("key", SalesPipelineStageUpdate.model_fields)

    def test_invalid_values_are_rejected_without_writing(self):
        self.assert_rejected("proposal", label="   ")
        self.assert_rejected("proposal", label="negotiation")  # names are unique, case-insensitively
        self.assert_rejected("proposal", semantic_type="maybe")
        self.assert_rejected("proposal", probability=Decimal("101"))
        self.assert_rejected("proposal", probability=None)
        self.assertEqual(self.stage("proposal").label, "Proposal")
        with self.assertRaises(ValidationError):
            SalesPipelineStageUpdate(label="x" * 81)

    def test_the_last_active_open_stage_cannot_be_removed_from_play(self):
        for key in ("qualified", "proposal", "negotiation"):
            self.update(key, is_active=False)
        error = self.assert_rejected("lead", is_active=False)
        self.assertIn("at least one active stage", error.detail)
        self.assert_rejected("lead", semantic_type="won")
        self.assertTrue(self.stage("lead").is_active)

    def test_deactivating_a_stage_keeps_its_deals_and_refuses_new_ones(self):
        deal = self.create(sales_stage="negotiation")
        self.update("negotiation", is_active=False)
        self.db.refresh(deal)
        self.assertEqual(deal.pipeline_stage_id, self.stage("negotiation").id)

        other = self.create(sales_stage="lead")
        with self.assertRaises(HTTPException):
            update_opportunity_stage(self.db, other, sales_stage="negotiation")
        self.db.rollback()

        self.update("negotiation", is_active=True)
        update_opportunity_stage(self.db, other, sales_stage="negotiation")
        self.assertEqual(other.sales_stage, "negotiation")

    def test_a_stage_of_another_tenant_is_not_found(self):
        foreign = self.stage("proposal", tenant_id=OTHER_TENANT)
        with self.assertRaises(HTTPException) as caught:
            pipelines_services.update_pipeline_stage(self.db, TENANT, foreign.id, {"label": "Mine now"})
        self.assertEqual(caught.exception.status_code, 404)
        self.db.rollback()
        self.assertEqual(self.stage("proposal", tenant_id=OTHER_TENANT).label, "Proposal")


class ReorderTests(StageRefFixture):
    def ids(self, *keys):
        return [self.stage(key).id for key in keys]

    def test_a_complete_list_sets_board_order(self):
        new_order = ["closed_lost", *OPPORTUNITY_STAGE_ORDER[:-1]]
        pipeline = pipelines_services.reorder_pipeline_stages(self.db, TENANT, self.ids(*new_order))
        self.db.commit()
        self.assertEqual([row["key"] for row in pipelines_services.serialize_pipeline(pipeline)["stages"]], new_order)

    def test_incomplete_duplicated_or_foreign_lists_are_a_conflict(self):
        full = self.ids(*OPPORTUNITY_STAGE_ORDER)
        foreign = self.stage("lead", tenant_id=OTHER_TENANT).id
        self.db.commit()
        for bad in (full[:-1], [*full[:-1], full[0]], [*full[:-1], foreign]):
            with self.assertRaises(HTTPException) as caught:
                pipelines_services.reorder_pipeline_stages(self.db, TENANT, bad)
            self.assertEqual(caught.exception.status_code, 409)
            self.db.rollback()
        self.assertEqual(
            [row["key"] for row in pipelines_services.serialize_pipeline(pipelines_services.get_default_opportunity_pipeline(self.db, TENANT))["stages"]],
            OPPORTUNITY_STAGE_ORDER,
        )


class UsageTests(StageRefFixture):
    def test_usage_counts_live_deals_in_this_tenant_only(self):
        self.create(sales_stage="proposal")
        self.create(sales_stage="proposal")
        deleted = self.create(sales_stage="proposal")
        deleted.deleted_at = datetime.now(timezone.utc)
        self.db.add(SalesOpportunity(opportunity_id=990, tenant_id=OTHER_TENANT, opportunity_name="Theirs", client="x", sales_stage="proposal"))
        self.db.commit()

        usage = {row["stage_id"]: row["live_deal_count"] for row in pipelines_services.stage_usage(self.db, TENANT)["stages"]}
        self.assertEqual(usage[self.stage("proposal").id], 2)
        self.assertEqual(usage[self.stage("lead").id], 0)
        self.assertEqual(len(usage), len(OPPORTUNITY_STAGE_ORDER))


class RouteTests(StageRefFixture):
    def test_every_route_requires_configure_on_opportunities(self):
        for route in pipelines_routes.router.routes:
            assert isinstance(route, APIRoute)
            checker = next(
                dependency.call
                for dependency in route.dependant.dependencies
                if dependency.call.__qualname__ == "require_action_access.<locals>.checker"
            )
            closure = {cell.cell_contents for cell in checker.__closure__ or ()}
            self.assertEqual(closure & {"configure", "sales_opportunities"}, {"configure", "sales_opportunities"}, route.path)

    def test_the_router_is_mounted_before_the_opportunity_id_routes(self):
        # The mounted router wraps its routes, so the order is checked where it is decided.
        from pathlib import Path

        source = (Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "router.py").read_text()
        self.assertLess(
            source.index("router.include_router(sales_pipelines_router"),
            source.index("router.include_router(sales_opportunities_router"),
        )

    def test_a_stage_change_is_audited_with_before_and_after(self):
        stage_id = self.stage("proposal").id
        payload = pipelines_routes.update_pipeline_stage(
            stage_id,
            SalesPipelineStageUpdate(label="Pricing"),
            db=self.db,
            current_user=self.current_user,
            require_module=None,
            require_permission=None,
        )
        self.assertIn("Pricing", [row["label"] for row in payload["stages"]])
        entry = self.db.query(ActivityLog).filter(ActivityLog.entity_type == "sales_pipeline").one()
        self.assertEqual(entry.tenant_id, TENANT)
        self.assertEqual(entry.action, "configure")
        labels = lambda state: {row["key"]: row["label"] for row in state["stages"]}
        self.assertEqual(labels(entry.before_state)["proposal"], "Proposal")
        self.assertEqual(labels(entry.after_state)["proposal"], "Pricing")


if __name__ == "__main__":
    unittest.main()
