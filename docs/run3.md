You are working on Nightwalker28/crm.

Goal:
Fix the remaining frontend UX/product issues after the routing + UI polish runs.

Frontend only.
Do not change backend, API contracts, database, migrations, or auth/permission logic.
Do not add new packages.
Do not reintroduce old admin routes.
Keep the dark Lynk UI style.

Required fixes:

1. Remove all module overview pages from navigation and UI

We do not want overview pages for modules.

Remove/hide these from sidebar and module navigation:
- Sales Overview
- Finance Overview
- Any Products/Catalog Overview if present
- Any other module-level Overview links

Sidebar should link directly to actual module pages:
- Sales section should show Accounts, Contacts, Deals, Client Portal
- Finance section should show POS and Insertion Orders
- Products & Services should show Products and Services
- Workspace should show Tasks, Calendar, Mail, Documents only

Do not leave "Overview" entries inside collapsible groups.

If pages like /dashboard/sales or /dashboard/finance still exist, they can remain only if required by routing, but do not link to them from sidebar. If safe, remove them completely. Do not create redirects.

2. Rename "Sales CRM" to "Sales"

Everywhere visible in the UI:
- Replace "Sales CRM" with "Sales"

This includes:
- Sidebar labels
- Breadcrumb labels
- Page titles
- Descriptions
- Settings or route label helpers

Keep backend route /dashboard/sales unchanged.

3. Remove large page titles where tabs are used

For detail pages with tabs:
- Do not show a big repeated title plus tab names.
- Keep the record name and the tabs.
- Avoid duplicate heading structure.

For record detail pages:
- Header should show the record name and useful actions.
- Tabs should define the sections.
- Do not add an extra "Overview shown above" placeholder.

Apply to:
- Contact detail
- Account/Organization detail
- Deal/Opportunity detail

For the Overview tab:
- Either move the actual overview content inside the Overview tab, or remove the Overview tab if the overview content stays above.
- Do not keep a fake empty state saying "Overview shown above".

Preferred:
Move the actual overview content into the Overview tab.

4. Custom modules must behave like normal modules

Current issue:
frontend/app/dashboard/custom/[moduleKey]/page.tsx shows a large inline "Add Record" form with all fields always visible. This feels unlike the normal modules.

Fix:
Make custom module list pages behave like normal modules.

Required behavior:
- PageHeader actions should include a "New Record" button.
- Clicking "New Record" opens a modal/dialog or navigates to a create page.
- Do not show the full create form inline above the table.
- Editing a record should also use a modal/dialog or proper detail/edit page, not a large inline form injected into the list.
- Keep the list/table as the main surface.
- Keep search, saved views, column picker, import/export, table, pagination.
- Use existing shared UI patterns:
  - PageHeader
  - Button
  - Dialog if available
  - Field / FieldGroup / FieldLabel
  - RequiredMark
  - ModuleTableShell
  - Table
  - EmptyState

Custom module create/edit form:
- Use a reusable component inside the dialog:
  CustomModuleRecordDialog or similar.
- Dialog size should be max-w-3xl with max-h-[80vh] overflow-y-auto.
- Form grid should use grid gap-4 sm:grid-cols-2.
- Textarea fields should span full width.
- Required fields should use RequiredMark.
- Boolean fields should not look awkward.
- Select fields should use existing Select component where practical instead of raw <select>, if simple to do.
- Multi-select can stay checkbox-based but should be styled consistently.

List page:
- If there are no records, show shared EmptyState.
- Main page should not have create/edit form visible unless dialog is open.
- Actions column should have Edit/Delete buttons like normal modules.

Acceptance:
- Custom modules feel like first-class normal modules.
- No permanent inline add/edit form remains on the list page.

5. Remove WhatsApp page from sidebar/navigation

There is no need for a standalone WhatsApp page if it just says open contacts.

Remove WhatsApp from sidebar Workspace.
Do not show WhatsApp as a main module page.

Keep WhatsApp functionality inside contact/detail workflows if already working.
Do not remove WhatsApp click-to-chat actions from contacts.
Only remove the standalone WhatsApp page/navigation.

If /dashboard/whatsapp exists and is unused, remove it if safe.
Do not leave a dead navigation item.

6. Hide vertical scrollbars visually for main app views

Hide visible vertical scrollbars while preserving scroll behavior.

Apply to:
- Dashboard main content scroll area
- Sidebar nav scroll area
- Settings layout/nav if it scrolls
- ModuleTableShell where appropriate

Rules:
- Do not break scrolling.
- Use existing custom-scrollbar utility if available.
- If custom-scrollbar currently shows a visible bar, add a scrollbar-hide utility or update CSS safely.
- Avoid horizontal layout shift.

7. Fix sidebar horizontal scrollbar issue

Current issue:
When opening a sidebar tab/collapsible group, a horizontal scrollbar sometimes appears.

Fix:
- Ensure SidebarNav and sidebar menu containers use overflow-x-hidden.
- Ensure long labels truncate instead of forcing horizontal overflow.
- Ensure child collapsible areas do not exceed sidebar width.
- Check collapsed and hover-expanded states.
- Do not allow horizontal scrolling inside sidebar.
- Keep vertical scrolling.

Likely files:
- frontend/components/sidebar/Sidebar.tsx
- frontend/components/sidebar/SidebarNav.tsx

Acceptance:
- Opening Sales, Finance, Settings, Custom Modules does not create horizontal scrollbar.
- Long custom module names truncate cleanly.

8. Fix global search / command palette search behavior

Current issue:
When typing around 3 characters, search often shows "No matches found".

Investigate:
- frontend/components/search/GlobalCommandPalette.tsx
- related search hooks/API calls
- debounce logic
- min search length condition
- response handling
- filtering logic
- permission/module route mapping

Fix requirements:
- Search should not prematurely show "No matches found" while request is loading/debouncing.
- It should show "Searching..." or loading state while fetching.
- It should only show "No matches found" after a completed query returns empty.
- Trim the search string before querying.
- Do not search on empty input.
- If backend requires 2 or 3 characters, make the UI copy clear.
- Make sure 3-character queries are actually sent if allowed.
- Check that results are not being filtered out by outdated route mapping after the settings route migration.
- Make sure result links use canonical routes where relevant.

Acceptance:
- Typing 3+ characters performs a real search.
- Loading state appears while fetching.
- "No matches found" only appears after a completed empty result.
- Search result links still work.

9. Clean labels and wording

Apply these visible label rules:
- "Sales CRM" -> "Sales"
- "Organizations" -> "Accounts" where user-facing
- "Opportunities" -> "Deals" where user-facing
- Remove "Overview" navigation entries
- Remove standalone "WhatsApp" navigation entry
- Keep backend module keys unchanged.

10. Final cleanup

After changes:
- Search for old visible labels:
  - "Sales CRM"
  - "Overview" in sidebar nav
  - standalone "WhatsApp" sidebar item
  - "Overview shown above"
- Search for old admin route strings and ensure none came back.
- Search for root-level planning docs and remove unnecessary duplicate planning files like "Final Canonical Route Scheme.md" if still present.
- Run:
  npm run lint
  npm run build

Acceptance:
- Sidebar is clean with no overview links.
- Detail pages use record name + tabs properly.
- Custom modules behave like normal modules.
- WhatsApp standalone page/nav is removed.
- Scrollbars are visually hidden where requested.
- Sidebar has no horizontal scrollbar.
- Global search behaves correctly.
- Build passes.