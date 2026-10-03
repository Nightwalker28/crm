# 13a — Final fixes: what the code does today

The evidence behind `13-final-fixes.md`, taken from the code and the dev database on
2026-10-03, before any fix. Each item says what happens now, what changes, and how sure the
finding is:
- **Confirmed**: read in the code or the data.
- **Corrected**: the first plan had it wrong; the plan now matches the code.
- **Not reproduced**: recorded elsewhere as failing, but a static read found no cause.

Dev database (read only): 3 tenants, 18 insertion orders (all three tenants), 2 custom
modules, 5 custom fields.

## F0 — UAT blockers

| Item | What the code does now | What changes | |
|---|---|---|---|
| E6 commit | About 60 files modified or untracked (`git status`) | Commit after review | Confirmed |
| Catalog in backups | `tenant_backup_runs.py` `SUPPORTED_MODULE_EXPORTS` has no catalog. The comment at the inventory set says it is left out on purpose | A catalog set restored first; restore must not rewrite prices on `create_missing` | Confirmed |
| **Sales restore** | `tenant_restore_runs.py:490` and `:657` restore only the parent rows for every module except inventory and invoices. `sales_order_items`, `sales_opportunity_contacts`, pipelines and stages are exported but never read back. **A restored order has no lines; a restored deal has no participants or pipeline** | Restore every child file in `MODULE_CHILD_EXPORTS`, with id remapping for stages | Confirmed (new) |
| Custom data in backups | No custom field values, custom field definitions, custom modules or their records, comments, saved views, layouts, tags or automation rules in any backup set | Add each, or state in the UI what a backup leaves out | Confirmed (new) |
| Restore tests | `test_tenant_backup_settings.py` has 10 restore tests: preview, tenant isolation, rollback, confirmation, whole-tenant. **None checks child rows** (order lines, deal participants) or a round trip | The round-trip test in F0.2 | Corrected |
| Catalog import and export | `catalog/routes/*` have no import or export routes; `CatalogRecordsPage.tsx` has no controls | New, through `data_transfer_jobs` | Confirmed |
| Opening stock import | `opening_import.py:38` needs `sku, warehouse_code, quantity, unit_cost` | Unchanged; the UAT procedure uses it | Confirmed |
| Platform backups | **`scripts/platform-backup.sh` and `platform-restore.sh` exist**: `pg_dump -Fc`, uploads tarball, checksums, retention, and a safety backup before `pg_restore` | Keep. The plan's "only the tenant JSON backup" was wrong | Corrected |
| **Backup misses production uploads** | The script tars `backend/uploads` from the host (`platform-backup.sh:262`). `docker-compose.prod.yml` keeps uploads in the named volume `crm_uploads`, so production files are not in the backup. It also runs plain `docker compose exec`, which uses the dev compose unless `COMPOSE_FILE` is set | Read uploads from the volume through the backend container. Make the compose file explicit. Document a schedule: nothing in the repo runs it | Confirmed (new) |
| Production stack | The production compose has backend, Celery worker, beat and frontend, bound to 127.0.0.1. PostgreSQL, Redis and the TLS proxy are external. `config.py` refuses to start without `JWT_SECRET`; `COOKIE_SECURE` comes from the environment | The checklist (F0.5) covers these | Confirmed |

## F1 — Names and retirement

| Item | What the code does now | What changes | |
|---|---|---|---|
| Invoice pages | 7 pages under `app/dashboard/finance/pos/`. **33 files** link to `finance/pos`: 13 frontend source, 8 specs, 7 backend services, 2 seed scripts, `seed.py` | Move the pages, keep redirects, update every link | Confirmed |
| Invoice API | `/finance/pos-invoices*` (`pos_invoice_routes.py`). Called from 5 frontend files and 4 specs; the website integration does not call it | Move to `/finance/invoices*`, keeping aliases for one release | Confirmed |
| Stored links | `modules.base_route = /dashboard/finance/pos` in every tenant's database (seeded). `user_notifications.link_url`: none point at pos today | A migration updates `modules.base_route`; the notification code writes new links | Confirmed |
| Insertion orders: what they are | `FinanceIO`: IO number, file, customer, dates, status, amounts. `io_search_services.py` parses `.docx` and `.pdf` with `python-docx` and `pdfplumber`, the only users of either library | Retire | Confirmed |
| Insertion orders: reach | Outside the finance module: the **deal page's *Create insertion order* action** (`POST /sales/opportunities/{id}/create_finance_io`); *Insertion orders* related cards on deal, contact and account pages (`summary_services.py`); comments, timeline, search, recycle bin, reports, automation, webhooks, layouts, custom fields, field configs, data transfer and the profile's module list; 9 backend tests and 6 e2e specs | Remove each. The deal's create action moves to *Create quote* / *Create order*, which the deal already relates to | Confirmed (new: the deal action) |
| Insertion orders: data | 18 rows across all three tenants: 7 draft, 3 active, 2 issued, 2 completed, 2 imported, 2 cancelled. No automation rules use IO triggers | Archive as planned (CSV plus files into Documents) | Confirmed |

## F2 — Picklists

| Field | Stored as now | Where values come from | Dev data | |
|---|---|---|---|---|
| Lead status | Text, checked against `LEAD_STATUSES` (`leads_services.py:31`) | Hardcoded in the backend and in 2 frontend files (`LeadFormFields.tsx`, the lead page). Scoring (`:218`), conversion (`:500`, `:579`) and automation (`automation_registry.py:172`) read the literal values | — | Confirmed |
| Lead source | Free text | None | No values set | Confirmed |
| Account industry | Free text (`TextField`) | None | 10 distinct, including `Load Test`, `kaas`, `dev` | Confirmed |
| Country (account, contact) | Text, **full names** | `lib/countries.ts`, a name list | `Sri Lanka`, `US` and blank mixed | Confirmed |
| Contact region | Text | `REGIONS` hardcoded twice (`ContactFormFields.tsx:46`, `ContactQuickCreateLayoutFields.tsx:24`) | 4 distinct | Confirmed |
| Payment method | Free text **input** (`RecordPaymentDialog.tsx:85`) | None | `bank_transfer` 6 and `Bank transfer` 1: the same value twice | Confirmed |
| Deal lost reason | Does not exist | — | — | Confirmed |
| Product unit | Free text, default `unit` | None | All 54 are `unit` | Confirmed |
| Custom module selects | `single_select` and `multi_select` with options per field | The builder | 1 each | Confirmed |

**Migration rule from the data:** distinct values become picklist values. Values that
normalize to the same thing (`bank_transfer`, `Bank transfer`) are merged into one. Country
names map to ISO codes; values that do not map are listed for the admin.

## F3 — One field system and customization

| Item | What the code does now | |
|---|---|---|
| Custom field types | `custom_fields.py:30`: text, long_text, number, date, boolean | Confirmed |
| Custom field modules | `custom_fields.py:20`: insertion orders, leads, contacts, accounts, deals, quotes, orders. No catalog, invoice or ERP module | Confirmed |
| Custom module types | `custom_modules_schema.py:10`: text, textarea, number, currency, date, datetime, boolean, email, phone, url, single_select, multi_select. No lookup, user, file, auto-number, formula | Confirmed |
| Two type names for one thing | `long_text` vs `textarea`; `number` in both, but only custom modules have `currency` | Confirmed |
| Layout admin | `record_layouts.py:60` `ADMIN_LAYOUT_MODULES = {"sales_leads"}`, `ADMIN_LAYOUT_SURFACES = {"quick_create"}`. The settings page hardcodes the same pair (`record-layouts/page.tsx:14`) | Confirmed |
| Layout scope | `RecordLayoutDefinition` is per tenant only: no role, team or user column. Surfaces allowed by the table: quick_create, detail, full_form. Offered per module: quick_create for 4 CRM records, detail for 10 | Confirmed |
| Field rules | `module_field_configs` has `is_enabled`, `is_protected` and order. No required or read-only | Confirmed |
| Create inside a picker | `LinkedRecordPicker.tsx` has no create option | Confirmed |
| Quick create | `QuickCreateSurface` is used by leads, contacts, accounts and deals only. The catalog's match is the stock panel's dialog | Confirmed |

## F4 — ERP documents get the record platform

| Item | What the code does now | |
|---|---|---|
| Comments | `RECORD_COMMENT_MODULES` (`record_comments.py:28`): 6 CRM records, support, contracts, insertion orders, invoices, products, services. No ERP document | Confirmed |
| Timeline | `TIMELINE_ALLOWED_MODULES` (`routes/activity_logs.py:14`): the same set plus orders. No ERP document, no custom module | Confirmed |
| Saved views | `SAVED_VIEW_MODULES` (`profile.py:25`): CRM, orders, invoices, payments, catalog, stock. No PO, receipt, bill, delivery, return, adjustment, transfer or credit note | Confirmed |
| List controls | All 8 document lists have search, one status select and pagination. Adjustments and transfers have no search | Confirmed |
| **Export buttons missing** | The backend has `export-job` routes for POs, receipts, bills, deliveries, returns, invoices, credit notes and payments. **No frontend file calls any of them.** Only Stock, Movements and Valuation have export in the UI. `STATUS.md`'s "CSV exports of every list" is true of the API only | Confirmed (new) |
| Sales orders | No import or export route, and no controls | Confirmed (new) |
| Global search | `global_search.py` covers bills and credit notes among ERP documents. No PO, receipt, delivery, return, adjustment, transfer or payment | Confirmed |
| Payment date | `payment_services.py:101` accepts up to server today + 1 day | Confirmed |

## F5 — Commercial documents

| Item | What the code does now | |
|---|---|---|
| Line tax | `tax_amount` typed per line on quotes, orders, invoices, credit notes, POs and bills. `document_amounts.py` is the one place line amounts are computed, ready for a tax code (12c §5a) | Confirmed |
| **Invoices have two tax mechanisms** | A header `tax_rate` (percent of the taxable amount, from POS) **plus** the line amounts, added together (`pos_invoice_services.py:217–225`) | Confirmed (new) |
| Website and portal orders | Tax is always 0 (`website_integration_services.py:586`) | Confirmed (new) |
| PDF | No PDF library in `requirements.txt`. Print pages exist for invoice, PO and delivery note only | Confirmed |
| **Quote proposal** | **Quotes have a proposal flow:** *Generate* stores a plain-text proposal (`quotes_services.py:557`), *Send* creates a signed public link valid for a set time, and accept, decline and view events are tracked. **No email is sent:** the panel says "Proposal marked sent." and shows the link to copy | Corrected |
| Email from records | `mail_services.py:1015` sends record email for contacts, accounts, deals, quotes and leads. Not orders, invoices, credit notes, POs or bills | Confirmed |
| Attachments | Mail takes up to 5 attachments from Documents (`mail_services.py:87`, `:1256`), so a generated PDF stored as a Document can be attached without new mail code | Confirmed |

## F6 — ERP settings

| Item | What the code does now | |
|---|---|---|
| Numbering | `allocate_business_number` with fixed prefixes: Q, SO, PO, RCV, BILL, DEL, RET, ADJ, TRF, REV, CN, PAY, the invoice prefix, CASE, CTR. Format `PREFIX-YYYYMMDD-NNNN` | Confirmed |
| Units | Free text on products and services | Confirmed |
| Payment terms | `default_payment_terms_days` on the company, `payment_terms_days` on accounts; free-text `payment_terms` on documents | Confirmed |
| Default warehouse | **Exists** (`inventory_warehouses.is_default`, unique per tenant). Only a per-user default is missing | Corrected |
| **Customer group pricing** | Customer groups carry a discount (`discount_type`, `discount_value`), **applied only to client-portal prices** (`client_portal_services.py:305`). Quotes and orders a user creates ignore it, so the same customer sees two prices | Confirmed (new) |
| Price lists, approvals | None | Confirmed |

## F7 — Accounting

| Item | What the code does now | |
|---|---|---|
| Ledger | No chart of accounts, journal or entry table anywhere | Confirmed |
| Vendor payments | **Exist**: `finance_payments.direction` is received or made, and allocations settle invoices, bills or credit notes | Confirmed |
| **Exchange rates** | Only POs (`purchase_orders.exchange_rate`) and sales orders have one. **Invoices, credit notes, bills and payments do not**, so a foreign-currency invoice has no rate to post at, and realized exchange differences cannot be computed | Confirmed (new): an F7 prerequisite |
| Stock values | Every move and revaluation already carries a base-currency value (E6) | Confirmed |

## F8 — Custom modules

| Item | What the code does now | |
|---|---|---|
| Lists | Saved views, import and export work (`custom/[moduleKey]/page.tsx`). Filters on fields are hidden (B.2) | Confirmed |
| Record page | **No Timeline, Tasks or Files**: the page explains that `/activity/record` only accepts `TIMELINE_ALLOWED_MODULES` (`[recordId]/page.tsx:221`). No comments | Confirmed |
| Platform | Global search and report sources include custom modules; recycle bin too. **Automation, record activity, comments, webhooks and backups have no custom-module support** (no references in those services) | Confirmed |
| Fields | No lookup, so a custom module cannot link to an Account or to another custom module | Confirmed |
| Access | `_seed_access` seeds module permissions when a module is created | Confirmed |

## F9 — Lists and data hygiene

| Item | What the code does now | |
|---|---|---|
| Row selection | `selectedIds` on CRM lists feeds only `ModuleImportExportControls` (export of the selection) | Confirmed |
| Duplicates | Only the import `duplicate_mode`. No rule on create, no merge | Confirmed |
| Event emission | CRM events are emitted in **routes** (`sales/routes/*`, `tasks`, `documents`, `contracts`), so imports and bulk paths emit nothing. ERP events are emitted in **services** through `stage_inventory_event`, which is the pattern to copy | Confirmed (new: the ERP pattern already exists) |
| Contact edit Email empty | The form fills `primary_email` from the summary (`ContactRecordFormPage.tsx:78`). A static read found no cause. The failing spec is recorded in the Deferred table | Not reproduced: needs a browser repro first |
| Other Deferred rows | As recorded in `STATUS.md`; not re-read one by one | Recorded |

## F10 — Webhooks

No subscription, delivery or replay code exists. `webhook_events.py` holds the catalogue
only. `08a` is still marked awaiting approval. — Confirmed

## What changed in the plan because of this audit

- F0 adds: restore every child file (sales restore is incomplete); back up custom data;
  fix the uploads path and compose file in `platform-backup.sh`.
- F1 adds: the deal's *Create insertion order* action and the related cards; the
  `modules.base_route` migration.
- F4 adds: export buttons on the 8 lists whose API already exports; import and export for
  sales orders.
- F5: build on the quote proposal flow (link, accept, tracking) instead of a second one;
  remove the invoice header tax rate when tax rates land; give website orders tax.
- F6: customer-group discounts apply to quotes and orders too, or become price lists. Only
  the per-user warehouse default is new.
- F7 adds: exchange rates on invoices, credit notes, bills and payments, before posting.
- F9: move CRM events to services using the existing `stage_inventory_event` pattern.

---

# Part 2 — Full review register (2026-10-03)

A second pass over the whole product, from four roles: QA engineer, code reviewer,
code-quality inspector, and end user measured against Salesforce, HubSpot, Dynamics, Zoho
and Odoo. It covers about 168,000 lines (84k backend, 84k frontend) and uses scripted
sweeps plus a reading of the hot spots:
- duplication;
- tenant scoping;
- permissions;
- queries in loops;
- dead code;
- type hygiene;
- error handling;
- about 50 feature probes.

No browser was connected, so the end-user pass traced the journeys through the UI and API
code instead of clicking through them. A hands-on pass is still owed before UAT (§G).

Each ID is used in `13-final-fixes.md`. Severity:
- **H**: wrong data, a security gap, or a blocker for real use;
- **M**: users will notice, or it costs effort on every later change;
- **L**: polish.

## A. Bugs and wrong behaviour

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| A1 | H | **Account CSV import matches names across all tenants.** If another tenant has the name, the import reports a duplicate, which reveals that name exists. Under *skip* or *overwrite* the row is never created. (Writes stay tenant-scoped, so no other tenant's data changes.) Contacts, leads and the other importers filter by tenant correctly | `organizations_services.py:491–524` |
| A2 | H | Tenant restore writes parent rows only: orders come back without lines, deals without participants or pipeline | `tenant_restore_runs.py:490`, `:657` |
| A3 | H | **A website order can be invoiced twice.** *Create invoice* on a website order makes an invoice with no link to the sales order the same order may already have, so order invoicing can bill it again. That invoice also ignores the invoicing policy, forces tax to 0, records the shop platform as the payment method, and hardcodes an accent colour | `website_integration_services.py` `create_pos_invoice_for_order` |
| A4 | H | **The deal amount is text** (`total_cost_of_project`). Sorting and filtering by amount compare text ("2" sorts above "150000"); only the pipeline totals parse it. `annual_revenue`, `total_leads` and `cpl` are text too | `sales/models.py`, `opportunities_repository.py:94`, `:195` |
| A5 | M | Lists and their exports build separate queries with separate filter maps (account list: repository; account export: service `_build_organization_query`), so an export can differ from the screen. The same pattern shows up in the other duplicated modules (E1) | `organizations_repository.py:36`, `organizations_services.py:157`, `:702` |
| A6 | M | Line totals on screen use JavaScript floats with no per-line rounding; the server rounds each line to the cent with `ROUND_HALF_UP`. Previews can differ from saved totals by a cent | `TransactionLineItemsEditor.tsx:40–42`, `document_amounts.py` |
| A7 | M | Quotes never expire. `expiry_date` is stored, but nothing sets *expired*, so the `quote.expired` trigger fires only on a manual status change | `automation_registry.py:140`; no scan in the beat schedule |
| A8 | M | Business dates use the server's date: invoice dates, due dates, overdue scans, receipts, deliveries, bills (15 places `date.today()`). Document numbers use the UTC date. There is no company timezone, only a user one | `numbering.py`, `overdue_scans.py`, `user_management/models.py:270` |
| A9 | M | Leads and contacts cannot exist without an email (`primary_email` NOT NULL), so a phone-only lead, a walk-in, or a contact known by phone cannot be saved | `sales/models.py` |
| A10 | — | **Withdrawn by the hands-on pass.** `RecordTable` cells are real links (`RecordTable.tsx:476`), so Ctrl-click and copy link work. The real defect is H9 | — |
| A11 | M | The account export filters `annual_revenue` as text (follows from A4) | `organizations_repository.py` field map |
| A12 | L | Lead conversion says "Opportunity" where the rest of the app says "Deal" | `LeadConversionForm.tsx` |
| A13 | L | The unsaved-changes guard and the views page use the browser's `window.confirm` instead of the app's dialog | `useUnsavedChangesGuard.ts:23`, `views/[moduleKey]/page.tsx:96` |

## B. Security and access

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| B1 | H | **Client-portal admin routes never check the `client_portal` module.** Creating portal accounts, setup links, pages and publish links needs only edit on the linked contact or account. A tenant cannot keep the portal from a role | `client_portal_routes.py:385–559` |
| B2 | H | **No security headers anywhere**: CSP, `frame-ancestors`/X-Frame-Options, HSTS, `nosniff`, Referrer-Policy | `next.config.ts`, `main.py`, `proxy.ts` |
| B3 | H | **No forgot-password flow, and users cannot change their own password.** Profile has MFA only. A user who forgets a password needs an admin | `signin.py` routes, `profile/page.tsx` |
| B4 | H | Creating a user emails nothing. The admin is handed a setup link to copy. The workspace sender (`send_system_message`) exists, but only report schedules use it | `admin_users.py`, `tenant_mail.py` |
| B5 | M | 21 LIKE searches build `%{value}%` without the shared escape helper (`core/like_patterns.py`), so typing `%` or `_` matches everything | `report_catalog.py` (17), `purchasing_routes.py`, `payment_services.py`, `module_reports.py`, `report_dashboards.py` |
| B6 | M | Permission checks come in five styles: `require_action_access` dependencies, `_allowed` (catalog), `_can` (purchasing), `PermissionPolicy` (inventory), and inline checks. Each new module copies a different one | `item_routes.py:30`, `purchasing_routes.py:90`, `inventory_routes.py:50` |
| B7 | M | Website-integration routes use `require_admin`, not module permissions (10 routes) | `website_integration_routes.py` |
| B8 | M | No list of active sessions with revoke, no IP allowlist, no personal API tokens | probes: none found |
| B9 | M | No data-subject export or erasure for a contact (privacy law requests) | probes: none found |
| B10 | L | `/auth/dev/login` depends on `DEBUG=false` in production. It belongs on the production checklist | `signin.py:483` |

## C. Data model — where Lynk differs from the major players

| ID | Sev | Finding | Major players |
|---|---|---|---|
| C1 | H | **The deal is shaped for a media or lead-generation agency**: `total_leads`, `cpl`, `domain_cap`, `tactics`, `target_audience`, `target_geography`, `delivery_format`, `campaign_type`, an `attachments` text column, a required free-text `client` beside the Account link, and no numeric amount (A4) | Amount (currency), close date, stage, probability, type, source, next step, lost reason, account, primary contact. Industry fields are custom fields |
| C2 | H | Addresses and phones are thin. Accounts have a billing address only. Contacts have one phone, no mobile and no address. Orders have one free-text delivery address and no billing address. Invoices have one text address | Billing and shipping on the account, addresses per contact, multiple delivery addresses (Odoo child addresses), structured addresses copied onto documents |
| C3 | M | Quotes and orders have no customer PO reference, no shipping method and no delivery charge. (Quotes do have *Terms and notes* and an expiry date, as the hands-on pass showed.) | All five have them |
| C4 | M | Products: one price named `public_unit_price` serves as both the website price and the list price; one image; one vendor (`preferred_vendor_id`); no weight or dimensions; no tax category; no variants | A list price separate from the web price, several images, vendor price lists, tax category, weight; variants in Odoo, Zoho and Business Central |
| C5 | M | Website orders are a separate entity (`website_integration_orders` with their own lines), parallel to sales orders. Client-portal orders are sales orders. That makes two order models | A web order is a sales order with a source and channel |
| C6 | M | Naming differs across tables: keys (`quote_id`, `org_id`, `contact_id`, `lead_id`, `opportunity_id` against `id`), timestamps (`created_time` against `created_at`), owner (`assigned_to` against `owner_id`), totals (`subtotal_amount`/`total_amount` against `subtotal`/`grand_total`) | One convention |
| C7 | M | No credit limit on customers, and no negative-stock policy (stock below zero is always refused) | Both are settings in Odoo, Zoho and Business Central |
| C8 | M | Customer-group discounts apply in the portal only (as Part 1 F6) | One price everywhere |

## D. Missing features — the small things and the big ones

| ID | Sev | Missing | Notes |
|---|---|---|---|
| D1 | M | **Clone or duplicate** a record: lead, contact, account, deal, quote, order, product, PO | Salesforce *Clone*, Odoo *Duplicate*, Zoho *Clone*. Only automation rules and views can be duplicated today |
| D2 | M | **Inline edit in list cells** | HubSpot, Salesforce and Zoho edit a cell in place |
| D3 | M | **Recently viewed and favourite records** (sidebar or command palette) | All five |
| D4 | M | **Follow a record** to get its notifications. @mentions in comments exist | Salesforce *Follow*, Odoo followers |
| D5 | M | **List totals row** (sum of amount) and **resizable columns** | Salesforce, Zoho, Odoo |
| D6 | M | **Automation actions**: only create task, notify, recalculate lead score, add note, convert lead, convert quote, assign case. Missing send email, update field, assign owner (round robin), call webhook, wait/delay, create record | Every workflow tool has these |
| D7 | M | **Email notifications**: notifications are in-app only. No email copy, digest or per-user preferences | All five |
| D8 | M | **Lead capture**: no web-to-lead form or public lead endpoint (the public API covers catalog and orders only); no assignment rules | Salesforce web-to-lead, HubSpot forms, Zoho webforms |
| D9 | M | **Email tracking and scheduling**: no open or click tracking, no scheduled send. Signatures exist | HubSpot, Salesforce, Zoho |
| D10 | M | **Line editor**: discount as an amount only (no %); no section or note lines; no optional lines; no line reorder or duplicate; no unit column; no quote revisions | All five |
| D11 | M | **Receivables**: no recurring invoices, no payment reminders, no customer statements, no write-off of a small balance | Zoho Books, Xero, QuickBooks, Odoo |
| D12 | M | **Purchasing**: no RFQ, no vendor credit (debit note), no return to vendor, no *Send PO to vendor* (also F5) | Odoo, Zoho, Business Central |
| D13 | M | **User offboarding**: deactivating a user does not reassign their records, tasks or open documents | Salesforce mass transfer, HubSpot reassign on deactivate |
| D14 | M | **Calendar and board views** of any record (tasks and orders by date; a board for any picklist). Only deals have a board | Zoho, Odoo, HubSpot |
| D15 | L | Keyboard shortcuts beyond the command palette (new record, save, next and previous record) | Salesforce, Odoo |
| D16 | L | A setup checklist for new tenants (company, users, catalog, opening stock, email sender) | HubSpot, Zoho onboarding |
| D17 | L | Languages other than English (no i18n layer) | All five. An owner decision |

## E. Code quality and refactoring

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| E1 | M | **List queries are written twice**, once in the repository and once in the service, for accounts, deals, admin users, invoices, documents, leads and contacts (A5) | Duplication scan: 6–11 matching blocks per pair |
| E2 | M | **Products and services are two copies** of the same routes, services and repositories (about 1,350 lines; the route files differ in 58 lines after renaming) | `catalog/routes|services|repositories` |
| E3 | M | CRM routes repeat the same import, export and cursor endpoint blocks in contacts, leads, deals, accounts (and insertion orders) | Duplication scan, `sales/routes/*` |
| E4 | M | Five permission idioms (B6) | |
| E5 | H | **Services commit their own transactions** (341 `db.commit()` in services, 60 in routes). Composite flows cannot be atomic, and accounting posting (F7) needs one unit of work per business action | `grep db.commit` |
| E6 | M | Activity logging and events commit separately after the business commit (`log_activity(commit=True)` by default). An audit entry can be lost, and each request makes extra round trips | `activity_logs.py` |
| E7 | M | **Frontend duplicates:** custom-module create and edit pages (47 matching blocks); contact, account and deal detail pages; `MatrixTable` and `RecordTable`; four `*QuickCreateLayoutFields`; the print pages; the ERP list pages (copy-paste of one another) | Duplication scan |
| E8 | M | **Two line-editor families.** Quotes, orders and invoices use `TransactionLineItemsEditor`. POs, bills, adjustments and transfers each have their own, so keyboard behaviour, pickers and validation differ | `components/purchasing/*`, `InventoryDocumentPage.tsx` |
| E9 | M | 22 files fetch with `apiFetch` inside `useEffect`, bypassing React Query's cache, deduplication and invalidation | List in the session notes |
| E10 | L | Layering differs by module: sales has repositories; orders, inventory, purchasing and finance query in services | |
| E11 | L | Dense one-line functions of 300–400 characters (money helpers in the line editor) | `TransactionLineItemsEditor.tsx:37–44` |
| E12 | L | Dead code: 7 unreferenced backend functions (two are IO parsers), 15 unused frontend exports | Dead-code scan |
| E13 | L | `next.config.ts` has a placeholder image host (`your-api-or-cdn-domain.com`) and allows only `http://localhost:8000`, so production API images fail through `next/image` | `next.config.ts` |
| E14 | L | FastAPI's deprecated `@app.on_event("startup")` | `main.py:20` |

**What is healthy:**
- Frontend type hygiene: one `any` and eight lint suppressions in 84k lines.
- Almost no unreferenced code.
- Stock posting locks product rows.
- Document numbering is an atomic upsert.
- Imports have column mapping.
- Receipts default to the quantities still due.
- Deliveries record carrier and tracking.
- Every dashboard route sits under an error boundary.

## F. Production readiness

| ID | Sev | Finding |
|---|---|---|
| F1 | H | No error tracking (no Sentry or equivalent) in the backend, the Celery workers or the frontend. A production 500 is visible only in container logs |
| F2 | M | No structured logging or request ids; 19 `getLogger` uses, no configuration |
| F3 | M | `/health` returns `ok` without touching PostgreSQL, Redis or Celery, so the healthcheck cannot catch a broken dependency |
| F4 | M | No global exception handler, so unexpected errors return FastAPI's default body |
| F5 | L | No root `global-error.tsx`, so a crash in the root layout shows Next's default page |
| F6 | M | Nothing monitors the Celery queue or beat, although overdue scans, backups, report emails and recycle purges depend on them |

## G. Tests and verification owed

| ID | Finding |
|---|---|
| G1 | No test restores child rows or runs a backup→restore round trip (A2) |
| G2 | No cross-tenant import test (A1 would have been caught) |
| G3 | No test that a list's export returns the rows the list shows (A5) |
| G4 | No query-count tests on list endpoints. N+1 risk is in serializers (283 relationships, 68 with an explicit `lazy=`); direct queries in loops are rare (19 functions, mostly imports and posting) |
| G5 | **The hands-on end-user pass is still owed.** With a browser connected: every journey in Part 1 at desktop and 390px, both themes, keyboard only once |

---

# Part 3 — Hands-on pass (2026-10-03)

This settles G5. The pass ran in Chrome against the dev stack (backend 1 CPU / 2 GB,
frontend 2 CPU / 6 GB, the shared remote dev database), signed in as the seeded admin. It
used desktop width (1440), phone width (390), both themes and the command palette.

**Journeys, end to end:**
- lead → quick create → convert → deal → edit;
- quote → proposal → accept → order → invoice → part payment;
- PO → place → part receipt → bill with a price difference;
- product stock and valuation.

**Page sweep, with console and network checked:**
- every Sales, Catalog, Inventory, Purchasing and Finance list;
- Calendar, Mail, Documents, Tasks, Reports, Client portal, Support, custom modules;
- 15 Settings pages.

**Test data it created in the dev database** (all named "QA"):
- lead 6;
- contact 33 and account 29 (QA Test Co);
- deal 22;
- Q-20261003-0001;
- SO-20261003-0001;
- INV-20261003-0001 with PAY-20261003-0001 (500.00);
- PO-20261003-0001;
- RCV-20261003-0001: 3 × CRM Pro License into Main;
- BILL-20261003-0001: unit cost 21, which revalued stock by +3.00;
- one note on deal 22.

The receipt and the bill changed CRM Pro License's stock and average cost.

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| H1 | H | **A deal with any empty optional field cannot be edited.** The form spreads the record over its defaults, so null fields stay null, and the payload builder's `trim(null)` throws before any request is sent. The catch then shows "The deal could not be updated. Check the fields and try again." Every deal made by lead conversion is affected | `OpportunityRecordFormPage.tsx:107` (`...opportunity`), `opportunityMutation.ts:46–55`; reproduced on deal 22 |
| H2 | H | **Server errors are swallowed.** Lead quick create showed nothing on a 422. The deal form replaces every error with one generic line. The bill form puts the vendor-invoice error in the footer, away from the field. No form maps the server's field errors onto its fields | Lead POST 422 (`.test` email); `OpportunityRecordFormPage.tsx:158`; bill new |
| H3 | H | **The realtime stream can stall the whole backend.** `realtime_stream` is `async` but runs synchronous SQLAlchemy queries every 2 seconds per open tab, blocking the event loop. Its `require_user` dependency keeps a session *idle in transaction* for the stream's whole life. The pool is 10 + 20 per process, so about 30 open tabs exhaust it. On a database that drops connections, the backend froze until restarted (seen four times) | `core/realtime.py:163–181`, `routes/realtime.py:12`, `pg_stat_activity` (4 × idle in transaction) |
| H4 | H | All 17 backend dependencies are unpinned, so each production build can pull new majors of FastAPI, SQLAlchemy or Pydantic. `python-jose` is unmaintained, with known CVEs | `backend/requirements.txt` |
| H5 | H | **Money in different currencies is added together.** The dashboard shows "Pipeline value $1,995,000" from LKR deals. The board's *Qualified* total is "435K" = USD 250,000 + LKR 185,000 | Dashboard, Deals summary strip and board |
| H6 | H | **The catalog is locked to one currency.** The catalog picker shows only items in the document's currency, and the company offers USD only while every product is priced in LKR. So no catalog item can go on a quote or order in this tenant, and fulfilment cannot be exercised | Quote line search: "No active USD products or services match" |
| H7 | H | **The customer's proposal page:** plain text with the internal status ("Status: draft"); line maths with the discount folded in ("3.0000 × USD 333.33 = USD 989.99"); Lynk branding instead of the company's; download is a `.txt`; **no Accept or Decline** | `/public/quotes/proposal/[token]` |
| H8 | M | **A partly costed product shows a misleading average.** 80 uncosted units plus 3 received at 21 gives an average of 0.759 and a value of 63. The product also drops out of *Cost missing*, so nothing prompts a *Revalue* | CRM Pro License Stock tab, Valuation |
| H9 | M | A column that renders its own `<Link>` inside `RecordTable`'s link cell produces `<a>` inside `<a>`, a hydration error | `OrderInvoicingPanel.tsx:102`, `RecordTable.tsx:478` |
| H10 | M | Controlled and uncontrolled input warnings on the deal form, from the same null values as H1 | Console, `/sales/opportunities/22/edit` |
| H11 | M | **Lead conversion:** the switches' *on* state is invisible in dark mode (thumb and track are both white). *Create opportunity* defaults to off and asks for no amount or close date. The page after converting reads like an error ("This lead has already been converted") and does not link the records it made. The new deal's timeline is empty: no "created" or "converted from lead" entry | `LeadConversionForm.tsx`, `/leads/6/convert` |
| H12 | M | **Timeline:** a note added says "Note added" but the timeline stays empty until reload. The @mention list does not filter on the typed text ("@Ama" lists every user) | Deal 22 Timeline |
| H13 | M | **Deal page:** no *Create quote* or *Create order*; the Quotes card has no *New*; no *Mark won / lost*. The amount is "Project cost" on the list, "Deal value" on the record, shown unformatted ("430000"). Currency and probability start empty (probability is not taken from the stage). *Contact* is required | Deals list, deal 22, edit form |
| H14 | M | **Quote form:** *Customer name* takes the contact's name, not the account's. The account and contact pickers look empty after the deal fills them. Issue and expiry dates are not defaulted. An expiry before the issue date is accepted. "10%" in Discount silently becomes 10.00. An expired quote can be accepted. The proposal shows *Sent* but the quote stays *Draft*. A converted quote can still be edited, and converting does not open the order | Q-20261003-0001 |
| H15 | M | **The line editor at 1440 px:** the Item column is cut to "Search the catal", and Tax, the line total and remove fall off the right | Quote new |
| H16 | M | **Invoice:**<ul><li>the same lines show subtotal 999.99 / discount 10 on the quote and order, but 989.99 / 0.00 on the invoice;</li><li>the print view says "POS Invoice", hides the discount, and bills the contact's email instead of the account's address;</li><li>the sidebar says "POS" while the page says "Invoices";</li><li>there is no *Send*</li></ul> | INV-20261003-0001, its print view |
| H17 | M | Images with a missing file (company logo, avatar) show a broken image with no fallback | Invoice print, header |
| H18 | M | **PO:**<ul><li>lines can only be tracked products (no services, no non-stock items) and have no tax or discount;</li><li>unit cost is not defaulted from the product's cost or vendor;</li><li>the vendor picker shows nothing on focus;</li><li>the PO page has no number heading, no *Create bill*, no list of its receipts and bills, no history, and no *Email to vendor*</li></ul> | PO-20261003-0001 |
| H19 | M | **Receipt and bill:** the receipt takes two steps (save, then post) where the bill has *Save and post*. The vendor invoice number is required but not marked. A price difference is reported only after posting. The posted bill does not show the vendor invoice number | RCV/BILL-20261003-0001 |
| H20 | M | **Stock list:**<ul><li>one row per product per warehouse (222 rows), zero rows included;</li><li>it lists warehouses that Settings → Warehouses no longer shows (removed test warehouses);</li><li>no product totals</li></ul> | `/inventory/stock` vs `/settings/warehouses` |
| H21 | M | Product list: quantities with four decimals ("83.0000 units"). The Products and Services lists toggle *Active* live in the row, so one click deactivates a product | `/catalog/products`, `/catalog/services` |
| H22 | M | **Movements:**<ul><li>the Quantity column is off-screen at 1440 px;</li><li>the document column shows internal ids ("Receipt #9", "Adjustment #15") instead of numbers;</li><li>Previous and Next only.</li></ul>**Adjustments:** no search; *Reason* is free text, not reason codes | `/inventory/movements`, `/inventory/adjustments` |
| H23 | M | A request that never returns leaves skeletons on screen next to "Showing 0 – 0 of 0", with no timeout or error state | Deliveries, Returns, Documents, Settings pages during database drops |
| H24 | M | **Lists:**<ul><li>the lead list's Name column shows the first name only;</li><li>converted leads stay in the default view;</li><li>default columns leave out email and phone (leads) and stage, account and owner (deals);</li><li>saved-view names can repeat (Contacts "new view" twice, Users "Default view" twice);</li><li>URL state is ignored (`?view=pipeline` on Deals, `?search=` on Valuation)</li></ul> | |
| H25 | M | **Forms:**<ul><li>dates use the browser's `mm/dd/yyyy`, not the company's format;</li><li>a section whose fields are all disabled still renders, empty ("Campaign and delivery");</li><li>lead quick create has no *Source*</li></ul> | Deal edit, lead quick create |
| H26 | M | **Settings:**<ul><li>Permissions labels modules by raw key (`sales_contacts`);</li><li>Fields offers modules that cannot take custom fields (Products, Invoices, Stock), with *Create field* greyed out and no reason given;</li><li>Backups shows "Next run Oct 2" as enabled on Oct 3 with no overdue warning (beat was not running)</li></ul> | `/settings/permissions`, `/settings/fields`, `/settings/backups` |
| H27 | M | **Navigation:** in a tenant whose sidebar was customised, every module added later (13 ERP pages) lands in "Other", unordered. Tasks and Documents are missing from the sidebar | Sidebar |
| H28 | M | Calendar has a month view only: no day, week or agenda | `/calendar` |
| H29 | M | **E2E runs write into the shared dev database:** hundreds of "E2/E3/E4/E5 … 1790…" products, warehouses, vendors and documents. Every picker and list is full of them. UAT needs its own database, and e2e needs a disposable one | Vendor picker, Stock, Payments |
| H30 | L | **Smaller items:**<ul><li>each record-tab switch requests the route twice;</li><li>on a phone the order page shows the whole state rail before the content;</li><li>custom-module forms are titled "New testing new custom module record" (no singular name) and their list alone has a row delete icon;</li><li>conversion copies the person's email onto the account;</li><li>Next.js 16.2.6 reports itself stale</li></ul> | |

**What worked well:**
- the quick-create drawer;
- lead and record page layout;
- the Pipeline board, with drag and a keyboard stage menu;
- order invoicing (ordered, delivered, invoiced and to-invoice quantities per line);
- part payments;
- the receipt and place-order confirmations, which say exactly what will happen;
- bill matching against PO cost, with the stock-value effect stated;
- the report template library;
- the command palette across modules;
- the light theme;
- the pipeline settings.

**Environment notes (not product defects):** the remote dev database dropped connections
repeatedly (16 in two minutes at worst), and uploaded files are not present on this machine.
Both made some pages slow or broken here. H3 is why those drops froze the whole backend.

---

# Part 4 — Hands-on pass, remaining flows (2026-10-03)

Run with the Celery worker and beat started too, all four containers capped.

**Verified working:**
- delivery (partial shipment, carrier and tracking, post) and return (one unit,
  restocked);
- credit note from an invoice: pro-rated to 330.00 for 1 of 3 units with the line discount;
  the invoice balance went to 159.99 (total 989.99, paid 500, credited 330);
- automation rule "Lead created → create task": the worker ran it in 0.33 s, recorded the
  run as succeeded, and created the task with the merge field filled;
- report built from scratch (Deals, grouped by client, sum of amount), saved, with CSV,
  Excel, chart export and scheduled email;
- module builder: a single-select field added to a custom module appears in the runtime
  form, and a record saves with it;
- client portal: setup link, password set, sign-in, quotes list, catalog, item request.

**Not verified: sending email.** The signed-in admin has no mailbox connected
(`/mail/context` returns no connections). The Gmail and OneDrive "connected" on
Integrations belong to another user. The workspace SMTP sender is empty. Sending needs the
owner to sign in to Google (OAuth) as this user, or to enter SMTP credentials, and neither
can be done for them.

**More test data:**
- DEL-20261003-0001 (2 units from E6-M-1790981694430);
- RET-20261003-0001 (1 restocked);
- CN-20261003-0001 (330.00 on INV-20261003-0001);
- automation rule 1 "QA test: task on new lead", left **disabled**;
- lead 7 and task 67;
- report 2;
- field `qa_priority` on testing module 2, plus one record;
- a client-portal account for qa.walkthrough@example.com;
- a portal request for 2 × CRM Pro License (LKR 70,000).

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| I1 | **H** | **Tenant backups have failed since E5.** The finance backup set filters `FinancePosInvoiceLine` by `tenant_id`, a column it does not have, so every run fails: "type object 'FinancePosInvoiceLine' has no attribute 'tenant_id'". The last success was 2026-10-01; the first scheduled run after beat restarted failed. Invoice lines are also the only document line table without `tenant_id` | `tenant_backup_runs` row 36; `finance/models.py` `FinancePosInvoiceLine` |
| I2 | M | While a session refreshes, every dashboard card says "Reports access is required" and the sidebar is empty. A deep link (`/sales/orders`) lands on `/dashboard` instead of the page asked for | First load after the access token expired |
| I3 | M | *Create credit note* is offered on a return whose goods were never invoiced. It opens a page saying there is nothing to credit, with no way back. The button should be disabled with that reason | RET-20261003-0001 |
| I4 | L | **Delivery and fulfilment polish:**<ul><li>the new-delivery form says "Order 41" (the internal id) until saved;</li><li>"Fulfillment" and "Fulfilment" on the same page;</li><li>the Reallocate column is clipped;</li><li>the tracking number is not a link to the carrier</li></ul> | Order 41, DEL-20261003-0001 |
| I5 | M | **Automation builder:**<ul><li>placeholders look like filled values (task title, rule name), so *Done editing* silently refuses with no message;</li><li>the default trigger is "Booking created";</li><li>41 triggers in one flat list, with no search or grouping;</li><li>both "Invoice overdue" (the insertion-order event) and "Invoice past due" are offered;</li><li>"Opportunity created" next to "Deal assigned";</li><li>after *Enable*, "Unsaved changes" stays shown</li></ul> | `/settings/automation` |
| I6 | M | With the worker down, events queue for hours. On restart the worker ran a 28-hour backlog, so automations fired a day late. Nothing alerts on a stopped worker (F6 in Part 2) | Worker log on start |
| I7 | M | **Reports:**<ul><li>no *Orders* source (only "Order lines to deliver"), so there is no revenue by month or orders by customer;</li><li>sources in one flat list;</li><li>the default source is Deliveries;</li><li>the deal amount gets a fourth name ("Amount");</li><li>the deal sum adds currencies (H5, "$2,860,000");</li><li>the report viewer shows no name heading</li></ul> | `/reports/new`, `/reports/2` |
| I8 | L | Module builder field types are raw keys ("textarea", "single select"); select options are plain lines with no key or colour. The custom record form still says "Unsaved changes" after *Create* | Module builder |
| I9 | M | **Client portal:**<ul><li>the client gets no invite email (the admin copies the link, as B4);</li><li>setup copy says "sign in from any shared client page";</li><li>no forgot password;</li><li>*Orders* lists only portal requests, not the account's sales orders (SO-20261003-0001 is missing);</li><li>no invoices or payments section;</li><li>submitting a request shows no confirmation and gives a random reference ("portal-20-sl5x8x52p-4");</li><li>the top bar shows no client name or account menu;</li><li>"Pricing is resolved from your account context"</li></ul> | `/client/*` |
| I10 | M | **Mail:** Integrations shows another user's Gmail as *connected* to an admin who has no mailbox, so mail looks set up when it is not. Compose then says "No sending mailbox available" | `/settings/integrations`, `/mail/compose` |
