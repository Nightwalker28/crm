"""Stage-dependent business logic reads stage rows (04-pipelines-kanban, Phase 3).

The proof pattern throughout: change what a stage *means* (its semantic type or
probability) or what it is *called* (its label) on the stage row, and check that
behaviour follows the meaning and ignores the label. Seeded meanings equal the
legacy ones, so untouched tenants see the numbers they always saw.
"""

import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from app.modules.mail.services import mail_services
from app.modules.platform.services import automation_registry, automation_rules, global_search, module_reports
from app.modules.sales.models import SalesOpportunity
from app.modules.sales.opportunity_stages import OPPORTUNITY_STAGE_ORDER
from app.modules.sales.routes import opportunities_routes
from app.modules.sales.services import opportunities_services, pipelines_services, reminder_scans
from app.modules.user_management.models import User, UserStatus
from tests.test_opportunity_stage_refs import StageRefFixture
from tests.test_sales_pipelines import TENANT


class BusinessLogicFixture(StageRefFixture):
    def setUp(self):
        super().setUp()
        self.user = SimpleNamespace(id=1, tenant_id=TENANT, role_id=None, team_id=None)
        self.close = date.today() + timedelta(days=3)

    def deal(self, stage_key, *, value="1000", **extra):
        data = {"sales_stage": stage_key, "total_cost_of_project": value, "assigned_to": 1, "expected_close_date": self.close}
        data.update(extra)
        return self.create(**data)

    def forecast(self):
        return module_reports.generate_forecast_summary(
            self.db, self.user, period_start=date.today(), period_end=date.today() + timedelta(days=30)
        )

    def dashboard(self):
        with patch.object(module_reports, "_has_module_view_access", side_effect=lambda db, user, key: key == "sales_opportunities"):
            return module_reports.generate_crm_dashboard_summary(self.db, self.user)


class ClosedSemanticsTests(BusinessLogicFixture):
    def test_forecast_follows_semantic_type_not_the_key(self):
        self.deal("proposal", value="400")
        self.deal("closed_won", value="100")
        before = self.forecast()
        self.assertEqual(before["won_opportunity_count"], 1)
        self.assertEqual(before["actual_revenue_amount"], Decimal("100.00"))

        # An administrator decides "proposal" is where this team books the win.
        self.stage("proposal").semantic_type = "won"
        self.db.commit()
        after = self.forecast()
        self.assertEqual(after["won_opportunity_count"], 2)
        self.assertEqual(after["open_opportunity_count"], 0)
        self.assertEqual(after["actual_revenue_amount"], Decimal("500.00"))

    def test_forecast_weights_come_from_the_stage_row_and_explicit_probability_still_wins(self):
        self.deal("proposal", value="1000")
        self.deal("proposal", value="1000", probability_percent=Decimal("90"))
        self.assertEqual(self.forecast()["weighted_pipeline_amount"], Decimal("1400.00"))

        self.stage("proposal").probability = Decimal("60")
        self.db.commit()
        self.assertEqual(self.forecast()["weighted_pipeline_amount"], Decimal("1500.00"))

    def test_forecast_stage_buckets_use_the_editable_label(self):
        self.deal("negotiation")
        self.stage("negotiation").label = "Contracting"
        self.db.commit()
        [bucket] = self.forecast()["by_stage"]
        self.assertEqual((bucket["key"], bucket["label"]), ("negotiation", "Contracting"))

    def test_dashboard_won_lost_and_open_value_follow_semantics(self):
        self.deal("lead", value="100")
        self.deal("closed_won", value="200")
        self.deal("closed_lost", value="400")
        self.create(total_cost_of_project="800", assigned_to=1)
        summary = self.dashboard()
        self.assertEqual((summary["won_deals"], summary["lost_deals"]), (1, 1))
        self.assertEqual(summary["pipeline_value"], 900.0)
        labels = {row["key"]: row["label"] for row in summary["deal_stages"]}
        self.assertEqual(labels["unstaged"], "Unstaged")
        self.assertEqual(labels["closed_won"], "Closed won")

        self.stage("closed_lost").semantic_type = "ongoing"
        self.db.commit()
        summary = self.dashboard()
        self.assertEqual(summary["lost_deals"], 0)
        self.assertEqual(summary["pipeline_value"], 1300.0)

    def test_owner_scorecard_counts_wins_by_semantic_type(self):
        self.deal("closed_won")
        self.deal("proposal")
        self.stage("proposal").semantic_type = "won"
        self.db.commit()
        summary = self.dashboard()
        owner = next(row for row in summary["owner_performance"] if row.get("won_deal_count") is not None)
        self.assertEqual(owner["won_deal_count"], 2)

    def test_stale_deal_scan_skips_closed_deals_and_keeps_unstaged_ones(self):
        long_ago = datetime.now(timezone.utc) - timedelta(days=90)
        open_deal = self.deal("proposal", last_contacted_at=long_ago)
        won_deal = self.deal("closed_won", last_contacted_at=long_ago)
        unstaged = self.create(assigned_to=1, last_contacted_at=long_ago)
        # A row written outside the service keeps its legacy key's meaning.
        self.db.add(SalesOpportunity(opportunity_id=900, tenant_id=TENANT, opportunity_name="Raw", client="x", sales_stage="closed_lost", assigned_to=1, last_contacted_at=long_ago))
        self.db.commit()

        ids = {row.opportunity_id for row in reminder_scans._inactive_opportunities(self.db, cutoff=datetime.now(timezone.utc))}
        self.assertIn(open_deal.opportunity_id, ids)
        self.assertIn(unstaged.opportunity_id, ids)
        self.assertNotIn(won_deal.opportunity_id, ids)
        self.assertNotIn(900, ids)

        self.stage("closed_won").label = "Signed"
        self.db.commit()
        ids = {row.opportunity_id for row in reminder_scans._inactive_opportunities(self.db, cutoff=datetime.now(timezone.utc))}
        self.assertNotIn(won_deal.opportunity_id, ids)


class PipelineSummaryTests(BusinessLogicFixture):
    def summary(self):
        return opportunities_services.summarize_opportunity_pipeline(self.db, TENANT)

    def test_columns_come_from_the_pipeline_in_board_order(self):
        summary = self.summary()
        self.assertEqual([row["stage_key"] for row in summary["stages"]], [*OPPORTUNITY_STAGE_ORDER, "unstaged"])
        self.assertIsNone(summary["stages"][-1]["stage_id"])
        self.assertEqual(summary["stages"][4]["semantic_type"], "won")

        self.stage("closed_lost").position = -1
        self.stage("lead").label = "Inbound"
        self.db.commit()
        stages = self.summary()["stages"]
        self.assertEqual(stages[0]["stage_key"], "closed_lost")
        self.assertEqual(next(row for row in stages if row["stage_key"] == "lead")["label"], "Inbound")

    def test_an_inactive_stage_is_shown_only_while_deals_sit_in_it(self):
        self.stage("negotiation").is_active = False
        self.db.commit()
        self.assertNotIn("negotiation", [row["stage_key"] for row in self.summary()["stages"]])

        self.stage("negotiation").is_active = True
        self.db.commit()
        self.deal("negotiation", value="250")
        self.stage("negotiation").is_active = False
        self.db.commit()
        row = next(row for row in self.summary()["stages"] if row["stage_key"] == "negotiation")
        self.assertFalse(row["is_active"])
        self.assertEqual((row["count"], row["total_value"]), (1, 250.0))

    def test_counts_are_keyed_by_stage_row(self):
        self.deal("proposal", value="10")
        self.deal("proposal", value="5")
        self.create(total_cost_of_project="7")
        summary = self.summary()
        stages = {row["stage_key"]: row for row in summary["stages"]}
        self.assertEqual((stages["proposal"]["count"], stages["proposal"]["total_value"]), (2, 15.0))
        self.assertEqual(stages["unstaged"]["count"], 1)
        self.assertEqual(summary["total_count"], 3)


class StageEventTests(BusinessLogicFixture):
    def emitted(self, before_key, after_key):
        opportunity = self.deal(before_key) if before_key else self.create()
        before_state = opportunities_routes._serialize_opportunity(opportunity)
        opportunities_services.update_opportunity_stage(self.db, opportunity, sales_stage=after_key)
        with patch.object(opportunities_routes, "safe_emit_crm_event") as emit:
            opportunities_routes._emit_stage_events(self.db, current_user=self.user, before_state=before_state, opportunity=opportunity)
        return {call.kwargs["event_type"]: call.kwargs["payload"] for call in emit.call_args_list}

    def test_stage_change_payload_carries_stable_identity_and_meaning(self):
        events = self.emitted("lead", "proposal")
        payload = events["opportunity.stage_changed"]
        self.assertEqual(set(events), {"opportunity.stage_changed"})
        self.assertEqual(payload["stage"], "proposal")
        self.assertEqual(payload["sales_stage"], "proposal")
        self.assertEqual(payload["stage_id"], self.stage("proposal").id)
        self.assertEqual(payload["stage_semantic_type"], "ongoing")
        self.assertEqual(payload["previous_stage_semantic_type"], "open")
        self.assertEqual(payload["field_changes"]["sales_stage"], {"from": "lead", "to": "proposal"})

    def test_entering_won_or_lost_emits_the_outcome_event_once(self):
        self.assertIn("opportunity.won", self.emitted("negotiation", "closed_won"))
        self.assertIn("opportunity.lost", self.emitted(None, "closed_lost"))

        # Won to won (a second won stage) is not a second win.
        self.stage("negotiation").semantic_type = "won"
        self.db.commit()
        self.assertNotIn("opportunity.won", self.emitted("negotiation", "closed_won"))

    def test_the_stage_condition_now_matches_stage_change_events(self):
        payload = self.emitted("lead", "closed_won")["opportunity.stage_changed"]
        data = automation_rules._event_input(SimpleNamespace(id=1, event_type="opportunity.stage_changed", entity_type="sales_opportunity", entity_id=1, actor_user_id=1, payload=payload))
        self.assertTrue(automation_rules._condition_matches(data, {"field": "payload.sales_stage", "operator": "equals", "value": "closed_won"}))
        self.assertTrue(automation_rules._condition_matches(data, {"field": "payload.sales_stage", "operator": "changed_to", "value": "closed_won"}))
        self.assertTrue(automation_rules._condition_matches(data, {"field": "payload.stage_semantic_type", "operator": "equals", "value": "won"}))

    def test_outcome_triggers_and_the_semantic_condition_are_registered(self):
        from app.modules.platform.services.crm_events import CRM_EVENT_TYPES

        self.assertTrue({"opportunity.won", "opportunity.lost"} <= CRM_EVENT_TYPES)
        keys = {field.key for field in automation_registry.condition_fields_for_trigger("opportunity.stage_changed")}
        self.assertIn("stage_semantic_type", keys)


class DisplayTests(BusinessLogicFixture):
    def test_user_facing_text_shows_the_label_not_the_key(self):
        opportunity = self.deal("closed_won", opportunity_name="Acme renewal")
        self.stage("closed_won").label = "Signed"
        self.db.commit()
        self.db.refresh(opportunity)

        self.assertEqual(mail_services._opportunity_token_values(opportunity)["stage"], "Signed")
        self.assertEqual(mail_services._opportunity_token_values(self.create())["stage"], "")
        with patch.object(global_search, "apply_ranked_search", side_effect=lambda query, **_: query):
            hits = global_search._opportunity_results(self.db, tenant_id=TENANT, query="Acme", limit=5)
        hit = next(item for item in hits if item["title"] == "Acme renewal")
        self.assertIn("Signed", hit["subtitle"])
        self.assertNotIn("closed_won", hit["subtitle"])


if __name__ == "__main__":
    unittest.main()
