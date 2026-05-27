# Task: Calendar Booking Links

## Purpose

Add public meeting scheduling so prospects can book time without manual back-and-forth.

## What this task will accomplish

- Add configurable booking types.
- Add availability windows.
- Add intake questions.
- Add public booking page.
- Create CRM calendar event from valid booking.
- Prevent overlapping bookings.

## Backend files to inspect and modify

- `backend/app/modules/calendar/models.py`
- `backend/app/modules/calendar/schema.py`
- `backend/app/modules/calendar/routes/calendar_routes.py`
- `backend/app/modules/calendar/services/calendar_services.py`
- Create `backend/app/modules/calendar/services/booking_services.py`
- Create `backend/app/modules/calendar/routes/booking_routes.py`
- `backend/app/api/v1/router.py`
- `backend/alembic/versions/*`
- Backend calendar/booking tests

## Frontend files to inspect and modify

- `frontend/app/dashboard/calendar/page.tsx`
- Create `frontend/app/dashboard/settings/calendar-booking/page.tsx`
- Create public booking route, for example `frontend/app/book/[bookingSlug]/page.tsx`
- Create `frontend/components/calendar/BookingForm.tsx`
- Calendar hooks/API utilities

## Database changes

Create a migration for:

- `meeting_booking_types`
  - `id`
  - `tenant_id`
  - `owner_id`
  - `name`
  - `slug`
  - `duration_minutes`
  - `buffer_before_minutes`
  - `buffer_after_minutes`
  - `timezone`
  - `enabled`
  - `created_at`
  - `updated_at`

- `meeting_booking_availability`
  - availability windows by weekday/time

- `meeting_booking_questions`
  - custom intake questions

- `meeting_bookings`
  - submitted booking records linked to generated calendar event

## API changes

Authenticated admin/user endpoints:

- CRUD booking types
- CRUD availability
- List bookings

Public endpoints:

- Get booking type by slug
- Get available slots
- Submit booking

## UI changes

- Settings page to create booking type.
- Public booking page with slot picker and intake fields.
- Calendar event should show booking source.

## Validation

- Booking type can be created.
- Public slots respect availability and existing events.
- Booking creates calendar event.
- Double booking is prevented.
- Timezone handling is tested.
