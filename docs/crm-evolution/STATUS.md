# CRM evolution — where the waves stand

The handover for `CODEX-RUNBOOK.md`: a new session reads this instead of reconstructing
progress from the code. Update it at the end of every wave run, including partial ones.

Last updated 2026-10-04 (Step 4).

| Wave | State | Evidence |
|---|---|---|
| 0A–0D | Done | Lead journey baseline, `QuickCreateSurface`, `record_layouts.py` resolver, generated contracts in `frontend/contracts/` |
| 1A–1B | Done | `LeadQuickCreate`, `RecordLayoutPreview` |
| 1C–1F | Done | `RecordWorkspace`, `record_activity.py`, `mail_associations.py`, `RecordEmailComposer` |
| 2A | Done | Contact and Organization Quick Create, contextual Account → Contact / Deal |
| 2B–2C | Done | `sales_opportunity_contacts`, `opportunity_participants_routes.py` |
| 2D | Done | Opportunity Quick Create (rebuild 5.4 A3); participant display and management |
| 2E | Done | Configurable pipelines: `sales_pipelines`, stage references, semantic business logic, stage pickers, settings page with add/reorder, board audit, saved-view display. See below | `sales_pipelines`, `pipelines_services.py`, `GET /sales/opportunities/pipeline`, `sales_opportunities.pipeline_stage_id`, `useOpportunityPipeline`, `OpportunityStageSelect`; inventory in `04a-stage-inventory.md` |
| 3A | Done (closed 2026-09-29): Lead, Contact, Organization and Opportunity runs; 05 backend Phases 3–4, frontend Phases 3–4. See below | `RecordEmailComposer` recipient candidates; `related_contact_ids` on `POST /mail/records/{module}/{id}/send`; `related_access` on the summaries |
| 3B | Done (2026-09-30): 06 Phase 1, external-mode contract. See below | `GET /whatsapp/capabilities`, `resolve_whatsapp_capabilities`, `lib/whatsapp.ts`, `useWhatsAppCapabilities`; `test_whatsapp_external_mode.py`, `whatsapp-external-mode.spec.ts` |
| 3C | Done (2026-09-30): 07 Phase 1, `tel:` fallback and manual call logs. See below | `call_logs`, `POST /telephony/records/{module}/{id}/calls`, the `call` Activity adapter, `lib/calls.ts`, the composer's `CallMode`; `test_call_logs.py`, `call-logs.spec.ts` |
| 3D | Not started: needs an explicit provider request (README Wave 3 item 17) | |
| 4A | Phase 1 done (2026-10-01): 08 event inventory and external contract. **Awaiting the owner's approval of the contract before Phase 2.** See below | `08a-webhook-event-contract.md`, `webhook_events.py`, `crm_events.public_id`, `GET /admin/webhooks/event-types`; `test_webhook_event_contract.py` |
| **4A Phase 2 onward** | **Not started. Next: 08 Phase 2 (subscriptions), once 08a is approved** | |
| Owner fixes (2026-10-01) | Done: automation made to work end to end (stays in Settings); settings' second nav rail removed. See below | `automation_records.py`, derived triggers and templates in `automation_registry.py`; `test_automation_triggers.py` |
| Reports rebuild | **Phases 1–3 done (2026-10-01)**: engine v2, library, viewer, builder, shared dashboards, scheduled email and XLSX. Phase 4 deferred. See below | `11-reports.md`, `report_engine.py`, `report_dashboards.py`, `report_subscriptions.py`, `test_report_engine.py`, `test_report_subscriptions.py`, `reports-revamp.spec.ts` |
| ERP programme | **Plan written (2026-10-01): `12-erp-inventory.md`.** Order E1 products and services → E2 inventory → E3 fulfilment → E4 purchasing → E5 invoicing and bills → E6 costing. Owner accepted every §7 recommendation (2026-10-01). See below | `12-erp-inventory.md` |
| ERP E1 | **Done (2026-10-02): products and services, first class.** Committed as `4eed89f`. See below | `20260825_catalog_first_class`, `catalog/services/line_links.py`, `category_services.py`, `item_services.py`, `item_routes.py`; `CatalogItemSalesPanel`, `settings/catalog-categories`; `test_catalog_first_class.py`, `catalog-line-items.spec.ts` |
| ERP E2 | **Done (2026-10-02).** Phase 1 `a7a1dc4`; Phases 2–3 and the review fixes `f7a80d6`. See below | `20260826_inventory_ledger` → `20260829_inventory_reorder`, `stock_ledger.py`, `document_services.py`, `opening_import.py`, `test_inventory_documents.py`, `inventory-phase1/2/3.spec.ts` |
| ERP E3 | **Implemented (2026-10-02): reservation, deliveries, returns.** Phase 0 committed as `9ed7e7b`; Phases 1–3 committed together. See below | `20260830_order_reservations` → `20260901_inventory_returns`, `stock_ledger.py` (reservations), `delivery_services.py`, `return_services.py`, `reservation_services.py`; `OrderFulfilmentPanel`, `ReservationsDialog`, `DeliveryDocumentPage`, `ReturnDocumentPage`; `test_inventory_reservations/deliveries/returns.py`, `fulfilment-phase1/2.spec.ts` |
| ERP E3 follow-ups | **Implemented (2026-10-02): delivery notes, client-portal orders hold stock once confirmed, order priority.** `12a-erp-fulfilment.md` §6a. Verified and committed with E4 | `20260902_e3_followups`, `deliveries/[id]/print`, `_apply_portal_status`, `priority_rank`; `test_e3_followups.py` |
| ERP E4 | **Implemented (2026-10-02): purchasing, all three phases.** Plan `12b-erp-purchasing.md`; §5 decisions taken as recommended (owner asked for all phases before testing). One test pass, all green; committed | `20260903_purchasing`, `modules/purchasing/`, `/dashboard/purchasing/*`; `test_purchasing.py`, `purchasing.spec.ts` |
| ERP E5 | **Implemented (2026-10-03): invoicing and bills, all four phases.** Plan `12c-erp-invoicing.md`; owner accepted every §5 decision and added §5a (deferred items built to be additive). One test pass, all green; committed as `2c1fec5`. See below | `20260904_invoicing`, `invoicing_services.py`, `payment_services.py`, `credit_note_services.py`, `bill_services.py`; `/dashboard/finance/credit-notes`, `/dashboard/purchasing/bills`; `test_invoicing.py`, `invoicing.spec.ts` |
| ERP E6 | **Implemented (2026-10-03): costing and valuation, all three phases.** Plan `12d-erp-costing.md`; owner accepted every §5 decision. One test pass, all green; committed as `389dda2`. See below | `20260905_costing`, `costing.py`, `valuation_services.py`, `valuation_routes.py`, `/dashboard/inventory/valuation`, `OrderMarginPanel`; `test_inventory_costing.py`, `costing.spec.ts` |
| **Next, owner-set order** | **E6 verified; awaiting the owner's commit. The ERP programme (E1–E6) is complete; next wave not yet chosen.** E4 §5 decisions reviewed and accepted (2026-10-03). | |
| Final fixes | **Plan approved in direction (2026-10-03): `13-final-fixes.md`, phases F0–F11, all before UAT.** Owner decisions in §2: tax rates, a full accounting module (F7), invoices at `/invoices`, insertion orders retired, custom modules completed (reverses the AGENTS.md deferral in F8), tenant picklists. Code audit of every item done (2026-10-03, `13a-final-fixes-audit.md`): found sales restore drops order lines and deal participants, production uploads missing from `platform-backup.sh`, export buttons absent on 8 ERP lists, no exchange rate on invoices/bills/payments. Full review pass (2026-10-03, `13a` Part 2): 74 findings A1–G5 (bugs, security, data model, missing features, code quality, production readiness, tests), each placed in a phase; new phases FQ (code foundations), F12 (automation, notifications, lead capture), F13 (security and privacy). Hands-on browser pass done (2026-10-03, `13a` Part 3): 30 more findings H1–H30, among them deal edit broken for converted deals (H1), swallowed form errors (H2), the realtime stream blocking the event loop (H3), unpinned dependencies (H4), mixed-currency totals (H5); A10 withdrawn. QA test records listed in 13a Part 3. Remaining flows tested hands-on (13a Part 4, I1–I10): tenant backups fail since E5 (I1, invoice lines lack tenant_id); delivery, return, credit note, automation, report, module builder and client portal verified working; email sending untested (no mailbox for the admin). Owner approved 08a (F10 unblocked) and the §7 execution order (Step 1 = data loss and wrong data). No code changed. **§7 Step 1 done and committed (`6da41ec`, 2026-10-04). §7 Step 2 done and committed (`d66f726`). §7 Step 3 done and committed (`2e3bd7f`). §7 Step 4 (FQ code foundations) implemented and verified (2026-10-04): E5, E1/A5/G3, E2, E8/H15, B6, H9, H10. Next: §7 Step 5** (F1 names, retirement, one order model; B7 joins it). See below | `13-final-fixes.md`, `13a-final-fixes-audit.md` |

## Final fixes §7 Step 4 — FQ code foundations (2026-10-04)

Every Step 4 item of `13-final-fixes.md` §7, built first and tested once. Behaviour is unchanged
except where a foundation fixed a bug it exposed (noted). Where each foundation lives is now
written down in `backend/AGENTS.md` ("Foundations every module uses", E10).

- **E5, one unit of work:** `app/core/unit_of_work.py`. `unit_of_work(db)` turns a nested
  `db.commit()` into a flush and commits once at the end (or rolls everything back);
  `on_commit(db, fn)` runs after the real commit and is dropped on rollback; `savepoint(db)`
  drops the callbacks made inside it. The stock ledger's private after-commit dispatch became
  this. Events: `stage_crm_event` / `stage_standard_crm_event` write the row with the caller's
  transaction and queue Celery only after commit (`emit_crm_event` = stage + commit);
  `safe_emit_crm_event` and `safe_log_activity` use a savepoint inside a unit of work so their
  failure never undoes the action. Applied to the composite flows: lead conversion, quote →
  order, order create/update (services now flush; the routes wrap `unit_of_work`). The ERP
  document routes already committed once. **Bug fixed on the way:** an automation rule whose
  second action failed committed the first action's records beside a run marked failed; the
  actions now run in a savepoint (`test_automation_rules`).
- **E1/A5/G3, one list query:** each ERP document list (deliveries, returns, POs, receipts,
  bills, credit notes, payments) has one `list_query` in its service, used by the list route
  and by the export; `platform/services/document_exports.py` is the registry the export job
  reads, and every export-job route now takes the list's own filters (`payload["filters"]`), so
  F9's buttons only have to pass them. Invoices export through `build_invoice_query`. **Bug
  fixed:** the account export used a private copy of the list query with no owner or
  updated-at filters (filtering to one owner exported everyone's accounts); it now uses the
  repository's. Dead search helpers removed from the contacts and deals services.
  `test_list_export_parity.py` checks every document list and its export share one query and
  filters, and on real rows (POs, accounts) that they return the same records.
- **E2, one catalog item:** `catalog_item_repository`, `catalog_item_services` (a `CatalogKind`
  with product-only hooks: stock tracking and opening balance, reorder levels, barcode,
  preferred vendor) and `catalog_item_routes.build_catalog_item_router`. `product_services` /
  `service_services` keep their public functions as thin kind-bound wrappers. 2,321 → 1,722
  lines. Each catalog action now commits once with its activity row. The OpenAPI path
  parameter is `{item_id}` for both (no client used the name).
- **B6, one permission helper:** `can_access` / `require_access` (+ `_any`) in
  `core/permissions.py` and `PermissionPolicy.can(module, *actions)`. The `_allowed`, `_can`,
  `_require`, `_require_order_view`, `_can_view_valuation` copies and the inline
  "view module and action" checks are gone (catalog, purchasing, bills, invoices, credit notes,
  payments, deliveries, returns, orders, inventory, summaries, stock ledger, exports, call logs,
  participants, record timeline). `test_permission_helpers` fails on a new private idiom.
  **B7 (website-integration routes on module permissions) moves to Step 5:** it needs a module
  key, seed and role matrix, and Step 5 turns website orders into sales orders anyway.
- **E8/H15, one line editor:** `components/transactions/LineItemsEditor.tsx` (Enter walks down
  a column and adds a line at the end, add/remove, one error slot, `LineNumberInput` /
  `LineTextInput`). Quotes/orders/invoices (`TransactionLineItemsEditor`), purchase orders,
  bills, adjustments and transfers all use it; adjustments/transfers were a bespoke per-line
  form before. `RecordTable variant="lineItems"` is now `table-fixed`: columns take a `share`
  of the width (item largest), the line's description sits under its item, the remove header
  is screen-reader only. design.md §4.7 and §7.10 updated. The fixed-row quantity grids
  (receipt, delivery, return, credit note) stay on `RecordTable lineItems` and inherit the
  layout. Accessible names kept where specs use them; adjustments/transfers now name their
  cells "Change, line 1" etc. (`inventory-phase2.spec.ts` updated).
- **H9:** `RecordTable` columns take `rendersLink` ("the cell is the link"); the two pages that
  nested an `<a>` (order invoicing panel, invoice credit notes) use it. `design-rules.spec.ts`
  has a `nestedLink` check on every route, with a canary.
- **H10:** `Input` and `Textarea` draw `null` as empty, so a record's empty field never makes an
  uncontrolled input turn controlled.

**Verification (one pass, then fixes, then the touched set again):** full backend suite 1558
tests: 24 failures, 25 errors. 4 were the known Redis rate-limit tests; the rest were test
scaffolding the foundations changed (fake `PermissionPolicy` classes without `can` — they now
borrow `PermissionPolicy.can`; two fake sessions without `Session.info`; order helpers that
relied on the service committing — they now commit as the caller; one test that only passed
when an earlier test had cached the tenant's currencies — it seeds them), my new tests' filter
operator, and three real defects: an undefined `policy` in the invoice detail route (every
invoice page would have failed), a missed multi-line idiom in `record_activity`, and on-commit
callbacks surviving a unit of work that failed before any SQL (now dropped explicitly; the hook
is `after_soft_rollback`). Rerun of the 28 failing/touched modules with Redis up: 609 tests OK.
`verify_migrations` passes at `20261006_sidebar_regroup` (no migration in this step);
`verify_openapi` 469 paths. `check-design.sh` 21/21, lint clean, production build passes.
Browser, through `e2e.sh`: chunk 1 on a disposable database (the new
`final-fixes-step4.spec.ts`, quotes, orders, invoices, invoicing, insertion orders, and the
design and scroll guards scoped to sales, finance, purchasing, inventory and catalog: 55 and 35
routes) 28/29, the one failure my spec's locator (the deals page opens on the board; it now
finds a deal through the API). Chunk 2 (step 4 spec again, catalog line items, catalog,
purchasing, inventory phase 2, deals, leads) 40/43: the step 4 spec green; `inventory-phase2`'s
two draft tests need a tracked product, and the demo seed makes none ("No tracked stock" on a
fresh database, the same gap Step 3 noted for ERP documents); one leads test over the 30 s budget
on one CPU. Rerun on the dev database (`--shared-db --timeout 90000`, as the owner allowed):
19/19. The nested-link guard saw its canary and found no nested link on the scoped routes.
The dev database now holds the inventory spec's restored draft adjustment and its
"E2 browser …" warehouse. **Not run:** generated-contract drift (no record-layout API change);
the full rendered walk (due at F4). **Worth doing before F4's walk:** a tracked product in the
demo seed, so the inventory specs and record pages run on a fresh database.

## Final fixes §7 Step 3 — errors users can see and act on (2026-10-04)

Every Step 3 item of `13-final-fixes.md` §7, built first and tested once.

- **H2:** one mapper, `lib/apiErrors.ts`. `ApiError` now carries `fieldErrors`; a 422 list is
  mapped by `loc` with sentences that name the fix ("Enter a valid email address."), a 4xx
  string is the domain's own sentence, a 5xx detail is never shown. `ServerFieldErrorsProvider`
  (`components/forms/ServerFieldErrors.tsx`) puts each message on its input by id, and
  `TextField`/`CustomFieldInput` read theirs. Wired into the lead, contact, account and deal
  forms, all four quick creates (`useQuickCreateRecord` merges server errors into the layout's),
  every ERP `request` helper, invoice actions, the conversion form and the bill (the vendor
  invoice clash goes on its field, which is now marked required).
- **H23:** `apiFetch` bounds the time to the response headers: reads 20 s, writes 60 s, uploads
  5 min; a timeout is not retried and throws `RequestTimeoutError`. Lists already had an error
  state with *Try again*; it now appears instead of endless skeletons.
- **H12:** two bugs: the composer invalidated `["record-activity", …]` while the feed is keyed
  `record-activity-feed`, and the mention search sent `search=` to a route that reads `query=`.
- **H11:** the conversion's toggles are `SegmentedBoolean` Yes/No (design ruling 4) — the
  switch's *on* was invisible in dark. *Create deal* is on by default, with amount, currency
  (when there are several) and expected close date (`LeadConversionRequest.deal_amount`,
  `deal_currency`, `deal_close_date`; the deal also gets the base currency when none is given).
  The result screen stays (the page no longer swaps to "already converted"), says what was new
  and what was linked, and links each. Each record the conversion touched gets a lifecycle row
  ("Created from lead …" / "Linked to lead … on conversion"), and the timeline has a narrow
  `lifecycle` adapter that shows a CRM record's own create/convert rows with links to its
  siblings (HubSpot and Dynamics open a record's timeline with its origin). "Opportunity" →
  "Deal" in this form.
- **H17:** `components/ui/MediaImage.tsx` renders its fallback when the file fails to load or
  there is no `src`; `Avatar`, the three print headers, catalog images, `ImageAssetField`, the
  user dialog, the insertion-order list and the portal logo use it.
- **H20:** Stock and a product's Stock tab hide removed warehouses.
- **H21:** `lib/quantity.ts` (`formatQuantity`, `formatQuantityWithUnit`) replaced 14 local
  copies; "83 units", not "83.0000 units". The Products/Services *Active* switch is a row menu
  action with a confirmation that sends `{is_active}` only (it sent the whole record before).
  The `Switch` primitive now owns its track and thumb, with a contrast thumb when on.
- **H22:** movements carry `document_number` (`inventory_services.document_numbers`, one query
  per source type, tenant-scoped); the page shows "ADJ-…" not "Adjustment #15", and Change and
  On hand sit beside the product.
- **H26:** Permissions labels modules by name; Fields says in the page why *Create field* is
  unavailable (and links the module builder for custom modules); Backups marks an enabled
  schedule whose next run is over an hour gone as *Overdue* and says beat must run.
- **H27:** `inventory` and `purchasing` are system sidebar tabs and the defaults for
  `inventory_*` / `purchase_*`; migration `20261006_sidebar_regroup` clears stored `other` on
  those and the stored `none` on Tasks and Documents (both tenants in the dev DB had it).
- **I3:** *Create credit note* on a return is disabled with its reason when nothing on it was
  invoiced (from `return-candidates`).
- **I4:** the fulfilment payload has `order_number`, so a new delivery names its order; one
  spelling "Fulfilment" (the order layout seed and stored layouts too); the fulfilment table's
  Reallocate is a compact row menu; tracking numbers link to DHL, FedEx, UPS, USPS or Aramex
  (`TrackingNumber`).

**Found on the way:** design ruling 4 already said the boolean is `SegmentedBoolean`; the
conversion form was one of the three Switch sites filed to move, so it moved. Conversion now
resolves a currency only when one is sent, so automation's convert action (which sends none)
behaves as before.

**Verification (one pass, fixes, then the touched set again):** compileall clean; full backend
suite 1533 tests, 2 errors, both this step's (the automation conversion resolving currencies;
a test fixture missing a required column), fixed and the six touched modules rerun green (104).
`verify_migrations` passes at head `20261006_sidebar_regroup`; `verify_openapi` 469 paths.
Frontend lint clean, production build passes (one type error fixed: the overdue tone),
`check-design.sh` 21/21. Browser, through `e2e.sh` on disposable databases: 23 specs in three
runs (56/59, then 36/37 with chunk one's two failing specs rerun green, then 29/30). The 5 failures were all spec-side: two locators in the new
`final-fixes-step3.spec.ts`, a catalog fixture whose image file did not exist (H17 now shows
the placeholder, so the spec serves a real PNG), `fulfilment-phase1` clicking the Reallocate
button that is now in a row menu, and the design guard calling seven empty ERP lists
"unreachable" on the fresh e2e database. The guard now reports a list that rendered its empty
state as empty, as it already did for the portal; the reruns are green. The scoped design and
scroll guards audited 45 routes across leads, deals, orders, inventory, catalog, purchasing,
invoices and the three settings pages with no findings. **Not run:** the generated-contract
drift check (no record-layout API change), the full rendered walk (due at F4), and a record
page audit for the seven ERP document lists, which are empty on a fresh database until the
e2e seed creates ERP documents (worth doing before F4's walk). The dev database is now at
`20261006_sidebar_regroup`, so both dev tenants have been regrouped.

## Final fixes §7 Step 2 — safe to run, implemented and verified (2026-10-04)

Every Step 2 item of `13-final-fixes.md` §7, built first and tested once. Owner decisions taken
at the start: Sentry SDK gated by a DSN; the platform sender stands in for invites and resets
in cloud mode only (a single-client install uses the tenant's own sender or none); a strict
nonce CSP; stopped-worker alerts as a failing readiness check, an error-tracker event and an
email to the operator.

- **H3:** the stream route authenticates with a session it closes before streaming (no
  `Depends(get_db)` held for the stream's life). Commits that write a notification or a job
  publish a wake-up on Redis (`after_flush`/`after_commit` hooks; `mark_realtime_target` for the
  bulk mark-all-read); one subscriber per process (`_RealtimeHub`) wakes the matching streams,
  which read in a worker thread with a short-lived session. Fallback check every 30 s; without
  Redis a 5 s poll, still off the loop. `scripts/load_realtime.py` opens N streams and checks
  `/health`, `/users/me` and sessions idle in transaction.
- **H4:** `backend/requirements.in` (direct deps with major bounds) compiled to a hash-pinned
  `requirements.txt` (pip-compile; minor/patch bumps only); both Dockerfiles install with
  `--require-hashes`. python-jose → PyJWT everywhere; OIDC id tokens now take their algorithm
  from the JWK and only asymmetric ones (an HMAC `alg` is refused).
- **B2:** API: nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy, a CSP
  (`default-src 'none'` on JSON), HSTS when cookies are secure (`http_errors.SecurityHeadersMiddleware`).
  Frontend: a per-request nonce CSP in `proxy.ts` (`'strict-dynamic'`, `frame-ancestors 'none'`,
  connect/img/form to the API origin), the nonce passed to `runtime-config.js` and next-themes;
  static headers in `next.config.ts`. Every page now renders per request.
- **B3:** `POST /auth/password/forgot` (same answer whatever the address, sent after the
  response, rate limited per email and IP), `/auth/password/reset` (single-use, 60 min,
  `user_setup_tokens.purpose`), `/auth/password/change` (current password checked and rate
  limited). Reset and change revoke every refresh token and set `users.sessions_revoked_at`,
  so older access tokens are refused too; the changing browser gets a fresh session. Pages
  `/auth/forgot-password`, `/auth/reset-password`, a *Forgot password?* link, a *Password*
  section on Profile. Migration `20261005_password_reset`.
- **B4:** creating a password user emails the invite (`account_emails.send_user_invite_email`);
  the dialog says whether it went and keeps the link. *Resend invite* on the edit dialog for a
  user with no password (`POST /admin/users/{id}/invite`). `password_set` on user profiles.
- **F1:** Sentry for the API, worker and beat (`observability.init_error_tracking`) and the
  frontend (`instrumentation*.ts`, error boundaries report), all off without a DSN.
- **F2:** JSON logs (text when `DEBUG`), a request id per request (`X-Request-ID`, kept when the
  caller's is well formed) on every log line and error body, task ids in the worker.
- **F3, F6, I6:** `/health/ready` checks PostgreSQL, Redis, the broker, beat and the worker
  (beat stamps a heartbeat when it publishes the heartbeat task, the worker when it runs it)
  and answers 503 naming the part. A watchdog in each web process logs an error and mails
  `OPS_ALERT_EMAIL` once per incident and once on recovery. `/health` stays the container check.
- **F4:** one error shape, `{"detail", "request_id"}`; an unhandled error is a generic 500 that
  now passes through CORS (middleware reordered: request context → CORS → headers → cookies →
  tenant → error boundary).
- **F5:** root `app/global-error.tsx`. **E13:** image hosts from the API origin. **E14:** a
  lifespan handler replaces `on_event`.
- **I2:** dashboard widgets and the sidebar show loading while the user's modules load, not
  "Reports access is required" / an empty rail. `?next=` keeps the deep link through the proxy
  redirect, an expired session (`apiFetch`) and sign-in by password or provider (parked in
  sessionStorage for `/auth/callback`). Only `/dashboard…` paths are followed.
- **I10:** Integrations shows the viewer's own mail and calendar connection ("Connected for
  you", *Your account*) beside the workspace count.
- **F0.5:** `platform-backup.sh` and `platform-restore.sh` take the stack from
  `LYNK_COMPOSE_FILES` (production by default), archive and restore uploads through the
  backend container (so the `crm_uploads` volume is covered), verify checksums before a
  restore; `scheduled` picks monthly/weekly/daily; systemd units in `deploy/systemd/`. The
  production image had no `pg_dump`: `postgresql-client` added. Documented in
  `prod-docker-deployment.md`.
- **H29:** `scripts.provision_database` creates, migrates, seeds (bootstrap, optionally demo +
  module samples) and drops `lynk_e2e_*` / `lynk_uat*` databases; `LYNK_DATABASE_NAME` points a
  process at one. `scripts/e2e.sh` now runs every browser test on its own disposable database
  through `backend-e2e` and `worker-e2e` (Redis DB 1, own uploads volume), stopping the dev
  backend and worker meanwhile (caps unchanged), and drops it after (`--keep-db`, `--shared-db`).

**Found on the way:** Next.js inlines `process.env.NEXT_PUBLIC_*` into the build even in server
code, so a production image kept the API URL it was built with and the documented "restart to
change it" never held; `lib/serverEnv.ts` now reads it per request (runtime config and CSP).
The demo seed wrote an invoice status E5 removed (`paid`), so it failed on any fresh database.
The realtime commit hooks first registered lazily and broke a commit ("deque mutated during
iteration"); they now register with `core/database.py` (`core/realtime_hooks.py`). The
production image had no `pg_dump`. Three e2e assertions still expected the settings rail removed
on 2026-10-01, and *Products & Services* was Title Case: fixed.

**Verification (one pass, fixes, then the touched set again):** compileall clean; full backend
suite 1524 tests OK (2 route tests needed the serializer to accept a `UserProfile` stand-in;
rerun green after the hook move); `verify_migrations` passes at head `20261005_password_reset`;
`verify_openapi` 469 paths. Frontend lint clean, production build passes (every route renders
per request, for the nonce), `check-design.sh` 21/21. Browser, through the new `e2e.sh` on
disposable databases (created, seeded, served, dropped each run): auth-dashboard, profile,
users, integrations, leads and the design and scroll guards scoped to profile/users/integrations
plus every public route: 38/44 first, then the 6 fixed (stale specs, the copy, the guard's
missing "OneDrive" noun) and 33/33 rerun with the 90 s budget. A CSP probe over 15 dashboard and
public pages found no violations. Realtime load test: 100 open streams, `/health` p95 250 ms,
`/users/me` 52 ms, no sessions idle in transaction. `/health/ready` answered on the dev stack.
`platform-backup.sh create` on the local stack: dump and uploads through the container,
checksums OK. Not run: a `platform-restore.sh` run (F0.6 asks for one in a scratch environment
before go-live), a real SMTP send (no sender configured), Sentry with a real DSN, the full
rendered walk (due at F4). The dev database is now at `20261005_password_reset`.

## Final fixes §7 Step 1 — data loss and wrong data, implemented (2026-10-04)

Every Step 1 item of `13-final-fixes.md` §7, built first and tested once. E6 was already committed.

- **I1:** `finance_pos_invoice_lines.tenant_id` (migration `20261004_invoice_line_tenant`, backfilled
  from the invoice; FK and index). Set by `_apply_lines` and the *Correct* copy, and by both seed
  scripts. It was the only backup child table without the column.
- **A2:** restore writes child files, not only parents (`tenant_restore_runs.py`):
  `_restore_opportunity_bundle` (pipelines and stages matched by id, else by name and stage key,
  with deals remapped onto the matched ids; participants with one primary per deal) and
  `_restore_with_children` (order lines, document versions and links). Children of a restored
  record are always created when missing; existing ones are overwritten only when the mode lets
  the backup win; extra order lines are never deleted (they may be delivered or invoiced). A
  whole-tenant restore now runs sets in dependency order (`SUPPORTED_MODULE_EXPORTS` reordered:
  accounts, contacts, leads, deals, quotes, orders, inventory, invoices, …).
- **Found on the way:** the inventory restore compared movements with `str()`, so `20.0000` from
  the database never matched `20.0` from the backup JSON: any whole-tenant restore with stock
  movements failed on PostgreSQL. Compared by value now.
- **G1:** `test_tenant_backup_round_trip.py`: every set backs up on its own; a whole-tenant round
  trip after losing every child row and recreating the pipeline under new ids gives the same
  counts and totals; module restores bring back order lines and respect the current primary.
- **A1:** the account import's duplicate lookups filter by tenant; `test_organizations_import_tenancy.py`.
  The other importers were already scoped (13a). G2's test for every importer stays in F0.7.
- **B1:** the ten client-portal admin routes (accounts, setup links, status, pages, publish links)
  also require the `client_portal` module and its view/create/edit action, on top of the linked
  contact or account; `test_client_portal_admin_access.py`.
- **H5:** `costing.BaseCurrencyTotals` converts deal amounts to the base currency at the tenant's
  last-used rate for that currency (`default_exchange_rate`; deals have no rate of their own).
  A deal in a currency with no known rate is counted but left out of the value. Used by the
  pipeline summary (deal strip), the dashboard (pipeline value, stage values) and the forecast.
  Responses carry `currency` and the unconverted count; the UI labels totals with the currency
  and says "N deals in other currencies not included". Reports' deal sums (I7) stay with F11.
- **H8:** `valuation_services.uncosted_quantities` replays only products that ever received an
  uncosted unit (uncosted receipts add, outbound moves take their share, a *Revalue* or an empty
  shelf clears). Such a product stays *Cost missing* (`cost_partial`, `uncosted_quantity`) in the
  Valuation list and summary and on the Stock tab ("Partly costed", "(partial)").
- **H1:** `lib/formValues.ts` `formValuesFromRecord` keeps the empty-form default where the record
  has null; the deal payload builder and name check are null-safe. No other record form spreads a
  record over its defaults; the wider sweep is H10 in FQ.
- **A3:** *Create invoice* on a website order with a sales order drafts the invoice through that
  order (`draft_from_sources`: linked lines, invoicing policy); only an order with no sales order
  gets a stand-alone invoice, without the shop platform as payment method or a hardcoded colour.
  Order invoicing refuses an order already invoiced from its website order. The UI shows the
  server's reason. The lasting fix (website orders as sales orders) is F1.

**Verification (one pass):** compileall clean; full backend suite 1497 tests: the 4 errors were
in the new tests (a dict read as an object, a test order not yet shipped under the delivered
policy, a missing company profile), fixed and rerun green; the 4 rate-limit failures pass with
Redis up (61 tests OK). `verify_migrations` passes at head `20261004_invoice_line_tenant`. Frontend
lint clean, build passes, `check-design.sh` 21/21. Not run: the rendered Playwright guards and a
browser pass on the dashboard, deals strip, Valuation and website orders. The dev database
migrates on the next backend start.

## ERP E6 — costing and valuation, implemented (2026-10-03)

Plan `12d-erp-costing.md`; the owner accepted all twelve §5 decisions and the E4 ones.

**Engine** (`inventory/services/costing.py`, called only by `stock_ledger.post_moves` and
`valuation_services`). Perpetual moving average per product. Every move now stores `value`,
`unit_cost`, `average_cost_after`, `cost_source` and, for order deliveries, returns and their
reversals, `sales_order_item_id`. Products cache `stock_value`; a tracked product's
`cost_price` is its average, written only by the ledger (the form shows it read-only; the API
refuses a different value with 409). Receipts at PO cost × the PO's exchange rate; returns at
the cost their delivery left at; reversals at the cost of the move they undo (fixes the E2
drift); positive adjustments at the average, or an entered unit cost when the product has
none (409 otherwise). The last unit out takes the rounding, so the value is zero whenever the
quantity is. A move with no cost never sets an average: the product stays *Cost missing*.

**Currency.** `company_profiles.base_currency` (first operating currency on migration),
locked once any move carries a value. `purchase_orders.exchange_rate` (required to place a
foreign-currency PO; settable on a placed one) and `sales_orders.exchange_rate` (optional,
margin only); both default to the last rate the tenant used. Reorder drafts are in the base
currency.

**Revaluations** (`inventory_revaluations`, REV-…): manual *Revalue* (kind `migration` when the
product had no cost), and bill price differences: the share still on hand moves the average,
the rest is `cogs_change`; voiding the bill writes the reversal. Trigger `inventory.revalued`.

**Surfaces.** Inventory → Valuation (`inventory_valuation` module, granted like
`inventory_stock`): stock value with *As of*, warehouse, category and *Cost missing* filters,
summary tiles, CSV export, and a *Revaluations* view. Product Stock tab: average cost, stock
value, value per warehouse, unit cost and value on movements, *Revalue* dialog with the change
shown first, unit cost on *Adjust stock* when needed. Adjustment lines ask for a unit cost
when needed. PO exchange rate field and fact. Order form exchange rate; order *Margin* tab
(actual for delivered, estimated for the rest and for services). Bill lines say what a price
difference did to stock value. Settings → Company → *Base currency*. Movements list gains cost
columns (with access).

**Platform.** Report sources *Stock valuation*, *Cost of goods sold*, *Sales margin*,
*Revaluations*; value fields on *Stock levels* and *Stock movements* (with access); six
templates. Report exports now answer to each source's own permission module (E5's
*Invoice lines* export had none). Valuation and revaluation CSV exports; the movements export
shows cost only with access. Revaluations join the inventory backup set; restore rebuilds stock
value. Seed: *Sample costed widget* received at 4 and 6, billed at 6.50.

**Dev database migration** (2026-10-03): 53 moves valued over 41 products; 31 products in
stock have no cost (fix with *Revalue*); 1 receipt in a currency other than its company's base
was valued at rate 1. The append-only trigger on moves is disabled for the one-time backfill
only.

**Verification (one pass).**
- Focused backend run first (costing, ledger, documents, deliveries, returns, reservations,
  purchasing, invoicing, E3 follow-ups, catalog): 133 tests, **one real defect**: a move with
  no cost set the average to zero and hid *Cost missing*. Fixed; rerun green.
- First boot against the dev database: the migration's backfill was refused by the
  append-only trigger on moves (20260827); the migration now disables it for the backfill
  only. Replay report above.
- `codex-check.sh`: migration replay at `20260905_costing`, OpenAPI 464 paths, contract drift
  passed; backend **1483 of 1484**: the *Stock value by warehouse* template disappeared for a
  user who can see the Valuation sources, because the value fields used a different access
  check than the report catalog. They now use the catalog's own; those modules rerun green.
  Design rules 21/21, lint clean, build passed first time (one-off container).
- Browser, production build: `costing` (new), `purchasing`, `invoicing`, `fulfilment-phase1/2`,
  `inventory-phase1/2/3`, `catalog-revamp`, `catalog-line-items`, `orders-revamp`, with the
  guards scoped to Inventory, Purchasing, Sales orders, Catalog and Company settings: 40 of 42.
  **One real defect: the Valuation page scrolled twice** (summary tiles and filters left the
  pinned table too little room); it is now a document page. The other failure and two more
  were locators in the new spec. Rerun: all passed.
- Full rendered walk: `design-rules` audited 137 routes, none unreachable, both themes;
  `scroll-containers` passed. The Valuation routes are in both guards' lists.

**Not done, by decision or deferral:** bill price differences charged to goods already sold are
on the *Revaluations* report source, not the *Cost of goods sold* one; webhooks for
`inventory.revalued` wait for 4A Phase 2; FIFO, per-warehouse averages, landed costs and rate
feeds are out of scope (12d §6) but additive (§5a).

## ERP E6 — plan (2026-10-03)

Benchmark and plan in `12d-erp-costing.md`; no code changed. What reading the code found
(§1): nothing computes an average (outbound moves take whatever cost price was last typed;
receipt costs never reach the product); **reversals and customer returns are costed at
today's cost price**, not the cost of the move they undo, so stock value drifts on every
cancel; moves carry no value, so there is no stock value, cost of goods or margin; products,
POs and orders each have a currency but the company has no base currency. Stock is never
backdated, so a forward moving average needs no recalculation jobs.

Dev database: 47 of 53 moves and 36 of 43 tracked products have no cost; 32 of the 37 products
in stock have no cost at all. Tenant 1's company lists USD only but has LKR products.

Proposed: a perpetual moving average per product; every move stores its value and the
average after it; value-only changes are revaluations (manual *Revalue*, bill price
differences: the share still on hand moves the average, the rest goes to cost of goods);
returns and reversals at the cost they left at; one base currency per company with a typed
exchange rate on foreign-currency POs and orders; tracked products' cost becomes the
read-only average; an *Inventory → Valuation* page (as of any date, *Cost missing*); a
*Margin* section on orders; report sources *Stock valuation*, *Cost of goods sold*, *Sales
margin*, *Revaluations*. The migration replays the ledger and marks missing costs rather than
inventing them. Phases: 1 cost engine and valuation, 2 bills and margin, 3 the platform.
The owner accepted all twelve §5 decisions (2026-10-03), and the E4 decisions too.

## ERP E5 — invoicing and bills, implemented (2026-10-03)

Plan `12c-erp-invoicing.md`. The owner accepted all twelve §5 decisions and asked that every
deferred item be built so adding it later is additive (§5a: payments and credits reach
documents only through allocation rows; every invoice and bill line names its own source
line; quantities, line amounts and serialization each live in one function).

**Phase 1, invoices become documents.** The Invoices module (`finance_pos`, key and paths
kept) is draft → issued → void; an issued invoice changes only due date, notes, payment terms
and template (*Void*, *Void and correct*, or a credit note otherwise). Numbers per tenant,
`INV-YYYYMMDD-NNNN`, given at issue; existing numbers kept. Line discount and tax as on orders;
the header discount and rate stay for POS. Payments are records (`finance_payments` +
`finance_payment_allocations`), voidable; balances are derived (`invoice_balances.py`). POS
fast path: *Issue and mark paid*. Account and company payment terms set due dates. The
Payments page lists payment records (its old saved views listed invoices and are dropped).

**Phase 2, order invoicing and credit notes.** Company setting *Invoice stocked products when
delivered / ordered* (default delivered; services always as ordered). Order *Invoicing* tab
and `invoice_status` (none · pending · to_invoice · partial · invoiced) with an orders column,
filter and *To invoice* preset; *Create invoice* from an order or a delivery drafts what is
left, pro-rating line discount and tax (the last invoice takes the remainder). Guards: an
invoiced order cannot be cancelled until fully credited, go back to draft, or lose an invoiced
line; a delivery an issued invoice charges for cannot be cancelled. Credit notes from an
invoice or a received return, never above what was invoiced; excess over the balance is
*Refund due*, settled by a refund payment.

**Phase 3, vendor bills** (`purchase_bills`, under Purchasing): from a PO, a receipt, or blank;
billed against received quantities (over-billing refused); a different price is flagged
(*Price differs from purchase order*), stock cost unchanged until E6; vendor invoice number
unique per vendor; PO `bill_status`; a receipt a posted bill charges for cannot be cancelled.

**Phase 4, the platform.** Triggers `finance.invoice_issued`, `finance.invoice_overdue`,
`finance.payment_recorded`, `finance.credit_note_issued`, `purchase.bill_posted`,
`purchase.bill_overdue` (the overdue pair from `scan_overdue_documents` on the hourly task
scan) and record sources; report sources *Invoices*, *Invoice lines*, *Credit notes*,
*Payments*, *Bills* with five templates; CSV exports of all four lists; drafts in the recycle
bin and purge; a `finance_pos` backup set (create-missing restore only: issued documents are
final) and bills in the inventory set; global search over credit notes and bills; Account
rail *Receivables* / *Payables*.

**Dev database.** Before migrating: 22 invoices (12 paid, 4 part-paid, 6 unpaid, none
refunded). After: all *issued*, 16 migrated payments equal to the old paid amounts
(mismatch 0); order invoice statuses backfilled.

**Verification (one pass).**
- Focused backend run before the frontend: 99 tests, two real defects fixed (a new bill was
  flushed before its vendor was set; test setup ids); three pre-E5 invoice unit tests that
  asserted the old mutable behaviour were removed or updated.
- `codex-check.sh`: migration replay at `20260904_invoicing`, OpenAPI, contract drift passed;
  backend 1465 tests with **12 errors from one real defect** (the Account summary's
  receivables keys landed in the contact summary); fixed, those modules rerun green. Design
  rules 21/21, lint clean. The build was OOM-killed inside the running dev container (6 GB cap,
  build plus dev server); in a one-off container it found **one type error** (the void-invoice
  edit state), fixed, build passed.
- Browser, production build: `invoicing` (new), `payments-revamp`, `invoices-revamp`,
  `purchasing`, `fulfilment-phase1/2`, `orders-revamp`, `accounts-revamp`,
  `recycle-bin-revamp`, with `design-rules` and `scroll-containers` scoped to the touched
  routes: 33 of 36. The 3 failures were spec locators (a record title is drawn twice; the
  line editor now has its own discount field); fixed, rerun 9 of 9. `payments-revamp` and
  `invoices-revamp` were updated where E5 changes behaviour on purpose (Payments lists
  payment records; an issued invoice's edit page is locked); their rule that payment failures
  never echo backend detail is kept.
- Full rendered walk: `design-rules` audited 129 routes, none unreachable, both themes;
  `scroll-containers` 86 routes; both passed. **The guards' route lists are hand-kept, so that
  walk had missed every new E5 page**; they are now listed (credit notes, bills, new bill, and
  the credit note, bill and payment records), and a walk scoped to Finance and Purchasing
  audited 23 routes, none unreachable: both passed.
- `scripts/seed_module_samples.py` now seeds an issued, part-paid invoice with a credit note,
  a draft invoice, and a posted, part-paid bill for `SAMPLE-PO-0001`.

**Not done, by decision or deferral:** record comments on credit notes, bills and payments
(document pages, as E3/E4's); bill print; an *Orders to invoice* report template (no order
report source; the orders list's *To invoice* preset covers it); webhooks for the new events
(wait for 4A Phase 2); payments accept a date up to one day ahead (a user's today can be the
server's tomorrow).

## ERP E5 — plan (2026-10-03)

Benchmark and plan in `12c-erp-invoicing.md`; no code changed. What reading the code found
(§1): **an issued, paid or void invoice can be rewritten by `PUT`**, including its status,
payment status and amount paid; payments are a running total, not records (the Payments page
is the invoice list); **invoice numbers come from one sequence shared by all tenants**
(`finance_pos_invoice_number_seq`), unlike every other document's `allocate_business_number`;
sales orders cannot be invoiced; invoices use a header tax rate where quotes and orders use
per-line amounts; `invoice.overdue` belongs to insertion orders, so invoices never go
overdue; no bills, credit notes, invoice report sources, or invoices in the backup set.

Proposed: evolve the existing Invoices module (`finance_pos`) into draft → issued → void with
issued invoices final, per-tenant numbers at issue, payment records; invoice from an order or
delivery against a tenant policy (tracked products as delivered by default); Invoiced / To
invoice and an invoice status on the order; credit notes from invoices and returns, refunds;
vendor bills from POs, receipts or blank, billed against received quantities with price
variances flagged. Phases: 1 invoices as documents and payments, 2 order invoicing and credit
notes, 3 vendor bills, 4 the platform. **Twelve §5 decisions wait for the owner.** The dev
database's invoice counts were not checked (stack down); Phase 1 starts with that.

## ERP E3 follow-ups and E4 purchasing (2026-10-02)

The owner asked for three items the first E3 cut had left out, then all of E4 before one
test pass.

**E3 follow-ups** (`12a-erp-fulfilment.md` §6a, migration `20260902_e3_followups`):
- Delivery note: `/dashboard/inventory/deliveries/{id}/print`, quantities only, ship-to from
  the order's delivery address; the `print-document` rule prints semantic tokens as black on
  white, so no design exemption.
- Client-portal orders (replaces §5 decision 7): confirming one creates a linked CRM sales order
  (`website_integration_orders.sales_order_id`) that holds stock; *Completed* ships what is left
  through a delivery; *Cancelled* / *Rejected* releases the holds (refused once shipped);
  back to review is refused. Website API orders are unchanged.
- Order priority (urgent / high / normal), editable in place on the record: arriving stock goes
  by priority, then age; a shortage releases automatic holds before manual ones, lowest
  priority and newest first.
- Also fixed: Movements now links every move to its source document (E3 had promised it for
  deliveries and returns; only sales orders were linked).

**E4 purchasing** (`12b-erp-purchasing.md`, migration `20260903_purchasing`, new area
`app/modules/purchasing/`):
- Vendors are Accounts with a *Vendor* flag (form switch, column, filter, *Vendors* preset);
  products gain preferred vendor, vendor SKU and lead time.
- Purchase orders: draft → placed → received, *Close remaining*, cancel before anything arrives,
  print. Receipts: partial, posted at the PO line's unit cost (`move_type` `receipt`), filling
  waiting sales orders at once; cancel by reversal (a closed PO reopens).
- Incoming on the Stock list and product Stock tab; Projected = Available − Backordered +
  Incoming, the same on the Stock tab and the Reorder screen.
- Reorder screen: products at or below their reorder point (or short of backorders), grouped by
  preferred vendor; selected rows become one draft PO per vendor, warehouse and currency.
- Platform: `purchase.receipt_posted` trigger and record sources; report sources *Purchase
  orders*, *Purchase lines to receive*; templates *Incoming stock by product*, *Spend by vendor
  this month*; CSV exports; recycle bin and purge; inventory backup set.
- Modules `purchase_orders`, `purchase_receipts`; sidebar group *Purchasing*.
- **Decisions taken on the owner's behalf (§5, for review):** separate receipts with the rest
  on the PO line; tracked products only; suggestions never order automatically; suggested
  quantity = max(reorder quantity, point − projected); over-receipt refused; cost from the PO
  line; no approvals, RFQs, vendor price lists or emailed POs yet.

**Verification (one pass, after all of the above).**
- Focused backend run first: 84 tests, one failure in my own test setup (a product inserted
  without its balance rows, which real creation always makes); fixed.
- `codex-check.sh`: migration replay at `20260903_purchasing`, OpenAPI 434 paths, contract
  drift, backend 1444 of 1444. The design rules then failed once: the PO page formatted a total
  with a local `Intl.NumberFormat` (now `formatMoney`). Lint passed; the build caught one type
  error on the Stock list's Incoming column; fixed, build passed.
- Browser, production build: `purchasing` (new), `fulfilment-phase1/2`, `inventory-phase1/2/3`,
  `orders-revamp`, `catalog-revamp`, `catalog-line-items`, `accounts-revamp`,
  `recycle-bin-revamp`, `integrations-revamp`. Failures: `accounts-revamp` timed out at the 30 s
  budget and passed at 90 s (the known slow-budget case, not the new Vendor switch); the
  purchasing spec found **a real defect: on the Reorder screen with several warehouses, every
  quantity box had the same accessible name** (now names the warehouse), then two locator
  mistakes of mine. Final: all passed.
- Full rendered walk: `design-rules` audited 129 routes, none unreachable; `scroll-containers`
  86 routes passed. The audit found **one real defect: the purchase order line's product picker
  had no accessible name**; fixed and re-verified with the walk scoped to `/dashboard/purchasing`
  (6 routes) plus the purchasing spec.
- The seed script now also creates *Sample Supplier Ltd* (a vendor), `SAMPLE-PO-0001` placed with
  `SAMPLE-RCV-0001` posted (a real two-unit receipt) and `SAMPLE-PO-0002` as a draft.

## ERP E3 — sales fulfilment, implemented (2026-10-02)

Plan `12a-erp-fulfilment.md`; the owner accepted every §5 decision and extended decision 2
(users can edit holds and move them to a more urgent order).

**Phase 0** (`9ed7e7b`): cancelling or rejecting a website order reverses its stock moves; a
closed website order cannot be reopened. The dev database had no affected orders, so no
backfill.

**Phase 1, reservation** (`20260830_order_reservations`). `inventory_reservations` (per order
line and warehouse, `manual` flag) with `inventory_stock_levels.reserved` as their cached sum,
written only by `stock_ledger.py`: `reserve_for_order` (confirm, edit, warehouse change; drops
what no longer applies), `release_for_order`, `set_reservations` (the Reservations dialog:
atomic, version-checked, every changed hold becomes manual), `rebuild_reservations` (after an
inventory or sales-order restore, and in `scripts/rebuild_stock_levels.py`). `post_moves`:
planned outbound moves (`website_order`, `sales_order`, `transfer_out`, `delivery`) take only
available stock; a positive move reserves for waiting lines oldest-first; a negative move
below what is held releases automatic holds before manual ones, newest order first, and tells
the order owner. Order lines now keep their IDs on edit (`_apply_items`; the order form sends
`id`). Orders gain a warehouse (shown only with two or more). UI: the order's *Fulfilment*
tab, *Check availability*, the Reservations dialog (from the tab and from the product's Stock
tab, which also shows Reserved). Holds are not backed up; restore re-derives them.

**Phase 2, deliveries** (`20260831_inventory_deliveries`). `inventory_deliveries` (+ lines):
draft → posted → cancelled (reversal), partial shipments, carrier, tracking, shipped on. The
remainder stays on the line as To deliver; *Close remaining* releases it; `delivery_status`
(none · pending · partial · delivered · closed) is cached on the order and drives *Fulfilled*.
The manual *Fulfilled* is a shortcut that posts one delivery for everything left (needs
delivery `create` + `edit`); cancelling an order with a posted delivery is refused, as is going
back to draft; a delivered line keeps its product, cannot shrink below what shipped or be
removed. The migration gives each E2-fulfilled order a posted `migrated` delivery (cancelling
it reverses the old `sales_order` moves) and closes pre-E2 fulfilled orders; the dev database
had none of either. Order list: Delivery column and filter, *Waiting for stock* filter, and
the presets *To deliver* and *Waiting for stock* (seeded once: by the migration for users who
already had order views, on first visit otherwise). Module `inventory_deliveries`; list,
document and new-from-order pages; recycle bin and purge.

**Phase 3, returns and the platform** (`20260901_inventory_returns`). `inventory_returns`
(+ lines) against a posted delivery: draft → received → cancelled, per-line *Restock* (off for
damaged goods: recorded, no stock), defaults to what can still come back; a delivery with
returns cannot be cancelled; a return does not reopen the order. Automation triggers
`inventory.delivery_posted`, `inventory.return_received` (record actions allowed); a
*Ready to deliver* notice when arriving stock completes an order's holds; report sources
*Deliveries*, *Order lines to deliver*, *Returns* with templates *Backorders by product*,
*Deliveries this month*, *Returns by reason*; CSV exports; recycle bin; backup set (older
backups without the new files still restore). Module `inventory_returns`.

**Verification (one pass, after implementing all three phases).**
- `codex-check.sh` passed whole: migration replay at `20260901_inventory_returns`, OpenAPI 418
  paths, contract drift, backend 1425 of 1425 (new: reservations 11, deliveries 11, returns 7,
  website cancel 1), 21 design rules, lint, build. (Phase 1 alone had also passed it.)
- PostgreSQL race, rolled back: a reservation on a product waited 0.98 s for a concurrent
  posting's lock; the level was unchanged afterwards and `reserved` equalled its hold rows.
- Browser, production build: `inventory-phase1/2/3`, `orders-revamp`, `catalog-revamp`,
  `catalog-line-items`, `recycle-bin-revamp`, `integrations-revamp` passed (38). The new
  `fulfilment-phase1` and `-phase2` specs failed first on two spec mistakes (orders created
  without the order number the API requires; an ambiguous "Reserved" locator) and **one real
  defect: the return page's Restock switch rendered at zero size** (the project's Switch is
  unstyled; it now carries the track, thumb and a Yes / No, damaged label). Rerun: 3 of 3.
- Rendered guards, full walk (E3 closes the module): `design-rules` audited 123 routes, none
  unreachable, both themes; `scroll-containers` 82 routes. Both passed.
- `scripts/seed_module_samples.py` now seeds `SAMPLE-SO-E3` with a posted one-unit delivery,
  a draft delivery and a draft return, so both record routes are in the guards' walk.

**Not done / deferred:** order priority field (manual reallocation covers urgency); printable
delivery notes; webhooks for the two new events (wait for 4A Phase 2, as E2's); client-portal
orders remain stock-free requests (§5 decision 7).

## ERP E3 — plan (2026-10-02)

Benchmark and plan in `12a-erp-fulfilment.md`; no code changed. What reading the code found
(§1): confirming an order reserves nothing (`inventory_stock_levels.reserved` is always 0);
fulfilment is all or nothing from the default warehouse with no delivery record; there are no
returns; website orders take stock at submission against on hand, not available; and a
**defect: cancelling or rejecting a website order never returns its stock**
(`update_order_status` does not call `reverse_moves`). Client-portal orders never touch stock.

Proposed: reserve at confirmation (partial allowed, waiting lines filled automatically as
stock arrives, a short count releases the newest holds), one-step deliveries with carrier and
tracking, the remainder kept on the order line as *To deliver* with *Close remaining*,
*Fulfilled* kept as a shortcut that posts a full delivery, cancelling a shipped order refused,
returns from a delivery with a per-line *Restock* switch. Phases: 0 the website defect,
1 reservation, 2 deliveries, 3 returns and the platform. The owner accepted all ten §5 decisions (2026-10-02) and extended decision 2: oldest first is the default, and users can edit holds and move them to a more urgent order (a Reservations dialog; manual holds are released last).
The dev database's order counts were not checked (stack down); Phase 1 starts with that.

## ERP E2 — Phases 2 and 3, consolidated test pass (2026-10-02, committed `f7a80d6`)

Implemented (Codex): adjustment documents (quantity and count modes) and transfer documents
with draft → post → cancel-by-reversal, draft removal and restore
(`20260828_inventory_documents`, `document_services.py`, `document_routes.py`, the
Adjustments and Transfers screens); per-product reorder point and quantity
(`20260829_inventory_reorder`); low-stock notification and `inventory.stock_low` /
`inventory.adjustment_posted` automation events (staged with the posting transaction and
dispatched after commit); automation triggers and record sources; stock report sources and
templates; *Low stock* and *Out of stock* saved views; stock-move items in the product
Activity; CSV opening-stock import and levels/movements export through data-transfer jobs;
inventory in tenant backup and restore (append-only aware).

Consolidated pass, one run of each: `codex-check.sh` (one backend failure, automation
registry sources for the new triggers, fixed along with a report query's Cartesian-product
warning; the three affected test modules then passed), `check-design.sh`, lint, production
build. Browser run at `--workers=1`: `inventory-phase1`, `-phase3`, `scroll-containers` and
the phase2 render test passed. Three failures, all fixed:

- Two `inventory-phase2` tests: the confirm click used `.last()`, which resolved to the
  page's *Remove draft* button behind the dialog backdrop. Now scoped to the dialog.
- `design-rules`: the adjustment and transfer record routes were unreachable because the
  tenant had no documents. `scripts/seed_module_samples.py` now adds a draft adjustment, a
  draft transfer and a second sample warehouse (drafts never touch the ledger; idempotent).

Rerun of the failures: `design-rules` passed (119 routes, none unreachable) and
`inventory-phase2` passed 3 of 3. The whole backend suite was not rerun after the
two-module fix.

**Review of everything since 2026-10-01 (Claude Code), all fixed in the same pass:**

1. Inventory restore rewrote the catalog: the `inventory_stock` backup carried all
   `catalog_products` and `catalog_categories`, so a replace or whole-tenant restore overwrote
   every product and soft-deleted newer ones. Catalog rows are out of the inventory set now
   (older backups' catalog files are ignored); the restore summary reports real
   `updated`/`soft_deleted` counts.
2. The *Low stock* / *Out of stock* saved views were re-created on every read. They are now
   seeded once, on a user's first visit, so a delete or rename sticks.
3. Removed adjustment and transfer drafts now live in the shared Recycle Bin (list, restore,
   purge), like products; the per-list *Show removed* toggle is gone.
4. A count draft re-snapshots expected quantities on every save, so a stale count is
   refreshed by saving again instead of being abandoned (`12-erp-inventory.md` §5.5 updated).
5. **Found while fixing 3, a Phase 1 defect:** the nightly recycle purge hard-deletes
   products past retention, but every tracked product has `inventory_stock_levels` rows and
   possibly ledger rows (`ON DELETE RESTRICT`), so one binned tracked product would fail the
   purge for every tenant on every run. Products with stock history are now kept (the ledger
   is append-only); for the rest, zero balance rows are cleared first.
6. Minor: document lists show status chips (`StatusValue`); Stock and the document lists use
   the shared `Pagination`; the Stock status filter is per balance row with *In stock*, *Low
   stock* and *Out of stock*, matching the Status column (the product-level `stock_status`
   query parameter is replaced by `level_filter`); a warehouse used by a live draft cannot be
   removed; the opening-import error names the warehouse code.

Fix-pass verification: `codex-check.sh` passed whole (compileall, migration replay at
`20260829_inventory_reorder`, OpenAPI 402 paths, contract drift, backend 1395 of 1395, design
rules, lint, build). New tests: count refresh, recycle-bin list and restore with tenant
isolation, warehouse guard, backup set excludes catalog, purge guard statement. The purge SQL
was exercised on PostgreSQL in a rolled-back transaction: a binned product with history was
kept, one with only zero balances was purged.

Browser: on the dev server, the full `design-rules` walk (119 routes, none unreachable),
`scroll-containers` and `recycle-bin-revamp` passed with these changes; the phase2/phase3
inventory specs timed out there on pages still recompiling after their edits (the API
returned 200 throughout). On the production build (`scripts/e2e.sh`, below) phase1, phase2
and phase3 passed with the guards scoped to the inventory, warehouse and recycle-bin routes.
That run also caught a nested link: document list numbers were a link inside the row's own
link. The cell is plain text now, as on Stock.

**Browser-test flow changed (owner, 2026-10-02):** `scripts/e2e.sh` serves the production
build on :3000 in place of the dev server; `--routes` scopes the guards while fixing, and the
full walk runs once at a module's close. See "Browser tests" in `AGENTS.md`. The same specs
took 2.6 minutes against 16 on the dev server.

Checked and fine: ledger locking, idempotency and reversal; order fulfil and cancel; three
access layers on document routes; report engine scoping and subscriptions; E1 line-link
tenant check; call-log access; migration IDs and downgrades; inventory events kept out of the
webhook contract per plan.

## ERP E2 — Phase 1 implementation (2026-10-02)

The five-player inventory benchmark in `12-erp-inventory.md` §4.2 was checked against
current Odoo, Business Central, NetSuite, Zoho Inventory and ERPNext documentation, with
direct source links added. Its ledger, warehouse, count and quantity vocabulary decisions
still fit Lynk.

Code audit for Phase 1: `product_services.py` creates and updates product stock directly;
`website_integration_services.py::_apply_stock_decrement` locks and decrements the same
catalog product within a website order transaction. Both paths must move to the ledger in
the same slice as the schema migration. The website line must be flushed before posting its
idempotent move, and its before/after snapshots must stay correct. The migration's
`stock_quantity IS NOT NULL` tracking rule would derive status for any quantified product
previously marked `preorder` or `untracked`. A read-only dev database check found 12
quantified `in_stock` products and 2 quantified `preorder` products. The accepted
derived-status rule changes those two to `in_stock` at a positive balance, so Phase 1 needs
a populated-data test and migration review for that visible transition. These checks are now
in `12-erp-inventory.md` §5.7–§6.

Implemented: tenant-scoped warehouses, balance rows and append-only movements; a locked,
idempotent posting/reversal service; deterministic opening balances; website and fulfilled
sales-order stock changes; tracked product opening stock and read-only cache fields; quick
adjustment, product Stock tab, Stock and Movements lists, and warehouse settings. The
development migration applied through `20260827_inventory_append_only`. Focused backend
tests passed (34), frontend lint and production build passed, and all 21 source design
rules passed. The two quantified `preorder` products in the development database changed to
derived `in_stock` as planned when the opening balance migration ran.

Close-out verification resumed on 2026-10-02: isolated PostgreSQL migration replay passed
at `20260827_inventory_append_only`; the development database is at that head. The five new
inventory tables' ORM columns, nullability, indexes, unique and check constraints, and
foreign keys match PostgreSQL. A rollback-only concurrent post smoke confirmed
serialization on one product (the second post waited 0.98 seconds)
and no balance or movement changes after rollback. PostgreSQL rejected both UPDATE and
DELETE on an existing movement. All 14 tracked development products have matching cached
quantities, warehouse balances and ledger sums, with the expected derived status. The
rendered scroll guard passed; the full design guard passed across 113 routes with none
unreachable. `inventory-phase1.spec.ts` passed in dark
and light themes, opening the Stock, Movements and Warehouses screens, the warehouse editor,
and the product Stock tab and adjustment dialog. Frontend lint passed again after adding
that spec. The repository-wide `alembic check` still reports extensive pre-existing model
drift across older modules; it is not a clean global check. E2 Phase 1 was committed as
`a7a1dc4`. Phase 2 and 3 changes remain uncommitted until the whole E2 module is complete.

## ERP E1 — products and services, first class (2026-10-02)

Benchmark `12-erp-inventory.md` §4.1 (Salesforce, HubSpot, Dynamics, Zoho, Odoo); design §5.1.
The owner accepted every §7 recommendation and ruled that each ERP module is benchmarked
before it is built and follows Lynk's existing design.

**Backend.**
- Migration `20260825_catalog_first_class`: `catalog_categories` (one level of nesting);
  `category_id`, `cost_price`, `unit` on products and services; `barcode` on products and `sku`
  on services (unique among active items per tenant); `catalog_product_id` /
  `catalog_service_id` on `sales_quote_items` and `sales_order_items` (at most one, `SET NULL`).
  Nothing is backfilled: existing lines stay free text.
- `catalog/services/line_links.py`: the one tenant check for line links, used by quotes,
  orders, quote → order conversion and invoices. **This closes the invoice defect** (§3 item 2:
  invoice lines accepted another tenant's product ID). Retired and binned items stay linkable,
  so old documents still save. Routes require catalog `view` only for links a write *adds*.
- `GET /catalog/items/search` (the line picker: name or SKU contains, barcode exact, exact
  codes first, active only, optional currency); `GET /catalog/{products|services}/{id}/sales`
  (quote and order lines, only the document types the viewer can open; ordered quantity
  excludes cancelled orders); `/catalog/categories` CRUD (`view` or `configure` on either
  catalog module; delete refused while anything, binned items included, uses the category).
  Category writes are in the activity log.
- Product and service lists search and filter the new fields; record layouts show category,
  unit, cost, barcode and SKU.

**Frontend.**
- `LinkedRecordPicker` gains `catalog_item`, and its result list now renders in a `Popover`
  anchored to the field, so a scroll region (the line-items grid) cannot clip it. Same
  classes, roles and keyboard path; 41 picker-using e2e tests pass unchanged.
- `TransactionLineItemsEditor`: the item cell searches the catalog in the document's
  currency; choosing fills name, the description's first line and price; typing without
  choosing is a custom line; *Unlink* drops the link. Users without catalog access get the old
  text cell. Quote, order and invoice forms seed and send the links; their read-only line
  tables link catalog lines to the item (not on the client portal).
- Catalog records gain a *Sales* tab (`CatalogItemSalesPanel`); the form gains category,
  unit, cost, barcode (products) and SKU (services); lists gain the columns and filters.
- Settings → Catalog categories (customer-groups pattern). Census rows added.

**Verification.**
- compileall; `alembic upgrade head` on the dev database; `verify_migrations` at head
  `20260825_catalog_first_class`; `verify_openapi` (382 paths); `generate-contracts.sh --check`;
  `check-design.sh` (21 rules); lint; production build.
- Backend: `test_catalog_first_class.py` (17 cases); the whole suite passes 1379 of 1379.
- e2e at `--workers=1 --timeout=90000`: `catalog-line-items` 4 of 4 (after three fixes, all in
  the new spec: price format, a route glob matching the page URL, the table's region name);
  `quotes`, `orders`, `invoices`, `catalog`, `documents`, `contacts`, `accounts` revamp specs
  47 of 47 after updating `catalog-revamp` for two intended changes (services now have a SKU;
  records have a Sales tab); `client-portal`, `opportunities`, `opportunity-participants`,
  `insertion-orders`, `tasks`, `leads` 41 of 41.
- Rendered guards, each alone on a fresh dev server capped at 6g. The new settings page is
  added to both guards' route lists. **The full `design-rules` walk was OOM-killed at the 6g
  cap** partway through (`ERR_CONNECTION_RESET`, `OOMKilled=true`), so it has no verdict. A
  scratch copy scoped to E1's 22 routes (the catalog lists, forms and records, Settings and
  Catalog categories, the quote, order and invoice forms) passed, none unreachable, both
  themes; the copy was deleted. `scroll-containers` walked every route: no height-cap finding;
  its two failures are `/client/bookings` and `/client/catalog` NAV-FAILED (pages that did not
  load, portal surfaces E1 does not touch; see the NAV-FAILED memory).
- **Not checked:** the full `design-rules` walk (needs more than 6g, or a split run); a
  PostgreSQL run of the category name filter's correlated subquery (SQLite tests cover it).

**Deferred:** price books (their own benchmark and plan, §4.1); unit conversion; grouping order
lines in a report (needs a line-level report source); catalog in tenant backups (it was never
in the backup set, which is unchanged here).

## ERP programme — plan (2026-10-01)

The owner asked for ERP modules one at a time with a written plan first. The plan is
`12-erp-inventory.md`: the programme order (§2), what exists (§3), a benchmark of Odoo,
Business Central, NetSuite, Zoho Inventory and ERPNext (§4), and the detailed design and
phases for E1 and E2 (§5, §6). No code changed.

What reading the code found (§3):

- Quote and order lines are free text, with no product or service link, so stock and
  sales-by-product cannot be computed.
- **Invoice lines accept another tenant's product or service ID** (`pos_invoice_services.py`
  copies them unchecked). Nothing leaks, but it is E1's first commit.
- Stock is one overwritable number on the product with no history. Website orders decrement
  it under a lock; the product form writes anything; order status never moves it.

Decisions (§7): fulfilment or purchasing first; several
warehouses from the start; negative stock; whether *Fulfilled* takes stock out until E3;
costing method; vendors as flagged Accounts; lots and serials. **The owner accepted every
recommendation (2026-10-01)**, and ruled that each ERP module gets its own benchmark of the major
players before it is built, and follows Lynk's existing design and primitives. E1's benchmark is
§4.1.

## Reports rebuild request (owner request, 2026-10-01)

The owner's words: *the reports module's functionality, UI and UX need a lot of work. Base
it on the major CRM and ERP players (Salesforce, HubSpot, Zoho, Dynamics, Odoo), take the
best of each, and build our own.* After Reports, **ERP modules one at a time**, to the same
first-class standard as the CRM modules (products and services, inventory, and so on), with
a written plan first.

Starting point for Reports:

- Backend: `platform/services/module_reports.py`; routes `platform/routes/module_reports.py`
  under `/reports`: modules, CRM summary, forecast and snapshots, saved reports CRUD, per-module
  report and CSV export. Access: the `reports` module plus `view`.
- Frontend: a single page `app/dashboard/reports/page.tsx`, plus
  `components/dashboard/DashboardReportChartWidget.tsx` on the home dashboard.
- First deliverable: a benchmark and plan doc in `docs/crm-evolution/` (report types,
  builder, charts, dashboards, scheduling and sharing, permissions, and what to reuse:
  `module_filters`, saved views, `list_fields`, export jobs). Then build in slices.
- **Done 2026-10-01:** the benchmark and plan are `11-reports.md` (§2 lists 8 defects in the
  former page, §5 the four phases). Phases 1–3 are complete.

## Reports Phase 3 — scheduled email and XLSX (2026-10-01)

The owner chose a **tenant-wide general sender** for scheduled CRM and automation mail.
The first consumer is report subscriptions. Settings → Integrations now stores one encrypted
workspace SMTP password per tenant; administrators see sender metadata, never the password.
Personal mailbox sends remain personal. No automation email action exists yet.

- A viewer can schedule their own email for a saved report or dashboard, daily, weekly or
  monthly in their time zone. Celery scans due schedules. Each slot has a delivery row;
  the worker claims it before SMTP so an uncertain provider acceptance is not replayed.
  Each send rechecks that the subscriber is active, Reports is available, the target is
  still visible, and every source report remains in scope. A report attaches XLSX; a
  dashboard emails the visible widget totals with its saved date and scope filters.
- Direct CSV and XLSX keep the 5,000-record tabular cap. A full XLSX uses the existing
  persisted export jobs, rechecking access at generation and download. It refuses more
  than 100,000 records instead of silently truncating. XLSX uses numeric cells for figures
  and literal cells for untrusted text.
- `20260824_report_subscriptions` adds the tenant sender, subscriptions and delivery log.
  `test_report_subscriptions.py` covers schedule time zones, sender setup, one due claim,
  disabled subscribers, and dashboard filters. The report engine's XLSX test covers labels
  and numeric cells.

Late fixes from the close-out review: a dashboard email's date override falls back to the
report's default date field, as the on-screen dashboard does; report export files expire
with the existing export retention task; a job download rechecks Reports export and
source-module view; a queued delivery left by a crashed worker is picked up by the next
scan; a failed delivery is logged with its traceback for operators (the subscriber sees
only the generic error).

Verification: compileall; `verify_migrations` at head `20260824_report_subscriptions`;
`verify_openapi`; `generate-contracts.sh --check`; `check-design.sh` (21 rules); frontend
lint and production build. Backend: the five touched modules (`test_report_engine`,
`test_report_subscriptions`, `test_module_reports_forecasting`,
`test_data_transfer_job_permissions`, `test_secret_rotation`) pass 51 of 51 after the late
fixes, and the whole suite passes 1362 of 1362 with Redis up. e2e at `--workers=1`:
`reports-revamp` 8 of 8: 7 at the first run, including the schedule dialog, then the added
admin sender flow on its own.
Rendered guards, together on one worker: `design-rules.spec.ts` passes, 109 routes, none
unreachable; `scroll-containers.spec.ts` passes.

Not checked: a real SMTP delivery. Tests mock the provider; the first live send needs a
workspace sender configured under Settings → Integrations. The sender's SMTP host is not
restricted (no private-address check), the same as personal IMAP/SMTP connections; both
are admin or user supplied.

## Reports Phases 1 and 2 — engine, library, viewer, builder; dashboards (2026-10-01)

Benchmark and plan: `11-reports.md`. Phase 1 is the engine and the three report pages;
Phase 2 is shared dashboards. Owner ruling for Phase 2: **the home dashboard stays
personal**, and shared dashboards live under Reports.

**Backend.**
- `report_catalog.py`: one source per module (base query, record link, owner scope) and
  typed fields; label resolvers show owners by name, stages by label in pipeline order,
  accounts, contacts, pipelines and teams by name. The deal amount is numeric through
  `opportunities_repository.opportunity_value_expression` (made public).
- `report_engine.py`: config version 2 (summary, matrix, tabular; up to 2 groupings and 4
  measures: count, sum, avg, min, max), version 1 configs read as version 2 without a
  rewrite, date buckets (day to year) per dialect, relative date ranges in the viewer's time
  zone, Show me (all, mine, my team), grouped rows plus subtotals plus totals in three
  queries, drill-down records, CSV (tabular capped at 5,000 rows).
- `report_templates.py`: 13 templates. `module_reports.py`: saved reports gain a description
  and `private` / `everyone` sharing, the owner is the only editor, and create, share and
  delete are logged. The v1 `GET /reports/modules/{key}` runs on the new engine.
- `report_dashboards.py` with `report_dashboards`: widgets hold report IDs only and resolve
  per viewer (`missing`, `not_shared`, `no_access`); dashboard filters are a relative date
  range and Show me.
- Routes: `GET /reports/templates`, `POST /reports/run`, `/run/records`,
  `/run/export.csv`, `GET /reports/saved/{id}`, and CRUD under `/reports/dashboards`.
  Migrations `20260822_report_sharing` and `20260823_report_dashboards`.

**Frontend.**
- `lib/reports.ts` and `lib/reportDashboards.ts`.
- `components/reports/`: `ReportBuilder`, `ReportView`, `ReportChart`, `ReportResultTable`,
  `ReportRecordsPanel`, `ReportTemplateGallery`, `ReportDashboardWidget` and
  `DashboardWidgetDialog`.
- Routes: `/dashboard/reports` (library, with a Templates tab), `/new`, `/[reportId]`,
  `/[reportId]/edit`, `/forecast`, `/dashboards` and `/dashboards/[dashboardId]`.
- `DashboardWidgetShell`, `sizeClass` and `SIZE_LABELS` are exported from
  `DashboardLayoutEditor` and shared with home, whose behaviour is unchanged. Home's saved
  report widget runs through `POST /reports/run`.
- The palette's "Build report" opens `/dashboard/reports/new`.
- design.md §7.10 gains the report table ruling: every report format is `RecordTable`, a
  matrix cell is a button that drills, and the Total row opens every record.

**Verification.**
- Backend: `test_report_engine.py` (new, 32 cases, including 6 dashboard cases); the whole
  suite passes 1351 of 1351. The 4 rate-limit tests were rerun with Redis.
- compileall; `verify_migrations` at head `20260823_report_dashboards`; `verify_openapi`
  (372 paths); `generate-contracts.sh --check`; `check-design.sh` (21 rules); lint; `tsc`;
  `npm run build`.
- A read-only PostgreSQL smoke run on the dev database (as an admin, rolled back): every
  template, all five date granularities, a matrix on owner × stage with sum and average,
  and CSV. Each drill-down total matched its group's count. The SQLite tests cannot reach
  the PostgreSQL date SQL, and this run did.
- e2e at `--workers=1 --timeout=90000`: `command-palette-actions` and
  `dashboard-edit-mode-revamp` pass 21 of 21. `reports-revamp` passes 6 of 6 after two test
  fixes, neither in product code: the dashboard mock's glob also matched the page URL, and
  the builder's post-save navigation needed time for the report route's first dev compile.
- Bugs this pass found and fixed: SQLite quarter buckets used true division; a two-level
  report with no rows indexed a missing label level; a test helper named `run` shadowed
  `TestCase.run`; lint's `module` variable name and two unescaped apostrophes.
- Rendered guards, each alone on a fresh dev server. `design-rules.spec.ts` audited 109
  routes with none unreachable, and its one finding was real: the builder shows the shared
  `SavedViewConditionEditor` open, which exposed Title Case "Add AND Condition" (§3.5). The
  primitive now says "Add AND condition" / "Add OR condition", and `view-manager-revamp.spec.ts`
  follows (8 of 8). Rerun: `design-rules.spec.ts` passes, 109 routes. `scroll-containers.spec.ts`
  passes every report route; its one finding is `/client/support NAV-FAILED`, a navigation
  failure on the out-of-scope support portal page, not a height cap (see the NAV-FAILED memory).

**Deferred** (see `11-reports.md` §5): Phase 4 (related-record fields,
period comparison); an owner or team picker and custom dates as dashboard filters;
dashboard templates.

## Owner fixes: automation that works, settings without a second rail (2026-10-01)

Requested directly by the owner, outside the wave order: *automation should work seamlessly
for rules people create and ones they reuse, simple to create and use*, and *remove the
settings page's inner sidebar; a settings page's top bar has a back arrow to the settings
hub*. The owner then ruled that **automation stays inside Settings**: first class in how it
works, not a new sidebar module. There is no module seed, no permission migration and no
route move.

**What was broken** (found by reading the engine against the emitters):

1. **Conditions read only what the emitting route happened to send.** `lead.created` carries
   no `first_name`, so *First Name contains X* never matched and *is empty* always did.
   `{{payload.first_name}}` rendered blank in the convert-lead default.
2. **20 triggers the builder offered were never emitted** (4A's inventory, 08a §2), so rules
   on them never ran. 14 now fire, and the other 6 are hidden (Deferred row replaced).
3. ***Changed to* / *changed from* never matched on lead updates.** `lead.updated` sent
   `changed_fields` (the submitted keys), not from/to values.
4. **Automation notes never showed on the record.** They were written under the entity type
   (`sales_lead`) where comments are keyed by module (`sales_leads`). Automation tasks carried
   the same wrong `source_module_key`.
5. **Date conditions were always false.** `gt`/`lt` coerced both sides through `float()`.
6. **Pointing a rule at a person meant typing a user ID**, and there was no "record owner".

**Backend:**

- `platform/services/automation_records.py` (new): entity type → module key, model, id
  field, owner, label and record path for leads, contacts, deals, quotes, orders, insertion
  orders, tasks, documents and bookings. `load_record_snapshot` loads the triggering record's
  columns (tenant-scoped, binned records excluded, storage internals hidden) plus
  `owner_user_id`, `record_label` and `record_url`. The engine lays it *under* the payload:
  event-time values still win.
- **Derived triggers** (`AutomationDerivedTrigger` in the registry): a specific trigger read
  off a general event rather than a second event row. `lead.updated` → `lead.status_changed`,
  `lead.assigned`; `lead.created` with an owner → `lead.assigned`; `quote.status_changed` →
  `quote.sent/accepted/rejected/expired`; `order.status_changed` → `order.completed/cancelled`.
  This covers every path that changes a quote status (form and client portal) and sends no
  extra events to Slack or webhook consumers. Runs record the rule's trigger.
- **New emissions:** `opportunity.created` (create route), `order.status_changed` (order
  PATCH), `booking.created` (public booking, no staff actor), `document.uploaded` (once per
  document, since idempotent retries return the same one), `document.shared`, `task.overdue`
  (`scan_overdue_tasks`, on the hourly due-alert schedule, once per due time, 7-day lookback).
  `field_changes` (new helper in `crm_events.py`) now rides `lead.updated`,
  `quote.status_changed` (both emitters) and `order.status_changed`.
- **Still unavailable** (`available=False`): `booking.cancelled`, `booking.rescheduled` (no
  such flow exists) and the four `ticket.*` triggers (support is out of scope). The builder no
  longer offers them, and an enabled rule on one is refused. A saved draft still loads.
- **Engine:** equality is numeric or date-aware, then case-insensitive text; `gt`/`lt` compare
  dates. The `owner` target resolves the record's owner. A notification with no link opens the
  record, and "the record has no owner to notify" is a readable run failure. Notes and tasks
  use the module key. A rule whose trigger module is disabled for the tenant records a
  *skipped* run.
- **Registry:** a `user` field type for targets; *Owner* conditions on leads, deals, quotes
  and orders; calendar and insertion-order condition fields; document fields renamed to real
  columns (`original_filename`, `extension`); *Add note* limited to modules with comments.
  **Stage conditions list the tenant's own pipeline stages** (closes that Deferred row).
- **Templates:** 11 ready-made rules (`AUTOMATION_TEMPLATES`) and `GET
  /admin/automation-rules/templates`. Every template is tested as a valid, enabled rule.
- `RecordComment.id` gained the SQLite variant the other platform tables have (PostgreSQL
  DDL unchanged), so note actions are testable.

**Frontend (Settings → Automation):** a **Templates** tab (gallery by category; *Use
template* opens the builder prefilled and disabled); an empty rule list leads with *Browse
templates*. The rules table reads **When / Then**. The builder header states the rule in one
sentence ("When a sales lead is created, if Status equals New, then create task.").
`AutomationUserSelect` replaces the user-ID box: *Record owner*, *Person who made the change*,
then people. Text fields gain **Insert record field**.

**Settings navigation:** `settings/layout.tsx` is a passthrough, and `SettingsNavRail` is
deleted. `app/dashboard/layout.tsx` draws a back arrow (`settings-back`, "Back to all
settings") before the title on every settings subpage. design.md archetype 4 is rewritten
with the ruling. The rendered guard's `settingsRail` check became `settingsNav`: no rail, a
back arrow on every settings page and none on the hub, and the hub reaches every page.

**Verification:** `test_automation_triggers.py` (new, 20 cases) and the existing automation
and pipeline tests: 60 pass. The whole backend suite passes 1319 of 1319; the 4 rate-limit
tests were rerun with Redis. compileall, `verify_openapi` (366 paths), `verify_migrations`
at head, `generate-contracts.sh --check`, `check-design.sh` (21 rules), lint and `tsc` pass.

e2e, with a scoped baseline. With these changes stashed, the same server failed 8 tests at the
30s budget (automation-builder ×5, module-builder ×3), all timeouts. The e2e container is
capped at 1 CPU on a host at load ~4.5. With these changes and `--timeout=90000`, and no spec
edits: automation-builder 9 of 9 (7 existing and 2 new), settings-landing 3 of 3 (1 new),
module-builder 3 of 3. One failure along the way was my own new test using the wrong label.

The rendered guard `design-rules.spec.ts` passed alone on a fresh dev server: 106 routes, none
unreachable, 15.2 minutes. The first attempt was OOM-killed at the 6g cap after 22 minutes. The
second ran clean except the new `settingsNav` hub check, which read the hub before its links
rendered. It now waits for them.

## Wave 4A — webhook event contract, 08 Phase 1 (2026-10-01)

**Inventory first.** There is already an event stream: `crm_events` (`CrmEvent`), written
by `emit_crm_event` and consumed by automations and the Slack/Teams alerts
(`CrmEventDelivery`). Webhooks become a third consumer. There is no new bus, and the
alert delivery table is not reused. The inventory is `08a-webhook-event-contract.md` §2.
It found:

1. **Contact creation emits `lead.created`** (entity `sales_contact`), for the Slack alert.
2. **20 automation triggers are never emitted**, so rules on them never run (Deferred).
3. **Only HTTP routes emit.** Imports, bookings, POS and automation actions write records
   silently (Deferred).
4. **`crm_events.id` is sequential across tenants**, so it cannot be an external ID.
5. Support and contract events exist, but those modules are out of scope.

**Decisions** (08a §3–§6):

- **External names are mapped, not copied.** A catalogue entry names the internal
  `(event_type, entity_type)` pair it reads. Contact creation goes out as `contact.created`
  and `deal.assigned` as `opportunity.assigned`, and no internal event is renamed.
  17 types are exported. Support, contracts and the never-emitted triggers are not.
- **Envelope:** `id`, `type`, `version` (per type, bumped only on removal, rename or
  retype; receivers ignore unknown keys), `occurred_at` (UTC `Z`), `actor` (`user` with ID,
  `client_portal`, or `system`; no staff names), `record` (external type and ID), `data`.
  **No tenant identity**: each subscription is per tenant with its own secret.
- **`id` is a new random `crm_events.public_id`**, stable across replays. Migration
  `20260821_crm_event_public_id` adds the column and a unique index, with no backfill. Older
  events predate every subscription, so they are never built into envelopes.
- **Fields are allowlisted and typed.** Every declared field is present. A value that is
  not its kind is sent as null, and money is sent as a decimal string. `_automation*`,
  `href`, staff display names, the portal's free-text message and `client_account_id`
  never leave. Stage labels go out only as `stage_label`, for display.
- **Each type names its gating module** (Phase 2 refuses it, and the Phase 3 worker skips
  it, when disabled). The builder reads only the event row, never a reference.

Backend: `platform/services/webhook_events.py` (catalogue, `build_webhook_envelope`,
`list_webhook_event_types`), `GET /admin/webhooks/event-types` (`require_admin`, the same
for every tenant), and `public_id` on `CrmEvent` and in the admin event history
(`CrmEventResponse`). Automations, alerts and internal payloads are unchanged. There is no
frontend: 08 §10's settings UI starts with subscriptions.

Verification: `test_webhook_event_contract.py` (new, 24 cases). The catalogue: every source
is a defined event, names and sources are one-to-one, names match their record type, each
type is gated by a seeded module, fields are typed and read no internal or display-only key,
support and contract events stay internal, and the list validates through its response
model. The envelope: the exact documented shape for `lead.created`; no tenant key; only
declared fields leave (injected `_automation`, `href` and token keys do not); the stored
payload is untouched; contact → `contact.created`; `deal.assigned` →
`opportunity.assigned` with a string amount; won and stage_changed share stable stage
identity; a portal response is `client_portal` with the message dropped; a scheduled event
is `system`, with its time normalised to UTC; wrong-kind values become null; naive
timestamps are read as UTC; unmapped and pre-webhook events are not built. The public ID:
a UUID per event, the envelope's `id`, and shown in admin history. The route: a GET behind
`require_admin`.

**Whole-suite pass (covering 3C and 4A together).** `codex-check.sh` passed: compileall,
`verify_migrations` at `20260821_crm_event_public_id`, `verify_openapi` 365 paths, contract
drift, **backend 1299 of 1299** (with Redis up), `check-design.sh`, lint and build. The
**full Playwright suite**, less support and contracts, ran at `--workers=1` in parts on a
fresh dev server each. **326 of 328 passed** on the first pass. The two failures were both
in `command-palette-actions.spec.ts`, which neither wave touched, and both reproduced warm:
1. *Routes administrator actions* needs about 33s against a 30s budget: four round trips
   through the full dashboard.
2. *Hides payment recording* pressed Control+K straight after `reload()`, the hydration race
   the spec already documents.

The fix is in the spec: a 60s budget with its reason, and opening the palette through its
button. The spec file then passed 19 of 19, and the whole suite is green. Two parts first
ran under a 5g frontend cap and were OOM-killed (every test refused a connection). They were
rerun at 6g, part 3 in chunks of about 7 specs and each route-walking guard alone:
115 of 115, `design-rules` and `scroll-containers` pass.

**Next:** the owner reviews and approves `08a-webhook-event-contract.md`. Then 08 Phase 2:
subscriptions (admin CRUD, event-pattern validation against the catalogue, module gating,
destination validation with SSRF rules, signing-secret generation and rotation). Delivery
(Phase 3) stays closed until Phase 2 lands.

## Wave 3C — telephony fallback and manual call logs, 07 Phase 1 (2026-09-30)

**Inventory first.** No telephony code existed: no provider, no call model, no secrets.
Calls touched the product in two places:

1. The record header (`CommunicationActions`, Lead, Contact, Account): a raw `tel:${phone}` link.
2. The Timeline composer's Call mode (Lead, Contact, Deal, Quote): `POST …/follow-up` with
   `channel: call` wrote a `RecordFollowUp` **before** navigating to `tel:`. So every attempt
   was logged as a call made, with no outcome, direction or duration. On a deal and a quote it
   dialled the primary or quote contact without asking, and filed the row on the deal or quote
   only. The feed said "Call follow-up logged".

**Decisions.**

- **One provider-neutral table, `call_logs`, in a new `telephony` area.** 07 §8 wants one
  CallLog with provider identity "where applicable". `capture` says how a row came to exist:
  `manual` is the only value. A provider phase adds its own value and the provider columns
  beside it, and never rewrites a manual row. There is no `TelephonyProvider` protocol yet,
  because an interface with no implementation would be speculation (Phase 2 adds it with the
  first adapter).
- **Record-scoped permissions, like the follow-ups it replaces.** Logging needs the record
  module's three layers plus `edit`, checked in the service because the module is a path
  parameter. The Activity adapter inherits the record's `view`. 07 §11's separate
  call-initiation, call-history and recording permissions arrive with Phase 2, when there is
  provider configuration to separate them from.
- **Who was on the line is explicit, never inferred.** A contact's call is with that contact.
  A lead's call names no one. A deal's call may name a participant (legacy primary or active
  participant, active, same tenant, viewable). A quote's call may name the quote's contact.
  The named contact is `contact_id`, and the adapter shows the call on that contact's
  Timeline too: design.md §4.7's "filed against every record whose address it uses", the
  same rule as the deal's Email.
- **The phone number is the record's, copied server-side.** The request has no
  `phone_number` and no provider field (`extra="forbid"`). It is stored as held, not
  normalized, because nothing dials or matches on it in this phase (Phase 4's caller
  matching will need normalization).
- **Old Call follow-ups stay follow-ups (07 §15).** No migration touches them, and the feed
  still renders them as "Call follow-up logged". `FollowUpActionRequest` still accepts
  `channel: call`, as a bounded compatibility layer. No UI writes it any more. Removal
  criteria are in the Deferred table.

Backend:

- `telephony/models.py` `CallLog`: tenant, actor, `source_module_key`/`source_entity_id`,
  `contact_id` (FK, SET NULL), `capture`, `direction` (outbound/inbound), `outcome` (HubSpot's
  defaults: connected, left_voicemail, left_message, no_answer, busy, wrong_number),
  `phone_number`, `occurred_at`, `duration_seconds` (≥ 0), `note`, `follow_up_task_id` (soft
  ref). Check constraints on the enums and duration. Indexes: `(tenant, source module, source
  id, occurred_at, id)` and `(tenant, contact_id, occurred_at, id)`, one per adapter lookup.
  Migration `20260820_call_logs` only adds the table.
- `services/call_logs.log_record_call`: refuses before anything is written. Unsupported module
  → 404. No module/department/`edit` → 403. Another tenant's, binned or missing record → 404.
  A call more than 5 minutes in the future → 422. A contact the record cannot name → 422, one
  message per record kind. It then writes the call. It stamps `last_contacted_*` on
  lead/contact/deal **only forward** (a backdated log never rewinds a later stamp). It creates
  the optional reminder through `followups.create_record_follow_up_task` (task department +
  role checks, linked to the record; a lead also gets `next_follow_up_at`, like its follow-up
  log). It audits `call.logged` on the record. All of this is one commit.
- `POST /telephony/records/{module_key}/{entity_id}/calls` → 201 `CallLogResponse`.
- `record_activity`: a `call` adapter for leads, contacts, deals and quotes, which are the
  records with a Call mode (`available_types` offers "call" nowhere else). The title is
  "Outbound call" / "Inbound call", `status` is the reported outcome, and `meta` carries
  `capture`, outcome, duration, number, the named contact (not on the contact's own
  Timeline), and `logged_on_*` when the call reached a contact from a deal or quote.

Frontend:

- `lib/calls.ts`: outcomes and labels, `formatCallDuration`, `telHref` (keeps `+`, digits,
  `*`, `#`), `callLogEndpoint`. The header's Call now uses `telHref`, so `+44 (20) 7946-0003`
  dials as `tel:+442079460003`.
- The composer's Call mode is `CallMode`, configured by a new `call` prop (`followUp` keeps
  Email and WhatsApp). It shows direction (segmented), outcome (required), when (optional, blank
  = now, future refused inline), duration in whole minutes (0–1440, validated inline), note
  (2000, matching the server), and the reminder. Dialling is a separate `Call <number>` link:
  submitting never navigates. On a deal it asks "Who was on the call", listing participants
  plus "Someone not listed"; one participant is preselected, and several must be chosen
  before logging. A quote preselects its contact when the viewer can see Contacts. Refusals
  show the server's reason and keep what was typed; success clears the form and refreshes the
  record's feed and the named contact's.
- `RecordTimeline`: a `Calls` filter, a `Phone` icon, and an entry with Outcome / With / Number
  / Duration, the note, the reminder line, "Logged on a deal." where relevant, and "Logged by
  hand. Lynk did not place or track this call."
- design.md §4.7 gains the rule: a logged call says what the operator reported.

Verification: `test_call_logs.py` (new, 26 cases). Recorded fields and trimmed number;
stamp and audit; a backdated call does not rewind the stamp; future refused, and skew
tolerated; contact, lead, deal (primary, participant, none; not-on-deal, binned, other
tenant, missing all refused with one message) and quote rules; unsupported modules; other
tenant's, binned and missing records; view-only and module-unavailable refused; reminder
linked and committed with the call; no task access writes nothing. The request rejects bad
outcome/direction/duration, a provider and a phone number. The route is a 201 POST. Activity:
the entry's fields; a deal call is on the deal and on the named participant's Timeline, not
on the primary's; tenants never cross; cursor paging; `call` offered only on the four
modules; old Call follow-ups stay `follow_up`. Backend suite 1275: 1271 pass, and the 4
failures are the known Redis-less rate-limit tests, which pass with Redis up (61 of 61 in
those modules). compileall clean; `verify_migrations` passes at head `20260820_call_logs`;
`verify_openapi` 364 paths. Frontend lint and build clean; `check-design.sh` 21 of 21;
`generate-contracts.sh --check` up to date. `call-logs.spec.ts` (new): 7 of 7. It covers:
the header dials the normalized number; Log call stays disabled until there is an outcome;
the posted body; the page never navigates; the form clears; a refusal keeps the text and
names its reason; future time and fractional duration are caught with nothing sent; several
participants must be chosen, and the pick is posted with its dial link; "Someone not listed"
posts null; one participant is preselected; the feed entry reads as a report and the Calls
filter shows. Neighbours that render the changed components: `whatsapp-external-mode`,
all four contextual-email specs, `opportunity-participants` and `quotes-revamp` pass (30 of
31 with `contacts-revamp`, whose one failure is the inherited edit-form Email, line 165, in
the Deferred table). `leads-revamp` passes 16 of 16, including the journey baseline.
Screenshots of the deal's Call mode at 1440 and 390, in both themes (backgrounds logged
`rgb(11, 13, 16)` / `rgb(247, 248, 250)`), and of the lead Timeline at both widths, showed
no horizontal page overflow.

**Next:** README Wave 3 item 17 (3D, Meta or telephony provider) opens only on an explicit
provider request that names the provider and the routing/consent/retention decisions. Without
one, the next wave is 4A: `08-webhooks-events.md`, starting with the safe event inventory.
Check the Deferred table first.

## Wave 3B — WhatsApp external mode, 06 Phase 1 (2026-09-30)

**Inventory first.** Three paths already opened WhatsApp, all external click-to-chat:

1. The record header (`CommunicationActions`, Lead and Account): `wa.me/<digits>`, not logged.
2. The Timeline composer's WhatsApp follow-up (Lead, Deal, Quote): `POST …/follow-up` with
   `channel: whatsapp` writes a `RecordFollowUp`, then opened `wa.me/<digits>` *after* the await.
3. The contact's tracked mode: `POST /whatsapp/contacts/{id}/click` renders a template, normalizes
   the number with the contact's or the company's country, builds a `web.whatsapp.com/send` URL,
   writes a `WhatsAppInteraction`, stamps `whatsapp_last_contacted_at`, audits `whatsapp_click`,
   and can create a reminder. The Activity adapter already titled these "WhatsApp message
   prepared" with `status: external_link`.

**Decision (06 §8, option 1):** `whatsapp_interactions` stays the record of external mode and
only that mode. Meta messages (Phase 3) get their own tables; no row is rewritten. No migration:
`sent_at` keeps its name and is documented as "when the chat was prepared".

Backend:

- **Mode contract.** `whatsapp_services`: delivery modes `external_link` / `meta_cloud_api`,
  default choices add `ask_each_time`. `resolve_whatsapp_capabilities(policy, meta_configured)`
  returns `default_mode`, `effective_mode` and per mode `enabled` / `available` /
  `unavailable_reason` / `sends_from_crm` / `tracks_delivery` / `receives_inbound`. Rules: the
  default if usable; `ask_each_time` only with two usable modes; else the one usable mode; else
  null. It never picks a mode the policy did not enable, and a connected provider does not
  become the default by itself. `get_tenant_whatsapp_policy` is the single read point for a
  stored policy; none exists yet (Phase 5 adds the screen and storage), so every tenant is
  external-only, external by default. `is_meta_cloud_api_configured` is always false (Phase 2).
- `GET /whatsapp/capabilities`: `require_user` only. It is workspace policy and names no record;
  each WhatsApp action keeps its own record's gates.
- **Click flow tightened.** Needs `edit` on contacts (was `view`, for a write), like the contact's
  follow-up log and like the UI already gated it. The reminder now goes through the follow-up
  helper, `followups.create_record_follow_up_task` (renamed from private, takes an optional
  `title`): department and role checks on tasks (it skipped department, and mapped a missing
  module to 500), **linked to the contact** so it shows on the contact's Tasks (it was not),
  audited like every follow-up task, and committed **in one transaction** with the interaction and
  the audit entry (it committed on its own before). The response and the audit `after_state`
  carry `mode: external_link`, `status: prepared`. A policy without external mode refuses with 403
  before anything is written.
- `WhatsAppInteraction.id` gains the SQLite variant other models use (no Postgres change).

Frontend:

- `lib/whatsapp.ts`: one number rule (`whatsAppChatTarget`: `00` prefix dropped; a number starting
  with 0 without `+`/`00` is national, and no country code starts with 0, so it is refused with
  "Add the country code…"; the 7-digit floor matches the server) and one popup-safe window
  (`openPendingWhatsAppWindow`, opened before the first await, `go(url)` or `cancel()`).
- The header uses it: a national number now gets a toast instead of a chat opened onto WhatsApp's
  "invalid number" screen.
- The follow-up mode opens its window before logging (it opened after the await, a popup the
  browser may block), closes it if the log fails, and never closes a chat that already opened
  because a refresh failed afterwards. A national number is still logged, with a line under the
  button saying WhatsApp will not open.
- The tracked mode uses the same window helper, shows the server's reason on a refusal
  ("…needs a country code for WhatsApp", no template, no task access) instead of a generic line,
  and its footnote now reads "You send the message in WhatsApp. Lynk records that the chat was
  opened, not whether it was sent, delivered or read."
- `useWhatsAppCapabilities` feeds `CommunicationActions` and the composer: WhatsApp is offered
  only while external mode is available. Its placeholder, and its fallback on error, is
  external-only, so the button never flickers in and a failed request never removes it.
- design.md §4.7 gains the rule: external WhatsApp says what Lynk knows, that a chat was opened.

Verification: `test_whatsapp_external_mode.py` (new, 23 cases): the click end to end (prepared,
normalized with company country and contact country, rendered template, interaction, stamp, audit
with mode/status, no provider claims), reminder linked and in the same transaction, custom title,
no task access / no phone / national number with no country / other tenant's contact / binned
contact / other tenant's template / wrong channel / no active template / external disabled by
policy all refuse **before anything is written**; the resolver's six rules; the click needs
`edit` and the capabilities route is sign-in only. Backend suite 1249 of 1249 with Redis up;
compileall clean; `verify_openapi` 363 paths. Frontend lint and build clean; `check-design.sh`
21 of 21. `whatsapp-external-mode.spec.ts` (new, 8): header opens `wa.me/<digits>`; national
number explained, not opened; follow-up window opened before the log and pointed at the chat;
failed log closes it; national number logged, not opened; tracked chat opens the server's URL;
refused tracked chat names the reason and closes its window; external disabled → no header
button and no composer mode. 8 of 8 (needed `test.slow()`, like the other record-page specs).
Neighbours that render the two changed components: the lead, contact, account and deal email
specs pass 13 of 13, and `contacts-revamp` 2 of 3. Its failure is the inherited one in the Deferred
table (the edit form's Email, line 165); its WhatsApp assertions (160–161) pass just before it. A
first run lost three contact tests to cold compiles of the contact routes (30 s budget, no assertion
reached); they pass on warm routes. `generate-contracts.sh --check` is up to date.

**Next:** Wave 3C, README Wave 3 item 16: `07-telephony.md` Phase 1 (`tel:` fallback and manual
call logs). Check the Deferred table first.

## Wave 3A — closed (2026-09-29)

The rendered guards pass: `design-rules.spec.ts` audited 106 routes with none unreachable (8.0
minutes, run on a freshly restarted dev server), and `scroll-containers.spec.ts` passed earlier in the
wave. Getting there took four more audit runs, and each result was a real finding:

1. **Settings rail (A8) and six list routes unreachable.** The host was thrashing (load 11.4,
   `kswapd0` at 96%). A re-run on a quiet host did not repeat it. Environmental.
2. **R4, a real bug from this wave.** The deal header's Email was `size="sm"` (32px) beside the
   38px Edit. `RecordEmailAction` and `CommunicationActions` no longer hard-code a size, so every
   record header's Email, WhatsApp and Call are `default`, like the buttons beside them. The Lead,
   Contact and Account headers had the same mismatch, hidden from the guard because
   `CommunicationActions` wraps its buttons in its own row.
3. **A different set of lists "unreachable" every run.** A harness bug: `discoverRecord` waited for
   any `tbody tr` and resolved on `ModuleTableLoading`'s eight skeleton rows, so lists whose data
   came slowest were dropped. It now waits for a row with no `[data-slot="skeleton"]`.
4. **Deals unreachable on a cold server.** Deal rows have no link, so the audit opens one by click or
   Enter, then waited a fixed 1.8 s. The deal record route compiles on first visit and took longer.
   `waitForRecordUrl` now waits (up to 20 s) for the URL to become a record.

After the size fix the four record-email specs pass 13 of 13; lint is clean.

## Wave 3A — Opportunity run (2026-09-29)

Built to the owner's decision recorded under the Organization run below (Salesforce, Dynamics,
HubSpot: a deal's email is addressed to its participants and filed against the deal and each
of them). This also completes 05 frontend Phase 3 (contextual recipient selection).

**Verified first:** `record_activity._fetch_emails` does not filter on `association_type`, so a
`related` link already reaches the contact's Timeline. No adapter change.

Backend (`mail_services`, no schema or migration change):

- `MailRecordSendRequest.related_contact_ids` (optional, max 50). `_resolve_participant_recipients`
  checks each id before anything is claimed or sent: the source is a deal; the contact is on it
  (the legacy primary or an active participant, through the new shared
  `opportunity_contacts_services.is_contact_on_opportunity`, which `ensure_contact_on_opportunity`
  now uses as well); the contact is active, in this tenant and viewable by the sender
  (`resolve_link_target`); it has not opted out; and its address is actually among To/Cc/Bcc. Every
  "not on this deal" reason returns the same message.
- `_claim_outbound_message` writes each as a `related` association in the same transaction as
  the deal's `primary`, through the existing `upsert_association`. A typed address that
  belongs to no chosen participant files against the deal only. Nothing is linked because an
  address happened to match (the `mail_associations` invariant stands).
- `{{contact.*}}` from a deal resolves to the person the email is to: one chosen participant is
  that participant; several give the primary only if the primary is among them, otherwise nobody;
  with nobody chosen it falls back to the deal's primary, as before.
- `ContactCompactSummary.email_opt_out` (additive) so the deal summary's participants carry it.

Frontend:

- The deal header has **Email** again (`RecordEmailAction` with `recipientCandidates` from
  `participant_contacts`), shown only when the reader can view Contacts and at least one participant
  has an address and has not opted out. One such participant is prefilled. With several, To
  starts empty. The mailto fallback (no connected mailbox) follows the same rule.
- `RecordEmailComposer` lists the candidates under To as a **Participants** checklist, with role,
  "Primary contact" and the address. Ticking one writes its address into To and unticking removes
  it; To stays editable. Opted-out participants are listed, disabled, with "Opted out of email".
  An opted-out participant's address typed by hand is refused before the send. On send, the
  participants whose addresses are in the message go in `related_contact_ids`.
- design.md §4.7 is rewritten: the rule is now **"the message is filed against every CRM record
  whose address it uses"**, replacing "does this record own the address". The deal's rules and the
  CRMs behind them are written there. The `CommunicationActions` doc comment follows it. Account and
  Quote are unchanged: an account still emails its own address only, and a quote offers no channel.

Verification: `test_mail_contextual_send.py` 92 of 92. `OpportunityContextualSendTests` re-runs the
Lead contract from a deal and adds 17 cases: participants filed beside the deal and on each
contact's activity only when chosen; legacy primary without a row; typed non-participant → deal
only; a participant's address alone links nothing; not on the deal, removed participant,
recycle-binned contact, other tenant (same message), opted out, not a recipient, no Contacts view,
non-deal source are all refused before anything is sent; a repeated id is filed once; the three
`{{contact.*}}` cases. The backend suite passes 1226 of 1226 with Redis up. `verify_openapi` passes (362 paths),
compileall is clean, and `generate-contracts.sh --check` is up to date. Frontend lint and build are
clean; `check-design.sh` passes 21 of 21. `opportunity-contextual-email.spec.ts` (new, 5: several
participants → To empty, pick, payload names the pick, lands on the Timeline; untick removes the
address; one usable participant prefilled; a typed opted-out address refused; no usable participant
means no Email) passes 5 of 5. The lead, contact and account email specs, `opportunity-participants` and
`opportunities-revamp` pass 16 of 16. Browser pass: the composer screenshotted in both themes
(background `rgb(11, 13, 16)` → `rgb(247, 248, 250)`), and a real deal checked against the live API:
its participant carries `email_opt_out: false`, and with no connected mailbox the header shows the
mailto fallback with the single participant prefilled. No real email was sent.

The wave close is recorded in the section above.

Left open (added to Deferred): offering an account's contacts as recipients from the Account page
(owner: a separate follow-up); a manually typed address of an opted-out *non-participant*
contact is not checked (only candidates are known to the composer, and the server links by id
only).

**Next:** Wave 3B, README Wave 3 item 15: `06-whatsapp-business.md` Phase 1, which formalizes and
regression-tests the existing external `wa.me` mode. Check the Deferred table first.

## Wave 3A prerequisite — 05 frontend Phase 4: relationship rail on Contact and Account (2026-09-29)

The Contact and Account pages already had a spine **Connected** block and a **Related records**
tab. This phase finishes them against the filtered summaries from backend Phase 4.

- **A contact's deals carry its role.** Each row reads `Decision maker · Primary contact ·
  Proposal · closes Oct 1, 2026`: the role first, because it is what this page adds over the
  deal list, in the same words as the deal's own participant list.
- **A contact has Orders and Insertion orders** in the spine and the tab (the summary already
  carried both). The Contact page's hand-built cards were replaced by the shared
  `RecordRelatedList` the Account and Deal pages use.
- **Hidden vs none.** A section the reader may not view is **left out everywhere**: no card, no
  spine row, not even a zero. The page cannot tell "your role can't view quotes" from "quotes
  aren't enabled here" (`/users/me/modules` lists only role-visible modules), and Salesforce,
  HubSpot and Dynamics all omit inaccessible related lists silently, so a "hidden" notice was not
  added. "None" is a real empty state in the module's own words, and it offers the create
  action where one is allowed. Every section now follows `related_access`, including Deals and
  (on an account) Contacts, which used the module list only. The module list is still checked
  too, so a stale summary can't show a section after the role is revoked.
- **True totals.** `RecordRelatedCard` takes `total`. When the summary's count is higher than the
  rows it sends, the card says "Showing the 8 most recent of 12."
- **Contextual create:** Deal from a Contact; Contact and Deal from an Account (existing Quick
  Creates, now offered in the empty states as well). **Quote and Order creation stays on the Deal
  and the Quote**, following the major CRMs (Salesforce and HubSpot create quotes only from the
  opportunity; Lynk orders come from converting a quote). Tasks and Files keep the create
  actions their own tabs already had.
- Close dates are rendered through `formatDateOnly` (they were raw ISO).

Verification: lint and build are clean; `check-design.sh` passes 21 of 21.
`relationship-rail.spec.ts` (new, 4: role and primary on a contact's deals, true total on
orders, hidden sections absent from spine and tab, empty state with and without the create
right, account following `related_access`) passes 4 of 4. Browser pass: both pages screenshotted
in both themes (the body background changed from `rgb(11, 13, 16)` to `rgb(247, 248, 250)`, so both
themes were actually shown), plus one live contact against the real API (`Other · Primary contact · Lead
· closes Sep 14, 2026`; spine `Deals 1 ; Quotes 0 ; Orders 0 ; Insertion orders 1`). The page specs
`contact-contextual-email`, `organization-contextual-email`, `contact-organization-rollout`,
`accounts-revamp` and `contacts-revamp` pass 16 of 18 first time. `accounts-revamp` "shared
workflow" timed out once on the cold compile and passes 2 of 2 re-run. `contacts-revamp` "shared
workflow" fails on the **edit** form's Email field being empty, and fails the same way with this
change stashed (added to Deferred). Rendered design guards: run at the Wave 3A close.

## Wave 3A prerequisite — 05 backend Phase 4: relationship summaries (2026-09-29)

No new endpoint (01 §7: prefer the existing summaries). The Contact, Account and Deal
summaries (`summary_services.build_*_summary`) already carried related records, with four gaps:

1. **Leak.** They returned related deals, quotes, orders, invoices, insertion orders and (on an
   account) contacts whatever the reader's permissions. The pages hid some, but the API response
   carried everything. Now each section is checked with `related_access` (module availability
   plus the role `view` action, the `require_linked_record_access` bar) and a hidden section is
   **not queried**: empty list, zero count, `related_access.<section> = false`. No reader means
   nothing related. `_can_view_contacts` on the deal summary now goes through the same helper,
   and the deal's quotes and insertion orders are gated too.
2. **Counts were list lengths** (capped at 8–12). They are now true totals (`count()` on the same
   query); the lists stay the most recent few. The deal summary gains `quote_count`.
3. **A contact's deals** were only those with it as legacy primary. They now include deals it is an
   active participant on (removed links, deleted deals and other tenants' deals excluded, a
   corrupt cross-tenant link row matches nothing), each with `contact_role_key`,
   `contact_role_label` and `is_primary_contact`.
4. **A contact had no orders.** `related_orders` / `order_count` added, matched by the same rule
   as its quotes (its account or itself), so a quote and its converted order appear together.

All response changes are additive (`related_access`, the role fields, `related_orders`,
`order_count`, `quote_count` have defaults). The pages read `related_access` through
`lib/related-access.ts` (`canViewRelated`) so a hidden Quotes/Orders/Invoices/Insertion orders
section is left out of the spine and the Related tab instead of showing "0". The deal spine's
Quotes count uses `quote_count`. That is the whole frontend change. Roles on a contact's deals,
a contact's orders and contextual create are for frontend Phase 4.

Verification: new `test_relationship_summaries.py` (14, including route tests that the API
response itself is filtered), and `test_summary_services.py` updated to pass a reader. 25 of 25.
`verify_openapi` passes (362 paths). Backend suite 1187 tests: only the four known Redis
rate-limit tests fail, and none of their modules was touched. Frontend lint and build are clean;
`check-design.sh` passes 21 of 21. No browser run in this slice; the frontend Phase 4 run owns
the rendered pass.

Not done (for frontend Phase 4, or noted): task and document **counts** in the summaries. The
Tasks and Files tabs already load through their own permission-gated endpoints, so they are
not duplicated here. The contact/deal's own `organization` / `contact` compact fields are the
record's own link and are not gated, as before.

**Next:** 05 frontend Phase 4 (done, above), then the Opportunity run.

## Wave 3A prerequisite — 05 backend Phase 3: relationship context downstream (2026-09-29)

The Deferred row "participants propagated through Lead conversion and Quote/Order creation",
due before the Opportunity run.

Inventory. **Lead conversion** already did the right thing: it links only the contact it
converts, as the primary participant (`sync_primary_contact_association`), and copies none of
the account's other contacts. That was covered by a test already, and one more now pins the
"not every contact" half. **Quotes and orders** were the gap. A quote or order linked to a deal
had to name the deal's *primary* contact or be refused ("must match the linked opportunity"),
so a proposal to the deal's finance participant could not be recorded against the deal.

Change. `opportunity_contacts_services.ensure_contact_on_opportunity`, used by both
`quotes_services._ensure_linked_records` and `orders_services._ensure_linked_records`:

- no contact given: the primary is used, as before;
- any **active** participant may be chosen (link not removed, contact not in the recycle bin);
- anyone else is refused with "Quote/Order contact must be a participant on the linked
  opportunity", never silently swapped for the primary;
- the legacy primary (`contact_id`) is accepted even without an association row, so older
  data behaves as before;
- the account rule is unchanged (must match the deal); a quote→order conversion carries the
  quote's contact, which can now be a non-primary participant (before, that failed).

Each downstream record still carries exactly one contact; nothing copies the participant list.
No schema, no migration, no response-shape change; only the refusal message changed. The quote
form's hint under Deal now says the contact must be one of the deal's participants.

Verification: new `test_participant_propagation.py` (14: primary default, participant accepted,
non-participant / removed / recycle-binned / other-tenant refused, update uses the same rule,
legacy primary without a row, quote→order with a participant, manual orders, account rule,
conversion links one contact only). Backend suite 1173 tests, only the four known Redis
rate-limit tests fail without Redis, and those three modules pass 61 of 61 with Redis up.
Frontend lint and build are clean; `check-design.sh` passes 21 of 21. No browser run (a
one-line copy change).

Left open (added to Deferred): a **partial** quote/order update that sends only `contact_id`
is not checked against the deal already stored on the record (it predates this change; only
the submitted fields are validated). And the quote form's Deal picker filters by the *primary*
contact (`contact_id is`), so picking a non-primary participant first hides that deal; picking
the deal first and then the contact works.

**Next:** the remaining Deferred row before the Opportunity run, the relationship summaries
(05 backend Phase 4, then the frontend relationship rail), then the Opportunity run.

## Wave 3A — Organization run (2026-09-29)

Same gap as the Contact run: the Account header's Email was a bare `mailto:`. It now passes
`emailContext` (`sales_organizations`), so it opens `RecordEmailComposer`, the send is filed
against the account, and it lands on the account's Timeline. No backend or persistence change.

**Recipient decision.** 03 §10 asks for "known recipients, deliberate selection when
ambiguous". design.md §4.7 is narrower: a record offers a channel only for an address it owns.
Following §4.7, the composer is prefilled with the account's own `primary_email` (a
system-locked field) and never with one of its contacts' addresses. A contact is emailed from
the contact's record, so the conversation lands on that person's Timeline instead of being split
across two records. An account with no address of its own shows no Email action, however many
contacts it has. `To` stays editable, as it is on every record. The account has no opt-out
column, so there is no opt-out gate; `secondary_email` is not offered.

Verification: `test_mail_contextual_send.py` 75 of 75. `OrganizationContextualSendTests`
re-runs the Lead contract with an account fixture and adds five cases: filed against the
account, on the account's activity only, another tenant's account refused, a soft-deleted
account refused, `{{organization.*}}` rendered. Lint and build are clean; `check-design.sh`
passes 21 of 21. `organization-contextual-email.spec.ts` (new, 2: To holds only the account's
address although it has two contacts; no address means no Email action),
`contact-contextual-email.spec.ts`, `lead-contextual-email.spec.ts` and
`contact-organization-rollout.spec.ts` pass 14 of 14. The first run failed two Contact tests on
the 30s timeout while the dev server was still compiling (the send had succeeded); both pass
re-run warm.

**Next:** the two Deferred rows due before the Opportunity run, then the Opportunity run.

**Decided (owner, 2026-09-29): the Opportunity run follows the major CRMs, not §4.7's ban.**
Salesforce (email activity with Who = contact and What = opportunity), Dynamics (email
*Regarding* the opportunity, recipients as activity parties) and HubSpot (email associated
with the deal, contact and company) all send from the deal. So:

- The deal offers Email when at least one participant has a usable address (not opted out).
- One such participant is prefilled. Several: To starts empty and the user picks from the
  participants, with role labels. The primary contact is not silently prefilled.
- Opted-out participants are listed but cannot be picked, and the reason is shown.
- The send files the deal as `primary` and each chosen participant contact as `related`,
  through the existing `upsert_association`, with no new storage. The server checks each chosen
  contact is a participant in the tenant. A typed address that matches no participant files
  against the deal only.
- **Verify first:** that `_fetch_emails` in `record_activity.py` reads `related` associations,
  not only the primary. If it doesn't, extend the adapter so the email reaches the contact's
  Timeline.
- design.md §4.7 is rewritten in that run: the test becomes "the message is filed against every
  CRM record whose address it uses", replacing "does this record own the address". Quotes are
  unchanged. Offering an account's contacts as recipients from the Account page is a separate
  follow-up.

## Wave 3A — Contact run (2026-09-29)

The Activity projection (`record_activity.py`) and the record-send path
(`POST /mail/records/{module_key}/{entity_id}/send`, `mail_associations.py`) were already
module-generic. The gap was the page: the Contact header's Email was a bare `mailto:`. It now
passes `emailContext` (`sales_contacts`), so it opens the same `RecordEmailComposer`, the send
is filed against the contact by URL, and it lands on the contact's Timeline. An opted-out
contact still gets no email action. No backend or persistence change, and nothing
contact-specific in the mail domain.

Verification: `test_mail_contextual_send.py` 48 of 48. `ContactContextualSendTests` re-runs the
Lead contract with a contact fixture and adds four cases: filed against the contact, on the
contact's activity only, another tenant's contact refused, `{{contact.*}}` rendered. Lint and
build are clean. `contact-contextual-email.spec.ts` (new, 2), `lead-contextual-email.spec.ts`
and `contact-organization-rollout.spec.ts` pass 12 of 12.

## Wave 2E — closed (2026-09-29)

The rendered design guards (`design-rules.spec.ts` + `scroll-containers.spec.ts`,
`--workers=1`, frontend recreated first) pass 2 of 2 in 13.5 minutes, including the new
`/dashboard/settings/pipeline`. Wave 2E is done; its phase notes follow, newest first.

## Wave 2E — frontend Phase 4: a saved view remembers Table or Pipeline (2026-09-29)

- `SavedViewConfig.display` is optional (backend schema and `_normalize_saved_view_config`).
  It is an identifier (`[a-z][a-z_]{0,19}`) or nothing; anything else is dropped, never stored.
  The filters, columns and sort stay one definition shared by both displays.
- `ModuleViewDefinition.displayModes` declares a module's displays. Only Deals has them for
  now (`table`, `pipeline`, the `?display=` words). The first is the default and is stored as
  `null`.
- View manager (`/dashboard/views/[moduleKey]`): a **Display** tab ("Opens as") for modules
  with display modes. The draft carries `display` through edit, duplicate and discard, and it
  counts toward unsaved changes. `useSavedViews` seeds and compares `display` with the rest of
  the view.
- Deals list: selecting a view applies its display. A shared link's `?display=` outranks the
  first view it opens on, the same rule the view's filters follow, and never outranks a view
  chosen afterwards. The toggle itself still only changes the address; saving a display is
  done in the view manager, where the view's other settings are.

Verification: backend `test_saved_views.py` 16 of 16, including the new display
normalization; `verify_openapi` passes. Frontend lint and build are clean; `check-design.sh`
passes 21 of 21. `opportunities-board.spec.ts` (4, new: selecting a board view opens the board
and the default view brings the table back), `opportunities-revamp.spec.ts` (3) and
`view-manager-revamp.spec.ts` (8) pass 15 of 15.

## Wave 2E — frontend Phase 3: the Kanban, audited (2026-09-29)

The board predates this wave (rebuild 5.7: `OpportunitiesPipelineBoard` on the shared
`Board`). Checked against 04 §10 Phase 3:

| Requirement | State |
|---|---|
| Same saved-view filters as List | ✔ by construction: one `useOpportunities` query and one filter set; the board is a `?display=` of the same list |
| Columns from active pipeline stages | ✔ since frontend Phase 1. An inactive stage is a column only while occupied, and never a move target |
| Cards show key fields | Partly: name, account/client, owner, close date, value, overdue. Fixed, not configurable. Left as is |
| Drag/drop, optimistic | ✔ `stageMutation.onMutate` moves the card and its `pipeline_stage` |
| Backend validates, rejected move rolls back with a clear message | Rollback ✔. **Fixed:** the toast was generic; it now carries the server's reason ("Deal stage was not changed: Pipeline stage is inactive.") |
| Keyboard alternative | ✔ each card's "Change stage for …" select |
| **Fixed:** the stage was fetched only when the Stage column was visible | In board mode the list query always adds `sales_stage`, otherwise every card fell into Unstaged |

The board shows the loaded page of deals, not every deal ("Showing loaded records x–y of N").
Per-column totals are in the stat row above it. Not changed.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21. New
`opportunities-board.spec.ts` passes 3 of 3 (pipeline columns with an occupied inactive column
and no move into it, `fields` includes `sales_stage`, a keyboard move saves, a refused move
rolls back with its reason). `opportunities-revamp.spec.ts` passes 3 of 3.

## Wave 2E — Phase 4: the legacy constraint goes, tenants can add stages (2026-09-29)

- `20260819_drop_stage_check` drops `ck_sales_opportunities_sales_stage`. A stage is valid
  when the deal's own tenant's pipeline has it (`assign_opportunity_stage`). The downgrade
  refuses while any deal holds a non-legacy key, then restores the check. `sales_stage`
  stays as the mirrored stable key, because filters, search and export read it. The stage
  PATCH schema's fixed-list `pattern` is gone as well; an unknown key is a 400 from the service.
- `POST /sales/opportunities/pipeline/stages` (`configure`, audited): `label`, optional `key`,
  `semantic_type` (default `ongoing`), and optional `probability` (defaults by outcome: 10 / 50 /
  100 / 0). A derived key is slugged from the name and gets `_2`, `_3`… while taken; `unstaged`
  is reserved, and a key must start with a letter. An explicit key must be free and
  well-formed. A non-outcome stage is inserted before the first won/lost stage; an outcome goes
  last. A stage is never deleted, only deactivated.
- Settings page: `AddPipelineStage` has name, outcome and an explicit **Add stage** button. It
  is a create, so it does not autosave (R1). A refusal (duplicate name) shows under the form and
  keeps the typed name.

Verification: `test_pipeline_add_stage.py` 11 of 11. The full backend suite passes 1105 of 1105
with Redis up. `verify_migrations` passes at `20260819_drop_stage_check`, and `verify_openapi`
passes (362 paths). On a throwaway PostgreSQL database: a custom key is accepted at head, a
downgrade with it is refused, and after moving the deal back the downgrade restores the check
(a `CheckViolation` proves it), then re-upgrades. Frontend lint and build are clean;
`check-design.sh` passes 21 of 21; `pipeline-settings.spec.ts` passes 6 of 6.

## Wave 2E — frontend Phase 2: the pipeline settings screen (2026-09-29)

`/dashboard/settings/pipeline` ("Deal pipeline", Customization group; `SETTINGS_ROUTES.pipeline`).
It is archetype 4: one `FormSection` holding a `SortableList` of `PipelineStageRow`s.

- Each row is one stage: name (commits on blur or Enter), outcome (`Open` / `In progress` /
  `Won` / `Lost`), probability %, `Active`/`Inactive` (`SegmentedBoolean`), and move up/down.
  Each change autosaves (R1) through `useAutosave`, and the row's `SaveStateIndicator`
  reports it. A server refusal, such as a duplicate name or the last active open stage, shows
  its own reason under the row and marks the field invalid. The stable key and the live deal
  count are shown under the name.
- Deactivating a stage that holds deals asks first and names the count. The deals stay put.
- Reorder: the move buttons are the contract, and drag is an enhancement (the `SortableList`
  primitive). The order is applied optimistically and rolled back on failure, with its own
  indicator in the section header. The list is **not** disabled while saving: a disabled list
  drops its move buttons, and focus went with them. A move made during a save is ignored.
- A save writes the server's pipeline into the `sales-opportunity-pipeline` cache and
  invalidates usage, deal lists, totals and the deal summary, so labels change everywhere.
- The route was added to the design-rules and scroll-containers route lists and to the census.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21.
`pipeline-settings.spec.ts` passes 5 of 5: rename and Saved, a refused name in place, reorder
with focus kept, deactivate with the count and a working Cancel, and the permission wall. A
theme probe gave dark body `rgb(11, 13, 16)` and light `rgb(247, 248, 250)`; at 390px there is
no horizontal overflow and the row wraps. **Not run:** the full rendered design-guard walk,
which has no route filter. It is owed once at the end of Wave 2E.

## Wave 2E — pipeline settings API (2026-09-29)

The backend half of 04 frontend Phase 2, on a new `pipelines_routes.py` mounted before the
opportunities router. Every route needs Opportunities `configure` on top of module and
department access, so a salesperson can move deals but not redefine stages.

- `PATCH /sales/opportunities/pipeline/stages/{id}` changes `label`, `semantic_type`,
  `probability` or `is_active`. The stable `key` is not in the contract. Names are unique per
  pipeline, case-insensitively, and at most 80 characters. The pipeline must keep at least one
  active stage that is not won or lost, so a deactivation or reclassification that removes the
  last one is refused. Deactivation keeps its deals where they are and refuses only new
  assignments.
- `PUT /sales/opportunities/pipeline/stage-order` takes the full list of stage ids. An
  incomplete, duplicated or foreign list is a 409 ("reload and try again"), so a stale client
  cannot misplace a stage it never saw.
- `GET /sales/opportunities/pipeline/stage-usage` returns live deals per stage in the caller's
  tenant, for the UI's impact warnings.
- Every change writes one `ActivityLog` row (`entity_type=sales_pipeline`,
  `action=configure`) with the before and after pipeline. A stage from another tenant is a 404.
- Not built: adding a stage (blocked on the legacy check constraint) and deleting one (never,
  by design).

Verification: `test_pipeline_settings.py` 12 of 12. The full backend suite passes 1094 of 1094
with Redis up. `verify_openapi` passes (361 paths). No migration.

## Wave 2E — frontend Phase 1: configurable selectors (2026-09-29)

The client no longer lists stages. Options, order, labels and outcome come from
`GET /sales/opportunities/pipeline` (`hooks/sales/useOpportunityPipeline.ts`, with a 5-minute
stale time), and a deal's own stage from its `pipeline_stage`.

- `opportunityStages.ts` is now helpers only: `stageTone` (won → success, lost → critical,
  everything else neutral, per R5), `resolveStage`, `selectableStages` (active stages, plus
  the current one if it was deactivated), and `defaultStageKey` (the first active stage that
  is not an outcome). `OPPORTUNITY_STAGE_ORDER`/`LABELS`, the `statusStyles.ts` stage map and
  `scripts/check-opportunity-stages.py` are deleted.
- `OpportunityStageSelect` is the one picker. The full form, Quick Create and Lead conversion
  use it; conversion offers only stages past the entry stage and starts at the first `ongoing`
  one. An empty value displays the pipeline default, and `buildOpportunityPayload` submits that
  same default, so what is shown is what is saved. Conversion's dirty-check baseline moved from
  `"qualified"` to `""` with it; missing that made an untouched conversion prompt on Cancel.
- Deal record page: the spine track is the tenant's stages minus `lost` ones, the inline Stage
  options come from the pipeline, and the header status comes from `pipeline_stage`. A stage
  change writes the saved record back, so the label is never stale. An unstaged deal now shows
  "Unstaged" instead of pretending to be at Lead.
- Table status and overdue, the board's columns (inactive columns only while occupied, and they
  accept no cards), the list's loading stat tiles, the Stage saved-view filter options (by
  stable key, inactive stages marked), related-deal labels on Contact/Account, the linked-record
  picker, and the dashboard funnel (which drops `lost` by meaning; the backend dashboard rows now
  carry `semantic_type`).
- `opportunities-revamp.spec.ts` "pipeline totals … retry": the spec was at fault.
  `getByText("Lead")` also matched real deals in the table. It is now scoped to the stat tile.
- `lib/moduleViewConfigs.ts` keeps its static Stage options as the fallback for any caller that
  does not have the pipeline. The list page overrides them.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21. Backend
`test_pipeline_business_logic`, forecasting and API-route tests pass 80 of 80.
`opportunities-revamp.spec.ts` plus `opportunity-participants.spec.ts` pass 8 of 8, including
the retry test. `leads-revamp.spec.ts` plus `contact-organization-rollout.spec.ts` pass 22 of 22 (the first
run failed 1, the dirty-baseline bug above, now fixed). Not checked: the rendered design guards,
and a both-theme pass. No styling changed; only where the labels and options come from.

## Wave 2E — pipeline Phase 3: dependent business logic (2026-09-29)

Every backend `3` row of `04a-stage-inventory.md` is migrated. The file's closing section
records how.

- **Meaning comes from the stage row.** `OpportunityStageFacts` (key, label, semantic type,
  probability, position) per deal, plus null-safe SQL clauses for closed and won. The stale
  deal scan, the stage PATCH's `close` audit action, the forecast (won, lost, open counts,
  weights, bucket labels), the CRM dashboard (won/lost counts, open pipeline value, stage
  buckets) and the owner scorecard's won count all read `semantic_type`/`probability`.
  Seeded values equal the old hardcoded ones, so untouched tenants see the same numbers.
  Visible differences: bucket labels are now sentence case, and the dashboard's no-stage
  bucket is `unstaged` / "Unstaged" instead of `__empty__`.
- **Pipeline summary** (`GET /pipeline-summary`): columns come from the tenant's pipeline in
  position order. An inactive stage appears only while deals sit in it, then Unstaged. Rows
  are keyed by stage row and carry `stage_id`, `semantic_type`, `probability` and `is_active`.
- **Events.** `opportunity.stage_changed` now carries `sales_stage`, `stage_id`,
  `stage_label`, `stage_semantic_type`, their `previous_` pair, and a `field_changes`
  entry. **Bug fixed:** the automation *Stage* condition reads `payload.sales_stage`, which the
  event never carried, so stage conditions could not match. `opportunity.won` /
  `opportunity.lost` were registered triggers that nothing emitted. They now fire on entering
  a won/lost semantic type, and not on moving between two stages of the same outcome. There is
  a new `Stage outcome` automation condition (`stage_semantic_type`). Neither new event is a
  Slack alert.
- **Display.** Global search, the recycle bin and the `{{opportunity.stage}}` mail variable
  show the stage label instead of the raw key.
- Nothing else in `backend/app` compares a legacy key. What remains are stable-key uses the
  spec allows: filters, search document, export, and automation option values.

Verification: `test_pipeline_business_logic.py` 14 of 14. Each test changes a stage's
meaning or label on the row and checks the behaviour follows the meaning. The full backend
suite passes 1082 of 1082 with Redis up. `verify_openapi` passes. No migration and no frontend
change.

## Wave 2E — pipeline Phase 2: Opportunity references (2026-09-29)

- `sales_opportunities.pipeline_id` / `pipeline_stage_id` (`20260818_opp_stage_refs`), with a
  partial index `(tenant_id, pipeline_stage_id) WHERE deleted_at IS NULL` for board columns
  and "stage in use" counts. The backfill resolves by key within the deal's own tenant's
  default pipeline and covers soft-deleted deals. A NULL `sales_stage` stays unstaged, with
  the pipeline still set. The upgrade aborts if any deal is left unresolved.
- Both columns stay **nullable** during compatibility: NULL pipeline = tenant default, NULL
  stage = unstaged. Making `pipeline_id` required belongs with Phase 4.
- `pipelines_services.assign_opportunity_stage` is the only writer of `sales_stage`,
  `pipeline_id` and `pipeline_stage_id`. Create, update (and so CSV import), the stage PATCH
  and Lead conversion all go through it. A caller may send the legacy key, the stage id, or
  both, and both must agree. A stage from another tenant gets the same 400 as a missing one.
  An inactive stage or pipeline cannot be newly assigned, but a deal already in one may stay.
  An unknown key is now a 400 rather than a check-constraint error. Lead conversion resolves
  its stage before writing anything.
- API: `pipeline_stage_id` is accepted on create/update/stage PATCH. Responses add
  `pipeline_id`, `pipeline_stage_id` and `pipeline_stage` (`key`, `label`, `semantic_type`,
  `probability`, `is_active`). List items include them only when the Stage column is visible.
  A tenant that disabled Stage cannot write it through `pipeline_stage_id` either. Every
  existing field keeps its meaning, so current clients are unaffected.
- **The legacy check constraint still limits stage keys to the six seeded ones.** Adding a
  stage (the frontend Phase 2 settings UI) therefore needs Phase 4's constraint drop, or a
  bounded relaxation of it, first. Renaming, reordering, re-weighting and deactivating
  stages do not.

Verification: `test_opportunity_stage_refs.py` 24 of 24 (backfill for every legacy stage
across two tenants and a soft-deleted deal, idempotency, the unresolved block, key/id
agreement, cross-tenant rejection, inactive handling, clearing, conversion, serialization,
field-config mapping). The two old `update_opportunity_stage` tests moved there onto a real
session. The full backend suite passes 1068 of 1068 with Redis up. `verify_migrations` passes
at `20260818_opp_stage_refs`, and `verify_openapi` passes. On a throwaway PostgreSQL database,
a populated upgrade matched 14 of 14 deals and a real `alembic downgrade` to
`20260816_opp_participants` removed both tables and columns before re-upgrading cleanly.
No frontend change.

## Wave 2E — pipeline Phase 1: models and compatibility resolver (2026-09-29)

Backend Phase 1 of `04-pipelines-kanban.md`. `sales_opportunities.sales_stage` is untouched;
no Opportunity references a stage row yet.

- **Inventory first.** `04a-stage-inventory.md` lists every place that compares, validates,
  groups or displays a legacy stage key, backend and frontend, each tagged with the 04 phase
  that migrates it. Phase 4 may not drop `ck_sales_opportunities_sales_stage` while a row is
  unticked.
- `sales_pipelines` / `sales_pipeline_stages` (`20260817_sales_pipelines`). A stage has a
  stable `key`, an editable `label`, `position`, `semantic_type`
  (`open | ongoing | won | lost`; `open` = entry, `ongoing` = active pursuit, both not-closed),
  `probability`, `is_active`. There is one default pipeline per tenant and module, enforced
  by a partial unique index, and a default must be active (a check constraint). `module_key`
  is constrained to `sales_opportunities`: pipelines are sales-domain, not generic metadata.
- The migration seeds a default pipeline for **every** tenant from the legacy catalog, using
  the same keys, the report's forecast weights as probabilities, and sentence-case labels.
  It then asserts that no stored `sales_stage` is orphaned.
- `pipelines_services.ensure_default_opportunity_pipeline` seeds tenants created later on
  first use (it flushes and does not commit; a losing concurrent seed reads the winner).
  `resolve_legacy_opportunity_stage` maps a stored value to its row **by key**, never label.
  Inactive stages still resolve, so history stays readable. The bootstrap seed calls ensure.
- `GET /sales/opportunities/pipeline` (Opportunity `view`) returns the resolved default with
  every stage, including `semantic_type` and `is_closed`, so clients never infer from labels.
- The backend label catalog is now sentence case (`Closed won`), matching the frontend
  mirror; `scripts/check-opportunity-stages.py` passes again (it was failing at HEAD). The
  pipeline-summary endpoint's labels change case accordingly.
- Tenant backups now export `sales_pipelines.json` / `sales_pipeline_stages.json` with
  Opportunities. Restore does not read them yet, same as `sales_opportunity_contacts.json`.
- `FORECAST_STAGE_PROBABILITIES` now derives from the catalog; the values are unchanged
  (pinned by a test).

Verification: `test_sales_pipelines.py` 21 of 21, which covers the populated backfill with
every legacy stage, idempotency, the orphan block, default uniqueness, inactive-default
rejection, the concurrent-seed loss, key-not-label resolution, inactive-stage history,
tenant isolation, and the route's permission and ordering. The full backend suite passes,
1046 of 1046: 4 rate-limit tests need Redis and were re-run with it. `verify_migrations` passes at
`20260817_sales_pipelines`, and `verify_openapi` passes for 358 paths. A populated upgrade on a
throwaway PostgreSQL database seeded 6 stages for each of three tenants and rejected a second
default. Not run: the contract drift check (layout family untouched), frontend lint/build (no
frontend change), and a real `alembic downgrade`.

## Wave 2D — participant management (2026-09-29)

Frontend Phase 2 of `05-relationships-data-model.md`, on the Phase 2 APIs that were already
in place. Phase 1 (display) and Opportunity Quick Create had landed earlier.

- `components/opportunities/OpportunityParticipants.tsx` — the `Participants` panel on the
  deal's `Related records` tab: add (contact picker, role, primary), change role, make
  primary, remove with a confirmation and an Undo that calls the restore route. A contact
  not yet in the CRM is created in place through Contact Quick Create with the deal's
  account filled in, and the add panel reopens with that contact selected.
- Placement follows design.md §4.7: a participant is a row pointing at the deal, so it is
  managed in the content region, not the spine. The spine's `Participants` count is now
  drawn at zero too, because the tab it opens is where people are added.
- Permissions mirror the routes: add, change role and make primary need deal `edit`;
  removal needs `delete`; Undo needs `restore`. The whole panel needs Contacts `view`
  (`can_view_contacts`). The server enforces all of it independently.
- No backend change, no migration, no contract change.

Verification: lint and build are clean; `check-design.sh` passes 21 of 21;
`opportunity-participants.spec.ts` passes 5 of 5; the panel was checked in both themes
(body `rgb(11, 13, 16)` / `rgb(247, 248, 250)`). `opportunities-revamp.spec.ts` fails 3 of 3
at the default 30s both with and without this change (a stashed-HEAD baseline). At 90s it
fails only `pipeline totals … retry` on the list page, which this change does not touch.

Left open: see *Deferred* below.

## Deferred — not built, and when to build it

Each row is deliberately unbuilt. The trigger column says when it is due. Check this table at
the start of every wave, and build a row in the wave its trigger names, not earlier.

| Item | Why it waits | Build it when |
|---|---|---|
| A view of removed participants (`/participants/recycle` has no UI) | Undo covers the immediate case | When an operator needs to restore a participant after the Undo toast is gone, or with a shared record-level recycle view |
| Catalog ↔ quote/order line items (`catalog_product_id` / `catalog_service_id`) | Filed by rebuild 5.3 as its own slice | A standalone slice; not tied to a wave |
| Custom-module EAV filtering over `custom_module_record_values` (rebuild Appendix B.2) | A backend query-parameter contract | A standalone slice; the toolbar already stopped claiming the filter works |
| `RequiredMark` not announced to screen readers (about 54 of 68 uses) | A primitive decision for the owner: a `Field` context, or the mark taking its control's id | When the owner picks the approach; then fix in the primitive, not at each call site |
| `opportunities-revamp.spec.ts` "pipeline totals … retry" fails (inherited, reproduces at HEAD) | Not caused by 2D; unread beyond attribution | 2E frontend Phase 1, the first 2E slice that touches the list page |
| Tenant restore of pipeline configuration and stage ids | Backups export pipelines, stages and each deal's stage ids; restore reads no sales files yet | When tenant restore gains sales-module restore: stage ids must be remapped, not copied |
| Partial quote/order update that sends only `contact_id` is not checked against the record's stored deal | Predates 05 Phase 3; `_ensure_linked_records` validates only submitted fields | When quote/order updates are next touched: validate against the effective (submitted or stored) deal |
| Quote/order Deal picker filters deals by *primary* contact only | `contact_id is` on the opportunity search means the primary; a participant filter is a search contract change | When the quote form is next touched, or the picker gains a participant filter (the rail did not touch the quote form) |
| `contacts-revamp.spec.ts` "shared workflow" fails: the Contact **edit** form's Email field is empty (inherited, reproduces with 05 frontend Phase 4 stashed) | Not caused by the rail; unread beyond attribution | The next slice that touches the Contact edit form |
| Offering an account's contacts as email recipients from the Account page | Owner decision 2026-09-29: a separate follow-up; the Account emails its own address only (design.md §4.7) | When the owner asks for it; reuse `recipientCandidates` and a server rule like the deal's |
| The untracked WhatsApp paths (header, follow-up) refuse a national number instead of adding the workspace country, as the tracked contact path does | Adding it means either a second copy of the server's normalizer in TypeScript or a request before every header click; 3B chose the truthful refusal | When the untracked paths gain a server call anyway (06 frontend Phase 1 chooser, or tracked interactions for Lead/Deal) |
| `FollowUpActionRequest` still accepts `channel: call` (3C compatibility layer) | No UI writes it after 3C, but it is a public request shape, and old rows must keep reading | Remove `call` from the request pattern (not from the table's check, and not from the feed) once a release has shipped with no caller, or with 07 Phase 2 at the latest |
| A call log cannot be corrected or removed once written | Follow-ups have neither either; 07 §9 puts "update notes/outcome" with the integrated call detail | 07 Phase 3's call detail, or sooner if operators ask to fix a mis-logged call. It needs a recoverable delete, not a hard one |
| Accounts log no calls: the header dials the account's number, but the Timeline has no Call mode | Accounts have no follow-up mode or last-contacted stamp today, and the call adapter does not apply to them | When accounts gain contact-attempt logging, add `sales_organizations` to the call log modules and to the adapter's `applies_to` together |
| The composer's mode strip (Note · Call · Email · WhatsApp) clips its last mode at 390px | Predates 3C: the same four modes rendered before; seen in 3C's screenshots | The next slice that touches `RecordTimelineComposer`'s mode strip, or a SegmentedControl overflow rule for narrow widths |
| Contact click-to-chat stamps `whatsapp_last_contacted_at` only, not `last_contacted_at` / `last_contacted_channel` as the follow-up log does | Pre-existing; changing what "last contacted" means was not 3B's scope. 3C has the same shape: a call logged on a deal stamps the deal, not the participant it names | When contact recency is next touched, or tracked interactions extend past contacts |
| A typed address of an opted-out contact who is *not* a participant is not refused when mailing from a deal | The composer only knows participants, and the server links by id, never by address | If opt-out becomes a send-time rule across all mail (the inbox composer has the same gap) |
| `booking.cancelled`, `booking.rescheduled` and the four `ticket.*` automation triggers are unavailable (hidden from the builder, refused when enabling) | No booking cancel/reschedule flow exists; support is out of scope | When bookings gain cancel or reschedule, emit there and set `available=True`. Support: only if the owner brings it back |
| Newly emitted events (`opportunity.created`, `order.status_changed`, `booking.created`, `document.uploaded`, `document.shared`, `task.overdue`) have no webhook catalogue entry | 08a is awaiting the owner's approval, so the catalogue is not extended without it | With 08 Phase 2, as part of the approved contract |
| Leads changed outside `PUT /sales/leads/{id}` (imports, bulk edits, conversion) emit no `lead.updated`, so `lead.status_changed` / `lead.assigned` do not fire for them | Emission stays in routes (08a §2), and the snapshot fix does not change which writes emit | With the "records created outside the HTTP routes" row below: move emission into the services |
| Records created outside the HTTP routes emit no event: CSV import, bookings and POS/finance flows creating contacts or leads, automation actions | Events are emitted in routes, after the commit (08a §2) | When a webhook consumer needs "every lead", move emission into the domain services, one module at a time |
| `task.assigned` / `task.due_today` webhooks carry no assignee identities: the internal payload has only display labels | Adding `assignee_user_ids` changes the internal payload, which 4A kept untouched | With 08 Phase 2, or when a consumer asks: add the IDs to the internal payload (additive) and to the catalogue |
| Webhooks have no tenant public identifier in the envelope | 08 §9 allows one only if product policy does; each subscription is per tenant and signs with its own secret | If the owner wants one endpoint to serve several workspaces; it is an additive envelope key |
