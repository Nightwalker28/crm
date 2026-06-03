# Phase 1 — Product Foundation and Module Cleanup

## Goal

Make the existing CRM product surface coherent before adding more features.

This phase should clean up routing, sidebar behavior, module registration, tier-1 module status, and shared list/detail patterns.

## Explicitly out of scope

- Kubernetes.
- Docker Swarm.
- Jenkins.
- GitHub CI/CD.
- Deployment automation.
- Migration-test automation.
- New ERP modules.

## Task 1.1 — Define tier-1 module registry

### Objective

Create a clear source of truth for which modules are tier-1, tier-2, experimental, hidden, or deprecated.

### Implementation notes

- Find the current module/sidebar/menu registration logic.
- Remove stale modules and broken routes from visible navigation.
- Add or update a typed/module-safe registry if one already exists.
- Module metadata should include:
  - key
  - label
  - route
  - group
  - status: tier1, tier2, experimental, deprecated, hidden
  - required permission/module access
  - icon if applicable
  - enabled flag if applicable

### Tier-1 modules

- leads
- contacts
- organizations/accounts
- opportunities
- quotes
- sales orders
- products/services/catalog
- documents
- client portal
- support tickets
- calendar booking
- mail
- integrations
- users/roles/teams/permissions

### Acceptance criteria

- Sidebar only shows valid modules with working routes.
- Deprecated/broken modules are hidden or removed from navigation.
- Module builder/settings do not expose stale module references.
- Permissions are respected when rendering navigation.
- A future developer can identify tier-1 modules from one clear place.

## Task 1.2 — Fix sidebar and route behavior

### Objective

Make dashboard navigation predictable and not stuck inside a module group.

### Implementation notes

- Audit sidebar groups and route matching.
- Fix active-state logic so opening a Sales module does not prevent switching to another group.
- Remove stale links such as old dashboard, users, sales, settings, or WhatsApp references if the destination does not exist or has moved.
- Ensure Settings routes are grouped under settings, not generic/other.
- Ensure Module Settings/Module Builder naming is consistent.

### Acceptance criteria

- User can switch from any Sales page to any non-Sales sidebar section.
- No sidebar link routes to a missing page.
- No duplicate dashboard/settings/users/module links.
- Active sidebar state reflects the current route correctly.
- Module groups can collapse/expand predictably.

## Task 1.3 — Standardize tier-1 list pages

### Objective

Make all important module list pages feel like the same product.

### Standard page behavior

Each tier-1 list page should support, where applicable:

- Server-side pagination.
- Search.
- Filters.
- Sorting.
- Saved views.
- Column visibility preferences.
- Loading state.
- Empty state.
- Error state.
- Create button with permission check.
- Row action menu with permission checks.

### Start with these modules

1. Leads.
2. Opportunities.
3. Quotes.
4. Sales orders.
5. Documents.
6. Support tickets.
7. Products/services.
8. Client portal records/pages.
9. all other modules

### Acceptance criteria

- Tier-1 list pages use shared components where practical.
- Filtering and pagination happen on the backend for large datasets.
- Saved view behavior is consistent.
- Empty/error/loading states are not one-off designs.

## Task 1.4 — Standardize tier-1 detail pages

### Objective

Move important record workflows out of scattered modals and into consistent detail pages.

### Standard detail page sections

Each detail page should include, where applicable:

- Header with record name/status/actions.
- Main details panel.
- Related records panel.
- Activity timeline.
- Notes/comments.
- Files/documents.
- Tasks/follow-ups.
- Automation tab/entry point.
- Audit/history tab or section.

### Acceptance criteria

- Leads, opportunities, quotes, orders, contacts, organizations, support tickets, and documents have consistent detail layout patterns.
- Actions are permission-aware.
- Related records are easy to access.
- Important state changes create activity/audit events.

## Task 1.5 — Backend permission enforcement audit for tier-1 modules

### Objective

Ensure protected actions are blocked in the backend, not only hidden in the frontend.

### Implementation notes

Audit these actions per tier-1 module:

- read/list
- create
- update
- delete
- restore
- export
- assign owner/team
- admin/config actions

### Acceptance criteria

- Backend route/service checks exist for protected actions.
- Frontend permission hiding is treated only as UX.
- Permission failures return consistent errors.
- Add or update tests for high-risk permission paths where feasible.

## Task 1.6 — Module maturity checklist

### Objective

Create a living checklist to track which modules are complete, partial, or experimental.

### Implementation notes

Create or update `docs/module-maturity.md` with:

- module name
- tier
- status
- list page status
- detail page status
- permissions status
- activity timeline status
- automation support status
- tests status
- notes

### Acceptance criteria

- The document exists.
- Tier-1 modules are listed first.
- It is clear what is incomplete for each module.
