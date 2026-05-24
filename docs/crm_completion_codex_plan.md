# CRM Completion Codex Plan

This plan breaks the remaining CRM work into Codex-sized tasks. The goal is to finish the CRM lifecycle first, then defer ERP modules such as products, services, inventory, POS, insertion orders, payments, purchase orders, suppliers, and accounting.

## Scope

### CRM scope to finish first

- Leads
- Accounts / Organizations
- Contacts
- Deals / Opportunities
- Quotes
- Lead conversion workflow
- Tasks, follow-ups, notes, comments, and activity timeline
- Communication actions and history
- CRM reports and dashboard
- CRM settings polish

### ERP scope to defer

- Products
- Services
- Inventory
- Warehouses
- Stock movements
- Purchase orders
- Suppliers / vendors
- Bills / expenses
- POS invoices
- Insertion orders
- Payments
- Credit notes
- Accounting
- Payroll
- Procurement

## Current known CRM foundation

The backend already includes CRM-facing routes for:

- `sales_leads`
- `sales_contacts`
- `sales_organizations`
- `sales_opportunities`
- `sales_quotes`
- tasks
- calendar
- CRM events
- record comments
- notifications
- activity logs
- message templates
- mail
- WhatsApp
- reports
- recycle bin
- module fields and permissions

The frontend route constants already include:

- `/dashboard/sales/leads`
- `/dashboard/sales/organizations`
- `/dashboard/sales/contacts`
- `/dashboard/sales/opportunities`
- `/dashboard/sales/quotes`
- `/dashboard/reports`

Codex should verify exact files and schemas before implementation.

---

# Phase 0 — CRM audit and stabilization

## Goal

Confirm which CRM modules are complete, partial, or missing, then avoid duplicate implementations.

## Task 0.1 — Audit CRM routes, pages, hooks, components, and API clients

### Instructions for Codex

Inspect the repo and create a short internal implementation checklist in the PR description or commit notes.

Check these areas:

- `backend/app/api/v1/router.py`
- `backend/app/modules/sales/routes/`
- `backend/app/modules/sales/services/`
- `backend/app/modules/sales/repositories/`
- `backend/app/modules/sales/models.py`
- `backend/app/modules/sales/schema.py`
- `frontend/app/dashboard/sales/`
- `frontend/components/`
- `frontend/hooks/`
- `frontend/lib/routes.ts`
- `frontend/lib/moduleViewConfigs.ts`
- sidebar/nav files

### Acceptance criteria

- Identify existing implementations for Leads, Accounts, Contacts, Deals, Quotes.
- Identify missing frontend pages.
- Identify missing hooks/API wrappers.
- Identify stale generic module references that conflict with real CRM modules.
- Do not delete anything unless it is clearly stale and unused.

---

# Phase 1 — Leads module

## Goal

Make Leads a fully usable CRM module. Leads are the start of the CRM lifecycle.

Expected lifecycle:

```text
Lead → Qualified Lead → Contact + Account → Deal
```

## Task 1.1 — Build Leads list page

### Route

```text
/dashboard/sales/leads
```

### Requirements

- Use existing backend leads API under `/api/v1/sales/leads`.
- Display paginated leads.
- Support search if backend endpoint exists.
- Support module field config where applicable.
- Support status filter.
- Support owner/assigned user filter where feasible.
- Include create, view, edit, delete actions.
- Use the same table/list style as Contacts, Accounts, and Deals.

### Suggested columns

- Name
- Company
- Email
- Phone
- Source
- Status
- Owner
- Last contacted
- Created
- Actions

### Acceptance criteria

- Leads list loads without console errors.
- Empty state is handled.
- Loading state is handled.
- API errors are surfaced cleanly.
- Clicking a row opens lead detail.
- Create button opens `/dashboard/sales/leads/new`.

## Task 1.2 — Build Lead create/edit form

### Routes

```text
/dashboard/sales/leads/new
/dashboard/sales/leads/[leadId]/edit
```

### Required fields

- First name
- Last name
- Company
- Primary email
- Phone
- Title
- Source
- Status
- Notes
- Assigned user
- Custom fields, if supported by existing field config

### Acceptance criteria

- Can create a lead.
- Can edit a lead.
- Validation errors display properly.
- After create, redirect to lead detail.
- After edit, redirect back to detail or keep user on edit with success feedback.
- Disabled module fields are not submitted.

## Task 1.3 — Build Lead detail page

### Route

```text
/dashboard/sales/leads/[leadId]
```

### Requirements

Show:

- Lead name
- Company
- Email
- Phone
- Title
- Source
- Status
- Assigned owner
- Created time
- Last contacted
- Notes
- Custom fields
- Activity/timeline placeholder or real shared component if available
- Actions: edit, delete, convert, log follow-up, WhatsApp/email where available

### Acceptance criteria

- Detail page loads by lead id.
- Missing lead shows not-found/error state.
- Edit action works.
- Delete/restore behavior follows existing CRM patterns.

---

# Phase 2 — Lead conversion workflow

## Goal

Create the core CRM transition from lead to active customer pipeline.

Expected workflow:

```text
Lead → Account + Contact → optional Deal
```

## Task 2.1 — Add backend lead conversion endpoint if missing

### Suggested endpoint

```text
POST /api/v1/sales/leads/{lead_id}/convert
```

### Request shape

```json
{
  "create_account": true,
  "account_id": null,
  "create_contact": true,
  "contact_id": null,
  "create_deal": false,
  "deal_name": null,
  "deal_stage": "qualified",
  "assigned_to": null
}
```

Use exact project schema conventions rather than copying this blindly.

### Required behavior

- Load lead by tenant.
- Create or link account/organization.
- Create or link contact.
- Optionally create deal/opportunity.
- Preserve owner assignment where possible.
- Copy useful fields from lead to contact/account.
- Mark lead as converted using existing status conventions.
- Log activity.
- Return created/linked record IDs.

### Acceptance criteria

- Tenant isolation is enforced.
- Permissions are enforced.
- Conversion is transaction-safe.
- Duplicate handling does not create obvious duplicate accounts/contacts when an existing record is selected.
- Activity log records conversion.

## Task 2.2 — Build frontend Convert Lead dialog

### Requirements

Add a `Convert Lead` action on lead detail.

Dialog should allow:

- Create new account from lead company.
- Link existing account.
- Create new contact from lead person fields.
- Link existing contact.
- Optionally create a deal.
- Choose deal name and initial stage.

### Acceptance criteria

- Conversion works end-to-end.
- User is shown links to created records.
- Converted lead can no longer be converted again unless existing business rules allow it.
- Conversion errors display clearly.

---

# Phase 3 — Accounts, Contacts, and Deals polish

## Goal

Make the existing core CRM modules feel connected, not isolated.

## Task 3.1 — Accounts detail relationship panels

### Route

```text
/dashboard/sales/organizations/[organizationId]
```

### Requirements

Add or verify panels for:

- Related contacts
- Related deals/opportunities
- Related quotes
- Activity timeline
- Notes/comments
- Follow-ups/tasks

### Acceptance criteria

- Account detail shows linked contacts.
- Account detail shows linked deals.
- Account detail shows linked quotes if quotes support organization links.
- Quick actions exist to add contact/deal/quote linked to the account.

## Task 3.2 — Contacts detail relationship panels

### Route

```text
/dashboard/sales/contacts/[contactId]
```

### Requirements

Add or verify panels for:

- Linked account
- Related deals
- Related quotes
- Activity timeline
- Notes/comments
- Follow-ups/tasks
- WhatsApp/email actions

### Acceptance criteria

- Contact detail shows linked account.
- Contact detail shows linked deals.
- Contact detail shows linked quotes where applicable.
- Communication actions update or support last-contacted metadata where existing backend supports it.

## Task 3.3 — Deals pipeline and detail polish

### Routes

```text
/dashboard/sales/opportunities
/dashboard/sales/opportunities/[opportunityId]
```

### Requirements

- Verify list view.
- Verify pipeline board view.
- Support stage changes.
- Support close won / close lost.
- Show linked account.
- Show linked contact.
- Show related quotes.
- Show activity timeline.
- Show follow-ups/tasks.

### Acceptance criteria

- Deal can move between stages.
- Deal detail reflects current stage.
- Related account/contact links work.
- Related quote links work after quotes are built.

---

# Phase 4 — Quotes module

## Goal

Finish Quotes as the final CRM sales artifact before ERP/Finance. Quotes belong to CRM because they support sales negotiation. Invoicing and payment belong to ERP/Finance and should be deferred.

## Task 4.1 — Build Quotes list page

### Route

```text
/dashboard/sales/quotes
```

### Requirements

Use existing backend quotes API under `/api/v1/sales/quotes`.

List should support:

- Pagination
- Search
- Filters
- Status filter
- Field config
- Create/view/edit/delete
- Import/export if existing patterns are already available

### Suggested columns

- Quote number
- Title
- Customer
- Status
- Currency
- Total
- Issue date
- Expiry date
- Owner
- Actions

### Acceptance criteria

- Quotes list loads.
- Create action opens new quote page.
- Row opens quote detail.
- Delete/restore follows existing patterns.

## Task 4.2 — Build Quote create/edit form

### Routes

```text
/dashboard/sales/quotes/new
/dashboard/sales/quotes/[quoteId]/edit
```

### Required fields

- Quote number
- Title
- Customer name
- Contact
- Organization/account
- Deal/opportunity, if supported
- Status
- Currency
- Subtotal
- Discount
- Tax
- Total
- Issue date
- Expiry date
- Notes
- Assigned user
- Custom fields, if supported

### Acceptance criteria

- Can create quote.
- Can edit quote.
- Can link quote to contact/account/deal where backend supports it.
- Totals are displayed consistently.
- Disabled fields are not submitted.

## Task 4.3 — Build Quote detail page

### Route

```text
/dashboard/sales/quotes/[quoteId]
```

### Requirements

Show:

- Quote number
- Title
- Customer
- Account/contact links
- Deal link if available
- Status
- Currency
- Subtotal
- Discount
- Tax
- Total
- Issue date
- Expiry date
- Notes
- Activity timeline
- Actions: edit, delete, export/PDF placeholder

### Acceptance criteria

- Quote detail loads by id.
- Linked CRM records navigate correctly.
- Quote summary endpoint is used if it exists and is useful.
- No invoice/payment functionality is added in this phase.

---

# Phase 5 — Activities, tasks, notes, and timeline

## Goal

Every CRM record should show what happened, what is due, and who owns the next action.

## Task 5.1 — Create shared CRM record activity section

### Target records

- Lead
- Account / Organization
- Contact
- Deal / Opportunity
- Quote

### Requirements

A shared component should show:

- Activity log / CRM events
- Comments or notes
- Tasks/follow-ups
- Last-contacted information where supported

### Acceptance criteria

- Shared activity component can be embedded in all CRM detail pages.
- It respects tenant and permission behavior through existing APIs.
- Empty state is useful.
- Loading and error states are handled.

## Task 5.2 — Add task/follow-up creation from CRM records

### Requirements

From each CRM detail page, users should be able to create:

- Task
- Follow-up
- Call reminder
- Meeting reminder, if calendar support exists

Fields:

- Title
- Description
- Due date
- Assigned user
- Related module
- Related record id
- Priority, if supported
- Status

### Acceptance criteria

- Task/follow-up created from a CRM record links back to that record.
- Due tasks are visible from the record detail page.
- Completed tasks can be marked complete if backend supports it.

---

# Phase 6 — Communication workflow

## Goal

Make CRM communication usable without building a full email client or unsupported WhatsApp automation.

## Task 6.1 — Standardize communication actions

### Target records

- Lead
- Contact
- Account primary contact, if available
- Deal linked contact

### Requirements

Add or verify actions for:

- Email
- WhatsApp click-to-chat
- Copy email
- Copy phone
- Apply message template
- Log communication/follow-up

### Acceptance criteria

- Email action uses available mail/template functionality or opens a safe mail action.
- WhatsApp action opens chat/template but does not attempt unsupported automatic sending.
- Last-contacted fields update only through existing supported backend workflows.
- Opt-out flags are respected for email.

## Task 6.2 — Message templates polish

### Requirements

Templates should support CRM use cases:

- Lead intro
- Follow-up
- Meeting request
- Quote follow-up
- Deal negotiation
- Support handoff

### Acceptance criteria

- Templates are accessible from relevant CRM actions.
- Template variables are documented or shown in UI.
- Missing variables fail gracefully.

---

# Phase 7 — CRM reports and dashboard

## Goal

Build CRM reports only. Do not include ERP/Finance reports yet.

## Task 7.1 — CRM dashboard widgets

### Route

```text
/dashboard
```

or

```text
/dashboard/reports
```

Use the existing app navigation pattern.

### Required widgets

- Leads by status
- Leads by source
- New leads this period
- Deals by stage
- Pipeline value
- Won/lost deals
- Quotes by status
- Overdue follow-ups
- Upcoming tasks
- Owner performance summary

### Acceptance criteria

- Dashboard loads without heavy queries.
- Widgets show empty states.
- Date filtering exists or is planned cleanly.
- Permissions are respected.

## Task 7.2 — CRM reports page

### Route

```text
/dashboard/reports
```

### Required reports

- Lead funnel report
- Deal pipeline report
- Activity/follow-up report
- Quote report
- Owner performance report

### Acceptance criteria

- Reports use existing module reports backend if available.
- Reports can be filtered by date range and owner where feasible.
- No ERP/Finance reports are added yet.

---

# Phase 8 — CRM settings polish

## Goal

Make CRM administration stable enough for real users.

## Task 8.1 — CRM module settings validation

### Modules to validate

- Leads
- Accounts / Organizations
- Contacts
- Deals / Opportunities
- Quotes
- Tasks
- Message templates
- Reports

### Requirements

Verify settings for:

- Module visibility
- Module permissions
- Field configuration
- Import/export permissions
- Duplicate handling where supported
- Recycle bin access

### Acceptance criteria

- Admin can enable/disable CRM modules if existing module settings support it.
- Role permissions work for view/create/edit/delete/export/restore.
- Disabled fields do not appear in list/form where existing field config supports it.

## Task 8.2 — Sidebar and stale route cleanup

### Requirements

- Sidebar should show only valid CRM routes.
- Remove stale links to deleted or non-existent pages.
- Keep ERP routes hidden or disabled until ERP phase.
- Sales group should include Leads, Accounts, Contacts, Deals, Quotes.

### Acceptance criteria

- No sidebar link opens a 404 page.
- Sales sidebar expands/collapses correctly.
- Navigating from one Sales module to another works.
- Settings links point to current settings pages only.

---

# Phase 9 — CRM end-to-end QA

## Goal

Verify the full CRM lifecycle works as one product.

## Task 9.1 — Manual lifecycle test

### Test flow

1. Create lead.
2. Log follow-up on lead.
3. Convert lead into account and contact.
4. Create deal from converted lead.
5. Move deal through pipeline stages.
6. Create quote linked to deal/account/contact.
7. Log communication on quote/deal.
8. Mark deal closed won or closed lost.
9. Confirm records appear in reports.
10. Confirm activity appears on related record timelines.

### Acceptance criteria

- No broken navigation.
- No cross-tenant data exposure.
- Permissions work as expected.
- Activity logs are created for key actions.
- Record relationships are visible.
- Recycle/restore works for CRM records that support it.

## Task 9.2 — Automated tests where practical

### Backend tests

Cover:

- Lead CRUD
- Lead conversion
- Account/contact/deal relationship integrity
- Quote CRUD
- Permission checks
- Tenant isolation

### Frontend tests

Cover:

- Main CRM pages render
- Create/edit forms submit
- Important empty/error states
- Lead conversion dialog behavior

### Acceptance criteria

- Existing test suite passes.
- New critical backend tests pass.
- Frontend lint/typecheck passes.

---

# Recommended implementation order

```text
1. Phase 0 — Audit
2. Phase 1 — Leads module
3. Phase 2 — Lead conversion
4. Phase 3 — Accounts/Contacts/Deals polish
5. Phase 4 — Quotes module
6. Phase 5 — Activities/tasks/timeline
7. Phase 6 — Communication workflow
8. Phase 7 — CRM reports/dashboard
9. Phase 8 — CRM settings/sidebar polish
10. Phase 9 — End-to-end QA
```

# Non-goals until CRM is complete

Do not implement or expand these during CRM completion:

- Product catalog UI
- Services catalog UI
- Inventory
- Warehouses
- Purchase orders
- Supplier management
- POS invoice UI expansion
- Insertion order expansion
- Payments
- Accounting
- Payroll
- Procurement

Existing backend/frontend pieces for these areas may remain, but Codex should not prioritize them until the CRM lifecycle is complete.

# Final CRM completion definition

The CRM phase is complete when this full workflow works cleanly:

```text
Lead → Convert to Account + Contact → Create Deal → Create Quote → Close Deal → Report on result
```

Every major CRM record should support:

- list
- create
- detail
- edit
- delete/restore where supported
- search/filter
- owner assignment
- related records
- notes/comments
- tasks/follow-ups
- activity timeline
- communication actions where applicable
- permissions
- field config where supported
