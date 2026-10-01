"""Schedules reports for one subscriber and evaluates them as that subscriber."""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.access_control import require_department_module_access, require_role_module_action_access
from app.modules.mail.services.tenant_mail import get_settings, send_system_message
from app.modules.platform.models import ReportSubscription, ReportSubscriptionDelivery
from app.modules.platform.services import module_reports, report_catalog, report_dashboards, report_engine
from app.modules.platform.services.activity_logs import log_activity
from app.modules.user_management.models import User, UserStatus

logger = logging.getLogger(__name__)


def _zone(value: str) -> ZoneInfo:
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Choose a valid time zone") from exc


def next_run(*, frequency: str, hour: int, minute: int, weekday: int | None, day_of_month: int | None, timezone_name: str, after: datetime) -> datetime:
    if after.tzinfo is None:
        after = after.replace(tzinfo=timezone.utc)
    zone = _zone(timezone_name)
    start = after.astimezone(zone).date()
    for offset in range(370):
        day = start + timedelta(days=offset)
        if frequency == "weekly" and day.weekday() != weekday:
            continue
        if frequency == "monthly" and day.day != day_of_month:
            continue
        local = datetime.combine(day, time(hour, minute), tzinfo=zone)
        utc = local.astimezone(timezone.utc)
        # Skip a wall-clock time that does not exist on a daylight-saving transition.
        if utc.astimezone(zone).hour != hour or utc.astimezone(zone).minute != minute:
            continue
        if utc > after:
            return utc
    raise ValueError("Could not calculate the next send time")


def _target(db: Session, user: User, target_type: str, target_id: int) -> dict:
    if target_type == "report":
        return module_reports.get_saved_report(db, user, report_id=target_id)
    if target_type == "dashboard":
        return report_dashboards.get_dashboard(db, user, dashboard_id=target_id)
    raise HTTPException(status_code=400, detail="Choose a report or dashboard")


def _serialize(row: ReportSubscription) -> dict:
    return {key: getattr(row, key) for key in (
        "id", "target_type", "target_id", "frequency", "hour", "minute", "weekday", "day_of_month",
        "timezone", "is_active", "next_run_at", "last_status", "last_error", "last_sent_at",
    )}


def list_subscriptions(db: Session, user: User, *, target_type: str | None = None, target_id: int | None = None) -> list[dict]:
    query = db.query(ReportSubscription).filter(ReportSubscription.tenant_id == user.tenant_id, ReportSubscription.user_id == user.id)
    if target_type:
        query = query.filter(ReportSubscription.target_type == target_type)
    if target_id is not None:
        query = query.filter(ReportSubscription.target_id == target_id)
    return [_serialize(row) for row in query.order_by(ReportSubscription.id.desc()).all()]


def save_subscription(db: Session, user: User, *, target_type: str, target_id: int, frequency: str, hour: int, minute: int, weekday: int | None, day_of_month: int | None, timezone_name: str, is_active: bool) -> dict:
    _target(db, user, target_type, target_id)
    if get_settings(db, user.tenant_id) is None:
        raise HTTPException(status_code=409, detail="Set up the workspace email sender in Settings → Integrations before scheduling email")
    if frequency not in {"daily", "weekly", "monthly"} or not 0 <= hour <= 23 or not 0 <= minute <= 59:
        raise HTTPException(status_code=400, detail="Choose a valid schedule")
    if frequency == "weekly" and (weekday is None or not 0 <= weekday <= 6):
        raise HTTPException(status_code=400, detail="Choose a weekday")
    if frequency == "monthly" and (day_of_month is None or not 1 <= day_of_month <= 28):
        raise HTTPException(status_code=400, detail="Choose a day from 1 to 28")
    row = db.query(ReportSubscription).filter(
        ReportSubscription.tenant_id == user.tenant_id,
        ReportSubscription.user_id == user.id,
        ReportSubscription.target_type == target_type,
        ReportSubscription.target_id == target_id,
    ).first()
    created = row is None
    if row is None:
        row = ReportSubscription(tenant_id=user.tenant_id, user_id=user.id, target_type=target_type, target_id=target_id)
        db.add(row)
    row.frequency = frequency
    row.hour = hour
    row.minute = minute
    row.weekday = weekday if frequency == "weekly" else None
    row.day_of_month = day_of_month if frequency == "monthly" else None
    row.timezone = timezone_name
    row.is_active = is_active
    row.next_run_at = next_run(frequency=frequency, hour=hour, minute=minute, weekday=row.weekday, day_of_month=row.day_of_month, timezone_name=timezone_name, after=datetime.now(timezone.utc))
    db.flush()
    log_activity(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key="reports", entity_type="report_subscription", entity_id=row.id, action="create" if created else "update", description=f"{'Created' if created else 'Updated'} scheduled email for {target_type} {target_id}", commit=False)
    db.commit()
    return _serialize(row)


def delete_subscription(db: Session, user: User, subscription_id: int) -> None:
    row = db.query(ReportSubscription).filter(ReportSubscription.id == subscription_id, ReportSubscription.tenant_id == user.tenant_id, ReportSubscription.user_id == user.id).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Subscription not found")
    row.is_active = False
    log_activity(db, tenant_id=user.tenant_id, actor_user_id=user.id, module_key="reports", entity_type="report_subscription", entity_id=row.id, action="delete", description="Stopped scheduled report email", commit=False)
    db.commit()


def _message(db: Session, user: User, row: ReportSubscription) -> tuple[str, str, tuple[str, bytes, str] | None]:
    target = _target(db, user, row.target_type, row.target_id)
    if row.target_type == "report":
        require_role_module_action_access(db, user=user, module_key="reports", action="export")
        data = report_engine.report_xlsx_bytes(db, user, module_key=target["module_key"], config=target["config"])
        result = report_engine.run_report(db, user, module_key=target["module_key"], config=target["config"])
        return target["name"], f"Your scheduled report is attached.\n\nRecords: {result['totals']['count']}", ("report.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    lines = ["Your scheduled dashboard summary:", ""]
    filters = target["filters"]
    for widget in target["widgets"]:
        report = widget.get("report")
        if report is None:
            continue
        config = dict(report["config"])
        if filters["scope"] != "report":
            config["scope"] = filters["scope"]
        if filters["date_range"] != "report":
            source, _fields = report_catalog.resolve_source(db, user, report["module_key"])
            date_field = (config.get("date_filter") or {}).get("field") or source.default_date_field
            if date_field:
                config["date_filter"] = None if filters["date_range"] == "all_time" else {"field": date_field, "range": filters["date_range"]}
        result = report_engine.run_report(db, user, module_key=report["module_key"], config=config)
        lines.append(f"{widget.get('title') or report['name']}: {result['totals']['count']} records")
    return target["name"], "\n".join(lines), None


def process_delivery(db: Session, delivery_id: int) -> None:
    # The conditional update is the claim: two beat scans cannot send the same slot.
    claimed = db.query(ReportSubscriptionDelivery).filter(
        ReportSubscriptionDelivery.id == delivery_id,
        ReportSubscriptionDelivery.status == "queued",
    ).update({ReportSubscriptionDelivery.status: "sending"}, synchronize_session=False)
    if claimed != 1:
        db.rollback()
        return
    # Commit before SMTP: a worker crash after provider acceptance must not resend it.
    db.commit()
    delivery = db.query(ReportSubscriptionDelivery).filter(ReportSubscriptionDelivery.id == delivery_id).one()
    row = db.query(ReportSubscription).filter(ReportSubscription.id == delivery.subscription_id, ReportSubscription.tenant_id == delivery.tenant_id).first()
    try:
        if row is None or not row.is_active:
            raise ValueError("Subscription is no longer active")
        user = db.query(User).filter(User.id == row.user_id, User.tenant_id == row.tenant_id, User.is_active == UserStatus.active).first()
        if user is None or not user.email:
            raise ValueError("Subscriber is no longer active")
        require_department_module_access(db, user=user, module_key="reports")
        require_role_module_action_access(db, user=user, module_key="reports", action="view")
        title, body, attachment = _message(db, user, row)
        send_system_message(db, tenant_id=row.tenant_id, recipient=user.email, subject=f"Scheduled {row.target_type}: {title}", body=body, attachment=attachment)
        delivery.status = "sent"
        row.last_status = "sent"
        row.last_sent_at = datetime.now(timezone.utc)
        row.last_error = None
    except Exception:
        logger.exception("Scheduled report delivery %s failed", delivery_id)
        db.rollback()
        delivery = db.query(ReportSubscriptionDelivery).filter(ReportSubscriptionDelivery.id == delivery_id).first()
        row = db.query(ReportSubscription).filter(ReportSubscription.id == delivery.subscription_id).first()
        delivery.status = "failed"
        delivery.error = "Delivery failed; check the sender and report access"
        if row is not None:
            row.last_status = "failed"
            row.last_error = delivery.error
    delivery.completed_at = datetime.now(timezone.utc)
    db.commit()


def scan_due(db: Session, *, now: datetime | None = None, limit: int = 10) -> int:
    now = now or datetime.now(timezone.utc)
    stale = db.query(ReportSubscriptionDelivery).filter(
        ReportSubscriptionDelivery.status == "sending",
        ReportSubscriptionDelivery.created_at < now - timedelta(minutes=30),
    ).limit(limit).all()
    for delivery in stale:
        delivery.status = "failed"
        delivery.error = "Delivery stopped before confirmation; it was not retried"
        delivery.completed_at = now
        subscription = db.query(ReportSubscription).filter(ReportSubscription.id == delivery.subscription_id, ReportSubscription.tenant_id == delivery.tenant_id).first()
        if subscription is not None:
            subscription.last_status = "failed"
            subscription.last_error = delivery.error
    db.commit()
    rows = db.query(ReportSubscription).filter(ReportSubscription.is_active.is_(True), ReportSubscription.next_run_at <= now).order_by(ReportSubscription.next_run_at, ReportSubscription.id).with_for_update(skip_locked=True).limit(limit).all()
    deliveries = []
    for row in rows:
        due = row.next_run_at
        delivery = ReportSubscriptionDelivery(tenant_id=row.tenant_id, subscription_id=row.id, scheduled_for=due, status="queued")
        db.add(delivery)
        row.next_run_at = next_run(frequency=row.frequency, hour=row.hour, minute=row.minute, weekday=row.weekday, day_of_month=row.day_of_month, timezone_name=row.timezone, after=now)
        deliveries.append(delivery)
    db.commit()
    # A crash between schedule claim and send leaves a queued delivery. The next scan
    # picks it up; a 'sending' row is never replayed after uncertain SMTP acceptance.
    queued_ids = [item.id for item in db.query(ReportSubscriptionDelivery.id).filter(ReportSubscriptionDelivery.status == "queued").order_by(ReportSubscriptionDelivery.id).limit(limit).all()]
    for delivery_id in queued_ids:
        process_delivery(db, delivery_id)
    return len(deliveries)
