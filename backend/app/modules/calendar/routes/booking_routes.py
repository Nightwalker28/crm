from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_action_access, require_module_access
from app.core.security import require_user
from app.modules.calendar.schema import (
    MeetingBookingListResponse,
    MeetingBookingResponse,
    MeetingBookingTypeCreateRequest,
    MeetingBookingTypeListResponse,
    MeetingBookingTypeResponse,
    MeetingBookingTypeUpdateRequest,
    PublicMeetingBookingSubmitRequest,
    PublicMeetingBookingTypeResponse,
    PublicMeetingSlotListResponse,
)
from app.modules.calendar.services import booking_services
from app.modules.platform.services.activity_logs import log_activity


router = APIRouter(prefix="/calendar/booking-types", tags=["Calendar Booking"])
public_router = APIRouter(prefix="/booking-links", tags=["Public Booking Links"])


@router.get("", response_model=MeetingBookingTypeListResponse)
def list_booking_types(
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "view")),
):
    return {"results": booking_services.list_booking_types(db, current_user)}


@router.post("", response_model=MeetingBookingTypeResponse, status_code=status.HTTP_201_CREATED)
def create_booking_type(
    payload: MeetingBookingTypeCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "create")),
):
    created = booking_services.create_booking_type(db, current_user, payload=payload.model_dump())
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="calendar",
        entity_type="meeting_booking_type",
        entity_id=str(created["id"]),
        action="create",
        description=f"Created booking link {created['name']}",
        after_state=created,
    )
    return created


@router.get("/bookings", response_model=MeetingBookingListResponse)
def list_bookings(
    booking_type_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "view")),
):
    return {"results": booking_services.list_bookings(db, current_user, booking_type_id=booking_type_id)}


@router.put("/{booking_type_id}", response_model=MeetingBookingTypeResponse)
def update_booking_type(
    booking_type_id: int,
    payload: MeetingBookingTypeUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "edit")),
):
    before = booking_services._get_booking_type_or_404(db, tenant_id=current_user.tenant_id, booking_type_id=booking_type_id)
    before_state = booking_services._serialize_booking_type(before)
    updated = booking_services.update_booking_type(
        db,
        current_user,
        booking_type_id=booking_type_id,
        payload=payload.model_dump(exclude_unset=True),
    )
    log_activity(
        db,
        tenant_id=current_user.tenant_id,
        actor_user_id=current_user.id,
        module_key="calendar",
        entity_type="meeting_booking_type",
        entity_id=str(updated["id"]),
        action="update",
        description=f"Updated booking link {updated['name']}",
        before_state=before_state,
        after_state=updated,
    )
    return updated


@router.delete("/{booking_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def disable_booking_type(
    booking_type_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(require_user),
    require_module=Depends(require_module_access("calendar")),
    require_permission=Depends(require_action_access("calendar", "delete")),
):
    booking_services.disable_booking_type(db, current_user, booking_type_id=booking_type_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@public_router.get("/{slug}", response_model=PublicMeetingBookingTypeResponse)
def get_public_booking_type(slug: str, db: Session = Depends(get_db)):
    return booking_services.get_public_booking_type(db, slug=slug)


@public_router.get("/{slug}/slots", response_model=PublicMeetingSlotListResponse)
def get_public_booking_slots(
    slug: str,
    start_date: str = Query(...),
    end_date: str = Query(...),
    db: Session = Depends(get_db),
):
    try:
        parsed_start = date.fromisoformat(start_date)
        parsed_end = date.fromisoformat(end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Slot dates must use YYYY-MM-DD") from exc
    return {"results": booking_services.available_slots(db, slug=slug, start_date=parsed_start, end_date=parsed_end)}


@public_router.post("/{slug}/book", response_model=MeetingBookingResponse, status_code=status.HTTP_201_CREATED)
def submit_public_booking(
    slug: str,
    payload: PublicMeetingBookingSubmitRequest,
    db: Session = Depends(get_db),
):
    return booking_services.submit_public_booking(db, slug=slug, payload=payload.model_dump())
