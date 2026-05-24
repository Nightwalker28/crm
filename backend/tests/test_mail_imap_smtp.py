import unittest
from datetime import datetime, timezone
from email.message import EmailMessage
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.secrets import decrypt_secret, encrypt_secret
from app.modules.mail.models import MailMessage, UserMailConnection
from app.modules.mail.schema import MailProvider
from app.modules.mail.services import mail_services
from app.modules.mail.services.mail_services import (
    _serialize_connection,
    _send_imap_smtp_message,
    disconnect_mail_connection,
    sync_imap_smtp_inbox,
    upsert_google_mail_connection,
    upsert_imap_smtp_mail_connection,
)
from app.modules.sales.models import SalesContact
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Module, Role, Tenant, User, UserStatus


class FakeImapClient:
    def __init__(self, raw_message: bytes | None = None, search_uids: bytes = b"42", append_status: str = "OK"):
        self.raw_message = raw_message
        self.search_uids = search_uids
        self.append_status = append_status
        self.fetched_uids: list[str] = []
        self.logged_in = False

    def login(self, username, password):
        self.logged_in = True
        self.username = username
        self.password = password
        return "OK", [b"Logged in"]

    def select(self, mailbox):
        self.mailbox = mailbox
        return "OK", [b"1"]

    def uid(self, command, *args):
        if command == "search":
            return "OK", [self.search_uids]
        if command == "fetch":
            self.fetched_uids.append(str(args[0]))
            return "OK", [(f"{args[0]} (RFC822 {{1}}".encode(), self.raw_message or b"")]
        return "NO", []

    def append(self, folder, flags, date_time, raw_message):
        self.appended_folder = folder
        self.appended_message = raw_message
        return self.append_status, [b"APPEND completed"]

    def logout(self):
        return "OK", [b"Logged out"]

    def shutdown(self):
        return None


class FakeSmtpClient:
    def __init__(self):
        self.logged_in = False

    def login(self, username, password):
        self.logged_in = True
        self.username = username
        self.password = password

    def send_message(self, message):
        self.sent_message = message

    def quit(self):
        return None


class MailImapSmtpTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()
        self.db.add_all(
            [
                Tenant(id=10, slug="default", name="Default"),
                Module(id=1, name="sales_contacts", base_route="sales_contacts", is_enabled=1),
                Role(id=1, tenant_id=10, name="Admin", level=100),
                User(
                    id=1,
                    tenant_id=10,
                    email="ava@example.com",
                    first_name="Ava",
                    last_name="Admin",
                    role_id=1,
                    is_active=UserStatus.active,
                ),
                SalesContact(
                    contact_id=7,
                    tenant_id=10,
                    primary_email="lead@example.com",
                    assigned_to=1,
                ),
                SalesContact(
                    contact_id=8,
                    tenant_id=99,
                    primary_email="other@example.com",
                    assigned_to=1,
                ),
            ]
        )
        self.db.commit()
        self.user = self.db.query(User).filter(User.id == 1).first()

    def tearDown(self):
        self.db.close()

    @patch.object(mail_services.settings, "JWT_SECRET", "test-mail-secret")
    def test_upsert_imap_smtp_connection_encrypts_password_and_enables_sync(self):
        self.db.add(
            UserMailConnection(
                id=1,
                tenant_id=10,
                user_id=1,
                provider=MailProvider.imap_smtp.value,
                status="disconnected",
            )
        )
        self.db.commit()
        with patch.object(mail_services, "_connect_imap", return_value=FakeImapClient()) as imap_mock, \
             patch.object(mail_services, "_connect_smtp", return_value=FakeSmtpClient()) as smtp_mock:
            connection = upsert_imap_smtp_mail_connection(
                self.db,
                tenant_id=10,
                user=self.user,
                payload={
                    "account_email": "ava@example.com",
                    "imap_host": "imap.example.com",
                    "imap_port": 993,
                    "imap_security": "ssl",
                    "imap_username": "ava@example.com",
                    "smtp_host": "smtp.example.com",
                    "smtp_port": 587,
                    "smtp_security": "starttls",
                    "smtp_username": "",
                    "password": "app-password",
                },
            )

        self.assertEqual(connection.provider, MailProvider.imap_smtp.value)
        self.assertEqual(connection.status, "connected")
        self.assertEqual(connection.smtp_username, "ava@example.com")
        self.assertNotEqual(connection.encrypted_password, "app-password")
        self.assertTrue(_serialize_connection(connection)["can_send"])
        self.assertTrue(_serialize_connection(connection)["can_sync"])
        imap_mock.assert_called_once()
        smtp_mock.assert_called_once()

    def test_upsert_google_mail_connection_rejects_account_swap(self):
        self.db.add(
            UserMailConnection(
                id=1,
                tenant_id=10,
                user_id=1,
                provider=MailProvider.google.value,
                status="connected",
                account_email="ava@example.com",
            )
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            upsert_google_mail_connection(
                self.db,
                tenant_id=10,
                user=self.user,
                token_json={"access_token": "token", "scope": "https://www.googleapis.com/auth/gmail.send"},
                account_email="attacker@example.com",
            )

        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(self.db.query(UserMailConnection).first().account_email, "ava@example.com")

    def test_upsert_google_mail_connection_rejects_first_connect_email_mismatch(self):
        with self.assertRaises(HTTPException) as exc:
            upsert_google_mail_connection(
                self.db,
                tenant_id=10,
                user=self.user,
                token_json={"access_token": "token", "scope": "https://www.googleapis.com/auth/gmail.send"},
                account_email="attacker@example.com",
            )

        self.assertEqual(exc.exception.status_code, 409)
        self.assertEqual(self.db.query(UserMailConnection).count(), 0)

    @patch.object(mail_services.settings, "JWT_SECRET", "test-mail-secret")
    def test_sync_imap_smtp_inbox_stores_user_scoped_message(self):
        raw_message = (
            b"From: Sender <sender@example.com>\r\n"
            b"To: Ava <ava@example.com>\r\n"
            b"Subject: Hello\r\n"
            b"Date: Sun, 03 May 2026 10:00:00 +0000\r\n"
            b"Message-ID: <abc@example.com>\r\n"
            b"\r\n"
            b"Mail body"
        )
        connection = UserMailConnection(
            id=1,
            tenant_id=10,
            user_id=1,
            provider=MailProvider.imap_smtp.value,
            status="connected",
            account_email="ava@example.com",
            imap_host="imap.example.com",
            imap_port=993,
            imap_security="ssl",
            imap_username="ava@example.com",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_security="starttls",
            smtp_username="ava@example.com",
            encrypted_password=encrypt_secret("app-password"),
            last_synced_at=datetime.now(timezone.utc),
        )
        self.db.add(connection)
        self.db.add(
            MailMessage(
                id=1,
                tenant_id=10,
                owner_user_id=1,
                connection_id=1,
                provider=MailProvider.imap_smtp.value,
                provider_message_id="imap:42",
                direction="inbound",
                folder="inbox",
                subject="Old",
            )
        )
        self.db.commit()

        with patch.object(mail_services, "_connect_imap", return_value=FakeImapClient(raw_message)):
            result = sync_imap_smtp_inbox(self.db, current_user=SimpleNamespace(id=1, tenant_id=10))

        self.assertEqual(result["provider"], MailProvider.imap_smtp.value)
        self.assertEqual(result["synced_message_count"], 0)
        message = self.db.query(mail_services.MailMessage).first()
        self.assertEqual(message.tenant_id, 10)
        self.assertEqual(message.owner_user_id, 1)
        self.assertEqual(message.provider_message_id, "imap:42")
        self.assertEqual(message.from_email, "sender@example.com")
        self.assertEqual(message.subject, "Hello")
        self.assertEqual(message.body_text, "Mail body")
        self.assertEqual(result["last_error"], None)
        self.assertEqual(self.db.query(UserMailConnection).first().sync_cursor, "42")

    @patch.object(mail_services.settings, "JWT_SECRET", "test-mail-secret")
    def test_sync_imap_smtp_inbox_filters_boundary_uid_and_keeps_cursor_order(self):
        connection = UserMailConnection(
            id=1,
            tenant_id=10,
            user_id=1,
            provider=MailProvider.imap_smtp.value,
            status="connected",
            account_email="ava@example.com",
            imap_host="imap.example.com",
            imap_port=993,
            imap_security="ssl",
            imap_username="ava@example.com",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_security="starttls",
            smtp_username="ava@example.com",
            encrypted_password=encrypt_secret("app-password"),
            sync_cursor="42",
        )
        self.db.add(connection)
        self.db.commit()
        fake_imap = FakeImapClient(raw_message=b"Subject: New\r\n\r\nBody", search_uids=b"42 45 43")

        with patch.object(mail_services, "_connect_imap", return_value=fake_imap), \
             patch.object(mail_services, "_sync_imap_message", return_value=True) as sync_mock:
            result = sync_imap_smtp_inbox(self.db, current_user=SimpleNamespace(id=1, tenant_id=10))

        self.assertEqual(fake_imap.fetched_uids, ["43", "45"])
        self.assertEqual([call.kwargs["uid"] for call in sync_mock.call_args_list], ["43", "45"])
        self.assertEqual(result["synced_message_count"], 2)
        self.assertEqual(self.db.query(UserMailConnection).first().sync_cursor, "45")

    @patch.object(mail_services.settings, "JWT_SECRET", "test-mail-secret")
    def test_send_imap_smtp_message_uses_smtp_and_appends_to_sent_folder(self):
        connection = UserMailConnection(
            id=1,
            tenant_id=10,
            user_id=1,
            provider=MailProvider.imap_smtp.value,
            status="connected",
            account_email="ava@example.com",
            imap_host="imap.example.com",
            imap_port=993,
            imap_security="ssl",
            imap_username="ava@example.com",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_security="starttls",
            smtp_username="ava@example.com",
            encrypted_password=encrypt_secret("app-password"),
        )
        self.db.add(connection)
        self.db.commit()
        fake_imap = FakeImapClient()
        fake_smtp = FakeSmtpClient()

        with patch.object(mail_services, "_connect_smtp", return_value=fake_smtp), \
             patch.object(mail_services, "_connect_imap", return_value=fake_imap):
            provider_message_id = _send_imap_smtp_message(
                db=self.db,
                connection=connection,
                sender_email="ava@example.com",
                payload={
                    "to": ["buyer@example.com"],
                    "cc": [],
                    "bcc": [],
                    "subject": "Quote",
                    "body_text": "Quote body",
                },
            )

        self.assertTrue(provider_message_id)
        self.assertEqual(fake_smtp.username, "ava@example.com")
        self.assertEqual(fake_smtp.sent_message["Subject"], "Quote")
        self.assertEqual(fake_imap.appended_folder, "Sent")

    @patch.object(mail_services.settings, "JWT_SECRET", "test-mail-secret")
    def test_send_imap_smtp_message_records_sent_append_failure(self):
        connection = UserMailConnection(
            id=1,
            tenant_id=10,
            user_id=1,
            provider=MailProvider.imap_smtp.value,
            status="connected",
            account_email="ava@example.com",
            imap_host="imap.example.com",
            imap_port=993,
            imap_security="ssl",
            imap_username="ava@example.com",
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_security="starttls",
            smtp_username="ava@example.com",
            encrypted_password=encrypt_secret("app-password"),
        )
        self.db.add(connection)
        self.db.commit()
        fake_imap = FakeImapClient(append_status="NO")
        fake_smtp = FakeSmtpClient()

        with patch.object(mail_services, "_connect_smtp", return_value=fake_smtp), \
             patch.object(mail_services, "_connect_imap", return_value=fake_imap), \
             patch.object(mail_services.logger, "warning") as warning_mock:
            provider_message_id = _send_imap_smtp_message(
                db=self.db,
                connection=connection,
                sender_email="ava@example.com",
                payload={
                    "to": ["buyer@example.com"],
                    "cc": [],
                    "bcc": [],
                    "subject": "Quote",
                    "body_text": "Quote body",
                },
            )

        self.assertTrue(provider_message_id)
        self.assertIn("IMAP sent-folder append failed", connection.last_error)
        warning_mock.assert_called_once()
        self.assertEqual(warning_mock.call_args.kwargs["extra"]["tenant_id"], 10)
        self.assertEqual(warning_mock.call_args.kwargs["extra"]["user_id"], 1)
        self.assertEqual(warning_mock.call_args.kwargs["extra"]["connection_id"], 1)

    def test_mail_source_context_resolves_existing_tenant_record(self):
        context = mail_services._resolve_mail_source_context(
            self.db,
            current_user=self.user,
            payload={"source_module_key": "sales_contacts", "source_entity_id": "7"},
        )

        self.assertEqual(
            context,
            {"module_key": "sales_contacts", "entity_type": "sales_contact", "entity_id": "7"},
        )

    def test_mail_source_context_rejects_partial_source(self):
        with self.assertRaises(HTTPException) as exc:
            mail_services._resolve_mail_source_context(
                self.db,
                current_user=self.user,
                payload={"source_module_key": "sales_contacts"},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Mail source requires both module and record.")

    def test_mail_source_context_rejects_cross_tenant_record(self):
        with self.assertRaises(HTTPException) as exc:
            mail_services._resolve_mail_source_context(
                self.db,
                current_user=self.user,
                payload={"source_module_key": "sales_contacts", "source_entity_id": "8"},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Mail source is not available.")

    def test_mail_source_context_masks_invalid_record_identifier(self):
        with self.assertRaises(HTTPException) as exc:
            mail_services._resolve_mail_source_context(
                self.db,
                current_user=self.user,
                payload={"source_module_key": "sales_contacts", "source_entity_id": "not-a-number"},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Mail source is not available.")

    def test_mail_source_activity_logs_to_record_timeline(self):
        message = MailMessage(
            id=77,
            tenant_id=10,
            owner_user_id=1,
            provider=MailProvider.imap_smtp.value,
            direction="outbound",
            folder="sent",
            from_email="ava@example.com",
            to_recipients=[{"email": "lead@example.com", "name": None}],
            subject="Quote",
            body_text="Quote body",
            source_module_key="sales_contacts",
            source_entity_id="7",
            source_label="lead@example.com",
        )

        with patch.object(mail_services, "log_activity") as log_mock:
            mail_services._log_mail_source_activity(
                self.db,
                current_user=self.user,
                message=message,
                source_context={"module_key": "sales_contacts", "entity_type": "sales_contact", "entity_id": "7"},
            )

        log_mock.assert_called_once()
        call_kwargs = log_mock.call_args.kwargs
        self.assertEqual(call_kwargs["tenant_id"], 10)
        self.assertEqual(call_kwargs["module_key"], "sales_contacts")
        self.assertEqual(call_kwargs["entity_type"], "sales_contact")
        self.assertEqual(call_kwargs["entity_id"], "7")
        self.assertEqual(call_kwargs["action"], "mail.sent")

    def test_link_mail_message_to_record_sets_source_with_tenant_scope(self):
        message = MailMessage(
            id=78,
            tenant_id=10,
            owner_user_id=1,
            provider=MailProvider.imap_smtp.value,
            direction="inbound",
            folder="inbox",
            from_email="lead@example.com",
            subject="Intro",
        )
        self.db.add(message)
        self.db.commit()

        with patch.object(mail_services, "log_activity") as log_mock:
            linked = mail_services.link_mail_message_to_record(
                self.db,
                message_id=78,
                current_user=self.user,
                payload={"source_module_key": "sales_contacts", "source_entity_id": "7"},
            )

        self.assertEqual(linked.source_module_key, "sales_contacts")
        self.assertEqual(linked.source_entity_id, "7")
        self.assertEqual(linked.source_label, "lead@example.com")
        log_mock.assert_called_once()
        self.assertEqual(log_mock.call_args.kwargs["action"], "mail.linked")

    def test_link_mail_message_to_record_rejects_cross_tenant_record(self):
        message = MailMessage(
            id=79,
            tenant_id=10,
            owner_user_id=1,
            provider=MailProvider.imap_smtp.value,
            direction="inbound",
            folder="inbox",
            from_email="other@example.com",
            subject="Intro",
        )
        self.db.add(message)
        self.db.commit()

        with self.assertRaises(HTTPException) as exc:
            mail_services.link_mail_message_to_record(
                self.db,
                message_id=79,
                current_user=self.user,
                payload={"source_module_key": "sales_contacts", "source_entity_id": "8"},
            )

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Selected record is not available.")

    def test_send_mail_message_keeps_success_when_activity_logging_fails(self):
        connection = UserMailConnection(
            id=1,
            tenant_id=10,
            user_id=1,
            provider=MailProvider.imap_smtp.value,
            status="connected",
            account_email="ava@example.com",
        )
        self.db.add(connection)
        self.db.commit()
        def mail_message_factory(**kwargs):
            return MailMessage(id=77, **kwargs)

        with patch.object(mail_services, "_resolve_mail_source_context", return_value={"module_key": "sales_contacts", "entity_type": "sales_contact", "entity_id": "7"}), \
             patch.object(mail_services, "_mail_connection_for_user", return_value=connection), \
             patch.object(mail_services, "_send_imap_smtp_message", return_value="smtp-id"), \
             patch.object(mail_services, "MailMessage", side_effect=mail_message_factory), \
             patch.object(mail_services, "_log_mail_source_activity", side_effect=RuntimeError("timeline failed")), \
             patch.object(mail_services.logger, "exception") as exception_mock:
            message = mail_services.send_mail_message(
                self.db,
                current_user=self.user,
                payload={
                    "provider": MailProvider.imap_smtp.value,
                    "to": ["buyer@example.com"],
                    "cc": [],
                    "bcc": [],
                    "subject": "Quote",
                    "body_text": "Quote body",
                    "source_module_key": "sales_contacts",
                    "source_entity_id": "7",
                },
            )

        self.assertEqual(message.provider_message_id, "smtp-id")
        self.assertEqual(self.db.query(MailMessage).filter(MailMessage.provider_message_id == "smtp-id").count(), 1)
        exception_mock.assert_called_once()
        self.assertEqual(exception_mock.call_args.kwargs["extra"]["tenant_id"], 10)
        self.assertEqual(exception_mock.call_args.kwargs["extra"]["message_id"], message.id)

    def test_mail_token_refresh_flushes_without_committing(self):
        db = Mock()

        google_connection = SimpleNamespace(
            access_token=None,
            refresh_token="google-refresh",
            token_expires_at=None,
            status="connected",
            last_error=None,
        )
        google_response = SimpleNamespace(ok=True, json=lambda: {"access_token": "new-google-token", "expires_in": 3600})
        with patch.object(mail_services.requests, "post", return_value=google_response):
            token = mail_services._refresh_google_mail_token(db, google_connection)

        self.assertEqual(token, "new-google-token")
        self.assertEqual(google_connection.access_token, "new-google-token")
        self.assertEqual(db.flush.call_count, 1)
        db.commit.assert_not_called()

        db.reset_mock()
        microsoft_connection = SimpleNamespace(
            access_token=None,
            refresh_token="microsoft-refresh",
            token_expires_at=None,
            status="connected",
            last_error=None,
        )
        microsoft_response = SimpleNamespace(ok=True, json=lambda: {"access_token": "new-microsoft-token", "expires_in": 3600})
        with patch.object(mail_services.settings, "MICROSOFT_CLIENT_ID", "client-id"), \
             patch.object(mail_services.settings, "MICROSOFT_CLIENT_SECRET", "client-secret"), \
             patch.object(mail_services.requests, "post", return_value=microsoft_response):
            token = mail_services._refresh_microsoft_mail_token(db, microsoft_connection)

        self.assertEqual(token, "new-microsoft-token")
        self.assertEqual(microsoft_connection.access_token, "new-microsoft-token")
        self.assertEqual(db.flush.call_count, 1)
        db.commit.assert_not_called()

    def test_list_mail_messages_uses_cursor_and_skips_tiny_search(self):
        self.db.add_all(
            [
                MailMessage(
                    id=10,
                    tenant_id=10,
                    owner_user_id=1,
                    direction="inbound",
                    folder="inbox",
                    subject="Alpha",
                ),
                MailMessage(
                    id=11,
                    tenant_id=10,
                    owner_user_id=1,
                    direction="inbound",
                    folder="inbox",
                    subject="Beta",
                ),
            ]
        )
        self.db.commit()

        with patch.object(mail_services.mail_repository, "apply_ranked_search", wraps=mail_services.mail_repository.apply_ranked_search) as search_mock:
            messages = mail_services.list_mail_messages(
                self.db,
                tenant_id=10,
                current_user=self.user,
                folder=" inbox ",
                search="a",
                before_id=11,
            )

        self.assertEqual([message.id for message in messages], [10])
        search_mock.assert_not_called()

    def test_connect_imap_uses_timeout_for_ssl_and_plain_clients(self):
        with patch.object(mail_services.imaplib, "IMAP4_SSL", return_value=Mock()) as ssl_mock:
            mail_services._connect_imap("imap.example.com", 993, "ssl")

        self.assertEqual(ssl_mock.call_args.kwargs["timeout"], 20)

        plain_client = Mock()
        with patch.object(mail_services.imaplib, "IMAP4", return_value=plain_client) as plain_mock:
            mail_services._connect_imap("imap.example.com", 143, "none")

        self.assertEqual(plain_mock.call_args.kwargs["timeout"], 20)
        plain_client.starttls.assert_not_called()

    def test_parse_recipients_unfolds_multiline_headers(self):
        recipients = mail_services._parse_recipients(
            "Ava Admin <ava@example.com>,\r\n\tBuyer <buyer@example.com>"
        )

        self.assertEqual(
            recipients,
            [
                {"email": "ava@example.com", "name": "Ava Admin"},
                {"email": "buyer@example.com", "name": "Buyer"},
            ],
        )

    def test_extract_email_text_prefers_longest_plain_part(self):
        message = EmailMessage()
        message.set_content("Short")
        message.add_alternative("<p>Ignored html body</p>", subtype="html")
        message.add_attachment(
            "This is the longer plain text body.",
            subtype="plain",
            filename=None,
            disposition="inline",
        )

        self.assertEqual(mail_services._extract_email_text(message), "This is the longer plain text body.\n")

    def test_google_sync_requests_partial_fields(self):
        connection = UserMailConnection(
            id=1,
            tenant_id=10,
            user_id=1,
            provider=MailProvider.google.value,
            status="connected",
            account_email="ava@example.com",
        )
        self.db.add(connection)
        self.db.commit()
        list_response = SimpleNamespace(ok=True, json=lambda: {"messages": [{"id": "m1"}]})
        detail_response = SimpleNamespace(ok=True, json=lambda: {"id": "m1", "payload": {"headers": []}})

        with patch.object(mail_services.settings, "GOOGLE_GMAIL_RESTRICTED_SYNC_ENABLED", True), \
             patch.object(mail_services, "_refresh_google_mail_token", return_value="token"), \
             patch.object(mail_services.requests, "get", side_effect=[list_response, detail_response]) as get_mock, \
             patch.object(mail_services, "_sync_google_message", return_value=True):
            result = mail_services.sync_google_inbox(self.db, current_user=self.user)

        self.assertEqual(result["synced_message_count"], 1)
        self.assertEqual(get_mock.call_args_list[0].kwargs["params"]["fields"], mail_services.GMAIL_MESSAGE_LIST_FIELDS)
        self.assertEqual(get_mock.call_args_list[1].kwargs["params"]["fields"], mail_services.GMAIL_MESSAGE_DETAIL_FIELDS)

    @patch.object(mail_services.settings, "JWT_SECRET", "test-mail-secret")
    def test_disconnect_mail_connection_clears_credentials_and_disables_capabilities(self):
        self.db.add(
            UserMailConnection(
                id=1,
                tenant_id=10,
                user_id=1,
                provider=MailProvider.imap_smtp.value,
                status="connected",
                account_email="ava@example.com",
                scopes=["imap.read", "smtp.send"],
                imap_host="imap.example.com",
                imap_port=993,
                imap_security="ssl",
                imap_username="ava@example.com",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_security="starttls",
                smtp_username="ava@example.com",
                encrypted_password=encrypt_secret("app-password"),
                sync_cursor="42",
            )
        )
        self.db.commit()

        connection = disconnect_mail_connection(
            self.db,
            tenant_id=10,
            user_id=1,
            provider=MailProvider.imap_smtp,
        )

        self.assertEqual(connection.status, "disconnected")
        self.assertIsNone(connection.encrypted_password)
        self.assertIsNone(connection.imap_host)
        self.assertIsNone(connection.sync_cursor)
        self.assertFalse(_serialize_connection(connection)["can_send"])
        self.assertFalse(_serialize_connection(connection)["can_sync"])

    def test_disconnect_mail_connection_rejects_missing_connection(self):
        with self.assertRaises(HTTPException) as exc:
            disconnect_mail_connection(
                self.db,
                tenant_id=10,
                user_id=1,
                provider=MailProvider.imap_smtp,
            )

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(self.db.query(UserMailConnection).count(), 0)

    @patch.object(mail_services.settings, "JWT_SECRET", "old-mail-secret")
    @patch.object(mail_services.settings, "MAIL_CREDENTIAL_SECRET", None)
    def test_imap_password_reencrypts_after_secret_rotation(self):
        legacy_encrypted_password = encrypt_secret("app-password")
        self.db.add(
            UserMailConnection(
                id=1,
                tenant_id=10,
                user_id=1,
                provider=MailProvider.imap_smtp.value,
                status="connected",
                account_email="ava@example.com",
                imap_host="imap.example.com",
                imap_port=993,
                imap_security="ssl",
                imap_username="ava@example.com",
                smtp_host="smtp.example.com",
                smtp_port=587,
                smtp_security="starttls",
                smtp_username="ava@example.com",
                encrypted_password=legacy_encrypted_password,
            )
        )
        self.db.commit()

        fake_imap = FakeImapClient()
        fake_smtp = FakeSmtpClient()

        with patch.object(mail_services.settings, "JWT_SECRET", "old-mail-secret"), \
             patch.object(mail_services.settings, "MAIL_CREDENTIAL_SECRET", "new-mail-secret"), \
             patch.object(mail_services, "_connect_smtp", return_value=fake_smtp), \
             patch.object(mail_services, "_connect_imap", return_value=fake_imap):
            _send_imap_smtp_message(
                db=self.db,
                connection=self.db.query(UserMailConnection).first(),
                sender_email="ava@example.com",
                payload={
                    "to": ["buyer@example.com"],
                    "cc": [],
                    "bcc": [],
                    "subject": "Quote",
                    "body_text": "Quote body",
                },
            )

        connection = self.db.query(UserMailConnection).first()
        self.assertNotEqual(connection.encrypted_password, legacy_encrypted_password)
        with patch.object(mail_services.settings, "JWT_SECRET", "old-mail-secret"), \
             patch.object(mail_services.settings, "MAIL_CREDENTIAL_SECRET", "new-mail-secret"):
            self.assertEqual(decrypt_secret(connection.encrypted_password), "app-password")


if __name__ == "__main__":
    unittest.main()
