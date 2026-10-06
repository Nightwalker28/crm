"""13 §7 Step 2: request ids, one error shape, security headers, readiness, the background
watchdog, realtime wake-ups and OIDC token checks after the PyJWT move."""

import asyncio
import json
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm

from app.core import background_health, realtime, realtime_hooks
from app.core.http_errors import ErrorBoundaryMiddleware, SecurityHeadersMiddleware, register_exception_handlers
from app.core.observability import RequestContextMiddleware


def _app_with_stack() -> FastAPI:
    """The production order from app/main.py, minus the tenant and cookie middleware."""
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/ok")
    def ok():
        return {"ok": True}

    @app.get("/boom")
    def boom():
        raise RuntimeError("secret internals")

    @app.get("/denied")
    def denied():
        raise HTTPException(status_code=403, detail={"code": "nope", "message": "No"})

    app.add_middleware(ErrorBoundaryMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://app.test"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestContextMiddleware)
    return app


class ErrorShapeAndHeadersTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(_app_with_stack(), raise_server_exceptions=False)

    def test_every_response_carries_a_request_id_and_a_good_one_is_kept(self):
        generated = self.client.get("/ok")
        self.assertRegex(generated.headers["x-request-id"], r"^[0-9a-f]{32}$")
        kept = self.client.get("/ok", headers={"X-Request-ID": "trace-1234abcd"})
        self.assertEqual(kept.headers["x-request-id"], "trace-1234abcd")
        replaced = self.client.get("/ok", headers={"X-Request-ID": "bad id with spaces"})
        self.assertNotEqual(replaced.headers["x-request-id"], "bad id with spaces")

    def test_unhandled_error_is_a_readable_500_with_cors_and_no_internals(self):
        with self.assertLogs("app.errors", level="ERROR"):
            response = self.client.get("/boom", headers={"Origin": "http://app.test"})
        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertNotIn("secret internals", response.text)
        self.assertEqual(body["request_id"], response.headers["x-request-id"])
        self.assertEqual(response.headers["access-control-allow-origin"], "http://app.test")

    def test_http_errors_keep_their_detail_and_gain_the_request_id(self):
        response = self.client.get("/denied")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["detail"], {"code": "nope", "message": "No"})
        self.assertEqual(response.json()["request_id"], response.headers["x-request-id"])
        missing = self.client.get("/nowhere")
        self.assertEqual(missing.status_code, 404)
        self.assertIn("request_id", missing.json())

    def test_security_headers_and_hsts_only_over_secure_cookies(self):
        response = self.client.get("/ok")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertIn("frame-ancestors 'none'", response.headers["content-security-policy"])
        self.assertIn("default-src 'none'", response.headers["content-security-policy"])
        self.assertNotIn("strict-transport-security", response.headers)
        with patch("app.core.http_errors.settings.COOKIE_SECURE", True):
            secure = self.client.get("/ok")
        self.assertIn("max-age=", secure.headers["strict-transport-security"])

    def test_main_app_wraps_errors_inside_cors_and_request_context_outermost(self):
        from app.main import app

        order = [entry.cls.__name__ for entry in app.user_middleware]
        # user_middleware lists outermost first.
        self.assertEqual(order[0], "RequestContextMiddleware")
        self.assertLess(order.index("CORSMiddleware"), order.index("ErrorBoundaryMiddleware"))
        self.assertEqual(order[-1], "ErrorBoundaryMiddleware")


class _FakeRedis:
    def __init__(self):
        self.values: dict[str, str] = {}
        self.queue_depth = 0

    def get(self, key):
        return self.values.get(key)

    def set(self, key, value, nx=False, xx=False, ex=None):
        if nx and key in self.values:
            return None
        if xx and key not in self.values:
            return None
        self.values[key] = value
        return True

    def delete(self, key):
        return 1 if self.values.pop(key, None) is not None else 0

    def llen(self, _key):
        return self.queue_depth

    def ping(self):
        return True


class BackgroundWatchdogTests(unittest.TestCase):
    def setUp(self):
        self.redis = _FakeRedis()
        patches = [
            patch.object(background_health, "_state_client", return_value=self.redis),
            patch.object(background_health, "_redis_from_url", return_value=self.redis),
            patch.object(background_health.settings, "CELERY_BROKER_URL", "redis://broker:6379/0"),
            patch.object(background_health, "_notify_operator"),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.notify = background_health._notify_operator

    def _stamp(self, key, age_seconds):
        self.redis.values[key] = json.dumps({"at": time.time() - age_seconds})

    def test_fresh_heartbeats_are_healthy(self):
        self._stamp(background_health.BEAT_HEARTBEAT_KEY, 10)
        self._stamp(background_health.WORKER_HEARTBEAT_KEY, 20)
        background = background_health.check_background()
        self.assertEqual(background["beat"]["status"], "ok")
        self.assertEqual(background["worker"]["status"], "ok")
        self.assertEqual(background_health.background_problems(background), [])
        self.assertIsNone(background_health.run_watchdog_check())

    def test_stopped_worker_alerts_once_then_recovers_once(self):
        self._stamp(background_health.BEAT_HEARTBEAT_KEY, 10)
        self._stamp(background_health.WORKER_HEARTBEAT_KEY, 3600)
        self.redis.queue_depth = 42
        with self.assertLogs("app.background_health", level="ERROR"):
            self.assertEqual(background_health.run_watchdog_check(), "problem")
        self.assertIsNone(background_health.run_watchdog_check())
        self.assertEqual(self.notify.call_count, 1)
        subject = self.notify.call_args.args[0]
        self.assertIn("worker", subject)
        self.assertIn("queue depth: 42", self.notify.call_args.args[1])

        self._stamp(background_health.WORKER_HEARTBEAT_KEY, 5)
        self.assertEqual(background_health.run_watchdog_check(), "recovered")
        self.assertIsNone(background_health.run_watchdog_check())
        self.assertEqual(self.notify.call_count, 2)

    def test_stopped_beat_is_reported_as_the_cause_not_the_worker(self):
        self._stamp(background_health.BEAT_HEARTBEAT_KEY, 3600)
        self._stamp(background_health.WORKER_HEARTBEAT_KEY, 3600)
        self.assertEqual(background_health.background_problems(background_health.check_background()), ["beat"])

    def test_missing_heartbeat_gets_a_grace_period_after_start(self):
        with patch.object(background_health, "_PROCESS_STARTED_AT", time.time()):
            self.assertEqual(background_health.check_background()["worker"]["status"], "starting")
        with patch.object(background_health, "_PROCESS_STARTED_AT", time.time() - 3600):
            self.assertEqual(background_health.check_background()["worker"]["status"], "error")

    def test_readiness_fails_when_a_check_fails(self):
        self._stamp(background_health.BEAT_HEARTBEAT_KEY, 10)
        self._stamp(background_health.WORKER_HEARTBEAT_KEY, 10)
        with patch.object(background_health, "check_database", return_value={"status": "ok"}):
            ready, body = background_health.readiness()
        self.assertTrue(ready)
        self.assertEqual(body["status"], "ready")
        with patch.object(background_health, "check_database", return_value={"status": "error"}):
            ready, body = background_health.readiness()
        self.assertFalse(ready)
        self.assertEqual(body["checks"]["database"]["status"], "error")

    def test_beat_stamps_only_when_publishing_the_heartbeat(self):
        from app.core.celery_app import stamp_beat_heartbeat

        with patch("app.core.celery_app.stamp_heartbeat") as stamp:
            stamp_beat_heartbeat(sender="app.tasks.something_else")
            stamp.assert_not_called()
            stamp_beat_heartbeat(sender=background_health.HEARTBEAT_TASK_NAME)
            stamp.assert_called_once_with(background_health.BEAT_HEARTBEAT_KEY)


class RealtimeWakeupTests(unittest.TestCase):
    def setUp(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        from app.core.database import Base
        from app.modules.platform.models import DataTransferJob, UserNotification
        from app.modules.user_management.models import Tenant, User, UserStatus

        from sqlalchemy.pool import StaticPool

        # One shared connection: the stream reads from a worker thread.
        engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(engine, tables=[Tenant.__table__, User.__table__, UserNotification.__table__, DataTransferJob.__table__])
        self.Session = sessionmaker(bind=engine)
        with self.Session() as db:
            db.add_all([
                Tenant(id=10, slug="t", name="T"),
                User(id=1, tenant_id=10, email="a@example.com", is_active=UserStatus.active),
            ])
            db.commit()
        self.UserNotification = UserNotification

    def _notification(self, **overrides):
        values = {"tenant_id": 10, "user_id": 1, "category": "task", "title": "Hi", "message": "m", "status": "unread"}
        values.update(overrides)
        return self.UserNotification(**values)

    def test_commit_publishes_one_wakeup_per_user_and_rollback_publishes_none(self):
        with patch.object(realtime_hooks, "publish_realtime_wakeups") as publish:
            with self.Session() as db:
                db.add(self._notification())
                db.add(self._notification(title="Second"))
                db.commit()
            publish.assert_called_once_with({(10, 1)})
            publish.reset_mock()
            with self.Session() as db:
                db.add(self._notification())
                db.flush()
                db.rollback()
            publish.assert_not_called()

    def test_bulk_mark_all_read_wakes_the_user(self):
        from app.modules.platform.services.notifications import mark_all_notifications_read

        with self.Session() as db:
            db.add(self._notification())
            db.commit()
        with patch.object(realtime_hooks, "publish_realtime_wakeups") as publish:
            with self.Session() as db:
                mark_all_notifications_read(db, tenant_id=10, user_id=1)
            publish.assert_called_once_with({(10, 1)})

    def test_stream_without_redis_polls_off_the_event_loop(self):
        async def first_events():
            stream = realtime.realtime_stream(tenant_id=10, user_id=1)
            first = await stream.__anext__()
            with self.Session() as db:
                # SQLite's CURRENT_TIMESTAMP has whole seconds; be clearly after the start marker.
                later = datetime.now(timezone.utc) + timedelta(minutes=1)
                db.add(self._notification(title="Fresh", created_at=later, updated_at=later))
                db.commit()
            second = await asyncio.wait_for(stream.__anext__(), timeout=5)
            await stream.aclose()
            return first, second

        with patch.object(realtime, "SessionLocal", self.Session), \
             patch.object(realtime, "REALTIME_POLL_INTERVAL_SECONDS", 0.05), \
             patch.object(realtime_hooks, "publish_realtime_wakeups"), \
             patch.object(realtime.settings, "REDIS_URL", None), \
             patch.object(realtime.asyncio, "to_thread", wraps=asyncio.to_thread) as to_thread:
            first, second = asyncio.run(first_events())
        self.assertIn("event: heartbeat", first)
        self.assertIn("event: notification.created", second)
        self.assertIn('"title":"Fresh"', second)
        self.assertGreaterEqual(to_thread.call_count, 2)
        self.assertEqual(realtime._hub._listeners, {})


class OidcTokenValidationTests(unittest.TestCase):
    def setUp(self):
        self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        jwk = json.loads(RSAAlgorithm.to_jwk(self.private_key.public_key()))
        jwk["kid"] = "k1"
        self.jwks = {"keys": [jwk]}
        self.settings_row = type("Row", (), {"client_id": "client-1"})()
        self.metadata = {"jwks_uri": "https://idp.test/jwks", "issuer": "https://idp.test"}

    def _validate(self, token):
        from app.modules.user_management.services import sso

        response = type("Response", (), {"json": lambda _self: self.jwks})()
        with patch.object(sso.requests, "get", return_value=response):
            return sso._validate_id_token(self.settings_row, metadata=self.metadata, token_json={"id_token": token}, nonce="n1")

    def _claims(self):
        now = int(time.time())
        return {"iss": "https://idp.test", "aud": "client-1", "sub": "u1", "nonce": "n1", "iat": now, "exp": now + 300, "email": "a@example.com"}

    def test_a_token_signed_by_the_provider_key_passes(self):
        token = jwt.encode(self._claims(), self.private_key, algorithm="RS256", headers={"kid": "k1"})
        self.assertEqual(self._validate(token)["email"], "a@example.com")

    def test_a_wrong_audience_or_an_hmac_algorithm_is_refused(self):
        claims = {**self._claims(), "aud": "someone-else"}
        token = jwt.encode(claims, self.private_key, algorithm="RS256", headers={"kid": "k1"})
        with self.assertRaises(HTTPException):
            self._validate(token)
        forged = jwt.encode(self._claims(), "public-key-as-secret-padding-padding-32b", algorithm="HS256", headers={"kid": "k1"})
        with self.assertRaises(HTTPException):
            self._validate(forged)



class ViewerMailboxStateTests(unittest.TestCase):
    """13a I10: another user's mailbox must not read as the viewer's own."""

    def test_viewer_sees_their_own_mailbox_state_beside_the_tenant_count(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        from app.core.database import Base
        from app.modules.calendar.models import UserCalendarConnection
        from app.modules.mail.models import UserMailConnection
        from app.modules.platform.services.integrations_registry import _viewer_connections
        from app.modules.user_management.models import Tenant, User, UserStatus

        engine = create_engine("sqlite://")
        Base.metadata.create_all(engine, tables=[Tenant.__table__, User.__table__, UserMailConnection.__table__, UserCalendarConnection.__table__])
        db = sessionmaker(bind=engine)()
        db.add_all([
            Tenant(id=1, slug="t", name="T"),
            User(id=1, tenant_id=1, email="admin@example.com", is_active=UserStatus.active),
            User(id=2, tenant_id=1, email="rep@example.com", is_active=UserStatus.active),
        ])
        db.add(UserMailConnection(id=1, tenant_id=1, user_id=2, provider="google", status="connected", account_email="rep@example.com"))
        db.commit()

        admin_view = _viewer_connections(db, tenant_id=1, user_id=1)
        rep_view = _viewer_connections(db, tenant_id=1, user_id=2)
        self.assertEqual(admin_view["google_mail"], {"viewer_status": "disconnected", "viewer_account_label": None})
        self.assertEqual(rep_view["google_mail"]["viewer_status"], "connected")
        self.assertEqual(rep_view["google_mail"]["viewer_account_label"], "rep@example.com")
        db.close()


if __name__ == "__main__":
    unittest.main()
