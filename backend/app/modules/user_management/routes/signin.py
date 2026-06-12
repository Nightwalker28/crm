import urllib.parse

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from jose import JWTError, jwt
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.access_control import ADMIN_MIN_ROLE_LEVEL, get_user_role_level
from app.core.database import get_db
from app.core.passwords import get_password_policy
from app.core.security import (
    check_refresh_token_rate_limit,
    clear_failed_refresh_attempts,
    get_current_user,
    record_failed_refresh_attempt,
)
from app.core.tenancy import get_frontend_origin_for_request, is_auth_tenant_resolution_enabled, is_cloud_mode_enabled
from app.modules.user_management.models import RefreshToken, Tenant, User, UserStatus
from app.modules.mail.services.mail_services import (
    decode_mail_oauth_state,
    handle_google_mail_callback,
    handle_microsoft_mail_callback,
)
from app.modules.documents.services.document_services import (
    decode_drive_oauth_state,
    handle_google_drive_callback,
    handle_microsoft_onedrive_callback,
)
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.user_management.schema import (
    ManualLoginRequest,
    MfaChallengeRequest,
    MfaDisableRequest,
    MfaEnableRequest,
    MfaEnableResponse,
    MfaSetupResponse,
    SsoStartRequest,
    SsoStartResponse,
    SetupPasswordRequest,
)
from app.modules.user_management.services.auth import (
    authenticate_manual_user,
    create_access_token,
    create_refresh_token,
    decode_oauth_state,
    decode_microsoft_oauth_state,
    decode_token,
    get_google_auth_url,
    get_microsoft_auth_url,
    handle_google_callback,
    handle_microsoft_callback,
    rotate_refresh_token,
    set_initial_password,
)
from app.modules.user_management.services.mfa import activate_mfa, disable_mfa, start_mfa_setup, verify_mfa_challenge
from app.modules.user_management.services.sso import build_sso_start_url, handle_oidc_callback

router = APIRouter(tags=["Auth"])
MFA_CHALLENGE_EXPIRE_MINUTES = 5


@router.get("/password-policy")
def password_policy():
    return get_password_policy()


def _validate_request_tenant(request: Request, payload: dict) -> int | None:
    tenant = getattr(request.state, "tenant", None)
    token_tenant_id = payload.get("tenant_id")
    if is_cloud_mode_enabled():
        if token_tenant_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session tenant mismatch",
            )
        if tenant and int(token_tenant_id) != int(tenant.id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session tenant mismatch",
            )
        if not tenant and not is_auth_tenant_resolution_enabled():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session tenant mismatch",
            )
    return token_tenant_id


def _resolve_manual_login_tenant_id(db: Session, *, email: str, request_tenant) -> int | None:
    if request_tenant:
        return int(request_tenant.id)
    if not (is_cloud_mode_enabled() and is_auth_tenant_resolution_enabled()):
        return None

    user = (
        db.query(User)
        .join(Tenant, Tenant.id == User.tenant_id)
        .filter(
            func.lower(User.email) == email.strip().lower(),
            Tenant.is_active == 1,
        )
        .first()
    )
    return int(user.tenant_id) if user else None


def _set_session_cookies(
    response: JSONResponse | RedirectResponse,
    *,
    access_token: str,
    refresh_token: str,
    secure_override: bool | None = None,
) -> None:
    secure = settings.COOKIE_SECURE if secure_override is None else secure_override

    response.set_cookie(
        key=settings.ACCESS_TOKEN_COOKIE_NAME,
        value=access_token,
        httponly=settings.COOKIE_HTTPONLY,
        secure=secure,
        samesite=settings.COOKIE_SAMESITE,
        path=settings.COOKIE_PATH,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    response.set_cookie(
        key=settings.REFRESH_TOKEN_COOKIE_NAME,
        value=refresh_token,
        httponly=settings.COOKIE_HTTPONLY,
        secure=secure,
        samesite=settings.COOKIE_SAMESITE,
        path=settings.COOKIE_PATH,
        max_age=settings.REFRESH_TOKEN_EXPIRE_HOURS * 60 * 60,
    )


def _create_mfa_challenge_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "tenant_id": user.tenant_id,
        "type": "mfa_challenge",
        "iat": now,
        "exp": now + timedelta(minutes=MFA_CHALLENGE_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode_mfa_challenge_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA challenge")
    if payload.get("type") != "mfa_challenge":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA challenge")
    return payload


def _log_auth_event(
    db: Session,
    *,
    action: str,
    user: User | None = None,
    tenant_id: int | None = None,
    description: str,
    after_state: dict | None = None,
) -> None:
    resolved_tenant_id = int(getattr(user, "tenant_id", None) or tenant_id or 0)
    if not resolved_tenant_id:
        return
    safe_log_activity(
        db,
        tenant_id=resolved_tenant_id,
        actor_user_id=getattr(user, "id", None),
        module_key="security",
        entity_type="user" if user else "auth",
        entity_id=getattr(user, "id", None) or resolved_tenant_id,
        action=action,
        description=description,
        after_state=after_state,
    )


def _log_oauth_failure(
    db: Session,
    *,
    tenant_id: int | None,
    provider: str,
    status_value: str = "error",
) -> None:
    _log_auth_event(
        db,
        action="auth.login.failed",
        tenant_id=tenant_id,
        description=f"{provider.title()} login failed",
        after_state={"provider": provider, "status": status_value},
    )


def _issue_session_response(
    user: User,
    db: Session,
    *,
    body: dict | None = None,
    auth_event_provider: str | None = None,
) -> JSONResponse:
    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user, db)
    response = JSONResponse(body or {"status": "ok", "message": "Signed in"})
    _set_session_cookies(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
    )
    if auth_event_provider:
        _log_auth_event(
            db,
            action="auth.login.success",
            user=user,
            description="Login succeeded",
            after_state={"provider": auth_event_provider},
        )
    return response


def _mfa_challenge_response(user: User) -> JSONResponse:
    return JSONResponse(
        {
            "status": "mfa_required",
            "message": "MFA verification required",
            "mfa_token": _create_mfa_challenge_token(user),
            "expires_in": MFA_CHALLENGE_EXPIRE_MINUTES * 60,
        }
    )


def _tenant_mfa_policy_requires_setup(db: Session, *, user: User) -> bool:
    policy = getattr(getattr(user, "tenant", None), "mfa_policy", None)
    if policy is None:
        tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
        policy = getattr(tenant, "mfa_policy", "off") if tenant else "off"
    if policy == "all_users":
        return True
    if policy == "admins_only":
        role_level = get_user_role_level(db, user)
        return role_level is not None and role_level >= ADMIN_MIN_ROLE_LEVEL
    return False


@router.post("/login")
def manual_login(
    payload: ManualLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    tenant_id = _resolve_manual_login_tenant_id(db, email=payload.email, request_tenant=tenant)
    if tenant_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")

    try:
        user = authenticate_manual_user(
            db,
            tenant_id=tenant_id,
            email=payload.email,
            password=payload.password,
            frontend_origin=get_frontend_origin_for_request(request),
        )
    except HTTPException as exc:
        _log_auth_event(
            db,
            action="auth.login.failed",
            tenant_id=tenant_id,
            description="Manual login failed",
            after_state={"provider": "manual", "status_code": exc.status_code},
        )
        raise
    if getattr(user, "mfa_enabled", False):
        return _mfa_challenge_response(user)
    if _tenant_mfa_policy_requires_setup(db, user=user):
        return _issue_session_response(
            user,
            db,
            auth_event_provider="manual",
            body={
                "status": "mfa_setup_required",
                "message": "MFA setup required",
            },
        )
    return _issue_session_response(user, db, auth_event_provider="manual")


@router.post("/sso/start", response_model=SsoStartResponse)
def start_sso_login(
    payload: SsoStartRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    return SsoStartResponse(auth_url=build_sso_start_url(db, request=request, email=payload.email))


@router.get("/oidc/callback", name="oidc_callback")
def oidc_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    frontend_origin = get_frontend_origin_for_request(request)
    try:
        result = handle_oidc_callback(db, request=request, code=code, state=state)
    except HTTPException as exc:
        status_value = "forbidden" if exc.status_code == status.HTTP_403_FORBIDDEN else "error"
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?status={status_value}")

    user = result["user"]
    frontend_origin = result.get("frontend_origin") or frontend_origin
    response = RedirectResponse(url=f"{frontend_origin}/auth/callback?status=active")
    _set_session_cookies(
        response,
        access_token=create_access_token(user),
        refresh_token=create_refresh_token(user, db),
    )
    _log_auth_event(
        db,
        action="auth.login.success",
        user=user,
        description="Login succeeded",
        after_state={"provider": "oidc"},
    )
    return response


@router.post("/mfa/setup", response_model=MfaSetupResponse)
def setup_mfa(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return start_mfa_setup(db, user=current_user)


@router.post("/mfa/enable", response_model=MfaEnableResponse)
def enable_mfa(
    payload: MfaEnableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    backup_codes = activate_mfa(db, user=current_user, code=payload.code)
    return MfaEnableResponse(backup_codes=backup_codes)


@router.post("/mfa/challenge")
def complete_mfa_challenge(
    payload: MfaChallengeRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    token_payload = _decode_mfa_challenge_token(payload.mfa_token)
    _validate_request_tenant(request, token_payload)
    user = (
        db.query(User)
        .filter(
            User.id == int(token_payload["sub"]),
            User.tenant_id == int(token_payload["tenant_id"]),
        )
        .first()
    )
    if not user or user.is_active != UserStatus.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA challenge")
    verify_mfa_challenge(db, user=user, code=payload.code, backup_code=payload.backup_code)
    return _issue_session_response(user, db, auth_event_provider="manual_mfa")


@router.post("/mfa/disable")
def disable_mfa_route(
    payload: MfaDisableRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    disable_mfa(
        db,
        user=current_user,
        current_password=payload.current_password,
        code=payload.code,
        backup_code=payload.backup_code,
    )
    return JSONResponse({"status": "ok", "message": "MFA disabled"})


@router.post("/setup-password")
def setup_password(
    payload: SetupPasswordRequest,
    db: Session = Depends(get_db),
):
    try:
        set_initial_password(
            db,
            token=payload.token,
            password=payload.password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return JSONResponse({"status": "ok", "message": "Password set successfully"})


@router.post("/dev/login")
def dev_login(
    email: str,
    request: Request,
    db: Session = Depends(get_db),
):
    # Keep this endpoint out of production
    if not getattr(settings, "DEBUG", False):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")

    user = (
        db.query(User)
        .filter(
            User.tenant_id == tenant.id,
            User.email == email,
        )
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user, db)

    response = JSONResponse({"status": "ok"})
    _set_session_cookies(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
        secure_override=bool(getattr(settings, "COOKIE_SECURE", False)),
    )
    return response


@router.get("/google")
def google_login(
    request: Request,
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant and not (is_cloud_mode_enabled() and is_auth_tenant_resolution_enabled()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return {"auth_url": get_google_auth_url(request=request, tenant=tenant)}


@router.get("/google/callback")
def google_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    mail_state_payload = decode_mail_oauth_state(state)
    if mail_state_payload and mail_state_payload.get("provider") == "google":
        tenant = getattr(request.state, "tenant", None)
        frontend_origin = (
            mail_state_payload.get("frontend_origin")
            or get_frontend_origin_for_request(request)
        )
        if not tenant or mail_state_payload.get("tenant_id") != tenant.id or not code:
            query = urllib.parse.urlencode({"mailConnect": "error"})
            return RedirectResponse(url=f"{frontend_origin}/dashboard/mail?{query}")
        try:
            handle_google_mail_callback(
                code,
                db,
                tenant=tenant,
                request=request,
                state_payload=mail_state_payload,
            )
        except HTTPException:
            query = urllib.parse.urlencode({"mailConnect": "error"})
            return RedirectResponse(url=f"{frontend_origin}/dashboard/mail?{query}")
        query = urllib.parse.urlencode({"mailConnect": "connected"})
        return RedirectResponse(url=f"{frontend_origin}/dashboard/mail?{query}")

    drive_state_payload = decode_drive_oauth_state(state)
    if drive_state_payload and drive_state_payload.get("provider") == "google_drive":
        tenant = getattr(request.state, "tenant", None)
        return_path = drive_state_payload.get("return_path") or "/dashboard/documents"
        frontend_origin = (
            drive_state_payload.get("frontend_origin")
            or get_frontend_origin_for_request(request)
        )
        if not tenant or drive_state_payload.get("tenant_id") != tenant.id or not code:
            query = urllib.parse.urlencode({"driveConnect": "error"})
            return RedirectResponse(url=f"{frontend_origin}{return_path}?{query}")
        try:
            handle_google_drive_callback(
                code,
                db,
                tenant=tenant,
                request=request,
                state_payload=drive_state_payload,
            )
        except HTTPException:
            query = urllib.parse.urlencode({"driveConnect": "error"})
            return RedirectResponse(url=f"{frontend_origin}{return_path}?{query}")
        query = urllib.parse.urlencode({"driveConnect": "connected"})
        return RedirectResponse(url=f"{frontend_origin}{return_path}?{query}")

    state_payload = decode_oauth_state(state)
    tenant = getattr(request.state, "tenant", None)
    frontend_origin = (
        (state_payload or {}).get("frontend_origin")
        or get_frontend_origin_for_request(request)
    )

    if not state_payload:
        _log_oauth_failure(db, tenant_id=None, provider="google")
        query = urllib.parse.urlencode({"status": "error"})
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?{query}")

    if state_payload and tenant and state_payload.get("tenant_id") != tenant.id:
        _log_oauth_failure(db, tenant_id=state_payload.get("tenant_id"), provider="google")
        query = urllib.parse.urlencode({"status": "error"})
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?{query}")

    if not code:
        _log_oauth_failure(db, tenant_id=state_payload.get("tenant_id"), provider="google")
        query = urllib.parse.urlencode({"status": "error"})
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?{query}")

    try:
        if not tenant and not (is_cloud_mode_enabled() and is_auth_tenant_resolution_enabled()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
        result = handle_google_callback(code, db, tenant=tenant, request=request)
    except HTTPException as exc:
        status_value = "forbidden" if exc.status_code == 403 else "error"
        _log_oauth_failure(
            db,
            tenant_id=state_payload.get("tenant_id"),
            provider="google",
            status_value=status_value,
        )
        query = urllib.parse.urlencode({"status": status_value})
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?{query}")

    status_value = result.get("status", "error")
    if status_value != "active":
        _log_oauth_failure(
            db,
            tenant_id=state_payload.get("tenant_id"),
            provider="google",
            status_value=status_value,
        )
        query = urllib.parse.urlencode({"status": status_value})
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?{query}")

    user = result["user"]
    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user, db)

    response = RedirectResponse(url=f"{frontend_origin}/auth/callback?status=active")
    _set_session_cookies(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
    )
    _log_auth_event(
        db,
        action="auth.login.success",
        user=user,
        description="Login succeeded",
        after_state={"provider": "google"},
    )
    return response


@router.get("/microsoft/callback")
def microsoft_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    mail_state_payload = decode_mail_oauth_state(state)
    drive_state_payload = decode_drive_oauth_state(state)
    login_state_payload = decode_microsoft_oauth_state(state)
    frontend_origin = (
        (mail_state_payload or drive_state_payload or login_state_payload or {}).get("frontend_origin")
        or get_frontend_origin_for_request(request)
    )
    tenant = getattr(request.state, "tenant", None)
    if mail_state_payload and mail_state_payload.get("provider") == "microsoft":
        if not tenant or mail_state_payload.get("tenant_id") != tenant.id or not code:
            return RedirectResponse(url=f"{frontend_origin}/dashboard/mail?mailConnect=error")
        try:
            handle_microsoft_mail_callback(code, db, tenant=tenant, request=request, state_payload=mail_state_payload)
        except HTTPException:
            return RedirectResponse(url=f"{frontend_origin}/dashboard/mail?mailConnect=error")
        return RedirectResponse(url=f"{frontend_origin}/dashboard/mail?mailConnect=connected")

    if drive_state_payload and drive_state_payload.get("provider") == "microsoft_onedrive":
        return_path = drive_state_payload.get("return_path") or "/dashboard/documents"
        if not tenant or drive_state_payload.get("tenant_id") != tenant.id or not code:
            return RedirectResponse(url=f"{frontend_origin}{return_path}?driveConnect=error&provider=microsoft_onedrive")
        try:
            handle_microsoft_onedrive_callback(code, db, tenant=tenant, request=request, state_payload=drive_state_payload)
        except HTTPException:
            return RedirectResponse(url=f"{frontend_origin}{return_path}?driveConnect=error&provider=microsoft_onedrive")
        return RedirectResponse(url=f"{frontend_origin}{return_path}?driveConnect=connected&provider=microsoft_onedrive")

    if not login_state_payload:
        _log_oauth_failure(db, tenant_id=None, provider="microsoft")
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?status=error")
    if tenant and login_state_payload.get("tenant_id") != tenant.id:
        _log_oauth_failure(db, tenant_id=login_state_payload.get("tenant_id"), provider="microsoft")
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?status=error")
    if not code:
        _log_oauth_failure(db, tenant_id=login_state_payload.get("tenant_id"), provider="microsoft")
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?status=error")
    try:
        if not tenant and not (is_cloud_mode_enabled() and is_auth_tenant_resolution_enabled()):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
        result = handle_microsoft_callback(code, db, tenant=tenant, request=request)
    except HTTPException as exc:
        status_value = "forbidden" if exc.status_code == 403 else "error"
        _log_oauth_failure(
            db,
            tenant_id=login_state_payload.get("tenant_id"),
            provider="microsoft",
            status_value=status_value,
        )
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?status={status_value}")
    if result.get("status") != "active":
        _log_oauth_failure(
            db,
            tenant_id=login_state_payload.get("tenant_id"),
            provider="microsoft",
            status_value=result.get("status", "error"),
        )
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?status={result.get('status', 'error')}")
    user = result["user"]
    response = RedirectResponse(url=f"{frontend_origin}/auth/callback?status=active")
    _set_session_cookies(response, access_token=create_access_token(user), refresh_token=create_refresh_token(user, db))
    _log_auth_event(
        db,
        action="auth.login.success",
        user=user,
        description="Login succeeded",
        after_state={"provider": "microsoft"},
    )
    return response


@router.get("/microsoft")
def microsoft_login(request: Request):
    tenant = getattr(request.state, "tenant", None)
    if not tenant and not (is_cloud_mode_enabled() and is_auth_tenant_resolution_enabled()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
    return {"auth_url": get_microsoft_auth_url(request=request, tenant=tenant)}


@router.post("/logout")
def logout(
    request: Request,
    db: Session = Depends(get_db),
):
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)

    if refresh_token:
        try:
            payload = decode_token(refresh_token, expected_type="refresh")
            _validate_request_tenant(request, payload)
            user_id = payload.get("sub")
            tenant_id = payload.get("tenant_id")
            user = db.query(User).filter(User.id == int(user_id)).first() if user_id else None
            _log_auth_event(
                db,
                action="auth.logout",
                tenant_id=int(tenant_id) if tenant_id else None,
                user=user,
                description="Logout succeeded",
                after_state={"session": "revoked"},
            )
            if user_id:
                db.query(RefreshToken).filter(RefreshToken.user_id == int(user_id)).delete()
                db.commit()
        except HTTPException:
            pass

    response = JSONResponse({"status": "logged_out"})
    response.delete_cookie(settings.ACCESS_TOKEN_COOKIE_NAME, path=settings.COOKIE_PATH)
    response.delete_cookie(settings.REFRESH_TOKEN_COOKIE_NAME, path=settings.COOKIE_PATH)
    return response


@router.post("/refresh")
def refresh_access_token(
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = None
    tenant_id = getattr(getattr(request.state, "tenant", None), "id", None)
    check_refresh_token_rate_limit(request)
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    try:
        if not refresh_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

        payload = decode_token(refresh_token, expected_type="refresh")
        tenant_id = payload.get("tenant_id") or tenant_id
        _validate_request_tenant(request, payload)
        user_id = payload.get("sub")
        jti = payload.get("jti")
        check_refresh_token_rate_limit(request, user_id)

        if not user_id or not jti:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")

        db_row = db.query(RefreshToken).filter(
            RefreshToken.user_id == int(user_id),
            RefreshToken.token_jti == jti,
        ).first()

        if not db_row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session revoked")

        now = datetime.now(timezone.utc)
        expires_at = db_row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        else:
            expires_at = expires_at.astimezone(timezone.utc)

        if expires_at <= now:
            db.query(RefreshToken).filter(RefreshToken.id == db_row.id).delete()
            db.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")

        user = db.query(User).filter(User.id == int(user_id)).first()
        if not user or user.is_active != UserStatus.active:
            db.query(RefreshToken).filter(RefreshToken.id == db_row.id).delete()
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Inactive account" if user else "User not found",
            )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            record_failed_refresh_attempt(request, user_id)
            _log_auth_event(
                db,
                action="auth.refresh.failed",
                tenant_id=int(tenant_id) if tenant_id else None,
                description="Refresh token failed",
                after_state={"status_code": exc.status_code},
            )
        raise

    access_token = create_access_token(user)
    new_refresh_token = rotate_refresh_token(user, db, old_refresh_token_id=db_row.id)
    clear_failed_refresh_attempts(request, user_id)
    response = JSONResponse(
        {
            "status": "ok",
            "accessTokenMaxAge": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        }
    )
    response.set_cookie(
        key=settings.ACCESS_TOKEN_COOKIE_NAME,
        value=access_token,
        httponly=settings.COOKIE_HTTPONLY,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path=settings.COOKIE_PATH,
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    response.set_cookie(
        key=settings.REFRESH_TOKEN_COOKIE_NAME,
        value=new_refresh_token,
        httponly=settings.COOKIE_HTTPONLY,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path=settings.COOKIE_PATH,
        max_age=settings.REFRESH_TOKEN_EXPIRE_HOURS * 60 * 60,
    )
    return response
