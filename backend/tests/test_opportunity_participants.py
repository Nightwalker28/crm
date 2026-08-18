"""Explicit participant operations (05-relationships-data-model, Phase 2).

Phase 1 proved the association model and its compatibility mirror. Phase 2 adds the
first writers other than that mirror, so these tests pin what a caller can do to a
relationship — and, just as importantly, what the legacy single-contact clients see
afterwards, which must only change when the primary contact deliberately changes.
"""

import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import permissions as permissions_module
from app.core.database import Base, get_db
from app.core.security import require_user
from app.main import app
from app.modules.catalog import models as catalog_models  # noqa: F401
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.platform.models import ActivityLog
from app.modules.sales.models import (
    SalesContact,
    SalesOpportunity,
    SalesOpportunityContact,
    SalesOrganization,
)
from app.modules.sales.opportunity_contact_roles import (
    OPPORTUNITY_CONTACT_ROLE_ORDER,
    normalize_opportunity_contact_role,
    opportunity_contact_role_catalog,
)
from app.modules.sales.routes import opportunity_participants_routes as participants_routes
from app.modules.sales.services import opportunity_contacts_services
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Tenant, User, UserStatus

TENANT = 10
OTHER_TENANT = 99
DEAL = 40
OTHER_DEAL = 41

MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260816_opportunity_participants.py"
)


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("opportunity_participants_revision", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MIGRATION = _load_migration_module()


class ParticipantFixture(unittest.TestCase):
    """One deal in tenant 10 with Ada as primary and Grace as a champion."""

    def setUp(self):
        # One shared connection, usable from the TestClient's worker thread, so the
        # route tests exercise the same session the fixture set up.
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.db.add_all(
            [
                Tenant(id=TENANT, slug="default", name="Default"),
                Tenant(id=OTHER_TENANT, slug="rival", name="Rival"),
                User(id=1, tenant_id=TENANT, email="ava@example.com", first_name="Ava", is_active=UserStatus.active),
                SalesOrganization(org_id=20, tenant_id=TENANT, org_name="Acme"),
                SalesContact(
                    contact_id=30,
                    tenant_id=TENANT,
                    first_name="Ada",
                    last_name="Byron",
                    primary_email="ada@acme.example",
                    organization_id=20,
                ),
                SalesContact(contact_id=31, tenant_id=TENANT, first_name="Grace", primary_email="grace@acme.example"),
                SalesContact(contact_id=32, tenant_id=TENANT, first_name="Alan", primary_email="alan@acme.example"),
                SalesContact(contact_id=60, tenant_id=OTHER_TENANT, primary_email="rival@other.example"),
            ]
        )
        self.db.commit()
        self.current_user = SimpleNamespace(id=1, tenant_id=TENANT)

        self.opportunity = SalesOpportunity(
            opportunity_id=DEAL,
            tenant_id=TENANT,
            opportunity_name="Acme Pilot",
            client="Ada Byron",
            contact_id=30,
            organization_id=20,
        )
        self.db.add(self.opportunity)
        self.db.commit()
        self.db.add_all(
            [
                SalesOpportunityContact(
                    tenant_id=TENANT, opportunity_id=DEAL, contact_id=30, role_key="other", is_primary=True
                ),
                SalesOpportunityContact(
                    tenant_id=TENANT, opportunity_id=DEAL, contact_id=31, role_key="champion"
                ),
            ]
        )
        self.db.commit()
        self.primary_link_id = self.link_for(30).id
        self.champion_link_id = self.link_for(31).id

    def tearDown(self):
        self.db.close()

    def link_for(self, contact_id, opportunity_id=DEAL):
        return (
            self.db.query(SalesOpportunityContact)
            .filter(
                SalesOpportunityContact.opportunity_id == opportunity_id,
                SalesOpportunityContact.contact_id == contact_id,
            )
            .one()
        )

    def participants(self, opportunity_id=DEAL):
        return opportunity_contacts_services.list_opportunity_participants(
            self.db, tenant_id=TENANT, opportunity_id=opportunity_id
        )

    def removed(self, opportunity_id=DEAL):
        return opportunity_contacts_services.list_removed_opportunity_participants(
            self.db, tenant_id=TENANT, opportunity_id=opportunity_id
        )

    def audit_actions(self):
        return [
            (entry.action, entry.actor_user_id, entry.entity_id)
            for entry in self.db.query(ActivityLog).order_by(ActivityLog.id.asc()).all()
        ]

    def soft_delete_contact(self, contact_id):
        contact = self.db.query(SalesContact).filter(SalesContact.contact_id == contact_id).one()
        contact.deleted_at = datetime(2026, 3, 1, tzinfo=timezone.utc)
        self.db.commit()


class RoleCatalogTests(unittest.TestCase):
    def test_normalization_accepts_the_catalog_and_defaults_an_omitted_role(self):
        self.assertEqual(normalize_opportunity_contact_role("CHAMPION"), "champion")
        self.assertEqual(normalize_opportunity_contact_role(" legal "), "legal")
        self.assertEqual(normalize_opportunity_contact_role(None), "other")

    def test_a_role_outside_the_catalog_cannot_be_written(self):
        with self.assertRaises(ValueError):
            normalize_opportunity_contact_role("ceo_friend")
        with self.assertRaises(ValueError):
            normalize_opportunity_contact_role("")

    def test_the_catalog_is_exposed_in_product_order_with_labels(self):
        catalog = opportunity_contact_role_catalog()
        self.assertEqual([item["key"] for item in catalog], OPPORTUNITY_CONTACT_ROLE_ORDER)
        self.assertEqual(catalog[0], {"key": "decision_maker", "label": "Decision maker"})


class MigrationTests(unittest.TestCase):
    def test_revision_id_fits_the_alembic_version_column_and_follows_phase_one(self):
        self.assertLessEqual(len(MIGRATION.revision), 32)
        self.assertEqual(MIGRATION.down_revision, "20260815_opp_contacts")

    def test_the_upgrade_is_additive_so_existing_associations_need_no_backfill(self):
        source = MIGRATION_PATH.read_text()
        self.assertIn("add_column", source)
        self.assertNotIn("op.drop_table", source)
        self.assertNotIn("op.execute", source)
        # Nullable columns only: NULL deleted_at already means "still a participant".
        self.assertEqual(source.count("nullable=True"), 2)


class AddParticipantTests(ParticipantFixture):
    def test_adding_a_contact_records_the_role_and_the_actor(self):
        link = opportunity_contacts_services.add_participant(
            self.db,
            opportunity=self.opportunity,
            contact_id=32,
            role_key="procurement",
            current_user=self.current_user,
        )

        self.assertEqual(link.contact_id, 32)
        self.assertEqual(link.role_key, "procurement")
        self.assertFalse(link.is_primary)
        self.assertEqual(link.tenant_id, TENANT)
        self.assertEqual(link.created_by_user_id, 1)
        self.assertEqual([item.contact_id for item in self.participants()], [30, 31, 32])

    def test_an_omitted_role_lands_on_the_catalog_default(self):
        link = opportunity_contacts_services.add_participant(
            self.db, opportunity=self.opportunity, contact_id=32, current_user=self.current_user
        )
        self.assertEqual(link.role_key, "other")

    def test_a_role_outside_the_catalog_is_refused_with_400(self):
        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.add_participant(
                self.db,
                opportunity=self.opportunity,
                contact_id=32,
                role_key="ceo_friend",
                current_user=self.current_user,
            )
        self.assertEqual(refused.exception.status_code, 400)
        self.assertEqual(len(self.participants()), 2)

    def test_adding_the_same_contact_twice_is_refused_as_a_duplicate(self):
        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.add_participant(
                self.db, opportunity=self.opportunity, contact_id=31, current_user=self.current_user
            )
        self.assertEqual(refused.exception.status_code, 409)
        self.assertIn("already a participant", refused.exception.detail)

    def test_adding_as_primary_moves_the_legacy_contact_and_demotes_the_previous_primary(self):
        link = opportunity_contacts_services.add_participant(
            self.db,
            opportunity=self.opportunity,
            contact_id=32,
            role_key="decision_maker",
            is_primary=True,
            current_user=self.current_user,
        )

        self.assertTrue(link.is_primary)
        self.assertEqual(self.opportunity.contact_id, 32)
        self.assertEqual(self.opportunity.client, "Alan")
        self.assertFalse(self.link_for(30).is_primary)
        # The old primary stays on the deal; it only lost the flag.
        self.assertEqual({item.contact_id for item in self.participants()}, {30, 31, 32})

    def test_adding_writes_one_audit_entry_against_the_deal(self):
        opportunity_contacts_services.add_participant(
            self.db, opportunity=self.opportunity, contact_id=32, role_key="finance", current_user=self.current_user
        )

        self.assertEqual(self.audit_actions(), [("participant_add", 1, str(DEAL))])
        entry = self.db.query(ActivityLog).one()
        self.assertEqual(entry.module_key, "sales_opportunities")
        self.assertIsNone(entry.before_state)
        self.assertEqual(entry.after_state["role_key"], "finance")
        self.assertEqual(entry.after_state["contact_id"], 32)
        self.assertFalse(entry.after_state["is_primary"])
        # The audit records the relationship, not a copy of the contact record.
        self.assertNotIn("primary_email", entry.after_state)


class ChangeRoleTests(ParticipantFixture):
    def test_changing_a_role_leaves_the_primary_and_the_legacy_field_untouched(self):
        link = opportunity_contacts_services.change_participant_role(
            self.db,
            opportunity=self.opportunity,
            link_id=self.champion_link_id,
            role_key="technical",
            current_user=self.current_user,
        )

        self.assertEqual(link.role_key, "technical")
        self.assertEqual(self.opportunity.contact_id, 30)
        self.assertTrue(self.link_for(30).is_primary)

    def test_the_primary_participant_can_hold_any_role(self):
        link = opportunity_contacts_services.change_participant_role(
            self.db,
            opportunity=self.opportunity,
            link_id=self.primary_link_id,
            role_key="technical",
            current_user=self.current_user,
        )

        self.assertEqual(link.role_key, "technical")
        self.assertTrue(link.is_primary)
        self.assertEqual(self.opportunity.contact_id, 30)

    def test_setting_the_role_it_already_has_writes_no_history(self):
        opportunity_contacts_services.change_participant_role(
            self.db,
            opportunity=self.opportunity,
            link_id=self.champion_link_id,
            role_key="champion",
            current_user=self.current_user,
        )

        self.assertEqual(self.audit_actions(), [])

    def test_a_role_change_records_both_sides_in_history(self):
        opportunity_contacts_services.change_participant_role(
            self.db,
            opportunity=self.opportunity,
            link_id=self.champion_link_id,
            role_key="legal",
            current_user=self.current_user,
        )

        entry = self.db.query(ActivityLog).one()
        self.assertEqual(entry.action, "participant_role_change")
        self.assertEqual(entry.before_state["role_key"], "champion")
        self.assertEqual(entry.after_state["role_key"], "legal")

    def test_a_participant_id_from_another_deal_is_not_found(self):
        self.db.add(
            SalesOpportunity(
                opportunity_id=OTHER_DEAL,
                tenant_id=TENANT,
                opportunity_name="Second deal",
                client="Alan",
                contact_id=32,
            )
        )
        self.db.commit()
        other = SalesOpportunityContact(
            tenant_id=TENANT, opportunity_id=OTHER_DEAL, contact_id=32, is_primary=True
        )
        self.db.add(other)
        self.db.commit()

        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.change_participant_role(
                self.db,
                opportunity=self.opportunity,
                link_id=other.id,
                role_key="legal",
                current_user=self.current_user,
            )
        self.assertEqual(refused.exception.status_code, 404)


class PrimaryContactTests(ParticipantFixture):
    def test_promoting_a_participant_rewrites_the_legacy_contact_and_display_name(self):
        link = opportunity_contacts_services.set_primary_participant(
            self.db,
            opportunity=self.opportunity,
            link_id=self.champion_link_id,
            current_user=self.current_user,
        )

        self.assertTrue(link.is_primary)
        self.assertEqual(self.opportunity.contact_id, 31)
        self.assertEqual(self.opportunity.client, "Grace")
        self.assertFalse(self.link_for(30).is_primary)
        # Exactly one primary, and it is the contact the legacy field points at.
        primaries = [item for item in self.participants() if item.is_primary]
        self.assertEqual([item.contact_id for item in primaries], [self.opportunity.contact_id])

    def test_promotion_keeps_the_role_and_does_not_move_the_organization(self):
        opportunity_contacts_services.set_primary_participant(
            self.db,
            opportunity=self.opportunity,
            link_id=self.champion_link_id,
            current_user=self.current_user,
        )

        self.assertEqual(self.link_for(31).role_key, "champion")
        # Grace has no organization; promoting her must not blank or move the deal's account.
        self.assertEqual(self.opportunity.organization_id, 20)

    def test_promoting_the_current_primary_is_a_no_op_without_history(self):
        opportunity_contacts_services.set_primary_participant(
            self.db,
            opportunity=self.opportunity,
            link_id=self.primary_link_id,
            current_user=self.current_user,
        )

        self.assertEqual(self.audit_actions(), [])
        self.assertEqual(self.opportunity.contact_id, 30)

    def test_a_promotion_records_the_previous_primary_in_history(self):
        opportunity_contacts_services.set_primary_participant(
            self.db,
            opportunity=self.opportunity,
            link_id=self.champion_link_id,
            current_user=self.current_user,
        )

        entry = self.db.query(ActivityLog).one()
        self.assertEqual(entry.action, "participant_primary_change")
        self.assertEqual(entry.before_state["primary_contact_id"], 30)
        self.assertEqual(entry.after_state["primary_contact_id"], 31)

    def test_a_participant_whose_contact_was_recycled_cannot_become_primary(self):
        self.soft_delete_contact(31)

        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.set_primary_participant(
                self.db,
                opportunity=self.opportunity,
                link_id=self.champion_link_id,
                current_user=self.current_user,
            )

        self.assertEqual(refused.exception.status_code, 400)
        self.assertEqual(self.opportunity.contact_id, 30)

    def test_the_legacy_mirror_and_the_participant_writer_agree_in_both_directions(self):
        """A promotion, then a legacy `contact_id` write, must not drift."""

        opportunity_contacts_services.set_primary_participant(
            self.db,
            opportunity=self.opportunity,
            link_id=self.champion_link_id,
            current_user=self.current_user,
        )
        self.opportunity.contact_id = 30
        opportunity_contacts_services.sync_primary_contact_association(
            self.db, opportunity=self.opportunity, actor_user_id=1
        )
        self.db.commit()

        primaries = [item.contact_id for item in self.participants() if item.is_primary]
        self.assertEqual(primaries, [30])
        self.assertEqual(self.opportunity.contact_id, 30)


class RemoveAndRestoreTests(ParticipantFixture):
    def test_removing_a_participant_hides_it_but_keeps_the_row(self):
        link = opportunity_contacts_services.remove_participant(
            self.db,
            opportunity=self.opportunity,
            link_id=self.champion_link_id,
            current_user=self.current_user,
        )

        self.assertIsNotNone(link.deleted_at)
        self.assertEqual(link.deleted_by_user_id, 1)
        self.assertEqual([item.contact_id for item in self.participants()], [30])
        self.assertEqual([item.contact_id for item in self.removed()], [31])
        self.assertEqual(self.db.query(SalesOpportunityContact).count(), 2)

    def test_the_primary_participant_cannot_be_removed(self):
        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.remove_participant(
                self.db,
                opportunity=self.opportunity,
                link_id=self.primary_link_id,
                current_user=self.current_user,
            )

        self.assertEqual(refused.exception.status_code, 409)
        self.assertIn("primary contact", refused.exception.detail)
        self.assertEqual([item.contact_id for item in self.participants()], [30, 31])

    def test_promoting_a_replacement_first_makes_the_old_primary_removable(self):
        opportunity_contacts_services.set_primary_participant(
            self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
        )
        opportunity_contacts_services.remove_participant(
            self.db, opportunity=self.opportunity, link_id=self.primary_link_id, current_user=self.current_user
        )

        self.assertEqual([item.contact_id for item in self.participants()], [31])
        self.assertEqual(self.opportunity.contact_id, 31)

    def test_a_removed_participant_can_be_restored_with_its_role(self):
        opportunity_contacts_services.remove_participant(
            self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
        )
        link = opportunity_contacts_services.restore_participant(
            self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
        )

        self.assertIsNone(link.deleted_at)
        self.assertIsNone(link.deleted_by_user_id)
        self.assertEqual(link.role_key, "champion")
        self.assertFalse(link.is_primary)
        self.assertEqual([item.contact_id for item in self.participants()], [30, 31])
        self.assertEqual(self.removed(), [])

    def test_restoring_an_active_participant_is_refused(self):
        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.restore_participant(
                self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
            )
        self.assertEqual(refused.exception.status_code, 409)

    def test_a_participant_cannot_be_restored_while_its_contact_is_recycled(self):
        opportunity_contacts_services.remove_participant(
            self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
        )
        self.soft_delete_contact(31)

        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.restore_participant(
                self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
            )

        self.assertEqual(refused.exception.status_code, 409)
        self.assertIn("recycle bin", refused.exception.detail)
        # Still recoverable once the contact comes back.
        self.assertEqual([item.contact_id for item in self.removed()], [31])

    def test_re_adding_a_removed_contact_revives_the_original_row(self):
        original_id = self.champion_link_id
        original_created_at = self.link_for(31).created_at
        opportunity_contacts_services.remove_participant(
            self.db, opportunity=self.opportunity, link_id=original_id, current_user=self.current_user
        )

        link = opportunity_contacts_services.add_participant(
            self.db,
            opportunity=self.opportunity,
            contact_id=31,
            role_key="finance",
            current_user=self.current_user,
        )

        self.assertEqual(link.id, original_id)
        self.assertEqual(link.created_at, original_created_at)
        self.assertEqual(link.role_key, "finance")
        self.assertIsNone(link.deleted_at)
        self.assertEqual(self.db.query(SalesOpportunityContact).count(), 2)

    def test_removal_and_restore_each_write_history(self):
        opportunity_contacts_services.remove_participant(
            self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
        )
        opportunity_contacts_services.restore_participant(
            self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
        )

        self.assertEqual(
            [action for action, _, _ in self.audit_actions()],
            ["participant_remove", "participant_restore"],
        )


class TenantIsolationTests(ParticipantFixture):
    def test_a_contact_from_another_tenant_cannot_be_added(self):
        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.add_participant(
                self.db, opportunity=self.opportunity, contact_id=60, current_user=self.current_user
            )

        self.assertEqual(refused.exception.status_code, 400)
        # Same wording as an unknown contact, so the error cannot confirm that the
        # id exists somewhere else.
        self.assertEqual(refused.exception.detail, "Contact not found")
        self.assertEqual(len(self.participants()), 2)

    def test_a_missing_contact_and_a_foreign_contact_fail_identically(self):
        with self.assertRaises(HTTPException) as missing:
            opportunity_contacts_services.add_participant(
                self.db, opportunity=self.opportunity, contact_id=9999, current_user=self.current_user
            )
        self.assertEqual(missing.exception.detail, "Contact not found")

    def test_a_recycled_contact_cannot_be_added_as_a_participant(self):
        self.soft_delete_contact(32)

        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.add_participant(
                self.db, opportunity=self.opportunity, contact_id=32, current_user=self.current_user
            )
        self.assertEqual(refused.exception.status_code, 400)

    def test_a_participant_of_another_tenants_deal_is_not_reachable(self):
        self.db.add(
            SalesOpportunity(
                opportunity_id=OTHER_DEAL,
                tenant_id=OTHER_TENANT,
                opportunity_name="Rival deal",
                client="Rival",
                contact_id=60,
            )
        )
        self.db.commit()
        foreign = SalesOpportunityContact(
            tenant_id=OTHER_TENANT, opportunity_id=OTHER_DEAL, contact_id=60, is_primary=True
        )
        self.db.add(foreign)
        self.db.commit()

        # Same association id, but reached through a deal in the caller's tenant.
        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.change_participant_role(
                self.db,
                opportunity=self.opportunity,
                link_id=foreign.id,
                role_key="legal",
                current_user=self.current_user,
            )
        self.assertEqual(refused.exception.status_code, 404)
        self.assertEqual(self.link_for(60, OTHER_DEAL).role_key, "other")


class ConcurrencyTests(ParticipantFixture):
    def test_a_deal_recycled_mid_request_refuses_the_participant_write(self):
        # The route loaded a live deal; it is soft-deleted before the service acts.
        self.opportunity.deleted_at = datetime(2026, 4, 1, tzinfo=timezone.utc)
        self.db.commit()

        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.add_participant(
                self.db, opportunity=self.opportunity, contact_id=32, current_user=self.current_user
            )

        self.assertEqual(refused.exception.status_code, 409)
        self.assertIn("recycle bin", refused.exception.detail)
        self.assertEqual(len(self.participants()), 2)

    def test_a_constraint_violation_surfaces_as_a_conflict_not_a_server_error(self):
        """The database, not the service pre-checks, is the last line of defence.

        The service checks for a duplicate participant and moves the primary flag
        under a row lock, but a writer that raced past those checks — or one that
        predates this API — is stopped by the unique link constraint and the
        partial primary index. Every mutation funnels its flush through
        `_flush_or_conflict`, so that outcome has to read as 409, not 500.
        """

        # Stage exactly what a lost race leaves behind: a second link for a contact
        # that is already on the deal.
        self.db.add(SalesOpportunityContact(tenant_id=TENANT, opportunity_id=DEAL, contact_id=31))

        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services._flush_or_conflict(self.db)

        self.assertEqual(refused.exception.status_code, 409)
        self.assertIn("Reload and try again", refused.exception.detail)
        # The failed write was rolled back rather than left pending on the session.
        self.assertEqual([item.contact_id for item in self.participants()], [30, 31])

    def test_a_second_primary_is_refused_by_the_database(self):
        with self.assertRaises(Exception):
            self.db.connection().exec_driver_sql(
                "UPDATE sales_opportunity_contacts SET is_primary = 1 WHERE id = :id",
                {"id": self.champion_link_id},
            )
        self.db.rollback()

    def test_the_removal_of_a_participant_makes_a_concurrent_role_change_a_404(self):
        opportunity_contacts_services.remove_participant(
            self.db, opportunity=self.opportunity, link_id=self.champion_link_id, current_user=self.current_user
        )

        with self.assertRaises(HTTPException) as refused:
            opportunity_contacts_services.change_participant_role(
                self.db,
                opportunity=self.opportunity,
                link_id=self.champion_link_id,
                role_key="legal",
                current_user=self.current_user,
            )

        self.assertEqual(refused.exception.status_code, 404)
        # A role change must never resurrect a removed relationship.
        self.assertEqual([item.contact_id for item in self.removed()], [31])


class PolicyStub:
    """Stands in for the real permission policy with a fixed allow/deny map."""

    allowed: dict = {}

    def __init__(self, db=None, user=None):
        pass

    def can_view_module(self, module_key):
        return module_key in self.allowed

    def can_perform_action(self, module_key, action):
        return action in self.allowed.get(module_key, set())

    def require_module(self, module_key):
        if not self.can_view_module(module_key):
            raise PermissionError("module not available")

    def require_action(self, module_key, action):
        if not self.can_perform_action(module_key, action):
            raise PermissionError("action not permitted")


class ParticipantRouteTests(ParticipantFixture):
    """The API surface: the layered access checks and the response shape."""

    FULL_ACCESS = {
        "sales_opportunities": {"view", "create", "edit", "delete", "restore", "export", "configure"},
        "sales_contacts": {"view", "create", "edit"},
    }

    def setUp(self):
        super().setUp()
        self.policy = type("Policy", (PolicyStub,), {"allowed": dict(self.FULL_ACCESS)})
        # Both the dependency helpers and the route's own `can_manage` probe resolve
        # the policy through their own module symbol.
        self._original_policy = permissions_module.PermissionPolicy
        self._original_route_policy = participants_routes.PermissionPolicy
        permissions_module.PermissionPolicy = self.policy
        participants_routes.PermissionPolicy = self.policy
        app.dependency_overrides[get_db] = lambda: self.db
        app.dependency_overrides[require_user] = lambda: self.current_user
        self.client = TestClient(app)

    def tearDown(self):
        permissions_module.PermissionPolicy = self._original_policy
        participants_routes.PermissionPolicy = self._original_route_policy
        app.dependency_overrides.clear()
        self.client.close()
        super().tearDown()

    def set_access(self, access):
        self.policy.allowed = access

    def url(self, suffix=""):
        return f"/api/v1/sales/opportunities/{DEAL}/participants{suffix}"

    def test_the_role_catalog_route_is_not_swallowed_by_the_opportunity_id_route(self):
        response = self.client.get("/api/v1/sales/opportunities/participant-roles")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [item["key"] for item in response.json()["results"]], OPPORTUNITY_CONTACT_ROLE_ORDER
        )

    def test_listing_participants_returns_the_primary_first_with_role_labels(self):
        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["can_manage"])
        self.assertEqual(
            [(item["contact_id"], item["role_label"], item["is_primary"]) for item in body["results"]],
            [(30, "Other", True), (31, "Champion", False)],
        )

    def test_viewing_a_deal_is_not_enough_to_see_who_is_on_it(self):
        self.set_access({"sales_opportunities": {"view", "edit"}})

        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 403)

    def test_a_reader_without_edit_is_told_it_cannot_manage_the_list(self):
        self.set_access({"sales_opportunities": {"view"}, "sales_contacts": {"view"}})

        response = self.client.get(self.url())

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["can_manage"])

    def test_adding_a_participant_requires_opportunity_edit(self):
        self.set_access({"sales_opportunities": {"view"}, "sales_contacts": {"view"}})

        response = self.client.post(self.url(), json={"contact_id": 32})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.participants()), 2)

    def test_adding_a_participant_requires_contacts_link_access(self):
        self.set_access({"sales_opportunities": {"view", "edit"}})

        response = self.client.post(self.url(), json={"contact_id": 32, "role_key": "legal"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(self.participants()), 2)

    def test_adding_a_participant_through_the_api(self):
        response = self.client.post(self.url(), json={"contact_id": 32, "role_key": "legal"})

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["contact_id"], 32)
        self.assertEqual(body["role_label"], "Legal")
        self.assertFalse(body["is_primary"])
        self.assertEqual(body["contact"]["primary_email"], "alan@acme.example")

    def test_an_unsupported_role_is_rejected_before_the_service(self):
        response = self.client.post(self.url(), json={"contact_id": 32, "role_key": "ceo_friend"})

        self.assertEqual(response.status_code, 422)

    def test_changing_a_role_through_the_api(self):
        response = self.client.patch(
            self.url(f"/{self.champion_link_id}/role"), json={"role_key": "technical"}
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["role_key"], "technical")

    def test_promoting_through_the_api_moves_the_legacy_contact(self):
        response = self.client.post(self.url(f"/{self.champion_link_id}/primary"))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["is_primary"])
        self.db.refresh(self.opportunity)
        self.assertEqual(self.opportunity.contact_id, 31)

    def test_removing_a_participant_requires_delete_and_restoring_requires_restore(self):
        self.set_access({"sales_opportunities": {"view", "edit"}, "sales_contacts": {"view"}})
        self.assertEqual(self.client.delete(self.url(f"/{self.champion_link_id}")).status_code, 403)

        self.set_access(dict(self.FULL_ACCESS))
        removed = self.client.delete(self.url(f"/{self.champion_link_id}"))
        self.assertEqual(removed.status_code, 200)
        self.assertIsNotNone(removed.json()["removed_at"])

        self.set_access({"sales_opportunities": {"view", "edit", "delete"}, "sales_contacts": {"view"}})
        self.assertEqual(
            self.client.post(self.url(f"/{self.champion_link_id}/restore")).status_code, 403
        )

        self.set_access(dict(self.FULL_ACCESS))
        restored = self.client.post(self.url(f"/{self.champion_link_id}/restore"))
        self.assertEqual(restored.status_code, 200)
        self.assertIsNone(restored.json()["removed_at"])

    def test_the_removed_list_is_gated_on_restore(self):
        self.client.delete(self.url(f"/{self.champion_link_id}"))

        self.set_access({"sales_opportunities": {"view", "edit", "delete"}, "sales_contacts": {"view"}})
        self.assertEqual(self.client.get(self.url("/recycle")).status_code, 403)

        self.set_access(dict(self.FULL_ACCESS))
        response = self.client.get(self.url("/recycle"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["contact_id"] for item in response.json()["results"]], [31])

    def test_removing_the_primary_participant_is_a_conflict(self):
        response = self.client.delete(self.url(f"/{self.primary_link_id}"))

        self.assertEqual(response.status_code, 409)
        self.assertIn("primary contact", response.json()["detail"])

    def test_a_deal_in_another_tenant_is_not_found(self):
        self.db.add(
            SalesOpportunity(
                opportunity_id=OTHER_DEAL,
                tenant_id=OTHER_TENANT,
                opportunity_name="Rival deal",
                client="Rival",
                contact_id=60,
            )
        )
        self.db.commit()

        response = self.client.get(f"/api/v1/sales/opportunities/{OTHER_DEAL}/participants")

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
