# Run 2 — UI Polish After Routing Is Stable

## Goal

You are working on `Nightwalker28/crm`.

Run 2 goal: polish the CRM/ERP UI across pages and components after Run 1 routing and Settings architecture are stable.

This run should complete:

- PageHeader consistency
- Empty states
- Form/dialog consistency
- Detail page tabs
- Finance UI improvements
- Sales UI improvements
- Table polish
- Notification/activity polish
- Status pill centralization
- Mobile responsiveness cleanup

## Hard Rules

- Do not change backend files.
- Do not change API contracts.
- Do not change routes from Run 1.
- Do not reintroduce old admin routes.
- Do not add redirects.
- Do not add new packages.
- Reuse shared UI components.
- Keep TypeScript clean.
- Keep the existing dark/neutral Lynk UI style.

---

## Task 1 — PageHeader Consistency

Standardize `PageHeader` usage.

Inspect:

- `frontend/components/ui/PageHeader.tsx`
- dashboard list pages
- finance pages
- sales pages
- catalog pages
- tasks pages
- settings pages

Rules:

- Every list page has title, description, and primary action if relevant.
- Every detail page has title, back action, and primary action if relevant.
- Standard body spacing: `gap-6`.
- PageHeader action area should wrap on mobile using `flex-wrap gap-2`.
- Avoid double headers inside Settings layout.

Acceptance criteria:

- Headers feel consistent.
- Mobile header actions do not break layout.
- No route or backend changes.

---

## Task 2 — Empty State Component

Create:

```text
frontend/components/ui/EmptyState.tsx
```

Props:

```ts
icon?: React.ComponentType<{ className?: string }>;
title: string;
description?: string;
action?: React.ReactNode;
className?: string;
```

Style:

- centered
- icon `h-8 w-8 text-neutral-700`
- title `text-neutral-200`
- description `text-neutral-500`
- optional CTA

Apply to:

- `ContactList`
- `OrganizationsTable` / Accounts table
- `OpportunitiesTable` / Deals table
- `InsertionOrdersList`
- `TasksTable`
- `CatalogRecordsTable`
- `ModuleTableShell` empty rows where suitable

Suggested empty-state copy:

- `No contacts found`
- `No accounts found`
- `No deals found`
- `No insertion orders found`
- `No tasks found`
- `No records found`

Acceptance criteria:

- Empty states are consistent and polished.
- No blank table bodies.
- No backend changes.

---

## Task 3 — RequiredMark and Form Consistency

Create:

```text
frontend/components/ui/RequiredMark.tsx
```

Then remove local `RequiredMark` / `RequiredAsterisk` duplicates and import the shared component.

Form rules:

- Normal forms: `grid gap-4 sm:grid-cols-2`
- Long text fields: full width
- Simple dialogs: `max-w-xl`
- Complex dialogs: `max-w-3xl max-h-[80vh] overflow-y-auto`
- Destructive confirm dialogs: `max-w-sm`

Apply to:

- contact create/edit
- account/organization create/edit
- deal/opportunity create/edit
- insertion order dialog
- user dialogs
- other visible forms with required markers

Acceptance criteria:

- Required fields look consistent.
- Dialogs are correctly sized.
- No duplicate required marker components remain.
- No backend changes.

---

## Task 4 — Record Detail Tabs

Create:

```text
frontend/components/ui/RecordTabs.tsx
```

Requirements:

- client component
- uses `useState` for active tab
- not route-based
- horizontal pill/underline style
- mobile scrollable

Apply to:

Contact detail:

- Overview
- Activity
- Notes
- Documents
- Tasks
- Follow-up

Account/Organization detail:

- Overview
- Contacts
- Activity
- Notes
- Documents

Deal/Opportunity detail:

- Overview
- Activity
- Notes
- Documents

Rules:

- Existing detail content goes in Overview.
- Tabs without data show `EmptyState`.
- Do not add backend logic.
- Do not change route structure.

Acceptance criteria:

- CRM detail pages feel more production-ready.
- Existing detail content still appears.

---

## Task 5 — Finance Polish

Polish Finance UI.

Inspect:

- `frontend/app/dashboard/finance/page.tsx`
- `frontend/app/dashboard/finance/pos/page.tsx`
- insertion order list/page components

Finance overview:

- Add/update PageHeader:
  - Title: `Finance`
  - Description: `Monitor insertion orders, POS invoices, and finance activity.`
- Add 4th metric card:
  - `Completed this month`
- Add Quick Actions:
  - `New Insertion Order`
  - `New POS Invoice`
  - `Export Orders` only if export exists; otherwise hide or disable.

POS page:

- Remove misleading mixed-currency money summary if based on first invoice currency.
- Use count-based metrics:
  - `Total Invoices`
  - `Paid Count`
  - `Outstanding Count`

Insertion Orders:

- Fix filter/search row mobile layout:
  - `flex flex-col gap-3 md:flex-row md:items-center`

Acceptance criteria:

- Finance pages are clearer and mobile-safe.
- No misleading mixed-currency totals.
- No backend changes.

---

## Task 6 — Sales Polish

Polish Sales CRM UI.

Sales overview:

- Ensure `/dashboard/sales` has a useful overview.
- Add cards:
  - `Total Accounts`
  - `Total Contacts`
  - `Open Deals`
  - `Recently Updated`
- Add sections:
  - `Recent Deals`
  - `Recent Contacts`
  - `Recent Accounts`
  - `Pipeline Summary`
- Do not fake numbers. Use hooks if available; otherwise show clean empty-state placeholders.

Sales labels:

- `Organizations` visible label should be `Accounts`.
- `Opportunities` visible label should be `Deals`.

Pipeline board:

- Replace fixed `grid-cols-7` with:
  - `flex gap-4 overflow-x-auto`
  - columns `min-w-[220px] flex-shrink-0`

Acceptance criteria:

- Sales module feels like CRM, not raw database pages.
- No route changes.
- No backend changes.

---

## Task 7 — Table Polish

Polish shared table components.

Inspect:

- `frontend/components/ui/Table.tsx`
- `frontend/components/ui/ModuleTableShell.tsx`
- table/list components using horizontal scroll

Changes:

- Keep existing table API.
- If `TableHead` uses pseudo dividers, ensure first and last column exceptions are clean.
- Make headers visually consistent.

ModuleTableShell:

- Add mobile horizontal scroll indicator shadow if safe.
- Ensure relative positioning if using pseudo-element.

Sortable columns:

- Add frontend sorting only where simple and data already exists:
  - ContactList common columns
  - InsertionOrdersList common columns
- Do not add backend sorting.

Acceptance criteria:

- Tables look consistent.
- Mobile scroll behavior is clearer.
- No component API breakage.

---

## Task 8 — Status Style Centralization

Create:

```text
frontend/lib/statusStyles.ts
```

Export:

- `getInsertionOrderStatusStyle(status: string)`
- `getOpportunityStageStyle(stage: string)`
- `getTaskPriorityStyle(priority: string)`
- `getTaskStatusStyle(status: string)`
- optional `getGenericStatusStyle(status: string)`

Use in:

- `InsertionOrdersList`
- `OpportunitiesTable`
- `TasksTable`
- any duplicated pill-style mapping

Rules:

- Do not change status values.
- Only centralize styling.
- Keep existing color meanings close to current design.

Acceptance criteria:

- Status pills look consistent.
- Duplicated style maps are reduced.
- No backend changes.

---

## Task 9 — Notification and Activity Polish

Polish NotificationCenter and Activity Log.

Inspect:

- `frontend/components/notifications/NotificationCenter.tsx`
- `frontend/app/dashboard/settings/activity-log/page.tsx`

NotificationCenter:

- Change popover from `side="right"` to `side="bottom" align="end"` if currently clipping.
- Add `View all notifications` footer only if `/dashboard/notifications` exists.
- Do not add a broken link.

Activity Log:

- Add action filter options:
  - `restore`
  - `comment_added`
- Add `module_key` filter only if current frontend data/API already supports `module_key`.

Acceptance criteria:

- Notification popover works on narrow screens.
- Activity filters are more useful without backend changes.

---

## Task 10 — Mobile Responsiveness Pass

Perform a safe mobile responsiveness cleanup.

Focus:

- PageHeader actions wrapping
- Settings layout nav
- Sidebar collapsed/hover behavior
- ModuleTableShell horizontal scroll
- Dashboard home cards
- Finance filters
- Sales pipeline board
- Dialog max heights
- Settings cards grid

Rules:

- Fix obvious layout breaks only.
- Keep desktop layout polished.
- Do not redesign the entire app.
- Use Tailwind responsive classes.

Acceptance criteria:

- No major mobile overflow.
- Buttons wrap cleanly.
- Dialogs are usable.
- Tables scroll predictably.

---

## Task 11 — Final UI Consistency Audit

Run final frontend-only UI consistency audit.

Search/fix:

- Raw backend module names in UI.
- Old route strings.
- `Admin` wording where `Settings` is now correct.
- `Organizations` where visible label should be `Accounts`.
- `Opportunities` where visible label should be `Deals`.
- Duplicate Templates navigation.
- Inconsistent button labels.
- Inconsistent empty states.
- Inconsistent dialog sizing.
- Inconsistent PageHeader spacing.

Do not:

- Reintroduce old routes.
- Add redirects.
- Change backend.
- Add packages.

Run:

```bash
npm run lint
npm run build
```

If `npm run build` is unavailable or unreasonable in the environment, document why and still run lint/type checks that are available.

Acceptance criteria:

- UI is clean, consistent, and production-ready.
- No old admin routes remain.
- No unused redirect wrappers remain.
- Build passes.

---

## Start and Stop Instructions

Start Run 2 only after Run 1 is merged/stable.

Run 2 begins with:

```text
Task 1 — PageHeader Consistency
```

Do not revisit routing except to verify no old route strings came back.

Run 2 is complete when:

1. Page headers are consistent.
2. Empty states are standardized.
3. Required marks and dialog sizing are standardized.
4. Record detail tabs exist where relevant.
5. Finance UI is polished.
6. Sales UI is polished.
7. Tables are visually cleaned up.
8. Status styles are centralized.
9. Notification and activity UI are polished.
10. Mobile responsiveness pass is complete.
11. `npm run lint` passes.
12. `npm run build` passes, if available and reasonable.
13. No backend files were changed.
14. Old admin routes were not reintroduced.
