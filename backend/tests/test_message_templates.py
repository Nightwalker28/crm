import unittest

from app.modules.platform.services.message_templates import extract_template_variables, render_template_text


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


if __name__ == "__main__":
    unittest.main()
