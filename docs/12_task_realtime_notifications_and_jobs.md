# Task: Realtime Notifications and Jobs

## Purpose

Improve UX by pushing notification and background job updates in realtime, while keeping polling fallback.

## What this task will accomplish

- Add authenticated realtime channel using SSE or WebSocket.
- Push user notifications.
- Push long-running job status changes.
- Keep existing polling hooks as fallback.

## Backend files to inspect and modify

- `backend/app/main.py`
- `backend/app/modules/platform/models.py`
- `backend/app/modules/platform/routes/notifications.py` or notification-related routes
- `backend/app/modules/platform/services/data_transfer_jobs.py`
- `backend/app/core/celery_app.py`
- Create a realtime transport package, for example `backend/app/core/realtime.py`
- Backend tests for auth/tenant isolation if feasible

## Frontend files to inspect and modify

- `frontend/hooks/useJobPoller.ts`
- Create `frontend/hooks/useRealtimeNotifications.ts`
- Create `frontend/hooks/useRealtimeJobStatus.ts`
- Notification UI components
- Dashboard/header components that show notification state

## Database changes

No required DB change for transport.

Optional:

- `notification_delivery_receipts`
  - only if durable delivery status is required

## Transport choice

Prefer SSE for simplicity unless the repo already has WebSocket conventions.

SSE is enough for:

- notification created
- unread count changed
- job progress/status changed

## API changes

Add one authenticated stream endpoint, for example:

- `GET /platform/realtime/stream`

Events:

- `notification.created`
- `notification.updated`
- `job.updated`
- `heartbeat`

## UI changes

- Realtime hook connects after authentication.
- Notification list updates without refresh.
- Import/export/sync job progress updates without manual refresh.
- Polling fallback remains when stream fails.

## Validation

- User receives only their tenant/user events.
- Reconnect works.
- Polling fallback still works.
- Job status UI updates when backend emits event.
- Stream endpoint rejects unauthenticated users.

## Do not implement

- Chat system
- Telephony/call events
