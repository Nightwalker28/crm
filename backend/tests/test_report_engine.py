"""Reports v2 (docs/crm-evolution/11-reports.md, Phase 1): the engine, sharing, templates.

Each acceptance line in §5 Phase 1 has a test here. Module access is patched open: the
three access layers are covered by their own tests, and what matters here is that the
engine never widens what the base query lets a viewer see.
"""

import unittest
from datetime import date
from io import BytesIO
from xml.etree import ElementTree
from zipfile import ZipFile
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.platform.models import ActivityLog, UserModuleReport
from app.modules.platform.services import module_reports, report_catalog, report_dashboards, report_engine
from app.modules.platform.services.report_templates import REPORT_TEMPLATES
from app.modules.sales.models import SalesOpportunity, SalesOrganization
from app.modules.sales.services import pipelines_services
from app.modules.tasks.models import Task
from app.modules.user_management.models import Team, User, UserStatus
from tests.test_sales_pipelines import OTHER_TENANT, TENANT, PipelineFixture


def _summary(groupings, measures=None, **extra):
    return {"version": 2, "format": "summary", "groupings": groupings, "measures": measures or [{"aggregate": "count"}], **extra}


class ReportFixture(PipelineFixture):
    def setUp(self):
        super().setUp()
        self.access = patch.object(report_catalog, "require_role_module_action_access")
        self.access.start()
        self.addCleanup(self.access.stop)
        self.db.add_all([
            Team(id=7, tenant_id=TENANT, name="Enterprise"),
            User(id=1, tenant_id=TENANT, team_id=7, email="ada@example.com", first_name="Ada", last_name="Lovelace", is_active=UserStatus.active),
            User(id=2, tenant_id=TENANT, team_id=7, email="grace@example.com", first_name="Grace", last_name="Hopper", is_active=UserStatus.active),
            User(id=3, tenant_id=TENANT, email="alan@example.com", first_name="Alan", is_active=UserStatus.active),
            User(id=9, tenant_id=OTHER_TENANT, email="rival@example.com", first_name="Rival", is_active=UserStatus.active),
            SalesOrganization(org_id=50, tenant_id=TENANT, org_name="Acme"),
        ])
        self.db.commit()
        pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        self.db.commit()
        self.ada = SimpleNamespace(id=1, tenant_id=TENANT, team_id=7, timezone="UTC")
        self.grace = SimpleNamespace(id=2, tenant_id=TENANT, team_id=7, timezone="UTC")
        self.alan = SimpleNamespace(id=3, tenant_id=TENANT, team_id=None, timezone="UTC")
        self.rival = SimpleNamespace(id=9, tenant_id=OTHER_TENANT, team_id=None, timezone="UTC")
        self.next_id = 1

    def deal(self, stage, *, owner=1, value="1000", close=date(2026, 8, 15), tenant_id=TENANT, **extra):
        self.next_id += 1
        self.db.add(SalesOpportunity(
            opportunity_id=self.next_id, tenant_id=tenant_id, opportunity_name=f"Deal {self.next_id}",
            sales_stage=stage, assigned_to=owner, amount=value, expected_close_date=close, **{"organization_id": 1, **extra},
        ))
        self.db.commit()
        return self.next_id

    def run_report(self, config, user=None, module_key="sales_opportunities"):
        return report_engine.run_report(self.db, user or self.ada, module_key=module_key, config=config)

    def stage_label(self, key):
        pipeline = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        return next(stage.label for stage in pipeline.stages if stage.key == key)


class GroupingTests(ReportFixture):
    def test_owner_groups_show_names_not_ids(self):
        self.deal("lead", owner=1)
        self.deal("lead", owner=1)
        self.deal("lead", owner=2)
        self.deal("lead", owner=None)
        result = self.run_report(_summary([{"field": "assigned_to"}]))
        self.assertEqual([row["labels"][0] for row in result["rows"]], ["Ada Lovelace", "Grace Hopper", "Unassigned"])
        self.assertEqual([row["count"] for row in result["rows"]], [2, 1, 1])
        self.assertEqual(result["totals"]["count"], 4)

    def test_stages_follow_pipeline_order_with_their_labels(self):
        for stage in ["closed_won", "lead", "lead", "lead", "proposal"]:
            self.deal(stage)
        result = self.run_report(_summary([{"field": "sales_stage"}]))
        self.assertEqual([row["keys"][0] for row in result["rows"]], ["lead", "proposal", "closed_won"])
        self.assertEqual(result["rows"][0]["labels"][0], self.stage_label("lead"))

    def test_the_deal_amount_is_a_number_that_sums(self):
        self.deal("lead", value="1000")
        self.deal("lead", value="250.50")
        self.deal("lead", value=None)
        result = self.run_report(_summary([{"field": "sales_stage"}], [{"aggregate": "sum", "field": "amount"}, {"aggregate": "avg", "field": "amount"}]))
        self.assertEqual(result["measures"][0]["label"], "Amount")
        self.assertEqual(result["rows"][0]["values"][0], 1250.5)
        self.assertEqual(result["totals"]["values"][0], 1250.5)

    def test_month_groups_are_one_per_month_in_date_order(self):
        for day in [date(2026, 3, 2), date(2026, 1, 9), date(2026, 1, 30), date(2026, 3, 31)]:
            self.deal("lead", close=day)
        self.deal("lead", close=None)
        result = self.run_report(_summary([{"field": "expected_close_date", "granularity": "month"}]))
        self.assertEqual([row["keys"][0] for row in result["rows"]], ["2026-01", "2026-03", "__empty__"])
        self.assertEqual([row["labels"][0] for row in result["rows"]], ["Jan 2026", "Mar 2026", "No date"])

    def test_quarter_and_week_buckets(self):
        self.deal("lead", close=date(2026, 8, 15))
        self.deal("lead", close=date(2026, 10, 1))
        quarters = self.run_report(_summary([{"field": "expected_close_date", "granularity": "quarter"}]))
        self.assertEqual([row["labels"][0] for row in quarters["rows"]], ["Q3 2026", "Q4 2026"])
        weeks = self.run_report(_summary([{"field": "expected_close_date", "granularity": "week"}]))
        # 15 Aug 2026 is a Saturday; its week starts Monday 10 Aug.
        self.assertEqual(weeks["rows"][0]["keys"][0], "2026-08-10")
        self.assertEqual(weeks["rows"][0]["labels"][0], "Week of 10 Aug 2026")

    def test_a_matrix_has_row_groups_column_groups_and_subtotals(self):
        self.deal("lead", owner=1)
        self.deal("proposal", owner=1)
        self.deal("lead", owner=2)
        result = self.run_report({**_summary([{"field": "assigned_to"}, {"field": "sales_stage"}]), "format": "matrix"})
        self.assertEqual([group["label"] for group in result["row_groups"]], ["Ada Lovelace", "Grace Hopper"])
        self.assertEqual([group["key"] for group in result["column_groups"]], ["lead", "proposal"])
        self.assertEqual({tuple(row["keys"]): row["count"] for row in result["rows"]}, {("1", "lead"): 1, ("1", "proposal"): 1, ("2", "lead"): 1})
        self.assertEqual([row["count"] for row in result["subtotals"]], [2, 1])

    def test_another_tenants_records_never_count(self):
        self.deal("lead")
        self.deal("lead", tenant_id=OTHER_TENANT, owner=9)
        self.assertEqual(self.run_report(_summary([{"field": "sales_stage"}]))["totals"]["count"], 1)
        self.assertEqual(self.run_report(_summary([{"field": "sales_stage"}]), user=self.rival)["totals"]["count"], 1)


class FilterTests(ReportFixture):
    def test_relative_ranges_resolve_in_the_viewers_calendar(self):
        today = date(2026, 1, 14)  # a Wednesday
        resolve = report_engine.resolve_date_range
        self.assertEqual(resolve("this_quarter", today), (date(2026, 1, 1), date(2026, 3, 31)))
        self.assertEqual(resolve("last_quarter", today), (date(2025, 10, 1), date(2025, 12, 31)))
        self.assertEqual(resolve("next_quarter", today), (date(2026, 4, 1), date(2026, 6, 30)))
        self.assertEqual(resolve("last_month", today), (date(2025, 12, 1), date(2025, 12, 31)))
        self.assertEqual(resolve("this_week", today), (date(2026, 1, 12), date(2026, 1, 18)))
        self.assertEqual(resolve("last_30_days", today), (date(2025, 12, 16), date(2026, 1, 14)))

    def test_a_saved_range_is_relative_not_the_dates_it_was_saved_with(self):
        self.deal("lead", close=date(2026, 8, 1))
        self.deal("lead", close=date(2026, 11, 1))
        config = _summary([{"field": "sales_stage"}], date_filter={"field": "expected_close_date", "range": "this_quarter"})
        normalized = report_engine.normalize_config(self.db, self.ada, *report_catalog.resolve_source(self.db, self.ada, "sales_opportunities"), config)
        self.assertEqual(normalized["date_filter"], {"field": "expected_close_date", "range": "this_quarter", "start": None, "end": None})
        for today, expected in [(date(2026, 8, 20), 1), (date(2026, 10, 20), 1), (date(2027, 1, 20), 0)]:
            with patch.object(report_engine, "_today", return_value=today):
                self.assertEqual(self.run_report(config)["totals"]["count"], expected)

    def test_show_me_mine_and_my_team(self):
        self.deal("lead", owner=1)
        self.deal("lead", owner=2)
        self.deal("lead", owner=3)
        config = _summary([{"field": "assigned_to"}])
        self.assertEqual(self.run_report({**config, "scope": "mine"})["totals"]["count"], 1)
        self.assertEqual(self.run_report({**config, "scope": "my_team"})["totals"]["count"], 2)
        # A viewer with no team gets their own records for "My team".
        self.assertEqual(self.run_report({**config, "scope": "my_team"}, user=self.alan)["totals"]["count"], 1)

    def test_conditions_apply_to_any_report_field(self):
        self.deal("lead", value="500")
        self.deal("lead", value="5000")
        config = _summary([{"field": "sales_stage"}], filters={"all_conditions": [{"field": "amount", "operator": "gt", "value": "1000"}]})
        self.assertEqual(self.run_report(config)["totals"]["count"], 1)


class DrillDownTests(ReportFixture):
    def test_a_group_lists_exactly_its_records_with_links(self):
        mine = self.deal("lead", owner=1, organization_id=50)
        self.deal("proposal", owner=1)
        self.deal("lead", owner=2)
        config = _summary([{"field": "assigned_to"}, {"field": "sales_stage"}])
        records = report_engine.run_records(self.db, self.ada, module_key="sales_opportunities", config=config, group_keys=["1", "lead"])
        self.assertEqual(records["total"], 1)
        [record] = records["records"]
        self.assertEqual(record["id"], mine)
        self.assertEqual(record["path"], f"/dashboard/sales/opportunities/{mine}")
        self.assertEqual(record["values"]["organization_id"], "Acme")
        self.assertEqual(record["values"]["assigned_to"], "Ada Lovelace")
        outer = report_engine.run_records(self.db, self.ada, module_key="sales_opportunities", config=config, group_keys=["1"])
        self.assertEqual(outer["total"], 2)

    def test_the_empty_group_and_date_buckets_drill(self):
        self.deal("lead", owner=None, close=date(2026, 3, 9))
        self.deal("lead", owner=1, close=date(2026, 4, 9))
        by_owner = _summary([{"field": "assigned_to"}])
        self.assertEqual(report_engine.run_records(self.db, self.ada, module_key="sales_opportunities", config=by_owner, group_keys=["__empty__"])["total"], 1)
        by_month = _summary([{"field": "expected_close_date", "granularity": "month"}])
        self.assertEqual(report_engine.run_records(self.db, self.ada, module_key="sales_opportunities", config=by_month, group_keys=["2026-03"])["total"], 1)

    def test_a_tabular_report_lists_chosen_columns_in_the_chosen_order(self):
        self.deal("lead", value="300")
        self.deal("lead", value="100")
        self.deal("lead", value="200")
        config = {"version": 2, "format": "tabular", "columns": ["opportunity_name", "amount"], "sort": {"by": "amount", "direction": "asc"}}
        result = self.run_report(config)
        # The name is the record's label, so it is not repeated as a column.
        self.assertEqual([column["key"] for column in result["records"]["columns"]], ["amount"])
        self.assertEqual(result["records"]["records"][0]["label"], "Deal 3")
        self.assertEqual([record["values"]["amount"] for record in result["records"]["records"]], [100.0, 200.0, 300.0])
        csv_text = report_engine.report_csv_bytes(self.db, self.ada, module_key="sales_opportunities", config=config).decode()
        self.assertEqual(csv_text.splitlines()[0], "Name,Amount")

    def test_grouped_csv_has_a_total_row(self):
        self.deal("lead", value="100")
        self.deal("proposal", value="50")
        config = _summary([{"field": "sales_stage"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "amount"}])
        lines = report_engine.report_csv_bytes(self.db, self.ada, module_key="sales_opportunities", config=config).decode().splitlines()
        self.assertEqual(lines[0], "Stage,Records,Amount")
        self.assertEqual(lines[-1], "Total,2,150.0")

    def test_xlsx_uses_report_labels_and_numeric_cells(self):
        self.deal("lead", value="100")
        config = _summary([{"field": "sales_stage"}], [{"aggregate": "count"}, {"aggregate": "sum", "field": "amount"}])
        with ZipFile(BytesIO(report_engine.report_xlsx_bytes(self.db, self.ada, module_key="sales_opportunities", config=config))) as workbook:
            xml = ElementTree.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        rows = xml.findall(".//x:row", ns)
        self.assertEqual([cell.findtext(".//x:t", namespaces=ns) for cell in rows[0]], ["Stage", "Records", "Amount"])
        self.assertEqual(rows[1][0].findtext(".//x:t", namespaces=ns), self.stage_label("lead"))
        self.assertEqual([cell.findtext("x:v", namespaces=ns) for cell in rows[1][1:]], ["1", "100.0"])
        self.assertEqual(rows[-1][0].findtext(".//x:t", namespaces=ns), "Total")


class DefinitionTests(ReportFixture):
    def normalize(self, config, module_key="sales_opportunities"):
        source, fields = report_catalog.resolve_source(self.db, self.ada, module_key)
        return report_engine.normalize_config(self.db, self.ada, source, fields, config)

    def test_structural_mistakes_are_refused(self):
        with self.assertRaises(HTTPException):
            self.normalize({"version": 2, "format": "matrix", "groupings": [{"field": "sales_stage"}]})
        with self.assertRaises(HTTPException):
            self.normalize(_summary([{"field": "sales_stage"}], [{"aggregate": "sum", "field": "opportunity_name"}]))

    def test_unknown_fields_drop_out_instead_of_failing(self):
        normalized = self.normalize(_summary([{"field": "gone"}, {"field": "sales_stage"}], columns=["gone", "opportunity_name"]))
        self.assertEqual(normalized["groupings"], [{"field": "sales_stage", "granularity": None}])
        self.assertEqual(normalized["columns"], ["opportunity_name"])

    def test_a_version_1_config_reads_as_version_2(self):
        normalized = self.normalize({"dimension": "expected_close_date", "metric": "sum", "metric_field": "amount", "view_mode": "pie", "filters": {}})
        self.assertEqual(normalized["groupings"], [{"field": "expected_close_date", "granularity": "month"}])
        self.assertEqual(normalized["measures"], [{"aggregate": "sum", "field": "amount"}])
        self.assertEqual(normalized["chart"], {"type": "donut"})
        contacts = self.normalize({"dimension": "organization_name", "metric": "count"}, module_key="sales_contacts")
        self.assertEqual(contacts["groupings"][0]["field"], "organization_id")

    def test_the_version_1_endpoint_keeps_its_shape(self):
        self.deal("lead", owner=1)
        self.deal("lead", owner=2)
        result = module_reports.generate_module_report(
            self.db, self.ada, module_key="sales_opportunities", dimension_key="assigned_to", metric="count",
            metric_field_key=None, search=None, all_conditions=[], any_conditions=[], limit=10,
        )
        self.assertEqual(set(result), {"module_key", "label", "dimension", "metric", "metric_field", "total_count", "rows"})
        self.assertEqual(result["dimension"], {"key": "assigned_to", "label": "Owner", "field_type": "text"})
        self.assertEqual({row["label"] for row in result["rows"]}, {"Ada Lovelace", "Grace Hopper"})

    def test_every_template_is_a_valid_definition(self):
        templates = module_reports.list_report_templates(self.db, self.ada)
        self.assertEqual({t["key"] for t in templates}, {t["key"] for t in REPORT_TEMPLATES})
        for template in templates:
            self.run_report(template["config"], module_key=template["module_key"])


class SharingTests(ReportFixture):
    def save(self, user, name="Pipeline", visibility="private"):
        return module_reports.create_saved_report(
            self.db, user, module_key="sales_opportunities", name=name, visibility=visibility,
            config=_summary([{"field": "sales_stage"}]), description="By stage",
        )

    def test_private_reports_are_the_owners_alone(self):
        report = self.save(self.ada)
        self.assertEqual(report["visibility"], "private")
        self.assertTrue(report["can_edit"])
        self.assertEqual(module_reports.list_saved_reports(self.db, self.grace), [])
        with self.assertRaises(HTTPException) as caught:
            module_reports.get_saved_report(self.db, self.grace, report_id=report["id"])
        self.assertEqual(caught.exception.status_code, 404)

    def test_a_shared_report_is_listed_and_readable_but_only_the_owner_changes_it(self):
        report = self.save(self.ada, visibility="everyone")
        [listed] = module_reports.list_saved_reports(self.db, self.grace, scope="shared")
        self.assertEqual((listed["owner_name"], listed["can_edit"]), ("Ada Lovelace", False))
        self.assertEqual(module_reports.list_saved_reports(self.db, self.grace, scope="mine"), [])
        for change in (
            lambda: module_reports.update_saved_report(self.db, self.grace, report_id=report["id"], name="Mine now"),
            lambda: module_reports.delete_saved_report(self.db, self.grace, report_id=report["id"]),
        ):
            with self.assertRaises(HTTPException) as caught:
                change()
            self.assertEqual(caught.exception.status_code, 403)

    def test_a_shared_report_shows_each_viewer_only_their_records(self):
        """The report is a definition, not a copy of the data: what a viewer sees is what the
        module's own base query lets them see. Tasks are private to their people below admin."""
        self.db.add_all([
            Task(tenant_id=TENANT, title="Ada's", status="todo", priority="high", created_by_user_id=1),
            Task(tenant_id=TENANT, title="Ada's too", status="todo", priority="low", created_by_user_id=1),
            Task(tenant_id=TENANT, title="Grace's", status="todo", priority="high", created_by_user_id=2),
        ])
        self.db.commit()
        report = module_reports.create_saved_report(
            self.db, self.ada, module_key="tasks", name="Tasks", visibility="everyone",
            config=_summary([{"field": "priority"}]),
        )
        self.assertEqual(self.run_report(report["config"], user=self.ada, module_key="tasks")["totals"]["count"], 2)
        self.assertEqual(self.run_report(report["config"], user=self.grace, module_key="tasks")["totals"]["count"], 1)
        records = report_engine.run_records(self.db, self.grace, module_key="tasks", config=report["config"], group_keys=["high"])
        self.assertEqual([record["label"] for record in records["records"]], ["Grace's"])
        self.assertIsNone(records["records"][0]["path"])

    def test_another_tenant_cannot_see_a_shared_report(self):
        report = self.save(self.ada, visibility="everyone")
        self.assertEqual(module_reports.list_saved_reports(self.db, self.rival), [])
        with self.assertRaises(HTTPException) as caught:
            module_reports.get_saved_report(self.db, self.rival, report_id=report["id"])
        self.assertEqual(caught.exception.status_code, 404)

    def test_sharing_is_written_to_the_activity_log(self):
        report = self.save(self.ada)
        module_reports.update_saved_report(self.db, self.ada, report_id=report["id"], visibility="everyone")
        module_reports.delete_saved_report(self.db, self.ada, report_id=report["id"])
        entries = self.db.query(ActivityLog).filter(ActivityLog.entity_type == "saved_report").order_by(ActivityLog.id).all()
        self.assertEqual([entry.action for entry in entries], ["create", "update", "delete"])
        self.assertEqual(entries[1].description, "Shared report Pipeline with everyone")
        self.assertIsNone(self.db.get(UserModuleReport, report["id"]))

    def test_names_are_unique_per_owner(self):
        self.save(self.ada)
        with self.assertRaises(HTTPException) as caught:
            self.save(self.ada)
        self.assertEqual(caught.exception.status_code, 409)
        self.save(self.grace)



class DashboardTests(ReportFixture):
    """Phase 2: a dashboard holds report IDs and resolves them for whoever opens it."""

    def report(self, user, name, visibility="private"):
        return module_reports.create_saved_report(
            self.db, user, module_key="sales_opportunities", name=name, visibility=visibility,
            config=_summary([{"field": "sales_stage"}]),
        )

    def widget(self, report_id, widget_id="w1", **extra):
        return {"id": widget_id, "type": "chart", "size": "medium", "report_id": report_id, **extra}

    def test_each_widget_resolves_for_the_person_opening_it(self):
        private = self.report(self.ada, "Private")
        shared = self.report(self.ada, "Shared", visibility="everyone")
        doomed = self.report(self.ada, "Doomed", visibility="everyone")
        dashboard = report_dashboards.create_dashboard(
            self.db, self.ada, name="Sales", visibility="everyone",
            widgets=[self.widget(private["id"], "a"), self.widget(shared["id"], "b"), self.widget(doomed["id"], "c", type="kpi", target=5000)],
            filters={"date_range": "this_quarter", "scope": "mine"},
        )
        module_reports.delete_saved_report(self.db, self.ada, report_id=doomed["id"])

        mine = report_dashboards.get_dashboard(self.db, self.ada, dashboard_id=dashboard["id"])
        self.assertEqual([w["unavailable_reason"] for w in mine["widgets"]], [None, None, "missing"])
        theirs = report_dashboards.get_dashboard(self.db, self.grace, dashboard_id=dashboard["id"])
        self.assertEqual([w["unavailable_reason"] for w in theirs["widgets"]], ["not_shared", None, "missing"])
        self.assertIsNone(theirs["widgets"][0]["report"])
        self.assertEqual(theirs["widgets"][1]["report"]["name"], "Shared")
        self.assertFalse(theirs["can_edit"])
        self.assertEqual(theirs["filters"], {"date_range": "this_quarter", "scope": "mine"})

    def test_a_widget_cannot_point_at_a_report_its_owner_cannot_see(self):
        graces = self.report(self.grace, "Grace's")
        with self.assertRaises(HTTPException) as caught:
            report_dashboards.create_dashboard(self.db, self.ada, name="Sales", widgets=[self.widget(graces["id"])])
        self.assertEqual(caught.exception.status_code, 400)

    def test_widgets_and_filters_are_validated(self):
        report = self.report(self.ada, "Pipeline")
        for widgets in (
            [self.widget(report["id"]), self.widget(report["id"])],
            [self.widget(report["id"], type="gauge")],
            [self.widget(report["id"], type="kpi", target=-1)],
            [self.widget(report["id"], f"w{index}") for index in range(25)],
        ):
            with self.assertRaises(HTTPException):
                report_dashboards.create_dashboard(self.db, self.ada, name="Bad", widgets=widgets)
        with self.assertRaises(HTTPException):
            report_dashboards.create_dashboard(self.db, self.ada, name="Bad", filters={"date_range": "custom"})
        dashboard = report_dashboards.create_dashboard(self.db, self.ada, name="Fine", widgets=[self.widget(report["id"], type="kpi", chart_type="line", target=10)])
        [widget] = dashboard["widgets"]
        self.assertEqual((widget["chart_type"], widget["target"]), (None, 10.0))
        self.assertEqual(dashboard["filters"], {"date_range": "report", "scope": "report"})

    def test_only_the_owner_changes_it_and_other_tenants_never_see_it(self):
        dashboard = report_dashboards.create_dashboard(self.db, self.ada, name="Sales", visibility="everyone")
        [listed] = report_dashboards.list_dashboards(self.db, self.grace, scope="shared")
        self.assertEqual(listed["owner_name"], "Ada Lovelace")
        for change in (
            lambda: report_dashboards.update_dashboard(self.db, self.grace, dashboard_id=dashboard["id"], fields_set={"name"}, name="Mine"),
            lambda: report_dashboards.delete_dashboard(self.db, self.grace, dashboard_id=dashboard["id"]),
        ):
            with self.assertRaises(HTTPException) as caught:
                change()
            self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(report_dashboards.list_dashboards(self.db, self.rival), [])
        with self.assertRaises(HTTPException) as caught:
            report_dashboards.get_dashboard(self.db, self.rival, dashboard_id=dashboard["id"])
        self.assertEqual(caught.exception.status_code, 404)

    def test_private_dashboards_stay_private_and_names_are_unique_per_owner(self):
        report_dashboards.create_dashboard(self.db, self.ada, name="Sales")
        self.assertEqual(report_dashboards.list_dashboards(self.db, self.grace), [])
        with self.assertRaises(HTTPException) as caught:
            report_dashboards.create_dashboard(self.db, self.ada, name="Sales")
        self.assertEqual(caught.exception.status_code, 409)
        report_dashboards.create_dashboard(self.db, self.grace, name="Sales")

    def test_sharing_a_dashboard_is_logged(self):
        dashboard = report_dashboards.create_dashboard(self.db, self.ada, name="Sales")
        report_dashboards.update_dashboard(self.db, self.ada, dashboard_id=dashboard["id"], fields_set={"visibility"}, visibility="everyone")
        report_dashboards.delete_dashboard(self.db, self.ada, dashboard_id=dashboard["id"])
        entries = self.db.query(ActivityLog).filter(ActivityLog.entity_type == "report_dashboard").order_by(ActivityLog.id).all()
        self.assertEqual([entry.action for entry in entries], ["create", "update", "delete"])
        self.assertEqual(entries[1].description, "Shared dashboard Sales with everyone")


if __name__ == "__main__":
    unittest.main()
