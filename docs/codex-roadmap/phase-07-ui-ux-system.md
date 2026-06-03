# Phase 7 — UI/UX System Cleanup

## Goal

Create a coherent UI/UX system across the CRM instead of scattered module-specific screens.

The user has many future UI/UX changes in mind, so this phase should prepare the codebase for iterative design changes without making every module a one-off.

## Explicitly out of scope

- Full redesign in one giant PR.
- Replacing the whole component library without need.
- Adding random visual changes without shared patterns.
- Deployment/CI work.

## Task 7.1 — Shared CRM page patterns

### Objective

Define shared layouts for the most common CRM screens.

### Patterns to create or standardize

- Dashboard shell.
- Module list page.
- Record detail page.
- Settings page.
- Module settings page.
- Client portal page shell.
- Public booking page shell.
- Empty/loading/error states.

### Acceptance criteria

- New module pages can reuse shared page patterns.
- Existing tier-1 pages gradually move to shared patterns.
- One-off layout code is reduced.

## Task 7.2 — Record detail layout system

### Objective

Make record detail pages consistent across modules.

### Standard detail layout

- Header:
  - title
  - status/stage
  - owner/team
  - primary actions
- Main content:
  - record fields
  - editable sections
- Sidebar/panels:
  - related records
  - files
  - tasks
  - automation
- Timeline:
  - activity
  - comments
  - audit events

### Acceptance criteria

- Leads, contacts, organizations, opportunities, quotes, orders, and support tickets can follow the same detail layout pattern.
- Detail pages do not depend on modal-only workflows.
- Important actions are easy to find.

## Task 7.3 — Table/list UX standard

### Objective

Make all tier-1 list pages behave consistently.

### Standard behaviors

- Search.
- Filters.
- Saved views.
- Column picker.
- Sort.
- Pagination.
- Bulk select if useful.
- Row actions.
- Empty states.
- Error states.

### Acceptance criteria

- Tier-1 module list pages do not each invent their own table behavior.
- Users can understand lists after learning one module.
- Saved views behave consistently.

## Task 7.4 — Filter and condition builder consistency

### Objective

Use the same mental model for filters, saved views, reports, and automations.

### Shared concept

A condition row should consistently mean:

```text
field + operator + value
```

### Apply to

- Module filters.
- Saved views.
- Report filters.
- Automation conditions.
- Backup module selection if relevant.

### Acceptance criteria

- Filter UI and automation condition UI feel related.
- Operators are consistent across the app.
- Field selectors are module-aware.

## Task 7.5 — Sidebar and navigation UX pass

### Objective

Clean up dashboard navigation for real daily use.

### Requirements

- Clear module groups.
- No stale links.
- No duplicate links.
- Predictable active states.
- Easy switching between groups.
- Clean settings area.
- Module builder/settings naming is consistent.

### Acceptance criteria

- User can navigate between core modules without confusion.
- Sidebar reflects permissions and module enablement.
- Broken/incomplete modules are not accidentally promoted as stable.

## Task 7.6 — Client portal UX system

### Objective

Make the client portal visually and structurally separate from the internal CRM dashboard.

### Requirements

- Client-facing language.
- Simple navigation.
- Clear calls to action:
  - view products
  - place order
  - raise support ticket
  - view documents
  - ask question
- No internal CRM jargon unless needed.

### Acceptance criteria

- Client users understand what they can do.
- Portal does not look like a broken subset of the internal CRM.
- Portal pages are scoped and purposeful.

## Task 7.7 — Form UX standard

### Objective

Make create/edit forms consistent and less error-prone.

### Requirements

- Required field indicators.
- Inline validation.
- Server error display.
- Save/cancel behavior.
- Dirty-state warning if needed.
- Consistent relation pickers.
- Consistent date/time inputs.

### Acceptance criteria

- Forms across tier-1 modules share behavior.
- Validation errors are understandable.
- Linked record selection is consistent.

## Task 7.8 — Activity timeline component

### Objective

Create one shared activity timeline component that can be reused across records.

### Timeline event types

- note/comment
- status change
- owner/team change
- task created/completed
- email linked
- WhatsApp action linked
- document uploaded/shared/downloaded
- booking created/cancelled/rescheduled
- quote/order changes
- support ticket updates
- automation run result

### Acceptance criteria

- Timeline can render multiple event types.
- Timeline is reusable across modules.
- Timeline items link back to relevant records where possible.

## Task 7.9 — UI change management rule

### Objective

Avoid chaotic UI changes.

### Rule

Future UI changes should be grouped into passes:

- navigation pass
- table/list pass
- detail page pass
- forms pass
- client portal pass
- public pages pass

### Acceptance criteria

- Codex should not make broad visual changes while implementing backend-heavy tasks unless requested.
- UI changes should reuse shared patterns.
