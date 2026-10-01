"""Opportunity pipeline/stage references (04-pipelines-kanban, Phase 2).

Deals now reference a pipeline and a stage row. `sales_stage` stays as the legacy
compatibility field and must always name the same stage as `pipeline_stage_id`,
whichever of the two a caller writes.
"""

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.sales.models import SalesLead, SalesContact, SalesOpportunity, SalesPipeline, SalesPipelineStage
from app.modules.sales.opportunity_stages import OPPORTUNITY_STAGE_ORDER
from app.modules.sales.routes import opportunities_routes
from app.modules.sales.schema import SalesOpportunityResponse, SalesOpportunityStageUpdate
from app.modules.sales.services import pipelines_services
from app.modules.sales.services.leads_services import convert_sales_lead
from app.modules.sales.services.opportunities_services import (
    create_opportunity,
    update_opportunity,
    update_opportunity_stage,
)
from app.modules.user_management.models import User, UserStatus
from tests.test_sales_pipelines import OTHER_TENANT, TENANT, PipelineFixture

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION_PATH = VERSIONS_DIR / "20260818_opportunity_stage_refs.py"
PIPELINE_MIGRATION_PATH = VERSIONS_DIR / "20260817_sales_pipelines.py"


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load(MIGRATION_PATH, "opportunity_stage_refs_revision")
PIPELINE_MIGRATION = _load(PIPELINE_MIGRATION_PATH, "sales_pipelines_revision_for_refs")


class StageRefFixture(PipelineFixture):
    def setUp(self):
        super().setUp()
        self.db.add_all(
            [
                User(id=1, tenant_id=TENANT, email="ava@example.com", first_name="Ava", is_active=UserStatus.active),
                SalesContact(contact_id=30, tenant_id=TENANT, first_name="Ada", primary_email="ada@acme.example"),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=TENANT)

    def stage(self, key, tenant_id=TENANT):
        pipeline = pipelines_services.ensure_default_opportunity_pipeline(self.db, tenant_id)
        return next(stage for stage in pipeline.stages if stage.key == key)

    def create(self, **data):
        payload = {"opportunity_name": "Deal", "contact_id": 30, "custom_fields": {}}
        payload.update(data)
        return create_opportunity(self.db, payload, current_user=self.current_user)


class MigrationTests(unittest.TestCase):
    def test_revision_chain_and_id_length(self):
        self.assertLessEqual(len(MIGRATION.revision), 32)
        self.assertEqual(MIGRATION.down_revision, PIPELINE_MIGRATION.revision)

    def test_the_revision_creates_the_columns_and_indexes_the_model_maps(self):
        source = MIGRATION_PATH.read_text()
        for column in ("pipeline_id", "pipeline_stage_id"):
            self.assertIn(f'"{column}"', source)
        for index in SalesOpportunity.__table__.indexes:
            if "pipeline" in index.name:
                self.assertIn(index.name, source)


class BackfillTests(PipelineFixture):
    def run_migrations(self):
        connection = self.db.connection()
        PIPELINE_MIGRATION.seed_default_pipelines(connection)
        MIGRATION.backfill_stage_references(connection)
        MIGRATION.assert_every_opportunity_resolved(connection)
        self.db.commit()

    def test_every_legacy_stage_backfills_to_the_same_key_in_the_deals_own_tenant(self):
        for index, key in enumerate(OPPORTUNITY_STAGE_ORDER):
            self.make_opportunity(100 + index, sales_stage=key)
            self.make_opportunity(200 + index, tenant_id=OTHER_TENANT, sales_stage=key)
        self.make_opportunity(300, sales_stage=None)
        self.db.add(
            SalesOpportunity(
                opportunity_id=301,
                tenant_id=TENANT,
                opportunity_name="Deleted",
                client="Acme",
                sales_stage="proposal",
                deleted_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
            )
        )
        self.db.commit()

        self.run_migrations()

        for opportunity in self.db.query(SalesOpportunity).all():
            self.db.refresh(opportunity)
            pipeline = self.db.get(SalesPipeline, opportunity.pipeline_id)
            self.assertEqual(pipeline.tenant_id, opportunity.tenant_id)
            self.assertTrue(pipeline.is_default)
            if opportunity.sales_stage is None:
                self.assertIsNone(opportunity.pipeline_stage_id)
            else:
                stage = self.db.get(SalesPipelineStage, opportunity.pipeline_stage_id)
                self.assertEqual(stage.key, opportunity.sales_stage)
                self.assertEqual(stage.tenant_id, opportunity.tenant_id)
                self.assertEqual(stage.pipeline_id, opportunity.pipeline_id)

    def test_backfill_is_idempotent(self):
        self.make_opportunity(100, sales_stage="lead")
        self.run_migrations()
        first = self.db.query(SalesOpportunity.pipeline_stage_id).scalar()
        self.run_migrations()
        self.assertEqual(self.db.query(SalesOpportunity.pipeline_stage_id).scalar(), first)

    def test_a_deal_whose_tenant_has_no_pipeline_blocks_the_upgrade(self):
        self.make_opportunity(100, sales_stage="lead")
        connection = self.db.connection()
        MIGRATION.backfill_stage_references(connection)
        with self.assertRaisesRegex(RuntimeError, "opportunity 100"):
            MIGRATION.assert_every_opportunity_resolved(connection)


class AssignStageTests(StageRefFixture):
    def test_create_by_legacy_key_sets_the_reference(self):
        opportunity = self.create(sales_stage="Proposal")
        self.assertEqual(opportunity.sales_stage, "proposal")
        self.assertEqual(opportunity.pipeline_stage_id, self.stage("proposal").id)
        self.assertEqual(opportunity.pipeline_id, self.stage("proposal").pipeline_id)

    def test_create_by_stage_id_sets_the_legacy_key(self):
        opportunity = self.create(pipeline_stage_id=self.stage("negotiation").id)
        self.assertEqual(opportunity.sales_stage, "negotiation")

    def test_create_without_a_stage_is_unstaged_in_the_default_pipeline(self):
        opportunity = self.create()
        self.assertIsNone(opportunity.sales_stage)
        self.assertIsNone(opportunity.pipeline_stage_id)
        self.assertEqual(opportunity.pipeline_id, pipelines_services.get_default_opportunity_pipeline(self.db, TENANT).id)

    def test_key_and_id_that_disagree_are_rejected(self):
        with self.assertRaises(HTTPException) as caught:
            self.create(sales_stage="lead", pipeline_stage_id=self.stage("proposal").id)
        self.assertEqual(caught.exception.status_code, 400)

    def test_a_stage_from_another_tenant_is_rejected_like_a_missing_one(self):
        foreign = self.stage("proposal", tenant_id=OTHER_TENANT)
        with self.assertRaises(HTTPException) as foreign_error:
            self.create(pipeline_stage_id=foreign.id)
        with self.assertRaises(HTTPException) as missing_error:
            self.create(pipeline_stage_id=987654)
        self.assertEqual(foreign_error.exception.status_code, 400)
        self.assertEqual(foreign_error.exception.detail, missing_error.exception.detail)
        self.assertEqual(self.db.query(SalesOpportunity).count(), 0)

    def test_an_unknown_legacy_key_is_a_400_not_a_constraint_error(self):
        with self.assertRaises(HTTPException) as caught:
            self.create(sales_stage="verbal_yes")
        self.assertEqual(caught.exception.detail, "Unsupported opportunity stage")

    def test_an_inactive_stage_cannot_be_newly_assigned_but_a_deal_may_stay_in_it(self):
        opportunity = self.create(sales_stage="lead")
        lead_stage = self.stage("lead")
        lead_stage.is_active = False
        self.db.commit()

        # Staying put (an edit that resubmits the current stage) is allowed.
        update_opportunity(self.db, opportunity, {"sales_stage": "lead", "opportunity_name": "Renamed"}, current_user=self.current_user)
        self.assertEqual(opportunity.pipeline_stage_id, lead_stage.id)

        other = self.create(sales_stage="proposal")
        with self.assertRaises(HTTPException) as caught:
            update_opportunity_stage(self.db, other, pipeline_stage_id=lead_stage.id)
        self.assertEqual(caught.exception.detail, "Pipeline stage is inactive")

    def test_update_keeps_both_fields_in_step_and_can_clear_the_stage(self):
        opportunity = self.create(sales_stage="lead")
        update_opportunity(self.db, opportunity, {"pipeline_stage_id": self.stage("closed_won").id}, current_user=self.current_user)
        self.assertEqual(opportunity.sales_stage, "closed_won")

        update_opportunity(self.db, opportunity, {"sales_stage": None}, current_user=self.current_user)
        self.assertIsNone(opportunity.sales_stage)
        self.assertIsNone(opportunity.pipeline_stage_id)
        self.assertIsNotNone(opportunity.pipeline_id)

    def test_an_update_that_does_not_touch_the_stage_leaves_it_alone(self):
        opportunity = self.create(sales_stage="proposal")
        stage_id = opportunity.pipeline_stage_id
        update_opportunity(self.db, opportunity, {"opportunity_name": "Renamed"}, current_user=self.current_user)
        self.assertEqual(opportunity.pipeline_stage_id, stage_id)

    def test_stage_patch_by_key_normalizes_and_persists(self):
        opportunity = self.create(sales_stage="proposal")
        update_opportunity_stage(self.db, opportunity, sales_stage="Closed Won")
        self.assertEqual(opportunity.sales_stage, "closed_won")
        self.assertEqual(opportunity.pipeline_stage_id, self.stage("closed_won").id)

    def test_stage_patch_rejects_an_unsupported_stage_without_writing(self):
        opportunity = self.create(sales_stage="proposal")
        with self.assertRaises(HTTPException) as caught:
            update_opportunity_stage(self.db, opportunity, sales_stage="verbal_yes")
        self.assertEqual(caught.exception.status_code, 400)
        self.assertEqual(caught.exception.detail, "Unsupported opportunity stage")
        self.db.rollback()
        self.db.refresh(opportunity)
        self.assertEqual(opportunity.sales_stage, "proposal")

    def test_a_renamed_label_never_changes_what_a_deal_stores(self):
        opportunity = self.create(sales_stage="proposal")
        stage = self.stage("proposal")
        stage.label = "Pricing"
        self.db.commit()
        self.db.refresh(opportunity)
        self.assertEqual(opportunity.sales_stage, "proposal")
        self.assertEqual(opportunity.pipeline_stage.label, "Pricing")


class ConversionTests(StageRefFixture):
    def make_lead(self, lead_id=70):
        lead = SalesLead(lead_id=lead_id, tenant_id=TENANT, first_name="Nina", primary_email="nina@prospect.example", status="new", assigned_to=1)
        self.db.add(lead)
        self.db.commit()
        return lead

    def test_conversion_sets_the_stage_reference(self):
        result = convert_sales_lead(
            self.db,
            self.make_lead(),
            {"create_deal": True, "deal_name": "Nina deal", "assigned_to": 1, "deal_stage": "proposal"},
            current_user=self.current_user,
        )
        deal = self.db.get(SalesOpportunity, result["deal_id"])
        self.assertEqual(deal.sales_stage, "proposal")
        self.assertEqual(deal.pipeline_stage_id, self.stage("proposal").id)

    def test_conversion_defaults_to_qualified(self):
        result = convert_sales_lead(
            self.db, self.make_lead(), {"create_deal": True, "assigned_to": 1}, current_user=self.current_user
        )
        self.assertEqual(self.db.get(SalesOpportunity, result["deal_id"]).sales_stage, "qualified")

    def test_an_inactive_conversion_stage_is_rejected_before_anything_is_written(self):
        self.stage("proposal").is_active = False
        self.db.commit()
        lead = self.make_lead()
        with self.assertRaises(HTTPException) as caught:
            convert_sales_lead(
                self.db,
                lead,
                {"create_deal": True, "assigned_to": 1, "deal_stage": "proposal"},
                current_user=self.current_user,
            )
        self.assertEqual(caught.exception.detail, "Invalid deal stage")
        self.db.rollback()
        self.assertEqual(self.db.query(SalesOpportunity).count(), 0)
        self.assertNotEqual(self.db.get(SalesLead, 70).status, "converted")


class SerializationTests(StageRefFixture):
    def test_detail_response_carries_the_stage_as_display_metadata(self):
        opportunity = self.create(sales_stage="closed_lost")
        payload = SalesOpportunityResponse.model_validate(opportunity).model_dump(mode="json")
        self.assertEqual(payload["sales_stage"], "closed_lost")
        self.assertEqual(payload["pipeline_stage_id"], self.stage("closed_lost").id)
        self.assertEqual(payload["pipeline_stage"]["semantic_type"], "lost")
        self.assertEqual(payload["pipeline_stage"]["label"], "Closed lost")

    def test_list_item_carries_the_reference_only_when_the_stage_column_is_visible(self):
        opportunity = self.create(sales_stage="lead")
        with_stage = opportunities_routes._serialize_opportunity_list_item(opportunity, {"sales_stage"})
        without_stage = opportunities_routes._serialize_opportunity_list_item(opportunity, {"opportunity_name"})
        self.assertEqual(with_stage.pipeline_stage.key, "lead")
        self.assertEqual(with_stage.pipeline_stage_id, opportunity.pipeline_stage_id)
        self.assertIsNone(without_stage.pipeline_stage)
        self.assertIsNone(without_stage.pipeline_stage_id)

    def test_stage_update_payload_needs_a_key_or_an_id(self):
        with self.assertRaises(ValidationError):
            SalesOpportunityStageUpdate()
        self.assertEqual(SalesOpportunityStageUpdate(pipeline_stage_id=4).pipeline_stage_id, 4)

    def test_a_disabled_stage_field_also_blocks_writes_through_the_stage_id(self):
        self.assertEqual(
            opportunities_routes._field_config_keys({"pipeline_stage_id", "custom_fields", "opportunity_name"}),
            {"sales_stage", "opportunity_name"},
        )


if __name__ == "__main__":
    unittest.main()
