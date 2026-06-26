from __future__ import annotations

import hashlib
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.cache import cache_get_json, cache_set_json
from app.core.config import settings
from app.modules.calendar.models import (
    CalendarEvent,
    CalendarEventParticipant,
    MeetingBooking,
    MeetingBookingAvailability,
    MeetingBookingQuestion,
    MeetingBookingType,
)
from app.modules.platform.services.activity_logs import safe_log_activity
from app.modules.platform.services.notifications import create_notification
from app.modules.sales.models import SalesContact, SalesLead
from app.modules.user_management.models import User

logger = logging.getLogger(__name__)
PUBLIC_BOOKING_RATE_LIMIT_PREFIX = "calendar_booking:public_submit"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CRM_SOURCE_ENTITY_TYPES = {
    "sales_contacts": "contact",
    "sales_leads": "lead",
    "sales_opportunities": "opportunity",
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _display_user_name(user: User | None) -> str | None:
    if not user:
        return None
    full_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip()
    return full_name or user.email or None


def _zoneinfo(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid timezone") from exc


def _booking_type_options():
    return (
        selectinload(MeetingBookingType.owner),
        selectinload(MeetingBookingType.availability),
        selectinload(MeetingBookingType.questions),
    )


def _serialize_booking_type(booking_type: MeetingBookingType) -> dict:
    return {
        "id": booking_type.id,
        "owner_id": booking_type.owner_id,
        "owner_name": _display_user_name(booking_type.owner),
        "name": booking_type.name,
        "slug": booking_type.slug,
        "duration_minutes": booking_type.duration_minutes,
        "buffer_before_minutes": booking_type.buffer_before_minutes,
        "buffer_after_minutes": booking_type.buffer_after_minutes,
        "timezone": booking_type.timezone,
        "enabled": bool(booking_type.enabled),
        "availability": [
            {
                "id": item.id,
                "weekday": item.weekday,
                "start_time": item.start_time,
                "end_time": item.end_time,
                "sort_order": item.sort_order or 0,
            }
            for item in sorted(booking_type.availability, key=lambda item: (item.weekday, item.start_time, item.sort_order, item.id or 0))
        ],
        "questions": [
            {
                "id": item.id,
                "label": item.label,
                "field_type": item.field_type,
                "required": bool(item.required),
                "sort_order": item.sort_order or 0,
            }
            for item in sorted(booking_type.questions, key=lambda item: (item.sort_order, item.id or 0))
        ],
        "created_at": booking_type.created_at,
        "updated_at": booking_type.updated_at,
    }


def _public_booking_type_payload(booking_type: MeetingBookingType) -> dict:
    return {
        "name": booking_type.name,
        "slug": booking_type.slug,
        "duration_minutes": booking_type.duration_minutes,
        "timezone": booking_type.timezone,
        "owner_name": _display_user_name(booking_type.owner),
        "questions": _serialize_booking_type(booking_type)["questions"],
    }


def _get_owner_or_400(db: Session, *, tenant_id: int, owner_id: int) -> User:
    owner = db.query(User).filter(User.tenant_id == tenant_id, User.id == owner_id).first()
    if not owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Booking owner not found")
    return owner


def _get_booking_type_or_404(db: Session, *, tenant_id: int, booking_type_id: int) -> MeetingBookingType:
    booking_type = (
        db.query(MeetingBookingType)
        .options(*_booking_type_options())
        .filter(MeetingBookingType.tenant_id == tenant_id, MeetingBookingType.id == booking_type_id)
        .first()
    )
    if not booking_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking type not found")
    return booking_type


def _get_public_booking_type_or_404(db: Session, *, slug: str) -> MeetingBookingType:
    booking_type = (
        db.query(MeetingBookingType)
        .options(*_booking_type_options())
        .filter(MeetingBookingType.slug == slug, MeetingBookingType.enabled.is_(True))
        .first()
    )
    if not booking_type:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking link not found")
    return booking_type


def _get_public_booking_type_for_submit_or_404(db: Session, *, slug: str) -> MeetingBookingType:
    booking_type_ref = (
        db.query(MeetingBookingType.id, MeetingBookingType.tenant_id)
        .filter(MeetingBookingType.slug == slug, MeetingBookingType.enabled.is_(True))
        .with_for_update()
        .first()
    )
    if not booking_type_ref:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking link not found")
    booking_type_id, tenant_id = booking_type_ref
    return _get_booking_type_or_404(db, tenant_id=tenant_id, booking_type_id=booking_type_id)


def _replace_availability(db: Session, *, booking_type: MeetingBookingType, availability: list[dict]) -> None:
    for item in list(booking_type.availability):
        db.delete(item)
    for index, item in enumerate(availability):
        db.add(
            MeetingBookingAvailability(
                tenant_id=booking_type.tenant_id,
                booking_type_id=booking_type.id,
                weekday=item["weekday"],
                start_time=item["start_time"],
                end_time=item["end_time"],
                sort_order=item.get("sort_order", index),
            )
        )


def _replace_questions(db: Session, *, booking_type: MeetingBookingType, questions: list[dict]) -> None:
    for item in list(booking_type.questions):
        db.delete(item)
    for index, item in enumerate(questions):
        db.add(
            MeetingBookingQuestion(
                tenant_id=booking_type.tenant_id,
                booking_type_id=booking_type.id,
                label=item["label"].strip(),
                field_type=item.get("field_type") or "text",
                required=bool(item.get("required")),
                sort_order=item.get("sort_order", index),
            )
        )


def list_booking_types(db: Session, current_user) -> list[dict]:
    rows = (
        db.query(MeetingBookingType)
        .options(*_booking_type_options())
        .filter(MeetingBookingType.tenant_id == current_user.tenant_id)
        .order_by(MeetingBookingType.enabled.desc(), MeetingBookingType.updated_at.desc(), MeetingBookingType.id.desc())
        .all()
    )
    return [_serialize_booking_type(row) for row in rows]


def create_booking_type(db: Session, current_user, *, payload: dict) -> dict:
    owner_id = payload.get("owner_id") or current_user.id
    _get_owner_or_400(db, tenant_id=current_user.tenant_id, owner_id=owner_id)
    _zoneinfo(payload.get("timezone") or "UTC")
    booking_type = MeetingBookingType(
        tenant_id=current_user.tenant_id,
        owner_id=owner_id,
        name=payload["name"].strip(),
        slug=payload["slug"].strip().lower(),
        duration_minutes=payload.get("duration_minutes") or 30,
        buffer_before_minutes=payload.get("buffer_before_minutes") or 0,
        buffer_after_minutes=payload.get("buffer_after_minutes") or 0,
        timezone=(payload.get("timezone") or "UTC").strip(),
        enabled=bool(payload.get("enabled", True)),
    )
    db.add(booking_type)
    db.flush()
    _replace_availability(db, booking_type=booking_type, availability=payload.get("availability") or [])
    _replace_questions(db, booking_type=booking_type, questions=payload.get("questions") or [])
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Booking link slug is already in use") from exc
    return _serialize_booking_type(_get_booking_type_or_404(db, tenant_id=current_user.tenant_id, booking_type_id=booking_type.id))


def update_booking_type(db: Session, current_user, *, booking_type_id: int, payload: dict) -> dict:
    booking_type = _get_booking_type_or_404(db, tenant_id=current_user.tenant_id, booking_type_id=booking_type_id)
    if "owner_id" in payload and payload["owner_id"] is not None:
        _get_owner_or_400(db, tenant_id=current_user.tenant_id, owner_id=payload["owner_id"])
        booking_type.owner_id = payload["owner_id"]
    for field in ("name", "slug", "timezone"):
        if field in payload and payload[field] is not None:
            value = payload[field].strip()
            if field == "slug":
                value = value.lower()
            if field == "timezone":
                _zoneinfo(value)
            setattr(booking_type, field, value)
    for field in ("duration_minutes", "buffer_before_minutes", "buffer_after_minutes"):
        if field in payload and payload[field] is not None:
            setattr(booking_type, field, payload[field])
    if "enabled" in payload and payload["enabled"] is not None:
        booking_type.enabled = bool(payload["enabled"])
    if "availability" in payload and payload["availability"] is not None:
        _replace_availability(db, booking_type=booking_type, availability=payload["availability"])
    if "questions" in payload and payload["questions"] is not None:
        _replace_questions(db, booking_type=booking_type, questions=payload["questions"])
    db.add(booking_type)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Booking link slug is already in use") from exc
    return _serialize_booking_type(_get_booking_type_or_404(db, tenant_id=current_user.tenant_id, booking_type_id=booking_type.id))


def disable_booking_type(db: Session, current_user, *, booking_type_id: int) -> None:
    booking_type = _get_booking_type_or_404(db, tenant_id=current_user.tenant_id, booking_type_id=booking_type_id)
    booking_type.enabled = False
    db.add(booking_type)
    db.commit()


def list_bookings(db: Session, current_user, *, booking_type_id: int | None = None) -> list[MeetingBooking]:
    query = db.query(MeetingBooking).filter(MeetingBooking.tenant_id == current_user.tenant_id)
    if booking_type_id is not None:
        query = query.filter(MeetingBooking.booking_type_id == booking_type_id)
    return query.order_by(MeetingBooking.start_at.desc(), MeetingBooking.id.desc()).limit(200).all()


def _normalize_guest_email(email: str | None) -> str:
    return (email or "").strip().lower()


def _validate_guest_email(email: str | None) -> str:
    normalized = _normalize_guest_email(email)
    if not normalized or not EMAIL_RE.match(normalized):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A valid guest email is required.")
    return normalized


def _public_booking_rate_limit_key(*, slug: str, client_host: str | None) -> str:
    slug_hash = hashlib.sha256(slug.strip().lower().encode("utf-8")).hexdigest()
    host_hash = hashlib.sha256((client_host or "unknown").strip().lower().encode("utf-8")).hexdigest()
    return f"{PUBLIC_BOOKING_RATE_LIMIT_PREFIX}:slug:{slug_hash}:ip:{host_hash}"


def check_public_booking_rate_limit(*, slug: str, client_host: str | None = None) -> None:
    cache_key = _public_booking_rate_limit_key(slug=slug, client_host=client_host)
    payload = cache_get_json(cache_key) or {}
    if int(payload.get("count") or 0) >= settings.PUBLIC_BOOKING_SUBMIT_LIMIT:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many booking attempts. Please try again later.",
        )


def record_public_booking_attempt(*, slug: str, client_host: str | None = None) -> None:
    cache_key = _public_booking_rate_limit_key(slug=slug, client_host=client_host)
    payload = cache_get_json(cache_key) or {}
    count = int(payload.get("count") or 0) + 1
    cache_set_json(
        cache_key,
        {"count": count},
        ttl_seconds=settings.PUBLIC_BOOKING_SUBMIT_WINDOW_SECONDS,
    )


def serialize_client_booking(booking: MeetingBooking) -> dict:
    event = booking.calendar_event
    return {
        "id": booking.id,
        "booking_type_id": booking.booking_type_id,
        "booking_type_name": booking.booking_type.name if booking.booking_type else None,
        "owner_name": _display_user_name(booking.booking_type.owner) if booking.booking_type and booking.booking_type.owner else None,
        "guest_name": booking.guest_name,
        "guest_email": booking.guest_email,
        "guest_note": booking.guest_note,
        "start_at": booking.start_at,
        "end_at": booking.end_at,
        "timezone": booking.timezone,
        "status": booking.status,
        "booked_date": booking.booked_date,
        "meeting_url": event.meeting_url if event else None,
        "location": event.location if event else None,
        "created_at": booking.created_at,
    }


def list_client_bookings(db: Session, *, tenant_id: int, email: str) -> list[MeetingBooking]:
    guest_email = _normalize_guest_email(email)
    if not guest_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client account email is required.")
    now = _utcnow()
    return (
        db.query(MeetingBooking)
        .options(
            selectinload(MeetingBooking.booking_type).selectinload(MeetingBookingType.owner),
            selectinload(MeetingBooking.calendar_event),
        )
        .filter(
            MeetingBooking.tenant_id == tenant_id,
            func.lower(MeetingBooking.guest_email) == guest_email,
            MeetingBooking.end_at >= now,
        )
        .order_by(MeetingBooking.start_at.asc(), MeetingBooking.id.asc())
        .limit(100)
        .all()
    )


def get_client_booking_or_404(db: Session, *, tenant_id: int, email: str, booking_id: int) -> MeetingBooking:
    guest_email = _normalize_guest_email(email)
    if not guest_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Client account email is required.")
    booking = (
        db.query(MeetingBooking)
        .options(
            selectinload(MeetingBooking.booking_type).selectinload(MeetingBookingType.owner),
            selectinload(MeetingBooking.calendar_event),
        )
        .filter(
            MeetingBooking.tenant_id == tenant_id,
            MeetingBooking.id == booking_id,
            func.lower(MeetingBooking.guest_email) == guest_email,
        )
        .first()
    )
    if not booking:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booking not found.")
    return booking


def get_public_booking_type(db: Session, *, slug: str) -> dict:
    return _public_booking_type_payload(_get_public_booking_type_or_404(db, slug=slug))


def _event_overlap_exists(db: Session, *, booking_type: MeetingBookingType, start_at: datetime, end_at: datetime) -> bool:
    buffered_start = start_at - timedelta(minutes=booking_type.buffer_before_minutes or 0)
    buffered_end = end_at + timedelta(minutes=booking_type.buffer_after_minutes or 0)
    return bool(
        db.query(CalendarEvent.id)
        .filter(
            CalendarEvent.tenant_id == booking_type.tenant_id,
            CalendarEvent.owner_user_id == booking_type.owner_id,
            CalendarEvent.deleted_at.is_(None),
            CalendarEvent.status != "cancelled",
            CalendarEvent.start_at < buffered_end,
            CalendarEvent.end_at > buffered_start,
        )
        .first()
    )


def _event_overlap_ranges(
    db: Session,
    *,
    booking_type: MeetingBookingType,
    range_start: datetime,
    range_end: datetime,
) -> list[tuple[datetime, datetime]]:
    buffered_start = range_start - timedelta(minutes=booking_type.buffer_after_minutes or 0)
    buffered_end = range_end + timedelta(minutes=booking_type.buffer_before_minutes or 0)
    return [
        (_as_aware_utc(start_at), _as_aware_utc(end_at))
        for start_at, end_at in (
            db.query(CalendarEvent.start_at, CalendarEvent.end_at)
            .filter(
                CalendarEvent.tenant_id == booking_type.tenant_id,
                CalendarEvent.owner_user_id == booking_type.owner_id,
                CalendarEvent.deleted_at.is_(None),
                CalendarEvent.status != "cancelled",
                CalendarEvent.start_at < buffered_end,
                CalendarEvent.end_at > buffered_start,
            )
            .all()
        )
    ]


def _slot_overlaps_ranges(
    *,
    booking_type: MeetingBookingType,
    start_at: datetime,
    end_at: datetime,
    busy_ranges: list[tuple[datetime, datetime]],
) -> bool:
    buffered_start = start_at - timedelta(minutes=booking_type.buffer_before_minutes or 0)
    buffered_end = end_at + timedelta(minutes=booking_type.buffer_after_minutes or 0)
    return any(busy_start < buffered_end and busy_end > buffered_start for busy_start, busy_end in busy_ranges)


def available_slots(db: Session, *, slug: str, start_date: date, end_date: date) -> list[dict]:
    if end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date must be on or after start_date")
    if (end_date - start_date).days > 31:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Slot range cannot exceed 31 days")
    booking_type = _get_public_booking_type_or_404(db, slug=slug)
    tz = _zoneinfo(booking_type.timezone)
    now = _utcnow()
    slots: list[dict] = []
    windows_by_weekday: dict[int, list[MeetingBookingAvailability]] = {}
    for window in booking_type.availability:
        windows_by_weekday.setdefault(window.weekday, []).append(window)

    range_start = datetime.combine(start_date, time.min, tzinfo=tz).astimezone(timezone.utc)
    range_end = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    busy_ranges = _event_overlap_ranges(db, booking_type=booking_type, range_start=range_start, range_end=range_end)

    current = start_date
    while current <= end_date:
        for window in windows_by_weekday.get(current.weekday(), []):
            window_start = datetime.combine(current, window.start_time, tzinfo=tz)
            window_end = datetime.combine(current, window.end_time, tzinfo=tz)
            candidate = window_start
            duration = timedelta(minutes=booking_type.duration_minutes)
            while candidate + duration <= window_end:
                candidate_end = candidate + duration
                start_utc = candidate.astimezone(timezone.utc)
                end_utc = candidate_end.astimezone(timezone.utc)
                if start_utc > now and not _slot_overlaps_ranges(booking_type=booking_type, start_at=start_utc, end_at=end_utc, busy_ranges=busy_ranges):
                    slots.append(
                        {
                            "start_at": start_utc,
                            "end_at": end_utc,
                            "label": candidate.strftime("%a, %b %-d, %-I:%M %p"),
                        }
                    )
                candidate += duration
        current += timedelta(days=1)
    return slots[:200]


def _validate_answers(booking_type: MeetingBookingType, answers: dict[str, str]) -> dict[str, str]:
    normalized = {str(key): str(value).strip() for key, value in (answers or {}).items()}
    for question in booking_type.questions:
        key = str(question.id)
        if question.required and not normalized.get(key):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Answer is required: {question.label}")
    return normalized


def _split_guest_name(name: str) -> tuple[str | None, str | None]:
    parts = [part for part in name.strip().split() if part]
    if not parts:
        return None, None
    if len(parts) == 1:
        return parts[0], None
    return parts[0], " ".join(parts[1:])


def _answer_by_label(booking_type: MeetingBookingType, answers: dict[str, str], labels: set[str]) -> str | None:
    wanted = {label.lower() for label in labels}
    for question in booking_type.questions:
        if question.label.strip().lower() in wanted:
            value = answers.get(str(question.id))
            if value:
                return value
    return None


def _find_contact_by_email(db: Session, *, tenant_id: int, email: str) -> SalesContact | None:
    return (
        db.query(SalesContact)
        .filter(
            SalesContact.tenant_id == tenant_id,
            SalesContact.deleted_at.is_(None),
            func.lower(SalesContact.primary_email) == email,
        )
        .order_by(SalesContact.contact_id.asc())
        .first()
    )


def _find_lead_by_email(db: Session, *, tenant_id: int, email: str) -> SalesLead | None:
    return (
        db.query(SalesLead)
        .filter(
            SalesLead.tenant_id == tenant_id,
            SalesLead.deleted_at.is_(None),
            func.lower(SalesLead.primary_email) == email,
        )
        .order_by(SalesLead.lead_id.asc())
        .first()
    )


def _crm_source_label(*, guest_name: str, email: str) -> str:
    return guest_name.strip() or email


def _resolve_booking_crm_source(
    db: Session,
    *,
    booking_type: MeetingBookingType,
    guest_name: str,
    guest_email: str,
    guest_note: str | None,
    answers: dict[str, str],
) -> dict[str, str]:
    contact = _find_contact_by_email(db, tenant_id=booking_type.tenant_id, email=guest_email)
    if contact:
        label = " ".join(part for part in [contact.first_name, contact.last_name] if part).strip() or contact.primary_email
        return {"module_key": "sales_contacts", "entity_id": str(contact.contact_id), "label": label}

    lead = _find_lead_by_email(db, tenant_id=booking_type.tenant_id, email=guest_email)
    if lead:
        label = " ".join(part for part in [lead.first_name, lead.last_name] if part).strip() or lead.primary_email
        return {"module_key": "sales_leads", "entity_id": str(lead.lead_id), "label": label}

    first_name, last_name = _split_guest_name(guest_name)
    company = _answer_by_label(booking_type, answers, {"company", "organization", "organisation", "business"})
    lead = SalesLead(
        tenant_id=booking_type.tenant_id,
        first_name=first_name,
        last_name=last_name,
        company=company,
        primary_email=guest_email,
        source="booking_link",
        status="new",
        notes=guest_note,
        assigned_to=booking_type.owner_id,
    )
    db.add(lead)
    db.flush()
    return {"module_key": "sales_leads", "entity_id": str(lead.lead_id), "label": _crm_source_label(guest_name=guest_name, email=guest_email)}


def _record_booking_side_effects(db: Session, *, booking: MeetingBooking, event: CalendarEvent, crm_source: dict[str, str]) -> None:
    after_state = {
        "booking_id": booking.id,
        "booking_type_id": booking.booking_type_id,
        "calendar_event_id": event.id,
        "guest_name": booking.guest_name,
        "guest_email": booking.guest_email,
        "start_at": booking.start_at,
        "end_at": booking.end_at,
        "timezone": booking.timezone,
    }
    safe_log_activity(
        db,
        tenant_id=booking.tenant_id,
        actor_user_id=None,
        module_key=crm_source["module_key"],
        entity_type=CRM_SOURCE_ENTITY_TYPES.get(crm_source["module_key"], crm_source["module_key"]),
        entity_id=crm_source["entity_id"],
        action="calendar_booking.created",
        description=f"Public booking received from {booking.guest_name}",
        after_state=after_state,
    )
    try:
        create_notification(
            db,
            tenant_id=booking.tenant_id,
            user_id=event.owner_user_id,
            category="calendar",
            title=f"New booking: {booking.booking_type.name if booking.booking_type else 'Meeting'}",
            message=f"{booking.guest_name} booked {booking.start_at.isoformat()}",
            link_url=f"/dashboard/calendar?eventId={event.id}",
            metadata={
                "booking_id": booking.id,
                "calendar_event_id": event.id,
                "source_module_key": crm_source["module_key"],
                "source_entity_id": crm_source["entity_id"],
            },
        )
    except Exception:
        db.rollback()
        logger.exception("Booking notification failed", extra={"tenant_id": booking.tenant_id, "booking_id": booking.id})


def submit_public_booking(db: Session, *, slug: str, payload: dict) -> MeetingBooking:
    booking_type = _get_public_booking_type_for_submit_or_404(db, slug=slug)
    guest_name = payload["guest_name"].strip()
    guest_email = _validate_guest_email(payload["guest_email"])
    guest_note = (payload.get("guest_note") or "").strip() or None
    start_at = payload["start_at"]
    if start_at.tzinfo is None:
        start_at = start_at.replace(tzinfo=timezone.utc)
    start_at = start_at.astimezone(timezone.utc)
    end_at = start_at + timedelta(minutes=booking_type.duration_minutes)
    slot_date = start_at.astimezone(_zoneinfo(booking_type.timezone)).date()
    valid_slots = available_slots(db, slug=slug, start_date=slot_date, end_date=slot_date)
    if not any(slot["start_at"] == start_at for slot in valid_slots):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Selected slot is no longer available")
    answers = _validate_answers(booking_type, payload.get("answers") or {})
    if _event_overlap_exists(db, booking_type=booking_type, start_at=start_at, end_at=end_at):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Selected slot is no longer available")
    crm_source = _resolve_booking_crm_source(
        db,
        booking_type=booking_type,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_note=guest_note,
        answers=answers,
    )

    event = CalendarEvent(
        tenant_id=booking_type.tenant_id,
        owner_user_id=booking_type.owner_id,
        title=f"{booking_type.name} with {guest_name}",
        description="\n\n".join(
            part
            for part in [
                f"Booked through public booking link: {booking_type.name}",
                f"Guest: {guest_name} <{guest_email}>",
                f"CRM source: {crm_source['module_key']} #{crm_source['entity_id']}",
                guest_note,
            ]
            if part
        ),
        start_at=start_at,
        end_at=end_at,
        status="confirmed",
        source_module_key=crm_source["module_key"],
        source_entity_id=crm_source["entity_id"],
        source_label=crm_source["label"],
    )
    db.add(event)
    db.flush()
    db.add(
        CalendarEventParticipant(
            tenant_id=booking_type.tenant_id,
            event_id=event.id,
            participant_type="user",
            participant_key=f"user:{booking_type.owner_id}",
            user_id=booking_type.owner_id,
            response_status="accepted",
            is_owner=True,
            responded_at=_utcnow(),
        )
    )
    booking = MeetingBooking(
        tenant_id=booking_type.tenant_id,
        booking_type_id=booking_type.id,
        calendar_event_id=event.id,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_note=guest_note,
        answers_json=answers,
        start_at=start_at,
        end_at=end_at,
        timezone=booking_type.timezone,
        booked_date=start_at.astimezone(_zoneinfo(booking_type.timezone)).date(),
    )
    db.add(booking)
    try:
        db.flush()
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Selected slot is no longer available") from exc
    db.refresh(booking)
    _record_booking_side_effects(db, booking=booking, event=event, crm_source=crm_source)
    return booking
