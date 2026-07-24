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

### Phase 1 completion record

Status: **Implemented**.

- Design tokens: shared color, surface, border, radius, shadow, typography, and reduced-motion tokens are defined centrally and consumed by the foundation primitives.
- App shell: the desktop sidebar supports persisted collapse, the mobile shell uses a focus-trapped navigation drawer, and the top bar exposes search, notifications, profile, breadcrumbs, and explicit access-denied feedback.
- Command palette: module and settings navigation come from the canonical registries, while routed and deep-linked create, edit, upload, compose, configure, and scheduling shortcuts declare and enforce their corresponding action permission. Admin-only module actions and dependent entries additionally require verified administrator identity. Recent Pages tracks actual successful dashboard route visits, excludes the current or unauthorized route, ignores transient action parameters, and stores the six latest destinations under the authenticated user's local key.
- Shared controls: buttons, inputs, cards, page headers, dialogs, tabs, required marks, pagination, list toolbars, and saved-view controls use the shared token language.
- Application states: reusable loading, recoverable-error, not-found, permission-denied, dataset-empty, and filtered-empty states are available. Dashboard and core CRM route boundaries preserve navigation and avoid exposing raw technical errors.
- Data tables: shared tables provide semantic headers, keyboard-operable sorting, visible focus, responsive overflow, sticky headers, and persisted comfortable or compact density.
- Responsive and accessibility baseline: the shell, toolbars, forms, tables, overlays, and route states provide the Phase 1 responsive behavior and keyboard semantics required for later route migrations.
- Verification: focused current-user module-action tests, backend compilation, frontend lint, and the production build pass. Playwright discovers palette action and user-scoped route-history scenarios alongside the foundation coverage; authenticated execution still requires `E2E_ADMIN_MFA_CODE` or `E2E_ADMIN_RECOVERY_CODE` in the local test environment.

Migration note: no route-specific legacy components were removed in this foundation slice. Desktop-only shell behavior was replaced in place, and later phases should migrate remaining route-local styling onto these primitives rather than creating new variants.

Scope note: this record completes the reusable Phase 1 foundation. The project-wide acceptance criteria in section 19 remain cumulative and are complete only after every route in Phases 2 through 6 has migrated to the foundation.

## Phase 2: Core CRM workflow

- Leads list.
- Create lead.
- Lead detail.
- Edit lead.
- Contacts list and detail.
- Accounts list and detail.
- Opportunities table and kanban.

### Phase 2 completion record

Status: **Implemented**.

- Lists: Leads, Contacts, Accounts, and Deals use the shared responsive table, toolbar, saved-view, filter, column, import/export, pagination, loading, filtered-empty, and dataset-empty patterns. Deals also provide a keyboard-accessible pipeline stage selector alongside drag-and-drop.
- Forms: create and edit workflows are dedicated responsive pages with semantic sections, linked record pickers, inline validation, first-invalid-field focus, sticky actions, persisted values after failure, last-modified metadata, and warnings for browser or in-app navigation with unsaved changes.
- Details: each module uses the shared record header and tab pattern for overview, activity, related records, notes, files, tasks, and audit history where applicable. Lead conversion is a guided routed workflow.
- Relationships: Account summaries now include tenant-scoped Contacts, Deals, Quotes, Orders, Invoices, insertion orders, activity, tasks, and documents without fetching unrelated full lists.
- Deals: table and pipeline views show stage, account/contact, value, close date, owner, overdue state, and high-value indicators. Stage changes use optimistic updates with rollback and a non-drag selector for keyboard users.
- States and safety: route and record loading/error/not-found states preserve navigation, permission handling remains in the dashboard guard, and raw backend or status errors are not rendered to standard users.
- Data contract: Leads, Contacts, Accounts, and Deals expose real update timestamps. Existing sales rows are deterministically backfilled from their creation timestamp; tenant-scoped invoice relationship indexes support the new account summary queries.
- Verification: focused backend tests, backend compilation, migration upgrade/current checks, frontend lint, and the production build pass. Playwright discovers eight Phase 2 scenarios; authenticated execution requires `E2E_ADMIN_MFA_CODE` or `E2E_ADMIN_RECOVERY_CODE` in the local test environment.

Migration note: the unused `OpportunityDialog`, `createContactModal`, `createOrganizationModal`, and `organizationCard` legacy components were removed after their workflows moved to routed pages and shared tables.

Scope note: this completes Phase 2. The project-wide acceptance criteria remain cumulative until the routes in Phases 3 through 6 have migrated to the shared foundation.

## Phase 3: Transactions

- Quotes.
- Orders.
- Invoices.
- Payments.
- Insertion Orders.

### Phase 3 completion record

Status: **Implemented**.

- Transaction lists: Quotes, Orders, Invoices, and Payments use the shared responsive table, toolbar, saved-view, filtering, column, sorting, pagination, loading, refreshing, dataset-empty, and filtered-empty patterns applicable to each module.
- Creation and editing: Quotes, Orders, and Invoices use dedicated multi-section pages with linked CRM selectors, editable keyboard-friendly line items, inline validation, first-invalid-field focus, sticky summaries and actions, real last-modified metadata, and protection against browser or in-app navigation with unsaved changes.
- Contracts: contract creation and editing now share dedicated responsive routes with semantic sections, linked CRM selectors, tenant-configured field visibility, inline amount and date validation, first-invalid-field focus, generic failure guidance, real last-modified metadata, sticky actions, and unsaved-change protection. The detail route retains fast lifecycle-status updates plus parties, signers, and events, while the list and permission-aware global palette open the routed create workflow.
- Record workflows: routed detail and edit pages preserve quote proposal actions, quote-to-order conversion, order fulfillment state, invoice printing, activity history, soft-delete behavior, and links to related CRM records.
- Payments: the receivables view retains fast row-level payment entry and now links to a dedicated responsive `/dashboard/finance/payments/record` workflow for global use. The routed flow supports searchable outstanding-invoice selection, balance summaries, bounded amounts, generic failure guidance, sticky actions, unsaved-change protection, and direct navigation back to receivables.
- Payment action authorization: the shared module registry and global palette can declare the action permission required by each shortcut. `Record payment` is derived from the enabled Finance Invoices module and appears only with `finance_pos.edit`; the Payments list hides payment selection and mutation controls without that permission, and the direct route renders the shared permission-denied state. Invoice creation remains independently governed by `finance_pos.create`.
- Insertion Orders: creation and editing now share dedicated responsive routes with searchable Contact or Account linking, optional lightweight Contact creation, tenant-configured field visibility, custom fields, schedule and date-range validation, commercial totals, real updated metadata, sticky actions, and unsaved-change protection. The list, detail page, and permission-aware global palette open these routed workflows.
- Insertion Order safety: raw list, record, save, and delete failures are replaced with generic recovery guidance. Existing tenant/module/action permissions, tenant-validated linked customers, duplicate handling, import/export boundaries, soft deletion, activity history, and generated numbering remain unchanged.
- States and safety: transaction route boundaries use the shared loading, recoverable-error, and not-found states. Standard users receive actionable generic failures rather than raw backend responses, while existing module/action permissions and tenant-scoped APIs remain unchanged.
- Visual system: dashboard transaction surfaces now use semantic tokens and shared controls. Printable invoice templates intentionally retain fixed light/dark document colors so exported and printed output remains stable independently of the dashboard theme.
- Verification: the focused 15-test Finance IO suite and 13-test Finance POS invoice suite, frontend lint, and the 71-route production build pass. Nineteen Phase 3 browser scenarios are defined across Quotes, Orders, Invoices, Payments, Contracts, and Insertion Orders, with global-palette route and permission coverage. Authenticated execution requires `E2E_ADMIN_MFA_CODE` or `E2E_ADMIN_RECOVERY_CODE` in the local test environment; the latest Payments-slice discovery command could not start because the local execution approval service reached its usage limit.

Migration note: the unused `CreateQuoteModal`, oversized `CreateContractDialog`, and 618-line `InsertionOrderDialog` were removed after their create/edit workflows moved to dedicated routed pages. No Insertion Order backend or database contract changed.

Scope note: this completes the Phase 3 implementation without opening deferred payment-link or external payment-provider work. The project-wide acceptance criteria remain cumulative until Phases 4 through 6 have migrated to the shared foundation.

## Phase 4: Administration

- Users. **Implemented.**
- Authentication. **Implemented.**
- Domains. **Implemented.**
- Permissions. **Implemented.**
- Field config. **Implemented.**
- View manager. **Implemented.**

### Phase 4 progress record

- Users: the administration route now uses addressable Users, Authentication, Domains, and Provisioning tabs. The Users tab includes shared search and filtering, responsive loading and empty states, selectable rows, and tenant-scoped bulk role/status updates with self-deactivation protection and activity logging.
- Authentication: the tab exposes the enforced password requirements, tenant MFA policy, OIDC configuration, connection testing, separate successful/failed test history, retry and opt-in technical details, and distinct successful/failed login status. Configuration-test failures no longer overwrite login-failure telemetry, and secrets remain excluded from API responses and activity state.
- Domains: responsive status cards show the custom hostname, verification status, TXT-only record type, root/account-domain host, expected value, verified time, and a persisted last-checked timestamp. Verification failures refresh into actionable generic guidance, DNS values have accessible copy actions, removal is confirmed, and deleting a primary domain deterministically promotes a verified replacement when available.
- Permissions: the responsive role-first workspace uses a searchable permission matrix with tenant-configured product-area grouping, sticky headers and module names, row and visible-column selection, permission presets, protected role switching, an unsaved-change indicator, and mobile-reachable sticky save actions. Role creation, editing, and permission writes remain tenant-scoped, reject duplicate or invalid module updates before mutation, and record actor-attributed activity history without exposing backend error details.
- Field configuration: the module field catalog now provides shared search, All/System/Custom/Required/Disabled filters, source and status badges, accessible enable toggles, a contextual more-actions menu, and explicit explanations for protected controls. The responsive inspector persists labels, custom metadata, required state, and visibility through the existing tenant-scoped admin contracts; custom-field creation uses labeled controls, inline generic errors, automatic safe keys, dirty-state protection, and transitions directly into the saved field inspector.
- View manager: the responsive three-column workspace separates searchable available fields, selected fields, and view preview/filter metadata without placing the selector inside an oversized empty card. Columns support pointer drag-and-drop plus keyboard-accessible arrow ordering, mobile-safe add/hide controls, live preview synchronization, bounded AND/OR filter editing, default search, guarded view switching, and a sticky dirty-state action bar for updating, cloning, defaulting, and deleting personal views. Saved-view writes continue through the existing current-user-owned, module-validated, tenant-safe, payload-bounded API contract and show generic failures instead of backend details.
- Route quality: user management has shared loading and recoverable-error boundaries, semantic design tokens, generic authentication/provider failures, and mobile-reachable bulk actions.
- Verification: the focused admin-user, SSO, MFA, password-policy, tenant-domain, role-permission, protected-field, and saved-view backend suites, migration upgrade/current checks, backend compilation, frontend lint, and the production build pass. Playwright discovers nine scenarios covering Users bulk actions plus Administration, Authentication, Domains, Permissions, Field configuration, and View manager behavior; authenticated execution still requires the configured local admin MFA credential.

Scope note: Phase 4 is complete. Users, Authentication, Domains, Permissions, Field configuration, and View manager now use the shared frontend foundation and retain their existing security boundaries.

## Phase 5: Builders

- Module builder. **Implemented.**
- Automation builder. **Implemented.**
- Dashboard edit mode. **Implemented.**

### Phase 5 progress record

- Module builder: the previous stacked module-and-field form is replaced by a responsive module rail, tabbed module editor, and selected-field inspector. General, Fields, Layout, Permissions, and Automation are addressable editor tabs; shared permissions and automation workspaces remain the source of truth rather than being duplicated inside the builder.
- Field workflow: compact rows support pointer drag-and-drop and accessible arrow ordering. Field creation opens directly in the inspector, protected identifiers explain their restrictions, fixed types are read-only after creation, and metadata, ordering, staged additions, and staged deletions are committed through one module-level save action with dirty-state navigation protection.
- Module workflow: searchable module selection, recoverable deletion and restoration, active-state and sidebar placement controls, custom sidebar-group management, generic failure states, mobile-reachable sticky actions, and direct runtime navigation retain the existing admin-only, tenant-scoped, activity-logged backend contract.
- Automation builder: the registry-backed rule editor now uses a searchable rule navigator, a compact When/If/Do flow canvas, and a selected-step inspector. Trigger changes are guarded, conditions expose supported fields and operators, action order is explicit and adjustable, configuration uses one sticky save surface, validation never executes actions, and unsaved changes protect navigation and rule switching.
- Automation runs: run history is separated from rule editing and uses the server-sanitized run contract. Responsive rows show rule, source, status, action outcomes, and timing; selecting a run opens its redacted input, result, error, and action-step details in the inspector without placing raw logs on the builder canvas.
- Dashboard edit mode: the normal dashboard hides all layout controls and exposes date-range and refresh actions. Explicit edit mode creates a local draft with pointer drag-and-drop, accessible ordering and mobile resize controls, widget addition/removal, default reset, empty-draft recovery, unsaved navigation protection, and one sticky Save/Cancel surface. Widget content remains non-interactive while arranging the layout, failed widgets provide scoped retry actions, empty widgets collapse naturally, and saved layouts stay scoped to the authenticated tenant user.
- Dashboard persistence: the existing layout contract now accepts every catalog widget, including weighted forecast, enforces the 24-widget limit, unique IDs, supported sizes and types, and bounded nested configuration before writing per-user JSON. Generic retryable errors replace raw backend messages.
- Verification: the focused 16-test custom-module, 26-test automation-rule, and 6-test dashboard-layout backend suites, backend compilation, frontend lint, and the production build pass. Playwright discovers two scenarios for each Phase 5 surface and 42 frontend scenarios overall; authenticated execution remains behind the configured local admin MFA boundary and requires `E2E_ADMIN_MFA_CODE` or `E2E_ADMIN_RECOVERY_CODE`.

Scope note: Phase 5 is complete. Module builder, Automation builder, and Dashboard edit mode now use the shared builder and draft-editing foundation without expanding deferred custom-module or automation capabilities.

## Phase 6: Secondary modules

- Products and Services. **Implemented.**
- Documents. **Implemented.**
- Calendar. **Implemented.**
- Mail. **Implemented.**
- Client Portal. **Implemented.**
- Tasks. **Implemented.**
- Support. **Implemented.**
- Message Templates. **Implemented.**
- Reports. **Implemented.**
- Integrations. **Implemented.**

### Phase 6 progress record

- Catalog workspace: Products and Services retain their shared search, saved-view, sorting, pagination, activity, media, recoverable-delete, and public-feed behavior. Create and edit now share dedicated responsive routes with semantic details, pricing, inventory, publishing, and media sections; required-field validation focuses the first invalid control, sticky actions expose dirty state, image-upload failure is distinguished from a successfully saved record, and the permission-aware global palette opens each routed create workflow.
- Catalog contracts: existing tenant/module/action permissions, active-row slug uniqueness, normalized currency and slug behavior, non-negative pricing and stock validation, customer-group pricing rules, media rollback guarantees, public-feed visibility, and client/public auth boundaries remain unchanged.
- Catalog verification: frontend lint and the production build pass. Playwright discovers three Catalog scenarios covering mobile Product creation, Service-specific fields, and hydrated Product editing; authenticated execution remains behind the configured local admin MFA credential.
- Documents workspace: the responsive library retains storage usage, search, template filtering, sorting, version management, CRM links, client sharing, and authenticated viewing. Standalone upload now uses a dedicated route with explicit file selection, supported-extension validation, storage destination context, generic quota/storage recovery guidance, dirty-state protection, and a permission-aware global shortcut; record-linked uploads remain contextual on record detail pages.
- Documents safety: removals require consequence-specific confirmation, library and version failures no longer render backend details, failed quota queries show unavailable state instead of misleading zero usage, and private files remain behind the existing tenant-scoped module/action permissions and authenticated download routes. Backend size, content-type, lightweight signature, quota, path-containment, storage rollback, and soft-delete behavior remain authoritative.
- Documents verification: frontend lint and the production build pass. Playwright discovers three Documents scenarios covering mobile upload validation, successful library return/highlighting, confirmed removal, and backend-detail redaction; authenticated execution remains behind the configured local admin MFA credential.
- Calendar workspace: the responsive route now uses the shared page, card, loading, recoverable-error, and empty-state foundation. Desktop retains the full month grid, while mobile provides a touch- and keyboard-accessible month agenda with reachable day selection, event review, event creation, provider sync, and invitation actions.
- Event workflows: creation and editing retain the existing tenant-scoped calendar contract, searchable user/team participants, task relationships, invitation responses, and recoverable deletion. Required fields are labeled, all-day state is editable, deep-linked failures recover safely, and shared events open read-only for non-owners instead of offering actions the backend will reject.
- Provider sync: Google and Microsoft use compact connection cards with account, calendar, health, last successful sync, reconnect/manage, and manual-sync actions. Raw provider failures, job payloads, and recent sync-log rows are not rendered on the main calendar; user-readable recovery guidance replaces technical details.
- Booking links: the settings workspace uses shared controls and semantic tokens, searchable timezone selection, inline duration validation, keyboard-accessible link selection, protected unsaved drafts, generic recoverable errors, and confirmed disabling. The public booking surface labels required guest details and questions, enforces required answers before submission, and does not expose backend error details.
- Security and product boundaries: existing Calendar module/action permissions, tenant-scoped event and booking queries, owner-only event mutation, soft deletion, activity history, least-privilege provider scopes, public booking rate limiting, and separate public/CRM auth boundaries remain unchanged.
- Verification: the focused 26-test Calendar and booking backend suites, frontend lint, and the production build pass. Playwright discovers two Calendar scenarios covering mobile scheduling and provider-detail redaction; authenticated execution reaches the configured admin MFA boundary and requires `E2E_ADMIN_MFA_CODE` or `E2E_ADMIN_RECOVERY_CODE`.
- Mail workspace: mailbox connection health, provider sync, message search, message review, contact creation, and tenant-safe CRM record linking remain on the responsive inbox route. New email composition now uses a dedicated responsive route with labeled fields, mailbox context, CRM variables, required-recipient validation, subject-length guidance, dirty-state navigation protection, and a permission-aware global shortcut.
- Mail safety: provider and API failures use generic recovery guidance instead of exposing OAuth, SMTP, credential, or provider-response details. Existing per-user encrypted credentials, tenant/module/action permissions, tenant-validated record links, authenticated message access, and least-privilege provider scopes remain authoritative.
- Mail verification: the focused 27-test Mail backend suite, frontend lint, and the production build pass. Playwright discovers two Mail scenarios plus global-palette coverage for mobile composition, recipient validation, successful sending, routed shortcut navigation, and technical-detail redaction; authenticated execution remains behind the configured local admin MFA credential.
- Client Portal administration: page creation now uses a dedicated responsive route with shared form sections, searchable contact/account and customer-linked document selectors, customer-facing pricing validation, proposal and branding fields, first-invalid-field focus, dirty-state navigation protection, and a permission-aware global shortcut. Account provisioning, signed-link publishing, client accounts, and activity summaries remain on the admin workspace.
- Client Portal safety: the form explains the draft-to-published sharing boundary and sends customer-specific pricing as an intentional snapshot. CRM, client-authenticated, and signed-public request helpers use generic failures instead of exposing backend details; existing tenant/action checks, exact linked-customer validation, customer-scoped documents, expiring signed links, private pricing, client login throttling, and separate client/CRM auth contracts remain unchanged.
- Client Portal verification: the focused 47-test Client Portal backend suite, frontend lint, and the production build pass. Playwright discovers two Client Portal scenarios plus global-palette coverage for routed mobile creation, required-field focus, customer-scoped pricing payloads, and backend-detail redaction; authenticated execution remains behind the configured local admin MFA credential.
- Tasks workspace: list, board, and due-date calendar views retain the shared saved-view, filter, visible-column, sorting, pagination, and current-page disclosure patterns. Dataset-empty and filtered-empty states are distinct, table rows are keyboard-openable, status changes remain optimistic with rollback, and raw backend failures are replaced with generic retry guidance.
- Task scheduling and editing: mobile users now receive a native month picker and selected-day agenda instead of an 840-pixel desktop canvas. The quick-review dialog uses labeled shared controls, required-title and date-order validation, searchable user/team assignment, generic recoverable errors, guarded Calendar actions, recoverable deletion, and a stable task-identity boundary that does not remount after timestamp-only updates.
- Task contracts: existing tenant/module/action access, tenant-validated user and team assignment, linked source-record validation, assignment and due-date notifications, mirrored source activity, Calendar linking, and soft-delete/restore behavior remain unchanged.
- Tasks verification: the focused 22-test task reminder and source-activity backend suites, frontend lint, and the production build pass. Playwright discovers four Tasks scenarios covering list/board/calendar behavior, optimistic status changes, mobile schedule validation, and backend-detail redaction; authenticated execution remains behind the configured admin MFA credential.
- Support workspace: the list now uses the shared search, saved-view, filter, density, pagination, loading, dataset-empty, filtered-empty, and recoverable-error foundation. Summary failures no longer render misleading zero totals, rows open by pointer or keyboard, and technical backend details stay out of user-facing failures.
- Case creation and review: the former oversized creation dialog is replaced by a dedicated responsive form route with labeled required fields, linked-record search, dependency-safe customer and commercial relationships, generic failures, and protected unsaved drafts. The discarded SLA input was removed because SLA timestamps remain service-owned lifecycle data.
- Case detail: requester, assignee, SLA, status, priority, and the customer conversation lead the workspace. Related records use tenant-safe display labels instead of raw numeric IDs, edits have explicit dirty state, replies are labeled, loading/not-found/error states are recoverable, and activity/history remain available without exposing raw event payloads.
- Support contracts: existing module/action permissions, tenant-scoped case queries, tenant-validated relationships, service-owned SLA and response timestamps, activity/event publication, client-portal auth separation, and lightweight paginated list responses remain intact.
- Support verification: the focused 23-test Support backend suite, backend compilation, frontend lint, and the production build pass. Playwright discovers four Support scenarios covering mobile list navigation, full-page creation, service-owned SLA behavior, detail priorities, guarded saves, and backend-detail redaction; authenticated execution remains behind the configured admin MFA credential.
- Message Templates workspace: the responsive template list now focuses on search, channel/module filtering, sorting, status, and permission-aware actions. Creation and editing share dedicated `/new` and `/[templateId]/edit` routes with CRM presets, semantic form sections, required-field focus, dotted-variable detection, dirty-state protection, summary context, sticky actions, and a routed global-palette shortcut.
- Message Templates safety: list, save, activation, and deletion failures use generic recovery guidance rather than backend details. Deletion requires consequence-specific confirmation, while create, edit/activation, and delete controls independently follow `message_templates.create`, `message_templates.edit`, and `message_templates.delete`. Existing tenant-scoped queries, soft deletion, normalized-key uniqueness, actor attribution, and backend permission checks remain authoritative.
- Message Templates verification: the focused four-test rendering and write suite, frontend lint, and the 72-page production build pass. Three browser scenarios are defined for mobile routed creation, dotted-variable payloads, routed edit hydration, confirmed deletion, technical-detail redaction, restricted-role controls, direct-route denial, and global-palette navigation; authenticated execution remains behind the configured admin MFA credential.
- Reports workspace: the route now uses the shared page, card, field, loading, filtered-empty, dataset-empty, and retry patterns. CRM presets remain available, while the module selector exposes every built-in or custom module returned by the tenant- and permission-aware reporting registry instead of hiding supported finance and custom-module reports. The permission-aware global palette includes a `Build report` shortcut that opens the report builder.
- Forecasting and report output: weighted forecasting only requests data when Deals access is available, date ranges validate before requests, and loading or failure states no longer appear as valid zero totals. Table, bar, and pie controls are grouped with the report output, count tables no longer repeat the same measure, charts have accessible descriptions, and CSV/SVG exports show progress with generic recovery guidance.
- Saved reports: per-user report configurations retain server-side validation and tenant scoping. Rows open by pointer or keyboard, unchanged reports cannot be redundantly saved, stable filter comparison prevents false dirty states, save-as fields are labeled, duplicate-name guidance is safe, and deletion requires confirmation that distinguishes configuration removal from CRM data deletion.
- Reports contracts: existing Reports module/action permissions, target-module view checks, per-user saved-report ownership, tenant-scoped adapters, custom-field sanitization, and the Deals permission boundary for forecasting remain unchanged. The UI independently applies `reports.create`, `reports.edit`, `reports.delete`, and `reports.export` to save-as, update, deletion, CSV, and chart-export controls; backend checks remain authoritative. Backend error details are not rendered in the browser.
- Reports verification: the focused three-test forecasting suite, frontend lint, and the 71-route production build pass. Five Reports browser scenarios are defined for authorized finance/custom modules, permission-aware forecast behavior, filtered-empty and error-redaction states, keyboard saved-report access, dirty saves, confirmed deletion, forecast date validation, and action-control authorization, with additional global-palette route coverage. Authenticated execution remains behind the configured admin MFA credential.
- Integrations workspace: Provider Registry, Website APIs, notification Webhooks, and CRM Event History are isolated as semantic-token domain sections, leaving the route as a thin composition shell. Provider cards surface connection state, connected account, last activity, last successful run, credential health, queued and failed work, and the appropriate connect, reconnect, or configure action. Website APIs owns scoped key creation, one-time secret handling, rotation and revocation confirmations, public-catalog visibility, incoming-order status, and guarded POS conversion. Webhooks owns labeled Slack and Microsoft Teams configuration, masked channel output, activation, testing, and confirmed deletion. Event History owns event and delivery filters, status presentation, safe recovery guidance, and tenant-timezone timestamps without modeling backend delivery exception text. A `Configure integration` global-palette action requires `integrations.configure` and opens the addressable Provider Registry section instead of duplicating the base settings link. Provider, website API, webhook, and delivery-history failures have scoped retry states instead of collapsing into misleading empty tables.
- Integration credentials and actions: website API key inputs and scopes, webhook fields, event filters, and order status controls are explicitly labeled. New API secrets remain one-time values with copy and dismiss actions; rotation, revocation, webhook deletion, website-order cancellation or rejection, and POS conversion require confirmation with consequence-specific copy.
- Integration safety: raw provider, backup, sync-run, and webhook-delivery exception text is redacted at the backend serialization boundary and ignored defensively by the frontend. Admin-only palette entries now require verified administrator identity even if stale or unexpected module-action data grants configure access. Existing admin-only API access, tenant-scoped queries, public website-key authentication boundary, least-privilege API scopes, masked webhook output, finance permission for POS conversion, rate limiting, idempotency, and audit behavior remain unchanged.
- Integrations verification: the focused 26-test provider-registry, CRM-event, and website-integration backend suites, frontend lint, and the 72-page production build pass after the Provider Registry, Website APIs, Webhooks, and Event History extractions. Three Integrations browser scenarios remain defined for mobile provider health and account context, technical-detail redaction, one-time API-key handling, labeled scopes, and confirmation gates, with global-palette coverage for configure navigation, missing configure permission, and non-admin identity. Authenticated execution remains behind the configured admin MFA credential.

Migration note: no Calendar business workflow or backend data model was redesigned. The main route's raw sync-job rows and desktop-only calendar dependency were replaced in place; no reusable legacy component was removed.

Catalog migration note: no catalog data model, pricing rule, media contract, or public/client workflow was redesigned. The shared `CatalogRecordDialog` was retired after Product and Service creation and editing moved to one routed form.

Documents migration note: no storage provider, download, sharing, versioning, or client-portal contract was redesigned. The standalone inline upload strip moved to a dedicated route; compact record-linked uploads remain in place.

Mail migration note: no mailbox provider, credential storage, sync, message, or CRM-linking contract was redesigned. The inline query-parameter composer moved to a dedicated route, and provider/API failures were redacted at the frontend boundary; no database migration was required.

Client Portal migration note: no client account, pricing, document, signed-link, public action, or authentication contract was redesigned. The embedded client-page form moved to a dedicated route and the shared linked-record picker gained an optional input identifier for accessible labels; no database migration was required.

Tasks migration note: no task API or business workflow was redesigned. The desktop-only task calendar dependency and timestamp-driven dialog remount were replaced in place; no reusable legacy component was removed.

Message Templates migration note: no template rendering, channel, persistence, or message-sending contract was redesigned. The embedded create/edit form moved to shared routed pages, and the list retained lightweight activation controls; no database migration was required.

Support migration note: no support lifecycle or client-portal workflow was redesigned. The large creation modal was retired in favor of a dedicated route, and detail serialization gained tenant-checked related-record display labels; no database migration was required.

Reports migration note: no reporting schema, aggregation engine, or permission contract was redesigned. The frontend restriction that hid authorized finance and custom modules was removed, and the existing synchronous CSV and chart exports were retained; no database migration was required.

Integrations migration note: no provider, website-order, notification-channel, event-delivery, or public API workflow was redesigned. The existing tenant-scoped services remain authoritative; Provider Registry, Website APIs, Webhooks, Event History, and their recoverable section error were extracted from the original 1,254-line page, reducing the route-level settings page to a 68-line composition shell while preserving the admin/public API boundary. No database migration was required.

Scope note: Phase 6 is complete. Products, Services, Documents, Calendar, Mail, Client Portal, Tasks, Support, Reports, and Integrations now use the shared frontend foundation while retaining their existing module, tenant, permission, and public-auth boundaries.

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
