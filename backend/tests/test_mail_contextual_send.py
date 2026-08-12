"""Contextual send from a CRM record (03-email-integration, Phase 2).

The contract under test:

- a record-context send without a record is refused, not silently unlinked;
- the message row and its `primary` association are committed before the
  provider is called, so a retry replays instead of duplicating;
- provider identity and send status are persisted on success and on failure;
- the four failure kinds stay distinguishable: validation, disconnected
  credentials, provider rejection, transient failure;
- linkage is written once, in the mail domain, and the activity projection
  reads it rather than storing its own copy.
"""

import unittest
from unittest import mock

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.documents.models import Document
from app.modules.mail.models import MailMessage, MailRecordAssociation, UserMailConnection
from app.modules.mail.schema import MailProvider
from app.modules.mail.services import mail_errors, mail_services
from app.modules.mail.services.mail_errors import MailSendError
from app.modules.platform.models import MessageTemplate
from app.modules.platform.services import record_activity
from app.modules.platform.services.record_activity import list_record_activity
from app.modules.sales.models import SalesLead
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Role, Tenant, User, UserStatus

TENANT = 10
OTHER_TENANT = 99
LEAD_ID = 100
OTHER_TENANT_LEAD_ID = 101
SENT_IDENTITY = {"provider_message_id": "smtp-1", "provider_thread_id": "smtp-1"}


class _AllowAllPolicy:
    """The projection's own permission gate is covered by test_record_activity."""

    def __init__(self, db, user):
        self.user = user

    def can_view_module(self, module_key: str) -> bool:
        return True

    def can_perform_action(self, module_key: str, action: str) -> bool:
        return True


class ContextualMailSendTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=TENANT, slug="default", name="Default"),
                Tenant(id=OTHER_TENANT, slug="rival", name="Rival"),
                Module(id=1, name="sales_leads", base_route="sales_leads", is_enabled=1),
                Module(id=2, name="documents", base_route="documents", is_enabled=1),
                Module(id=3, name="message_templates", base_route="message_templates", is_enabled=1),
                Role(id=1, tenant_id=TENANT, name="Admin", level=100),
                User(
                    id=1,
                    tenant_id=TENANT,
                    email="ava@example.com",
                    first_name="Ava",
                    last_name="Admin",
                    role_id=1,
                    is_active=UserStatus.active,
                ),
                SalesLead(
                    lead_id=LEAD_ID,
                    tenant_id=TENANT,
                    first_name="Ada",
                    last_name="Lovelace",
                    primary_email="ada@example.com",
                ),
                # A lead that exists, but in another tenant.
                SalesLead(
                    lead_id=OTHER_TENANT_LEAD_ID,
                    tenant_id=OTHER_TENANT,
                    first_name="Rival",
                    last_name="Lead",
                    primary_email="rival@example.com",
                ),
                UserMailConnection(
                    id=1,
                    tenant_id=TENANT,
                    user_id=1,
                    provider=MailProvider.imap_smtp.value,
                    status="connected",
                    account_email="ava@example.com",
                    scopes=["imap.read", "smtp.send"],
                    smtp_host="smtp.example.com",
                    smtp_port=587,
                    smtp_security="starttls",
                    smtp_username="ava@example.com",
                    # Only presence is checked when deciding whether the mailbox
                    # can send; the provider adapter is stubbed in these tests.
                    encrypted_password="stored-ciphertext",
                ),
            ]
        )
        self.db.commit()
        self.user = self.db.query(User).filter(User.id == 1).first()

    def tearDown(self):
        self.db.close()

    # -- helpers ------------------------------------------------------------- #

    def _payload(self, **overrides):
        payload = {
            "provider": MailProvider.imap_smtp.value,
            "to": ["ada@example.com"],
            "cc": [],
            "bcc": [],
            "subject": "Intro",
            "body_text": "Hello Ada",
        }
        payload.update(overrides)
        return payload

    def _send(self, *, module_key="sales_leads", entity_id=str(LEAD_ID), **overrides):
        return mail_services.send_record_context_mail(
            self.db,
            current_user=self.user,
            module_key=module_key,
            entity_id=entity_id,
            payload=self._payload(**overrides),
        )

    def _stub_delivery(self, identity=None, error=None):
        if error is not None:
            return mock.patch.object(mail_services, "_send_imap_smtp_message", side_effect=error)
        return mock.patch.object(
            mail_services,
            "_send_imap_smtp_message",
            return_value=identity or SENT_IDENTITY,
        )

    def _document(self, document_id=1, *, tenant_id=TENANT, size=12):
        document = Document(
            id=document_id,
            tenant_id=tenant_id,
            uploaded_by_user_id=1,
            title="Proposal",
            original_filename="proposal.pdf",
            content_type="application/pdf",
            extension="pdf",
            file_size_bytes=size,
            storage_provider="local",
            storage_path=f"tenant/{tenant_id}/proposal-{document_id}.pdf",
        )
        self.db.add(document)
        self.db.commit()
        return document

    # -- explicit source context ---------------------------------------------- #

    def test_send_requires_a_source_record(self):
        with self._stub_delivery() as send_mock, self.assertRaises(MailSendError) as exc:
            mail_services.send_mail_message(
                self.db,
                current_user=self.user,
                payload=self._payload(),
                require_source_context=True,
            )

        self.assertEqual(exc.exception.code, mail_errors.VALIDATION)
        self.assertEqual(exc.exception.status_code, 422)
        send_mock.assert_not_called()
        # Nothing was claimed, so no half-written outbound message is left behind.
        self.assertEqual(self.db.query(MailMessage).count(), 0)

    def test_send_rejects_a_record_from_another_tenant(self):
        other_lead = (
            self.db.query(SalesLead)
            .filter(SalesLead.tenant_id == OTHER_TENANT)
            .first()
        )
        with self._stub_delivery() as send_mock, self.assertRaises(MailSendError) as exc:
            mail_services.send_record_context_mail(
                self.db,
                current_user=self.user,
                module_key="sales_leads",
                # A real lead id that belongs to another tenant: resolution is
                # tenant-scoped, so it must not be reachable from here.
                entity_id=str(other_lead.lead_id),
                payload=self._payload(),
            )
            self.fail("cross-tenant send should not resolve")

        self.assertEqual(exc.exception.code, mail_errors.VALIDATION)
        send_mock.assert_not_called()

    def test_send_rejects_an_unsupported_source_module(self):
        with self._stub_delivery() as send_mock, self.assertRaises(MailSendError) as exc:
            self._send(module_key="not_a_module")

        self.assertEqual(exc.exception.code, mail_errors.VALIDATION)
        self.assertEqual(exc.exception.message, "Mail source is not available.")
        send_mock.assert_not_called()

    # -- persisted identity, status, linkage ---------------------------------- #

    def test_successful_send_persists_identity_status_and_primary_link(self):
        with self._stub_delivery():
            message = self._send()

        self.assertEqual(message.send_status, "sent")
        self.assertIsNone(message.send_error_code)
        self.assertEqual(message.provider_message_id, "smtp-1")
        self.assertEqual(message.provider_thread_id, "smtp-1")
        self.assertEqual(message.direction, "outbound")
        self.assertIsNotNone(message.sent_at)

        associations = self.db.query(MailRecordAssociation).all()
        self.assertEqual(len(associations), 1)
        self.assertEqual(associations[0].association_type, "primary")
        self.assertEqual(associations[0].module_key, "sales_leads")
        self.assertEqual(associations[0].entity_id, str(LEAD_ID))
        # The label comes from the record, never from the request body.
        self.assertEqual(associations[0].record_label, "ada@example.com")
        # The denormalized mirror stays in step with the primary association.
        self.assertEqual(message.source_module_key, "sales_leads")
        self.assertEqual(message.source_entity_id, str(LEAD_ID))

    def test_sent_mail_reaches_the_record_activity_projection(self):
        with self._stub_delivery():
            message = self._send()

        with mock.patch.object(record_activity, "PermissionPolicy", _AllowAllPolicy):
            page = list_record_activity(
                self.db,
                user=self.user,
                module_key="sales_leads",
                entity_id=LEAD_ID,
                types="email",
            )

        self.assertEqual(len(page["items"]), 1)
        item = page["items"][0]
        self.assertEqual(item["type"], "email")
        self.assertEqual(item["source"]["record_id"], str(message.id))
        self.assertEqual(item["title"], "Intro")
        self.assertEqual(item["meta"]["association_type"], "primary")
        self.assertEqual(item["status"], "sent")
        # The projection reads the mail domain's association table; it does not
        # keep a competing link of its own.
        self.assertEqual(self.db.query(MailRecordAssociation).count(), 1)

    def test_a_failed_send_is_not_projected_as_a_delivered_email(self):
        rejection = MailSendError(mail_errors.PROVIDER_REJECTED, "Recipient refused.")
        with self._stub_delivery(error=rejection), self.assertRaises(MailSendError):
            self._send()

        with mock.patch.object(record_activity, "PermissionPolicy", _AllowAllPolicy):
            page = list_record_activity(
                self.db,
                user=self.user,
                module_key="sales_leads",
                entity_id=LEAD_ID,
                types="email",
            )

        # The attempt is history — it belongs on the record — but it carries its
        # outcome so the timeline cannot claim the mail was delivered.
        self.assertEqual(len(page["items"]), 1)
        self.assertEqual(page["items"][0]["status"], "failed")

    # -- retry safety ---------------------------------------------------------- #

    def test_repeating_one_compose_attempt_does_not_send_twice(self):
        with self._stub_delivery() as send_mock:
            first = self._send(idempotency_key="compose-abc-123")
            second = self._send(idempotency_key="compose-abc-123")

        self.assertEqual(first.id, second.id)
        send_mock.assert_called_once()
        self.assertEqual(self.db.query(MailMessage).count(), 1)
        self.assertEqual(self.db.query(MailRecordAssociation).count(), 1)

    def test_a_claim_still_in_flight_refuses_a_second_send(self):
        with self._stub_delivery():
            message = self._send(idempotency_key="compose-inflight")
        # Simulate an attempt that never reported an outcome.
        message.send_status = "sending"
        self.db.add(message)
        self.db.commit()

        with self._stub_delivery() as send_mock, self.assertRaises(MailSendError) as exc:
            self._send(idempotency_key="compose-inflight")

        self.assertEqual(exc.exception.code, mail_errors.SEND_IN_FLIGHT)
        self.assertEqual(exc.exception.status_code, 409)
        send_mock.assert_not_called()

    def test_retrying_a_failed_send_reuses_the_same_row(self):
        transient = MailSendError(mail_errors.PROVIDER_UNAVAILABLE, "Server busy.")
        with self._stub_delivery(error=transient), self.assertRaises(MailSendError):
            self._send(idempotency_key="compose-retry")

        failed = self.db.query(MailMessage).one()
        self.assertEqual(failed.send_status, "failed")
        self.assertEqual(failed.send_error_code, mail_errors.PROVIDER_UNAVAILABLE)
        self.assertIsNone(failed.sent_at)
        # The link survives the failure: the attempt belongs to the record.
        self.assertEqual(self.db.query(MailRecordAssociation).count(), 1)

        with self._stub_delivery():
            retried = self._send(idempotency_key="compose-retry")

        self.assertEqual(retried.id, failed.id)
        self.assertEqual(retried.send_status, "sent")
        self.assertIsNone(retried.send_error_code)
        self.assertEqual(self.db.query(MailMessage).count(), 1)
        self.assertEqual(self.db.query(MailRecordAssociation).count(), 1)

    def test_sends_without_an_idempotency_key_stay_independent(self):
        # Distinct provider ids, because two real sends are two real messages.
        with mock.patch.object(
            mail_services,
            "_send_imap_smtp_message",
            side_effect=[
                {"provider_message_id": "smtp-1", "provider_thread_id": "smtp-1"},
                {"provider_message_id": "smtp-2", "provider_thread_id": "smtp-2"},
            ],
        ) as send_mock:
            first = self._send()
            second = self._send()

        self.assertNotEqual(first.id, second.id)
        self.assertEqual(send_mock.call_count, 2)

    # -- failure taxonomy ------------------------------------------------------ #

    def test_disconnected_mailbox_is_reported_before_anything_is_claimed(self):
        connection = self.db.query(UserMailConnection).one()
        connection.status = "disconnected"
        self.db.add(connection)
        self.db.commit()

        with self._stub_delivery() as send_mock, self.assertRaises(MailSendError) as exc:
            self._send()

        self.assertEqual(exc.exception.code, mail_errors.MAILBOX_DISCONNECTED)
        self.assertEqual(exc.exception.status_code, 409)
        self.assertTrue(exc.exception.reconnect_required)
        self.assertFalse(exc.exception.retryable)
        send_mock.assert_not_called()
        self.assertEqual(self.db.query(MailMessage).count(), 0)

    def test_missing_credentials_are_reported_as_disconnected_not_rejection(self):
        connection = self.db.query(UserMailConnection).one()
        connection.encrypted_password = None
        self.db.add(connection)
        self.db.commit()

        with self.assertRaises(MailSendError) as exc:
            self._send()

        self.assertEqual(exc.exception.code, mail_errors.MAILBOX_DISCONNECTED)
        self.assertEqual(self.db.query(MailMessage).count(), 0)

    def test_provider_rejection_marks_the_message_failed_and_is_not_retryable(self):
        rejection = MailSendError(mail_errors.PROVIDER_REJECTED, "Recipient refused.")
        with self._stub_delivery(error=rejection), self.assertRaises(MailSendError) as exc:
            self._send()

        self.assertEqual(exc.exception.code, mail_errors.PROVIDER_REJECTED)
        self.assertEqual(exc.exception.status_code, 502)
        self.assertFalse(exc.exception.retryable)
        message = self.db.query(MailMessage).one()
        self.assertEqual(message.send_status, "failed")
        self.assertEqual(message.send_error_code, mail_errors.PROVIDER_REJECTED)

    def test_transient_failure_is_retryable_and_keeps_the_attempt(self):
        transient = MailSendError(mail_errors.PROVIDER_UNAVAILABLE, "Timed out.")
        with self._stub_delivery(error=transient), self.assertRaises(MailSendError) as exc:
            self._send()

        self.assertEqual(exc.exception.code, mail_errors.PROVIDER_UNAVAILABLE)
        self.assertEqual(exc.exception.status_code, 503)
        self.assertTrue(exc.exception.retryable)
        self.assertEqual(self.db.query(MailMessage).one().send_status, "failed")

    def test_send_error_detail_is_not_serialized_to_clients(self):
        rejection = MailSendError(mail_errors.PROVIDER_REJECTED, "550 blocked by policy engine")
        with self._stub_delivery(error=rejection), self.assertRaises(MailSendError):
            self._send()

        message = self.db.query(MailMessage).one()
        serialized = mail_services.serialize_mail_message(message)
        self.assertIn("550 blocked", message.send_error_detail)
        self.assertNotIn("send_error_detail", serialized)
        self.assertEqual(serialized["send_error_code"], mail_errors.PROVIDER_REJECTED)

    def test_an_unclassified_delivery_error_still_settles_the_claim(self):
        # A provider adapter that raises something other than MailSendError must
        # not strand the claim in `sending`, or that idempotency key would be
        # blocked for good.
        with self._stub_delivery(error=RuntimeError("provider client blew up")), self.assertRaises(RuntimeError):
            self._send(idempotency_key="compose-unclassified")

        message = self.db.query(MailMessage).one()
        self.assertEqual(message.send_status, "failed")
        self.assertEqual(message.send_error_code, "unknown")

        with self._stub_delivery():
            retried = self._send(idempotency_key="compose-unclassified")

        self.assertEqual(retried.id, message.id)
        self.assertEqual(retried.send_status, "sent")

    # -- attachments ----------------------------------------------------------- #

    def test_attachments_are_read_from_documents_and_recorded_as_a_manifest(self):
        self._document(document_id=1)

        with mock.patch.object(
            mail_services,
            "resolve_document_download",
            return_value={"kind": "bytes", "content": b"pdf-bytes"},
        ), self._stub_delivery() as send_mock:
            message = self._send(attachment_document_ids=[1])

        self.assertEqual(
            message.attachments,
            [
                {
                    "document_id": 1,
                    "filename": "proposal.pdf",
                    "content_type": "application/pdf",
                    "size_bytes": len(b"pdf-bytes"),
                }
            ],
        )
        # Bytes reach the provider adapter but are never persisted on the message.
        delivered = send_mock.call_args.kwargs["attachments"]
        self.assertEqual(delivered[0]["content"], b"pdf-bytes")

    def test_attachments_cannot_reference_another_tenants_document(self):
        self._document(document_id=2, tenant_id=OTHER_TENANT)

        with self._stub_delivery() as send_mock, self.assertRaises(MailSendError) as exc:
            self._send(attachment_document_ids=[2])

        self.assertEqual(exc.exception.code, mail_errors.VALIDATION)
        self.assertEqual(exc.exception.message, "Selected attachment is not available.")
        send_mock.assert_not_called()
        self.assertEqual(self.db.query(MailMessage).count(), 0)

    def test_attachments_over_the_total_size_limit_are_refused(self):
        self._document(document_id=3)
        oversize = b"x" * (mail_services.MAIL_ATTACHMENT_TOTAL_BYTES + 1)

        with mock.patch.object(
            mail_services,
            "resolve_document_download",
            return_value={"kind": "bytes", "content": oversize},
        ), self._stub_delivery() as send_mock, self.assertRaises(MailSendError) as exc:
            self._send(attachment_document_ids=[3])

        self.assertEqual(exc.exception.code, mail_errors.VALIDATION)
        send_mock.assert_not_called()

    # -- templates -------------------------------------------------------------- #

    def _template(self, template_id=1, *, tenant_id=TENANT, channel="email", is_active=True):
        template = MessageTemplate(
            id=template_id,
            tenant_id=tenant_id,
            template_key=f"intro-{template_id}",
            name="Intro",
            channel=channel,
            body="Hello {{lead.first_name}}",
            is_active=is_active,
        )
        self.db.add(template)
        self.db.commit()
        return template

    def test_template_provenance_is_recorded_on_the_message(self):
        self._template(template_id=1)

        with self._stub_delivery():
            message = self._send(template_id=1)

        self.assertEqual(message.template_id, 1)

    def test_template_from_another_tenant_is_refused(self):
        self._template(template_id=2, tenant_id=OTHER_TENANT)

        with self._stub_delivery() as send_mock, self.assertRaises(MailSendError) as exc:
            self._send(template_id=2)

        self.assertEqual(exc.exception.code, mail_errors.VALIDATION)
        self.assertEqual(exc.exception.message, "Selected template is not available.")
        send_mock.assert_not_called()

    def test_non_email_template_is_refused(self):
        self._template(template_id=3, channel="whatsapp")

        with self._stub_delivery(), self.assertRaises(MailSendError) as exc:
            self._send(template_id=3)

        self.assertEqual(exc.exception.code, mail_errors.VALIDATION)


if __name__ == "__main__":
    unittest.main()
