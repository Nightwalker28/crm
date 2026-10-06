"""Configurable sales pipelines (04-pipelines-kanban, Phase 1).

Phase 1 adds pipeline/stage tables, seeds each tenant's default pipeline from the
legacy stage catalog, and resolves a stored `sales_stage` to its stage row by key.
No Opportunity reference exists yet, so nothing a client sees may change.
"""

import importlib.util
import unittest
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import SalesOpportunity, SalesPipeline, SalesPipelineStage
from app.modules.sales.opportunity_stages import (
    OPPORTUNITY_CLOSED_STAGE_SET,
    OPPORTUNITY_PIPELINE_MODULE_KEY,
    OPPORTUNITY_STAGE_DEFAULT_PROBABILITIES,
    OPPORTUNITY_STAGE_ORDER,
    OPPORTUNITY_STAGE_SEMANTIC_TYPES,
    PIPELINE_STAGE_SEMANTIC_SET,
    default_opportunity_pipeline_stages,
)
from app.modules.sales.routes import opportunities_routes
from app.modules.sales.services import pipelines_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant

TENANT = 10
OTHER_TENANT = 99

MIGRATION_PATH = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "20260817_sales_pipelines.py"


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("sales_pipelines_revision", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load_migration_module()


def _sqlite_engine():
    engine = create_engine("sqlite:///:memory:")

    # pysqlite opens transactions lazily and breaks SAVEPOINT; take them over so
    # the resolver's nested transaction behaves as it does on PostgreSQL.
    @event.listens_for(engine, "connect")
    def _no_pysqlite_transactions(dbapi_connection, _record):
        dbapi_connection.isolation_level = None

    @event.listens_for(engine, "begin")
    def _begin(connection):
        connection.exec_driver_sql("BEGIN")

    Base.metadata.create_all(engine)
    return engine


class PipelineFixture(unittest.TestCase):
    def setUp(self):
        self.engine = _sqlite_engine()
        self.db = sessionmaker(bind=self.engine)()
        self.db.add_all(
            [
                Tenant(id=TENANT, slug="default", name="Default"),
                Tenant(id=OTHER_TENANT, slug="rival", name="Rival"),
            ]
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def make_opportunity(self, opportunity_id, *, tenant_id=TENANT, sales_stage=None):
        self.db.add(
            SalesOpportunity(
                organization_id=1,
                opportunity_id=opportunity_id,
                tenant_id=tenant_id,
                opportunity_name=f"Deal {opportunity_id}",
                sales_stage=sales_stage,
            )
        )
        self.db.commit()

    def pipelines(self, tenant_id=TENANT):
        return self.db.query(SalesPipeline).filter(SalesPipeline.tenant_id == tenant_id).all()


class CatalogTests(unittest.TestCase):
    def test_every_legacy_stage_has_a_semantic_type_and_probability(self):
        for key in OPPORTUNITY_STAGE_ORDER:
            self.assertIn(OPPORTUNITY_STAGE_SEMANTIC_TYPES[key], PIPELINE_STAGE_SEMANTIC_SET)
            self.assertIn(key, OPPORTUNITY_STAGE_DEFAULT_PROBABILITIES)

    def test_closed_semantics_match_the_legacy_closed_set(self):
        closed = {key for key, semantic in OPPORTUNITY_STAGE_SEMANTIC_TYPES.items() if semantic in {"won", "lost"}}
        self.assertEqual(closed, OPPORTUNITY_CLOSED_STAGE_SET)

    def test_forecast_weights_are_unchanged(self):
        """The weights the forecast hardcoded before pipelines existed."""

        self.assertEqual(
            {key: pipelines_services.legacy_stage_facts(key).probability for key in OPPORTUNITY_STAGE_ORDER},
            {
                "lead": Decimal("10"),
                "qualified": Decimal("25"),
                "proposal": Decimal("50"),
                "negotiation": Decimal("75"),
                "closed_won": Decimal("100"),
                "closed_lost": Decimal("0"),
            },
        )
        self.assertEqual(pipelines_services.legacy_stage_facts(None).probability, Decimal("10"))
        self.assertEqual(pipelines_services.legacy_stage_facts("mystery").key, "unstaged")

    def test_the_migration_seed_is_the_catalog_at_this_revision(self):
        self.assertEqual(
            [
                (key, label, position, semantic, Decimal(probability))
                for key, label, position, semantic, probability in MIGRATION.SEED_STAGES
            ],
            [
                (row["key"], row["label"], row["position"], row["semantic_type"], row["probability"])
                for row in default_opportunity_pipeline_stages()
            ],
        )


class MigrationSchemaTests(unittest.TestCase):
    def test_revision_id_fits_the_alembic_version_column(self):
        self.assertLessEqual(len(MIGRATION.revision), 32)
        self.assertEqual(MIGRATION.down_revision, "20260816_opp_participants")

    def test_the_revision_creates_every_column_and_index_the_models_map(self):
        source = MIGRATION_PATH.read_text()
        for model in (SalesPipeline, SalesPipelineStage):
            for column in model.__table__.columns:
                self.assertIn(f'"{column.name}"', source)
            for index in model.__table__.indexes:
                self.assertIn(index.name, source)
            for constraint in model.__table__.constraints:
                if constraint.name:
                    self.assertIn(constraint.name, source)


class BackfillTests(PipelineFixture):
    """Populated upgrade: every tenant gets one default pipeline with every legacy stage."""

    def run_seed(self):
        connection = self.db.connection()
        MIGRATION.seed_default_pipelines(connection)
        MIGRATION.assert_no_orphan_stage_values(connection)
        self.db.commit()

    def test_every_tenant_gets_one_default_pipeline_with_every_legacy_stage(self):
        for index, stage in enumerate(OPPORTUNITY_STAGE_ORDER):
            self.make_opportunity(100 + index, sales_stage=stage)
        self.make_opportunity(200, sales_stage=None)

        self.run_seed()

        for tenant_id in (TENANT, OTHER_TENANT):
            pipelines = self.pipelines(tenant_id)
            self.assertEqual(len(pipelines), 1)
            pipeline = pipelines[0]
            self.assertTrue(pipeline.is_default)
            self.assertTrue(pipeline.is_active)
            self.assertEqual(pipeline.module_key, OPPORTUNITY_PIPELINE_MODULE_KEY)
            self.assertEqual([stage.key for stage in pipeline.stages], OPPORTUNITY_STAGE_ORDER)
            self.assertTrue(all(stage.tenant_id == tenant_id for stage in pipeline.stages))
            self.assertEqual(
                {stage.key: stage.semantic_type for stage in pipeline.stages},
                OPPORTUNITY_STAGE_SEMANTIC_TYPES,
            )
            self.assertEqual(
                {stage.key: Decimal(stage.probability) for stage in pipeline.stages},
                OPPORTUNITY_STAGE_DEFAULT_PROBABILITIES,
            )

        # Every stored stage resolves to a stage row in its own tenant.
        for opportunity in self.db.query(SalesOpportunity).all():
            stage = pipelines_services.resolve_legacy_opportunity_stage(self.db, opportunity.tenant_id, opportunity.sales_stage)
            if opportunity.sales_stage is None:
                self.assertIsNone(stage)
            else:
                self.assertEqual(stage.key, opportunity.sales_stage)
                self.assertEqual(stage.tenant_id, opportunity.tenant_id)

    def test_seed_is_idempotent(self):
        self.run_seed()
        self.run_seed()
        self.assertEqual(len(self.pipelines()), 1)
        self.assertEqual(
            self.db.query(SalesPipelineStage).filter(SalesPipelineStage.tenant_id == TENANT).count(),
            len(OPPORTUNITY_STAGE_ORDER),
        )

    def test_an_orphan_stage_value_blocks_the_upgrade(self):
        self.run_seed()
        # Simulate a value that bypassed the check constraint.
        self.db.execute(text("PRAGMA ignore_check_constraints = ON"))
        self.make_opportunity(300, sales_stage="discovery")
        with self.assertRaisesRegex(RuntimeError, "discovery"):
            MIGRATION.assert_no_orphan_stage_values(self.db.connection())


class ResolverTests(PipelineFixture):
    def test_first_use_seeds_the_default_pipeline_once(self):
        first = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        self.db.commit()
        second = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        self.assertEqual(first.id, second.id)
        self.assertEqual(len(self.pipelines()), 1)
        self.assertEqual([stage.key for stage in first.stages], OPPORTUNITY_STAGE_ORDER)

    def test_a_second_default_for_the_same_tenant_is_rejected_by_the_database(self):
        pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        self.db.commit()
        self.db.add(SalesPipeline(tenant_id=TENANT, module_key=OPPORTUNITY_PIPELINE_MODULE_KEY, name="Second", is_default=True))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_a_non_default_pipeline_can_coexist_with_the_default(self):
        pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        self.db.add(SalesPipeline(tenant_id=TENANT, module_key=OPPORTUNITY_PIPELINE_MODULE_KEY, name="Renewals"))
        self.db.commit()
        self.assertEqual(len(self.pipelines()), 2)

    def test_an_inactive_pipeline_cannot_be_the_default(self):
        self.db.add(
            SalesPipeline(tenant_id=TENANT, module_key=OPPORTUNITY_PIPELINE_MODULE_KEY, name="Old", is_default=True, is_active=False)
        )
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_a_losing_concurrent_seed_returns_the_winners_pipeline(self):
        winner = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        self.db.commit()
        original = pipelines_services.get_default_opportunity_pipeline
        calls = {"count": 0}

        def stale_then_real(db, tenant_id):
            calls["count"] += 1
            return None if calls["count"] == 1 else original(db, tenant_id)

        pipelines_services.get_default_opportunity_pipeline = stale_then_real
        try:
            resolved = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        finally:
            pipelines_services.get_default_opportunity_pipeline = original
        self.assertEqual(resolved.id, winner.id)
        self.assertEqual(len(self.pipelines()), 1)

    def test_resolution_is_by_key_and_normalizes_legacy_spelling(self):
        self.assertEqual(pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, "Closed Won").key, "closed_won")
        self.assertEqual(pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, " proposal ").key, "proposal")
        self.assertIsNone(pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, None))
        self.assertIsNone(pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, "  "))
        self.assertIsNone(pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, "unstaged"))

    def test_a_renamed_label_does_not_change_resolution_or_semantics(self):
        pipeline = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        won = next(stage for stage in pipeline.stages if stage.key == "closed_won")
        won.label = "Signed"
        self.db.commit()

        stage = pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, "closed_won")
        self.assertEqual(stage.label, "Signed")
        self.assertTrue(pipelines_services.is_closed_stage(stage))
        self.assertIsNone(pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, "Signed"))

    def test_an_inactive_stage_still_resolves_for_history(self):
        pipeline = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        lead = next(stage for stage in pipeline.stages if stage.key == "lead")
        lead.is_active = False
        self.db.commit()

        stage = pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, "lead")
        self.assertEqual(stage.id, lead.id)
        self.assertFalse(stage.is_active)
        active_keys = [row["key"] for row in pipelines_services.serialize_pipeline(pipeline, include_inactive=False)["stages"]]
        self.assertNotIn("lead", active_keys)

    def test_resolution_never_crosses_tenants(self):
        mine = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        theirs = pipelines_services.ensure_default_opportunity_pipeline(self.db, OTHER_TENANT)
        self.assertNotEqual(mine.id, theirs.id)
        theirs_won = next(stage for stage in theirs.stages if stage.key == "closed_won")
        theirs_won.label = "Rival won"
        self.db.commit()

        stage = pipelines_services.resolve_legacy_opportunity_stage(self.db, TENANT, "closed_won")
        self.assertEqual(stage.tenant_id, TENANT)
        self.assertEqual(stage.pipeline_id, mine.id)
        self.assertEqual(stage.label, "Closed won")

    def test_serialized_pipeline_carries_semantics_so_clients_never_read_labels(self):
        pipeline = pipelines_services.ensure_default_opportunity_pipeline(self.db, TENANT)
        payload = pipelines_services.serialize_pipeline(pipeline)
        self.assertEqual([row["key"] for row in payload["stages"]], OPPORTUNITY_STAGE_ORDER)
        self.assertEqual(
            {row["key"] for row in payload["stages"] if row["is_closed"]},
            OPPORTUNITY_CLOSED_STAGE_SET,
        )
        self.assertEqual(payload["stages"][0]["probability"], 10.0)


class PipelineRouteTests(PipelineFixture):
    def test_route_seeds_and_returns_the_callers_tenant_pipeline_only(self):
        pipelines_services.ensure_default_opportunity_pipeline(self.db, OTHER_TENANT)
        self.db.commit()

        payload = opportunities_routes.get_sales_opportunity_pipeline(
            db=self.db,
            current_user=SimpleNamespace(id=1, tenant_id=TENANT),
            require_module=None,
            require_permission=None,
        )

        stored = self.pipelines(TENANT)
        self.assertEqual(len(stored), 1)
        self.assertEqual(payload["id"], stored[0].id)
        self.assertEqual(len(payload["stages"]), len(OPPORTUNITY_STAGE_ORDER))

    def test_route_requires_opportunity_view_and_precedes_the_dynamic_id_route(self):
        get_routes = [
            route
            for route in opportunities_routes.router.routes
            if "GET" in getattr(route, "methods", set())
        ]
        paths = [route.path for route in get_routes]
        self.assertLess(paths.index("/opportunities/pipeline"), paths.index("/opportunities/{opportunity_id}"))

        route = get_routes[paths.index("/opportunities/pipeline")]
        dependency_names = {dependency.call.__qualname__ for dependency in route.dependant.dependencies}
        self.assertIn("require_module_access.<locals>.checker", dependency_names)
        self.assertIn("require_action_access.<locals>.checker", dependency_names)
        # The action is `view`: reading the pipeline is part of reading deals.
        action_checker = next(
            dependency.call
            for dependency in route.dependant.dependencies
            if dependency.call.__qualname__ == "require_action_access.<locals>.checker"
        )
        closure = {cell.cell_contents for cell in action_checker.__closure__ or ()}
        self.assertIn("view", closure)
        self.assertIn("sales_opportunities", closure)

if __name__ == "__main__":
    unittest.main()
