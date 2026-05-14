import unittest
from urllib.parse import parse_qs, urlparse

from fastapi import HTTPException

from app.modules.whatsapp.services import whatsapp_services


class WhatsAppServiceTests(unittest.TestCase):
    def test_normalize_phone_keeps_international_number(self):
        self.assertEqual(
            whatsapp_services._normalize_phone_for_whatsapp("+94 77 123 4567"),
            "94771234567",
        )

    def test_normalize_phone_converts_local_sri_lanka_number(self):
        self.assertEqual(
            whatsapp_services._normalize_phone_for_whatsapp("077 123 4567", country="Sri Lanka"),
            "94771234567",
        )

    def test_normalize_phone_rejects_local_number_without_country(self):
        with self.assertRaises(HTTPException) as exc:
            whatsapp_services._normalize_phone_for_whatsapp("077 123 4567")

        self.assertEqual(exc.exception.status_code, 400)
        self.assertEqual(exc.exception.detail, "Contact phone number needs a country code for WhatsApp")

    def test_build_whatsapp_url_includes_phone_and_message(self):
        url = whatsapp_services._build_whatsapp_url(
            phone_number="94771234567",
            message="Hi Amaan, quote #42 is ready.",
        )
        parsed = urlparse(url)
        params = parse_qs(parsed.query)

        self.assertEqual(parsed.scheme, "https")
        self.assertEqual(parsed.netloc, "web.whatsapp.com")
        self.assertEqual(parsed.path, "/send")
        self.assertEqual(params["phone"], ["94771234567"])
        self.assertEqual(params["text"], ["Hi Amaan, quote #42 is ready."])


if __name__ == "__main__":
    unittest.main()
