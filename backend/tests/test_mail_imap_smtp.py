import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.secrets import encrypt_secret
from app.modules.mail.models import MailMessage, UserMailConnection
from app.modules.mail.schema import MailProvider
from app.modules.mail.services import mail_services
from app.modules.mail.services.mail_services import (
    _serialize_connection,
    _send_imap_smtp_message,
    disconnect_mail_connection,
    sync_imap_smtp_inbox,
    upsert_imap_smtp_mail_connection,
)
from app.modules.user_management import models as user_management_models  # noqa: F401
from app.modules.user_management.models import Role, Tenant, User, UserStatus


class FakeImapClient:
    def __init__(self, raw_message: bytes | None = None):
        self.raw_message = raw_message
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
            return "OK", [b"42"]
        if command == "fetch":
            return "OK", [(b"42 (RFC822 {1}", self.raw_message or b"")]
        return "NO", []

    def append(self, folder, flags, date_time, raw_message):
        self.appended_folder = folder
        self.appended_message = raw_message
        return "OK", [b"APPEND completed"]

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


if __name__ == "__main__":
    unittest.main()
