import urllib.parse

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.passwords import get_password_policy
from app.core.security import (
    check_refresh_token_rate_limit,
    clear_failed_refresh_attempts,
    record_failed_refresh_attempt,
)
from app.core.tenancy import get_frontend_origin_for_request, is_cloud_mode_enabled
from app.modules.user_management.models import RefreshToken, User, UserStatus
from app.modules.mail.services.mail_services import (
    decode_mail_oauth_state,
    handle_google_mail_callback,
    handle_microsoft_mail_callback,
)
from app.modules.documents.services.document_services import (
    decode_drive_oauth_state,
    handle_google_drive_callback,
)
from app.modules.user_management.schema import ManualLoginRequest, SetupPasswordRequest
from app.modules.user_management.services.auth import (
    authenticate_manual_user,
    create_access_token,
    create_refresh_token,
    decode_oauth_state,
    decode_token,
    get_google_auth_url,
    handle_google_callback,
    rotate_refresh_token,
    set_initial_password,
)

router = APIRouter(tags=["Auth"])


@router.get("/password-policy")
def password_policy():
    return get_password_policy()


def _validate_request_tenant(request: Request, payload: dict) -> int | None:
    tenant = getattr(request.state, "tenant", None)
    token_tenant_id = payload.get("tenant_id")
    if is_cloud_mode_enabled():
        if not tenant or token_tenant_id is None or int(token_tenant_id) != int(tenant.id):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session tenant mismatch",
            )
    return token_tenant_id


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


@router.post("/login")
def manual_login(
    payload: ManualLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant = getattr(request.state, "tenant", None)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")

    user = authenticate_manual_user(
        db,
        tenant_id=tenant.id,
        email=payload.email,
        password=payload.password,
        frontend_origin=get_frontend_origin_for_request(request),
    )
    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user, db)

    response = JSONResponse({"status": "ok", "message": "Signed in"})
    _set_session_cookies(
        response,
        access_token=access_token,
        refresh_token=refresh_token,
    )
    return response


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
    if not tenant:
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
        frontend_origin = (
            drive_state_payload.get("frontend_origin")
            or get_frontend_origin_for_request(request)
        )
        if not tenant or drive_state_payload.get("tenant_id") != tenant.id or not code:
            query = urllib.parse.urlencode({"driveConnect": "error"})
            return RedirectResponse(url=f"{frontend_origin}/dashboard/documents?{query}")
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
            return RedirectResponse(url=f"{frontend_origin}/dashboard/documents?{query}")
        query = urllib.parse.urlencode({"driveConnect": "connected"})
        return RedirectResponse(url=f"{frontend_origin}/dashboard/documents?{query}")

    state_payload = decode_oauth_state(state)
    tenant = getattr(request.state, "tenant", None)
    frontend_origin = (
        (state_payload or {}).get("frontend_origin")
        or get_frontend_origin_for_request(request)
    )

    if state_payload and tenant and state_payload.get("tenant_id") != tenant.id:
        query = urllib.parse.urlencode({"status": "error"})
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?{query}")

    if not code:
        query = urllib.parse.urlencode({"status": "error"})
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?{query}")

    try:
        if not tenant:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant context missing")
        result = handle_google_callback(code, db, tenant=tenant, request=request)
    except HTTPException as exc:
        status_value = "forbidden" if exc.status_code == 403 else "error"
        query = urllib.parse.urlencode({"status": status_value})
        return RedirectResponse(url=f"{frontend_origin}/auth/callback?{query}")

    status_value = result.get("status", "error")
    if status_value != "active":
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
    return response


@router.get("/microsoft/callback")
def microsoft_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    db: Session = Depends(get_db),
):
    mail_state_payload = decode_mail_oauth_state(state)
    frontend_origin = (
        (mail_state_payload or {}).get("frontend_origin")
        or get_frontend_origin_for_request(request)
    )
    if not mail_state_payload or mail_state_payload.get("provider") != "microsoft":
        query = urllib.parse.urlencode({"mailConnect": "error"})
        return RedirectResponse(url=f"{frontend_origin}/dashboard/mail?{query}")

    tenant = getattr(request.state, "tenant", None)
    if not tenant or mail_state_payload.get("tenant_id") != tenant.id or not code:
        query = urllib.parse.urlencode({"mailConnect": "error"})
        return RedirectResponse(url=f"{frontend_origin}/dashboard/mail?{query}")

    try:
        handle_microsoft_mail_callback(
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
    check_refresh_token_rate_limit(request)
    refresh_token = request.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    try:
        if not refresh_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing refresh token")

        payload = decode_token(refresh_token, expected_type="refresh")
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
