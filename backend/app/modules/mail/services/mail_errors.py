"""Failure taxonomy for outbound mail.

A failed send has four meaningfully different recoveries, so the send path must
not collapse them into one generic 400:

- ``validation`` — the request itself is wrong. Fix the message and resend.
- ``mailbox_disconnected`` — credentials are missing, revoked, or expired
  beyond refresh. Nothing about the message will help; reconnect the mailbox.
- ``provider_rejected`` — the provider understood the request and refused it
  (bad recipient, blocked content, quota policy). Resending the same message
  fails the same way, so the UI must not offer a bare retry.
- ``provider_unavailable`` — transient (timeout, rate limit, 5xx). The same
  idempotency key may be retried safely.

``send_in_flight`` is not a fifth failure kind: it reports that an identical
send is already claimed, which is how the idempotency guard refuses to
duplicate an outbound message.
"""

from __future__ import annotations

import imaplib
import smtplib
import ssl

import requests
from fastapi import HTTPException, status

VALIDATION = "validation"
MAILBOX_DISCONNECTED = "mailbox_disconnected"
PROVIDER_REJECTED = "provider_rejected"
PROVIDER_UNAVAILABLE = "provider_unavailable"
SEND_IN_FLIGHT = "send_in_flight"

_STATUS_CODES = {
    VALIDATION: status.HTTP_422_UNPROCESSABLE_CONTENT,
    MAILBOX_DISCONNECTED: status.HTTP_409_CONFLICT,
    PROVIDER_REJECTED: status.HTTP_502_BAD_GATEWAY,
    PROVIDER_UNAVAILABLE: status.HTTP_503_SERVICE_UNAVAILABLE,
    SEND_IN_FLIGHT: status.HTTP_409_CONFLICT,
}

# Only these may be resent with the same idempotency key. Everything else needs
# the user to change something first.
_RETRYABLE_CODES = {PROVIDER_UNAVAILABLE}


class MailSendError(HTTPException):
    """A classified send failure.

    Subclasses ``HTTPException`` so every existing route surfaces it without a
    handler, while carrying the machine-readable ``code`` the composer branches
    on. The detail body stays a dict — the same shape other services already
    use for structured failures.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        provider: str | None = None,
        reconnect_required: bool = False,
    ) -> None:
        self.code = code
        self.message = message
        self.provider = provider
        self.retryable = code in _RETRYABLE_CODES
        self.reconnect_required = reconnect_required or code == MAILBOX_DISCONNECTED
        super().__init__(
            status_code=_STATUS_CODES.get(code, status.HTTP_400_BAD_REQUEST),
            detail={
                "code": code,
                "message": message,
                "provider": provider,
                "retryable": self.retryable,
                "reconnect_required": self.reconnect_required,
            },
        )


def _provider_error_message(body: dict | None, fallback: str) -> str:
    error = (body or {}).get("error")
    if isinstance(error, dict):
        return str(error.get("message") or fallback)
    if isinstance(error, str):
        return error or fallback
    return fallback


def classify_http_response(response, *, provider: str, fallback: str) -> MailSendError:
    """Translate a provider HTTP failure into the taxonomy.

    Authentication failures are credential problems rather than message
    problems, and 429/5xx are the provider asking to be retried later.
    """

    try:
        body = response.json() if response.content else {}
    except ValueError:
        body = {}
    detail = _provider_error_message(body if isinstance(body, dict) else {}, fallback)

    if response.status_code in {401, 403}:
        return MailSendError(
            MAILBOX_DISCONNECTED,
            "This mailbox is no longer authorized to send. Reconnect it and try again.",
            provider=provider,
        )
    if response.status_code == 429 or response.status_code >= 500:
        return MailSendError(
            PROVIDER_UNAVAILABLE,
            "The mail provider is temporarily unavailable. The message was not sent — retry in a moment.",
            provider=provider,
        )
    return MailSendError(PROVIDER_REJECTED, detail, provider=provider)


def classify_request_exception(exc: Exception, *, provider: str) -> MailSendError:
    """Transport-level failures never reached a provider decision."""

    if isinstance(exc, (requests.Timeout, requests.ConnectionError)):
        return MailSendError(
            PROVIDER_UNAVAILABLE,
            "The mail provider could not be reached. The message was not sent — retry in a moment.",
            provider=provider,
        )
    return MailSendError(
        PROVIDER_UNAVAILABLE,
        "The mail provider request failed before the message was accepted. Retry in a moment.",
        provider=provider,
    )


def classify_smtp_exception(exc: Exception, *, provider: str) -> MailSendError:
    """Map SMTP/IMAP failures onto the same taxonomy.

    SMTP encodes the distinction in its reply codes: 4xx is "try later", 5xx is
    a refusal. Authentication failures are credential problems regardless of
    the code they arrive with.
    """

    if isinstance(exc, (smtplib.SMTPAuthenticationError, imaplib.IMAP4.error)):
        return MailSendError(
            MAILBOX_DISCONNECTED,
            "The mailbox rejected the saved credentials. Reconnect IMAP/SMTP and try again.",
            provider=provider,
        )
    if isinstance(exc, (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused)):
        return MailSendError(
            PROVIDER_REJECTED,
            "The mail server refused one of the addresses on this message.",
            provider=provider,
        )
    if isinstance(exc, smtplib.SMTPResponseException):
        code = int(getattr(exc, "smtp_code", 0) or 0)
        if 400 <= code < 500:
            return MailSendError(
                PROVIDER_UNAVAILABLE,
                "The mail server asked to try again later. The message was not sent.",
                provider=provider,
            )
        return MailSendError(
            PROVIDER_REJECTED,
            "The mail server refused this message.",
            provider=provider,
        )
    if isinstance(
        exc,
        (
            smtplib.SMTPConnectError,
            smtplib.SMTPServerDisconnected,
            ssl.SSLError,
            TimeoutError,
            OSError,
        ),
    ):
        return MailSendError(
            PROVIDER_UNAVAILABLE,
            "The mail server could not be reached. The message was not sent — retry in a moment.",
            provider=provider,
        )
    return MailSendError(
        PROVIDER_REJECTED,
        "The mail server refused this message.",
        provider=provider,
    )
