import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from app.modules.user_management.services import google_tokens


class FakeTokenQuery:
    def __init__(self, record):
        self.record = record

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self.record


class FakeDB:
    def __init__(self, record):
        self.record = record

    def query(self, *_args, **_kwargs):
        return FakeTokenQuery(self.record)


class GoogleTokenTests(unittest.TestCase):
    def test_get_valid_google_access_token_404_when_missing(self):
        db = FakeDB(None)

        with self.assertRaises(HTTPException) as exc:
            google_tokens.get_valid_google_access_token(db, user_id=7)

        self.assertEqual(exc.exception.status_code, 404)
        self.assertEqual(exc.exception.detail, "Google tokens not found")

    def test_get_valid_google_access_token_returns_existing_unexpired_token(self):
        record = SimpleNamespace(
            expires_at=datetime.utcnow() + timedelta(hours=1),
            access_token_enc="encrypted-access",
            refresh_token_enc=None,
        )
        db = FakeDB(record)

        with patch.object(google_tokens, "decrypt_secret", return_value="plain-access") as decrypt_mock:
            token = google_tokens.get_valid_google_access_token(db, user_id=7)

        self.assertEqual(token, "plain-access")
        decrypt_mock.assert_called_once_with("encrypted-access")

    def test_get_valid_google_access_token_requires_refresh_token_when_expired(self):
        record = SimpleNamespace(
            expires_at=datetime.utcnow() - timedelta(minutes=5),
            access_token_enc="encrypted-access",
            refresh_token_enc=None,
        )
        db = FakeDB(record)

        with self.assertRaises(HTTPException) as exc:
            google_tokens.get_valid_google_access_token(db, user_id=7)

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Google refresh token missing")

    def test_get_valid_google_access_token_401_when_refresh_response_has_no_access_token(self):
        record = SimpleNamespace(
            expires_at=datetime.utcnow() - timedelta(minutes=5),
            access_token_enc="encrypted-access",
            refresh_token_enc="encrypted-refresh",
        )
        db = FakeDB(record)
        fake_response = SimpleNamespace(json=lambda: {"error": "invalid_grant"})

        with patch.object(google_tokens, "decrypt_secret", return_value="plain-refresh"), \
             patch.object(google_tokens.requests, "post", return_value=fake_response) as post_mock, \
             patch.object(google_tokens, "upsert_google_tokens") as upsert_mock:
            with self.assertRaises(HTTPException) as exc:
                google_tokens.get_valid_google_access_token(db, user_id=7)

        self.assertEqual(exc.exception.status_code, 401)
        self.assertEqual(exc.exception.detail, "Failed to refresh Google token")
        self.assertTrue(post_mock.called)
        upsert_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
