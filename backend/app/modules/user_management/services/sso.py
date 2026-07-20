import secrets
import urllib.parse
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from fastapi import HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy import func
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.secrets import decrypt_application_secret, encrypt_application_secret
from app.core.tenancy import get_frontend_origin_for_request, normalize_hostname
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.user_management.models import Role, Team, Tenant, TenantSsoSettings, User, UserAuthMode, UserStatus
from app.modules.user_management.services.tenant_domains import tenant_domain_email_domains, verified_tenant_for_hostname

OIDC_DISCOVERY_TIMEOUT_SECONDS = 10
OIDC_TOKEN_TIMEOUT_SECONDS = 15
OIDC_STATE_EXPIRE_MINUTES = 10


def _normalize_domain(value: str) -> str:
    return value.strip().lower().lstrip("@")


def _normalize_domains(values: list[str] | None) -> list[str]:
    domains: list[str] = []
    for value in values or []:
        domain = _normalize_domain(value)
        if domain and domain not in domains:
            domains.append(domain)
    return domains


def _strip_url(value: str | None) -> str | None:
    stripped = value.strip() if value else None
    return stripped or None


def _oidc_redirect_uri_for_request(request: Request) -> str:
    return str(request.url_for("oidc_callback"))


def get_or_create_sso_settings(db: Session, *, tenant_id: int) -> TenantSsoSettings:
    settings_row = db.query(TenantSsoSettings).filter(TenantSsoSettings.tenant_id == tenant_id).first()
    if settings_row:
        _sync_allowed_domains_from_custom_domains(db, settings_row)
        return settings_row
    settings_row = TenantSsoSettings(tenant_id=tenant_id, allowed_email_domains=tenant_domain_email_domains(db, tenant_id=tenant_id))
    db.add(settings_row)
    db.commit()
    db.refresh(settings_row)
    return settings_row


def serialize_sso_settings(settings_row: TenantSsoSettings) -> dict[str, Any]:
    last_test_result = settings_row.last_test_result
    return {
        "enabled": _settings_enabled(settings_row),
        "provider_type": settings_row.provider_type,
        "issuer_url": settings_row.issuer_url,
        "authorization_endpoint": settings_row.authorization_endpoint,
        "token_endpoint": settings_row.token_endpoint,
        "userinfo_endpoint": settings_row.userinfo_endpoint,
        "jwks_uri": settings_row.jwks_uri,
        "client_id": settings_row.client_id,
        "has_client_secret": bool(settings_row.encrypted_client_secret),
        "allowed_email_domains": list(settings_row.allowed_email_domains or []),
        "auto_provision_users": settings_row.auto_provision_users is True or settings_row.auto_provision_users == 1,
        "default_role_id": settings_row.default_role_id,
        "default_team_id": settings_row.default_team_id,
        "email_claim": settings_row.email_claim or "email",
        "first_name_claim": settings_row.first_name_claim,
        "last_name_claim": settings_row.last_name_claim,
        "status": settings_row.status,
        "last_test_result": last_test_result,
        "last_successful_test": _test_history_entry(
            last_test_result,
            key="last_successful_test",
            expected_ok=True,
        ),
        "last_failed_test": _test_history_entry(
            last_test_result,
            key="last_failed_test",
            expected_ok=False,
        ),
        "last_successful_login_at": settings_row.last_successful_login_at,
        "last_failed_login_reason": settings_row.last_failed_login_reason,
    }


def update_sso_settings(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    payload: dict[str, Any],
) -> TenantSsoSettings:
    settings_row = get_or_create_sso_settings(db, tenant_id=tenant_id)
    before = serialize_sso_settings(settings_row)

    if "default_role_id" in payload and payload["default_role_id"] is not None:
        _require_role(db, tenant_id=tenant_id, role_id=int(payload["default_role_id"]))
    if "default_team_id" in payload and payload["default_team_id"] is not None:
        _require_team(db, tenant_id=tenant_id, team_id=int(payload["default_team_id"]))

    simple_fields = (
        "enabled",
        "client_id",
        "auto_provision_users",
        "default_role_id",
        "default_team_id",
    )
    for field in simple_fields:
        if field in payload:
            setattr(settings_row, field, payload[field])

    url_fields = ("issuer_url", "authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri")
    for field in url_fields:
        if field in payload:
            setattr(settings_row, field, _strip_url(payload[field]))

    for field in ("email_claim", "first_name_claim", "last_name_claim"):
        if field in payload:
            setattr(settings_row, field, (payload[field] or "").strip() or None)
    if not settings_row.email_claim:
        settings_row.email_claim = "email"

    settings_row.allowed_email_domains = _verified_custom_email_domains_or_legacy(db, settings_row)

    client_secret = payload.get("client_secret")
    if client_secret:
        encrypted = encrypt_application_secret(client_secret)
        settings_row.encrypted_client_secret = encrypted.ciphertext
        settings_row.client_secret_key_version = encrypted.key_version

    settings_row.provider_type = "oidc"
    settings_row.status = "enabled" if _settings_enabled(settings_row) else "draft"
    db.add(settings_row)
    db.commit()
    db.refresh(settings_row)

    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="tenant_sso_settings",
        entity_id=tenant_id,
        action="sso.config.updated",
        description="OIDC SSO settings updated",
        before_state=_safe_settings_state(before),
        after_state=_safe_settings_state(serialize_sso_settings(settings_row)),
    )
    after = serialize_sso_settings(settings_row)
    if bool(before.get("enabled")) != bool(after.get("enabled")):
        enabled_action = "sso.enabled" if after["enabled"] else "sso.disabled"
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="security",
            entity_type="tenant_sso_settings",
            entity_id=tenant_id,
            action=enabled_action,
            description="OIDC SSO enabled" if after["enabled"] else "OIDC SSO disabled",
            before_state={"enabled": bool(before.get("enabled"))},
            after_state={"enabled": bool(after.get("enabled"))},
        )
    if client_secret:
        safe_log_activity(
            db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="security",
            entity_type="tenant_sso_settings",
            entity_id=tenant_id,
            action="integration.secret.updated",
            description="OIDC SSO client secret updated",
            after_state={"provider": "oidc", "secret_type": "client_secret", "has_secret": True},
        )
    return settings_row


def test_sso_settings(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    result_session_factory: Callable[[], Session] | None = None,
) -> dict[str, Any]:
    settings_row = get_or_create_sso_settings(db, tenant_id=tenant_id)
    checked_at = datetime.now(timezone.utc).isoformat()
    discovery_errors: list[str] = []
    metadata: dict[str, str] = {}

    try:
        if not settings_row.client_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client ID is required")
        client_secret = decrypt_application_secret(
            settings_row.encrypted_client_secret,
            key_version=settings_row.client_secret_key_version,
        )
        if not client_secret:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client secret is required")
        metadata = _resolve_oidc_metadata(settings_row, diagnostics=discovery_errors)
        _validate_jwks_uri(metadata["jwks_uri"])
        result = {
            "ok": True,
            "message": "OIDC configuration looks valid.",
            "checked_at": checked_at,
            "metadata": _safe_metadata_state(metadata),
            "errors": discovery_errors,
        }
    except HTTPException as exc:
        result = {
            "ok": False,
            "message": str(exc.detail),
            "checked_at": checked_at,
            "metadata": _safe_metadata_state(metadata),
            "errors": discovery_errors,
        }
    except Exception:
        db.rollback()
        result = {
            "ok": False,
            "message": "SSO test failed.",
            "checked_at": checked_at,
            "metadata": _safe_metadata_state(metadata),
            "errors": discovery_errors,
        }

    _persist_sso_test_result(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        result=result,
        session_factory=result_session_factory,
    )
    return result


def _session_factory_for(db: Session) -> Callable[[], Session]:
    return sessionmaker(autocommit=False, autoflush=False, bind=db.get_bind())


def _persist_sso_test_result(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    result: dict[str, Any],
    session_factory: Callable[[], Session] | None = None,
) -> None:
    factory = session_factory or _session_factory_for(db)
    result_db = factory()
    try:
        settings_row = result_db.query(TenantSsoSettings).filter(TenantSsoSettings.tenant_id == tenant_id).first()
        if settings_row:
            settings_row.last_test_result = _merge_sso_test_history(
                settings_row.last_test_result,
                result,
            )
            if result["ok"]:
                settings_row.status = "enabled" if _settings_enabled(settings_row) else "tested"
            else:
                settings_row.status = "error"
            result_db.add(settings_row)
            result_db.commit()

        safe_log_activity(
            result_db,
            tenant_id=tenant_id,
            actor_user_id=actor_user_id,
            module_key="security",
            entity_type="tenant_sso_settings",
            entity_id=tenant_id,
            action="sso.config.tested",
            description="OIDC SSO configuration tested",
            after_state=result,
        )
    except Exception:
        result_db.rollback()
        raise
    finally:
        result_db.close()


def _test_result_snapshot(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": bool(result.get("ok")),
        "message": str(result.get("message") or ""),
        "checked_at": result.get("checked_at"),
        "metadata": dict(result.get("metadata") or {}),
        "errors": list(result.get("errors") or []),
    }


def _test_history_entry(
    last_test_result: dict[str, Any] | None,
    *,
    key: str,
    expected_ok: bool,
) -> dict[str, Any] | None:
    if not isinstance(last_test_result, dict):
        return None
    stored = last_test_result.get(key)
    if isinstance(stored, dict):
        return _test_result_snapshot(stored)
    if last_test_result.get("ok") is expected_ok:
        return _test_result_snapshot(last_test_result)
    return None


def _merge_sso_test_history(
    previous: dict[str, Any] | None,
    result: dict[str, Any],
) -> dict[str, Any]:
    latest = _test_result_snapshot(result)
    successful = _test_history_entry(
        previous,
        key="last_successful_test",
        expected_ok=True,
    )
    failed = _test_history_entry(
        previous,
        key="last_failed_test",
        expected_ok=False,
    )
    if latest["ok"]:
        successful = latest
    else:
        failed = latest
    return {
        **latest,
        "last_successful_test": successful,
        "last_failed_test": failed,
    }


def build_sso_start_url(db: Session, *, request: Request, email: str | None = None) -> str:
    login_hint = email.strip().lower() if email else ""
    settings_row = (
        resolve_sso_settings_for_email(db, request=request, email=login_hint)
        if login_hint
        else resolve_sso_settings_for_request(db, request=request)
    )
    metadata = _resolve_oidc_metadata(settings_row)
    nonce = secrets.token_urlsafe(24)
    state = _create_oidc_state(
        tenant_id=settings_row.tenant_id,
        nonce=nonce,
        frontend_origin=get_frontend_origin_for_request(request),
    )
    params = {
        "client_id": settings_row.client_id,
        "redirect_uri": _oidc_redirect_uri_for_request(request),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
    }
    if login_hint:
        params["login_hint"] = login_hint
    return metadata["authorization_endpoint"] + "?" + urllib.parse.urlencode(params)


def _enabled_sso_settings_query(db: Session, *, request: Request):
    request_tenant = getattr(request.state, "tenant", None)
    sso_tenant_id = _resolve_verified_custom_domain_tenant_id(db, request=request)
    query = db.query(TenantSsoSettings).join(Tenant, Tenant.id == TenantSsoSettings.tenant_id).filter(
        TenantSsoSettings.enabled == True,  # noqa: E712
        Tenant.is_active == 1,
        TenantSsoSettings.tenant_id == sso_tenant_id,
    )
    if request_tenant:
        query = query.filter(TenantSsoSettings.tenant_id == request_tenant.id)
    return query


def resolve_sso_settings_for_request(db: Session, *, request: Request) -> TenantSsoSettings:
    settings_rows = _enabled_sso_settings_query(db, request=request).all()
    if len(settings_rows) == 1:
        return settings_rows[0]
    if not settings_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSO is not enabled for this tenant")
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter your email to choose the right SSO provider")


def resolve_sso_settings_for_email(db: Session, *, request: Request, email: str) -> TenantSsoSettings:
    settings_rows = _enabled_sso_settings_query(db, request=request).all()
    if len(settings_rows) == 1:
        return settings_rows[0]
    if not settings_rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSO is not enabled for this tenant")
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter your email to choose the right SSO provider")


def handle_oidc_callback(db: Session, *, request: Request, code: str | None, state: str | None) -> dict[str, Any]:
    state_payload = decode_oidc_state(state)
    frontend_origin = (state_payload or {}).get("frontend_origin") or get_frontend_origin_for_request(request)
    if not state_payload or not code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid SSO callback")

    tenant_id = int(state_payload["tenant_id"])
    if _resolve_verified_custom_domain_tenant_id(db, request=request, frontend_origin=frontend_origin) != tenant_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tenant context mismatch")
    settings_row = db.query(TenantSsoSettings).filter(TenantSsoSettings.tenant_id == tenant_id).first()
    if not settings_row or not settings_row.enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SSO is not enabled")

    try:
        metadata = _resolve_oidc_metadata(settings_row)
        token_json = _exchange_code_for_tokens(settings_row, metadata=metadata, request=request, code=code)
        claims = _validate_id_token(settings_row, metadata=metadata, token_json=token_json, nonce=state_payload["nonce"])
        user = _map_oidc_user(db, settings_row=settings_row, claims=claims)
    except HTTPException as exc:
        _record_sso_failure(db, settings_row=settings_row, reason=str(exc.detail))
        raise
    except Exception as exc:
        _record_sso_failure(db, settings_row=settings_row, reason="SSO login failed")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SSO login failed") from exc

    settings_row.last_successful_login_at = datetime.now(timezone.utc)
    settings_row.last_failed_login_reason = None
    db.add(settings_row)
    db.commit()
    db.refresh(user)
    safe_log_activity(
        db,
        tenant_id=settings_row.tenant_id,
        actor_user_id=user.id,
        module_key="security",
        entity_type="user",
        entity_id=user.id,
        action="sso.login.success",
        description="OIDC SSO login succeeded",
        after_state={"provider_type": "oidc"},
    )
    return {"status": "active", "user": user, "frontend_origin": frontend_origin}


def _create_oidc_state(*, tenant_id: int, nonce: str, frontend_origin: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "type": "oidc_sso_state",
        "tenant_id": tenant_id,
        "nonce": nonce,
        "frontend_origin": frontend_origin.rstrip("/"),
        "iat": now,
        "exp": now + timedelta(minutes=OIDC_STATE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_oidc_state(state_token: str | None) -> dict[str, Any] | None:
    if not state_token:
        return None
    try:
        payload = jwt.decode(state_token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    return payload if payload.get("type") == "oidc_sso_state" else None


def _resolve_oidc_metadata(settings_row: TenantSsoSettings, *, diagnostics: list[str] | None = None) -> dict[str, str]:
    metadata: dict[str, str] = {}
    if settings_row.issuer_url:
        discovery_url = settings_row.issuer_url.rstrip("/") + "/.well-known/openid-configuration"
        try:
            response = requests.get(discovery_url, timeout=OIDC_DISCOVERY_TIMEOUT_SECONDS)
            if response.ok:
                raw_metadata = response.json()
                metadata.update({key: value for key, value in raw_metadata.items() if isinstance(value, str)})
            elif diagnostics is not None:
                diagnostics.append(f"OIDC discovery returned HTTP {response.status_code}")
        except (requests.RequestException, ValueError):
            if diagnostics is not None:
                diagnostics.append("OIDC discovery could not be loaded")
            pass
    for field in ("authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"):
        value = getattr(settings_row, field, None)
        if value:
            metadata[field] = value
    if settings_row.issuer_url:
        metadata.setdefault("issuer", settings_row.issuer_url.rstrip("/"))
    required = ("authorization_endpoint", "token_endpoint", "jwks_uri", "issuer")
    missing = [field for field in required if not metadata.get(field)]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"OIDC metadata missing: {', '.join(missing)}")
    return metadata


def _validate_jwks_uri(jwks_uri: str) -> None:
    try:
        response = requests.get(jwks_uri, timeout=OIDC_DISCOVERY_TIMEOUT_SECONDS)
        jwks = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC signing keys could not be loaded") from exc
    if not response.ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"OIDC signing keys returned HTTP {response.status_code}")
    keys = jwks.get("keys") if isinstance(jwks, dict) else None
    if not isinstance(keys, list) or not keys:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC signing keys were invalid")


def _exchange_code_for_tokens(
    settings_row: TenantSsoSettings,
    *,
    metadata: dict[str, str],
    request: Request,
    code: str,
) -> dict[str, Any]:
    client_secret = decrypt_application_secret(settings_row.encrypted_client_secret, key_version=settings_row.client_secret_key_version)
    if not settings_row.client_id or not client_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC client credentials are incomplete")
    response = requests.post(
        metadata["token_endpoint"],
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": _oidc_redirect_uri_for_request(request),
            "client_id": settings_row.client_id,
            "client_secret": client_secret,
        },
        timeout=OIDC_TOKEN_TIMEOUT_SECONDS,
    )
    try:
        token_json = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC token response was invalid") from exc
    if not response.ok or "id_token" not in token_json:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC token exchange failed")
    return token_json


def _validate_id_token(
    settings_row: TenantSsoSettings,
    *,
    metadata: dict[str, str],
    token_json: dict[str, Any],
    nonce: str,
) -> dict[str, Any]:
    id_token = token_json.get("id_token")
    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC id token header was invalid") from exc
    try:
        jwks_response = requests.get(metadata["jwks_uri"], timeout=OIDC_DISCOVERY_TIMEOUT_SECONDS)
        jwks = jwks_response.json()
    except (requests.RequestException, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC signing keys could not be loaded") from exc
    keys = jwks.get("keys") if isinstance(jwks, dict) else None
    if not isinstance(keys, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC signing keys were invalid")
    key = next((candidate for candidate in keys if candidate.get("kid") == header.get("kid")), None)
    if key is None and len(keys) == 1:
        key = keys[0]
    if key is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC signing key was not found")
    try:
        claims = jwt.decode(
            id_token,
            key,
            algorithms=[header.get("alg", "RS256")],
            audience=settings_row.client_id,
            issuer=metadata["issuer"],
        )
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC id token was invalid") from exc
    if claims.get("nonce") != nonce:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC nonce mismatch")
    return claims


def _map_oidc_user(db: Session, *, settings_row: TenantSsoSettings, claims: dict[str, Any]) -> User:
    email_claim = settings_row.email_claim or "email"
    raw_email = claims.get(email_claim)
    if not isinstance(raw_email, str) or "@" not in raw_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OIDC user email claim is missing")
    if claims.get("email_verified") is False:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="OIDC user email is not verified")
    email = raw_email.strip().lower()
    user = (
        db.query(User)
        .filter(
            User.tenant_id == settings_row.tenant_id,
            func.lower(User.email) == email,
        )
        .first()
    )
    if user:
        if user.is_active != UserStatus.active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account is inactive")
        user.last_login_provider = "oidc"
        db.add(user)
        db.commit()
        return user
    if not settings_row.auto_provision_users:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This SSO account has not been provisioned")
    role = _require_role(db, tenant_id=settings_row.tenant_id, role_id=settings_row.default_role_id)
    team = _require_team(db, tenant_id=settings_row.tenant_id, team_id=settings_row.default_team_id)
    user = User(
        tenant_id=settings_row.tenant_id,
        email=email,
        first_name=_claim_value(claims, settings_row.first_name_claim) or _claim_value(claims, "given_name"),
        last_name=_claim_value(claims, settings_row.last_name_claim) or _claim_value(claims, "family_name"),
        role_id=role.id,
        team_id=team.id,
        department_id=getattr(team, "department_id", None),
        auth_mode=UserAuthMode.manual_or_google,
        last_login_provider="oidc",
        is_active=UserStatus.active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _claim_value(claims: dict[str, Any], claim_name: str | None) -> str | None:
    if not claim_name:
        return None
    value = claims.get(claim_name)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _require_role(db: Session, *, tenant_id: int, role_id: int | None) -> Role:
    if role_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Default SSO role is required")
    role = db.query(Role).filter(Role.tenant_id == tenant_id, Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Default SSO role not found")
    return role


def _require_team(db: Session, *, tenant_id: int, team_id: int | None) -> Team:
    if team_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Default SSO team is required")
    team = db.query(Team).filter(Team.tenant_id == tenant_id, Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Default SSO team not found")
    return team


def _record_sso_failure(
    db: Session,
    *,
    settings_row: TenantSsoSettings,
    reason: str,
    session_factory: Callable[[], Session] | None = None,
) -> None:
    tenant_id = int(settings_row.tenant_id)
    db.rollback()
    failure_db = (session_factory or _session_factory_for(db))()
    try:
        settings_row = failure_db.query(TenantSsoSettings).filter(TenantSsoSettings.tenant_id == tenant_id).first()
        if settings_row is None:
            return
        settings_row.last_failed_login_reason = reason[:500]
        failure_db.add(settings_row)
        failure_db.commit()
        safe_log_activity(
            failure_db,
            tenant_id=tenant_id,
            actor_user_id=None,
            module_key="security",
            entity_type="tenant_sso_settings",
            entity_id=tenant_id,
            action="sso.login.failed",
            description="OIDC SSO login failed",
            after_state={"reason": settings_row.last_failed_login_reason},
        )
    except Exception:
        failure_db.rollback()
        raise
    finally:
        failure_db.close()


def _safe_settings_state(payload: dict[str, Any]) -> dict[str, Any]:
    safe = dict(payload)
    safe.pop("has_client_secret", None)
    return safe


def _safe_metadata_state(metadata: dict[str, str]) -> dict[str, str]:
    allowed = ("issuer", "authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri")
    return {key: metadata[key] for key in allowed if metadata.get(key)}


def _settings_enabled(settings_row: TenantSsoSettings) -> bool:
    return settings_row.enabled is True or settings_row.enabled == 1


def _sync_allowed_domains_from_custom_domains(db: Session, settings_row: TenantSsoSettings) -> None:
    domains = tenant_domain_email_domains(db, tenant_id=settings_row.tenant_id)
    if domains and domains != list(settings_row.allowed_email_domains or []):
        settings_row.allowed_email_domains = domains
        db.add(settings_row)
        db.commit()
        db.refresh(settings_row)


def _verified_custom_email_domains_or_legacy(db: Session, settings_row: TenantSsoSettings) -> list[str]:
    domains = tenant_domain_email_domains(db, tenant_id=settings_row.tenant_id)
    return domains or _normalize_domains(settings_row.allowed_email_domains or [])


def _resolve_verified_custom_domain_tenant_id(db: Session, *, request: Request, frontend_origin: str | None = None) -> int:
    hostname = normalize_hostname(
        frontend_origin
        or request.headers.get("x-lynk-frontend-origin")
        or request.headers.get("origin")
        or request.headers.get("host")
    )
    if not hostname:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Request host is missing")
    tenant = verified_tenant_for_hostname(db, hostname=hostname)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SSO is only available from a verified custom domain")
    request_tenant = getattr(request.state, "tenant", None)
    if request_tenant and int(request_tenant.id) != int(tenant.id):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tenant context mismatch")
    return int(tenant.id)
