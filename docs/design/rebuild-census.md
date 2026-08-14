# Lynk frontend rebuild: the census

Produced by sub-phase 5.0 of [`rebuild.md`](./rebuild.md). This is the denominator for
scoping decision 5 — *total coverage, every page, every component, no representative
subsets*. **"Did we skip anything" is answered by reading this table, not from memory.**

**A sub-phase is not done while a row it owns is unmarked.**

---

## How to read it

**Owner** is the sub-phase that *rebuilds* the file. Other sub-phases may touch it — 5.2
sweeps hand-rolled boxes almost everywhere, 5.9 sweeps copy almost everywhere — but exactly
one sub-phase is accountable for the file's final shape.

**Verdict:**

| | Meaning |
|---|---|
| `rebuild` | Rewritten by its owning sub-phase |
| `adopt` | Kept, edited to consume a shared primitive or archetype |
| `delete` | Goes away; its callers move to the replacement |
| `unchanged` | Deliberately not touched, with a reason |

**Status** is empty until the owning sub-phase closes the row. Mark it `done` there, in the
same change.

---

## Correction to the coverage contract

`rebuild.md` puts the denominator at **289**. It is **327**, and the missing 38 are not
trivia:

| Group | Contract | Actual |
|---|---|---|
| `app/**/page.tsx` | 116 | 116 |
| `app/**/layout.tsx` | 4 | 4 |
| **`app/**` route boundaries and shell** | **not counted** | **38** |
| `components/**` (non-`ui`) | 115 | 115 |
| `components/ui/` | 54 | 54 |
| **Total** | 289 | **327** |

The 38 are `error.tsx`, `loading.tsx`, `not-found.tsx`, `providers.tsx`, `ClientLayout.tsx`
and `AuthCallbackClient.tsx`. **Fourteen `error.tsx` files exist in four different sizes** —
3, 7, 14 and 18 lines — which means the §7.4 error state has four shapes at the route
boundary, in the one place `PageShell` cannot supply it. The audit measured error-state drift
*inside* pages and missed it at the boundary entirely.

They are assigned to **5.1**, because the fix is one shape drawn from `RouteStates` rather
than 38 decisions.

`app/globals.css` is listed too — it is the token source of truth and 5.1 edits it.

`hooks/` (46 files) and `lib/` (23) are **not** in the denominator: they are data plumbing,
not surfaces. The design-relevant exceptions are listed in §5 below, and they are the only
ones any sub-phase touches for design reasons.

---

## 1. `app/` — routes, layouts and boundaries (158)

### 1.1 Root and shell (7)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `layout.tsx` | 49 | 5.1 | adopt | Font and theme wiring | |
| `page.tsx` | 36 | 5.8 | rebuild | The marketing/entry surface | |
| `loading.tsx` | 11 | 5.1 | rebuild | One route-boundary shape | |
| `providers.tsx` | 60 | 5.1 | adopt | `MotionConfig` lives here | |
| `ClientLayout.tsx` | 16 | 5.1 | adopt | | |
| `globals.css` | — | 5.1 | rebuild | Tokens: rail widths, the retired 5-step, `text-base` | |
| `runtime-config.js/route.ts` | — | — | unchanged | Not a surface | |

### 1.2 `app/auth/**` (5)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `auth/layout.tsx` | 40 | 5.8 | rebuild | **Tokenise the raw `rgba()`, do not delete it.** §9 identity | |
| `auth/login/page.tsx` | 426 | 5.8 | rebuild | Keeps its hand-authored Google/Microsoft marks (§5) | |
| `auth/setup-password/page.tsx` | 158 | 5.8 | rebuild | | |
| `auth/callback/page.tsx` | 10 | 5.8 | unchanged | Shim | |
| `auth/callback/AuthCallbackClient.tsx` | 61 | 5.8 | adopt | | |

### 1.3 `app/client/**` — the portal (17)

All 17 today hand-roll `min-h-screen bg-app` and the `font-lynk` wordmark; there is no
`app/client/layout.tsx`. 5.8 adds one.

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `client/layout.tsx` | — | 5.8 | **new** | Does not exist. The root cause of Layer 6 | |
| `client/page.tsx` | 145 | 5.8 | rebuild | | |
| `client/login/page.tsx` | 94 | 5.8 | rebuild | Decide vs `/auth/login` and write the choice into §9 | |
| `client/setup/page.tsx` | 146 | 5.8 | rebuild | | |
| `client/bookings/page.tsx` | 76 | 5.8 | rebuild | | |
| `client/bookings/[bookingId]/page.tsx` | 115 | 5.8 | rebuild | Archetype 2, rail collapsed | |
| `client/catalog/page.tsx` | 80 | 5.8 | rebuild | | |
| `client/catalog/[kind]/[itemId]/page.tsx` | 108 | 5.8 | rebuild | Archetype 2 | |
| `client/documents/page.tsx` | 73 | 5.8 | rebuild | | |
| `client/messages/page.tsx` | 116 | 5.8 | rebuild | | |
| `client/messages/[messageId]/page.tsx` | 103 | 5.8 | rebuild | Archetype 2 | |
| `client/orders/page.tsx` | 76 | 5.8 | rebuild | | |
| `client/orders/[orderId]/page.tsx` | 88 | 5.8 | rebuild | `RecordTable variant="readOnly"` (R10) | |
| `client/quotes/page.tsx` | 81 | 5.8 | rebuild | | |
| `client/quotes/[quoteId]/page.tsx` | 154 | 5.8 | rebuild | Archetype 2 | |
| `client/support/page.tsx` | 155 | 5.8 | rebuild | | |
| `client/support/[caseId]/page.tsx` | 126 | 5.8 | rebuild | Archetype 2 | |
| `client/pages/[token]/page.tsx` | 209 | 5.8 | rebuild | `variant="readOnly"`. Unwalked by the guard today | |

### 1.4 `app/public/**` and `app/book/**` (2)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `public/quotes/proposal/[token]/page.tsx` | 233 | 5.8 | rebuild | Unwalked by the guard today | |
| `book/[...bookingPath]/page.tsx` | 18 | 5.7 | unchanged | Shim to `PublicBookingPage`; the calendar grid is 5.7 | |

### 1.5 `app/e2e/**` (3)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `e2e/contract-transport/page.tsx` | 11 | — | unchanged | Test-only, blocked in production by `proxy.ts` | done |
| `e2e/quick-create/page.tsx` | 11 | — | unchanged | same | done |
| `e2e/record-layout/page.tsx` | 10 | — | unchanged | same | done |

### 1.6 `app/dashboard/` — shell and sales (33)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `dashboard/layout.tsx` | 170 | 5.7 | adopt | The `h1` sequence is closed; the backdrop is §9 | |
| `dashboard/page.tsx` | 475 | 5.7 | rebuild | Archetype 5. A9: an admin-only href with no `isAdmin` check at `:404` | |
| `dashboard/error.tsx` | 7 | 5.1 | rebuild | | |
| `dashboard/loading.tsx` | 9 | 5.1 | rebuild | | |
| `dashboard/not-found.tsx` | 5 | 5.1 | rebuild | | |
| `dashboard/profile/page.tsx` | 512 | 5.6 | rebuild | Reads as settings; goes on archetype 4 | |
| `sales/leads/page.tsx` | 158 | 5.5 | rebuild | | |
| `sales/leads/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `sales/leads/[leadId]/page.tsx` | 569 | 5.3 | rebuild | Archetype 1 today; tab-order default is wrong | |
| `sales/leads/[leadId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `sales/leads/[leadId]/convert/page.tsx` | 60 | 5.3 | rebuild | **A13** — no unsaved-changes guard | |
| `sales/leads/error.tsx` | 3 | 5.1 | rebuild | | |
| `sales/leads/loading.tsx` | 2 | 5.1 | rebuild | | |
| `sales/leads/not-found.tsx` | 2 | 5.1 | rebuild | | |
| `sales/contacts/page.tsx` | 111 | 5.5 | rebuild | | |
| `sales/contacts/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `sales/contacts/[contactId]/page.tsx` | 936 | 5.3 | rebuild | No `RecordActivityFeed` though leads have one | |
| `sales/contacts/[contactId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `sales/contacts/error.tsx` | 3 | 5.1 | rebuild | | |
| `sales/contacts/loading.tsx` | 2 | 5.1 | rebuild | | |
| `sales/contacts/not-found.tsx` | 2 | 5.1 | rebuild | | |
| `sales/organizations/page.tsx` | 60 | 5.5 | rebuild | | |
| `sales/organizations/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `sales/organizations/[orgId]/page.tsx` | 869 | 5.3 | rebuild | No activity feed | |
| `sales/organizations/[orgId]/edit/page.tsx` | 9 | 5.4 | unchanged | Shim | |
| `sales/organizations/error.tsx` | 3 | 5.1 | rebuild | | |
| `sales/organizations/loading.tsx` | 2 | 5.1 | rebuild | | |
| `sales/organizations/not-found.tsx` | 2 | 5.1 | rebuild | | |
| `sales/opportunities/page.tsx` | 69 | 5.5 | rebuild | | |
| `sales/opportunities/new/page.tsx` | 3 | 5.4 | unchanged | Shim | |
| `sales/opportunities/[opportunityId]/page.tsx` | 565 | 5.3 | rebuild | **Nested tabs at `:507`** | |
| `sales/opportunities/[opportunityId]/edit/page.tsx` | 6 | 5.4 | unchanged | Shim | |
| `sales/opportunities/error.tsx` | 3 | 5.1 | rebuild | | |
| `sales/opportunities/loading.tsx` | 2 | 5.1 | rebuild | | |
| `sales/opportunities/not-found.tsx` | 2 | 5.1 | rebuild | | |

### 1.7 `app/dashboard/sales/` — quotes and orders (12)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `sales/quotes/page.tsx` | 87 | 5.5 | rebuild | | |
| `sales/quotes/new/page.tsx` | 3 | 5.4 | unchanged | Shim | |
| `sales/quotes/[quoteId]/page.tsx` | **1335** | 5.3 | rebuild | Largest file in `app/`. A detail page that is a form. **A12** at the convert action | |
| `sales/quotes/[quoteId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `sales/quotes/error.tsx` | 18 | 5.1 | rebuild | | |
| `sales/quotes/loading.tsx` | 5 | 5.1 | rebuild | | |
| `sales/quotes/not-found.tsx` | 11 | 5.1 | rebuild | | |
| `sales/orders/page.tsx` | 68 | 5.5 | rebuild | | |
| `sales/orders/new/page.tsx` | 3 | 5.4 | unchanged | Shim | |
| `sales/orders/[orderId]/page.tsx` | 381 | 5.3 | rebuild | A detail page that is a form | |
| `sales/orders/[orderId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `sales/orders/error.tsx` | 18 | 5.1 | rebuild | | |
| `sales/orders/loading.tsx` | 5 | 5.1 | rebuild | | |
| `sales/orders/not-found.tsx` | 11 | 5.1 | rebuild | | |

### 1.8 `app/dashboard/finance/**` (16)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `finance/pos/page.tsx` | 65 | 5.5 | rebuild | **A6** — selection with no verb | |
| `finance/pos/new/page.tsx` | 3 | 5.4 | unchanged | Shim | |
| `finance/pos/[invoiceId]/page.tsx` | 308 | 5.3 | rebuild | **Nested tabs at `:268`** | |
| `finance/pos/[invoiceId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `finance/pos/[invoiceId]/print/page.tsx` | 349 | — | unchanged | **§2.5 exception 2** — its own document theme, must not follow the app theme | done |
| `finance/pos/error.tsx` | 18 | 5.1 | rebuild | | |
| `finance/pos/loading.tsx` | 5 | 5.1 | rebuild | | |
| `finance/pos/not-found.tsx` | 11 | 5.1 | rebuild | | |
| `finance/payments/page.tsx` | 80 | 5.5 | rebuild | **A6, A7** — the header button is the slower path | |
| `finance/payments/record/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `finance/payments/error.tsx` | 18 | 5.1 | rebuild | | |
| `finance/payments/loading.tsx` | 5 | 5.1 | rebuild | | |
| `finance/insertion-orders/page.tsx` | 241 | 5.5 | rebuild | | |
| `finance/insertion-orders/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `finance/insertion-orders/[ioId]/page.tsx` | 222 | 5.3 | rebuild | Runtime title-caser at `:186` | |
| `finance/insertion-orders/[ioId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `finance/invoice-generator/page.tsx` | 5 | 5.7 | **delete** | A 3-line `redirect()` still in the route list | |

### 1.9 `app/dashboard/` — catalog, contracts, support, tasks, documents, custom (24)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `catalog/products/page.tsx` | 5 | 5.5 | unchanged | Shim to `CatalogRecordsPage` | |
| `catalog/products/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `catalog/products/[productId]/page.tsx` | 10 | 5.3 | unchanged | Shim to `CatalogRecordDetailPage` | |
| `catalog/products/[productId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `catalog/services/page.tsx` | 5 | 5.5 | unchanged | Shim | |
| `catalog/services/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `catalog/services/[serviceId]/page.tsx` | 10 | 5.3 | unchanged | Shim | |
| `catalog/services/[serviceId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `contracts/page.tsx` | 75 | 5.5 | rebuild | | |
| `contracts/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `contracts/[contractId]/page.tsx` | 479 | 5.3 | rebuild | **No activity, notes, tasks or documents.** Renders raw FKs at `:244,264,265` | |
| `contracts/[contractId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `support/cases/page.tsx` | 117 | 5.5 | rebuild | | |
| `support/cases/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `support/cases/[caseId]/page.tsx` | 272 | 5.3 | rebuild | **Two comment systems and two histories on one screen.** Title-caser at `:269` | |
| `tasks/page.tsx` | 277 | 5.7 | rebuild | List + board + calendar in one route | |
| `documents/page.tsx` | 147 | 5.5 | rebuild | **No `ModuleListToolbar`, no pagination.** The only list with addressable state (A1) | |
| `documents/upload/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `custom/[moduleKey]/page.tsx` | 263 | 5.5 | rebuild | **B.2** — filters collected and silently discarded. Filed, not fixed here | |
| `custom/[moduleKey]/new/page.tsx` | 10 | 5.4 | unchanged | Shim | |
| `custom/[moduleKey]/[recordId]/page.tsx` | 320 | 5.3 | rebuild | Archetype 5 — inline-edit form | |
| `client-portal/page.tsx` | 459 | 5.5 | rebuild | Calls `RecordTable` inline twice, no module table component | |
| `client-portal/pages/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `views/[moduleKey]/page.tsx` | 173 | 5.3 | rebuild | **Hand-rolled `role="tablist"` at `:162`** — no keyboard support | |
| `views/[moduleKey]/error.tsx` | 7 | 5.1 | rebuild | | |
| `views/[moduleKey]/loading.tsx` | 5 | 5.1 | rebuild | | |

### 1.10 `app/dashboard/` — mail, calendar, reports (3)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `mail/page.tsx` | 760 | 5.7 | rebuild | | |
| `mail/compose/page.tsx` | 5 | 5.7 | unchanged | Shim | |
| `calendar/page.tsx` | 631 | 5.7 | rebuild | One of 3 unshared calendar grids | |
| `reports/page.tsx` | 936 | 5.7 | rebuild | Uses **both** `RecordTable` and raw `Table`. **A11** | |

### 1.11 `app/dashboard/settings/**` (25)

23 settings pages plus the layout and the hub. `PermissionDeniedState` reaches **1 of 23**.

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `settings/layout.tsx` | 5 | 5.6 | rebuild | A 5-line passthrough. **Becomes the nav rail (A8)** | |
| `settings/page.tsx` | 180 | 5.6 | rebuild | The hub's `SETTINGS_SECTIONS` is the second, disagreeing IA | |
| `settings/general/page.tsx` | 357 | 5.6 | rebuild | | |
| `settings/authentication/page.tsx` | 105 | 5.6 | rebuild | **Autosave at `:45` + explicit footer 40 lines below.** R1 settles it | |
| `settings/users/page.tsx` | 110 | 5.6 | rebuild | | |
| `settings/users/error.tsx` | 14 | 5.1 | rebuild | | |
| `settings/users/loading.tsx` | 5 | 5.1 | rebuild | | |
| `settings/teams/page.tsx` | 459 | 5.6 | rebuild | | |
| `settings/permissions/page.tsx` | 587 | 5.6 | rebuild | Raw `Table` → `RecordTable` (R10) | |
| `settings/permissions/error.tsx` | 7 | 5.1 | rebuild | | |
| `settings/permissions/loading.tsx` | 5 | 5.1 | rebuild | | |
| `settings/modules/page.tsx` | 361 | 5.6 | rebuild | Raw `Table` | |
| `settings/modules/[moduleId]/page.tsx` | 331 | 5.6 | rebuild | Raw `Table` | |
| `settings/module-builder/page.tsx` | 874 | 5.6 | rebuild | **Hand-rolled `role="tablist"` at `:479`** | |
| `settings/fields/page.tsx` | 788 | 5.6 | rebuild | **A10** — no deep link, selection is local state | |
| `settings/fields/error.tsx` | 7 | 5.1 | rebuild | | |
| `settings/fields/loading.tsx` | 5 | 5.1 | rebuild | | |
| `settings/record-layouts/page.tsx` | 57 | 5.6 | rebuild | The **only** page with `PermissionDeniedState`. Leaks from the IA split | |
| `settings/customer-groups/page.tsx` | 514 | 5.6 | rebuild | Raw `Table` | |
| `settings/automation/page.tsx` | 156 | 5.6 | rebuild | | |
| `settings/integrations/page.tsx` | 67 | 5.6 | rebuild | | |
| `settings/domains/page.tsx` | 61 | 5.6 | rebuild | | |
| `settings/provisioning/page.tsx` | 55 | 5.6 | rebuild | | |
| `settings/calendar-booking/page.tsx` | 624 | 5.6 | rebuild | | |
| `settings/backups/page.tsx` | 938 | 5.6 | rebuild | Largest settings page | |
| `settings/recycle-bin/page.tsx` | 264 | 5.6 | rebuild | Raw `Table` | |
| `settings/activity-log/page.tsx` | 181 | 5.6 | rebuild | | |
| `settings/message-templates/page.tsx` | 168 | 5.6 | rebuild | | |
| `settings/message-templates/new/page.tsx` | 5 | 5.4 | unchanged | Shim | |
| `settings/message-templates/[templateId]/edit/page.tsx` | 6 | 5.4 | unchanged | Shim. Unwalked by the guard today | |

---

## 2. `components/**` — non-`ui` (115)

### 2.1 Record detail and activity (14) — owner 5.3

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `recordWorkspace/RecordWorkspace.tsx` | 142 | 5.3 | rebuild | `RecordWorkspace` itself is nearly a no-op forwarding to `PageShell`. The real targets are its header/primary/region/rail exports → the spine | |
| `recordActivity/RecordPageHeader.tsx` | 46 | 5.3 | adopt | | |
| `recordActivity/CrmRecordActivitySection.tsx` | 76 | 5.3 | rebuild | **This is a `RecordTabs` rendered inside another one.** The nested-tabs cause | |
| `recordActivity/RecordActivityFeed.tsx` | 319 | 5.3 | rebuild | | |
| `recordActivity/RecordActivityTimeline.tsx` | 88 | 5.3 | rebuild | | |
| `recordActivity/RecordCommentsPanel.tsx` | 315 | 5.3 | rebuild | | |
| `recordActivity/RecordTasksPanel.tsx` | 374 | 5.3 | rebuild | | |
| `recordActivity/FollowUpPanel.tsx` | 157 | 5.3 | rebuild | | |
| `recordActivity/CommunicationActions.tsx` | 131 | 5.3 | adopt | | |
| `recordActivity/RecordDeleteButton.tsx` | 56 | 5.3 | adopt | Destructive confirm copy is 5.9 | |
| `recordActivity/RecordPanelStates.tsx` | 77 | 5.1 | **move** | The right abstraction, trapped in `recordActivity/`. Promote to `components/ui/` | **done** (A) — now `ui/PanelStates.tsx` |
| `documents/RecordDocumentsPanel.tsx` | 132 | 5.3 | rebuild | The Files tab | |
| `forms/ReadOnlyRecordLayout.tsx` | 58 | 5.3 | rebuild | Emits `"Not recorded"` — the string §3.6 rejects | |
| `forms/ResolvedRecordLayout.tsx` | 126 | 5.3 | adopt | | |

### 2.2 Forms, quick-create and record form pages (32) — owner 5.4

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `forms/RecordFormLayout.tsx` | 48 | 5.4 | rebuild | The sticky footer goes (R3) | |
| `forms/quickCreateLayout.tsx` | 120 | 5.4 | adopt | | |
| `leads/LeadRecordFormPage.tsx` | 184 | 5.4 | adopt | | |
| `leads/LeadFormFields.tsx` | 204 | 5.4 | rebuild | Local `TextField` — 1 of 4 | |
| `leads/LeadQuickCreate.tsx` | 199 | 5.4 | adopt | | |
| `leads/LeadQuickCreateLayoutFields.tsx` | 285 | 5.4 | adopt | | |
| `leads/leadQuickCreateDraft.ts` | 28 | 5.4 | unchanged | Data | |
| `leads/leadMutation.ts` | 117 | 5.4 | unchanged | Data | |
| `leads/LeadConversionForm.tsx` | 213 | 5.3 | rebuild | **A13** | |
| `contacts/ContactRecordFormPage.tsx` | 159 | 5.4 | adopt | | |
| `contacts/ContactFormFields.tsx` | 179 | 5.4 | rebuild | Local `TextField` — 2 of 4 | |
| `contacts/ContactQuickCreate.tsx` | 166 | 5.4 | adopt | | |
| `contacts/ContactQuickCreateLayoutFields.tsx` | 269 | 5.4 | adopt | | |
| `contacts/contactQuickCreateDraft.ts` | 23 | 5.4 | unchanged | Data | |
| `contacts/contactMutation.ts` | 104 | 5.4 | unchanged | Data | |
| `organizations/OrganizationRecordFormPage.tsx` | 282 | 5.4 | adopt | | |
| `organizations/OrganizationFormFields.tsx` | 113 | 5.4 | rebuild | Local `TextField` — 3 of 4 | |
| `organizations/OrganizationQuickCreate.tsx` | 152 | 5.4 | adopt | | |
| `organizations/OrganizationQuickCreateLayoutFields.tsx` | 232 | 5.4 | adopt | | |
| `organizations/organizationQuickCreateDraft.ts` | 26 | 5.4 | unchanged | Data | |
| `organizations/organizationMutation.ts` | 99 | 5.4 | unchanged | Data | |
| `opportunities/OpportunityRecordFormPage.tsx` | 262 | 5.4 | adopt | | |
| `opportunities/OpportunityFormFields.tsx` | 109 | 5.4 | rebuild | Local `TextField` — 4 of 4 | |
| `opportunities/OpportunityQuickCreate.tsx` | 187 | 5.4 | adopt | **A3** — wired into contacts and accounts but *not* the deals list | |
| `opportunities/OpportunityQuickCreateLayoutFields.tsx` | 291 | 5.4 | adopt | | |
| `opportunities/opportunityMutation.ts` | 105 | 5.4 | unchanged | Data | |
| `opportunities/opportunityStages.ts` | 32 | 5.1 | rebuild | Tone classification (R5) | **done** (B) |
| `quotes/QuoteRecordFormPage.tsx` | 820 | 5.4 | rebuild | Line-item grid → `variant="lineItems"` | |
| `orders/OrderRecordFormPage.tsx` | 693 | 5.4 | rebuild | `variant="lineItems"` | |
| `finance/pos/PosInvoiceRecordFormPage.tsx` | 867 | 5.4 | rebuild | `variant="lineItems"` | |
| `finance/InsertionOrderRecordFormPage.tsx` | 416 | 5.4 | rebuild | **Two Cancel buttons** — `:265` and `:305` | |
| `contracts/ContractRecordFormPage.tsx` | 461 | 5.4 | rebuild | | |
| `support/SupportCaseCreateFormPage.tsx` | 260 | 5.4 | rebuild | Runtime title-caser at `:260` | |
| `catalog/CatalogRecordFormPage.tsx` | 333 | 5.4 | rebuild | | |
| `customModules/CustomModuleRecordCreatePage.tsx` | 286 | 5.4 | rebuild | | |
| `documents/DocumentUploadFormPage.tsx` | 533 | 5.4 | rebuild | One of two footer stragglers (`:515`) | |
| `settings/message-templates/MessageTemplateRecordFormPage.tsx` | 232 | 5.4 | rebuild | Verbatim copy of the sticky-footer classes (`:205`) | |
| `finance/payments/RecordPaymentPage.tsx` | 209 | 5.4 | rebuild | **A7** — the slower of two paths | |
| `catalog/CatalogRecordDetailPage.tsx` | 238 | 5.3 | rebuild | Archetype 6 — `PageShell actions=` with no record header | |

### 2.3 Tables and lists (16) — owner 5.5

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `leads/LeadsTable.tsx` | 193 | 5.5 | adopt | On `RecordTable`. Loses its `Pill` (R5) | |
| `contacts/contactList.tsx` | 209 | 5.5 | adopt | Keeps its hand-authored LinkedIn mark (§5) | |
| `organizations/OrganizationsTable.tsx` | 191 | 5.5 | adopt | | |
| `opportunities/OpportunitiesTable.tsx` | 223 | 5.5 | adopt | | |
| `quotes/QuotesTable.tsx` | 169 | 5.5 | adopt | | |
| `orders/OrdersTable.tsx` | 142 | 5.5 | adopt | | |
| `contracts/ContractsTable.tsx` | 146 | 5.5 | adopt | 7 of 8 statuses coloured today → 3 (R5) | |
| `support/SupportCasesTable.tsx` | 145 | 5.5 | adopt | | |
| `tasks/TasksTable.tsx` | 171 | 5.5 | adopt | Priority becomes a category — no tone (R5) | |
| `catalog/CatalogRecordsTable.tsx` | 289 | 5.5 | adopt | | |
| `catalog/CatalogRecordsPage.tsx` | 166 | 5.5 | rebuild | Shared wrapper for two routes | |
| `documents/DocumentList.tsx` | 459 | 5.5 | rebuild | No toolbar, no pagination | |
| `finance/insertionOrderList.tsx` | 265 | 5.5 | adopt | | |
| `finance/pos/InvoicesTable.tsx` | 187 | 5.5 | adopt | | |
| `finance/payments/PaymentsTable.tsx` | 192 | 5.5 | adopt | The AR list — needs the **derived** overdue tone (R5) | |
| `customModules/CustomModuleRecordsTable.tsx` | 137 | 5.5 | adopt | | |
| `transactions/TransactionLineItemsEditor.tsx` | 38 | 5.5 | rebuild | → `variant="lineItems"` (R10) | |

### 2.4 Settings, users, automation, integrations, record layouts (21) — owner 5.6

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `users/userManagementTable.tsx` | **873** | 5.6 | rebuild | Largest raw-`Table` consumer | |
| `users/createUserDialog.tsx` | 285 | 5.6 | rebuild | | |
| `users/editUserDialog.tsx` | 331 | 5.6 | rebuild | | |
| `users/userFilters.tsx` | 200 | 5.6 | rebuild | | |
| `automation/AutomationRulesTable.tsx` | 105 | 5.6 | adopt | Raw `Table` → `RecordTable` | |
| `automation/AutomationRunsTable.tsx` | 51 | 5.6 | adopt | Raw `Table` → `RecordTable` | |
| `automation/AutomationRuleEditor.tsx` | 137 | 5.6 | rebuild | | |
| `automation/AutomationStepList.tsx` | 58 | 5.6 | rebuild | | |
| `automation/AutomationInspector.tsx` | 49 | 5.6 | rebuild | | |
| `automation/AutomationRunDetails.tsx` | 45 | 5.6 | rebuild | | |
| `automation/types.ts` | 118 | — | unchanged | Data | |
| `automation/utils.ts` | 116 | — | unchanged | Data | |
| `integrations/IntegrationEventHistory.tsx` | 211 | 5.6 | adopt | Raw `Table` → `RecordTable` | |
| `integrations/IntegrationWebhookWorkspace.tsx` | 306 | 5.6 | rebuild | Raw `Table` | |
| `integrations/IntegrationWebsiteWorkspace.tsx` | 652 | 5.6 | rebuild | Raw `Table` | |
| `integrations/IntegrationProviderRegistry.tsx` | 181 | 5.6 | adopt | | |
| `integrations/IntegrationSectionError.tsx` | 15 | 5.1 | **delete** | One of the 3 competing settings error idioms | |
| `recordLayouts/RecordLayoutBuilder.tsx` | 580 | 5.6 | rebuild | 6 raw HTML5 DnD implementations start here | |
| `recordLayouts/RecordLayoutPreview.tsx` | 95 | 5.6 | rebuild | | |
| `recordLayouts/RecordLayoutValidationPanel.tsx` | 69 | 5.6 | rebuild | | |
| `recordLayouts/recordLayoutDraft.ts` | 227 | — | unchanged | Data | |

### 2.5 Dashboard, boards, calendars, mail, tasks (17) — owner 5.7

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `dashboard/DashboardCrmWidgets.tsx` | 231 | 5.7 | rebuild | `StatTile` — 1 of 5 metric implementations | |
| `dashboard/DashboardOperationalWidgets.tsx` | 188 | 5.7 | rebuild | | |
| `dashboard/DashboardPersonalWidgets.tsx` | 161 | 5.7 | rebuild | Raw `Table` → `RecordTable` | |
| `dashboard/DashboardReportChartWidget.tsx` | 162 | 5.7 | rebuild | Load the `dataviz` skill | |
| `dashboard/DashboardLayoutEditor.tsx` | 366 | 5.7 | rebuild | Raw HTML5 DnD → `SortableList` | |
| `opportunities/OpportunitiesPipelineBoard.tsx` | 232 | 5.7 | rebuild | 1 of 2 unshared kanbans → `Board` | |
| `tasks/TasksBoard.tsx` | 138 | 5.7 | rebuild | 2 of 2 kanbans | |
| `tasks/TasksCalendar.tsx` | 178 | 5.7 | rebuild | 1 of 3 calendar grids | |
| `tasks/TaskDialog.tsx` | 395 | 5.7 | rebuild | | |
| `tasks/TaskAssigneePicker.tsx` | 104 | 5.7 | adopt | | |
| `calendar/CalendarEventDialog.tsx` | 346 | 5.7 | rebuild | | |
| `calendar/CalendarParticipantPicker.tsx` | 110 | 5.7 | adopt | | |
| `calendar/CalendarSyncBridge.tsx` | 85 | — | unchanged | No UI | |
| `calendar/BookingForm.tsx` | 502 | 5.8 | rebuild | Public surface | |
| `calendar/PublicBookingPage.tsx` | 23 | 5.8 | rebuild | 3 of 3 calendar grids | |
| `mail/MailComposePage.tsx` | 239 | 5.7 | rebuild | | |
| `mail/RecordEmailComposer.tsx` | 498 | 5.7 | rebuild | | |
| `mail/RecordEmailAction.tsx` | 103 | 5.3 | adopt | A record-page action | |

### 2.6 Shell, search, notifications, identity (8)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `sidebar/Sidebar.tsx` | 249 | 5.7 | adopt | Wordmark is a `span` now (§8) | |
| `sidebar/SidebarNav.tsx` | 220 | 5.7 | rebuild | `text-[13px]` at `:166`. **A11** — reports as a collapsible group of one | |
| `header/ProfileMenu.tsx` | 64 | 5.7 | adopt | | |
| `search/GlobalCommandPalette.tsx` | 399 | 5.7 | adopt | | |
| `notifications/NotificationCenter.tsx` | 217 | 5.6 | rebuild | **A9** — admin-only href at `:210`, no `isAdmin` check | |
| `notifications/BrowserNotificationsBridge.tsx` | 67 | — | unchanged | No UI | |
| `LynkSplash.tsx` | 93 | 5.9 | adopt | **§9 identity — the motif is not touched.** Only `pl-[0.2em]` at `:58` | |
| `client-portal/ClientPageCreateForm.tsx` | 371 | 5.8 | rebuild | `size-6` call-site control height at `:335` — a standing guard failure | |

### 2.7 Shared field and picker components (7)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `crm/LinkedRecordPicker.tsx` | 389 | 5.1 | rebuild | The canonical relationship control; the spine's Connected block uses it | |
| `crm/RecordTagInput.tsx` | 217 | 5.1 | adopt | Tags are not statuses — no tone (R5) | |
| `customFields/CustomFieldInputs.tsx` | 131 | 5.4 | adopt | | |
| `customModules/CustomModuleFieldInput.tsx` | 172 | 5.4 | adopt | | |
| `documents/DocumentReferenceActions.tsx` | 71 | 5.3 | adopt | | |
| `finance/payments/RecordPaymentDialog.tsx` | 95 | 5.5 | adopt | The faster of A7's two paths | |

### 2.8 Test harnesses (3)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `testing/ContractTransportHarness.tsx` | 65 | — | unchanged | Test-only | done |
| `testing/QuickCreateSurfaceHarness.tsx` | 86 | — | unchanged | Test-only | done |
| `testing/RecordLayoutRuntimeHarness.tsx` | 103 | — | unchanged | Test-only | done |

---

## 3. `components/ui/` (54)

### 3.1 Changed or created by 5.1

| Path | Lines | Verdict | Note | Status |
|---|---|---|---|---|
| `button.tsx` | 63 | rebuild | 9 variants → 6 (§2.2) | **done** (A) |
| `Pill.tsx` | 40 | **delete** | R5. 52 files and 107 call sites move to `StatusValue` | **done** (B) — deleted; 104 sites in 52 files moved |
| `dialog.tsx` | 247 | rebuild | **`@headlessui/react` → radix.** The last non-trivial guard failure. 9 dialog + 13 sheet call sites; do not half-land it | |
| `sheet.tsx` | 236 | rebuild | Same migration | |
| `dialog-layer.tsx` | 33 | adopt | | |
| `DialogIconClose.tsx` | 20 | adopt | | |
| `ExportControls.tsx` | 362 | rebuild | Headless UI `Menu` → radix | |
| `ImportControls.tsx` | 442 | rebuild | Headless UI `Menu` → radix | |

**Created by 5.1** — not in the original 54, because they did not exist when the census was
taken. Counted here so the denominator stays honest.

| Path | Verdict | Note | Status |
|---|---|---|---|
| `Money.tsx` | **new** | Over `lib/currency.ts`. Owns formatting and `tabular-nums`, never ink or size | **done** (A) |
| `EmptyValue.tsx` | **new** | §3.6 in one place: `Not set` in a field, `—` in a cell. Makes 5.9's sweep one edit | **done** (A) |
| `SectionHeading.tsx` | **new** | 137 hand-written `<h2>`s at four sizes; R7 fixes the role at 14px semibold `text-copy-label` | **done** (A) |
| `Avatar.tsx` | **new** | Replaces 2 bespoke, one falling back to `"US"` and one to `"?"` | **done** (A) |
| `SaveStateIndicator.tsx` | **new** | R1 requires it: autosave removes the button, which was the only feedback | **done** (A) |
| `ActionBar.tsx` | **new** | `ActionBar` + `FormFooter`. Owns its children's control height (R4) via context; not sticky (R3) | **done** (A) |
| `PanelStates.tsx` | **new** | Promoted from `recordActivity/`. Header steps down to R7; loading and empty stop being boxes (R8) | **done** (A) |
| `StatusValue.tsx` | **new** | Renders a tone per context; accepts a caller-computed override for derived tones like overdue | **done** (B) |
| `Chip.tsx` | **new** | The tag/count/marker R5 says needs "a different component with a different name" | **done** (B) |
| `SegmentedControl.tsx` | **new** | **Not in the plan.** `secondary` was 47 sites carrying a role, not 8 carrying none — see `rebuild.md` 5.1 and §2.2 | **done** (A) |
| `ModuleImportExportControls.tsx` | 79 | adopt | Headless UI `Menu` → radix | |
| `Money.tsx` | — | **new** | Replaces 15 local formatters + 24 raw `Intl.NumberFormat` | |
| `ActionBar.tsx` | — | **new** | 10 sticky footers on 3 recipes; owns child control height (R4); not sticky (R3) | |
| `SaveStateIndicator.tsx` | — | **new** | R1 requires it — autosave removes the button, which was the only feedback | |
| `InlineFieldEdit.tsx` | — | **new** | The R2/R6 state-field control. 5 pages hand-roll this, each differently | |
| `SectionHeading.tsx` | — | **new** | 137 hand-written `<h2>`s, 4 sizes | |
| `Avatar.tsx` | — | **new** | 2 bespoke — one square, one circle | |
| `StatusValue.tsx` | — | **new** | Renders a tone per context. **Must accept a caller-computed tone override** for derived states like overdue (R5) | |
| `PanelStates.tsx` | — | **new** | Promoted from `recordActivity/RecordPanelStates.tsx`; reaches 5 of ~40 panels today | **done** (A) |
| `RecordSpine.tsx` | — | **new** | The signature (R9). Built in **5.3**, with its first real call site | |

### 3.2 Existing primitives

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `PageShell.tsx` | 144 | 5.3 | adopt | Gains `variant="record"` | |
| `PageHeader.tsx` | 71 | 5.1 | adopt | | |
| `Card.tsx` | 73 | 5.2 | adopt | The panel role in R8's taxonomy | |
| `RecordTable.tsx` | 457 | 5.5 | rebuild | Gains `lineItems` and `readOnly` (R10) | |
| `Table.tsx` | 204 | 5.5 | unchanged | The cell primitive. After 5.5 only 3 files may import it | |
| `ModuleTableShell.tsx` | 70 | 5.5 | adopt | Never gets a max-height back (§11.1) | |
| `ModuleTableLoading.tsx` | 49 | 5.5 | adopt | | |
| `ModuleListToolbar.tsx` | 69 | 5.5 | adopt | | |
| `TableDensityToggle.tsx` | 16 | 5.5 | adopt | | |
| `Pagination.tsx` | 194 | 5.5 | adopt | | |
| `SearchBar.tsx` | 37 | 5.5 | rebuild | **A5** — debounce. No debounce anywhere today | |
| `ColumnPicker.tsx` | 143 | 5.5 | adopt | **A2** — wired into 1 of 16 pages | |
| `SavedViewSelector.tsx` | 79 | 5.5 | adopt | The correct hand-rolled tablist reference | |
| `SavedViewConditionEditor.tsx` | 357 | 5.5 | rebuild | | |
| `InlineSavedViewFilters.tsx` | 87 | 5.5 | adopt | | |
| `RecordTabs.tsx` | 94 | 5.3 | adopt | Radix, correct. **Do not re-fix** | |
| `QuickCreateSurface.tsx` | 315 | 5.4 | adopt | **A3** — both create paths on all 15 modules | |
| `EmptyState.tsx` | 29 | 5.9 | adopt | Copy: an invitation to act | |
| `PermissionDeniedState.tsx` | 36 | 5.6 | adopt | Reaches 1 of 23 settings pages | |
| `RouteStates.tsx` | 32 | 5.1 | adopt | Also the source for the 38 route boundaries | |
| `skeleton.tsx` | 13 | — | unchanged | Correct | |
| `spinner.tsx` | 16 | — | unchanged | Correct | |
| `sonner.tsx` | 65 | 5.9 | adopt | Toast copy keeps the action's name | |
| `input.tsx` | 25 | — | unchanged | Fixed in consistency Phase 2 | |
| `textarea.tsx` | 20 | — | unchanged | same | |
| `select.tsx` | 189 | — | unchanged | same | |
| `input-group.tsx` | 171 | — | unchanged | same | |
| `checkbox.tsx` | 142 | — | unchanged | same | |
| `radio-group.tsx` | 130 | — | unchanged | | |
| `switch.tsx` | 153 | 5.6 | adopt | Used in **zero** settings pages today | |
| `SettingsSwitchRow.tsx` | 112 | 5.6 | adopt | A purpose-built settings primitive used in **2** files | |
| `label.tsx` | 24 | — | unchanged | | |
| `field.tsx` | 248 | 5.4 | adopt | | |
| `RequiredMark.tsx` | 3 | — | unchanged | | |
| `separator.tsx` | 28 | — | unchanged | | |
| `popover.tsx` | 48 | — | unchanged | | |
| `CustomFieldValue.tsx` | 20 | 5.5 | adopt | Content-only since Phase 3 | |
| `ImageAssetField.tsx` | 115 | 5.4 | adopt | | |
| `TimezonePicker.tsx` | 93 | 5.6 | adopt | | |
| `UserTeamPicker.tsx` | 214 | 5.6 | adopt | | |
| `DataTransferJobProgress.tsx` | 86 | 5.6 | adopt | | |
| `chart.tsx` | 78 | 5.7 | adopt | Load the `dataviz` skill | |
| `importExportUtils.ts` | 54 | — | unchanged | Data | |
| `HexagonBackground.tsx` | 109 | — | unchanged | **§9 identity.** Verify it still renders as a honeycomb after 5.8 | done |
| `AnimatedShinyText.tsx` | 39 | — | unchanged | §9 identity | done |

---

## 4. Deliberately unchanged, and the reason

These are the **only** rows marked `unchanged` for a reason other than "it is already
correct" or "it is data with no UI":

| File | Reason |
|---|---|
| `app/e2e/**` (3 pages) + `components/testing/**` (3) | Test-only, blocked in production by `proxy.ts` |
| `app/dashboard/finance/pos/[invoiceId]/print/page.tsx` | §2.5 exception 2 — the invoice carries its own document theme and must not follow the app theme |
| `components/ui/HexagonBackground.tsx`, `AnimatedShinyText.tsx` | §9 identity surfaces |
| `components/LynkSplash.tsx` | §9 identity. Only the off-grid `pl-[0.2em]` at `:58` is fixed, in 5.9 |
| `components/contacts/contactList.tsx` (LinkedIn mark), `app/auth/login/page.tsx` (Google, Microsoft marks) | §5 — the only permitted hand-authored SVG, being third-party brand marks lucide excludes by policy |

---

## 5. `lib/` and `hooks/` — the design-relevant subset

Not in the 327. Listed because a sub-phase changes them for design reasons, and nothing else
in `lib/` or `hooks/` is touched by this programme.

| Path | Owner | Verdict | Note | Status |
|---|---|---|---|---|
| `lib/statusStyles.ts` | 5.1 | rebuild | Returns `{tone, label}`, not raw Tailwind strings. **R5's classification is in `rebuild.md`** | **done** (B) |
| `lib/currency.ts` | 5.1 | **new** | Does not exist. Dates *are* centralised in `lib/datetime.ts` — the contrast is the argument | **done** (A) |
| `lib/chartColors.ts` | 5.7 | adopt | Already correct; the only legal source of chart colour | |
| `lib/datetime.ts` | — | unchanged | Already the single source for time | |
| `lib/module-display.ts` | 5.9 | adopt | `formatSnakeCaseLabel` is the only function allowed to build a label from a key; 17 open-coded repeats go | |
| `lib/routes.ts` | 5.6 | rebuild | **A9** — the notification href fallback at `:86` points at an admin-only route | |
| `lib/moduleViewConfigs.ts` | 5.5 | adopt | | |
| `lib/module-registry.ts` | 5.7 | adopt | **A11** — reports is a single-item collapsible group | |
| `hooks/usePagedList.ts` | 5.5 | rebuild | **A1** — list state is not addressable; **A5** — no debounce | |
| `hooks/useSavedViews.ts` | 5.5 | rebuild | **A1, A5** | |
| `hooks/useModuleBuilder.ts` | — | unchanged | **B.2** lives at `:298` and is filed, not fixed — it needs a backend query-param contract | |

---

## 6. Roll-up by owner

| Sub-phase | Rows owned |
|---|---|
| 5.1 — cross-cutting primitives | 60 (18 primitives + 38 route boundaries + globals.css + 3 shell) |
| 5.2 — panel language | 1 owned (`Card`); it *sweeps* almost every row above without owning them |
| 5.3 — record detail | 34 |
| 5.4 — forms | 55 |
| 5.5 — one table, list workflow | 43 |
| 5.6 — settings | 52 |
| 5.7 — dashboard, reports, boards, calendars, mail | 32 |
| 5.8 — client portal, public, auth | 28 |
| 5.9 — copy and voice | 4 owned; it sweeps every row |
| 5.10 — guard the composition | 0 rows; all new test coverage |
| — unchanged with a reason | 12 |

5.2 and 5.9 own almost nothing and touch almost everything. That is expected and it is why
they are not scheduled first: a panel sweep before the archetypes land would be swept again,
and copy is what the standardised states render, so it comes after they exist.
