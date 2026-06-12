from __future__ import annotations

import ipaddress
import secrets
import shutil
import subprocess
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.tenancy import normalize_hostname
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.user_management.models import TenantDomain

DOMAIN_STATUS_PENDING = "pending"
DOMAIN_STATUS_VERIFIED = "verified"
DOMAIN_STATUS_FAILED = "failed"
DOMAIN_VERIFICATION_TXT_NAME = "_lynk-verify"
COMMON_APP_SUBDOMAINS = {"app", "crm", "portal", "lynk"}


def normalize_custom_domain(hostname: str | None) -> str:
    normalized = normalize_hostname(hostname)
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Domain is required")
    if normalized in {"localhost", "127.0.0.1"} or normalized.endswith(".localhost"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Custom domain cannot be localhost")
    try:
        ipaddress.ip_address(normalized)
    except ValueError:
        pass
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Custom domain cannot be an IP address")
    if "." not in normalized or len(normalized) > 255:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid fully qualified domain")
    return normalized.rstrip(".")


def tenant_domain_email_domains(db: Session, *, tenant_id: int) -> list[str]:
    rows = (
        db.query(TenantDomain)
        .filter(
            TenantDomain.tenant_id == tenant_id,
            TenantDomain.status == DOMAIN_STATUS_VERIFIED,
        )
        .order_by(TenantDomain.is_primary.desc(), TenantDomain.hostname.asc())
        .all()
    )
    domains: list[str] = []
    for row in rows:
        domain = _email_domain_from_hostname(row.hostname)
        if domain and domain not in domains:
            domains.append(domain)
    return domains


def is_verified_tenant_domain(db: Session, *, tenant_id: int, hostname: str | None) -> bool:
    normalized = normalize_hostname(hostname)
    if not normalized:
        return False
    return (
        db.query(TenantDomain.id)
        .filter(
            TenantDomain.tenant_id == tenant_id,
            TenantDomain.hostname == normalized,
            TenantDomain.status == DOMAIN_STATUS_VERIFIED,
        )
        .first()
        is not None
    )


def list_tenant_domains(db: Session, *, tenant_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(TenantDomain)
        .filter(TenantDomain.tenant_id == tenant_id)
        .order_by(TenantDomain.is_primary.desc(), TenantDomain.hostname.asc())
        .all()
    )
    return [serialize_tenant_domain(row) for row in rows]


def create_tenant_domain(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    hostname: str,
    is_primary: bool = False,
) -> TenantDomain:
    normalized = normalize_custom_domain(hostname)
    existing = db.query(TenantDomain).filter(TenantDomain.hostname == normalized).first()
    if existing:
        if int(existing.tenant_id) == int(tenant_id):
            return existing
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Domain is already assigned to another tenant")

    domain = TenantDomain(
        tenant_id=tenant_id,
        hostname=normalized,
        is_primary=1 if is_primary else 0,
        status=DOMAIN_STATUS_PENDING,
        verification_token=_new_verification_token(),
    )
    if is_primary:
        db.query(TenantDomain).filter(TenantDomain.tenant_id == tenant_id).update({TenantDomain.is_primary: 0})
    db.add(domain)
    db.commit()
    db.refresh(domain)
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="tenant_domain",
        entity_id=domain.id,
        action="tenant_domain.created",
        description="Tenant custom domain added",
        after_state=_safe_domain_state(domain),
    )
    return domain


def verify_tenant_domain(
    db: Session,
    *,
    tenant_id: int,
    actor_user_id: int,
    domain_id: int,
) -> TenantDomain:
    domain = _get_tenant_domain(db, tenant_id=tenant_id, domain_id=domain_id)
    before = _safe_domain_state(domain)
    checks = _verify_dns(domain.hostname, domain.verification_token)
    if checks["verified"]:
        domain.status = DOMAIN_STATUS_VERIFIED
        domain.verified_at = datetime.now(timezone.utc)
    else:
        domain.status = DOMAIN_STATUS_FAILED
    db.add(domain)
    db.commit()
    db.refresh(domain)
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="tenant_domain",
        entity_id=domain.id,
        action="tenant_domain.verified" if checks["verified"] else "tenant_domain.verification_failed",
        description="Tenant custom domain verification checked",
        before_state=before,
        after_state={**_safe_domain_state(domain), "checks": checks},
    )
    if not checks["verified"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=checks["message"])
    return domain


def delete_tenant_domain(db: Session, *, tenant_id: int, actor_user_id: int, domain_id: int) -> None:
    domain = _get_tenant_domain(db, tenant_id=tenant_id, domain_id=domain_id)
    before = _safe_domain_state(domain)
    db.delete(domain)
    db.commit()
    safe_log_activity(
        db,
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        module_key="security",
        entity_type="tenant_domain",
        entity_id=domain_id,
        action="tenant_domain.deleted",
        description="Tenant custom domain removed",
        before_state=before,
    )


def serialize_tenant_domain(domain: TenantDomain) -> dict[str, Any]:
    token = domain.verification_token or ""
    return {
        "id": domain.id,
        "hostname": domain.hostname,
        "is_primary": bool(domain.is_primary),
        "status": domain.status or DOMAIN_STATUS_PENDING,
        "verification_token": token,
        "txt_record_name": f"{DOMAIN_VERIFICATION_TXT_NAME}.{domain.hostname}",
        "txt_record_value": token,
        "cname_target": _cname_target(),
        "verified_at": domain.verified_at,
        "created_at": domain.created_at,
    }


def _get_tenant_domain(db: Session, *, tenant_id: int, domain_id: int) -> TenantDomain:
    domain = db.query(TenantDomain).filter(TenantDomain.tenant_id == tenant_id, TenantDomain.id == domain_id).first()
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom domain not found")
    return domain


def _safe_domain_state(domain: TenantDomain) -> dict[str, Any]:
    return {
        "id": domain.id,
        "hostname": domain.hostname,
        "is_primary": bool(domain.is_primary),
        "status": domain.status,
        "verified_at": domain.verified_at,
    }


def _new_verification_token() -> str:
    return f"lynk-domain-verification={secrets.token_urlsafe(32)}"


def _email_domain_from_hostname(hostname: str | None) -> str | None:
    normalized = normalize_hostname(hostname)
    if not normalized:
        return None
    parts = normalized.split(".")
    if len(parts) > 2 and parts[0] in COMMON_APP_SUBDOMAINS:
        return ".".join(parts[1:])
    if len(parts) <= 3:
        return normalized
    return None


def _verification_txt_host(hostname: str) -> str:
    return f"{DOMAIN_VERIFICATION_TXT_NAME}.{hostname}"


def _cname_target() -> str | None:
    configured = (settings.CUSTOM_DOMAIN_CNAME_TARGET or "").rstrip(".").lower()
    if configured:
        return configured
    frontend_host = normalize_hostname(settings.FRONTEND_ORIGIN)
    if frontend_host and frontend_host not in {"localhost", "127.0.0.1"}:
        return frontend_host
    return None


def _verify_dns(hostname: str, verification_token: str | None) -> dict[str, Any]:
    errors: list[str] = []
    txt_values = _lookup_txt(_verification_txt_host(hostname), errors)
    cname_values = _lookup_cname(hostname, errors)
    expected_cname = (_cname_target() or "").rstrip(".").lower()
    token = verification_token or ""

    txt_ok = bool(token and token in txt_values)
    cname_ok = bool(expected_cname and expected_cname in {value.rstrip(".").lower() for value in cname_values})
    if txt_ok or cname_ok:
        return {
            "verified": True,
            "message": "Domain verified.",
            "txt_ok": txt_ok,
            "cname_ok": cname_ok,
            "txt_host": _verification_txt_host(hostname),
            "cname_target": expected_cname or None,
        }
    if errors:
        message = "; ".join(errors)
    elif expected_cname:
        message = f"DNS verification failed. Add TXT {token} or CNAME {hostname} to {expected_cname}."
    else:
        message = f"DNS verification failed. Add TXT {token} at {_verification_txt_host(hostname)}."
    return {
        "verified": False,
        "message": message,
        "txt_ok": False,
        "cname_ok": False,
        "txt_host": _verification_txt_host(hostname),
        "cname_target": expected_cname or None,
    }


def _lookup_txt(hostname: str, errors: list[str]) -> set[str]:
    try:
        import dns.resolver  # type: ignore

        answers = dns.resolver.resolve(hostname, "TXT")
        return {"".join(part.decode("utf-8") for part in answer.strings) for answer in answers}
    except ImportError:
        pass
    except Exception as exc:
        errors.append(f"TXT lookup failed for {hostname}: {exc}")
        return set()

    if shutil.which("dig"):
        result = subprocess.run(["dig", "+short", "TXT", hostname], check=False, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return {line.strip().strip('"') for line in result.stdout.splitlines() if line.strip()}
        errors.append(f"TXT lookup failed for {hostname}: {result.stderr.strip() or 'dig failed'}")
        return set()
    errors.append("DNS TXT lookup is unavailable in this runtime")
    return set()


def _lookup_cname(hostname: str, errors: list[str]) -> set[str]:
    try:
        import dns.resolver  # type: ignore

        answers = dns.resolver.resolve(hostname, "CNAME")
        return {str(answer.target).rstrip(".").lower() for answer in answers}
    except ImportError:
        pass
    except Exception as exc:
        errors.append(f"CNAME lookup failed for {hostname}: {exc}")
        return set()

    if shutil.which("dig"):
        result = subprocess.run(["dig", "+short", "CNAME", hostname], check=False, capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            return {line.strip().rstrip(".").lower() for line in result.stdout.splitlines() if line.strip()}
        errors.append(f"CNAME lookup failed for {hostname}: {result.stderr.strip() or 'dig failed'}")
        return set()
    errors.append("DNS CNAME lookup is unavailable in this runtime")
    return set()
