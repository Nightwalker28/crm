# 01 — Record Workspace

## 1. Objective

Replace passive CRUD-style detail screens with a reusable relationship-centric workspace, beginning with Lead and then applying proven primitives to Contact, Organization, and Opportunity.

## 2. Why this exists

The record page should be where users understand and progress a relationship. Today Lead detail already has useful pieces—`RecordPageHeader`, communication actions, follow-up/activity, tasks, notes/comments, files, and audit tabs—but the experience is still organized as separate tabs/actions rather than one cohesive work surface.

## 3. Current behavior

Inspect at minimum:

- `frontend/app/dashboard/sales/leads/[leadId]/page.tsx`
- `frontend/components/recordActivity/*`
- `frontend/components/documents/RecordDocumentsPanel.tsx`
- equivalent Contact/Organization/Opportunity detail pages;
- backend summary/activity/task/comment/document routes;
- module-field/custom-field permission behavior.

Current Lead detail already distinguishes an “Audit history” tab and business-oriented activity/follow-up components. Preserve that distinction.

## 4. Desired behavior

Conceptual desktop layout:

```text
┌───────────────────────────────────────────────────────────┐
│ Jane Doe / Acme      QUALIFIED            Owner: Alex    │
│ jane@acme.com · +94...                                   │
│ Email  WhatsApp  Call  Meeting  Task  Note  More         │
├──────────────────────────────────┬────────────────────────┤
│ Activity / communication context │ Relationship/context   │
│                                  │ Organization            │
│                                  │ Contacts                │
│                                  │ Opportunities           │
│                                  │ Pipeline/value          │
├──────────────────────────────────┴────────────────────────┤
│ Configurable Details                                     │
│ Files | Audit                                             │
└───────────────────────────────────────────────────────────┘
```

On narrower screens, collapse/reorder regions rather than forcing desktop columns.

## 5. Existing code to inspect

Reuse current shared primitives before introducing replacements. Determine which of these can become workspace building blocks rather than deleting them:

- `RecordPageHeader`
- `CommunicationActions`
- `FollowUpPanel`
- `RecordActivityTimeline`
- `RecordCommentsPanel`
- `RecordTasksPanel`
- `RecordDocumentsPanel`
- `RecordTabs`
- module field/custom field hooks.

## 6. Architecture

Create a reusable composition layer conceptually similar to:

```text
RecordWorkspace
 ├─ RecordWorkspaceHeader
 ├─ RecordQuickActions
 ├─ RecordActivityRegion
 ├─ RecordRelationshipRail
 ├─ RecordDetailLayout
 ├─ RecordFilesRegion
 └─ RecordAuditRegion
```

These are composition primitives, not a universal domain model. Lead, Contact, Organization, and Opportunity supply domain-specific data/actions through typed adapters/props.

Stable shell capabilities remain product-controlled. Field/detail arrangement comes from `09-customization-metadata.md`.

## 7. Backend changes

Prefer existing summary/domain endpoints initially. Add dedicated aggregate endpoints only when they materially reduce request waterfalls or establish clean domain contracts.

If adding a workspace summary endpoint:

- scope by tenant;
- enforce record view permission;
- avoid leaking related records the user cannot view;
- return stable typed sections rather than raw ORM graphs;
- do not bundle large activity history that belongs to paginated Activity API.

## 8. Database changes

No database change should be required for shell composition alone. Relationship improvements belong to `05`; layout metadata belongs to `09`; unified activity belongs to `02`.

## 9. API contracts

Workspace APIs should separate:

- identity/summary;
- relationship context;
- resolved layout/details;
- paginated business activity;
- audit history.

Do not create one unbounded “everything about record” endpoint.

## 10. Frontend changes — phased

### Phase 1 — Lead workspace shell

- compose existing header/actions into a denser record header;
- expose primary communication/task/note actions without module switching;
- create relationship/context rail;
- integrate resolved `detail` layout for core/custom fields;
- keep Files and Audit accessible;
- retain existing routes and permission behavior.

Do not wait for WhatsApp Meta/telephony to render actions: capability-aware actions can use existing external fallbacks until integrated providers exist.

### Phase 2 — unified activity integration

After `02` lands, replace fragmented business history rendering with the normalized activity projection while keeping specialized interaction panels where useful.

### Phase 3 — Contact and Organization

Reuse shell primitives. Emphasize relationship graph:

- Contact → Organization, opportunities, communications, tasks, documents;
- Organization → Contacts, leads, opportunities, quotes/orders/support/documents.

Add contextual Quick Create entry points using `00`.

### Phase 4 — Opportunity

Add deal-centric context:

- pipeline stage/probability/value;
- associated Contacts/roles;
- Organization;
- quotes/orders/tasks/documents;
- activity/communications;
- frequent inline stage/owner/date edits.

## 11. Permission model

Every workspace region is capability-aware. If a user cannot view Quotes, do not fetch/render Quote detail. If they cannot create Tasks, hide/disable Task creation but continue enforcing backend permissions.

Field-level/detail-layout rendering must intersect layout metadata with module/field access.

## 12. Tenant isolation requirements

Relationship endpoints must reject/omit cross-tenant records even if linked IDs are malicious/corrupt. Tests should cover related Organization/Contact/Opportunity/document/task IDs from another tenant.

## 13. Background jobs/events

Workspace itself should not invent events. Actions taken from it must use normal domain services and therefore emit the same existing events/automations as other surfaces.

## 14. Error/loading/empty states

Support:

- record loading skeleton;
- record not found/permission denied;
- relationship section partial failure without destroying the entire page when safe;
- no activity yet with actionable empty state;
- no related records with contextual create CTA when permitted;
- disconnected email/Meta/calling provider state;
- layout resolution fallback;
- stale/deleted linked record.

## 15. Migration/backward compatibility

Migrate one entity at a time. Keep URLs stable. Existing `/edit` remains Advanced Edit. Existing tabs can remain behind feature flag/compatibility while the workspace pilot is validated.

## 16. Tests

- Lead workspace loading/error/permissions;
- detail layout order/visibility;
- no forbidden related records;
- quick action capability states;
- contextual create defaults;
- Files/Audit still reachable;
- mobile stacking/navigation;
- Playwright: Lead list → record → task/note/communication action without switching modules.

## 17. Acceptance criteria

A salesperson can open a Lead and perform most routine relationship work without navigating to separate Mail/Tasks/Documents modules. Audit remains distinct. Full edit remains available. Workspace primitives are reusable without hardcoding Lead-specific assumptions into the shell.

## 18. Out of scope

- implementing Meta WhatsApp internals;
- implementing telephony internals;
- replacing all backend summaries in one phase;
- making the entire shell arbitrarily tenant-draggable;
- removing deep-link routes.

## 19. Risks

- over-fetching related records;
- permission leakage through aggregate responses;
- monolithic workspace component;
- hiding too much behind tabs again;
- making layout metadata control workflow-critical shell capabilities.

## 20. Codex implementation instructions

Start with Lead only. Inspect current recordActivity components and preserve useful behavior. Keep the shell reusable but domain adapters explicit. Do not begin Contact/Organization/Opportunity until Lead passes tests and UX acceptance. Run repository checks and report deferred dependencies on `02`, `05`, `06`, `07`, and `09`.
