"""CRM record association contract for mail messages (03-email-integration, Phase 1)."""

import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents import models as document_models  # noqa: F401
from app.modules.mail.models import MailMessage, MailRecordAssociation, UserMailConnection
from app.modules.mail.schema import MailProvider
from app.modules.mail.services import mail_associations, mail_services
from app.modules.sales.models import SalesContact, SalesOpportunity
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Role, Tenant, User, UserStatus

TENANT = 10
OTHER_TENANT = 99


class MailRecordAssociationTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=TENANT, slug="default", name="Default"),
                Tenant(id=OTHER_TENANT, slug="rival", name="Rival"),
                Module(id=1, name="sales_contacts", base_route="sales_contacts", is_enabled=1),
                Module(id=2, name="sales_opportunities", base_route="sales_opportunities", is_enabled=1),
                Role(id=1, tenant_id=TENANT, name="Admin", level=100),
                User(
                    id=1,
                    tenant_id=TENANT,
                    email="ava@example.com",
                    first_name="Ava",
                    role_id=1,
                    is_active=UserStatus.active,
                ),
                User(
                    id=2,
                    tenant_id=TENANT,
                    email="sam@example.com",
                    first_name="Sam",
                    role_id=1,
                    is_active=UserStatus.active,
                ),
                SalesContact(contact_id=7, tenant_id=TENANT, primary_email="lead@example.com", assigned_to=1),
                # Same contact id in another tenant, so isolation failures show.
                SalesContact(contact_id=8, tenant_id=OTHER_TENANT, primary_email="other@example.com"),
                SalesOpportunity(
                    opportunity_id=3,
                    tenant_id=TENANT,
                    opportunity_name="Renewal",
                    client="Acme",
                ),
                UserMailConnection(
                    id=1,
                    tenant_id=TENANT,
                    user_id=1,
                    provider=MailProvider.imap_smtp.value,
                    status="connected",
                    account_email="ava@example.com",
                ),
            ]
        )
        self.db.commit()
        self.user = self.db.query(User).filter(User.id == 1).first()
        self.colleague = self.db.query(User).filter(User.id == 2).first()

    def tearDown(self):
        self.db.close()

    def _message(self, message_id=50, *, owner_user_id=1, thread_id=None, connection_id=1):
        message = MailMessage(
            id=message_id,
            tenant_id=TENANT,
            owner_user_id=owner_user_id,
            connection_id=connection_id,
            provider=MailProvider.imap_smtp.value,
            provider_message_id=f"imap:{message_id}",
            provider_thread_id=thread_id,
            direction="inbound",
            folder="inbox",
            from_email="lead@example.com",
            subject="Intro",
        )
        self.db.add(message)
        self.db.commit()
        return message

    def _associate(self, message_id, **payload):
        return mail_associations.associate_mail_message(
            self.db,
            current_user=self.user,
            message_id=message_id,
            payload=payload,
        )

    # -- linking ------------------------------------------------------------- #

    def test_association_records_the_record_label_and_creator(self):
        self._message()
        [association] = self._associate(50, module_key="sales_contacts", entity_id="7")

        self.assertEqual(association.module_key, "sales_contacts")
        self.assertEqual(association.entity_id, "7")
        self.assertEqual(association.association_type, "related")
        self.assertEqual(association.record_label, "lead@example.com")
        self.assertEqual(association.created_by_user_id, 1)

    def test_a_message_carries_several_records_at_once(self):
        self._message()
        self._associate(50, module_key="sales_contacts", entity_id="7")
        self._associate(50, module_key="sales_opportunities", entity_id="3")

        associations = mail_associations.list_mail_message_associations(
            self.db, current_user=self.user, message_id=50
        )
        self.assertEqual(
            {(item.module_key, item.entity_id) for item in associations},
            {("sales_contacts", "7"), ("sales_opportunities", "3")},
        )

    def test_relinking_the_same_record_is_idempotent(self):
        self._message()
        [first] = self._associate(50, module_key="sales_contacts", entity_id="7")
        [second] = self._associate(50, module_key="sales_contacts", entity_id="7")

        self.assertEqual(first.id, second.id)
        self.assertEqual(
            self.db.query(MailRecordAssociation).filter(MailRecordAssociation.message_id == 50).count(),
            1,
        )

    # -- the primary contextual record ---------------------------------------- #

    def test_primary_association_mirrors_onto_the_message(self):
        message = self._message()
        self._associate(50, module_key="sales_contacts", entity_id="7", association_type="primary")
        self.db.refresh(message)

        self.assertEqual(message.source_module_key, "sales_contacts")
        self.assertEqual(message.source_entity_id, "7")
        self.assertEqual(message.source_label, "lead@example.com")

    def test_a_new_primary_demotes_the_old_one_without_dropping_it(self):
        message = self._message()
        self._associate(50, module_key="sales_contacts", entity_id="7", association_type="primary")
        self._associate(50, module_key="sales_opportunities", entity_id="3", association_type="primary")
        self.db.refresh(message)

        by_record = {
            (item.module_key, item.entity_id): item.association_type
            for item in mail_associations.list_mail_message_associations(
                self.db, current_user=self.user, message_id=50
            )
        }
        self.assertEqual(
            by_record,
            {("sales_contacts", "7"): "related", ("sales_opportunities", "3"): "primary"},
        )
        self.assertEqual(message.source_module_key, "sales_opportunities")

    def test_the_database_refuses_a_second_primary(self):
        self._message()
        self.db.add_all(
            [
                MailRecordAssociation(
                    tenant_id=TENANT,
                    message_id=50,
                    module_key="sales_contacts",
                    entity_id="7",
                    association_type="primary",
                ),
                MailRecordAssociation(
                    tenant_id=TENANT,
                    message_id=50,
                    module_key="sales_opportunities",
                    entity_id="3",
                    association_type="primary",
                ),
            ]
        )
        with self.assertRaises(IntegrityError):
            self.db.commit()
        self.db.rollback()

    def test_removing_the_primary_clears_the_mirror_and_promotes_nothing(self):
        message = self._message()
        self._associate(50, module_key="sales_opportunities", entity_id="3")
        [primary] = self._associate(
            50, module_key="sales_contacts", entity_id="7", association_type="primary"
        )

        mail_associations.disassociate_mail_message(
            self.db, current_user=self.user, message_id=50, association_id=primary.id
        )
        self.db.refresh(message)

        remaining = mail_associations.list_mail_message_associations(
            self.db, current_user=self.user, message_id=50
        )
        self.assertIsNone(message.source_module_key)
        self.assertIsNone(message.source_label)
        self.assertEqual([item.association_type for item in remaining], ["related"])

    # -- threads --------------------------------------------------------------- #

    def test_apply_to_thread_links_every_message_the_provider_threaded(self):
        self._message(50, thread_id="thread-a")
        self._message(51, thread_id="thread-a")
        self._message(52, thread_id="thread-b")

        associations = self._associate(
            50, module_key="sales_contacts", entity_id="7", apply_to_thread=True
        )

        self.assertEqual({item.message_id for item in associations}, {50, 51})

    def test_apply_to_thread_on_an_unthreaded_message_links_only_that_message(self):
        self._message(50, thread_id=None)
        self._message(51, thread_id=None)

        associations = self._associate(
            50, module_key="sales_contacts", entity_id="7", apply_to_thread=True
        )

        self.assertEqual([item.message_id for item in associations], [50])

    def test_a_thread_does_not_span_mailboxes(self):
        # Same provider thread id, different mailbox owner: not the same thread.
        self.db.add(
            UserMailConnection(
                id=2,
                tenant_id=TENANT,
                user_id=2,
                provider=MailProvider.imap_smtp.value,
                status="connected",
                account_email="sam@example.com",
            )
        )
        self.db.commit()
        self._message(50, thread_id="thread-a")
        self._message(51, thread_id="thread-a", owner_user_id=2, connection_id=2)

        associations = self._associate(
            50, module_key="sales_contacts", entity_id="7", apply_to_thread=True
        )

        self.assertEqual([item.message_id for item in associations], [50])

    # -- permissions and tenant isolation --------------------------------------- #

    def test_linking_to_another_tenants_record_is_refused(self):
        self._message()
        with self.assertRaises(HTTPException) as ctx:
            self._associate(50, module_key="sales_contacts", entity_id="8")

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, mail_associations.UNAVAILABLE_RECORD_DETAIL)
        self.assertEqual(self.db.query(MailRecordAssociation).count(), 0)

    def test_an_unsupported_module_is_refused(self):
        self._message()
        with self.assertRaises(HTTPException) as ctx:
            self._associate(50, module_key="not_a_module", entity_id="7")

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, mail_associations.UNAVAILABLE_RECORD_DETAIL)

    def test_a_missing_target_is_refused(self):
        self._message()
        with self.assertRaises(HTTPException) as ctx:
            self._associate(50, module_key="sales_contacts", entity_id="")

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.detail, "Choose a record to link this mail message.")

    def test_another_users_message_is_not_found(self):
        self._message(50, owner_user_id=2)

        for call in (
            lambda: mail_associations.list_mail_message_associations(
                self.db, current_user=self.user, message_id=50
            ),
            lambda: self._associate(50, module_key="sales_contacts", entity_id="7"),
        ):
            with self.assertRaises(HTTPException) as ctx:
                call()
            self.assertEqual(ctx.exception.status_code, 404)

    def test_a_message_from_another_tenant_is_not_found(self):
        self.db.add(
            MailMessage(
                id=60,
                tenant_id=OTHER_TENANT,
                owner_user_id=1,
                direction="inbound",
                folder="inbox",
                subject="Rival",
            )
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as ctx:
            self._associate(60, module_key="sales_contacts", entity_id="7")
        self.assertEqual(ctx.exception.status_code, 404)

    def test_an_association_id_from_another_message_cannot_be_removed(self):
        self._message(50)
        self._message(51)
        [other] = self._associate(51, module_key="sales_contacts", entity_id="7")

        with self.assertRaises(HTTPException) as ctx:
            mail_associations.disassociate_mail_message(
                self.db, current_user=self.user, message_id=50, association_id=other.id
            )
        self.assertEqual(ctx.exception.status_code, 404)

    # -- the inbox link action keeps working ------------------------------------- #

    def test_the_inbox_link_action_writes_a_primary_association(self):
        self._message()
        linked = mail_services.link_mail_message_to_record(
            self.db,
            message_id=50,
            current_user=self.user,
            payload={"source_module_key": "sales_contacts", "source_entity_id": "7"},
        )

        [association] = mail_associations.list_mail_message_associations(
            self.db, current_user=self.user, message_id=50
        )
        self.assertEqual(linked.source_module_key, "sales_contacts")
        self.assertEqual(association.association_type, "primary")
        self.assertEqual(association.record_label, "lead@example.com")


if __name__ == "__main__":
    unittest.main()
