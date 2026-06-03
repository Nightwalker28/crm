from __future__ import annotations

from app.core.config import settings


MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
MICROSOFT_BASE_SCOPES = ("openid", "profile", "email", "offline_access", "User.Read")
MICROSOFT_CALENDAR_SCOPE = "Calendars.ReadWrite"
MICROSOFT_DRIVE_SCOPE = "Files.ReadWrite.AppFolder"
MICROSOFT_MAIL_SCOPES = ("Mail.Read", "Mail.Send")


def microsoft_authority() -> str:
    configured = (settings.MICROSOFT_AUTHORITY or "").strip().rstrip("/")
    if configured:
        return configured
    tenant_id = (settings.MICROSOFT_TENANT_ID or "common").strip() or "common"
    return f"https://login.microsoftonline.com/{tenant_id}"


def microsoft_auth_url() -> str:
    return f"{microsoft_authority()}/oauth2/v2.0/authorize"


def microsoft_token_url() -> str:
    return f"{microsoft_authority()}/oauth2/v2.0/token"


def microsoft_scope_string(*required_scopes: str, include_configured: bool = False) -> str:
    scopes = list(MICROSOFT_BASE_SCOPES)
    if include_configured:
        scopes.extend(settings.MICROSOFT_SCOPES)
    scopes.extend(required_scopes)
    return " ".join(dict.fromkeys(scope for scope in scopes if scope))
