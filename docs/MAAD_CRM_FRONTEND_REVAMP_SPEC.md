# MAAD CRM Frontend Revamp Specification

**Purpose:** Implementation blueprint for Codex to refactor the existing MAAD CRM frontend into a consistent, modern, accessible, responsive, and production-grade application.

**Primary goal:** Replace the current collection of loosely connected panels, modals, tables, and configuration screens with a unified product experience built around reusable page templates, clear information hierarchy, predictable workflows, robust application states, and a consistent design system.

---

# 1. Product Direction

The CRM should feel like a modern operational product rather than a set of independent admin screens.

Target characteristics:

- Dark, high-contrast interface with restrained use of borders.
- Strong content hierarchy using typography, spacing, and layered surfaces.
- Consistent page composition across Sales, Finance, Support, Settings, and custom modules.
- Full-page workflows for complex record creation and editing.
- Fast list views with powerful filtering, saved views, bulk actions, and clear empty states.
- Detail pages that combine summary, activity, related records, and actions without becoming visually overwhelming.
- Configuration pages that separate setup, status, and technical diagnostics.
- Responsive behavior that preserves usability on laptop, tablet, and mobile widths.
- Accessible controls, meaningful focus states, keyboard navigation, and semantic structure.

Reference direction:

- Linear for layout clarity and compact interaction patterns.
- Attio for CRM record pages and data-oriented workflows.
- Stripe Dashboard for settings and system status presentation.
- Vercel for restrained dark surfaces and typography.
- GitHub settings for complex configuration and permissions.

Do not imitate any one product directly. Use these references only for interaction quality and hierarchy.

---

# 2. Refactor Strategy

Do not redesign every route independently.

Refactor in this order:

1. Design tokens.
2. App shell.
3. Shared primitives.
4. Shared compound components.
5. Page templates.
6. Core CRM workflows.
7. Settings and administration workflows.
8. Dashboard widgets.
9. Module builder and field configuration.
10. Responsive and accessibility pass.

Every existing screen must be mapped to one of the page templates defined below.

---

# 3. Design Tokens

Use CSS variables or a central theme object. Do not hardcode color, spacing, radius, shadow, or typography values inside page components.

## 3.1 Color system

```css
:root {
  --color-bg-app: #0b0d10;
  --color-bg-sidebar: #0e1116;
  --color-bg-surface: #12161c;
  --color-bg-surface-muted: #171c23;
  --color-bg-surface-raised: #1d232c;
  --color-bg-overlay: rgba(5, 7, 10, 0.72);

  --color-border-subtle: #20262f;
  --color-border-default: #2a313c;
  --color-border-strong: #3a4350;

  --color-text-primary: #f4f7fb;
  --color-text-secondary: #b7c0cc;
  --color-text-muted: #7f8a99;
  --color-text-disabled: #59616d;

  --color-primary: #6c7cff;
  --color-primary-hover: #7e8bff;
  --color-primary-active: #5b6beb;
  --color-primary-muted: rgba(108, 124, 255, 0.14);

  --color-success: #2fcf80;
  --color-success-muted: rgba(47, 207, 128, 0.14);
  --color-warning: #f4b740;
  --color-warning-muted: rgba(244, 183, 64, 0.14);
  --color-danger: #ef6461;
  --color-danger-muted: rgba(239, 100, 97, 0.14);
  --color-info: #4ca7ff;
  --color-info-muted: rgba(76, 167, 255, 0.14);
}
```

Rules:

- App background, sidebar, cards, nested cards, and input surfaces must be visually distinct.
- Use the primary color only for primary actions, selected states, links, focus rings, and key chart data.
- Do not use white buttons as the default primary action.
- Use semantic colors only for status and feedback.
- Destructive buttons must not visually compete with primary actions unless confirmation is required.

## 3.2 Typography

Preferred stack:

```css
font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Scale:

```text
Display / dashboard headline: 28px / 36px / 700
Page title:                  22px / 30px / 650
Section title:               16px / 24px / 650
Card title:                  14px / 20px / 650
Body:                        14px / 21px / 400
Body strong:                 14px / 21px / 600
Table:                       13px / 20px / 400
Label:                       12px / 18px / 600
Metadata:                    12px / 18px / 400
Caption:                     11px / 16px / 400
```

Rules:

- Do not use text below 11px.
- Page titles must always be visually stronger than breadcrumbs and toolbar actions.
- Metadata must remain readable and never use extremely low contrast.

## 3.3 Spacing scale

```text
4, 8, 12, 16, 20, 24, 32, 40, 48, 64
```

Primary usage:

- 4px: icon-label gap or very tight internal spacing.
- 8px: button contents, badge contents, inline controls.
- 12px: related field elements and table cell content.
- 16px: standard field gap.
- 20px: compact card padding.
- 24px: default card padding.
- 32px: section separation.
- 40px+: major layout regions.

## 3.4 Radius

```text
Small controls: 6px
Inputs/buttons: 8px
Cards: 10px
Large panels: 12px
Dialogs/drawers: 14px
```

Do not use a different radius on each page.

## 3.5 Shadows

Use shadows only for raised overlays, drawers, modals, and floating menus.

Cards should primarily use surface contrast and borders rather than heavy shadows.

---

# 4. App Shell

## 4.1 Desktop structure

```text
Sidebar: 240px expanded, 72px collapsed
Top bar: 64px
Main content padding: 24px to 32px
Content max width: 1600px
```

Layout:

```text
┌──────────────┬───────────────────────────────────────────────┐
│ Sidebar      │ Top bar                                       │
│              ├───────────────────────────────────────────────┤
│              │ Main content                                  │
│              │                                               │
└──────────────┴───────────────────────────────────────────────┘
```

## 4.2 Sidebar

Requirements:

- Group navigation into product areas.
- Only one major group should be expanded at a time.
- Use icons consistently.
- Highlight active route with primary-muted background, primary text/icon, and a subtle left indicator.
- Support collapsed mode with tooltips.
- Keep user/profile and notification actions anchored at the bottom.
- Avoid showing all settings children simultaneously when settings is not active.

Recommended groups:

```text
Sales
  Leads
  Contacts
  Accounts
  Opportunities
  Quotes
  Orders

Finance
  Invoices
  Payments
  Expenses
  POS

Products & Services
  Products
  Services
  Catalog

Support
  Cases
  Knowledge Base

Workspace
  Calendar
  Tasks
  Mail
  Documents

Reports

Settings
```

Custom module groups must use the same structure and interaction model.

## 4.3 Top bar

Contains:

- Breadcrumbs on the left.
- Global search centered or right-aligned depending on width.
- Optional quick-create button.
- Notifications.
- User menu.

Global search should open a command palette, not behave like a plain text input.

Command palette supports:

- Search records.
- Navigate to modules.
- Create records.
- Open recent pages.
- Keyboard shortcut display.

---

# 5. Shared Components

Implement these as reusable components before page-specific work.

## 5.1 Buttons

Variants:

- `primary`
- `secondary`
- `ghost`
- `danger`
- `dangerGhost`
- `link`

Sizes:

- `sm`: 32px height
- `md`: 38px height
- `lg`: 44px height

Rules:

- One visually dominant primary action per page section.
- Secondary actions use neutral surfaces.
- Destructive actions are separated from routine actions.
- Icon-only buttons require tooltip and accessible label.
- Loading buttons preserve width and show spinner plus action text when space allows.

## 5.2 Inputs

Support:

- text
- email
- phone
- number
- currency
- URL
- date
- datetime
- textarea
- select
- multi-select
- combobox
- tags
- user picker
- team picker
- relation picker
- rich text

Every form control must support:

- label
- description/help text
- optional/required indicator
- error state
- disabled state
- read-only state
- loading state where remote options are used

Do not rely on placeholder text as the only label.

## 5.3 Cards

Variants:

- `surface`
- `muted`
- `raised`
- `interactive`
- `status`

Default card anatomy:

```text
Card header
  title
  description
  optional action
Card body
Optional footer
```

Nested cards must use a different background or border treatment than parent cards.

## 5.4 Status badges

Variants:

- neutral
- info
- success
- warning
- danger

Badges must always include text, not color alone.

## 5.5 Tabs

Use tabs for sibling views of the same resource.

Good uses:

- Overview / Activity / Related records.
- Users / Authentication / Domains / Provisioning.
- Module General / Fields / Permissions / Automation.

Do not use tabs for unrelated navigation categories.

## 5.6 Drawer

Use drawers for:

- record preview
- filters
- technical details
- quick edit
- related record selection
- activity details

Drawers must not replace full pages for complex editing.

## 5.7 Modal

Use modals only for compact tasks:

- confirmation
- rename
- assign owner
- change status
- add tag
- create team
- quick note

Do not use a modal for forms with more than 5 to 7 fields, multiple sections, related records, or significant validation.

## 5.8 Empty state

Every empty state contains:

- concise title
- explanation
- primary next action
- optional secondary action
- optional illustration or icon

Example:

```text
No leads yet
Create your first lead or import existing records from CSV.
[Create lead] [Import CSV]
```

Do not leave a large empty table with only “No records found”.

## 5.9 Loading states

Use skeletons matching final geometry.

Avoid page-wide centered spinners except during initial application boot.

Required loading patterns:

- Page skeleton.
- Table skeleton rows.
- Card skeleton.
- Button loading state.
- Inline field loading for async options.
- Progressive dashboard widget loading.

## 5.10 Error states

Error handling levels:

1. Field validation error.
2. Inline section error.
3. Page-level recoverable error.
4. Fatal route error.
5. Background sync error.

Page-level error format:

```text
Unable to load leads
The request failed before this page could be loaded.
[Try again] [Return to dashboard]
```

Do not show raw stack traces or backend responses to users.

Technical details may appear inside an expandable disclosure visible only to authorized users.

## 5.11 Toasts

Use toasts for transient outcomes:

- saved
- deleted
- copied
- import started
- background task completed

Do not use toasts for errors requiring user action. Those belong inline.

---

# 6. Standard Page Templates

Every page must use one of these templates.

## 6.1 List page

Used for leads, contacts, accounts, opportunities, quotes, orders, invoices, payments, cases, tasks, users, and custom modules.

Structure:

```text
Page header
  title and description
  saved view selector
  secondary actions
  primary create action

Unified toolbar
  search
  quick filters
  filter drawer button
  sort
  columns
  export
  bulk actions when rows selected

Data table or alternate view

Pagination / result count
```

Requirements:

- Header actions must align in one row on desktop.
- Search and filters belong in one toolbar, not separate unrelated blocks.
- Table header remains sticky for long lists.
- First identifying column remains sticky when horizontal scrolling is needed.
- Selected rows reveal a bulk action toolbar.
- Empty results from filters differ from a completely empty dataset.

Dataset empty state:

```text
No contacts yet
Create a contact or import contacts from CSV.
```

Filtered empty state:

```text
No contacts match these filters
Clear one or more filters and try again.
[Clear filters]
```

## 6.2 Create record page

Used for lead, contact, account, opportunity, quote, order, invoice, case, custom module record, and other complex record creation.

Routes:

```text
/dashboard/sales/leads/new
/dashboard/sales/contacts/new
/dashboard/sales/opportunities/new
```

Structure:

```text
Back link
Page header
  title
  description
  cancel
  save draft, when supported
  create

Main grid
  primary form column
  contextual sidebar

Sticky footer
  unsaved state
  cancel
  save draft
  create
```

Desktop grid:

```text
Primary column: minmax(0, 2fr)
Sidebar: 320px to 380px
Gap: 24px
```

Main form sections:

- Basic information.
- Contact information.
- Classification or pipeline information.
- Address.
- Notes.
- Custom fields.

Sidebar sections:

- Assignment.
- Status.
- Tags.
- Visibility.
- Follow-up.
- Automation options.

Rules:

- Group fields semantically, not by backend schema order.
- Use two columns for short fields.
- Use full width for notes, long text, addresses, and relationship selectors.
- Inline validation should occur after blur or submit, not on every keystroke.
- Keep user-entered values after failed submission.
- Scroll to and focus the first invalid field.
- Show a summary of validation errors at the top only when there are errors across multiple sections.

## 6.3 Record detail page

Used for lead, contact, account, opportunity, quote, invoice, order, case, user, and custom module records.

Structure:

```text
Record header
  record name
  type and identifiers
  status
  owner
  primary actions
  more menu

Optional stage or progress bar

Tabs
  Overview
  Activity
  Related records
  Files
  Notes
  Audit history

Selected tab content
```

Overview layout:

```text
Main column
  summary card
  key details
  related opportunities or transactions

Right column
  next action
  ownership
  tags
  recent activity
```

Rules:

- Do not show every field at once.
- Prioritize key fields in a summary card.
- Put secondary or custom fields in collapsible groups.
- Activity timeline should be chronological and filterable.
- Editing may use inline edit for simple fields and a full edit page for larger changes.

## 6.4 Edit record page

Reuse the create page template.

Differences:

- Title changes to “Edit …”.
- Existing values are prefilled.
- Include last modified metadata.
- Destructive actions belong in a separate danger zone or more menu.
- Warn before leaving with unsaved changes.

## 6.5 Settings page

Structure:

```text
Settings header
Settings category navigation
Selected settings content
Optional status sidebar or footer actions
```

Use either:

- sidebar category navigation for many settings, or
- tabs for 3 to 5 closely related settings.

Do not combine unrelated setup areas on one page.

## 6.6 Builder page

Used for module builder, form builder, automation builder, report builder, and dashboard editing.

Structure:

```text
Left navigator
  entities or components
Main canvas/editor
Right inspector
  properties and settings
```

Do not stack all entities and fields vertically on one page.

## 6.7 Dashboard page

Structure:

```text
Dashboard header
  title
  date range
  refresh
  edit mode

KPI grid
Primary charts
Operational widgets
Activity and system status
```

Widget controls appear only in edit mode or on hover for users with permission.

---

# 7. Core CRM Workflows

## 7.1 Leads

### Leads list

Columns by default:

- Name.
- Company.
- Status.
- Source.
- Owner.
- Last activity.
- Created date.

Toolbar filters:

- Status.
- Owner.
- Source.
- Created date.
- Has activity.

Primary action: `Create lead`.

Secondary actions:

- Import CSV.
- Export.
- Manage view.

### Create lead

Sections:

1. Basic information.
2. Contact details.
3. Lead qualification.
4. Notes.
5. Custom fields.

Sidebar:

- Owner.
- Team.
- Status.
- Source.
- Tags.
- Next follow-up date.

### Lead detail

Header actions:

- Convert.
- Add activity.
- Edit.
- More.

Tabs:

- Overview.
- Activity.
- Related records.
- Notes.
- Files.
- Audit history.

Conversion must use a guided flow that confirms the target contact/account/opportunity and does not rely on a destructive modal.

## 7.2 Contacts

### Contacts list

Default columns:

- Contact.
- Account.
- Email.
- Phone.
- Owner.
- Last activity.
- Status.

### Contact detail

Header:

- Name.
- Account.
- Title.
- Email/phone shortcuts.
- Owner.

Overview cards:

- Contact information.
- Account information.
- Open opportunities.
- Recent communications.
- Upcoming tasks.

## 7.3 Accounts

Overview must show:

- Account summary.
- Primary contacts.
- Opportunities.
- Quotes/orders/invoices.
- Activity timeline.
- Documents.

## 7.4 Opportunities / Deals

List supports table and kanban views.

Kanban requirements:

- Columns represent stages.
- Cards show name, account, value, close date, owner.
- Drag-and-drop stage changes require optimistic update with rollback on failure.
- Large deals or overdue deals receive subtle indicators.

Detail page includes:

- Stage progress bar.
- Value.
- Probability.
- Expected close date.
- Related contacts.
- Quotes.
- Activity.

## 7.5 Quotes, Orders, and Invoices

Creation should use a dedicated multi-section page.

Sections:

1. Customer and billing details.
2. Line items.
3. Pricing, discounts, and taxes.
4. Terms and notes.
5. Delivery or payment details.
6. Review summary.

Line items use an editable table with keyboard navigation.

Summary card remains sticky on desktop:

- subtotal
- discount
- tax
- total

Do not use a modal for quote, order, or invoice creation.

## 7.6 Tasks

Support:

- list view
- board view
- calendar view

Task detail can use a drawer for quick review and a full page for complex editing.

## 7.7 Support cases

Case detail page prioritizes:

- status
- priority
- requester
- assignee
- SLA information
- conversation thread
- related records

---

# 8. Settings and Administration

## 8.1 Settings information architecture

```text
Workspace
  General
  Teams
  Users
  Customer groups

Access & Security
  Permissions
  Authentication
  Domains
  SSO
  MFA

Customization
  Modules
  Fields
  Views
  Layouts

Automation & Integrations
  Automation
  Booking links
  Integrations

Data & System
  Imports
  Exports
  Backups
  Audit log
```

## 8.2 User management

Split into tabs:

- Users.
- Authentication.
- Domains.
- Provisioning.

### Users tab

Contains:

- Search.
- Filters.
- Add user.
- Bulk status/role actions.
- User table.

### Authentication tab

Contains:

- MFA policy.
- Password policy.
- SSO configuration.
- Test connection.
- Last successful test.
- Last failed test.

Do not show raw provider errors in the main form.

Use:

```text
Connection failed
The identity provider rejected the request because the configured issuer could not be verified.
[Retry] [View technical details]
```

### Domains tab

Show each domain as a status card:

- domain
- verification status
- DNS record type
- expected value
- last checked
- actions

### Provisioning tab

Contains:

- auto-provisioning toggle
- default role
- default team
- group mapping
- claim mapping

## 8.3 Permissions

Layout:

```text
Role list on left
Permission matrix on right
Sticky save bar at bottom
```

Requirements:

- Sticky matrix header.
- Sticky module name column.
- Group modules by product area.
- Row select-all.
- Column select-all.
- Preset permission levels where possible.
- Unsaved changes indicator.
- Search modules.

## 8.4 Field configuration

Layout:

```text
Field list
  search
  filters
  field rows

Selected field inspector or create field panel
```

Filters:

- All.
- System.
- Custom.
- Required.
- Disabled.

Field row shows:

- label
- key
- type
- status badges
- enabled toggle
- more menu

Protected fields must be clearly labeled and disabled actions must explain why.

## 8.5 Module builder

Replace the current stacked layout with:

```text
Left: module list
Center: selected module editor
Right: selected field inspector
```

Module editor tabs:

- General.
- Fields.
- Layout.
- Permissions.
- Automation.

Field management:

- Drag handle for ordering.
- Compact rows.
- Select a row to edit in the inspector.
- Add field opens inline inspector or dedicated subpage.
- Save at module level, not repetitive save buttons on every row.

## 8.6 View manager

Use a three-column layout where space allows:

```text
Available fields
Selected fields
View preview / filters
```

Support drag-and-drop ordering.

Do not place the column selector inside a large mostly empty card.

## 8.7 Integrations

Each integration uses a card with:

- logo/icon
- connection state
- account
- last sync
- primary action
- secondary actions

Errors use user-readable summaries with optional technical details.

## 8.8 Calendar integrations

Main calendar page must not display raw sync logs.

Use status cards:

```text
Google Calendar
Connected
Last sync: 4 minutes ago
[Sync now] [Manage]
```

Failure:

```text
Google Calendar sync failed
The authorization token expired.
[Reconnect] [View technical details]
```

---

# 9. Dashboard Redesign

## 9.1 Dashboard hierarchy

### Row 1: KPI cards

Recommended cards:

- Pipeline value.
- Revenue this month.
- New leads.
- Open tasks.

KPI card anatomy:

- label
- current value
- trend
- comparison period
- optional sparkline

### Row 2: Primary analysis

- Pipeline chart.
- Revenue trend.

### Row 3: Operations

- Upcoming tasks.
- Recent activity.
- Follow-ups.

### Row 4: Secondary

- Module shortcuts.
- Integration health.
- Notifications.

## 9.2 Widget behavior

- Hide edit controls outside edit mode.
- Allow reorder and resize only in edit mode.
- Empty widgets collapse to a compact state.
- Failed widgets show a retry action.
- Widgets load independently.
- Long logs never appear as dashboard content.

## 9.3 Responsive grid

Desktop:

```text
12-column grid
24px gap
```

Tablet:

```text
8-column grid
16px gap
```

Mobile:

```text
1-column stack
12px to 16px gap
```

---

# 10. Data Tables

## 10.1 Table anatomy

- Toolbar.
- Header.
- Body.
- Empty or loading state.
- Footer/pagination.

## 10.2 Behavior

- Sticky header.
- Sort indicators.
- Row hover.
- Keyboard focus.
- Checkbox selection.
- Row actions in kebab menu.
- Clicking the primary identifier opens the record.
- Do not make every cell clickable.
- Long text truncates with tooltip.
- Dates use relative display where helpful, with exact date in tooltip.
- Currency and numbers align right.

## 10.3 Density

Support comfortable and compact density preferences.

Default row height: 48px.

Compact row height: 40px.

## 10.4 Pagination

Prefer cursor or page pagination depending on backend.

Display:

- current range
- total if known
- page size
- previous/next

Avoid tiny pagination controls.

---

# 11. Forms

## 11.1 Layout rules

- Use a 12-column grid.
- Two-column form layout on desktop.
- One-column on mobile.
- Full-width fields for long content.
- Related fields should be visually adjacent.

## 11.2 Section behavior

- Sections use clear headings and short descriptions.
- Avoid wrapping every field in its own card.
- Use one card per meaningful section.
- Optional advanced fields may use disclosure panels.

## 11.3 Validation

- Required indicators visible before submission.
- Validate on blur and submit.
- Server errors map to fields when possible.
- Preserve entered values.
- Focus first invalid field.
- Use plain language.

Bad:

```text
Invalid payload: field_error
```

Good:

```text
Enter a valid email address.
```

## 11.4 Unsaved changes

- Show sticky footer when dirty.
- Warn on navigation away.
- Allow save draft where business logic supports it.

---

# 12. Application States

Every page and major component must implement the following states explicitly.

## 12.1 Initial loading

- Skeleton matching page structure.
- No layout shift after load.

## 12.2 Refreshing

- Preserve existing data.
- Show subtle progress indicator.
- Do not replace entire page with spinner.

## 12.3 Empty dataset

- Explain what the feature is.
- Provide a create/import action.

## 12.4 Empty filtered result

- Mention active filters.
- Provide clear filters action.

## 12.5 Permission denied

```text
You do not have permission to view this page
Ask an administrator for the required access.
[Return to dashboard]
```

## 12.6 Not found

```text
Record not found
It may have been deleted or you may not have access.
[Back to list]
```

## 12.7 Recoverable error

- Explain the failed operation.
- Provide retry.
- Keep surrounding navigation available.

## 12.8 Background job state

Use status banners or cards for imports, exports, reports, and sync jobs.

States:

- queued
- running
- completed
- completed with warnings
- failed

---

# 13. Responsive Behavior

## 13.1 Breakpoints

```text
sm: 640px
md: 768px
lg: 1024px
xl: 1280px
2xl: 1536px
```

## 13.2 Desktop

- Full sidebar.
- Multi-column forms.
- Sticky contextual sidebar.
- Full tables.

## 13.3 Tablet

- Collapsible sidebar.
- Form sidebar moves below main content or becomes a drawer.
- Tables may horizontally scroll.
- Toolbars wrap into two rows.

## 13.4 Mobile

- Sidebar becomes a navigation drawer.
- Page header actions collapse into primary button plus overflow menu.
- Forms become single column.
- Sticky footer actions remain accessible.
- Tables convert to card lists only where a card representation remains understandable; otherwise preserve horizontal scroll.
- Avoid hiding critical columns without an alternate access path.

---

# 14. Accessibility

Minimum target: WCAG 2.2 AA.

Requirements:

- Visible keyboard focus.
- Logical tab order.
- Semantic headings.
- Labels associated with inputs.
- Accessible descriptions for errors.
- Buttons use buttons, links use links.
- Tooltips are not required to understand core content.
- Icon-only controls have accessible names.
- Color contrast meets AA.
- Status is not conveyed by color alone.
- Reduced-motion preference respected.
- Drag-and-drop actions have keyboard alternatives.
- Tables use correct header associations.
- Modals trap focus and restore focus on close.

---

# 15. Frontend Architecture

## 15.1 Suggested folder structure

```text
frontend/
  app/
    dashboard/
      layout.tsx
      sales/
      finance/
      support/
      settings/
  components/
    ui/
      button.tsx
      input.tsx
      select.tsx
      card.tsx
      badge.tsx
      dialog.tsx
      drawer.tsx
      tabs.tsx
      table.tsx
      skeleton.tsx
      empty-state.tsx
      error-state.tsx
    layout/
      app-shell.tsx
      sidebar.tsx
      topbar.tsx
      page-header.tsx
      content-grid.tsx
      sticky-action-bar.tsx
    data/
      data-table.tsx
      data-toolbar.tsx
      filter-builder.tsx
      view-selector.tsx
    forms/
      form-section.tsx
      form-grid.tsx
      async-combobox.tsx
      relation-picker.tsx
    records/
      record-header.tsx
      activity-timeline.tsx
      related-records.tsx
      record-summary.tsx
  features/
    leads/
    contacts/
    accounts/
    opportunities/
    quotes/
    invoices/
    settings/
  lib/
    api/
    validation/
    permissions/
    formatting/
    design-tokens/
```

## 15.2 Component rules

- Page components compose reusable components.
- Avoid page-specific duplicated form controls.
- Avoid one-off spacing values.
- Do not place API calls directly in primitive UI components.
- Keep permission logic centralized.
- Separate data loading from visual components where practical.
- Use schema-driven field rendering for custom modules while retaining layout metadata.

## 15.3 State management

Use:

- server state library for API cache and mutations.
- local component state for visual controls.
- form library for forms and validation.
- URL state for filters, saved views, sorting, pagination, and selected tabs where deep linking is useful.

Rules:

- List state should survive refresh where possible.
- Filters should be shareable through URL parameters.
- Use optimistic updates only for reversible actions with reliable rollback.

---

# 16. Motion and Interaction

Use restrained motion.

Recommended durations:

```text
Micro interaction: 120ms
Menu/drawer: 160ms to 220ms
Page transition: 180ms to 240ms
```

Rules:

- No decorative bouncing or large animation.
- Skeleton shimmer may be subtle.
- Drawers slide.
- Menus fade and scale slightly.
- Respect reduced motion.

---

# 17. Copy and Content Guidelines

Use clear action labels.

Good:

- Create lead.
- Save changes.
- Test connection.
- Reconnect calendar.
- Clear filters.

Avoid:

- Submit.
- Execute.
- Process.
- Confirm action.

Descriptions should explain outcomes, not implementation.

Bad:

```text
This modifies the runtime module configuration.
```

Good:

```text
Choose which fields appear when users create and edit this module.
```

---

# 18. Page-by-Page Migration Priority

## Phase 1: Foundation

- Tokens.
- App shell.
- Buttons.
- Inputs.
- Cards.
- Page header.
- Empty, loading, and error states.
- Data table.

## Phase 2: Core CRM workflow

- Leads list.
- Create lead.
- Lead detail.
- Edit lead.
- Contacts list and detail.
- Accounts list and detail.
- Opportunities table and kanban.

## Phase 3: Transactions

- Quotes.
- Orders.
- Invoices.
- Payments.

## Phase 4: Administration

- Users.
- Authentication.
- Domains.
- Permissions.
- Field config.
- View manager.

## Phase 5: Builders

- Module builder.
- Automation builder.
- Dashboard edit mode.

## Phase 6: Secondary modules

- Calendar.
- Tasks.
- Support.
- Reports.
- Integrations.

---

# 19. Acceptance Criteria

The refactor is complete only when all of the following are true.

## Visual consistency

- All pages use shared tokens.
- No route has custom ad hoc button, input, card, or table styling without documented reason.
- Page headers follow one pattern.
- Cards have consistent padding and hierarchy.

## Workflow consistency

- Complex record creation uses full pages.
- Create and edit pages share the same layout.
- Detail pages use standard tabs and summary structure.
- Destructive actions are separated and confirmed.

## States

- Every route has loading, empty, error, not-found, and permission-denied handling where applicable.
- Filtered empty states differ from dataset empty states.
- Technical errors are never shown raw to standard users.

## Accessibility

- Full keyboard navigation works.
- Focus states are visible.
- Forms are labeled and errors announced.
- Contrast meets AA.

## Responsive behavior

- No page requires a desktop viewport to complete a core task.
- Create/edit forms work on mobile.
- Tables remain usable on tablet and mobile.
- Sticky actions remain reachable.

## Performance

- Route transitions do not block on unrelated data.
- Dashboard widgets load independently.
- Lists use pagination or virtualization where needed.
- Skeletons prevent large layout shifts.

---

# 20. Codex Implementation Instructions

Codex should follow this sequence for each page:

1. Identify the correct page template.
2. Replace page-specific layout wrappers with shared layout components.
3. Replace custom controls with shared primitives.
4. Add explicit loading, empty, error, and permission states.
5. Add responsive behavior.
6. Add keyboard and accessibility behavior.
7. Preserve existing API contracts unless a backend change is explicitly required.
8. Preserve tenant scoping and permission checks.
9. Preserve existing business behavior before adding visual improvements.
10. Add or update tests for critical interactions.

For each migrated route, Codex should produce:

- updated component code
- any new shared component required
- route-level loading and error UI
- responsive behavior
- accessibility checks
- unit or integration tests
- a short migration note listing removed legacy components

Codex must not:

- redesign backend data models during visual refactoring
- expose secrets or raw technical errors
- add one-off colors or spacing values
- create large forms in modals
- duplicate component logic across modules
- remove permissions or tenant checks
- silently change business workflows

---

# 21. First Reference Implementation

Build the following complete workflow first:

```text
Leads list
  -> Create lead page
  -> Lead detail page
  -> Edit lead page
  -> Convert lead flow
```

Use this implementation as the canonical reference for:

- contacts
- accounts
- opportunities
- custom module records

The Leads workflow should establish:

- app shell behavior
- page header
- list toolbar
- data table
- empty/loading/error states
- create/edit form layout
- detail page tabs
- activity timeline
- permission behavior
- responsive behavior

Do not begin broad page-by-page migration until the Leads reference workflow is reviewed and approved.

---

# 22. Final Design Principle

The interface should always answer three questions immediately:

1. Where am I?
2. What is the most important information here?
3. What is the next action I can take?

Every layout, card, action, and state should support those three questions.
