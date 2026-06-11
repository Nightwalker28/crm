from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.modules.calendar.models import (
    CalendarEvent,
    CalendarEventParticipant,
    MeetingBooking,
    MeetingBookingAvailability,
    MeetingBookingQuestion,
    MeetingBookingType,
)
from app.modules.user_management.models import User


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


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
                if start_utc > now and not _event_overlap_exists(db, booking_type=booking_type, start_at=start_utc, end_at=end_utc):
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


def submit_public_booking(db: Session, *, slug: str, payload: dict) -> MeetingBooking:
    booking_type = _get_public_booking_type_or_404(db, slug=slug)
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

    event = CalendarEvent(
        tenant_id=booking_type.tenant_id,
        owner_user_id=booking_type.owner_id,
        title=f"{booking_type.name} with {payload['guest_name'].strip()}",
        description="\n\n".join(
            part
            for part in [
                f"Booked through public booking link: {booking_type.name}",
                f"Guest: {payload['guest_name'].strip()} <{_normalize_guest_email(payload['guest_email'])}>",
                (payload.get("guest_note") or "").strip(),
            ]
            if part
        ),
        start_at=start_at,
        end_at=end_at,
        status="confirmed",
        source_module_key="calendar_booking",
        source_label=booking_type.name,
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
        guest_name=payload["guest_name"].strip(),
        guest_email=_normalize_guest_email(payload["guest_email"]),
        guest_note=(payload.get("guest_note") or "").strip() or None,
        answers_json=answers,
        start_at=start_at,
        end_at=end_at,
        timezone=booking_type.timezone,
        booked_date=start_at.astimezone(_zoneinfo(booking_type.timezone)).date(),
    )
    db.add(booking)
    db.flush()
    event.source_entity_id = str(booking.id)
    db.add(event)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Selected slot is no longer available") from exc
    db.refresh(booking)
    return booking
