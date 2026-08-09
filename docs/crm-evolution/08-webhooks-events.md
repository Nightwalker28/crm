# 08 — Secure Webhooks and CRM Events

## 1. Objective

Add tenant-configurable outbound webhooks by consuming the CRM’s existing event/automation infrastructure rather than creating a parallel event bus.

## 2. Why this exists

A mature CRM needs reliable integration hooks for external systems. Webhooks should expose stable business events with delivery history, signing, retry, replay, and security controls while preserving internal domain boundaries.

## 3. Current behavior

Inspect:

- existing CRM event models/services;
- automation trigger/action infrastructure;
- Celery jobs/retry helpers;
- tenant settings/integration patterns;
- audit logging;
- HTTP client helpers and network security utilities;
- existing callback/webhook implementations in provider modules.

Before creating a new `CrmEvent`, verify whether one already exists under another name.

## 4. Desired behavior

```text
Domain transaction
  ↓
existing CRM event
  ↓
Webhook subscription matcher
  ↓
WebhookDelivery persisted
  ↓
Celery delivery
  ↓
HTTPS endpoint
  ↓
2xx success or bounded retry/failure
```

Example stable business events:

- `lead.created` / `lead.updated` / `lead.converted`;
- `opportunity.stage_changed`;
- `quote.*`;
- `order.*`;
- `task.completed`;
- communication events only when payload/privacy policy is explicit.

## 5. Existing code to inspect

Reuse event IDs, timestamps, actor/source metadata, retry infrastructure, secret encryption/storage, and tenant permission patterns if already available.

## 6. Architecture

Conceptually:

```text
CrmEvent (existing source)
   └─ WebhookSubscription
        └─ WebhookDelivery
```

Subscription:

```text
- tenant_id
- name
- event_pattern
- destination_url
- enabled
- filter_json (constrained)
- encrypted/signing secret reference
- created_by
```

Delivery:

```text
- subscription_id
- event_id
- attempt/status
- response code
- bounded response/error metadata
- next_retry_at
- delivered_at
```

Do not persist unlimited response bodies or secrets.

## 7. Backend changes — phased

### Phase 1 — event inventory/contract

- enumerate current event types/payloads;
- define stable external envelope version;
- decide which fields are safe for external delivery;
- add event versioning if needed without changing internal event identity unnecessarily.

### Phase 2 — subscriptions

- admin CRUD;
- event-pattern validation;
- constrained JSON filters if required;
- destination validation;
- signing secret generation/rotation.

### Phase 3 — delivery worker

- persist delivery before/when queued;
- HMAC signature over documented bytes/envelope;
- timeout limits;
- bounded exponential backoff;
- max attempts/dead state;
- idempotent `(subscription,event)` behavior;
- delivery observability.

### Phase 4 — replay/testing

- admin test webhook with explicit non-production event marker;
- replay failed delivery without changing original event ID;
- rotate signing secret safely.

## 8. Database changes

Add subscription/delivery tables with tenant indexes, unique event/subscription delivery identity, status/retry indexes, and retention strategy. Preserve event rows according to existing event policy.

## 9. API contracts

Admin endpoints for subscriptions, secret rotation, test, delivery history, and replay. Do not return plaintext stored secrets after initial generation; provide rotate/reveal behavior only consistent with current secret-management policy.

Webhook envelope should contain:

- event ID;
- type;
- version;
- occurred timestamp;
- tenant-scoped public identifier only if product policy allows;
- actor/source metadata where safe;
- typed payload.

## 10. Frontend changes

Settings UI:

- subscription list/status;
- create/edit form;
- event selector/pattern help;
- destination URL;
- signing secret one-time display/rotate;
- test action;
- delivery history with attempts/status;
- replay action;
- clear security warnings for blocked/internal URLs.

## 11. Permission model

Webhook configuration is a high-privilege configure/integration capability. Delivery worker runs system-side but only uses tenant-owned subscription/event data. Users without integration configuration permission must not see destination URLs/secrets/delivery bodies.

## 12. Tenant-isolation requirements

Every subscription/delivery/event lookup is tenant scoped. Replay/test endpoints verify subscription belongs to current tenant. Worker payload assembly must not follow arbitrary cross-tenant references.

## 13. Background jobs/events

Celery delivery requirements:

- explicit connect/read timeout;
- no automatic unbounded redirects;
- retry only eligible failures;
- cap concurrency per tenant/destination if needed;
- record each attempt safely;
- stable idempotency/event headers.

## 14. Error/loading/empty states

- no subscriptions;
- invalid/blocked URL;
- DNS resolution changes to private/internal address;
- timeout/5xx/429;
- permanent 4xx;
- signing secret rotated;
- event payload version unsupported by customer;
- replay already queued.

## 15. Migration/backward compatibility

Do not alter existing internal automation event consumers merely to expose webhooks. Add an external consumer/subscriber path. If event schemas change, version envelopes instead of silently changing existing external contracts.

## 16. Tests

Security tests are mandatory:

- reject loopback (`127.0.0.0/8`, `::1`);
- reject link-local and cloud metadata targets;
- private/internal network handling per deployment policy;
- DNS rebinding/re-resolution controls where feasible;
- redirect target revalidation;
- HMAC signature correctness;
- secret non-disclosure;
- tenant isolation;
- timeout/retry/max-attempt behavior;
- idempotent delivery;
- replay semantics.

## 17. Acceptance criteria

A tenant admin can subscribe to approved CRM events, receive signed versioned HTTPS webhooks, inspect delivery history, and replay failures. Delivery is tenant-safe, retry-bounded, and protected against SSRF/internal network access according to deployment policy.

## 18. Out of scope

- arbitrary user-supplied webhook code;
- inbound generic webhook workflow builder;
- replacing internal automation events;
- unlimited payload/response storage;
- unrestricted internal network destinations by default.

## 19. Risks

- SSRF;
- leaking secrets/customer data;
- unstable event schemas;
- retry storms;
- destination outages slowing workers;
- duplicate external actions if idempotency is unclear.

## 20. Codex implementation instructions

First prove which event infrastructure exists and document the mapping. Do not create a second event bus. Treat URL validation and SSRF defense as acceptance-blocking, not optional hardening. Implement subscription/delivery/replay in separate coherent phases with focused tests.
