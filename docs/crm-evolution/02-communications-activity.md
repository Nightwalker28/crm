# 02 — Unified Communications and Relationship Activity

## 1. Objective

Create one normalized, permission-aware relationship activity projection for human/business interactions while preserving each domain table as its source of truth and keeping immutable audit history separate.

## 2. Why this exists

A CRM user should not reconstruct relationship history by visiting separate tabs/modules for follow-ups, tasks, comments, mail, WhatsApp, calls, and meetings. At the same time, forcing all domains into one giant activity table would weaken their independent behavior and migration paths.

## 3. Current behavior

Inspect:

- `frontend/components/recordActivity/*`;
- Lead/Contact/Organization/Opportunity detail pages;
- tasks module;
- calendar/meeting data;
- mail module;
- WhatsApp module and `WhatsAppInteraction`;
- notes/comments/follow-up stores;
- current audit/activity-log implementation.

Determine which current “activity” names actually represent immutable audit changes versus salesperson interaction history.

## 4. Desired behavior

Conceptual API-facing union:

```ts
type ActivityItem =
  | EmailActivity
  | WhatsAppActivity
  | CallActivity
  | MeetingActivity
  | TaskActivity
  | NoteActivity
  | CommentActivity
  | FollowUpActivity;
```

Each item exposes normalized envelope fields such as:

- canonical item ID/type;
- occurred timestamp;
- actor/source;
- direction where relevant;
- short display summary;
- source-domain identifier;
- record linkage;
- capability metadata for reply/open/complete/etc.;
- safe provider status where relevant.

Do not serialize provider secrets or unrestricted raw payloads.

## 5. Existing code to inspect

Search existing activity/audit helpers and APIs before adding new abstractions. Reuse current record linking conventions, permission helpers, and pagination patterns.

## 6. Architecture

Use a projection/aggregation service:

```text
MailMessage ───────┐
WhatsAppInteraction│
CallLog             │
Meeting             ├─> RecordActivityProjectionService ─> Activity API
Task                │
Note/Comment        │
FollowUp ───────────┘

AuditEvent/record-change history ─────────────> separate Audit API/UI
```

Do not introduce a second event store merely to render a timeline.

## 7. Backend changes

Implement a record activity service that:

- resolves supported module/entity identifiers;
- validates tenant and record visibility;
- queries relevant source repositories;
- normalizes results;
- merges/sorts by canonical time;
- uses stable cursor pagination;
- supports type filters;
- deduplicates where multiple projections represent the same event;
- omits/redacts data based on permissions.

Avoid loading N unlimited collections and sorting in Python for high-volume records. Design pagination/query strategy deliberately.

## 8. Database changes

Prefer no new canonical activity table. Add indexes to source tables when required by record linkage + timestamp queries.

If a source domain lacks explicit record association, add a narrow relationship/link table or fields rather than relying permanently on email/phone inference.

## 9. API contracts

Candidate contract:

```text
GET /api/v1/records/{module_key}/{entity_id}/activity
  ?types=email,task,note
  &cursor=...
  &limit=...
  &order=desc
```

Response:

```json
{
  "items": [],
  "next_cursor": null,
  "has_more": false
}
```

Cursor must be opaque to clients. Define deterministic tie-breaking for same-timestamp events.

## 10. Frontend changes — phased

### Phase 1 — normalized rendering contract

Create typed activity renderers/cards with shared envelope and domain-specific bodies/actions. Do not flatten email threads or WhatsApp conversations into unreadable generic cards.

### Phase 2 — Lead integration

Render unified Activity in Lead workspace with filters such as All, Email, WhatsApp, Calls, Meetings, Tasks/Notes as appropriate.

### Phase 3 — other core CRM records

Apply to Contact, Organization, Opportunity using same endpoint/service contract.

### Phase 4 — specialized views

Keep specialized tabs/panels for full email thread, WhatsApp conversation, call details, etc., linked from Activity.

## 11. Permission model

Activity access inherits record visibility plus source-domain visibility. A user who can view an Opportunity but lacks access to a sensitive communication/document domain must not receive that content through Activity.

## 12. Tenant-isolation requirements

Every source query must include tenant scope, even if entity IDs are globally unique. Tests should seed matching entity IDs/source references across tenants and prove isolation.

## 13. Background jobs/events

Projection reads should not emit events. Source domains continue to emit their normal events when messages/tasks/calls/etc. are created/updated.

## 14. Error/loading/empty states

- skeleton timeline;
- “No activity yet” with relevant action CTAs;
- filter yields no matches;
- partial provider status unavailable;
- deleted source item rendered as safe tombstone only if product requires history;
- permission change removes item without crashing timeline;
- pagination/retry failure preserves already loaded history.

## 15. Migration/backward compatibility

Keep existing audit history untouched. Existing task/comment/follow-up APIs can continue while the projection is adopted. Replace UI consumption gradually, not source-domain storage.

## 16. Tests

- normalization per source type;
- cross-source ordering/tie-break;
- cursor stability;
- filters;
- deduplication;
- record and source permissions;
- tenant isolation;
- deleted/soft-deleted sources;
- frontend rendering per type;
- Playwright: create task/note/email and see it in relationship activity while audit remains separate.

## 17. Acceptance criteria

Users can understand chronological customer/deal interaction history from one Activity region. Source records remain authoritative. Audit history remains separate. The API is paginated, deterministic, tenant-safe, and permission-aware.

## 18. Out of scope

- replacing mail/WhatsApp/task tables;
- storing immutable audit events in the business feed;
- provider-specific message sending;
- generic cross-tenant activity search.

## 19. Risks

- unbounded merge queries;
- duplicated events;
- permission leaks from aggregate APIs;
- confusing audit and relationship activity;
- generic cards losing domain context.

## 20. Codex implementation instructions

Inventory every existing source and its linkage/indexes before coding. Implement a minimal Lead-supported projection first. Add source adapters incrementally and tests per source. Do not create a universal activity persistence table unless repository evidence proves a projection cannot meet requirements and that architectural change is explicitly approved.
