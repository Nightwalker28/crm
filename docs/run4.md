# Run 4 — CRM Maturity, Product UX, and Workflow Corrections

## Goal

You are working on `Nightwalker28/crm`.

Run 4 goal: fix the remaining product/UX mistakes from the previous passes and move Lynk closer to a mature CRM/ERP experience.

This run prioritizes the product corrections requested by the owner first, then broader mature CRM consistency improvements.

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
- Do not change backend contracts without a clear existing endpoint or explicit small safe addition.
- Do not add new packages.
- Do not reintroduce old admin routes.
- Do not reintroduce module overview pages.
- Do not reintroduce standalone WhatsApp navigation.
- Do not keep old list-page action-tab patterns when record click/detail-page flow is expected.
- Do not keep sticky module headers if they block readability.
- Keep backend module keys unchanged.
- Keep the dark Lynk visual style.
- Prefer shared UI primitives over one-off page-specific UI.

---

## Task 1 — Add Permanent Product/Design Guardrails for Codex

Problem:
Codex repeated patterns that were already rejected: sticky module headers, old action-column-only custom module UX, and modal/edit-only record behavior.

Task:
Update the repo guidance so future Codex runs do not repeat these mistakes.

Files to update:

- `docs/product-rules.md`
- `docs/architecture.md`
- If a suitable `.codex/skills/*` skill exists, update it.
- If no suitable frontend/product UX skill exists, create one such as `.codex/skills/frontend-product-ux/SKILL.md`.

Add product/design rules:

1. Module list pages should not use sticky page/module headers if they cover table rows or record details while scrolling.
2. Page headers may stay at the top of the page, but they should scroll normally unless a specific compact sticky toolbar is intentionally designed.
3. Operational records should prefer row-click/detail-page navigation after creation.
4. List pages should not rely mainly on action columns for normal record opening.
5. Action columns are allowed only for secondary quick actions such as edit/delete/print, not as the main record interaction.
6. Custom modules must behave like first-class operational modules, not builder/admin forms.
7. Custom module records should support normal list -> detail -> edit workflow where existing APIs allow it.
8. Quick create can use a modal, but existing records should open a detail page where practical.
9. Do not create module overview pages unless the owner explicitly asks.
10. Standalone WhatsApp page/navigation is not wanted; WhatsApp stays as contextual contact workflow.
11. Sidebar should avoid duplicated section labels and collapsible labels.
12. Customer groups must have an admin/settings management surface before they are exposed heavily in contact/account detail workflows.

Acceptance criteria:

- Future agents have clear written rules.
- The rules are added to source-of-truth docs/skills, not only to this Run 4 file.

---

## Task 2 — Remove Sticky Module/Page Header Behavior

Problem:
The sticky module header hurts readability. When scrolling records/details, the header stays on top and blocks useful content.

Current likely file:

- `frontend/components/ui/PageHeader.tsx`

Task:
Make module/page headers non-sticky by default.

Required changes:

- Remove `sticky top-0` behavior from `PageHeader`.
- Keep the visual style, title, description, and actions.
- Preserve spacing and dark styling.
- If any page truly needs sticky behavior, make it opt-in with a prop such as `sticky?: boolean`, defaulting to false.
- Do not enable sticky on module list/detail pages.

Acceptance criteria:

- Scrolling list/detail pages no longer keeps the full header pinned over records.
- Readability improves.
- No page loses its title/actions.

---

## Task 3 — Sidebar Final Structure Based on Owner Audit

Problem:
Sidebar should not have conflicting patterns or duplicate labels. Previous plans had section label + identical collapsible label, which is visually repetitive.

Task:
Make sidebar flat, clear, and mature.

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
- If a section has only a few items, use direct child links under the section instead of another collapsible with the same name.
- Settings can remain grouped, but avoid duplicated wording.
- Custom module names must truncate cleanly.
- No horizontal scrollbar in sidebar in collapsed, expanded, or hover-expanded states.
- Keep vertical scrolling functional but visually clean.

Files:

- `frontend/components/sidebar/Sidebar.tsx`
- `frontend/components/sidebar/SidebarNav.tsx`

Acceptance criteria:

- Sidebar has no repeated label/collapsible conflict.
- No unwanted horizontal scrollbar.
- No overview links.
- No WhatsApp standalone nav.

---

## Task 4 — Remove or Fully Decommission Unwanted Overview Pages

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

## Task 5 — Custom Modules Must Use Row Click -> Detail Page Flow

Problem:
Custom modules still use an old-style action column pattern. The owner specifically asked not to use that going forward. Custom modules should behave like normal modules.

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
   - Remove or minimize action column. If kept, it should only contain secondary actions like delete, not normal open/edit.

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
- No old action-tab style.

Acceptance criteria:

- Custom module records behave like first-class CRM records.
- Clicking a row opens a detail page.
- Existing records are not primarily edited through list action icons.

---

## Task 6 — Standardize Row Click Behavior Across Modules

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

## Task 7 — Customer Groups Management and Usability

Problem:
Contact detail exposes group selection, but there is no clear settings surface to create/manage customer groups or define group-based settings like discount/pricing behavior.

Task:
Implement or expose customer group management if existing APIs/hooks already support it.

Inspect:

- `frontend/hooks/useClientPortal.ts`
- existing backend routes for customer groups if needed only to understand available API
- contact detail group selection
- organization/account detail group support

Required UX:

1. Settings route:
   Add a canonical route:
   - `/dashboard/settings/customer-groups`

2. Sidebar/settings nav:
   Add `Customer Groups` under Settings, near Teams or Field Config.

3. Settings hub:
   Add a Customer Groups card.

4. Customer Groups page:
   Should allow admins to:
   - view groups
   - create group
   - edit group
   - activate/deactivate group if supported
   - set basic group metadata available from existing API

5. Group-based business settings:
   If existing API supports discount/pricing fields, expose them.
   If not supported yet, add a clear read-only/coming-soon note and document backend gap in `docs/pass4-followup.md`.

6. Contact/account detail:
   - Group selection should link to Customer Groups settings for admins.
   - Copy should explain what customer groups currently affect.
   - If discounts/pricing are not implemented, do not imply that discounts already apply.

Rules:

- Do not fake discount logic.
- Do not invent backend fields that do not exist.
- If only group assignment exists today, make the UI honest: group assignment is for segmentation/client portal context until pricing rules exist.

Acceptance criteria:

- Group selection has a proper management surface.
- Admins can understand/create/manage groups if API supports it.
- UI does not imply discounts exist unless actually supported.

---

## Task 8 — Record Detail Header and Tabs Cleanup

Problem:
Some detail pages still have confusing header/title/tab structure. Owner wants record name + tabs, not large duplicate titles and fake overview placeholders.

Task:
Apply the mature record detail contract.

Target pages:

- Contact detail
- Account/Organization detail
- Deal/Opportunity detail
- Custom module record detail from Task 5

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

## Task 9 — Module List Page Layout Consistency

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
4. EmptyState
5. Error state with retry where practical
6. Pagination
7. Row click/detail behavior where detail exists

If helpful, create:

- `frontend/components/ui/ModuleListToolbar.tsx`

Acceptance criteria:

- Major module pages feel like one product.
- Toolbars do not randomly differ page to page.

---

## Task 10 — Mature Filtering, Saved Views, and No-Results UX

Task:
Improve filtering/search/saved-view consistency.

Rules:

- Search and filters reset page to 1.
- If a search/filter returns no results, EmptyState should mention that filters may be active.
- Provide clear filter/reset action where filters can lead to no results.
- Saved view search should not conflict with local search.
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

## Task 11 — Destructive Action and Recycle UX Consistency

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

## Task 12 — Import/Export UX Consistency

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

## Task 13 — Customer/Account Group Semantics Audit

Task:
Make group wording and behavior honest and consistent.

Audit:

- Contact detail group selector
- Account/organization detail page
- Client portal pages
- Settings/customer groups page from Task 7

Rules:

- Do not imply group discounts/pricing are active unless implemented.
- If groups are currently only segmentation/client portal context, say that clearly.
- If group pricing/discount settings exist, surface them in settings.
- If they do not exist, document required backend work in `docs/pass4-followup.md`.

Acceptance criteria:

- Group UX is understandable and not misleading.

---

## Task 14 — Naming Consistency Audit

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

## Task 15 — Scrollbar and Readability QA

Task:
QA scroll behavior after removing sticky headers.

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

## Task 16 — Mature CRM Workflow Gap Documentation

Task:
Create or update:

- `docs/pass4-followup.md`

Document backend/API-dependent gaps that cannot be safely solved in this frontend pass.

Include items such as:

- customer group pricing/discount rules if unsupported
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

## Task 17 — Final Cleanup and Build

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

Run:

```bash
npm run lint
npm run build
```

If build is unavailable or unreasonable, document why and run the available lint/type checks.

Acceptance criteria:

- Build passes.
- No owner-rejected UX patterns remain.
- No backend files changed unless explicitly justified.
- Product/design guardrails are updated so future Codex runs avoid these mistakes.
