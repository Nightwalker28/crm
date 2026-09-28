"""Tenant-added stages (04-pipelines-kanban, Phase 4).

The legacy check that pinned `sales_stage` to six keys is gone; a stage is valid when
the tenant's pipeline has it. These tests add stages and prove the rest of the product
treats them exactly like seeded ones — by stage row and semantic type.
"""

import importlib.util
import unittest
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import text

from app.modules.platform.models import ActivityLog
from app.modules.sales.models import SalesOpportunity
from app.modules.sales.routes import pipelines_routes
from app.modules.sales.schema import SalesPipelineStageCreate
from app.modules.sales.services import opportunities_services, pipelines_services
from app.modules.sales.services.opportunities_services import update_opportunity_stage
from tests.test_opportunity_stage_refs import StageRefFixture
from tests.test_sales_pipelines import OTHER_TENANT, TENANT

MIGRATION_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20260819_drop_stage_check.py"
_spec = importlib.util.spec_from_file_location("drop_stage_check_revision", MIGRATION_PATH)
MIGRATION = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(MIGRATION)


class ConstraintTests(StageRefFixture):
    def test_revision_chain(self):
        self.assertLessEqual(len(MIGRATION.revision), 32)
        self.assertEqual(MIGRATION.down_revision, "20260818_opp_stage_refs")

    def test_the_model_no_longer_pins_the_key(self):
        names = {constraint.name for constraint in SalesOpportunity.__table__.constraints}
        self.assertNotIn("ck_sales_opportunities_sales_stage", names)

    def test_a_downgrade_refuses_to_strand_tenant_stages(self):
        MIGRATION.assert_downgrade_is_safe(self.db.connection())  # only legacy keys: fine
        self.db.execute(text(
            "INSERT INTO sales_opportunities (opportunity_id, tenant_id, opportunity_name, client, sales_stage, created_time, updated_at) "
            "VALUES (901, :tenant, 'Custom', 'x', 'discovery', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        ), {"tenant": TENANT})
        with self.assertRaisesRegex(RuntimeError, "discovery"):
            MIGRATION.assert_downgrade_is_safe(self.db.connection())


class CreateStageTests(StageRefFixture):
    def add(self, **data):
        stage = pipelines_services.create_pipeline_stage(self.db, TENANT, data)
        self.db.commit()
        return stage

    def keys(self):
        pipeline = pipelines_services.get_default_opportunity_pipeline(self.db, TENANT)
        return [row["key"] for row in pipelines_services.serialize_pipeline(pipeline)["stages"]]

    def test_a_step_of_the_sale_goes_before_the_outcomes(self):
        stage = self.add(label="Technical review")
        self.assertEqual((stage.key, stage.semantic_type, stage.probability), ("technical_review", "ongoing", Decimal("50")))
        self.assertEqual(self.keys()[-3:], ["technical_review", "closed_won", "closed_lost"])

    def test_an_outcome_goes_last(self):
        self.add(label="Won via partner", semantic_type="won")
        self.assertEqual(self.keys()[-1], "won_via_partner")
        self.assertEqual(self.stage("won_via_partner").probability, Decimal("100"))

    def test_a_derived_key_that_is_taken_gets_a_suffix_and_reserved_words_are_avoided(self):
        self.assertEqual(self.add(label="Lead!").key, "lead_2")
        self.assertEqual(self.add(label="Unstaged").key, "unstaged_2")
        self.assertEqual(self.add(label="2nd call").key, "stage_2nd_call")

    def test_explicit_keys_are_validated(self):
        for key in ("Bad Key", "1st", "proposal", "unstaged", "x" * 41):
            with self.assertRaises(HTTPException):
                pipelines_services.create_pipeline_stage(self.db, TENANT, {"label": f"Label {key[:10]}", "key": key})
            self.db.rollback()
        self.assertEqual(self.add(label="Discovery", key="discovery").key, "discovery")

    def test_names_are_unique_and_required(self):
        for data in ({"label": "proposal"}, {"label": "  "}, {"label": "New", "semantic_type": "maybe"}, {"label": "New", "probability": 120}):
            with self.assertRaises(HTTPException):
                pipelines_services.create_pipeline_stage(self.db, TENANT, data)
            self.db.rollback()

    def test_another_tenants_pipeline_is_untouched(self):
        self.stage("lead", tenant_id=OTHER_TENANT)
        self.db.commit()
        self.add(label="Discovery")
        other = pipelines_services.get_default_opportunity_pipeline(self.db, OTHER_TENANT)
        self.assertNotIn("discovery", [stage.key for stage in other.stages])


class AddedStageBehaviourTests(StageRefFixture):
    def test_a_deal_can_move_into_an_added_stage_and_reads_it_by_meaning(self):
        pipelines_services.create_pipeline_stage(self.db, TENANT, {"label": "Signed by partner", "semantic_type": "won"})
        self.db.commit()
        deal = self.create(sales_stage="proposal", total_cost_of_project="400")

        update_opportunity_stage(self.db, deal, sales_stage="signed_by_partner")
        self.assertEqual(deal.pipeline_stage.label, "Signed by partner")
        facts = pipelines_services.opportunity_stage_facts(deal)
        self.assertTrue(facts.is_won)

        summary = opportunities_services.summarize_opportunity_pipeline(self.db, TENANT)
        row = next(row for row in summary["stages"] if row["stage_key"] == "signed_by_partner")
        self.assertEqual((row["count"], row["semantic_type"]), (1, "won"))

    def test_create_route_is_audited(self):
        payload = pipelines_routes.create_pipeline_stage(
            SalesPipelineStageCreate(label="Discovery", semantic_type="open"),
            db=self.db,
            current_user=self.current_user,
            require_module=None,
            require_permission=None,
        )
        self.assertIn("discovery", [row["key"] for row in payload["stages"]])
        entry = self.db.query(ActivityLog).filter(ActivityLog.entity_type == "sales_pipeline").one()
        self.assertEqual(entry.description, "Added pipeline stage Discovery")
        self.assertNotIn("discovery", [row["key"] for row in entry.before_state["stages"]])


if __name__ == "__main__":
    unittest.main()
