# Run 1 — Routing, Settings, Navigation, Cleanup

## Goal

You are working on `Nightwalker28/crm`.

Run 1 goal: complete the routing and navigation migration cleanly.

This run must:

1. Create a proper canonical `/dashboard/settings/*` route structure.
2. Move admin/configuration pages into Settings.
3. Update sidebar navigation to use the final production routing scheme.
4. Add a Settings hub and Settings layout.
5. Update access guards and breadcrumbs.
6. Add shared route constants and friendly label helpers.
7. Replace all old route links.
8. Use temporary redirects only during migration.
9. Before finishing, remove old legacy route files completely after all links are updated and tests/build pass.
10. Leave no unused redirect files, duplicated page implementations, or dead route code.

## Hard Rules

- Do not change backend files.
- Do not change API contracts.
- Do not change database/migrations.
- Do not rename backend module keys.
- Do not change permission behavior.
- Do not add new packages.
- Keep TypeScript clean.
- Keep the existing dark/neutral Lynk UI style.

---

## Final Canonical Route Scheme

### Operational routes

```text
/dashboard
/dashboard/tasks
/dashboard/calendar
/dashboard/mail
/dashboard/whatsapp
/dashboard/documents

/dashboard/sales
/dashboard/sales/organizations      visible label: Accounts
/dashboard/sales/contacts           visible label: Contacts
/dashboard/sales/opportunities      visible label: Deals
/dashboard/client-portal            visible label: Client Portal

/dashboard/catalog/products
/dashboard/catalog/services

/dashboard/finance
/dashboard/finance/pos
/dashboard/finance/insertion-orders

/dashboard/custom/[moduleSlug]
```

### Canonical Settings routes

```text
/dashboard/settings
/dashboard/settings/general
/dashboard/settings/users
/dashboard/settings/teams
/dashboard/settings/permissions
/dashboard/settings/modules
/dashboard/settings/modules/[moduleId]
/dashboard/settings/module-builder
/dashboard/settings/fields
/dashboard/settings/integrations
/dashboard/settings/message-templates
/dashboard/settings/recycle-bin
/dashboard/settings/activity-log
```

### Old routes that must not remain in final state

```text
/dashboard/company
/dashboard/users
/dashboard/user/teams
/dashboard/roles-permissions
/dashboard/modules
/dashboard/modules/[moduleId]
/dashboard/module-builder
/dashboard/custom-fields
/dashboard/integrations
/dashboard/recycle-bin
/dashboard/activity-log
```

---

## Task 1 — Route Inventory

Before editing, inventory current frontend routes.

Inspect:

- `frontend/app/dashboard/**`
- `frontend/components/sidebar/Sidebar.tsx`
- `frontend/app/dashboard/layout.tsx`
- `frontend/hooks/useAccessibleModules.ts`
- `frontend/hooks/admin/useModulesAdmin.ts`

Create an internal migration checklist:

- current route
- final canonical route
- files importing/linking to old route
- whether page is operational or settings/admin
- whether page logic should move or be extracted

Do not edit yet until affected files are identified.

Acceptance criteria:

- Every affected route is known before moving files.
- No accidental route deletion.

---

## Task 2 — Create Route Constants

Create:

```text
frontend/lib/routes.ts
```

Export:

- `DASHBOARD_ROUTES`
- `SETTINGS_ROUTES`
- `getFriendlyRouteLabel(pathOrSegment: string): string`

`DASHBOARD_ROUTES`:

```ts
home: "/dashboard"
sales: "/dashboard/sales"
accounts: "/dashboard/sales/organizations"
contacts: "/dashboard/sales/contacts"
deals: "/dashboard/sales/opportunities"
clientPortal: "/dashboard/client-portal"
finance: "/dashboard/finance"
financePos: "/dashboard/finance/pos"
insertionOrders: "/dashboard/finance/insertion-orders"
products: "/dashboard/catalog/products"
services: "/dashboard/catalog/services"
```

`SETTINGS_ROUTES`:

```ts
root: "/dashboard/settings"
general: "/dashboard/settings/general"
users: "/dashboard/settings/users"
teams: "/dashboard/settings/teams"
permissions: "/dashboard/settings/permissions"
modules: "/dashboard/settings/modules"
moduleAccess: (moduleId: string | number) => `/dashboard/settings/modules/${moduleId}`
moduleBuilder: "/dashboard/settings/module-builder"
fields: "/dashboard/settings/fields"
integrations: "/dashboard/settings/integrations"
templates: "/dashboard/settings/message-templates"
recycleBin: "/dashboard/settings/recycle-bin"
activityLog: "/dashboard/settings/activity-log"
```

Friendly label map:

- `organizations` -> `Accounts`
- `opportunities` -> `Deals`
- `sales` -> `Sales CRM`
- `company` / `general` -> `General`
- `users` -> `User Management`
- `teams` -> `Teams`
- `roles-permissions` / `permissions` -> `Permissions`
- `modules` -> `Module Settings`
- `module-builder` -> `Module Builder`
- `custom-fields` / `fields` -> `Field Config`
- `recycle-bin` -> `Recycle Bin`
- `activity-log` -> `Activity Log`
- `message-templates` -> `Templates`

Acceptance criteria:

- New/updated links use these constants where practical.
- No route strings drift across the codebase.

---

## Task 3 — Create Module Display Helper

Create:

```text
frontend/lib/module-display.ts
```

Export:

- `getModuleDisplayName(moduleName: string, fallbackDescription?: string): string`
- `getModuleCategory(moduleName: string): "Workspace" | "Sales CRM" | "Products & Services" | "Finance" | "Platform" | "Custom Modules" | "Other"`
- `formatSnakeCaseLabel(value: string): string`

Display map:

- `tasks` -> `Tasks`
- `calendar` -> `Calendar`
- `mail` -> `Mail`
- `whatsapp` -> `WhatsApp`
- `documents` -> `Documents`
- `message_templates` -> `Templates`
- `sales_contacts` -> `Contacts`
- `sales_organizations` -> `Accounts`
- `sales_opportunities` -> `Deals`
- `catalog_products` -> `Products`
- `catalog_services` -> `Services`
- `finance_io` -> `Insertion Orders`
- `finance_pos` -> `POS`

Custom module rule:

- If description starts with `Custom module:`, remove that prefix.
- Otherwise convert snake_case to Title Case.

Use in:

- Sidebar
- Module Settings table
- Module Access page
- Any visible module list

Acceptance criteria:

- UI does not show raw backend module keys where friendly labels exist.
- Backend keys are untouched.

---

## Task 4 — Move Settings Pages to Canonical Routes

Move admin/configuration pages into canonical Settings routes.

Move or extract page logic into:

```text
frontend/app/dashboard/settings/general/page.tsx
from old /dashboard/company

frontend/app/dashboard/settings/users/page.tsx
from old /dashboard/users

frontend/app/dashboard/settings/teams/page.tsx
from old /dashboard/user/teams

frontend/app/dashboard/settings/permissions/page.tsx
from old /dashboard/roles-permissions

frontend/app/dashboard/settings/modules/page.tsx
from old /dashboard/modules

frontend/app/dashboard/settings/modules/[moduleId]/page.tsx
from old /dashboard/modules/[moduleId]

frontend/app/dashboard/settings/module-builder/page.tsx
from old /dashboard/module-builder

frontend/app/dashboard/settings/fields/page.tsx
from old /dashboard/custom-fields

frontend/app/dashboard/settings/integrations/page.tsx
from old /dashboard/integrations

frontend/app/dashboard/settings/recycle-bin/page.tsx
from old /dashboard/recycle-bin

frontend/app/dashboard/settings/activity-log/page.tsx
from old /dashboard/activity-log
```

Message templates:

- Keep canonical `/dashboard/settings/message-templates`.
- If it already exists, do not duplicate it.

Important:

- Do not duplicate full page implementations.
- Prefer moving files to canonical route.
- If shared extraction is cleaner, extract a page component and render it from canonical route only.
- During migration, temporary redirect wrappers are allowed, but they must be deleted before Run 1 ends after all links are updated.

Acceptance criteria:

- Canonical settings routes render real pages.
- Page behavior remains unchanged.
- No backend changes.

---

## Task 5 — Settings Layout

Create:

```text
frontend/app/dashboard/settings/layout.tsx
```

Goal:

All `/dashboard/settings/*` pages should feel like one Settings area.

Layout:

- Do not create another dashboard shell.
- Render inside existing dashboard shell.
- Desktop: left settings nav + right content.
- Mobile: horizontal scrollable nav above content.
- Use dark neutral styling.

Settings nav:

- General
- User Management
- Teams
- Permissions
- Module Settings
- Module Builder
- Field Config
- Integrations
- Templates
- Recycle Bin
- Activity Log

Use:

- `SETTINGS_ROUTES` from `frontend/lib/routes.ts`
- `usePathname` for active state

Acceptance criteria:

- Settings nav appears on all `/dashboard/settings/*` pages.
- Active settings route is highlighted.
- Mobile does not overflow badly.

---

## Task 6 — Settings Hub

Create:

```text
frontend/app/dashboard/settings/page.tsx
```

Use `PageHeader`.

Title:

```text
Settings
```

Description:

```text
Manage company setup, users, access control, modules, integrations, templates, and platform configuration.
```

Create section cards:

Organization:

- General
- User Management
- Teams

Access Control:

- Permissions
- Module Settings

Customization:

- Module Builder
- Field Config
- Templates

System:

- Integrations
- Recycle Bin
- Activity Log

Each card:

- icon
- title
- description
- Open affordance
- link to canonical `SETTINGS_ROUTES` only

Acceptance criteria:

- Settings page is polished and useful.
- No backend calls needed.

---

## Task 7 — Dashboard Access Guard

Update:

```text
frontend/app/dashboard/layout.tsx
```

Add admin-only protection for:

```text
/dashboard/settings
/dashboard/settings/general
/dashboard/settings/users
/dashboard/settings/teams
/dashboard/settings/permissions
/dashboard/settings/modules
/dashboard/settings/module-builder
/dashboard/settings/fields
/dashboard/settings/integrations
/dashboard/settings/message-templates
/dashboard/settings/recycle-bin
/dashboard/settings/activity-log
```

Remove old admin-only prefixes only after old route files are removed:

```text
/dashboard/company
/dashboard/users
/dashboard/user/teams
/dashboard/roles-permissions
/dashboard/modules
/dashboard/module-builder
/dashboard/custom-fields
/dashboard/integrations
/dashboard/recycle-bin
/dashboard/activity-log
```

Keep module route access checks for operational modules.

Acceptance criteria:

- Settings routes are admin-only.
- Operational module access still works.
- No old admin route prefixes remain after cleanup.

---

## Task 8 — Sidebar Final Navigation

Refactor:

```text
frontend/components/sidebar/Sidebar.tsx
```

Final sidebar:

Main:

- Dashboard

Workspace:

- Tasks
- Calendar
- Mail
- WhatsApp
- Documents

Sales CRM:

- Overview
- Accounts
- Contacts
- Deals
- Client Portal

Products & Services:

- Products
- Services

Finance:

- Overview
- POS
- Insertion Orders

Custom Modules:

- Dynamic custom modules

Settings:

- Settings Overview
- General
- User Management
- Teams
- Permissions
- Module Settings
- Module Builder
- Field Config
- Integrations
- Templates

Rules:

- Settings group only shows for admins.
- Sidebar links must use canonical `SETTINGS_ROUTES`.
- No Recycle Bin or Activity Log in main sidebar.
- Recycle Bin and Activity Log stay inside Settings hub/layout.
- Use route constants.
- Use friendly labels.
- Keep collapsed sidebar behavior.
- Add section labels/dividers.
- Improve active indicator with subtle left accent/border.

Acceptance criteria:

- No sidebar links point to removed old routes.
- Navigation is clean and CRM/ERP-like.

---

## Task 9 — Breadcrumb Bar

Update:

```text
frontend/app/dashboard/layout.tsx
```

Rules:

- Breadcrumbs use `getFriendlyRouteLabel`.
- GlobalCommandPalette should sit in the same top bar as breadcrumbs if clean.
- Do not create duplicate page headers.
- Keep existing command palette behavior.

Examples:

```text
/dashboard/settings/modules/1
Dashboard > Settings > Module Settings > Access Settings

/dashboard/settings/users
Dashboard > Settings > User Management

/dashboard/sales/organizations
Dashboard > Sales CRM > Accounts

/dashboard/sales/opportunities
Dashboard > Sales CRM > Deals
```

Acceptance criteria:

- Breadcrumbs reflect canonical route scheme.
- Labels are clean.

---

## Task 10 — Module Settings UI Update

Update canonical module settings pages:

```text
frontend/app/dashboard/settings/modules/page.tsx
frontend/app/dashboard/settings/modules/[moduleId]/page.tsx
```

Changes:

- Page title: `Module Settings`
- Description: `Enable or disable CRM modules, set module defaults, and control which teams or departments can access each module.`
- Use `getModuleDisplayName` for module labels.
- Rename column `Import Duplicate Default` to `Duplicate Handling`.
- Rename button `Configure` to `Access Settings`.
- Access page title: `{Friendly Module Name} Access Settings`.
- Links should use `SETTINGS_ROUTES.moduleAccess`.

Rules:

- Keep `useModulesAdmin` behavior.
- Keep `useModuleAccessAdmin` behavior.
- Do not change backend keys or payloads.

Acceptance criteria:

- Module enable/disable works.
- Module access save works.
- No raw module keys shown unnecessarily.

---

## Task 11 — Link Audit and Old Route Removal

Audit all frontend links/imports for old routes.

Search for:

```text
/dashboard/company
/dashboard/users
/dashboard/user/teams
/dashboard/roles-permissions
/dashboard/modules
/dashboard/module-builder
/dashboard/custom-fields
/dashboard/integrations
/dashboard/recycle-bin
/dashboard/activity-log
```

Update all app links to canonical routes.

After updating links:

1. Run lint/build.
2. If successful, delete old route files completely.
3. Do not leave redirect wrappers in final state.
4. Remove old admin-only prefixes from dashboard layout.
5. Search again to confirm old routes are gone, except in comments/changelog if unavoidable.

Acceptance criteria:

- No old route files remain.
- No old links remain.
- No permanent redirects remain.
- Build passes.

---

## Stop Point After Run 1

Stop after Task 11.

Do not continue into UI polish.

Run 1 is complete only when:

1. Canonical `/dashboard/settings/*` routes exist and work.
2. Sidebar uses only canonical settings routes.
3. Settings layout and Settings hub exist.
4. Access guard protects `/dashboard/settings/*`.
5. Breadcrumbs use clean labels.
6. Module Settings page is under `/dashboard/settings/modules`.
7. Old admin/config route links have been replaced.
8. Old admin/config route files are deleted.
9. No permanent redirect wrappers remain.
10. `npm run lint` passes.
11. `npm run build` passes, if build is available and reasonable.
12. No backend files were changed.

Do not start empty states, dialogs, tabs, finance polish, sales polish, notification polish, or mobile polish in Run 1.
