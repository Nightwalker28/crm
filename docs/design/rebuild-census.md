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
| `page.tsx` | 44 | 5.8 | rebuild | The marketing/entry surface | batch 5 — it returned `null`, so the entry route was a blank ground; it shows the splash |
| `loading.tsx` | 11 | 5.1 | rebuild | One route-boundary shape — the cold-boot splash, kept distinct from `RouteLoadingState` per dashboard/loading.tsx's own comment | done |
| `providers.tsx` | 60 | 5.1 | adopt | `MotionConfig` lives here | |
| `ClientLayout.tsx` | 16 | 5.1 | adopt | | |
| `globals.css` | — | 5.1 | rebuild | Tokens: rail widths, the retired 5-step, `text-base` | |
| `runtime-config.js/route.ts` | — | — | unchanged | Not a surface | |

### 1.2 `app/auth/**` (5)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `auth/layout.tsx` | 14 | 5.8 | rebuild | **Tokenise the raw `rgba()`, do not delete it.** §9 identity | batch 2 — the atmosphere moved to `AuthAtmosphere` and tokenised; hive verified in the browser pass |
| `auth/login/page.tsx` | 426 | 5.8 | rebuild | Keeps its hand-authored Google/Microsoft marks (§5) | examined, left — already on `Label` / `Input` / `Button`; what is wrong is copy, 5.9's. Hive confirmed in both themes, batch 6 |
| `auth/setup-password/page.tsx` | 161 | 5.8 | rebuild | | batch 2 — the wordmark stopped doing a page heading's job (§3.1) |
| `auth/callback/page.tsx` | 10 | 5.8 | unchanged | Shim | close-out — unchanged |
| `auth/callback/AuthCallbackClient.tsx` | 58 | 5.8 | adopt | | batch 2 — a theme-blind `invert`ed raster replaced by a toned icon |

### 1.3 `app/client/**` — the portal (17)

All 17 today hand-roll `min-h-screen bg-app` and the `font-lynk` wordmark; there is no
`app/client/layout.tsx`. 5.8 adds one.

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `client/layout.tsx` | 82 | 5.8 | **new** | Does not exist. The root cause of Layer 6 | batch 1 — the rail, the section header, and ruling 4's one container width; batch 6 — the wrapper is a full-height flex column, so the record archetype's `lg:h-full` resolves |
| `client/page.tsx` | 120 | 5.8 | rebuild | | batch 1 — `PageShell`, `StatTile` in an interactive `Card`, `ListRow`, `EmptyState` |
| `client/login/page.tsx` | 113 | 5.8 | rebuild | Decide vs `/auth/login` and write the choice into §9 | batch 2 — ruling 3: it matches. §9 widened, `AuthAtmosphere` shared |
| `client/setup/page.tsx` | 149 | 5.8 | rebuild | | batch 2 — the second door, onto `AuthAtmosphere` |
| `client/bookings/page.tsx` | 58 | 5.8 | rebuild | | batch 3 — `PageShell` + `RowList` + `EmptyState` |
| `client/bookings/[bookingId]/page.tsx` | 104 | 5.8 | rebuild | Archetype 2, rail collapsed | batch 4 — `RecordWorkspace` with no `spine` (ruling 2); batch 6 — `EmptyValue` for host and location |
| `client/catalog/page.tsx` | 73 | 5.8 | rebuild | | batch 3 — the card grid became rows (§1.5); `SearchBar`, `Money`, `StatusValue` |
| `client/catalog/[kind]/[itemId]/page.tsx` | 138 | 5.8 | rebuild | Archetype 2 | batch 4 — same; the request form gained labels and `Money` |
| `client/documents/page.tsx` | 64 | 5.8 | rebuild | | batch 3 — `ListRow`'s `actions` slot carries `DocumentReferenceActions` |
| `client/messages/page.tsx` | 109 | 5.8 | rebuild | | batch 3 — `PanelHeader`, labelled fields, `RowList` |
| `client/messages/[messageId]/page.tsx` | 109 | 5.8 | rebuild | Archetype 2 | batch 4 — same; the thread is a `RowList ordered` |
| `client/orders/page.tsx` | 59 | 5.8 | rebuild | | batch 3 — `Money` and `StatusValue` in place of the local `money()` |
| `client/orders/[orderId]/page.tsx` | 59 | 5.8 | rebuild | `RecordTable variant="readOnly"` (R10) | batch 4 — `TransactionLineItemsTable`, the shared one; the raw `Table` is gone |
| `client/quotes/page.tsx` | 62 | 5.8 | rebuild | | batch 3 — same |
| `client/quotes/[quoteId]/page.tsx` | 156 | 5.8 | rebuild | Archetype 2 | batch 4 — same; Approve/Reject stay actions, not spine fields; batch 6 — `EmptyValue` for unset dates; the proposal `<pre>` became prose |
| `client/support/page.tsx` | 155 | 5.8 | rebuild | | **out of scope** (scoping decision 8) — the module may be removed |
| `client/support/[caseId]/page.tsx` | 126 | 5.8 | rebuild | Archetype 2 | **out of scope** (scoping decision 8) — the module may be removed |
| `client/pages/[token]/page.tsx` | 209 | 5.8 | rebuild | `variant="readOnly"`. Unwalked by the guard today | batch 5 — `RecordTable variant="readOnly"`, `RowList`, `Money`; the tenant's name left `font-lynk`; batch 6 — `RouteLoadingState` / `RouteErrorState` |

### 1.4 `app/public/**` and `app/book/**` (2)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `public/quotes/proposal/[token]/page.tsx` | 223 | 5.8 | rebuild | Unwalked by the guard today | batch 5 — `Money`, the type ramp, and the page's second h1 demoted; batch 6 — the error card's `h1` restored: the two were alternatives, not a pair |
| `book/[...bookingPath]/page.tsx` | 18 | 5.7 | unchanged | Shim to `PublicBookingPage`; the calendar grid is 5.7 | close-out — unchanged. The grid claim was re-measured at the head of 5.7: `BookingForm` lists slots and draws no month grid, so `MonthGrid` has two consumers, not three |

### 1.5 `app/e2e/**` (3)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `e2e/contract-transport/page.tsx` | 11 | — | unchanged | Test-only, blocked in production by `proxy.ts` | done |
| `e2e/quick-create/page.tsx` | 11 | — | unchanged | same | done |
| `e2e/record-layout/page.tsx` | 10 | — | unchanged | same | done |

### 1.6 `app/dashboard/` — shell and sales (33)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `dashboard/layout.tsx` | 170 | 5.7 | adopt | The `h1` sequence is closed; the backdrop is §9 | close-out — the *Checking access...* recessed box is `RouteLoadingState`. Backdrop untouched (§9) |
| `dashboard/page.tsx` | 475 | 5.7 | rebuild | Archetype 5. A9: an admin-only href with no `isAdmin` check at `:404` | batch 2 — header down to its own three actions (ruling 3; A9's link goes with the other four), both `window.confirm` → `useConfirm`, the duplicate save-error banner deleted. Edit mode's widgets wait for `SortableList` (batch 3) |
| `dashboard/error.tsx` | 7 | 5.1 | rebuild | | done |
| `dashboard/loading.tsx` | 9 | 5.1 | rebuild | | done |
| `dashboard/not-found.tsx` | 5 | 5.1 | rebuild | | done |
| `dashboard/profile/page.tsx` | 512 | 5.6 | rebuild | Reads as settings; goes on archetype 4 | **done, batch 7b** — three `Card`s → `FormSection`, the hand-rolled commit row → `FormFooter`, `SummaryTile` → the new `Fact` primitive (§7.12), two redundant colour signals and a `text-primary` link corrected |
| `sales/leads/page.tsx` | 158 | 5.5 | rebuild | | **done, batches 2–3** — addressable state (A1), the search debounce (A5) and the column picker (A2), all from the shared hooks and the toolbar |
| `sales/leads/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/leads/[leadId]/page.tsx` | 569 | 5.3 | rebuild | Archetype 1 today; tab-order default is wrong | **done** — the first module onto the spine; gains inline status edit. 5.7 batch 6 — the score factors are a `RowList` |
| `sales/leads/[leadId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/leads/[leadId]/convert/page.tsx` | 60 | 5.3 | rebuild | **A13** — no unsaved-changes guard | **done, batch 6** — A13 closed in the form below; the page's `Back to lead` carries `?tab=` because convert is a trip off the record like Edit is |
| `sales/leads/error.tsx` | 3 | 5.1 | rebuild | | done |
| `sales/leads/loading.tsx` | 2 | 5.1 | rebuild | | done |
| `sales/leads/not-found.tsx` | 2 | 5.1 | rebuild | | done |
| `sales/contacts/page.tsx` | 111 | 5.5 | rebuild | | **done, batches 2–3** — addressable state (A1), the search debounce (A5) and the column picker (A2), all from the shared hooks and the toolbar |
| `sales/contacts/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/contacts/[contactId]/page.tsx` | 936 | 5.3 | rebuild | No `RecordActivityFeed` though leads have one | **done** — archetype 2; gained Timeline; WhatsApp panel became the composer's tracked mode |
| `sales/contacts/[contactId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/contacts/error.tsx` | 3 | 5.1 | rebuild | | done |
| `sales/contacts/loading.tsx` | 2 | 5.1 | rebuild | | done |
| `sales/contacts/not-found.tsx` | 2 | 5.1 | rebuild | | done |
| `sales/organizations/page.tsx` | 60 | 5.5 | rebuild | | **done, batches 2–3** — addressable state (A1), the search debounce (A5) and the column picker (A2), all from the shared hooks and the toolbar |
| `sales/organizations/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/organizations/[orgId]/page.tsx` | 869 | 5.3 | rebuild | No activity feed | **done** — archetype 2; gained Timeline; counts became spine collections |
| `sales/organizations/[orgId]/edit/page.tsx` | 9 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/organizations/error.tsx` | 3 | 5.1 | rebuild | | done |
| `sales/organizations/loading.tsx` | 2 | 5.1 | rebuild | | done |
| `sales/organizations/not-found.tsx` | 2 | 5.1 | rebuild | | done |
| `sales/opportunities/page.tsx` | 69 | 5.5 | rebuild | 5.4 batch 6 wired the shared Deal Quick Create; 5.5 still owns the final list shape | **done, batches 2–3** — addressable state (A1), the search debounce (A5) and the column picker (A2), all from the shared hooks and the toolbar. **5.7 batch 2** moved its seven boxed stage tiles onto one `StatGroup`. **5.7 batch 4** addressed the table/pipeline switch as `?display=` and moved the pipeline onto `Board` |
| `sales/opportunities/new/page.tsx` | 3 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/opportunities/[opportunityId]/page.tsx` | 565 | 5.3 | rebuild | **Nested tabs at `:507`** | done |
| `sales/opportunities/[opportunityId]/edit/page.tsx` | 6 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/opportunities/error.tsx` | 3 | 5.1 | rebuild | | done |
| `sales/opportunities/loading.tsx` | 2 | 5.1 | rebuild | | done |
| `sales/opportunities/not-found.tsx` | 2 | 5.1 | rebuild | | done |

### 1.7 `app/dashboard/sales/` — quotes and orders (12)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `sales/quotes/page.tsx` | 87 | 5.5 | rebuild | | **done, batches 2–3** — addressable state (A1), the search debounce (A5) and the column picker (A2), all from the shared hooks and the toolbar |
| `sales/quotes/new/page.tsx` | 3 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/quotes/[quoteId]/page.tsx` | **1335** | 5.3 | rebuild | Largest file in `app/`. A detail page that is a form. **A12** at the convert action | done · **5.5 batch 1** took its line-item table to the shared `TransactionLineItemsTable` |
| `sales/quotes/[quoteId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/quotes/error.tsx` | 18 | 5.1 | rebuild | | done |
| `sales/quotes/loading.tsx` | 5 | 5.1 | rebuild | | done |
| `sales/quotes/not-found.tsx` | 11 | 5.1 | rebuild | | done |
| `sales/orders/page.tsx` | 68 | 5.5 | rebuild | | **done, batches 2–3** — addressable state (A1), the search debounce (A5) and the column picker (A2), all from the shared hooks and the toolbar |
| `sales/orders/new/page.tsx` | 3 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/orders/[orderId]/page.tsx` | 381 | 5.3 | rebuild | A detail page that is a form | done · **5.5 batch 1** took its line-item table to the shared `TransactionLineItemsTable` |
| `sales/orders/[orderId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `sales/orders/error.tsx` | 18 | 5.1 | rebuild | | done |
| `sales/orders/loading.tsx` | 5 | 5.1 | rebuild | | done |
| `sales/orders/not-found.tsx` | 11 | 5.1 | rebuild | | done |

### 1.8 `app/dashboard/finance/**` (16)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `finance/pos/page.tsx` | 65 | 5.5 | rebuild | **A6** — selection with no verb | **done, batch 4** — the selection is deleted; nothing consumed it |
| `finance/pos/new/page.tsx` | 3 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `finance/pos/[invoiceId]/page.tsx` | 308 | 5.3 | rebuild | **Nested tabs at `:268`** | done · **5.5 batch 1** took its line-item table to the shared `TransactionLineItemsTable` |
| `finance/pos/[invoiceId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `finance/pos/[invoiceId]/print/page.tsx` | 349 | — | unchanged | **§2.5 exception 2** — its own document theme, must not follow the app theme | done |
| `finance/pos/error.tsx` | 18 | 5.1 | rebuild | | done |
| `finance/pos/loading.tsx` | 5 | 5.1 | rebuild | | done |
| `finance/pos/not-found.tsx` | 11 | 5.1 | rebuild | | done |
| `finance/payments/page.tsx` | 80 | 5.5 | rebuild | **A6, A7** — the header button is the slower path | **done, batch 4** — selection deleted (the row action already was the verb), header button demoted out of the primary slot |
| `finance/payments/record/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `finance/payments/error.tsx` | 18 | 5.1 | rebuild | | done |
| `finance/payments/loading.tsx` | 5 | 5.1 | rebuild | | done |
| `finance/insertion-orders/page.tsx` | 241 | 5.5 | rebuild | | **done, batches 2–3** — addressable state (A1), the search debounce (A5) and the column picker (A2), all from the shared hooks and the toolbar |
| `finance/insertion-orders/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `finance/insertion-orders/[ioId]/page.tsx` | 222 | 5.3 | rebuild | Runtime title-caser at `:186` | done |
| `finance/insertion-orders/[ioId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `finance/invoice-generator/page.tsx` | 5 | 5.7 | **delete** | A 3-line `redirect()` still in the route list | **done** — deleted in 5.3 close-out rather than waiting for 5.7: zero inbound links, and it was costing both rendered guards a route visit each. Owner stays 5.7 for the record |

### 1.9 `app/dashboard/` — catalog, contracts, support, tasks, documents, custom (24)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `catalog/products/page.tsx` | 5 | 5.5 | unchanged | Shim to `CatalogRecordsPage` | **done — unchanged, as specified.** A five-line shim; `CatalogRecordsPage` carries the work |
| `catalog/products/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `catalog/products/[productId]/page.tsx` | 10 | 5.3 | unchanged | Shim to `CatalogRecordDetailPage` | done |
| `catalog/products/[productId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `catalog/services/page.tsx` | 5 | 5.5 | unchanged | Shim | **done — unchanged, as specified.** A five-line shim |
| `catalog/services/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `catalog/services/[serviceId]/page.tsx` | 10 | 5.3 | unchanged | Shim | done |
| `catalog/services/[serviceId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `contracts/page.tsx` | 75 | 5.5 | rebuild | | **out of scope** (scoping decision 8) — the module may be removed|
| `contracts/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **out of scope** (scoping decision 8) — the module may be removed|
| `contracts/[contractId]/page.tsx` | 479 | 5.3 | rebuild | **No activity, notes, tasks or documents.** Renders raw FKs at `:244,264,265` | done; **out of scope** (scoping decision 8) — the module may be removed |
| `contracts/[contractId]/edit/page.tsx` | 10 | 5.4 | unchanged | Shim | **out of scope** (scoping decision 8) — the module may be removed|
| `support/cases/page.tsx` | 117 | 5.5 | rebuild | | **out of scope** (scoping decision 8) — the module may be removed|
| `support/cases/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **out of scope** (scoping decision 8) — the module may be removed|
| `support/cases/[caseId]/page.tsx` | 272 | 5.3 | rebuild | **Two comment systems and two histories on one screen.** Title-caser at `:269` | done; **out of scope** (scoping decision 8) — the module may be removed |
| `tasks/page.tsx` | 277 | 5.7 | rebuild | List + board + calendar in one route | **batch 4** — the display is `?display=`, and the task dialog writes `?taskId=` through `usePageAddress` instead of replacing the whole query. The calendar is batch 5's |
| `documents/page.tsx` | 147 | 5.5 | rebuild | **No `ModuleListToolbar`, no pagination.** The only list with addressable state (A1) | **done, batch 5** — the toolbar, real pagination on a new `page`/`page_size` backend param, `variant="list"`, and both draft fields written to the address |
| `documents/upload/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `custom/[moduleKey]/page.tsx` | 263 | 5.5 | rebuild | **B.2** — filters collected and silently discarded. Filed, not fixed here | **done, batch 3** — the hand-placed `ColumnPicker` moved into the toolbar slot. **B.2 is still open and still filed**: `useCustomModuleRecords` sends search and sort only, so the filter group stays undrawn (§7.9) |
| `custom/[moduleKey]/new/page.tsx` | 10 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `custom/[moduleKey]/[recordId]/page.tsx` | 320 | 5.3 | rebuild | Archetype 5 — inline-edit form | done |
| `custom/[moduleKey]/[recordId]/edit/page.tsx` | 10 | 5.3 | **new** | Shim. Added in batch 4: R2 sends the record's content fields to `/[id]/edit`, and this was the one module with no such route — the detail page *was* the form | done |
| `client-portal/page.tsx` | 459 | 5.5 | rebuild | Calls `RecordTable` inline twice, no module table component | **done, batch 6** — both extracted to `components/client-portal/`; 456 → 330 lines; the missing `shellVariant="nested"` fixed on both |
| `client-portal/pages/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `views/[moduleKey]/page.tsx` | 173 | 5.3 | rebuild | **Hand-rolled `role="tablist"` at `:162`** — no keyboard support | **done, batch 5**; **footer corrected in 5.6 batch 2** — it kept a `sticky bottom-0` save bar that R3's count of ten had missed — on `SectionTabs`; the three panels became named consts. Close-out added §7.9: it drops the condition editor for custom modules, whose list endpoint cannot receive conditions — fixing the list toolbar alone left this back door open. **5.7 batch 3** moved its column order onto `SortableList` |
| `views/[moduleKey]/error.tsx` | 7 | 5.1 | rebuild | | done |
| `views/[moduleKey]/loading.tsx` | 5 | 5.1 | rebuild | | done |

### 1.10 `app/dashboard/` — mail, calendar, reports (3)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `mail/page.tsx` | 760 | 5.7 | rebuild | | batch 6 — the message rows are `ListRow`s in an inset `RowList`; the selected row is elevation, not the action tint. **batch 8b** — §4.4 page split: messages `Card` (list and reader side by side from a 48rem container) and a 20rem connections rail of `ListRow`s. Header 4 controls → *New mail*. IMAP form → `EditorPanel`. Success tints, boxed body, boxed link targets and scope chips gone; states are `PanelStates` |
| `mail/compose/page.tsx` | 5 | 5.7 | unchanged | Shim | close-out — unchanged, a shim |
| `calendar/page.tsx` | 631 | 5.7 | rebuild | One of 3 unshared calendar grids | **done, batch 5** — 631 → 391 lines. `MonthGrid` in a `Card` beside the 20rem rail (§4.4 page split); its two grids, the *Selected day* panel and the header's session-sync box are gone. Invites and providers are rows, statuses are `StatusValue`, the states are `PanelStates`. Batch 6 — the invite and provider rows are `ListRow`s |
| `reports/page.tsx` | 936 | 5.7 | rebuild | Uses **both** `RecordTable` and raw `Table`. **A11** | **done, batch 7** (A11 is the sidebar's, batch 8) — raw `Table` → `RecordTable variant="readOnly"`, `ForecastBucketList` → `ListRow`, four tinted error banners → `PanelError` / `FieldError` / toasts, headings → `PanelHeader`, the chart's `Skeleton` and `EmptyState` → `PanelStates`, *Top result* → `Fact`, presets off the action tint |

### 1.11 `app/dashboard/settings/**` (25)

23 settings pages plus the layout and the hub. `PermissionDeniedState` reaches **1 of 23**.

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `settings/layout.tsx` | 5 | 5.6 | rebuild | A 5-line passthrough. **Becomes the nav rail (A8)** | **done, batch 1** — full-height two-column grid, `SettingsNavRail` + a scrolling content column. Not sticky |
| `settings/page.tsx` | 180 | 5.6 | rebuild | The hub's `SETTINGS_SECTIONS` is the second, disagreeing IA | **done, batch 1** — 180 → 58 lines, rendering `SETTINGS_NAV_GROUPS`. The second IA is gone |
| `settings/general/page.tsx` | 357 | 5.6 | rebuild | | **done, batch 7b** — footer batch 2; the body here: one `Card` holding three hand-written sections → three `FormSection`s, commit row → `FormFooter` |
| `settings/authentication/page.tsx` | 105 | 5.6 | rebuild | **Autosave at `:45` + explicit footer 40 lines below.** R1 settles it | **done, batch 2** — three `FormSection`s; MFA on `SettingsRow` + `useAutosave`, SSO on a non-sticky `FormFooter`. Its local `Status` pair → `Fact`, batch 7b |
| `settings/users/page.tsx` | 110 | 5.6 | rebuild | | **done, batches 3 + 4 + 7d** — denied state, then the table; **audited clean in 7d**, nothing further to change |
| `settings/users/error.tsx` | 14 | 5.1 | rebuild | | done |
| `settings/users/loading.tsx` | 5 | 5.1 | rebuild | | done |
| `settings/teams/page.tsx` | 459 | 5.6 | rebuild | | **done, batches 7a + 7b + 8** — two `EditorPanel`s and their create-panel dirty lines; then the body: two icon-chip headers and a third container level deleted, actions to `PageShell`. Not a `RecordTable` — `groupBy` takes a label, and a department carries a description, a count and three actions. **Batch 8's browser pass** demoted the twenty `variant="destructive"` row deletes to `outline`: the only file in the app drawing a row action as a filled danger control, and R5's argument applies to a button as much as to a capsule |
| `settings/permissions/page.tsx` | 587 | 5.6 | rebuild | Raw `Table` → `MatrixTable` (R10) | **done, batch 4b** — the matrix is not a list; `MatrixTable` is the new sibling primitive (§7.10). Footer landed in batch 2, the create-role drawer in 7a |
| `settings/permissions/error.tsx` | 7 | 5.1 | rebuild | | done |
| `settings/permissions/loading.tsx` | 5 | 5.1 | rebuild | | done |
| `settings/modules/page.tsx` | 361 | 5.6 | rebuild | Raw `Table` | **done, batches 4a + 7a** — `RecordTable`, the hand-rolled row gesture and `stopRowNavigation` deleted; then `EditorPanel`, and the Save became a submit |
| `settings/modules/[moduleId]/page.tsx` | 331 | 5.6 | rebuild | Raw `Table` → `RecordTable` | **done, batch 4b** — both panels are lists, not matrices; two `colSpan` empty states retired |
| `settings/module-builder/page.tsx` | 874 | 5.6 | rebuild | **Hand-rolled `role="tablist"` at `:479`** | **done, batch 6c** — strip batch 5, booleans batch 1, and the rebuild here: `FieldInspector` stopped emitting its own sheet chrome, both `window.confirm` calls → `useConfirm`, the save row onto `ActionBar`, two A8 header links retired. The drag-and-drop field list went onto `SortableList` in **5.7 batch 3** |
| `settings/fields/page.tsx` | 788 | 5.6 | rebuild | **A10** — no deep link, selection is local state | **done, batch 6b** — error idiom batch 3, A10 batch 5, and the rebuild here: the catalogue onto `RecordTable`, two copies of the sheet recipe onto one `EditorPanel`, the fake menu retired, two lone `Checkbox` booleans onto `SegmentedBoolean` |
| `settings/fields/error.tsx` | 7 | 5.1 | rebuild | | done |
| `settings/fields/loading.tsx` | 5 | 5.1 | rebuild | | done |
| `settings/record-layouts/page.tsx` | 57 | 5.6 | rebuild | The **only** page with `PermissionDeniedState`. Leaks from the IA split | **done, batches 1 + 7c** — the IA leak closed in 1; the page's own Title Case title fixed in 7c |
| `settings/pipeline/page.tsx` | 140 | — | new | crm-evolution Wave 2E, added after the programme closed | **born on the system** — archetype 4: `PageShell variant="settings"`, one `FormSection`, `SortableList` rows, autosave per row (R1), order's own `SaveStateIndicator` |
| `settings/customer-groups/page.tsx` | 514 | 5.6 | rebuild | Raw `Table` | **done, batches 4a + 7a** — `RecordTable` with sortable columns, three page-local states deleted; then `EditorPanel` |
| `settings/automation/page.tsx` | 156 | 5.6 | rebuild | | **done, batches 3 + 5 + 7d** — denied state, then the address vocabulary; in 7d the page-local `RouteLoadingState` and `Card`+`EmptyState` moved onto `AutomationRunsTable`, which has owned both states since 4a |
| `settings/integrations/page.tsx` | 67 | 5.6 | rebuild | | **done, batches 3 + 7d** — denied state; **audited clean in 7d** |
| `settings/domains/page.tsx` | 61 | 5.6 | rebuild | | **done, batches 3 + 7d** — it had re-created `Pill`: a nested ternary painting a coloured capsule per domain. `StatusValue` + `Chip`, the prose loading line → `PanelLoading`, the panel heading → `SectionHeading` |
| `settings/provisioning/page.tsx` | 55 | 5.6 | rebuild | | **done, batch 2** — `FormSection` + `SettingsRow`, non-sticky footer, checkbox → `SegmentedBoolean` |
| `settings/calendar-booking/page.tsx` | 624 | 5.6 | rebuild | | **done, batch 6a** — first consumer of `EditorPanel`; `Card` + hand-rolled headings → `FormSection`, the duplicate error banner and the third New button deleted, and the table stopped drawing a second border |
| `settings/backups/page.tsx` | 938 | 5.6 | rebuild | Largest settings page | **done, batch 6d** — the `Configure` drawer deleted and the schedule brought onto the page as archetype 4, three icon-chip headers → `FormSection`, the disabled module grid → conditional (§7.9), `formatBytes` hoisted to `lib/format.ts`. **Its local `Fact` was hoisted in 7b** — and drew a box the §1.3 argument in `profile` already forbade |
| `settings/recycle-bin/page.tsx` | 264 | 5.6 | rebuild | ~~Raw `Table`~~ — **already on `RecordTable`**; the note was stale, corrected 5.6 batch 1 | **done, batch 7d** — its one `text-lg` hand-rolled heading → `SectionHeading` (R7); nothing else drifted |
| `settings/activity-log/page.tsx` | 181 | 5.6 | rebuild | | **done, batches 3 + 7d** — denied state; **audited clean in 7d** |
| `settings/message-templates/page.tsx` | 168 | 5.6 | rebuild | | **done, batches 3 + 7d** — denied state; **audited clean in 7d** |
| `settings/message-templates/new/page.tsx` | 5 | 5.4 | unchanged | Shim | **done, close-out** — audited delegation only |
| `settings/message-templates/[templateId]/edit/page.tsx` | 6 | 5.4 | unchanged | Shim. Unwalked by the guard today | **done, close-out** — module spec covers it |

---

## 2. `components/**` — non-`ui` (115)

### 2.1 Record detail and activity (14) — owner 5.3

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `recordWorkspace/RecordWorkspace.tsx` | 142 | 5.3 | rebuild | `RecordWorkspace` itself is nearly a no-op forwarding to `PageShell`. The real targets are its header/primary/region/rail exports → the spine | **done** — now the archetype: header, spine, content region, and the only tab strip (named slots, not an array) |
| `recordActivity/RecordPageHeader.tsx` | 46 | 5.3 | **delete** | Superseded by `RecordWorkspace`'s own header row. Deleted in batch 4 with its last three consumers | done |
| `recordActivity/CrmRecordActivitySection.tsx` | 76 | 5.3 | **delete** | **This is a `RecordTabs` rendered inside another one.** The nested-tabs cause. The archetype owns the only strip, so this has nothing left to be | done — deleted in batch 4 |
| `recordActivity/RecordActivityFeed.tsx` | 319 | 5.3 | **delete** | Replaced by `RecordTimeline` — composer on top, `divide-y` rows (R8) | **done** — file deleted, 0 importers |
| `recordActivity/RecordActivityTimeline.tsx` | 88 | 5.3 | rebuild | Renamed — it is the *audit* history, and `Timeline` now names the feed. Moves into the spine's `History` sheet | done — `RecordAuditHistory` replaced it; the old file died with `CrmRecordActivitySection` in batch 4 |
| `recordActivity/RecordCommentsPanel.tsx` | 315 | 5.3 | rebuild | Its composer becomes `Timeline`'s note mode; the feed already emits `type="note"`, so the list goes | done — deleted in batch 4 |
| `recordActivity/RecordTasksPanel.tsx` | 374 | 5.3 | rebuild | | **done, close-out** — 5.2 had given it the panel language; 5.3 took its `PanelHeader` off (`Tasks & reminders` under a `Tasks` tab, §4.7) and dropped the hand-written green on `Complete` (§2.2 — completing a task is not an exception, and a call site does not paint a `Button`). 5.7 batch 6 — each task was a bordered tinted box inside the panel with two `Chip`s; it is a `ListRow` with status and priority as metadata |
| `recordActivity/FollowUpPanel.tsx` | 157 | 5.3 | rebuild | Becomes a composer mode in `Timeline`, not a spine block — it logs an event, it does not edit a field | done — deleted in batch 4 |
| `recordActivity/CommunicationActions.tsx` | 131 | 5.3 | adopt | | **done, close-out** — the deferred-question-1 deletion: deal and quote no longer mount it, and each channel now renders only when the record owns an address (§4.7). `showCopyActions`, `followUpTargetId` and the three WhatsApp override props went with it — 0 call sites between them |
| `recordActivity/RecordDeleteButton.tsx` | 56 | 5.3 | adopt | Destructive confirm copy is 5.9 | **done** — gained the `menuItem` presentation for the header's `[⋯]` (§2.2) |
| `recordActivity/RecordPanelStates.tsx` | 77 | 5.1 | **move** | The right abstraction, trapped in `recordActivity/`. Promote to `components/ui/` | **done** (A) — now `ui/PanelStates.tsx` |
| `documents/RecordDocumentsPanel.tsx` | 132 | 5.3 | rebuild | The Files tab | **done, close-out** — the one 5.3 row never touched by a batch. Heading gone (`Documents` under a `Files` tab, §4.7/§1.6), hand-rolled loading and error boxes onto `PanelStates`, empty state back to `DocumentList`'s own table (§7.4), `Upload Document` → sentence case |
| `forms/ReadOnlyRecordLayout.tsx` | 58 | 5.3 | rebuild | Emits `"Not recorded"` — the string §3.6 rejects | **done** — `EmptyValue`, R7 value ink, and `omitFieldKeys` for spine-owned fields |
| `forms/ResolvedRecordLayout.tsx` | 126 | 5.3 | adopt | | **done** — gained `omitFieldKeys`, filtered where sections are built so an emptied section disappears |

### 2.2 Forms, quick-create and record form pages (33) — owner 5.4

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `forms/RecordFormLayout.tsx` | 48 | 5.4 | rebuild | The sticky footer goes (R3) | **done, batch 3** — it now draws the title and the `FormFooter` too, so neither can be re-invented at a call site |
| `forms/quickCreateLayout.tsx` | 120 | 5.4 | adopt | | **done, batch 6** — `LayoutDrivenQuickCreateFields` owns traversal, custom fields, locks, ids and error framing for all four adopters; module renderers retain domain controls |
| `forms/OwnerSelect.tsx` | new | 5.4 | new | The form wrapper and shared option builder over `SearchableSelect`; also supplies `RecordOwnerField` | **done, batch 6** |
| `leads/LeadRecordFormPage.tsx` | 184 | 5.4 | adopt | | **done, batch 3** — archetype 3: the visible title, `FormFooter`, the sticky bar deleted, `FieldGroup columns={2}`, the shared `TextField` |
| `leads/LeadFormFields.tsx` | 204 | 5.4 | rebuild | Local `TextField` — 1 of 4, and the one that wired no `id` | **done, batch 3**; Owner → shared value select in batch 6 |
| `leads/LeadQuickCreate.tsx` | 199 | 5.4 | adopt | | **done, batch 6** — joined `useQuickCreateRecord`; the pilot no longer carries a private state machine |
| `leads/LeadQuickCreateLayoutFields.tsx` | 285 | 5.4 | adopt | | **done, batch 6** — shared layout frame + Owner value select |
| `leads/leadQuickCreateDraft.ts` | 28 | 5.4 | unchanged | Data | **done, close-out** — audited |
| `leads/leadMutation.ts` | 117 | 5.4 | unchanged | Data | **done, close-out** — audited |
| `leads/LeadConversionForm.tsx` | 213 | 5.3 | rebuild | **A13** | **done, batch 6** — `useUnsavedChangesGuard` on a snapshot of the state the page opened in, so the permission-derived defaults do not prompt; the guard lifts once the conversion has run |
| `contacts/ContactRecordFormPage.tsx` | 159 | 5.4 | adopt | | **done, batch 3** — archetype 3: the visible title, `FormFooter`, the sticky bar deleted, `FieldGroup columns={2}`, the shared `TextField` |
| `contacts/ContactFormFields.tsx` | 179 | 5.4 | rebuild | Local `TextField` — 2 of 4 | **done, batch 3**; Owner → shared value select in batch 6 |
| `contacts/ContactQuickCreate.tsx` | 166 | 5.4 | adopt | | **done, batch 6** — audited on the shared state machine |
| `contacts/ContactQuickCreateLayoutFields.tsx` | 269 | 5.4 | adopt | | **done, batch 6** — shared layout frame + Owner value select |
| `contacts/contactQuickCreateDraft.ts` | 23 | 5.4 | unchanged | Data | **done, close-out** — audited |
| `contacts/contactMutation.ts` | 104 | 5.4 | unchanged | Data | **done, close-out** — audited |
| `organizations/OrganizationRecordFormPage.tsx` | 282 | 5.4 | adopt | | **done, batch 3** — archetype 3: the visible title, `FormFooter`, the sticky bar deleted, `FieldGroup columns={2}`, the shared `TextField` |
| `organizations/OrganizationFormFields.tsx` | 113 | 5.4 | rebuild | Local `TextField` — 3 of 4, **plus a `RequiredTextField`** — the count was 5, not 4 | **done, batch 3**; Owner → shared value select in batch 6 |
| `organizations/OrganizationQuickCreate.tsx` | 152 | 5.4 | adopt | | **done, batch 6** — audited on the shared state machine |
| `organizations/OrganizationQuickCreateLayoutFields.tsx` | 232 | 5.4 | adopt | | **done, batch 6** — shared layout frame + Owner value select |
| `organizations/organizationQuickCreateDraft.ts` | 26 | 5.4 | unchanged | Data | **done, close-out** — audited |
| `organizations/organizationMutation.ts` | 99 | 5.4 | unchanged | Data | **done, close-out** — audited |
| `opportunities/OpportunityRecordFormPage.tsx` | 262 | 5.4 | adopt | | **done, batch 3** — archetype 3: the visible title, `FormFooter`, the sticky bar deleted, `FieldGroup columns={2}`, the shared `TextField` |
| `opportunities/OpportunityFormFields.tsx` | 109 | 5.4 | rebuild | Local `TextField` — 4 of 4 | **done, batch 3**; Owner → shared value select in batch 6 |
| `opportunities/OpportunityQuickCreate.tsx` | 187 | 5.4 | adopt | **A3** — wired into contacts and accounts but *not* the deals list | **done, batch 6** — list + contextual entry points share it |
| `opportunities/OpportunityQuickCreateLayoutFields.tsx` | 291 | 5.4 | adopt | | **done, batch 6** — shared layout frame + Owner value select |
| `opportunities/OpportunityParticipants.tsx` | 565 | — | new | crm-evolution Wave 2D, added after the programme closed | **born on the system** — `RecordRelatedCard` + `RowList`/`ListRow` rows, `EditorPanel`, `DropdownMenu` row actions, Contact Quick Create in place |
| `opportunities/OpportunityStageSelect.tsx` | 75 | — | new | crm-evolution Wave 2E, added after the programme closed | **born on the system** — the shared `Select`; options from the tenant pipeline |
| `opportunities/PipelineStageRow.tsx` | 170 | — | new | crm-evolution Wave 2E, added after the programme closed | **born on the system** — one autosaving settings row per stage: `useAutosave` + `SaveStateIndicator`, `SegmentedBoolean`, `useConfirm` before deactivating a stage in use |
| `opportunities/AddPipelineStage.tsx` | 95 | — | new | crm-evolution Wave 2E, added after the programme closed | **born on the system** — a create, so an explicit button (R1), `Field`/`FieldError` for the server's reason |
| `opportunities/opportunityMutation.ts` | 105 | 5.4 | unchanged | Data | **done, close-out** — audited |
| `opportunities/opportunityStages.ts` | 140 | 5.1 | rebuild | Tone classification (R5) | **done** (B); Wave 2E: the stage list is gone, tone comes from `semantic_type` |
| `quotes/QuoteRecordFormPage.tsx` | 820 | 5.4 | rebuild | Line-item grid → `variant="lineItems"` | **done** — batch 3 archetype; batch 5 totals/sections/labels; batch 6 Owner. The line-item table is 5.5's |
| `orders/OrderRecordFormPage.tsx` | 693 | 5.4 | rebuild | `variant="lineItems"` | **done** — batch 3 archetype; batch 5 totals/sections/requiredness/labels; batch 6 Owner. The line-item table is 5.5's |
| `finance/pos/PosInvoiceRecordFormPage.tsx` | 867 | 5.4 | rebuild | `variant="lineItems"` | **done** — batches 3 and 5; the line-item table is 5.5's |
| `finance/InsertionOrderRecordFormPage.tsx` | 416 | 5.4 | rebuild | **Two Cancel buttons** — `:265` and `:305` | **done** — batch 3 archetype; batch 4 removed the duplicate Cancel |
| `contracts/ContractRecordFormPage.tsx` | 461 | 5.4 | rebuild | | **done, batch 3** — archetype 3: the visible title, `FormFooter`, the sticky bar deleted, `FieldGroup columns={2}`, the shared `TextField`; **out of scope from 5.4 batch 4** (scoping decision 8); **out of scope** (scoping decision 8) — the module may be removed |
| `support/SupportCaseCreateFormPage.tsx` | 260 | 5.4 | rebuild | Runtime title-caser at `:260` | batch 3 — archetype 3 adopted (title, `FormFooter`, `FieldGroup columns={2}`); the title-caser is untouched; **out of scope from 5.4 batch 4** (scoping decision 8); **out of scope** (scoping decision 8) — the module may be removed |
| `catalog/CatalogRecordFormPage.tsx` | 333 | 5.4 | rebuild | Local `ToggleRow` — 1 of 2 | **done** — archetype 3 in batch 3; boolean-role decision explicitly transferred to 5.6 |
| `customModules/CustomModuleRecordCreatePage.tsx` | 286 | 5.4 | rebuild | | **done, batch 3** — archetype 3: the visible title, `FormFooter`, the sticky bar deleted, `FieldGroup columns={2}`, the shared `TextField` |
| `customModules/CustomModuleRecordEditPage.tsx` | 300 | 5.4 | **new** | Added in batch 4 as the create page with a record behind it — archetype 3, so 5.4 owns its final shape with the other 15 form routes | **done, batch 3** |
| `documents/DocumentUploadFormPage.tsx` | 533 | 5.4 | rebuild | One of two footer stragglers (`:515`) | **done, batch 4** — on `FormFooter` without becoming a `RecordFormLayout` (it is a batch queue, not a record); 3 headings onto `SectionHeading`; `aria-live` narrowed to the summary |
| `settings/message-templates/MessageTemplateRecordFormPage.tsx` | 232 | 5.4 | rebuild | Verbatim copy of the sticky-footer classes (`:205`) | **done, batch 4** — sticky deleted, on `FormFooter`, and its coloured dirty line dropped (R5) |
| `finance/payments/RecordPaymentPage.tsx` | 209 | 5.4 | rebuild | **A7** — the slower of two paths | **done, close-out** — archetype 3; A7 remains a 5.5 workflow decision with the faster dialog path |
| `catalog/CatalogRecordDetailPage.tsx` | 238 | 5.3 | rebuild | Archetype 6 — `PageShell actions=` with no record header | done |

### 2.3 Tables and lists (20) — owner 5.5

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `leads/LeadsTable.tsx` | 193 | 5.5 | adopt | On `RecordTable`. Loses its `Pill` (R5) | **done — unchanged.** `Pill` went in 5.1; nothing left for 5.5 |
| `contacts/contactList.tsx` | 209 | 5.5 | adopt | Keeps its hand-authored LinkedIn mark (§5) | **done, batches 2–3 — unchanged, deliberately.** Already on `RecordTable`; its list workflow came from the hooks above it |
| `organizations/OrganizationsTable.tsx` | 191 | 5.5 | adopt | | **done, batches 2–3 — unchanged, deliberately.** Already on `RecordTable`; its list workflow came from the hooks above it |
| `opportunities/OpportunitiesTable.tsx` | 223 | 5.5 | adopt | 5.4 batch 6 routed the empty-state action through Quick Create; 5.5 still owns the table | **done, batches 2–3 — unchanged, deliberately.** Already on `RecordTable`; its list workflow came from the hooks above it |
| `quotes/QuotesTable.tsx` | 169 | 5.5 | adopt | | **done, batches 2–3 — unchanged, deliberately.** Already on `RecordTable`; its list workflow came from the hooks above it |
| `orders/OrdersTable.tsx` | 142 | 5.5 | adopt | | **done, batches 2–3 — unchanged, deliberately.** Already on `RecordTable`; its list workflow came from the hooks above it |
| `contracts/ContractsTable.tsx` | 146 | 5.5 | adopt | 7 of 8 statuses coloured today → 3 (R5) | **out of scope** (scoping decision 8) — the module may be removed|
| `support/SupportCasesTable.tsx` | 145 | 5.5 | adopt | | **out of scope** (scoping decision 8) — the module may be removed|
| `tasks/TasksTable.tsx` | 171 | 5.5 | adopt | Priority becomes a category — no tone (R5) | **done — unchanged.** Priority is already a category with no tone (`cat()` in `statusStyles.ts`); 5.1's sweep settled it |
| `catalog/CatalogRecordsTable.tsx` | 289 | 5.5 | adopt | | **done, batches 2–3 — unchanged, deliberately.** Already on `RecordTable`; its list workflow came from the hooks above it |
| `catalog/CatalogRecordsPage.tsx` | 166 | 5.5 | rebuild | Shared wrapper for two routes | **done, batches 2–3** — addressable state (A1), the search debounce (A5) and the column picker (A2), all from the shared hooks and the toolbar |
| `documents/DocumentList.tsx` | 459 | 5.5 | rebuild | No toolbar, no pagination | **done, batch 5 — unchanged, deliberately.** It was already on `RecordTable`; the toolbar and pager were the page's to supply. 5.7 batch 6 — the share and version lists were bordered lists inside the bordered detail section; they are `RowList`s, the versions' states `PanelStates` |
| `finance/insertionOrderList.tsx` | 265 | 5.5 | adopt | | **done, batches 2–3 — unchanged, deliberately.** Already on `RecordTable`; its list workflow came from the hooks above it |
| `finance/pos/InvoicesTable.tsx` | 187 | 5.5 | adopt | | **done, batch 4** — selection props removed (**A6**) |
| `finance/payments/PaymentsTable.tsx` | 192 | 5.5 | adopt | The AR list — needs the **derived** overdue tone (R5) | **batch 4** — selection props removed (**A6**); the row action was always the verb. The overdue tone is still open |
| `customModules/CustomModuleRecordsTable.tsx` | 137 | 5.5 | adopt | | **done, batches 2–3 — unchanged, deliberately.** Already on `RecordTable`; its list workflow came from the hooks above it |
| `transactions/TransactionLineItemsEditor.tsx` | 38 | 5.5 | rebuild | → `variant="lineItems"` (R10) | **done** — batch 1. The app's only editable grid; the two hardcoded `min-w-[Npx]` are derived now |
| `transactions/TransactionTotals.tsx` | 69 | 5.4 | new | The line-item document's money ledger | **done, batch 5** — replaces three private `SummaryRow`s |
| `transactions/TransactionLineItemsTable.tsx` | 118 | 5.5 | new | The line-item document's items, once saved — `variant="readOnly"` | **done, batch 1** — replaces the same table hand-written on quote, order and POS invoice; gained `min-w-0` in the close-out |
| `client-portal/ClientPagesTable.tsx` | 160 | 5.5 | new | Extracted from the page | **done, batch 6** |
| `client-portal/ClientAccountsTable.tsx` | 130 | 5.5 | new | Extracted from the page | **done, batch 6** |

### 2.4 Settings, users, automation, integrations, record layouts (21) — owner 5.6

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `users/userManagementTable.tsx` | **873** | 5.6 | rebuild | Largest raw-`Table` consumer | **done, batch 4b** — needed `groupBy` and `isRowSelectable` on `RecordTable`; both additive |
| `users/createUserDialog.tsx` | 285 | 5.6 | rebuild | | **done, batch 7d** — its success banner painted `text-state-success` inside an already-tinted box (R5) |
| `users/editUserDialog.tsx` | 331 | 5.6 | **unchanged** | | **done, batch 7d** — audited clean |
| `users/userFilters.tsx` | 200 | 5.6 | rebuild | | **done, batch 7d** — three `text-sm font-semibold text-copy-primary` group headings → `SectionHeading` (R7) |
| `automation/AutomationRulesTable.tsx` | 105 | 5.6 | adopt | Raw `Table` → `RecordTable` | **done, batch 4a** — and the row gained an open gesture; the name had been a 200px `<button>` |
| `automation/AutomationRunsTable.tsx` | 51 | 5.6 | adopt | Raw `Table` → `RecordTable` | **done, batches 4a + 7d** — and in 7d it took the `isLoading` / `hasError` / `onRetry` its page had been drawing beside it |
| `automation/AutomationRuleEditor.tsx` | 137 | 5.6 | rebuild | | **done, batches 2 + 7d** — un-stickied, R5 on the dirty line; its `Card` shell is kept deliberately, because it is a record editor rather than a settings panel |
| `automation/AutomationStepList.tsx` | 58 | 5.6 | rebuild | | **done, batch 7d** — four visible container levels down to two (§1.3), the `bg-action-primary-muted` selection tint retired for the third and fourth time, the icon chip's `text-primary` and the success tick corrected (§5, R5) |
| `automation/AutomationInspector.tsx` | 49 | 5.6 | rebuild | | **done, batches 1 + 7a** — on `SettingsRow` + `SegmentedBoolean`, then `EditorPanel` |
| `automation/AutomationRunDetails.tsx` | 45 | 5.6 | rebuild | | **done, batch 7a** — read-only `EditorPanel wide`; the hand-rolled step-status ternary became `StatusValue` once `statusToneFor` learned the step vocabulary |
| `automation/types.ts` | 118 | — | unchanged | Data | |
| `automation/utils.ts` | 116 | — | unchanged | Data | |
| `integrations/IntegrationEventHistory.tsx` | 211 | 5.6 | adopt | Raw `Table` → `RecordTable` | **done, batch 4a** — three prose states replaced by `RecordTable`'s |
| `integrations/IntegrationWebhookWorkspace.tsx` | 306 | 5.6 | rebuild | Raw `Table` → `RecordTable` | **done, batches 4b + 7a** — `RecordTable`, then `EditorPanel`, and the Save became a submit |
| `integrations/IntegrationWebsiteWorkspace.tsx` | 652 | 5.6 | rebuild | Raw `Table` → `RecordTable` | **done, batches 4b + 7a** — three tables, six prose states retired; then `EditorPanel`, and the Save became a submit |
| `integrations/IntegrationProviderRegistry.tsx` | 181 | 5.6 | adopt | | **done, batches 4a + 7d** — `PanelError` in 4a; in 7d the section header → `SectionHeading`, two prose states in `Card`s → `PanelLoading` + `EmptyState`, and two R7 headings stepped down |
| `integrations/IntegrationSectionError.tsx` | 15 | 5.1 | **delete** | One of the 3 competing settings error idioms | **done, 5.6 batch 4a** — a verbatim duplicate of `PanelError`; all 4 call sites moved |
| `recordLayouts/RecordLayoutBuilder.tsx` | 580 | 5.6 | rebuild | ~~6 raw HTML5 DnD implementations start here~~ — **stale, corrected 7c**: this file has no drag-and-drop at all. It reorders with arrow buttons. The real set is five files, listed in 5.7 | **done, batch 7c** — five `Card` + hand-rolled `h2` → `FormSection` (R7), page actions → `ActionBar` (R4), the `aria-pressed` collapse toggle → `SegmentedBoolean` (ruling 4, a fifth idiom) |
| `recordLayouts/RecordLayoutPreview.tsx` | 95 | 5.6 | **unchanged** | | **done, batch 7c** — audited, nothing to change: it already carries the §1.3 no-third-frame argument and follows it, on `SegmentedControl` + `EmptyState` |
| `recordLayouts/RecordLayoutValidationPanel.tsx` | 69 | 5.6 | rebuild | | **done, batch 7c** — R5: the suggestion block says in its own copy that it blocks nothing, so it lost the exception tint; the error keeps it. The success tick lost its independent green (§5) |
| `recordLayouts/recordLayoutDraft.ts` | 227 | — | unchanged | Data | |

### 2.5 Dashboard, boards, calendars, mail, tasks (17) — owner 5.7

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `dashboard/DashboardCrmWidgets.tsx` | 231 | 5.7 | rebuild | `StatTile` — 1 of 5 metric implementations | **done, batch 1** — `Metric` → `StatGroup`/`StatTile`, states → `PanelStates`, bars and amounts off `state-success` onto `seriesColor(0)` and ink (R5), the index-indented funnel onto one baseline. Batch 6 — `AmountRow` is a `ListRow` |
| `dashboard/DashboardOperationalWidgets.tsx` | 188 | 5.7 | rebuild | | batch 1 — states → `PanelStates`, `DashboardEmptyMessage` deleted, the activity capsule and the green unread dot retired (R5). **The rows are batch 6's** (`ListRow`). **done, batch 6** — the activity and notification rows are `ListRow`s; the notification widget's `-mx-4` bleed is gone |
| `dashboard/DashboardPersonalWidgets.tsx` | 161 | 5.7 | rebuild | Raw `Table` → `RecordTable` | **done, batch 1** — `RecordTable variant="readOnly"`; the module tile is `Card variant="interactive"` around a `StatTile` |
| `dashboard/DashboardReportChartWidget.tsx` | 162 | 5.7 | rebuild | Load the `dataviz` skill | **done, batch 1** — states → `PanelStates`; the bar chart stopped painting each bar its own hue (rank as identity) |
| `dashboard/DashboardLayoutEditor.tsx` | 366 | 5.7 | rebuild | Raw HTML5 DnD → `SortableList` | **done, batches 1–3** — the header onto `PanelHeader` (1), the edit bar off `sticky top-2` onto an in-flow `ActionBar` (2), the grid onto `SortableList` (3) |
| `opportunities/OpportunitiesPipelineBoard.tsx` | 232 | 5.7 | rebuild | 1 of 2 unshared kanbans → `Board` | **done, batch 4** — 232 → 104 lines, a body renderer over `Board`. The card title is a link to the deal; the "High-value deal" quartile tint is gone (R5) |
| `tasks/TasksBoard.tsx` | 138 | 5.7 | rebuild | 2 of 2 kanbans | **done, batch 4** — 138 → 80 lines, a body renderer over `Board` |
| `tasks/TasksCalendar.tsx` | 178 | 5.7 | rebuild | 1 of 3 calendar grids | **done, batch 5** — 178 → 75 lines, `MonthGrid` in the list's `ModuleTableShell` with `renderListState` |
| `tasks/TaskDialog.tsx` | 395 | 5.7 | rebuild | | batch 8b — the calendar's buttons left the six-control footer for a *Calendar* section that states whether the task is on it; *Assignments* is a `SectionHeading`; option states are `PanelStates`. Title / commit Title Case left for 5.9 (`tasks-revamp` asserts it) |
| `tasks/TaskAssigneePicker.tsx` | 104 | 5.7 | adopt | | close-out — already a thin adapter over `UserTeamPicker` (5.4); nothing drawn here to adopt |
| `calendar/CalendarEventDialog.tsx` | 346 | 5.7 | rebuild | | **done, batch 5** — the Radix `Switch` is `SegmentedBoolean` in a `Field`; the owner notice is ink, not a box. Its Title Case (`Create Event`, `Move To Recycle Bin`) is 5.9's |
| `calendar/CalendarParticipantPicker.tsx` | 110 | 5.7 | adopt | | close-out — already on `UserTeamPicker`. Its *User Invite* / *Team Share* type labels are 5.9's Title Case |
| `calendar/CalendarSyncBridge.tsx` | 85 | — | unchanged | No UI | |
| `calendar/BookingForm.tsx` | 502 | 5.8 | rebuild | Public surface | batch 5 — three `text-xl` headings onto the ramp; states were already sound |
| `calendar/PublicBookingPage.tsx` | 23 | 5.8 | rebuild | 3 of 3 calendar grids | batch 5 — the wordmark at the one size |
| `mail/MailComposePage.tsx` | 239 | 5.7 | rebuild | On `RecordFormLayout`, so 5.4 batch 3 moved it with the other 15 | batch 3 — archetype 3 adopted (title, `FormFooter`, `FieldGroup columns={2}`); 5.7 still owns its final shape |
| `mail/RecordEmailComposer.tsx` | 498 | 5.7 | rebuild | | batch 8b — local `formatBytes` → `lib/format`; attachments were a box per file and are a divided list; Cc and Bcc are two `Field`s; the no-mailbox actions are an `ActionBar` |
| `mail/RecordEmailAction.tsx` | 103 | 5.3 | adopt | A record-page action | **done, close-out** — returns `null` without an address instead of a disabled `Email` / `Email Opt Out` (§4.7). Opt-out is already drawn in `Details` as `Opted out` |

### 2.6 Shell, search, notifications, identity (8)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `sidebar/Sidebar.tsx` | 249 | 5.7 | adopt | Wordmark is a `span` now (§8) | batch 8a — A11: a group of one renders as a link. Collapse and log-out hovers lost the action and danger tints; the wordmark link's focus is `focus-visible` |
| `sidebar/SidebarNav.tsx` | 220 | 5.7 | rebuild | `text-[13px]` at `:166`. **A11** — reports as a collapsible group of one | batch 8a — `navItemClassName` (§7.16), shared with `SettingsNavRail`: current is elevation and an ink bar, not the action tint in a box. A closed group's links are `inert`; the group marks itself only while its current item is hidden. `GlassItemWrapper` deleted |
| `header/ProfileMenu.tsx` | 64 | 5.7 | adopt | | batch 8a — `DropdownMenu`, so `role="menu"` and arrow keys; *Log out* is not red |
| `search/GlobalCommandPalette.tsx` | 399 | 5.7 | adopt | | batch 8a — one item class; group labels through cmdk's `heading` (record groups printed theirs twice); `PanelLoading` / `PanelError`; `DialogPanel` owns its own ground and shadow |
| `notifications/NotificationCenter.tsx` | 217 | 5.6 | rebuild | **A9** — admin-only href at `:210`, no `isAdmin` check | **A9 done, batch 3.** The row itself is **5.7's**, with the other ten `ListRow` implementations — batch 8 measured its unread `bg-action-primary-muted` as a fourth instance of the action-tint-as-status pattern 7d retired three times. **Row done, 5.7 batch 6** — `ListRow` in an inset `RowList`, unread is weight and an ink dot, and the hand-written loading / error / empty are `PanelStates` |
| `notifications/BrowserNotificationsBridge.tsx` | 67 | — | unchanged | No UI | |
| `LynkSplash.tsx` | 93 | 5.9 | adopt | **§9 identity — the motif is not touched.** Only `pl-[0.2em]` at `:58` | **done, 5.9 batch 1** — the padding compensated a `tracking-[0.25em]` the loader lost in the consistency pass; with no tracking left it was pushing the word off centre. `check-design.sh` **all 14 pass** |
| `client-portal/ClientPageCreateForm.tsx` | 374 | 5.8 | rebuild | `size-6` call-site control height at `:335` — a standing guard failure | **done** — 5.8 batch 5: the `size-6` was one of three hand-written chips; `RemovableChip` took all three and `check-design.sh` went 2 of 14 → **1 of 14** |

### 2.7 Shared field and picker components (7)

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `crm/LinkedRecordPicker.tsx` | 389 | 5.1 | rebuild | The canonical relationship control; the spine's Connected block uses it | **done** (E) — audited against the Connected-block role; already compliant, no change needed. The link-display mode is built with its Connected block in 5.3, per scoping decision 4 |
| `crm/RecordTagInput.tsx` | 217 | 5.1 | adopt | Tags are not statuses — no tone (R5) | **done** (E) — its hand-rolled `rounded-full` chip now renders through `Chip` (§4.3) |
| `customFields/CustomFieldInputs.tsx` | 131 | 5.4 | adopt | | **done, close-out** — supplies the shared layout-driven renderer |
| `customModules/CustomModuleFieldInput.tsx` | 172 | 5.4 | adopt | | **done, close-out** — audited; separate custom-module form renderer |
| `documents/DocumentReferenceActions.tsx` | 71 | 5.3 | adopt | | **done, close-out** — audited against §4.7's render-only-when-it-works rule and it is the exception: a broken provider link is a state to see and fix, not an absent action. It stays disabled and its reason stopped being `title`-only (§8) |
| `finance/payments/RecordPaymentDialog.tsx` | 95 | 5.5 | adopt | The faster of A7's two paths | **done — unchanged.** Confirmed as A7's fast path in batch 4; the row action opens it |

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
| `dialog.tsx` | 247 | rebuild | **`@headlessui/react` → radix.** The last non-trivial guard failure. 9 dialog + 13 sheet call sites; do not half-land it | **done** (D);`aria-describedby` opt-out + dead `2xl` removed 18 Aug |
| `sheet.tsx` | 236 | rebuild | Same migration | **done** (D) — already on radix; no change needed. **5.6 batch 6a**: `EditorPanel` now owns its chrome (§7.11); nothing in `app/**` composes it |
| `dialog-layer.tsx` | 33 | adopt | | **done** (D) — no change needed |
| `DialogIconClose.tsx` | 20 | adopt | | **done** (D) — no change needed |
| `ExportControls.tsx` | 362 | rebuild | Headless UI `Menu` → radix | **done** (D) |
| `ImportControls.tsx` | 442 | rebuild | Headless UI `Menu` → radix | **done** (D) |

**Created by 5.1** — not in the original 54, because they did not exist when the census was
taken. Counted here so the denominator stays honest.

| Path | Verdict | Note | Status |
|---|---|---|---|
| `Money.tsx` | **new** | Over `lib/currency.ts`. Owns formatting and `tabular-nums`, never ink or size | **done** (A); call sites adopted 18 Aug |
| `EmptyValue.tsx` | **new** | §3.6 in one place: `Not set` in a field, `—` in a cell. Makes 5.9's sweep one edit | **done** (A); first call sites 18 Aug |
| `SectionHeading.tsx` | **new** | 137 hand-written `<h2>`s at four sizes; R7 fixes the role at 14px semibold `text-copy-label` | **done** (A) — built; **0 app consumers**, adoption is per-surface by R7 |
| `Avatar.tsx` | **new** | Replaces 2 bespoke, one falling back to `"US"` and one to `"?"` | **done** (A) |
| `SaveStateIndicator.tsx` | **new** | R1 requires it: autosave removes the button, which was the only feedback | **done** (A) |
| `ActionBar.tsx` | **new** | `ActionBar` + `FormFooter`. Owns its children's control height (R4) via context; not sticky (R3) | **done** (A) — built; **0 app consumers**, so R4 is unenforced until 5.4/5.6 |
| `SettingsRow.tsx` | **new** | Archetype 4's unit — label / description / control slot / save-state. Replaces `SettingsSwitchRow` | **done** (5.6 batch 1) |
| `hooks/useAutosave.ts` | **new** | R1's commit machine, extracted from `InlineFieldEdit` | **done** (5.6 batch 1) |
| `PanelStates.tsx` | **new** | Promoted from `recordActivity/`. Header steps down to R7; loading and empty stop being boxes (R8) | **done** (A) |
| `StatusValue.tsx` | **new** | Renders a tone per context; accepts a caller-computed override for derived tones like overdue | **done** (B) |
| `Chip.tsx` | **new** | The tag/count/marker R5 says needs "a different component with a different name" | **done** (B) |
| `SegmentedControl.tsx` | **new** | **Not in the plan.** `secondary` was 47 sites carrying a role, not 8 carrying none — see `rebuild.md` 5.1 and §2.2 | **done** (A) |
| `dropdown-menu.tsx` | **new** | **Not in the plan.** No existing radix vendor for a menu; `ExportControls` / `ImportControls` needed one to leave `@headlessui/react` — see `rebuild.md` 5.1 batch D | **done** (D) |
| `ModuleImportExportControls.tsx` | 79 | adopt | Headless UI `Menu` → radix | **done** (D) |
| `InlineFieldEdit.tsx` | **new** | The R2/R6 state-field control. 5 pages hand-rolled this, each differently — see `rebuild.md` 5.1 batch E | **done** (E). Renders through `SearchableSelect` since 5.4 b1; 5.4 b2 gave its options a `description` line and put focus back on the trigger after a save, which the disabled-while-saving trigger had been dropping to `<body>` since it shipped |
| `RecordSpine.tsx` | **new** | The signature (R9). Built in **5.3**, with its first real call site | **done** — rail, lifecycle track, State/Connected blocks, and the meta foot carrying the History sheet. Batch 1 added `RecordSpineCollection` (a Connected entry for a related *collection*) and gave the History sheet a real `SheetTrigger`, so closing it returns focus |
| `SearchableSelect.tsx` | **new** | §7.8's primitive, built in **5.4** batch 1. `Popover` + listbox at every count, with the search input rendered only at or above `SEARCHABLE_SELECT_MIN_OPTIONS`; no call site passes a flag. `selectTriggerVariants` is exported from `select.tsx` so the two forms of a select are one class source | **done** (5.4 b1) — `InlineFieldEdit`'s 17 call sites and `TimezonePicker` |
| `recordWorkspace/RecordOwnerField.tsx` | **new** | The record's owner, in the spine's State block, on all **nine** record types (§4.7). Built in **5.4** batch 2, with every one of its call sites in the same commit | **done** (5.4 b2) |
| `hooks/useUserOptions.ts` | **new** | The tenant's active users for a select that filters in memory, one cached request per module key. Carries `has_more` so a capped list can say so (§7.8) | **done** (5.4 b2) |
| `TextLink.tsx` | **new** | §2.2's link in text, built in **5.9** batch 3. Five recipes → one; the underline drawn at rest. Not the row's open gesture, which stays in `ListRow` / `Board` | **done** — nine call sites, plus `FieldDescription`'s `[&>a]` rule onto the same ink |

### 3.2 Existing primitives

| Path | Lines | Owner | Verdict | Note | Status |
|---|---|---|---|---|---|
| `PageShell.tsx` | 144 | 5.3 | adopt | Gains `variant="record"` | **done** — full-height column from `lg`; below it the page reverts to a document scroll |
| `PageHeader.tsx` | 71 | 5.1 | adopt | | |
| `Card.tsx` | 73 | 5.2 | adopt | The panel role in R8's taxonomy; gained `asChild` for the sweep's `<section>` panels, and `data-slot="card"` so 5.10's nesting guard can see a panel (§7.6) | done |
| `RecordTable.tsx` | 457 | 5.5 | rebuild | Gains `lineItems` and `readOnly` (R10) | **done** — batch 1. Both variants, the enforced variant contract, the `emptyState` union, and the empty state moved out of the table's scroll width |
| `Table.tsx` | 204 | 5.5 | unchanged | The cell primitive. **After 5.7**, not 5.5, only 3 files may import it — the twelve settings / automation / integration / reports / dashboard tables move with their own pages. See 5.5 "What the measurement says now" | **done** — unchanged, as specified |
| `ModuleTableShell.tsx` | 70 | 5.5 | adopt | Never gets a max-height back (§11.1) | **done — unchanged.** No max-height, and the `nested` variant now covers the two client-portal tables that were drawing a second edge |
| `ModuleTableLoading.tsx` | 49 | 5.5 | adopt | | **done — unchanged.** Skeleton rows stay inside the table; only the three centred states moved out (batch 1) |
| `ModuleListToolbar.tsx` | 69 | 5.5 | adopt | | **done, batch 3** — draws the `[columns]` control archetype 1 has always shown in it |
| `TableDensityToggle.tsx` | 16 | 5.5 | adopt | | **done — unchanged.** Density is an app-wide preference and stays one level below `RecordTable` (batch 1) |
| `Pagination.tsx` | 194 | 5.5 | adopt | | **done — unchanged.** Driven by `usePagedList`, whose page state is in the address now (batch 2) |
| `SearchBar.tsx` | 37 | 5.5 | rebuild | **A5** — debounce. No debounce anywhere today | **done, batch 2 — unchanged, deliberately.** The debounce belongs in `usePagedList`: the input must stay instant and only the query waits |
| `ColumnPicker.tsx` | 143 | 5.5 | adopt | **A2** — wired into 1 of 16 pages | **done, batch 3** — unchanged itself; `ModuleListToolbar` owns its placement now, so it is on every list |
| `SavedViewSelector.tsx` | 79 | 5.5 | adopt | The correct hand-rolled tablist reference | **done — unchanged.** Still the correct hand-rolled tablist reference; it writes `?view=` through the hook now (batch 2) |
| `SavedViewConditionEditor.tsx` | 357 | 5.5 | rebuild | | **done — unchanged.** Its conditions serialise into `filters_all` / `filters_any` in the address (batch 2); the editor itself needed no change |
| `InlineSavedViewFilters.tsx` | 87 | 5.5 | adopt | | **done — unchanged.** Same as above |
| `SectionTabs.tsx` (was `RecordTabs.tsx`) | 94 | 5.3 | rebuild | Radix, correct. Was marked **do not re-fix** | **done, batch 5** — renamed, and the note above was wrong on two counts. Its `Tabs.Content` carried `focus-visible:outline-none` with nothing behind it (§2.3), and its trigger class list was a byte-identical duplicate of the archetype's. It had one call site left, none of them a record, and the name is why two more pages hand-rolled a strip. It is the card-scoped strip now, on all three such pages |
| `QuickCreateSurface.tsx` | 315 | 5.4 | adopt | **A3** — both create paths on all 15 modules | **done, batch 6** — one surface for the four current adopters; the nine-module rollout is owned by crm-evolution |
| `EmptyState.tsx` | 29 | 5.9 | adopt | Copy: an invitation to act | **done, 5.9 batch 4** — the primitive holds no copy; its words are the call sites'. 34 direct uses and 42 list `emptyState` props were read; the ones lacking an action have it beside them (a form or header button), except the webhook list, which gained *Create webhook*, and customer groups, which said *once the backend provides them* |
| `PermissionDeniedState.tsx` | 36 | 5.6 | adopt | Reaches 1 of 23 settings pages | **done, batches 3 + 7d** — batch 3 took it to all 21 page files and found the measurement had been of the wrong thing; **the component itself audited clean in 7d** — its `text-xl` is a *state* title, which §3.3 allows |
| `RouteStates.tsx` | 32 | 5.1 | adopt | Also the source for the 38 route boundaries | |
| `skeleton.tsx` | 13 | — | unchanged | Correct | |
| `spinner.tsx` | 16 | — | unchanged | Correct | |
| `sonner.tsx` | 65 | 5.9 | adopt | Toast copy keeps the action's name | **done, 5.9 batch 4** — no copy in the primitive. 149 success toasts read: already noun + past tense bar three (*Module created* and *Module changes saved* lacked a period and the verb; *Notification channel added.* named a thing the button calls a webhook) |
| `input.tsx` | 25 | — | unchanged | Fixed in consistency Phase 2 | |
| `textarea.tsx` | 20 | — | unchanged | same | |
| `select.tsx` | 189 | 5.1 | adopt | Gains `SelectTrigger variant="ghost"` — `InlineFieldEdit`'s R6 affordance, added to the primitive per §7.3 rather than styled at the call site | **done** (E) |
| `input-group.tsx` | 171 | — | unchanged | same | |
| `checkbox.tsx` | 142 | — | unchanged | same | |
| `radio-group.tsx` | 130 | — | unchanged | | |
| `switch.tsx` | 153 | 5.6 | adopt | Used in **zero** settings pages today | **done (ruled, not rebuilt), batch 1; a fifth idiom found in 7c** — `SegmentedBoolean` is the boolean (ruling 4). Its 3 call sites are not 5.6's rows: `CatalogRecordsTable` and `LeadConversionForm` → 5.3, `CalendarEventDialog` → 5.7 (**done, 5.7 batch 5** — two importers left). 7c added a fifth: a `Button` flipping `variant` with `aria-pressed`, in `RecordLayoutBuilder` |
| `SettingsSwitchRow.tsx` | 112 | 5.6 | **delete** | A purpose-built settings primitive used in **2** files | **done, batch 1** — a hand-rolled `SegmentedBoolean` (ruling 4). Replaced by `SettingsRow`, whose control is a slot |
| `label.tsx` | 24 | — | unchanged | | |
| `field.tsx` | 248 | 5.4 | adopt | | **done, close-out** — shared form framing adopted |
| `RequiredMark.tsx` | 3 | — | unchanged | | |
| `separator.tsx` | 28 | — | unchanged | | |
| `popover.tsx` | 48 | — | unchanged | | |
| `CustomFieldValue.tsx` | 20 | 5.5 | adopt | Content-only since Phase 3 | **done — unchanged.** Content-only since Phase 3 |
| `ImageAssetField.tsx` | 115 | 5.4 | adopt | | **done, close-out** — audited |
| `TimezonePicker.tsx` | 93 → 59 | 5.4 | adopt | Collapsed into `SearchableSelect` — the file now holds only what is about timezones, and its `slice(0, 100)` over ~400 zones (a live §7.9 defect) went with the hand-rolled list | **done** (5.4 batch 1) |
| `UserTeamPicker.tsx` | 214 | 5.6 | adopt | | **done, batch 7d** — the selected-row `Check` was `text-primary`, the action's ink marking membership (§5) |
| `DataTransferJobProgress.tsx` | 86 | 5.6 | **unchanged** | | **done, batch 7d** — audited clean; already on `Card variant="muted"` with no hand-rolled heading or state |
| `chart.tsx` | 78 | 5.7 | adopt | Load the `dataviz` skill | batch 8a — the tooltip swatch's fallback reads `seriesColor(0)`, not a raw `var(--chart-1)`; the rest already met the dataviz text-in-ink rule |
| `importExportUtils.ts` | 54 | — | unchanged | Data | |
| `HexagonBackground.tsx` | 109 | — | unchanged | **§9 identity.** Verify it still renders as a honeycomb after 5.8 | done — untouched by 5.8; the atmosphere around it was tokenised, it was not |
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
| `lib/currency.ts` | 5.1 | **new** | Does not exist. Dates *are* centralised in `lib/datetime.ts` — the contrast is the argument | **done** (A); 12 shadowing duplicates removed 18 Aug, zero currency `Intl.NumberFormat` left outside it |
| `lib/chartColors.ts` | 5.7 | adopt | Already correct; the only legal source of chart colour | |
| `lib/datetime.ts` | — | unchanged | Already the single source for time | |
| `lib/module-display.ts` | 5.9 | adopt | `formatSnakeCaseLabel` is the only function allowed to build a label from a key; 17 open-coded repeats go | **done, 5.9 batch 1** — it now produces sentence case and splits on `_ . -`, so it absorbed the event-type and activity-log humanisers too. The twelve open-coded repeats left at HEAD are gone (five had gone in 5.1–5.8); `statusStyles#labelize` and `automation/utils#formatModuleLabel` call through it |
| `lib/routes.ts` | 5.6 | rebuild | **A9** — the notification href fallback at `:86` points at an admin-only route | **done, batch 3** — the fallback is the dashboard. A fourth A9 site turned up in `DashboardOperationalWidgets`, which passed the admin route explicitly |
| `lib/moduleViewConfigs.ts` | 5.5 | adopt | | **done — unchanged.** It already supplies the column options the toolbar's picker needed (batch 3) |
| `lib/savedViewQuery.ts` | 5.5 | rebuild | The request codec | **done, batch 2** — gains the address-bar codec: one `SavedViewConfig`, two destinations |
| `hooks/useListAddress.ts` | 5.5 | new | The single writer of a list's query string | **done, batch 2** — so two hooks sharing one address cannot drop each other's params |
| `lib/module-registry.ts` | 5.7 | adopt | **A11** — reports is a single-item collapsible group | |
| `hooks/usePagedList.ts` | 5.5 | rebuild | **A1** — list state is not addressable; **A5** — no debounce | **done, batch 2** — `page` and `page_size` in the address; the 300ms search debounce lives here, not in `SearchBar` |
| `hooks/useSavedViews.ts` | 5.5 | rebuild | **A1, A5** | **done, batch 2** — the draft view is the address: `view`, `search`, `filters_all`, `filters_any`, `sort`, `cols` |
| `hooks/useModuleBuilder.ts` | — | unchanged | **B.2** lives at `:298` and is filed, not fixed — it needs a backend query-param contract | |

---

## 6. Roll-up by owner

| Sub-phase | Rows owned |
|---|---|
| 5.1 — cross-cutting primitives | 60 (18 primitives + 38 route boundaries + globals.css + 3 shell) |
| 5.2 — panel language | 1 owned (`Card`); it *sweeps* almost every row above without owning them |
| 5.3 — record detail | **35** — was 34. Batch 4 added `custom/[moduleKey]/[recordId]/edit/page.tsx`: R2 sends a record's content fields to `/[id]/edit`, and the custom module was the one module with no such route, because its detail page *was* the form |
| 5.4 — forms | **74** — was 55. Close-out counted the route shims and data helpers already assigned to 5.4; batch 6 added `OwnerSelect` |
| 5.5 — one table, list workflow | **55** — was 43. The twelve settings / automation / integration / reports / dashboard tables were never 5.5's (their pages own them, 5.6 and 5.7); five new shared files were added: `TransactionLineItemsTable`, `ClientPagesTable`, `ClientAccountsTable`, `useListAddress`, and `lib/savedViewQuery.ts`'s row |
| 5.6 — settings | 52 |
| 5.7 — dashboard, reports, boards, calendars, mail | 32 |
| 5.8 — client portal, public, auth | 28 |
| 5.9 — copy and voice | 4 owned; it sweeps every row |
| 5.10 — guard the composition | 0 rows; all new test coverage. **Done 2026-09-25**: 21 source rules, 20 rendered checks with a canary, and the suite at 299 / 300. The primitives it corrected (`EditorPanel`, `RecordTable`, `Pagination`, `SearchBar`, `LinkedRecordPicker`, `select` / `dropdown-menu` / `SearchableSelect`, `ExportControls` / `ImportControls`, `Avatar`) keep their owning rows; the fixes are listed in `rebuild.md` 5.10 |
| — unchanged with a reason | 12 |

5.2 and 5.9 own almost nothing and touch almost everything. That is expected and it is why
they are not scheduled first: a panel sweep before the archetypes land would be swept again,
and copy is what the standardised states render, so it comes after they exist.
