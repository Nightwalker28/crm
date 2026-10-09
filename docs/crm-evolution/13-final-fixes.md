# 13 — Final fixes before UAT

Status: **approved in direction by the owner (2026-10-03). Nothing is built yet.** The code
evidence for every item is in `13a-final-fixes-audit.md`. Part 2 of that file is the
full review register: 74 findings with IDs (A1, B2, …). Part 3 adds 30 findings from the
hands-on browser pass (H1–H30), and Part 4 adds 10 more from the remaining flows (I1–I10). Every finding is placed in a phase below. Every
item here gets fixed before UAT. Phases run in order under `CODEX-RUNBOOK.md`: build every
item in a phase, then run one test pass. A phase marked *research first* starts with a
benchmark of the major players and its own plan file, as every ERP wave did.

This plan covers:
- what the ERP modules lack compared with the CRM modules;
- everything deferred since Wave 0;
- the settings a production tenant needs;
- a new accounting module;
- custom modules with everything a built-in module has;
- tenant-managed picklists;
- every place where Lynk works differently from Salesforce, HubSpot, Dynamics, Zoho or Odoo.

Contracts and support cases stay frozen (`docs/design/rebuild.md`). They get shared-primitive
sweeps only.

## 1. What the audit found

All of this was read from the code on 2026-10-03.

**The ERP workflows work end to end.** Order → reserve → deliver → invoice → pay,
PO → receive → bill, returns, credit notes, adjustments, transfers, reorder and valuation
all work. They have permissions, CSV exports, drafts in the recycle bin, automation triggers,
report sources and seed samples. Linked records are typed.

**Most ERP screens lack the record platform:**

| | Quick create | Configurable layout | Activity + comments | Saved views | Custom fields | Global search | CSV import |
|---|---|---|---|---|---|---|---|
| Leads, contacts, accounts, deals | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Quotes, orders | full form | detail only | ✅ | ✅ | ✅ | ✅ | quotes only |
| Products, services | ❌ | detail only | ✅ | ✅ | ❌ | ✅ | ❌ (no import or export) |
| Invoices | ❌ | detail only | ✅ | ✅ | ❌ | ✅ | ❌ |
| POs, receipts, bills, deliveries, returns, adjustments, transfers, credit notes, payments | ❌ | ❌ | ❌ on the page | ❌ | ❌ | bills and credit notes only | ❌ |
| Custom modules | ❌ | ❌ | ❌ (no Timeline, Tasks, Files or comments) | ✅ | n/a | ✅ | ✅ |

**The customization layer is thin:**
- Admins can edit one layout, Lead quick create (`record_layouts.py`
  `ADMIN_LAYOUT_MODULES`). The `full_form` surface exists in the table, but no module offers
  it.
- Custom fields have five types and no picklist (`custom_fields.py`). Custom modules have a
  different set (`custom_modules.py`). That makes two field systems.
- Field configuration can only hide a standard field. It cannot make one required or
  read-only.
- Fields that need fixed values are free text: lead source, account industry, contact
  region, deal campaign type. Lead status is a hardcoded set (`LEAD_STATUSES`) that tenants
  cannot change.

**Custom modules lack:** Timeline, Tasks and Files; comments; lookup fields and related
lists; quick create and layouts; automation triggers; webhook events; backup and restore;
filters on their own fields (rebuild Appendix B.2); mass actions.

**Insertion orders** (`finance_io`) are an upload register for advertising IO files. The
service parses `.docx` or `.pdf` files for amounts and dates (`io_search_services.py`). They
have no lines, stock, invoicing or payments. In ERP terms an IO is a customer's signed
order, so it is a sales order with an attachment, not an invoice. The module reaches about
56 files.

## 2. Owner decisions (2026-10-03)

| # | Decision |
|---|---|
| 1 | Fix everything in this plan before UAT, including every row of §3 |
| 2 | Tax rates replace typed tax amounts |
| 3 | **A full accounting module**: double entry, posted automatically from documents, with exports for tenants who use another accounting platform |
| 4 | Invoices live at *invoices*, not *pos* |
| 5 | **Insertion orders are retired.** Sales orders and Documents cover them (F1.2) |
| 6 | **Custom modules are built out completely**: everything a built-in module has, so tenants create any module they need. This reverses the "user-created modules" deferral in `AGENTS.md` and `CLAUDE.md`; both are updated in F8 |
| 7 | **Picklists:** tenant-managed value lists, used by standard fields that need fixed values and by custom fields and custom modules |
| 8 | Role and team layout overrides: built (F3), as the 09 plan intended |
| 9 | **The webhook contract `08a-webhook-event-contract.md` is approved** (2026-10-03), so F10 can start |
| 10 | Order of work: by what breaks or blocks most, as §7 sets out |
| 11 | **No users exist yet (2026-10-05), so anything retired goes outright**: code, tables, APIs, pages, in the same step. No CSV archive, no move into Documents, no deprecated API aliases, no redirects, no "drop the tables one release later". This overrides F1.1's aliases and F1.2's export, Documents move and delayed drop. **Contracts and support cases are deleted too**, with the client portal's Support and Messages pages built on them, and any older alias or leftover table found on the way |

## 3. Where Lynk differs from the major players, and the fix

| # | What Lynk does | What the major players do | Fixed in |
|---|---|---|---|
| 1 | Tax is an amount typed on each line | Tax rates on the product and line; tax is computed, inclusive or exclusive, with a tax summary and a tax report | F5 |
| 2 | Orders, credit notes, receipts and bills cannot be printed. Quotes have a proposal flow (plain text, a signed link, accept and decline), but *Send* emails nobody. Nothing is a PDF. Email works from quotes but not from orders, invoices, POs or bills | A branded PDF and *Send by email* on every sales and purchase document | F5 |
| 3 | Admins can edit only the Lead quick-create layout | Admins edit every layout on every module | F3 |
| 4 | Two field systems; no picklist; standard "fixed value" fields are free text | One field system; tenant-managed picklists, including on standard fields | F2, F3 |
| 5 | ERP documents show no history or comments on their own page | History and comments on every document (Odoo chatter, Dynamics timeline) | F4 |
| 6 | Selecting list rows only feeds export | Mass update, assign, delete | F9 |
| 7 | No duplicate detection or merge | Duplicate rules on create, plus merge | F9 |
| 8 | Products and services have no CSV import or export | Importing the catalogue is the first step of ERP onboarding | F0 |
| 9 | Document numbers are a fixed `PREFIX-YYYYMMDD-NNNN` | Prefix and sequence set per document type | F6 |
| 10 | `scripts/platform-backup.sh` dumps the database, but it misses production uploads (named volume) and nothing schedules it. Tenant restore drops sales child rows | Scheduled database and file backups with tested restores | F0 |
| 11 | No general ledger; invoices, bills and stock value reach no books | A built-in ledger (Odoo, Dynamics, NetSuite, Zoho Books) or a connector | F7 |
| 12 | Invoices at `/dashboard/finance/pos` and `/finance/pos-invoices` | `/invoices` | F1 |
| 13 | A media-buying register in every tenant's Finance menu | Industry documents are opt-in or absent | F1 |
| 14 | Custom module records have no Timeline, Tasks, Files, relationships or automation | Custom objects behave like built-in ones (Salesforce custom objects, HubSpot custom objects, Zoho custom modules, Odoo Studio) | F8 |
| 15 | Payment terms are a day count | Named terms (*Net 30*, *End of month*, *Due on receipt*) | F6 |
| 16 | A product's unit is free text | A managed list of units | F6 |
| 18 | Customer-group discounts apply in the client portal only, not on quotes and orders | One price for a customer everywhere | F6 |
| 19 | Eight ERP lists can export through the API, but the app shows no export button | Export on every list | F4 |
| 17 | No price lists or approvals | Customer price lists; approval thresholds for discounts and POs | F6 |

## 4. Phases

Order and why:
- **F1 (renames and retirement) comes early** so every later phase builds on final paths.
- **F2 (picklists) comes before F3** because every field type, custom module, setting and
  accounting list uses picklists.
- **F7 (accounting) comes after F5 and F6** because posting needs tax rates (each rate has
  its own accounts), final invoice paths and configurable numbering for journals.
- **F7 does not come last**, so that F8–F9 (custom modules, mass actions) cover the accounting
  screens too.
- **FQ (code foundations) runs right after F0.** The later phases are built on what it
  consolidates: one transaction per action (accounting), one catalog item (custom fields),
  one line editor (tax), one list and export query (mass actions).
- **F12 (automation and notifications) and F13 (security and privacy) run after F9.** They
  extend primitives the earlier phases settle.

### F0 — UAT blockers

1. **Commit E6** (costing). About 60 files are uncommitted.
2. **Catalog in tenant backups.**
   - Products, services and categories are in no backup set (`tenant_backup_runs.py`). Stock,
     orders, invoices and bills point at them.
   - Add a catalog set, restored before inventory.
   - **Restore every child file (A2).** Today restore writes only the parent rows for sales
     modules: a restored order has no lines; a restored deal has no participants or pipeline
     (`tenant_restore_runs.py:490`, `:657`). Stage ids are remapped, not copied.
   - Back up the custom data no set holds today: custom field definitions and values,
     custom modules and their records, comments, saved views, layouts, tags and automation
     rules.
   - Run a round-trip test: back up the seed tenant, restore it into an empty tenant, and
     compare counts and totals for every module (G1). No test checks child rows today.
3. **CSV import and export for products and services** through `data_transfer_jobs`.
   - Columns: SKU, name, category, unit, price, cost (untracked products only), tracked,
     reorder point, tax rate (from F5).
   - Duplicate mode by SKU.
4. **A UAT data procedure**, written as a doc:
   - import the catalogue;
   - import opening stock with unit costs;
   - set the base currency, payment terms and opening balances (from F7);
   - never start from the dev database.
5. **Fix `scripts/platform-backup.sh`.** It tars `backend/uploads` from the host, but
   production keeps uploads in the `crm_uploads` volume, so they are missed. It also uses the
   dev compose unless `COMPOSE_FILE` is set. Read uploads through the backend container, make
   the compose file explicit, and add a schedule.
6. **A production checklist**, checked against `docker-compose.prod.yml`:
   - the backup schedule from item 5, with one tested `platform-restore.sh` run;
   - secrets and encryption key storage;
   - outbound mail provider;
   - Celery beat;
   - upload volume backups;
   - HTTPS and cookie domain;
   - `DEBUG=false`, which keeps `/auth/dev/login` off (B10).
7. **Security and access blockers:**
   - **A1:** the account import's duplicate lookup gets its tenant filter. Add a
     cross-tenant import test for every importer (G2).
   - **B1:** client-portal admin routes check the `client_portal` module's three layers.
   - **B2:** security headers: CSP, `frame-ancestors`, HSTS, `nosniff`, Referrer-Policy.
   - **B3:** forgot password (an emailed, single-use, expiring link) and *Change password*
     in Profile. Both revoke the user's other sessions.
   - **B4:** user invites are emailed through `send_system_message`, and the setup link
     stays available as a fallback. The same sender carries the password reset.
8. **Observability:**
   - **F1:** error tracking for the backend, the workers and the frontend.
   - **F2:** structured logs with a request id.
   - **F3:** a readiness check that touches PostgreSQL, Redis and the broker.
   - **F4:** one global exception handler with one error shape.
   - **F5:** a root `global-error.tsx`.
   - **F6:** alerting when beat or the queue stops.
   - **E13:** fix the `next.config.ts` image hosts.
   - **E14:** replace `on_event` with a lifespan handler.

9. **Bugs and blockers from the hands-on pass** (13a Parts 3–4):
   - **I1, first of all:** tenant backups fail since E5 because invoice lines have no
     `tenant_id`. Add the column (backfilled from the invoice), check every backup child
     model for the same gap, and run a backup in the test suite for every set.
   - **I2:** while the session refreshes, show a loading state, not "access required", and
     keep the deep link through the refresh.
   - **I6, I10:** alert when the worker or beat stops (F6 of Part 2). Integrations shows the
     current user's own mailbox state, beside the tenant's.
   - **H1:** the deal edit form fails for any deal with an empty optional field. Normalise
     null to "" when loading, in every record form, and make the payload builders null-safe.
   - **H2:** forms show the server's errors on the fields they belong to. The deal form's
     catch, lead quick create and the bill footer error are the cases seen. This needs one
     shared error mapper, not one per form.
   - **H3:** the realtime stream moves off the event loop. Either run its polling in a
     thread with its own short-lived sessions and no request-scoped `require_user`
     session, or (preferred) push events through Redis pub/sub instead of polling the
     database. Load-test it with 100 open streams.
   - **H4:** pin every backend dependency (a lock file), and replace `python-jose` with
     PyJWT.
   - **H5:** money totals never add different currencies. Convert to the base currency at
     the record's rate (E6) and label the total with that currency. This covers the
     dashboard, the deal summary strip and the pipeline board.
   - **H6 (interim, before F6's price lists):** the catalog picker offers every active item.
     An item priced in another currency is converted at the document's exchange rate,
     with the conversion shown on the line.
   - **H8:** a product with any uncosted units stays *Cost missing*. Its average is shown
     as partial until a *Revalue*, and Valuation flags it.
   - **H12:** the timeline refreshes after a note, call or email is added; @mention
     suggestions filter on the typed text.
   - **H16 (presentation):** quotes, orders and invoices show subtotal, discount and tax
     the same way.
   - **H17:** missing images fall back to initials or a placeholder.
   - **H20:** Stock hides removed warehouses.
   - **H21:** quantities are formatted with the unit's precision ("83 units"). The list's
     *Active* switch becomes a menu action with a confirmation.
   - **H22:** Movements shows document numbers and keeps the Quantity column visible.
   - **H23:** `apiFetch` gets a request timeout. Lists and pages show an error state with
     *Retry* instead of endless skeletons.
   - **H26:** Permissions shows module names; Fields offers only modules that accept custom
     fields (or explains why not); Backups warns when a scheduled run is overdue.
   - **H29:** UAT gets its own database. E2E runs against a disposable database, created and
     dropped per run, never the shared dev one.

### FQ — Code foundations (runs right after F0)

Refactors that later phases build on. Behaviour does not change, and every one is covered by
the existing tests before and after.

1. **One unit of work per business action (E5, E6).** Services flush; the route (or job)
   commits once. Activity and events join the same transaction. Start with the composite
   flows: conversion, quote → order, order → delivery → invoice, receipt → bill, payments.
   Accounting posting (F7) needs this.
2. **One list query per module (E1, A5, G3).** Each module keeps a single query builder
   (repository or service, chosen once in `backend/AGENTS.md`). List, cursor, export, report
   and mass-action paths all use it. Add a test that an export returns exactly the rows the
   list shows.
3. **One catalog item implementation (E2)** for products and services, parameterised by kind.
4. **One route factory for import, export and cursor endpoints (E3).**
5. **One permission helper (B6, E4, B7):** a single `PermissionPolicy` / `require_action_access`
   pair. `_allowed`, `_can` and the inline checks go, and website-integration routes move
   from `require_admin` to module actions.
6. **LIKE escaping (B5):** every search goes through `core/like_patterns.py`.
7. **Frontend consolidation:**
   - **E7:** one custom-module record form for create and edit; one shared record detail
     layout for contact, account and deal; `MatrixTable` built on `RecordTable`; one
     `QuickCreateLayoutFields`; one print layout; one `DocumentListPage` for the ERP lists.
   - **E8:** one line editor for every document, with per-document columns.
   - **E9:** the 22 manual fetches move to React Query.
   - **A13:** `window.confirm` gives way to the app dialog.
   - **E11:** split the dense one-line money helpers.
   - **E12:** remove dead code.
   - **H9:** a column that renders its own link must not sit inside `RecordTable`'s link
     cell. The table offers a "cell is the link" mode, and a guard test checks for nested
     `<a>`.
   - **H10:** the shared form helpers never pass `null` to an input.
   - **H15:** the shared line editor (E8) sizes Item as the widest column and keeps totals
     and remove visible at 1280 px, using a column layout instead of fixed widths.
   - **H30:** a record-tab switch fetches its route once.
8. **Layering (E10):** write down which modules use repositories, so new code stops
   guessing.
9. **Naming (C6):** API responses use one convention for keys, timestamps, owner and totals
   (`id`, `created_at`, `owner_id`, `subtotal`/`total`). Database columns stay, mapped in the
   schemas, and the generated contracts are updated together.

### F1 — Names and retirement

0. **Sidebar for modules added later (H27).** A tenant with a customised sidebar puts a new
   module in its registry group (Inventory, Purchasing, …), creating the group if it is
   missing, instead of "Other". A one-time fix regroups the 13 ERP pages in existing
   tenants. Tasks and Documents are restored to the sidebar.

1. **Invoices live at invoices.**
   - Pages move from `/dashboard/finance/pos/*` to `/dashboard/finance/invoices/*`, with
     permanent redirects from the old paths.
   - API paths move from `/finance/pos-invoices*` to `/finance/invoices*`. The old paths stay
     as deprecated aliases for one release, because website integrations and saved links
     may call them.
   - Update the module registries, reports' links, global search hrefs, notification and
     email links, and the e2e specs (33 files).
   - A migration updates `modules.base_route`, which every tenant's database stores.
   - The internal key `finance_pos` stays. Users never see it, and renaming it would mean
     migrating permissions, saved views, custom fields, activity and backups (E5
     decision 1). The *Issue and mark paid* fast path keeps its name.
2. **Retire insertion orders.**
   - Export every tenant's IOs to CSV, as a download kept with the release.
   - Move each IO's file into Documents, linked to its Account or contact. The IO number,
     amounts, dates and status go into the document description.
   - Remove the deal page's *Create insertion order* action
     (`POST /sales/opportunities/{id}/create_finance_io`) and the *Insertion orders* cards on
     deal, contact and account pages. A deal creates quotes and orders instead.
   - Disable automation rules on IO triggers and tell their owners (none in the dev database). `invoice.overdue`
     belongs to IOs (E5 §1); invoices already have `finance.invoice_overdue`.
   - Remove the module from the sidebar, the registries, seed, reports and search.
   - Drop the tables one release later, after the archive is confirmed.
   - Remove `python-docx` and `pdfplumber` if nothing else uses them.
   - Signed customer orders from now on are sales orders with the file attached.
3. **One order model (C5, A3).** Website orders become sales orders with a `source` and
   channel, as client-portal orders already are. Their separate tables are migrated and
   retired.
   - *Create invoice* on a website order goes through order invoicing: it respects the
     invoicing policy, links the order, uses real tax, and takes the payment method from
     the payment, not the platform name.
   - The hardcoded accent colour goes.
   - Existing website-order invoices are linked to their sales orders where one exists.
   - Any order invoiced twice is reported to the owner, not fixed silently.

### F2 — Picklists (research first: Salesforce global value sets, Dynamics choices, Zoho and HubSpot options)

1. **The primitive.** Picklists are tenant-managed value lists.
   - Each value has a stable key, a label, a sort order, an active flag, an optional default
     and a colour for chips and boards.
   - Values are deactivated, never deleted, so old records still read.
   - A list is either **global** (reused by several fields) or **local** to one field.
   - Settings → Picklists manages them. It can rename a value and merge two values; a merge
     rewrites the records, through a job when the list is large.
   - Every value change is in the activity log.
2. **Logic-bearing statuses keep a meaning.** A tenant may add or rename lead status values,
   but each value maps to a fixed meaning: *open*, *working*, *qualified*, *unqualified* or
   *converted*. This is the pattern deal stages already use (2E). Conversion, scoring
   and automation read the meaning, never the label. Document lifecycles stay fixed, as in
   every major ERP: quote, order, invoice, PO, bill, delivery and accounting states.
3. **Standard fields become picklists**, with their existing distinct values migrated in:
   - lead source and lead status (the status keeps its meaning);
   - account industry and account type (customer, prospect, partner, vendor; the vendor
     switch maps onto it);
   - contact region;
   - deal campaign type, and a new deal *lost reason*;
   - order and quote *lost or declined reason*;
   - payment method;
   - product unit (F6.2 manages the list).
4. **Country is a system list**: ISO 3166 codes stored, names shown. It is not
   tenant-editable, but a tenant can limit which countries appear. Free-text countries are
   matched to codes on migration. Values that do not match are listed for the admin, not
   guessed. A dependent state or province list comes with F3.6.
5. **Picklists work across the platform:**
   - filters, saved views and inline filters;
   - report group-by and filters;
   - import (an unknown value is refused, or created when the admin chooses);
   - export;
   - list chips;
   - automation conditions;
   - webhook payloads, as keys.
6. **Standard records the way the major players model them** (C1, C2, A4, A9, A11). These
   changes come here because they create the picklist and typed fields F3 builds on:
   - **Deals:**
     - a numeric `amount` with a currency, backfilled by parsing `total_cost_of_project`
       (values that do not parse are listed for the admin);
     - `lost_reason` as a picklist, plus *next step*, *type* and *source*;
     - `client` derived from the Account instead of required free text;
     - the agency fields (`total_leads`, `cpl`, `domain_cap`, `tactics`, `target_audience`,
       `target_geography`, `delivery_format`, `campaign_type`, the `attachments` text)
       become custom fields with their data migrated, so tenants who use them keep them and
       others never see them.
   - **Accounts:**
     - billing **and** shipping addresses, structured;
     - `annual_revenue` and employee count as numbers.
   - **Contacts:** mobile and work phones, a structured address, salutation.
   - **Leads and contacts:** email is optional; a lead or contact needs an email or a phone.
   - **Deal page and form (H13):**
     - *Create quote* and *Create order* in the header and on the Quotes card;
     - *Mark won* and *Mark lost* (lost asks for the reason);
     - one label, *Amount*, everywhere, formatted with its currency;
     - currency defaults to the base currency, and probability to the stage's;
     - *Contact* becomes optional; *Account* or *Contact* is required.
   - **Lead conversion (H11):**
     - visible switch states;
     - *Create deal* on by default, with amount and close date;
     - a result screen linking the new account, contact and deal;
     - "Converted from lead …" on each new record's timeline.
   - **Lead quick create (H25):** adds *Source*.
   - **Quotes and orders (C3):**
     - billing and shipping addresses copied from the account, editable;
     - a customer PO reference;
     - terms and conditions (with a default from F6);
     - a shipping method and a delivery charge.
   - **Products (C4):**
     - a list price separate from the website price;
     - several images;
     - weight and dimensions;
     - a tax category (F5);
     - vendor prices and codes for more than one vendor (F6).

### F3 — One field system and customization everywhere (research first)

1. **One field type set** for custom fields, custom modules and the layout renderer:
   - text, long text, number, decimal, currency, percent, yes/no;
   - date, date-time, email, phone, URL;
   - picklist, multi-select picklist, user, record lookup, file, auto-number.

   Each type defines its validation, storage, filtering and sorting, import and export, list
   cell, form control and report behaviour (09 Phase 5). Existing custom field and custom
   module types are migrated to it.
2. **Custom fields on every module**, built-in and ERP:
   - catalog: products, services;
   - sales documents: invoices, credit notes, payments;
   - purchasing: POs, receipts, bills;
   - inventory: deliveries, returns, adjustments, transfers;
   - accounting, as F7 lands.

   They appear in list columns, filters, exports, reports and layouts.
3. **Layout admin for every module and surface:** quick create, detail and full form.
   - Admins edit sections, field order, widths and visibility, with a preview.
   - ERP documents get header layouts. Line editors stay fixed.
   - Retire `ADMIN_LAYOUT_MODULES`. Every module in `SUPPORTED_LAYOUT_SURFACES_BY_MODULE` is
     editable.
4. **Field rules.** Admins can make a standard field required or read-only, as well as
   hidden.
   - Add the columns to `module_field_configs`.
   - The server enforces the rules, and the layout resolver shows them.
   - Required fields the business logic needs stay required.
5. **Role and team layout overrides** (09 Phase 3), with a preview of the effective layout
   for a role or team.
6. **Dependent picklists.** A controlling field limits a dependent field's values, for
   example country → state or province, or category → subcategory. The server checks the
   pair.
7. **Quick create everywhere a record is born:**
   - products and services, through `QuickCreateSurface` with a layout;
   - *Create "…"* inside pickers: a product in the line editor, a vendor Account in the PO
     and bill vendor picker, a contact in the quote and order picker.
8. **Clone (D1)** on leads, contacts, accounts, deals, quotes, orders, products, services,
   POs and custom-module records. It copies fields and lines, never numbers, statuses or
   history, and opens the copy as an unsaved full form.

### F4 — ERP documents get the record platform

1. **One shared document history panel** with activity and comments on every document page:
   - inventory: adjustment, transfer, delivery, return;
   - purchasing: PO, receipt, bill;
   - finance: credit note, payment;
   - accounting: journal entries, as F7 lands.

   Add the modules to `RECORD_COMMENT_MODULES` and add `record_activity` adapters. The panel
   is built once and reused.
2. **Saved views and inline filters on every document list**, with seeded presets
   (*Drafts*, *To receive*, *Overdue*, *Mine*). Add the modules to `SAVED_VIEW_MODULES`.
   Adjustments and transfers also get search.
3. **Export buttons.** The API already exports POs, receipts, bills, deliveries, returns,
   invoices, credit notes and payments (`*/export-job`), but no page calls it. Add the
   shared export control to each list. Sales orders get import and export routes, which
   they lack.
4. **Global search** over POs, receipts, deliveries, returns, adjustments, transfers and
   payments. Search by number, by vendor or customer, and by vendor invoice number. Each
   result checks the user's access.
5. **Document flow polish (I3, I4):**
   - *Create credit note* is disabled with its reason when nothing on a return was
     invoiced.
   - New-delivery forms show the order number.
   - One spelling: "Fulfilment".
   - The fulfilment table fits.
   - The tracking number links to the carrier where its URL is known.
6. **Deferred E5 and E6 tails:**
   - a payment date may be one day ahead (show the user's own today instead);
   - bill price differences on goods already sold also appear in the *Cost of goods sold*
     report source.
6. **PO and receipt usability (H18, H19):**
   - PO lines accept services and non-stock items, as well as tracked products.
   - PO lines get tax and discount, matching bills.
   - Unit cost defaults from the vendor's price, then the product's cost.
   - The vendor picker shows recent vendors on focus.
   - The PO page gets a number heading, *Create bill*, its receipts and bills, and history
     (item 1).
   - The receipt gets *Post* in one step, with today as the default date.
   - Required fields are marked.
   - A price difference is shown on the bill before posting.
   - The posted bill shows the vendor invoice number.
7. **Purchasing documents the major players have (D12):**
   - **vendor credits:** a credit against a bill, through the existing allocations;
   - **return to vendor:** an outbound stock move valued at the receipt cost;
   - **RFQs:** a PO in *request* status that is sent, compared, then confirmed.

### F5 — Commercial documents (research first)

1. **Tax rates.**
   - Settings → Taxes: name, rate, inclusive or exclusive, active, and tax groups (a group
     combines several rates on one line).
   - A default rate on products and services, on the company, and per Account (for exempt
     customers).
   - Every line picks a rate, on quotes, orders, invoices, credit notes, POs and bills. The
     shared line-amount function (12c §5a) computes the tax.
   - Documents show a tax summary. Add a *Tax* report source.
   - Migration: existing lines keep their typed amount as a manual override, so no issued
     total changes.
   - Invoices today add a header `tax_rate` (from POS) to the line amounts. The header rate
     becomes a line rate, so there is one mechanism.
   - Website and portal orders get tax from the product's rate. They are 0 today.
2. **PDF documents.**
   - One server-side renderer and one template system for quote, order, invoice, credit
     note, PO, delivery note, receipt and bill.
   - Each PDF carries the company logo and address, the counterparty's address, lines, the
     tax summary, terms and payment details.
   - An issued document stores its PDF snapshot.
   - This replaces the browser print views, which stay only as previews. It extends the
     existing invoice *template* setting rather than adding a second system.
3. **Send by email** from each of those documents through `RecordEmailComposer`:
   - the PDF is attached;
   - recipients come from the Account's contacts, or the vendor's for POs and bills;
   - each document type has its default message template;
   - the send is logged in the document's history (F4);
   - record email extends to orders, invoices, credit notes, POs and bills (`mail_services.py`
     covers contacts, accounts, deals, quotes and leads today);
   - quotes keep their proposal flow: the email carries the PDF and the signed link, so
     accept, decline and view tracking keep working. Sending marks the quote *sent* because
     it was actually sent.
   - **The public proposal page (H7)** becomes the branded PDF view:
     - company branding;
     - lines with discount and tax shown;
     - no internal status;
     - a PDF download (not `.txt`);
     - **Accept** (with name and an optional signature) and **Decline** (with a reason),
       both recorded on the quote's timeline.
   - **Invoices (H16):** *Send*; the print or PDF says "Invoice", shows the discount, and
     bills the account's address.
4a. **Client portal (I9).**
   - The client gets an invite email.
   - Setup copy is plain, and there is a forgot password.
   - *Orders* lists the account's sales orders as well as its requests.
   - There is an *Invoices* section (and *Pay* once payment links land).
   - A submitted request shows a confirmation and a readable reference.
   - The top bar shows the client's name and an account menu.
   - Internal jargon is removed.
4. **The line editor the major players have (D10, A6):**
   - discount as an amount or a percent;
   - section and note lines;
   - optional lines on quotes (the customer can accept them in the portal);
   - reorder and duplicate a line;
   - a unit column.

   Totals on screen use the server's rounding: decimal arithmetic, rounded per line, half up.
5. **Quote lifecycle (A7, H14):**
   - A daily scan expires quotes past `expiry_date` and emits `quote.expired`.
   - Issue date defaults to today; expiry defaults to a company validity period, and must
     not be before the issue date.
   - An expired quote cannot be accepted until it is revised.
   - Sending the proposal marks the quote *Sent*.
   - A converted quote is locked, and converting opens the new order.
   - *Customer name* takes the account's name; the pickers show what the deal filled in.
   - A "%" typed in Discount means percent (D10), never a silent amount. Quote revisions: *Revise* copies a sent quote to a new version and
   supersedes the old one.
6. **Receivables (D11):**
   - recurring invoices (a schedule on an invoice template, issued by a job);
   - payment reminders before and after the due date, through message templates;
   - customer statements (PDF, by period, emailable);
   - write-off of a small remaining balance, posted by F7.

### F6 — ERP settings, price lists and approvals (research first for price lists and approvals)

0. **Date format (H25):** the company's date format is used by every date input and display,
   not the browser's `mm/dd/yyyy`. A form section with no enabled fields is not drawn.
1. **Numbering per document type.** Admins set the prefix, the date part (year, month, day
   or none), the padding and the next number, through `allocate_business_number`. Changes
   apply to new documents only. Journals in F7 use it.
2. **Units:** a managed list with a default, used by products and lines. Unit conversion
   (buy in boxes, sell in units) is part of this, with a conversion factor per product.
3. **Named payment terms:** days, end of month plus days, due on receipt, on Accounts and the
   company. Existing day counts migrate to *Net N*.
4. **Warehouse defaults.** The company default exists (`is_default`); add a per-user default.
5. **Document defaults:** notes, terms and template per document type.
6. **Price lists.**
   - Each list has a currency and per-product prices or a percentage rule.
   - An Account or customer group can have its own list.
   - Quotes and orders pick the Account's list.
   - The interim currency conversion from F0 (H6) gives way to price lists.
   - Customer-group discounts (C8), which apply only to client-portal prices today, become price
     lists, so a customer pays one price in the portal and on a quote.
   - This was deferred since E1, §4.1.
7. **Approvals.**
   - A quote or order discount above a threshold needs approval.
   - A PO above an amount needs approval.
   - The approver comes from a role or the record owner's manager.
   - Approval is logged in the document's history.
   - It is built on the automation engine, not as a separate engine.
8. **Company timezone (A8).** The company gets a timezone. Every business date uses the
   company's today: document dates, due dates, overdue scans, receipt, delivery and bill
   dates, document numbers. A shared helper replaces the 15 `date.today()` calls.
9. **Credit and stock policies (C7):**
   - a credit limit per Account, with a warning or a block when confirming an order over it;
   - a company setting for negative stock, *refuse* (today) or *allow and flag*.

### F7 — Accounting (research first: Odoo Accounting, Zoho Books, Xero, QuickBooks, Business Central)

Its own plan file, `14-accounting.md`, written first. The outline:

1. **Foundations.**
   - A chart of accounts with account types: asset, liability, equity, income, expense, and
     the subtypes receivable, payable, bank, cash, inventory, cost of goods, tax and
     retained earnings.
   - It starts from a template: one generic template; a tenant can edit it.
   - Journals: sales, purchase, bank, cash, general.
   - Fiscal years and a lock date.
   - Every amount is in the base currency, with the document currency and rate kept beside it.
   - **Prerequisite:** invoices, credit notes, bills and payments get an exchange rate, as
     POs and sales orders already have.
2. **Journal entries.**
   - Double entry, draft → posted.
   - A posted entry is append-only, protected by a database trigger as stock moves are.
   - Corrections are reversals. Each journal has its own numbering.
   - Manual entries are allowed, with balance checks.
3. **Automatic posting from documents**, each from a fixed mapping:

   | Document | Debit | Credit |
   |---|---|---|
   | Invoice | Receivable | Income, Tax payable |
   | Credit note | The reverse of an invoice | |
   | Customer payment | Bank or cash | Receivable |
   | Bill | Stock received not billed, or expense; Tax receivable | Payable |
   | Vendor payment | Payable | Bank |
   | Receipt | Inventory | Stock received not billed |
   | Delivery | Cost of goods | Inventory |

   - Returns, adjustments, transfers between companies (none today) and revaluations post
     their own value-only entries.
   - E6's move values and revaluation `stock_change` / `cogs_change` are the amounts
     (12d §6).
   - Account mapping comes from the company defaults, then the product category, then the
     product, and from tax rates (F5) for tax.
   - Realized exchange gains and losses post when a payment's rate differs from its
     document's rate.
4. **Bank and cash.**
   - Bank accounts, linked to payment records.
   - Statement import (CSV, OFX).
   - Reconciliation by matching statement lines to payments, with suggested matches.
   - Unmatched lines can become manual entries.
5. **Go-live and opening balances.**
   - A tenant sets an accounting start date. Documents before it do not post.
   - Opening balances are imported or entered: trial balance, open receivables and payables
     per Account, stock value from E6. This is the standard conversion-date approach (Xero,
     QuickBooks).
6. **Reports:**
   - trial balance, general ledger, profit and loss, balance sheet;
   - aged receivables and payables;
   - the tax report from F5;
   - cash flow.

   Each has a date range and comparison, a drill-down to the entry and the document, and
   report-engine sources for custom reports.
7. **Exports for other accounting platforms.**
   - Journal entries, chart of accounts, trial balance, and invoices and bills with their
     lines, for a period.
   - Formats: a generic journal CSV, Xero's import CSVs, QuickBooks Online's journal and
     invoice import CSVs, Zoho Books' import CSV.
   - Each export is a job, records what it exported, and can mark entries exported, so
     the next export takes only new ones.
   - Tenants that keep their books elsewhere can turn off posting and use exports only.
8. **The platform:**
   - permissions (an *Accountant* role seed);
   - activity, comments, saved views, search, backups and recycle bin (for drafts only);
   - automation triggers and report sources;
   - seed samples;
   - the history panel from F4.

### F8 — Custom modules, complete (research first: Salesforce custom objects, HubSpot custom objects, Zoho custom modules, Odoo Studio)

A custom module does everything a built-in module does.

1. **The builder.**
   - Singular and plural names, icon, sidebar group and position, a record-name field.
   - Field management with F3's whole type set, including picklists, lookups and
     auto-number.
   - Field deletion warns about stored data and can be undone (recycle bin).
   - Deleting a module is recoverable.
   - The builder previews the list, form and record page.
2. **Records.**
   - The full record workspace: Timeline, notes, Tasks, Files, comments, email from the
     record, activity.
   - Quick create, detail and full-form layouts editable in F3's layout admin.
3. **Relationships.**
   - Lookup fields to built-in modules (Account, contact, deal, product, order) and to other
     custom modules.
   - A related list appears on the other side: an Account shows its custom records.
   - One-to-many lookups, plus many-to-many through a junction module.
   - Linked records stay inside the tenant.
4. **Lists.**
   - Filters on every field, including EAV filtering over `custom_module_record_values`
     (rebuild Appendix B.2), indexed for the common types.
   - Saved views, column picker, sorting, mass actions (F9), import and export.
   - A board view grouped by any picklist, with drag and a non-drag alternative.
5. **Computed fields.**
   - **Formula fields** from a constrained expression grammar: arithmetic, text, dates,
     conditions, fields on the record and its lookups. No tenant code runs, as 09 §18
     requires.
   - **Roll-up fields**: count, sum, min and max of related records.
   - The same field types become available as custom fields on built-in modules.
6. **The platform.**
   - The three access layers and role actions, seeded per module.
   - Automation: record created, updated, field changed, and actions on custom records.
   - Webhook events in F10.
   - Report sources (exist), global search (exists), recycle bin (exists).
   - **Backup and restore** (missing today).
   - Activity log, and duplicate rules (F9).
7. **Docs.** Remove "user-created modules" from the deferred lists in `AGENTS.md` and
   `CLAUDE.md`. Update the `.claude` and `.codex` skill copies together.

### F9 — Lists and data hygiene, CRM and ERP

1. **Mass actions on every list**, built-in and custom: change owner, change status (where
   the lifecycle allows), set a field, add a tag, delete.
   - Each checks the role action per record.
   - Each writes activity and is recoverable.
   - Large selections run as a job.
2. **Duplicate rules and merge** for leads, contacts, accounts and custom modules.
   - Matching rules: email, phone, name plus company or domain, configurable per module.
   - A warning on create and on import.
   - A merge screen that picks the surviving values per field and moves relationships,
     activity, files and comments. The merge is recorded and can be undone.
3. **Every remaining row of the Deferred table in `STATUS.md`**, except those in §5:
   - The Contact edit form loads with Email empty. This is a real bug.
   - A partial quote or order update with only `contact_id` is not checked against the
     stored deal.
   - The deal Pipeline totals retry fails.
   - The quote and order Deal picker matches the primary contact only. Add a participant
     filter.
   - The composer mode strip clips at 390px.
   - `RequiredMark` is not announced to screen readers. Fix it in the primitive with a
     `Field` context.
   - A call log cannot be corrected or removed. Add edit and a recoverable delete.
   - Accounts log no calls.
   - An account's contacts cannot be picked as email recipients from the Account page.
   - Removed participants have no restore view.
   - Contact click-to-chat does not stamp *last contacted*.
   - A typed opted-out address is not refused when mailing from a deal. Make opt-out a
     send-time rule for all mail.
   - The untracked WhatsApp paths refuse national numbers.
   - The `channel: call` compatibility layer is removed.
4. **Events from every write path.** Move CRM event emission from routes into services, so
   imports, bulk edits, conversion, bookings, POS and automation emit `lead.updated` and the
   other events. ERP services already do this through `stage_inventory_event`; generalize it
   and use it everywhere. Start with leads.
5. The Contact edit form's empty Email (Deferred table) did not show in a static read. Reproduce
   it in the browser before fixing it.
6. **Small list conveniences:**
   - **A10:** rows are real links, so Ctrl-click, middle-click and *Copy link* work; Enter
     still opens the row.
   - **D2:** inline edit of a cell, checked by the same field rules as the form.
   - **D5:** a totals row for money and quantity columns; resizable columns, remembered per
     user.
   - **D14:** a calendar view for any module with a date, and a board for any picklist (F8
     already plans the board for custom modules).
   - **H28:** Calendar gets day, week and agenda views.
   - **H24:**
     - the lead list shows the full name and hides converted leads by default;
     - default columns include email and phone (leads) and stage, account and owner
       (deals);
     - saved-view names are unique per user and module;
     - list state (view, display, search, filters) lives in the URL, with one parameter
       name everywhere.
   - **H20:** Stock offers a per-product view with totals, and hides zero rows by default.
   - **H22:** Adjustments gets search, and reason codes become a picklist (F2).
7. **Finding your records:**
   - **D3:** recently viewed and favourite records, in the sidebar and the command palette.
   - **D4:** *Follow* a record to get its notifications.
   - **D15:** keyboard shortcuts for new, save, and next and previous record.
8. **User offboarding (D13):** deactivating a user offers to reassign their open records,
   tasks and documents to another user or team, as one job with an activity entry.
9. **Copy (A12):** "Opportunity" becomes "Deal" where it still shows.

### F10 — Webhooks (`08a` approved 2026-10-03)

08 Phases 2–4: subscriptions, a delivery worker with retries and signing, then replay and
test sends. The catalogue covers:
- every event since 4A: E2–E6, accounting, custom modules;
- `inventory.revalued`;
- the assignee ids on task events;
- the newly emitted CRM events in the Deferred table.

### F11 — Reports Phase 4 and integrations

0. **Report sources (I7):**
   - add an *Orders* source;
   - group the source list by area;
   - default to the most-used source;
   - use one name for the deal amount;
   - show the report's name on the viewer.
1. **Reports Phase 4** (`11-reports.md` §5): related-record fields, period comparison, owner,
   team and custom-date dashboard filters, dashboard templates.
2. **Integrations that need a provider account.** Each starts only when the owner names the
   provider and supplies credentials. They wait on contracts, not on code:
   - telephony (3D, 07 Phase 2+);
   - the WhatsApp Business API and automated sending (06 Phase 2+);
   - payment links on invoices;
   - two-way Gmail and Outlook inbox sync. Google's restricted scopes need a security
     assessment before production use.

### F12 — Automation, notifications and lead capture

1. **Automation actions (D6):** send email (from a template, to a record's people or a user),
   update a field, assign an owner (fixed, round robin, or least loaded, within a team), call
   a webhook (after F10), wait or delay, create a record.
2. **Email notifications (D7):** every in-app notification can also go by email, at once or
   as a daily digest. Each user sets their preferences per notification type.
3. **Lead capture (D8):**
   - web-to-lead forms with a public endpoint, a spam check and rate limiting, keyed by the
     website integration's key;
   - embeddable form snippets;
   - assignment rules that run on every new lead, whatever its source.
4. **Email tracking and scheduling (D9):** opens and clicks, recorded on the record's
   timeline, with a per-tenant switch; send later.
5. **Setup checklist (D16)** for a new tenant: company, base currency, timezone, users,
   email sender, catalog import, opening stock, first pipeline.

6. **Automation builder usability (I5):**
   - placeholders never look like values;
   - *Done editing* explains what is missing;
   - the default trigger matches the module the builder was opened from;
   - triggers are searchable and grouped by module;
   - the insertion-order "Invoice overdue" is removed (F1.2);
   - Deal and Opportunity wording is unified;
   - enabling a rule saves it.
7. **Module builder (I8):** readable type names, picklist options with keys and colours
   (F2), and a clean form state after *Create*. This lands with F8.

### F13 — Security and privacy

1. **Sessions (B8):** each user sees their active sessions and can revoke them; admins can
   revoke any user's sessions.
2. **Access policies (B8):** an optional IP allowlist per tenant; personal API tokens with
   scopes, shown once and revocable.
3. **Data-subject requests (B9):** export everything held about a contact or lead; erase or
   anonymise one, recorded in the activity log, without breaking issued financial
   documents (their snapshots keep the name, as the law allows).

## 5. After go-live unless a client needs them

These fit inventory businesses with specific needs. None of them is a difference from the
major players' defaults. Each is additive on E6's design (12d §5a):
- lot and serial numbers;
- bin locations;
- FIFO or per-warehouse costing;
- landed costs;
- exchange-rate feeds;
- manufacturing;
- other languages (D17), an owner decision: it touches every string, so if it is wanted,
  it should be decided before the copy grows further.

## 6. Verification cadence

- Each phase gets one test pass after all its items are built: focused backend tests, then
  `codex-check.sh`, then the touched e2e specs with scoped guards.
- Every new page is added to both guards' route lists.
- The full rendered walk runs at F4, F7 and F8, and once before UAT.
- **Step 7 exception (owner, 2026-10-08):** F4, F5 and F6 share one test pass after all three
  are built: focused backend tests per phase in order (F4, F5, F6), then `codex-check.sh`, then
  the touched e2e specs, then the full rendered walk (moved here from F4).
- Before UAT:
  - a backup and restore round trip of the seed tenant (F0.2), rerun after F7 and F8;
  - a clean-tenant UAT load following F0.4;
  - **a second hands-on pass** on the UAT database, repeating every journey in 13a Parts 3–4
    at desktop and 390px, both themes, once by keyboard only. Email sending is part of it:
    the first pass could not send, because no mailbox was connected for the admin;
  - query-count tests on the main list endpoints (G4).

## 7. Execution order and priority

Owner decision 10 (2026-10-03): work in the order that removes the most risk first. Each
step below names what it unblocks. "Before X" means X cannot start until it is done.
Inside a step, items run in the listed order; one test pass per step (§6).

### Step 1 — Stop data loss and wrong data (first, alone)

These damage or misreport real data today, so they go before any other work:
1. **I1** — tenant backups fail since E5.
2. **A2** — restore drops order lines, participants and pipelines.
3. **G1** — a round-trip backup test, so neither happens again.
4. **A1** — the cross-tenant account import.
5. **B1** — client-portal admin permissions.
6. **H5** — totals that add currencies.
7. **H8** — the misleading partial average cost.
8. **H1** — converted deals cannot be edited.
9. **A3** — website orders can be invoiced twice.
10. **Commit E6** (F0.1) before any of this, so these fixes sit on a clean base.

### Step 2 — Make it safe to run (before UAT users touch it)

These keep the app up and the data safe under real use:
1. **H3** — the realtime stream blocking the event loop and holding connections.
2. **H4** — pinned dependencies; drop `python-jose`.
3. **B2** — security headers.
4. **B3, B4** — password reset, password change, emailed invites. These need an outbound
   sender, so F0.5's mail provider comes first.
5. **F1–F6 of Part 2, I2, I6** — error tracking, structured logs, readiness check, global
   error handler, worker and beat alerts, session-refresh state.
6. **F0.5** — the backup script fixes (production uploads, schedule).
7. **H29** — a separate UAT database, and a disposable e2e database.

### Step 3 — Errors users can see and act on

Cheap, high-visibility fixes that UAT would otherwise report on day one:
- **H2** — field errors shown on the fields.
- **H23** — request timeouts and retry states.
- **H12** — timeline refresh, mention filtering.
- **H11** — lead conversion screen.
- **H17, H20, H21, H22, H26, H27, I3, I4** — the F0.9 polish list.

### Step 4 — FQ, code foundations (before steps 5–9)

**Before accounting, tax, custom fields and mass actions:**
- unit of work (E5);
- one list and export query (E1, A5);
- one catalog item (E2);
- one line editor (E8, H15);
- one permission helper (B6);
- form null handling (H10), nested links (H9).

Doing these later would mean rewriting the features that sit on them.

### Step 5 — F1 names, retirement, one order model

**Before F2–F5:** invoices at `/invoices`, insertion orders retired, website orders as
sales orders (C5, A3's lasting fix), and the sidebar for new modules (H27). B7 (website-integration
routes on module permissions, from FQ.5) moved here in Step 4: it needs its own module key, and
this step reshapes website orders anyway. Later phases
then build on the final paths and models.

### Step 6 — F2 picklists and standard records, then F3 customization

**Before F5–F8:** picklists, the deal amount and other typed fields (A4, C1), addresses
(C2), optional lead email (A9), the deal page (H13). Then F3: one field system, custom
fields everywhere, layout admin, field rules. Tax categories, accounting lists, custom
modules and price lists all use picklists and the shared field types.

### Step 7 — ERP completeness: F4, then F5, then F6

1. **F4:** documents get history, comments, saved views, search, export buttons, and PO
   and receipt usability.
2. **F5:** tax rates first, then PDFs and *Send*, the proposal page with accept and
   decline (H7), the quote lifecycle (H14), receivables, and the client portal (I9).
3. **F6:** the company timezone (A8), numbering, units, payment terms, price lists (which
   replace H6's interim conversion), approvals, credit and stock policies.

**F5 tax and F6 numbering come before F7.**

One test pass for the whole step, after F6 (§6, owner 2026-10-08). Each phase still gets its
own research and plan before its code (`13c` for F4, `13d` for F5, `13e` for F6).

### Step 8 — F7 accounting

Needs tax rates (F5), numbering (F6), the unit of work (FQ) and exchange rates on invoices,
bills and payments. Exports to other platforms come in the same step.

### Step 9 — F8 custom modules, then F9 lists and hygiene

F8 builds on F2 and F3 and on F4's history panel. F9's mass actions, duplicates and merge
cover every module, custom ones included. F9.4 (events from every write path) must finish
before step 10.

### Step 10 — F10 webhooks (approved)

Needs F9.4, so every write path emits, and F8, so custom modules have events. The
catalogue then covers every module once, with no second pass.

### Step 11 — F12 automation and notifications, then F13 security and privacy

F12's *send email* and *call webhook* actions need F5's email and F10's delivery worker.
F13 is independent but touches auth, so it runs on its own.

### Step 12 — F11 reports Phase 4 and integrations

Report sources from I7 that UAT needs (*Orders*) can move into step 7 if the owner wants
them sooner. The provider integrations wait on the owner's accounts.

### Then UAT

Before UAT: the checks in §6, and a second hands-on pass on the UAT database, including
sending email once a mailbox is connected.
