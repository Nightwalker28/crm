# Run 4 — CRM Maturity, Product UX, and Workflow Corrections

## Goal

You are working on `Nightwalker28/crm`.

Run 4 goal: fix the remaining product/UX mistakes from previous passes and move Lynk closer to a mature CRM/ERP experience.

This run prioritizes the owner-provided UI audit and fixes first, then broader mature CRM consistency improvements.

## Owner Audit Priority

The owner-provided audit is the highest-priority source for this run. Do not replace these fixes with generic polish.

Key audit priorities:

1. Sidebar should be one unified nav section with micro-labels, not separate bordered sections for every module group.
2. Sidebar must scroll properly with the visual scrollbar hidden, not clipped.
3. Sticky module/page headers should be removed because they block record readability while scrolling.
4. Custom modules must behave like normal modules with row click/detail-page workflows, not old action-column-first patterns.
5. Contact detail needs mature CRM quick actions and a right-side context panel.
6. Account detail needs related contacts, open deals, status/health, and a proper account hero.
7. Insertion Orders need status chips, row status indicators, bulk actions, and a real detail page.
8. POS needs a more transactional UX, sticky totals, row-level print/mark-paid actions.
9. Catalog needs thumbnails, stock indicators, inline active toggle, and a combined Products/Services tabbed page.
10. Settings needs dirty-state detection, unsaved changes banner, and consistent naming.
11. Roles/Permissions need role-level visual accents and permission tooltips.
12. Module Builder needs field-type badges and a more natural add-field placement.
13. Global typography, button hierarchy, loading states, and Card usage need consistency.
14. Customer groups need a proper settings/admin management surface because contact detail already exposes group assignment.

## Product Source of Truth

Before editing, read these files and follow them:

- `.codex/skills/roadmap/SKILL.md`
- `docs/product-rules.md`
- `docs/architecture.md`

Important product rules to obey:

- Main operational list pages should use a shared table-based presentation where a table is the right default.
- Once records exist, the preferred interaction is a record page with summary/history/editing rather than modal-only editing.
- Quick creation can use dialogs where appropriate.
- Active custom fields must work inside the module they belong to, including create/edit, detail, table views, saved views, and filters.
- Shared record-page collaboration features such as activity timelines and notes/comments should land across the current CRM detail-page set together, not one module at a time.
- Contacts and organizations can belong to customer groups.
- Customer-specific prices, discounts, and terms should resolve from customer/contact/account group context, not ad hoc page-only state.

## Hard Rules

- Owner-provided corrections in this file are highest priority.
- Frontend only unless an existing backend API already supports the feature.
- Do not change backend contracts unless the API already exists or the change is explicitly documented as safe.
- Do not add new packages.
- Do not reintroduce old admin routes.
- Do not reintroduce module overview pages.
- Do not reintroduce standalone WhatsApp navigation.
- Do not keep old list-page action-tab/action-column-first patterns when record click/detail-page flow is expected.
- Do not keep sticky module headers if they block readability.
- Keep backend module keys unchanged.
- Keep the dark Lynk visual style.
- Prefer shared UI primitives over one-off page-specific UI.

---

## Task 1 — Add Permanent Product/Design Guardrails for Codex

Problem:
Codex repeated patterns that were already rejected: sticky module headers, old action-column-only custom module UX, overview pages, and modal/edit-only record behavior.

Task:
Update repo guidance so future Codex runs do not repeat these mistakes.

Files to update:

- `docs/product-rules.md`
- `docs/architecture.md`
- If a suitable `.codex/skills/*` skill exists, update it.
- If no suitable frontend/product UX skill exists, create one such as `.codex/skills/frontend-product-ux/SKILL.md`.

Add product/design rules:

1. Module list pages should not use sticky page/module headers if they cover table rows or record details while scrolling.
2. Page headers may stay at the top of the page, but should scroll normally unless a compact sticky toolbar is intentionally designed.
3. Operational records should prefer row-click/detail-page navigation after creation.
4. List pages should not rely mainly on action columns for normal record opening.
5. Action columns are allowed only for secondary quick actions such as delete/print, not as the main record interaction.
6. Custom modules must behave like first-class operational modules, not builder/admin forms.
7. Custom module records should support normal list -> detail -> edit workflow where existing APIs allow it.
8. Quick create can use a modal, but existing records should open a detail page where practical.
9. Do not create module overview pages unless the owner explicitly asks.
10. Standalone WhatsApp page/navigation is not wanted; WhatsApp stays as contextual contact workflow.
11. Sidebar should be one unified nav with subtle micro-labels, not separate bordered sections for every group.
12. Customer groups must have an admin/settings management surface before they are exposed heavily in contact/account detail workflows.
13. Settings forms should track dirty state and show unsaved-change feedback where practical.
14. Destructive actions should be confirmed and should respect recycle/soft-delete semantics.

Acceptance criteria:

- Future agents have clear written rules.
- The rules are added to source-of-truth docs/skills, not only to this Run 4 file.

---

## Task 2 — Remove Sticky Module/Page Header Behavior

Problem:
The sticky module header hurts readability. When scrolling records/details, the header stays on top and blocks useful content.

Likely file:

- `frontend/components/ui/PageHeader.tsx`

Task:
Make module/page headers non-sticky by default.

Required changes:

- Remove `sticky top-0` behavior from `PageHeader`.
- Keep visual style, title, description, and actions.
- Preserve spacing and dark styling.
- If any page truly needs sticky behavior, make it opt-in with a prop such as `sticky?: boolean`, defaulting to false.
- Do not enable sticky on module list/detail pages.

Acceptance criteria:

- Scrolling list/detail pages no longer keeps the full header pinned over records.
- Readability improves.
- No page loses its title/actions.

---

## Task 3 — Immediate Sidebar Bug Fix: Unified Section + Micro Labels

Problem from audit:
Each module group has its own `SidebarSectionLabel`, visually separating groups as if they are independent sections. The sidebar should feel like one unified nav with small inline micro-labels.

Files:

- `frontend/components/sidebar/Sidebar.tsx`
- `frontend/components/sidebar/SidebarNav.tsx`

Required changes:

1. Remove all `SidebarSectionLabel` usage.
2. Remove the old `SidebarSectionLabel` component if no longer used.
3. Do not use `border-t border-white/6` section separators.
4. Replace section labels with tiny non-structural inline micro-labels.
5. Keep one single `SidebarMenu` flow.

Micro-label style direction:

```tsx
<div className={`px-2 pt-3 pb-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-neutral-700 transition-all duration-200 ${collapsed ? "opacity-0 group-hover/sidebar:opacity-100" : "opacity-100"}`}>
  Workspace
</div>
```

Target sidebar:

Dashboard

Workspace
- Tasks
- Calendar
- Mail
- Documents

Sales
- Accounts
- Contacts
- Deals
- Client Portal

Products & Services
- Products
- Services

Finance
- POS
- Insertion Orders

Custom Modules
- Dynamic custom modules

Settings
- General
- User Management
- Teams
- Customer Groups
- Permissions
- Module Settings
- Module Builder
- Field Config
- Integrations
- Templates

Required sidebar rules:

- No module overview links.
- No WhatsApp standalone item.
- No duplicate section label + same collapsible title.
- Prefer direct links under micro-labels for short groups.
- Custom module names must truncate cleanly.
- No horizontal scrollbar in collapsed, expanded, or hover-expanded states.
- Keep vertical scrolling functional but visually clean.

Acceptance criteria:

- Sidebar feels like one unified nav, not many disconnected blocks.
- No repeated label/collapsible conflict.
- No borders between every group.

---

## Task 4 — Immediate Sidebar Bug Fix: Scrollable Hidden Scrollbar

Problem from audit:
The sidebar uses hidden scrollbar styles, but overflow can be clipped instead of scrollable.

Files:

- `frontend/components/sidebar/Sidebar.tsx`
- `frontend/components/sidebar/SidebarNav.tsx`
- global CSS only if needed

Required changes:

1. In `Sidebar.tsx`, change the inner padding wrapper from:

```tsx
<div className="flex h-full min-h-0 flex-col px-2 py-3">
```

To:

```tsx
<div className="flex h-full min-h-0 flex-col overflow-hidden px-2 py-3">
```

2. In `SidebarNav.tsx`, ensure nav is always scrollable vertically but hidden visually:

Preferred Tailwind-only pattern:

```tsx
<nav className="flex min-h-0 w-full flex-1 flex-col gap-1 overflow-y-scroll overflow-x-hidden pr-1 [&::-webkit-scrollbar]:hidden">
```

Also add if needed:

```tsx
style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
```

3. Keep horizontal overflow hidden.
4. Ensure collapsed/hover-expanded sidebar still scrolls.

Acceptance criteria:

- Sidebar content scrolls when long.
- Visual scrollbar is hidden.
- No horizontal scrollbar appears.
- Content is not clipped.

---

## Task 5 — Remove or Fully Decommission Unwanted Overview Pages

Problem:
Owner does not want module overview pages.

Task:
Remove unused module overview pages if they are not linked/needed.

Check and remove if safe:

- `frontend/app/dashboard/sales/page.tsx`
- `frontend/app/dashboard/finance/page.tsx`
- `frontend/app/dashboard/whatsapp/page.tsx`
- any other module overview page not used by the final sidebar

Rules:

- Do not remove real list/detail pages.
- Do not add redirects.
- Do not leave dead pages just because they build.
- If a route must stay for technical reasons, replace it with a minimal not-linked landing only if unavoidable and document why.

Acceptance criteria:

- No sidebar/module navigation points to overview pages.
- Unwanted overview pages are deleted where safe.

---

## Task 6 — Contacts Module CRM Maturity

Audit benchmark:
Mature CRMs show contact context, recent activity, associated account, open tasks, lifecycle stage, and quick actions prominently.

Current gaps from audit:

- No quick action bar on contact detail page; FollowUpPanel is buried.
- No lifecycle stage field/visible UX.
- Organization link has no visual preview card.
- No Last Contacted/Last Activity badge visible on contact list rows.

Tasks:

1. Contact detail layout:
   - Use a 2-column layout: main content + right context panel.
   - Right panel width around `320px` on desktop.
   - Right panel contains:
     - owner if available
     - lifecycle stage select if supported by API/data
     - last contacted / last activity
     - associated account card with quick navigate button
     - mini open tasks list if existing task relation APIs support it
   - If an API/data field is missing, show honest fallback and document backend gap in `docs/pass4-followup.md`.

2. Quick action bar:
   - Move FollowUp/communication actions near the top of contact detail.
   - Present as compact icon buttons/actions:
     - WhatsApp
     - Email
     - Call
     - Note
     - Task
   - Do not build automated WhatsApp sending.
   - Reuse existing WhatsApp click-to-chat, note, and task functionality where available.

3. Contact list:
   - Add Last Activity / Last Contacted column if data already exists.
   - Render a small colored dot or relative-time badge such as `3d ago`.
   - Add lifecycle stage as a visible column option only if field/data exists.
   - Do not fake lifecycle stage if backend does not support it.

Acceptance criteria:

- Contact detail feels like a mature CRM contact record.
- Contact list shows useful recency context where data exists.
- Missing backend capabilities are documented, not faked.

---

## Task 7 — Accounts / Organizations CRM Maturity

Audit benchmark:
Enterprise CRMs show account hero, related contacts, open deals, account health/status, website, industry, and account hierarchy when available.

Current gaps from audit:

- Organization/account detail lacks mature related-contact and open-deal presentation.
- No total pipeline value shown on account record.
- No account status/health UX.
- Header is not a proper account hero.

Tasks:

1. Account detail hero:
   - Use a full-width hero card.
   - Show account name, industry pill, website link, primary email/phone where available.
   - Show logo if available. If no uploaded logo exists, optionally use a safe placeholder; do not depend on external favicon scraping unless already supported.
   - Show account status/health pill if data exists. If not, document backend gap.

2. Related contacts:
   - Add `Related Contacts` card listing contacts linked by organization/account id if existing API/data supports it.
   - Add `Add Contact` button that pre-fills or passes account context if existing create flow supports it.
   - If prefill is not supported, link to contact creation and document limitation.

3. Open deals:
   - Add `Open Deals` summary card with count and total value for non-closed deals linked to this account if API/data supports it.
   - Do not fake pipeline value from unrelated/page-slice data.

4. Activity/notes/documents:
   - Ensure account detail uses the same record-page tabs/panels as contact/deal where supported.

Acceptance criteria:

- Account detail feels like a mature company/account record.
- Related contacts and open deals are visible when supported.
- Unsupported metrics are documented, not faked.

---

## Task 8 — Insertion Orders Maturity

Audit benchmark:
Invoice/IO modules use status funnels, row status indicators, bulk action bars, and real record detail pages.

Current gaps from audit:

- Status filter is a Select dropdown.
- No colored left border on rows by status.
- Bulk action bar missing when rows are selected.
- No full IO detail page; current behavior is dialog-oriented.

Tasks:

1. IO list status funnel:
   - Replace status Select dropdown with horizontal chip row:
     - All
     - Draft
     - Issued
     - Active
     - Completed
     - Cancelled
   - Add count badges only if reliable counts are available from existing data/API.
   - If only current-page counts are available, label accordingly or omit counts.

2. Row status indicator:
   - Add colored left border to each IO table row based on status:
     - draft = neutral
     - issued = sky
     - active = emerald
     - completed = darker emerald/teal
     - cancelled = red

3. Bulk action bar:
   - When selected IDs exist, show a sticky/sliding bottom bar:
     - `X selected`
     - Export selected if supported
     - Change status if supported
     - Clear
   - Do not add unsupported backend behavior.

4. IO detail page:
   - Create `/dashboard/finance/insertion-orders/[id]/page.tsx` if existing APIs support fetching one IO.
   - Detail page should show:
     - IO number
     - customer/contact/account
     - status badge
     - total amount
     - line items/summary section even if minimal
     - activity/notes where supported
   - List row click should open detail page.
   - Dialog can remain for quick create/edit if useful, but should not be the only record interaction.

Acceptance criteria:

- IO list is faster to filter and scan.
- IO records have mature detail navigation.

---

## Task 9 — POS UX Maturity

Audit benchmark:
POS flows feel transactional: line items, customer context, running total, print/payment quick actions.

Current gaps from audit:

- POS dialog is dense and form-like.
- Running total is not always visible while editing line items.
- Print page exists, but list row UX needs clearer print/paid actions.

Tasks:

1. POS dialog:
   - In `PosInvoiceDialog`, move totals section into a sticky footer inside the dialog.
   - Totals footer should remain visible while line items change.
   - Use `position: sticky; bottom: 0` inside the scrollable dialog content.
   - Include subtotal, tax, total, balance.

2. POS list row actions:
   - Add visible-on-hover or compact row action:
     - Print
     - Mark as Paid if invoice is not already paid
   - Mark as Paid should call existing `updateInvoice(id, { payment_status: "paid" })` only if current hook/API supports partial update safely.
   - Do not break row click/open behavior.

3. POS layout polish:
   - Keep count-based metrics, not misleading mixed-currency totals.
   - Make customer and line-item editing more readable without building a whole new POS system.

Acceptance criteria:

- POS creation/editing is easier to use.
- Totals are always visible while editing.
- Print/paid actions are accessible from list rows.

---

## Task 10 — Products & Services / Catalog Maturity

Audit benchmark:
Catalog systems show thumbnails, stock status, active toggles, and often a unified Products/Services management surface.

Current gaps from audit:

- Media URL column is not a polished thumbnail UX.
- Stock level/status lacks visual indicator.
- Active status is not inline-toggle friendly.
- Products and Services are separate pages/nav items.

Tasks:

1. Catalog table visuals:
   - In `CatalogRecordsTable`, render `media_url` as a proper `32x32` thumbnail with placeholder icon if empty.
   - Render `stock_status` with colored dot + label:
     - in_stock = green
     - preorder = amber
     - out_of_stock = red
     - untracked/unknown = gray

2. Inline active toggle:
   - Add inline row toggle for `is_active` if existing update mutation supports it.
   - Do not open full dialog just to toggle active/inactive.

3. Unified catalog route:
   - Create or improve `/dashboard/catalog` as a tabbed page with Products | Services tabs if safe.
   - Update sidebar Products & Services to link to the unified catalog page if this is completed.
   - Do not leave broken old product/service routes; keep them if used by module access/routing and document migration.

Acceptance criteria:

- Catalog rows are visually scannable.
- Products/services management feels cohesive.

---

## Task 11 — Settings Dirty State and Danger Zone

Audit benchmark:
Mature SaaS settings pages show unsaved-change state and consistent nav naming.

Current gaps from audit:

- Save buttons are often always enabled.
- No unsaved changes warning.
- Settings nav/sidebar naming can drift.
- No Danger Zone grouping.

Tasks:

1. Dirty state:
   - In Settings form pages such as General/company and profile/settings forms, compare current form values to initially loaded values.
   - Use safe JSON/string comparison if simple.
   - Disable Save when `!isDirty`.
   - Show yellow banner: `You have unsaved changes` when `isDirty && !saving`.

2. Settings layout:
   - Ensure nav names match sidebar exactly:
     - General
     - User Management
     - Teams
     - Customer Groups
     - Permissions
     - Module Settings
     - Module Builder
     - Field Config
     - Integrations
     - Templates
     - Recycle Bin
     - Activity Log
   - Add a `Danger Zone` section at the bottom with red-tinted styling for destructive/system-risk items where appropriate.

3. Do not fake destructive settings.
   - Only place existing destructive/recovery pages there.

Acceptance criteria:

- Settings forms clearly show dirty state.
- Save buttons are not always active.
- Settings nav matches sidebar naming.

---

## Task 12 — Customer Groups Management and Usability

Problem:
Contact detail exposes group selection, but there is no clear settings surface to create/manage customer groups or define group-based settings like discounts/pricing.

Task:
Implement or expose customer group management if existing APIs/hooks already support it.

Inspect:

- `frontend/hooks/useClientPortal.ts`
- existing customer group API/hooks
- contact detail group selection
- organization/account detail group support

Required UX:

1. Settings route:
   - Add `/dashboard/settings/customer-groups`

2. Sidebar/settings nav:
   - Add `Customer Groups` under Settings, near Teams or Permissions.

3. Settings hub:
   - Add a Customer Groups card.

4. Customer Groups page:
   Should allow admins to:
   - view groups
   - create group
   - edit group
   - activate/deactivate group if supported
   - set basic group metadata available from existing API

5. Group-based business settings:
   - If existing API supports discount/pricing fields, expose them.
   - If not supported, show honest copy and document backend gap in `docs/pass4-followup.md`.

6. Contact/account detail:
   - Group selection should link to Customer Groups settings for admins.
   - Copy should explain what customer groups currently affect.
   - If discounts/pricing are not implemented, do not imply discounts already apply.

Rules:

- Do not fake discount logic.
- Do not invent backend fields that do not exist.
- If only group assignment exists today, make the UI honest: group assignment is for segmentation/client portal context until pricing rules exist.

Acceptance criteria:

- Group selection has a proper management surface.
- Admins can create/manage groups if API supports it.
- UI does not imply discounts exist unless actually supported.

---

## Task 13 — Roles & Permissions Polish

Audit benchmark:
Permission systems show role importance/level and explain what permissions mean.

Tasks:

1. Role cards:
   - Add a small colored left accent bar based on `role.level`:
     - `level >= 100` = red/admin
     - `level >= 90` = orange/elevated
     - `level >= 10` = blue/standard
     - else = purple/basic

2. Permission matrix:
   - Add `title` tooltips to permission column headers:
     - view/can_view = `Can view and list records`
     - create/can_create = `Can create new records`
     - edit/can_edit = `Can update existing records`
     - delete/can_delete = `Can move records to recycle bin or delete where allowed`
     - restore/can_restore = `Can restore records from recycle bin`
     - export/can_export = `Can export records`
     - configure/can_configure = `Can configure module settings`

Acceptance criteria:

- Role levels are visually scannable.
- Permission columns are easier to understand.

---

## Task 14 — Module Builder Polish

Audit benchmark:
Field builders show type icons and append new fields naturally.

Tasks:

1. Field type icon mapping:
   Add a simple field type badge map in Module Builder:

```ts
{
  text: "T",
  number: "#",
  date: "📅",
  boolean: "⊙",
  currency: "$",
  email: "@",
  url: "🔗",
  phone: "☎",
  single_select: "▼",
  multi_select: "☰",
  textarea: "¶",
}
```

Render as a small mono badge before the field label.

2. Add Field placement:
   - If the Add Field form currently sits above the field list, move it below existing fields so it feels like appending.
   - Do not add drag-and-drop unless already available; no new packages.

Acceptance criteria:

- Field list is easier to scan.
- Add-field UX feels natural.

---

## Task 15 — Custom Modules Must Use Row Click -> Detail Page Flow

Problem:
Custom modules should behave like normal modules, not old action-column-first admin tables.

Current file:

- `frontend/app/dashboard/custom/[moduleKey]/page.tsx`

Task:
Refactor custom module records to use a normal CRM record flow.

Required behavior:

1. List page:
   - Keep table, search, saved views, column picker, import/export, pagination.
   - Keep `New Record` for quick creation.
   - Rows should be clickable and open a record detail page.
   - The record title/name cell should also link to the detail page.
   - Do not rely on action column as the main way to open/edit records.
   - Remove or minimize action column. If kept, it should only contain secondary actions like delete.

2. Detail page:
   Create route:
   - `frontend/app/dashboard/custom/[moduleKey]/[recordId]/page.tsx`

   The page should show:
   - record name/title
   - back to module list
   - editable fields using existing custom module schema
   - save action
   - activity tab if existing APIs support module/entity activity
   - notes tab if existing record comment APIs support module/entity notes
   - documents tab if existing document linking supports module/entity docs
   - empty states if these panels have no data

3. Editing:
   - Existing record editing should happen on the detail page, not via old action/edit modal as the main pattern.
   - Quick create modal is fine for new records.

4. Custom fields:
   - All active custom fields must render in create, detail/edit, table, saved views, and filters where existing frontend support allows.

Rules:

- Do not add backend endpoints unless existing APIs already support detail fetch/update by record ID.
- If existing hooks already expose record update/delete/fetch, reuse them.
- If detail fetch is missing but record list contains enough data, use the existing hook and document the limitation.

Acceptance criteria:

- Custom module records behave like first-class CRM records.
- Clicking a row opens a detail page.
- Existing records are not primarily edited through list action icons.

---

## Task 16 — Standardize Row Click Behavior Across Modules

Problem:
Mature CRMs let users click records to open details. Action columns should not be the main interaction model.

Task:
Audit major list pages and standardize row interaction.

Apply to:

- Contacts
- Accounts
- Deals
- Tasks where detail page exists
- Products where detail page exists
- Services where detail page exists
- Insertion Orders where detail page exists
- POS invoices where detail/print page exists
- Custom Modules

Rules:

- If a detail page exists, row click opens it.
- Name/title/primary identifier cell should be a visible link.
- Action column should contain only secondary actions.
- If no detail page exists, do not fake navigation; document it in `docs/pass4-followup.md`.

Acceptance criteria:

- Record opening behavior is predictable across modules.
- Action column is no longer the primary UX.

---

## Task 17 — Record Detail Header and Tabs Cleanup

Problem:
Some detail pages still have confusing header/title/tab structure. Owner wants record name + tabs, not large duplicate titles and fake overview placeholders.

Task:
Apply mature record detail structure.

Target pages:

- Contact detail
- Account/Organization detail
- Deal/Opportunity detail
- Custom module record detail from Task 15
- Insertion Order detail from Task 8

Required structure:

- Record name/title at top.
- Back link.
- Primary save/action button.
- Tabs below header.
- Overview tab contains real overview/edit fields.
- Activity/Notes/Documents/Tasks/Follow-up tabs contain their actual panels.
- No `Overview shown above` fake content.
- No duplicate large section titles that fight with tab names.

Acceptance criteria:

- Record pages feel like modern CRM record pages.
- Tabs are meaningful.
- Overview content lives in Overview tab if the tab exists.

---

## Task 18 — Module List Page Layout Consistency

Task:
Standardize operational list pages around one shared pattern.

Apply to:

- Contacts
- Accounts
- Deals
- Tasks
- Documents
- Products
- Services
- POS
- Insertion Orders
- Custom Modules

Contract:

1. Non-sticky PageHeader
2. Toolbar
   - search
   - filters
   - saved view selector if supported
   - column picker if supported
   - import/export if supported
3. Table in ModuleTableShell
4. ModuleTableLoading while loading
5. EmptyState for empty and filtered-empty states
6. Error state with retry where practical
7. Pagination
8. Row click/detail behavior where detail exists

If helpful, create:

- `frontend/components/ui/ModuleListToolbar.tsx`

Acceptance criteria:

- Major module pages feel like one product.
- Toolbars do not randomly differ page to page.

---

## Task 19 — Mature Filtering, Saved Views, and No-Results UX

Task:
Improve filtering/search/saved-view consistency.

Rules:

- Search and filters reset page to 1.
- If a search/filter returns no results, EmptyState should mention that filters may be active.
- Provide clear filter/reset action where filters can lead to no results.
- Saved view search should combine with selected saved-view conditions, not conflict with them.
- Search placement should be consistent.

Apply to:

- Contacts
- Accounts
- Deals
- Insertion Orders
- POS
- Tasks
- Products/Services
- Custom Modules

Acceptance criteria:

- No-results states are helpful.
- Users can recover from over-filtering.

---

## Task 20 — Destructive Action and Recycle UX Consistency

Task:
Audit delete/destructive actions.

Problems to fix:

- Direct delete buttons without confirmation.
- Different delete styles across modules.
- Confusing wording where deletes are soft-delete/recycle.
- Delete actions that do not refresh list/detail state.

Rules:

- Use confirmation dialog for destructive actions.
- Use consistent danger styling.
- If backend uses soft delete, use wording like `Move to Recycle Bin` where appropriate.
- Do not change backend delete behavior.

Apply to:

- Contacts
- Accounts
- Deals
- Tasks
- Products
- Services
- Insertion Orders
- Custom Modules

Acceptance criteria:

- Destructive actions are consistent and safer.

---

## Task 21 — Import/Export UX Consistency

Task:
Audit import/export controls.

Goals:

- Import/export controls appear in the same toolbar area.
- Labels are consistent:
  - `Import CSV`
  - `Export CSV`
- Import success refreshes the list.
- Export buttons do not appear where unsupported.
- Error/success feedback is consistent.

Apply to:

- Contacts
- Accounts
- Deals
- Products/Services
- Insertion Orders
- Custom Modules

Acceptance criteria:

- Import/export feels like shared platform functionality.

---

## Task 22 — Global UI Consistency Fixes

Task:
Apply global UI consistency rules from the owner audit.

Typography scale:

- Page descriptions under PageHeader: `text-sm text-neutral-400`
- Card subtitles: `text-sm text-neutral-500`
- Table cell secondary text: `text-xs text-neutral-500`
- Section labels/headers: `text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500`

Button hierarchy:

- Primary action: `variant="default"`
- Secondary action: `variant="outline"`
- Destructive action: `variant="destructive"`
- Ghost/tertiary action: `variant="ghost"`
- Audit PageHeader action areas and make sure each page has at most one obvious primary action.

Loading states:

- Apply `ModuleTableLoading` to all table components that currently show blank rows or empty states while loading.

Card vs bordered div:

- Use `<Card>` for content containers that hold form fields or data.
- Use raw bordered divs only for metric/stat cards or tiny inline notices where custom styling is intentional.

Acceptance criteria:

- UI feels consistent across modules.
- No obvious mismatched typography/button hierarchy/loading patterns remain.

---

## Task 23 — Naming Consistency Audit

Search and fix user-facing naming only.

Replace visible labels:

- `Sales CRM` -> `Sales`
- `Organizations` -> `Accounts` where user-facing
- `Organization` -> `Account` where user-facing and appropriate
- `Opportunities` -> `Deals`
- `Opportunity` -> `Deal` where user-facing and appropriate
- Remove `Overview` navigation entries
- Remove standalone `WhatsApp` page/nav references

Do not rename:

- backend keys
- API paths
- TypeScript types if risky
- database fields

Acceptance criteria:

- User-facing naming is consistent.
- Internal implementation names can remain if needed.

---

## Task 24 — Scrollbar and Readability QA

Task:
QA scroll behavior after removing sticky headers and fixing sidebar scroll.

Check:

- dashboard main content
- module list pages
- record detail pages
- sidebar collapsed/expanded/hover-expanded
- settings layout nav
- command palette
- dialogs
- ModuleTableShell tables

Rules:

- Hide scrollbars visually where requested, but preserve scroll behavior.
- No unwanted horizontal scrollbars.
- No sticky header covering records/details.
- Tables may scroll horizontally where required.
- Dialogs must be usable on smaller screens.

Acceptance criteria:

- Scrolling feels clean and readable.

---

## Task 25 — Mature CRM Workflow Gap Documentation

Task:
Create or update:

- `docs/pass4-followup.md`

Document backend/API-dependent gaps that cannot be safely solved in this frontend pass.

Include items such as:

- lifecycle stage backend support if missing
- owner assignment backend support if missing
- customer group pricing/discount rules if unsupported
- account status/health backend support if missing
- account open-deal total API gaps if missing
- custom module record detail API gaps if any
- missing detail pages for modules that should have them
- true global summary/count endpoints if dashboards are needed later
- notification preference management if missing
- advanced saved-view condition builders if incomplete
- import/export background job UI gaps if incomplete

Acceptance criteria:

- Frontend-safe work is done now.
- Backend/product gaps are documented clearly instead of hacked into UI.

---

## Task 26 — Final Cleanup and Build

Task:
Final Run 4 cleanup.

Search for:

- `Sales CRM`
- `Overview shown above`
- unwanted `Overview` nav links
- standalone `WhatsApp` page/nav references
- sticky `PageHeader` usage on module pages
- root-level planning docs
- old admin route strings
- custom module action-column primary edit/open patterns
- direct destructive actions without confirmation
- tables showing empty state during loading instead of `ModuleTableLoading`
- settings forms with always-enabled Save where dirty-state is practical

Run:

```bash
npm run lint
npm run build
```

If build is unavailable or unreasonable, document why and run the available lint/type checks.

Acceptance criteria:

- Build passes.
- Owner audit fixes are completed or documented if blocked by backend/API gaps.
- No owner-rejected UX patterns remain.
- No backend files changed unless explicitly justified.
- Product/design guardrails are updated so future Codex runs avoid these mistakes.
