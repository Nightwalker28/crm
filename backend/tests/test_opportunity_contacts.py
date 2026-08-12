"""Opportunity contact associations (05-relationships-data-model, Phase 1).

Phase 1 adds the association table and keeps it mirroring the legacy
`sales_opportunities.contact_id`. Nothing here may change what a single-contact
client already sees, so the tests pin both sides: the new participant
serialization, and the old primary-contact output next to it.
"""

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.sales.models import (
    SalesContact,
    SalesLead,
    SalesOpportunity,
    SalesOpportunityContact,
    SalesOrganization,
)
from app.modules.sales.opportunity_contact_roles import (
    DEFAULT_OPPORTUNITY_CONTACT_ROLE,
    OPPORTUNITY_CONTACT_ROLE_ORDER,
    OPPORTUNITY_CONTACT_ROLE_SET,
    opportunity_contact_role_label,
)
from app.modules.sales.schema import OpportunitySummaryResponse
from app.modules.sales.services import opportunity_contacts_services, summary_services
from app.modules.sales.services.leads_services import convert_sales_lead
from app.modules.sales.services.opportunities_services import create_opportunity, update_opportunity
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus

TENANT = 10
OTHER_TENANT = 99


VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MIGRATION_PATH = VERSIONS_DIR / "20260815_opportunity_contacts.py"
# Phase 2 made removal recoverable in a follow-up revision, so the model is now the
# sum of both. The drift checks below read the chain, not one file.
ASSOCIATION_MIGRATION_PATHS = [
    MIGRATION_PATH,
    VERSIONS_DIR / "20260816_opportunity_participants.py",
]


def _load_migration_module():
    """Import the revision file by path; `alembic/versions` is not a package."""

    spec = importlib.util.spec_from_file_location("opportunity_contacts_revision", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load_migration_module()


class AllowContactsPolicy:
    """Stands in for the real policy: Contacts is available and viewable."""

    def __init__(self, db=None, user=None):
        pass

    def can_view_module(self, module_key):
        return True

    def can_perform_action(self, module_key, action):
        return True


class DenyContactsPolicy(AllowContactsPolicy):
    def can_view_module(self, module_key):
        return module_key != "sales_contacts"

    def can_perform_action(self, module_key, action):
        return module_key != "sales_contacts"


class OpportunityContactFixture(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.db.add_all(
            [
                Tenant(id=TENANT, slug="default", name="Default"),
                Tenant(id=OTHER_TENANT, slug="rival", name="Rival"),
                User(
                    id=1,
                    tenant_id=TENANT,
                    email="ava@example.com",
                    first_name="Ava",
                    is_active=UserStatus.active,
                ),
                SalesOrganization(org_id=20, tenant_id=TENANT, org_name="Acme"),
                SalesContact(
                    contact_id=30,
                    tenant_id=TENANT,
                    first_name="Ada",
                    last_name="Byron",
                    primary_email="ada@acme.example",
                    organization_id=20,
                ),
                SalesContact(
                    contact_id=31,
                    tenant_id=TENANT,
                    first_name="Grace",
                    primary_email="grace@acme.example",
                    organization_id=20,
                ),
                # Same shape in another tenant, so isolation failures show up.
                SalesContact(contact_id=60, tenant_id=OTHER_TENANT, primary_email="rival@other.example"),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=TENANT)

    def tearDown(self):
        self.db.close()

    def make_opportunity(self, opportunity_id=40, *, contact_id=30, tenant_id=TENANT, **kwargs):
        opportunity = SalesOpportunity(
            opportunity_id=opportunity_id,
            tenant_id=tenant_id,
            opportunity_name=kwargs.pop("opportunity_name", "Acme Pilot"),
            client=kwargs.pop("client", "Ada Byron"),
            contact_id=contact_id,
            **kwargs,
        )
        self.db.add(opportunity)
        self.db.commit()
        return opportunity

    def links(self, opportunity_id=40):
        return (
            self.db.query(SalesOpportunityContact)
            .filter(SalesOpportunityContact.opportunity_id == opportunity_id)
            .order_by(SalesOpportunityContact.id.asc())
            .all()
        )


class RoleCatalogTests(unittest.TestCase):
    def test_catalog_is_the_single_source_for_labels_and_the_check_constraint(self):
        self.assertEqual(OPPORTUNITY_CONTACT_ROLE_SET, set(OPPORTUNITY_CONTACT_ROLE_ORDER))
        self.assertIn(DEFAULT_OPPORTUNITY_CONTACT_ROLE, OPPORTUNITY_CONTACT_ROLE_SET)
        constraint = next(
            item
            for item in SalesOpportunityContact.__table__.constraints
            if item.name == "ck_sales_opportunity_contacts_role"
        )
        for role in OPPORTUNITY_CONTACT_ROLE_ORDER:
            self.assertIn(f"'{role}'", str(constraint.sqltext))

    def test_a_role_that_left_the_catalog_still_renders_on_an_existing_association(self):
        self.assertEqual(opportunity_contact_role_label("champion"), "Champion")
        self.assertEqual(opportunity_contact_role_label("retired_role"), "retired_role")
        self.assertEqual(opportunity_contact_role_label(None), "Other")


class MigrationSchemaTests(unittest.TestCase):
    """Clean installation: the revision and the model must describe one table."""

    def test_revision_id_fits_the_alembic_version_column(self):
        self.assertLessEqual(len(MIGRATION.revision), 32)
        self.assertEqual(MIGRATION.down_revision, "20260814_mail_send")

    def test_a_clean_database_gets_the_columns_and_constraints_the_revision_declares(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        with engine.connect() as connection:
            columns = {
                row[1]
                for row in connection.execute(text("PRAGMA table_info(sales_opportunity_contacts)"))
            }
            indexes = {
                row[1]
                for row in connection.execute(text("PRAGMA index_list(sales_opportunity_contacts)"))
            }

        self.assertEqual(
            columns,
            {
                "id",
                "tenant_id",
                "opportunity_id",
                "contact_id",
                "role_key",
                "is_primary",
                "created_at",
                "created_by_user_id",
                "deleted_at",
                "deleted_by_user_id",
            },
        )
        self.assertIn("uq_sales_opportunity_contacts_primary", indexes)
        self.assertIn("ix_sales_opportunity_contacts_contact", indexes)

    def test_the_revisions_create_every_column_and_index_the_model_maps(self):
        source = "\n".join(path.read_text() for path in ASSOCIATION_MIGRATION_PATHS)
        for column in SalesOpportunityContact.__table__.columns:
            self.assertIn(f'"{column.name}"', source)
        for index in SalesOpportunityContact.__table__.indexes:
            self.assertIn(index.name, source)

    def test_the_primary_uniqueness_index_still_ignores_removal(self):
        """A removed association must not be able to sit on the primary flag.

        The Phase 2 revision deliberately leaves the partial unique index as
        `WHERE is_primary` rather than adding `AND deleted_at IS NULL`, which is
        what makes "the primary participant cannot be removed" a database
        guarantee and not only a service rule.
        """

        index = next(
            item
            for item in SalesOpportunityContact.__table__.indexes
            if item.name == "uq_sales_opportunity_contacts_primary"
        )
        self.assertTrue(index.unique)
        for dialect_options in index.dialect_options.values():
            where = dialect_options.get("where")
            if where is not None:
                self.assertNotIn("deleted_at", str(where))


class BackfillTests(OpportunityContactFixture):
    """Populated upgrade: every stored contact reference becomes a primary row."""

    def run_backfill(self):
        connection = self.db.connection()
        MIGRATION.assert_contact_references_are_valid(connection)
        connection.execute(MIGRATION.BACKFILL_SQL)
        self.db.commit()

    def test_existing_contact_ids_become_primary_associations(self):
        created = datetime(2026, 1, 5, tzinfo=timezone.utc)
        self.make_opportunity(40, contact_id=30, created_time=created)
        self.make_opportunity(41, contact_id=31)
        # A deal with no contact, and a soft-deleted deal that can still be restored.
        self.make_opportunity(42, contact_id=None)
        self.make_opportunity(43, contact_id=30, deleted_at=datetime(2026, 2, 1, tzinfo=timezone.utc))

        self.run_backfill()

        rows = self.db.query(SalesOpportunityContact).order_by(SalesOpportunityContact.opportunity_id).all()
        self.assertEqual(
            [(row.opportunity_id, row.contact_id, bool(row.is_primary), row.role_key) for row in rows],
            [
                (40, 30, True, "other"),
                (41, 31, True, "other"),
                (43, 30, True, "other"),
            ],
        )
        self.assertEqual(rows[0].tenant_id, TENANT)
        # The link is attributed to nobody rather than to a guessed actor.
        self.assertIsNone(rows[0].created_by_user_id)

    def test_a_soft_deleted_contact_reference_is_preserved_not_dropped(self):
        self.db.query(SalesContact).filter(SalesContact.contact_id == 30).one().deleted_at = datetime(
            2026, 1, 1, tzinfo=timezone.utc
        )
        self.db.commit()
        self.make_opportunity(40, contact_id=30)

        self.run_backfill()

        self.assertEqual([row.contact_id for row in self.links(40)], [30])

    def test_backfill_fails_loudly_on_a_cross_tenant_contact_reference(self):
        self.make_opportunity(40, contact_id=60)

        with self.assertRaises(RuntimeError) as failed:
            self.run_backfill()

        self.assertIn("cross-tenant", str(failed.exception))
        self.assertIn("opportunity 40", str(failed.exception))
        self.assertEqual(self.db.query(SalesOpportunityContact).count(), 0)

    def test_backfill_fails_loudly_on_a_dangling_contact_reference(self):
        self.make_opportunity(40, contact_id=30)
        # Simulate a reference the foreign key never enforced (SQLite here, a
        # dropped constraint or restored dump in the field).
        self.db.execute(text("UPDATE sales_opportunities SET contact_id = 9999 WHERE opportunity_id = 40"))
        self.db.commit()

        with self.assertRaises(RuntimeError):
            self.run_backfill()

    def test_a_clean_install_backfills_nothing_and_still_succeeds(self):
        self.run_backfill()
        self.assertEqual(self.db.query(SalesOpportunityContact).count(), 0)


class ConstraintTests(OpportunityContactFixture):
    def test_a_contact_can_only_appear_on_a_deal_once(self):
        self.make_opportunity(40, contact_id=30)
        self.db.add(SalesOpportunityContact(tenant_id=TENANT, opportunity_id=40, contact_id=31))
        self.db.commit()

        self.db.add(SalesOpportunityContact(tenant_id=TENANT, opportunity_id=40, contact_id=31))
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_a_deal_cannot_carry_two_primary_contacts(self):
        self.make_opportunity(40, contact_id=None)
        self.db.add(
            SalesOpportunityContact(tenant_id=TENANT, opportunity_id=40, contact_id=30, is_primary=True)
        )
        self.db.commit()

        self.db.add(
            SalesOpportunityContact(tenant_id=TENANT, opportunity_id=40, contact_id=31, is_primary=True)
        )
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_the_same_contact_may_participate_in_several_deals(self):
        self.make_opportunity(40, contact_id=30)
        self.make_opportunity(41, contact_id=30, opportunity_name="Acme Renewal")
        self.db.add_all(
            [
                SalesOpportunityContact(
                    tenant_id=TENANT, opportunity_id=40, contact_id=30, is_primary=True
                ),
                SalesOpportunityContact(
                    tenant_id=TENANT, opportunity_id=41, contact_id=30, is_primary=True
                ),
            ]
        )
        self.db.commit()

        self.assertEqual(self.db.query(SalesOpportunityContact).filter_by(contact_id=30).count(), 2)


class LegacyCompatibilityTests(OpportunityContactFixture):
    """The association table must never drift from the legacy column."""

    def test_creating_a_deal_mirrors_its_contact_as_the_primary_association(self):
        opportunity = create_opportunity(
            self.db,
            {"opportunity_name": "New deal", "contact_id": 30, "custom_fields": {}},
            current_user=self.current_user,
        )

        [link] = self.links(opportunity.opportunity_id)
        self.assertEqual(link.contact_id, opportunity.contact_id)
        self.assertTrue(link.is_primary)
        self.assertEqual(link.tenant_id, TENANT)
        self.assertEqual(link.role_key, DEFAULT_OPPORTUNITY_CONTACT_ROLE)
        self.assertEqual(link.created_by_user_id, 1)

    def test_changing_the_legacy_contact_moves_the_primary_flag_and_keeps_the_old_participant(self):
        opportunity = create_opportunity(
            self.db,
            {"opportunity_name": "New deal", "contact_id": 30, "custom_fields": {}},
            current_user=self.current_user,
        )
        original = self.links(opportunity.opportunity_id)[0]
        original_created_at = original.created_at

        update_opportunity(self.db, opportunity, {"contact_id": 31}, current_user=self.current_user)

        links = {link.contact_id: link for link in self.links(opportunity.opportunity_id)}
        self.assertEqual(set(links), {30, 31})
        self.assertFalse(links[30].is_primary)
        self.assertTrue(links[31].is_primary)
        # Demotion is a flag change, not a rewrite: the original link keeps its history.
        self.assertEqual(links[30].id, original.id)
        self.assertEqual(links[30].created_at, original_created_at)
        self.assertEqual(opportunity.contact_id, 31)

    def test_promoting_a_previous_participant_back_reuses_its_association_row(self):
        opportunity = create_opportunity(
            self.db,
            {"opportunity_name": "New deal", "contact_id": 30, "custom_fields": {}},
            current_user=self.current_user,
        )
        first_link_id = self.links(opportunity.opportunity_id)[0].id

        update_opportunity(self.db, opportunity, {"contact_id": 31}, current_user=self.current_user)
        update_opportunity(self.db, opportunity, {"contact_id": 30}, current_user=self.current_user)

        links = {link.contact_id: link for link in self.links(opportunity.opportunity_id)}
        self.assertEqual(links[30].id, first_link_id)
        self.assertTrue(links[30].is_primary)
        self.assertFalse(links[31].is_primary)
        self.assertEqual(len(links), 2)

    def test_an_update_that_does_not_touch_the_contact_leaves_the_association_alone(self):
        opportunity = create_opportunity(
            self.db,
            {"opportunity_name": "New deal", "contact_id": 30, "custom_fields": {}},
            current_user=self.current_user,
        )
        before = self.links(opportunity.opportunity_id)[0].id

        update_opportunity(self.db, opportunity, {"sales_stage": "qualified"}, current_user=self.current_user)

        [link] = self.links(opportunity.opportunity_id)
        self.assertEqual(link.id, before)
        self.assertTrue(link.is_primary)

    def test_lead_conversion_carries_the_compatibility_association(self):
        lead = SalesLead(
            lead_id=70,
            tenant_id=TENANT,
            first_name="Nina",
            primary_email="nina@prospect.example",
            status="new",
        )
        self.db.add(lead)
        self.db.commit()

        result = convert_sales_lead(
            self.db,
            lead,
            {"create_deal": True, "deal_name": "Nina deal", "assigned_to": 1, "deal_stage": "lead"},
            current_user=self.current_user,
        )

        deal_id = result["deal_id"]
        self.assertIsNotNone(deal_id)
        [link] = self.links(deal_id)
        self.assertEqual(link.contact_id, result["contact_id"])
        self.assertTrue(link.is_primary)


class TenantIsolationTests(OpportunityContactFixture):
    def test_a_cross_tenant_contact_is_refused_by_the_sync_service(self):
        opportunity = self.make_opportunity(40, contact_id=None)
        opportunity.contact_id = 60

        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.sync_primary_contact_association(
                self.db, opportunity=opportunity, actor_user_id=1
            )

        self.assertEqual(refused.exception.status_code, 400)
        self.assertEqual(refused.exception.detail, "Contact not found")
        self.assertEqual(self.db.query(SalesOpportunityContact).count(), 0)

    def test_creating_a_deal_with_another_tenants_contact_writes_no_association(self):
        with self.assertRaises(HTTPException):
            create_opportunity(
                self.db,
                {"opportunity_name": "Foreign deal", "contact_id": 60, "custom_fields": {}},
                current_user=self.current_user,
            )
        self.db.rollback()

        self.assertEqual(self.db.query(SalesOpportunityContact).count(), 0)

    def test_participants_are_read_within_the_callers_tenant_only(self):
        self.make_opportunity(40, contact_id=30)
        self.db.add(
            SalesOpportunity(
                opportunity_id=41,
                tenant_id=OTHER_TENANT,
                opportunity_name="Rival deal",
                client="Rival",
                contact_id=60,
            )
        )
        self.db.commit()
        self.db.add(
            SalesOpportunityContact(
                tenant_id=OTHER_TENANT, opportunity_id=41, contact_id=60, is_primary=True
            )
        )
        self.db.add(
            SalesOpportunityContact(tenant_id=TENANT, opportunity_id=40, contact_id=30, is_primary=True)
        )
        self.db.commit()

        # Same opportunity id, wrong tenant: nothing comes back.
        self.assertEqual(
            opportunity_contacts_services.list_opportunity_participants(
                self.db, tenant_id=TENANT, opportunity_id=41
            ),
            [],
        )
        participants = opportunity_contacts_services.list_opportunity_participants(
            self.db, tenant_id=TENANT, opportunity_id=40
        )
        self.assertEqual([link.contact_id for link in participants], [30])


class SoftDeleteAndHistoryTests(OpportunityContactFixture):
    def setUp(self):
        super().setUp()
        self.opportunity = self.make_opportunity(40, contact_id=30)
        self.db.add_all(
            [
                SalesOpportunityContact(
                    tenant_id=TENANT, opportunity_id=40, contact_id=30, is_primary=True
                ),
                SalesOpportunityContact(
                    tenant_id=TENANT, opportunity_id=40, contact_id=31, role_key="champion"
                ),
            ]
        )
        self.db.commit()

    def soft_delete_contact(self, contact_id):
        contact = self.db.query(SalesContact).filter(SalesContact.contact_id == contact_id).one()
        contact.deleted_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
        self.db.commit()

    def test_a_soft_deleted_contact_leaves_the_participant_list_but_keeps_its_row(self):
        self.soft_delete_contact(31)

        participants = opportunity_contacts_services.list_opportunity_participants(
            self.db, tenant_id=TENANT, opportunity_id=40
        )
        self.assertEqual([link.contact_id for link in participants], [30])
        self.assertEqual(len(self.links(40)), 2)

    def test_restoring_the_contact_restores_the_relationship(self):
        self.soft_delete_contact(31)
        contact = self.db.query(SalesContact).filter(SalesContact.contact_id == 31).one()
        contact.deleted_at = None
        self.db.commit()

        participants = opportunity_contacts_services.list_opportunity_participants(
            self.db, tenant_id=TENANT, opportunity_id=40
        )
        self.assertEqual([link.contact_id for link in participants], [30, 31])

    def test_a_soft_deleted_opportunity_keeps_its_associations_for_restore(self):
        self.opportunity.deleted_at = datetime(2026, 3, 2, tzinfo=timezone.utc)
        self.db.commit()

        self.assertEqual(len(self.links(40)), 2)

    def test_participants_are_ordered_primary_first_then_oldest_link(self):
        participants = opportunity_contacts_services.list_opportunity_participants(
            self.db, tenant_id=TENANT, opportunity_id=40
        )
        self.assertEqual([bool(link.is_primary) for link in participants], [True, False])


class SerializationTests(OpportunityContactFixture):
    def setUp(self):
        super().setUp()
        self.opportunity = self.make_opportunity(40, contact_id=30, organization_id=20)
        self.db.add_all(
            [
                SalesOpportunityContact(
                    tenant_id=TENANT, opportunity_id=40, contact_id=30, is_primary=True
                ),
                SalesOpportunityContact(
                    tenant_id=TENANT, opportunity_id=40, contact_id=31, role_key="champion"
                ),
            ]
        )
        self.db.commit()

    def build(self, policy=AllowContactsPolicy):
        original = summary_services.PermissionPolicy
        summary_services.PermissionPolicy = policy
        try:
            return summary_services.build_opportunity_summary(
                self.db, self.opportunity, current_user=self.current_user
            )
        finally:
            summary_services.PermissionPolicy = original

    def test_summary_exposes_the_primary_and_every_participant_with_a_role(self):
        response = OpportunitySummaryResponse.model_validate(self.build())

        self.assertTrue(response.can_view_contacts)
        self.assertEqual(response.primary_contact.contact_id, 30)
        self.assertEqual(response.primary_contact.role_label, "Other")
        self.assertEqual(
            [(item.contact_id, item.role_key, item.is_primary) for item in response.participant_contacts],
            [(30, "other", True), (31, "champion", False)],
        )
        self.assertEqual(response.participant_contacts[1].role_label, "Champion")
        self.assertEqual(response.participant_contacts[0].contact_name, "Ada Byron")
        self.assertEqual(response.participant_contacts[0].contact.primary_email, "ada@acme.example")

    def test_the_new_primary_association_matches_the_legacy_primary_contact_output(self):
        response = OpportunitySummaryResponse.model_validate(self.build())

        self.assertEqual(response.contact.contact_id, self.opportunity.contact_id)
        self.assertEqual(response.primary_contact.contact_id, response.contact.contact_id)
        self.assertEqual(response.primary_contact.contact, response.contact)

    def test_a_reader_without_contacts_access_sees_no_participants(self):
        response = OpportunitySummaryResponse.model_validate(self.build(policy=DenyContactsPolicy))

        self.assertFalse(response.can_view_contacts)
        self.assertIsNone(response.primary_contact)
        self.assertEqual(response.participant_contacts, [])

    def test_a_deal_with_no_participants_serializes_an_empty_list(self):
        self.db.query(SalesOpportunityContact).delete()
        self.db.commit()

        response = OpportunitySummaryResponse.model_validate(self.build())

        self.assertIsNone(response.primary_contact)
        self.assertEqual(response.participant_contacts, [])


if __name__ == "__main__":
    unittest.main()
