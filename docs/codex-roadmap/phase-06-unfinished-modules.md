# Phase 6 — Hardening Unfinished Modules

## Goal

Treat calendar, mail, booking links, integrations, and client portal as unfinished modules that need serious product work before they are considered stable.

This phase focuses on making those modules coherent, observable, recoverable, and useful.

## Explicitly out of scope

- Replacing current providers with an external paid platform.
- Complex enterprise integration marketplace.
- Kubernetes/deployment work.
- CI/CD work.

## Task 6.1 — Integration registry cleanup

### Objective

Make integrations one governed platform instead of scattered provider-specific features.

### Common integration contract

Each integration/provider connection should track:

- provider key
- provider display name
- tenant ID
- connection owner
- credential state
- scopes
- status: connected, disconnected, error, expired, reconnect_required
- health status
- last sync time
- last successful sync time
- last failure reason
- reconnect URL/action
- sync runs
- audit events

### Acceptance criteria

- Google, Microsoft, OneDrive, mail, calendar, and public API integrations follow a shared structure where practical.
- Admin can see connection health.
- Admin can reconnect broken integrations.
- Tokens/secrets are encrypted.

## Task 6.2 — Public catalog/order integration completion

### Objective

Finish the published catalog/order work highlighted by existing repo issues.

### Requirements

- Published product/service mapping.
- Public catalog API only exposes published records.
- API keys have scopes.
- Website orders are separated clearly from internal orders until accepted/converted if needed.
- Integration UI is split into clear sections:
  - API keys
  - published catalog
  - website/client orders
  - sync/health logs

### Acceptance criteria

- API consumers cannot access unpublished products/services.
- API key permissions are enforced.
- Public orders are visible internally with source metadata.
- Integration UI is understandable.

## Task 6.3 — Calendar module hardening

### Objective

Make calendar usable and diagnosable.

### Requirements

- Provider connection status.
- Calendar sync logs.
- Failed sync handling.
- Reconnect flow.
- Availability rules.
- Timezone correctness.
- Conflict handling.
- Booking buffer times.
- Link events/bookings to contact/lead/opportunity where applicable.
- Create follow-up task after booking where configured.

### Acceptance criteria

- User can see whether calendar provider is connected.
- User can understand last sync result.
- Booking times display correctly across timezones.
- Calendar errors do not silently fail.

## Task 6.4 — Booking links hardening

### Objective

Turn booking links into a reliable public workflow.

### Requirements

- Public booking page polish.
- Availability slots.
- Timezone selector/display.
- Reschedule/cancel support if enabled.
- Spam/rate limit protection.
- Custom booking form fields.
- Auto-create or link lead/contact.
- Internal notification.
- Client confirmation message/email later.
- Activity timeline entry.

### Acceptance criteria

- Public user can book successfully.
- Booking creates/links CRM records correctly.
- Internal users can see booking context.
- Invalid/spammy booking attempts are limited.
- Booking workflow is testable manually from public link to CRM record.

## Task 6.5 — Mail module hardening

### Objective

Make mail sync and linking reliable enough for CRM usage.

### Requirements

- Provider connection status.
- Token refresh handling.
- Sync logs.
- Failed sync handling.
- Reconnect flow.
- Link email to contact/lead/opportunity/quote/order.
- Email activity timeline entry.
- Send test email.
- Email templates.
- Permission rules for inbox/message visibility.

### Acceptance criteria

- User can see mail connection health.
- User can trigger/test sync if allowed.
- Failed syncs show useful messages.
- Emails can be linked to CRM records.
- Linked emails show in activity timeline.

## Task 6.6 — Client portal hardening after rework

### Objective

After the client portal rework, harden it as a real client-facing module.

### Requirements

- Client auth stability.
- Client user roles.
- Client-specific data scoping.
- Products/services with client pricing.
- Client order flow.
- Support ticket flow.
- Shared documents.
- Quotes/contracts visibility and approval.
- Portal audit events.
- Portal settings/admin controls.

### Acceptance criteria

- Client portal is not a generic/useless dashboard.
- Every portal page has a clear customer purpose.
- Client actions create internal CRM records or activity.
- Internal users can manage portal access.

## Task 6.7 — Integration/public API security hardening

### Objective

Make public and integration-facing endpoints safer.

### Requirements

- API key scopes.
- API key rotation.
- API key last-used timestamp.
- Rate limits.
- Origin allowlist where applicable.
- Signed webhook support later.
- Public API audit logs.

### Acceptance criteria

- API keys can be created, revoked, and rotated.
- Public API requests are scoped and logged.
- Abuse-prone endpoints have rate limits.
- Secrets are not displayed after creation.

## Task 6.8 — Module health/status surfaces

### Objective

Give admins a clear status view for unfinished/integration-heavy modules.

### Status panels should show

- provider connection state
- last sync time
- last error
- queued jobs
- failed jobs
- reconnect action
- documentation/help text

### Apply to

- Calendar.
- Mail.
- Microsoft/OneDrive.
- Google.
- Public API integrations.
- Backup destinations.

### Acceptance criteria

- Admin does not need logs to know an integration is broken.
- Reconnect/fix path is visible.
- Error messages are human-readable.
