import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.modules.platform.models import MessageTemplate
from app.modules.platform.services.message_templates import (
    create_message_template,
    extract_template_variables,
    render_template_text,
    update_message_template,
)
from app.modules.user_management import models as user_management_models  # noqa: F401


class MessageTemplateRenderingTests(unittest.TestCase):
    def test_dotted_variables_are_extracted_and_rendered(self):
        body = "Dear {{contact.first_name}}, your quote {{ quote.number }} is ready."

        self.assertEqual(extract_template_variables(body), ["contact.first_name", "quote.number"])
        self.assertEqual(
            render_template_text(body, {"contact": {"first_name": "Maya"}, "quote": {"number": "Q-1042"}}),
            "Dear Maya, your quote Q-1042 is ready.",
        )

    def test_missing_dotted_variable_renders_blank(self):
        self.assertEqual(render_template_text("Hi {{contact.first_name}}", {"contact": {}}), "Hi ")


class MessageTemplateWriteTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        self.SessionLocal = sessionmaker(bind=engine)
        self.db = self.SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_create_message_template_rejects_duplicate_normalized_key(self):
        self.db.add(
            MessageTemplate(
                id=1,
                tenant_id=10,
                template_key="welcome_email",
                name="Welcome Email",
                channel="email",
                body="Hi {{contact.first_name}}",
                variables=["contact.first_name"],
            )
        )
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            create_message_template(
                self.db,
                tenant_id=10,
                actor_user_id=1,
                payload={
                    "name": "Welcome   Email!",
                    "channel": "email",
                    "body": "Hello",
                    "variables": [],
                },
            )

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.detail, "Template key already exists")

    def test_update_message_template_rejects_duplicate_normalized_key(self):
        existing = MessageTemplate(
            id=1,
            tenant_id=10,
            template_key="existing",
            name="Existing",
            channel="email",
            body="Hello",
            variables=[],
        )
        target = MessageTemplate(
            id=2,
            tenant_id=10,
            template_key="target",
            name="Target",
            channel="email",
            body="Hello",
            variables=[],
        )
        self.db.add_all([existing, target])
        self.db.commit()

        with self.assertRaises(HTTPException) as context:
            update_message_template(
                self.db,
                template=target,
                actor_user_id=1,
                payload={"template_key": "Existing"},
            )

        self.assertEqual(context.exception.status_code, 409)
        self.assertEqual(context.exception.detail, "Template key already exists")


if __name__ == "__main__":
    unittest.main()
