# 13e — ERP settings, price lists and approvals (Final fixes F6)

Plan for §7 Step 7 item 3 of `13-final-fixes.md` (F6). Research and plan only: no code has
changed. Written 2026-10-09 after F5 was built. Like F4 and F5, F6 is built in slices with no
test runs in between; the one test pass for F4 + F5 + F6 follows it (13 §6).

## 1. Where things stand (inspected 2026-10-09)

| F6 item | State in the code | Left to do |
|---|---|---|
| F6.0 Date format (H25) | No company date format. Dates print through `formatDateOnly` with a fixed `en-US` style; 11 screens and `FieldControl` use the browser's native `<input type="date">`, which shows the browser's own order (`mm/dd/yyyy`). Empty form sections are already skipped (`ResolvedRecordLayout.tsx:63`), so that half of H25 is done | A company date format; one `DateInput` primitive |
| F6.1 Numbering | `allocate_business_number` (`platform/services/numbering.py`): `PREFIX-YYYYMMDD-NNNN`, prefix fixed in code (Q, SO, INV, CN, PAY, PO, RCV, BILL, VC, VRT, DEL, RET, ADJ, TRF, REV), counter per tenant + scope + **UTC day** in `crm_number_counters` | Per-type prefix, date part, padding and next number; the company's day, not UTC's |
| F6.2 Units | `unit` is already a managed picklist with a default (13b), used by products, services and every line (13d §3.2) | Unit conversion only: buy in boxes, stock in units |
| F6.3 Payment terms | `company_profiles.default_payment_terms_days`, `sales_organizations.payment_terms_days` (also used for vendors), free-text `payment_terms` on invoices and bills; `invoice_balances.default_due_date` adds days | Named terms (Net N, end of month + N, due on receipt) |
| F6.4 Warehouse defaults | Company default (`is_default`) only | A per-user default |
| F6.5 Document defaults | **Done in F5.3**: Settings → Documents holds the title, default terms, notes and email template per type | Nothing; dropped from this plan |
| F6.6 Price lists | None. Products have `list_price` (quotes and orders start from it) and `public_unit_price` (website), in the item's own currency. Customer-group discounts (`customer_groups.discount_type/value`) apply only in the client portal (C8). **H6 is still open**: the line picker filters items to the document's currency (`TransactionLineItemsEditor.tsx:380`, `item_services._search`), so a USD quote cannot pick an LKR-priced product; F0's interim conversion was never built | Price lists that replace both the group discount and the H6 workaround |
| F6.7 Approvals | None. The automation engine (`automation_rules.py`) evaluates conditions (`_condition_matches`) and runs actions **asynchronously** after commit (Celery). Users have no manager link; teams have no lead | Synchronous approval gates on the automation engine's conditions |
| F6.8 Company timezone (A8) | Users have `timezone`; the company has none. **34 calls in 15 files** use the server's date (`date.today()` / `_today()`), most of them added since the audit (F5 receivables, quotes, recurring invoices). Numbers use the UTC date. Beat schedules are UTC | `company_today()` everywhere, numbers and scans in the company's day |
| F6.9 Credit and stock policies (C7) | No credit limit. Negative stock refused in `stock_ledger.post_moves` and by `ck_inventory_level_nonnegative`. Costing (E6) is moving average, computed forward; documents other than orders and POs carry no exchange rate | A credit limit with warn/block; an *allow and flag* negative-stock setting |

## 2. Benchmark

| | Odoo 17–18 | Business Central | NetSuite | Zoho Books / Inventory | ERPNext |
|---|---|---|---|---|---|
| **Price lists** | One pricelist per order; rules: fixed price, % discount, or formula on cost / sales price / another pricelist, with min quantity, rounding, min margin, dates; customer's pricelist, else the first matching, else *Public* | Price lists with assign-to (all customers, customer price group, customer, campaign), currency, dates, quantity breaks, draft/active; **lowest price wins** | Price levels (% off base) per customer, quantity pricing, currency prices per item | Sales and purchase lists: % markup/markdown with rounding, or per-item rates; assigned to the contact, applied automatically; optional per line | Price list per currency (Item Price rows); pricing rules (discounts, qty, customer group) on top |
| **Approvals** | Purchase: *double validation* above an amount, manager approves ("To approve" state). Sales discount/amount approval only as add-ons | Workflows (event → condition → response); approver = specific, direct, chain, first qualified, or salesperson/purchaser's approver; amount limits per user in Approval User Setup; substitutes | Approval routing by amount and role, supervisor hierarchy | Simple, multi-level (up to 10), or custom criteria; sales (quotes, orders, invoices) and purchase (POs, bills); admins are final approvers | Workflow states with role-based transitions |
| **Credit limit** | Partner credit limit; warning (blocking via add-ons) | On the customer; a warning by default; blocking via a credit-limit approval workflow | Credit limit with hold / warning | Setting: **restrict or warn**; checks invoices and optionally sales orders | Limit per customer → group → company; *Credit Controller* role may override; checked on order and invoice |
| **Negative stock** | Allowed, flagged; corrected when stock arrives | Setting *Prevent negative inventory* | Allowed per setting | Allowed by design (pre-orders) | *Allow Negative Stock* in Stock Settings, valuation reposted |
| **Units** | UoM categories and ratios; purchase UoM per product | Base unit, sales and purchase units of measure per item | Units types | Unit groups with conversion rates; default sales and purchase unit per item; prices on the base unit | UOM conversion factors per item |
| **Payment terms** | Lines: days after invoice, after end of month, last day of next month | Due date calculation formula (e.g. `CM+30D`) | Terms list | Net 15/30/45/60, due end of month, due end of next month, due on receipt, custom | Payment term templates |
| **Numbering** | Sequences: prefix with `%(year)s`, padding, next number, counters per date range | Number series: starting no., increment, manual, date order | Auto-numbering per type: prefix, suffix, min digits, initial number | Prefix and next number per transaction type, optional series | Naming series `SINV-.YYYY.-` |
| **Company time** | Dates stored as dates; user tz for display; server-today pitfalls in automatic jobs | Work date | Company time zone + date format in General Preferences; users may override display | Organisation time zone and date format | System settings time zone and date format |

Sources: [Odoo pricelists](https://odoo.com/documentation/17.0/applications/sales/sales/products_prices/prices/pricing.html),
[Odoo 18 pricelists (Cybrosys)](https://www.cybrosys.com/odoo/odoo-books/v18/sales/pricelists/),
[BC special prices](https://learn.microsoft.com/el-gr/dynamics365/business-central/sales-how-record-sales-price-discount-payment-agreements),
[BC approval users](https://learn.microsoft.com/th-th/dynamics365/business-central/across-how-to-set-up-approval-users),
[Zoho Books price lists](https://www.zoho.com/books/help/items/price-list.html),
[Zoho Books approvals](https://www.zoho.com/books/help/transaction-approval/transaction-approval-workflow.html),
[Zoho Books credit limit](https://www.zoho.com/books/help/contacts/credit-limit.html),
[Zoho Inventory units](https://www.zoho.com/inventory/help/settings/uom.html),
[ERPNext credit limit](https://docs.frappe.io/erpnext/user/manual/en/credit-limit),
[Odoo purchase approvals](https://odoo-users.readthedocs.io/en/stable/purchase/purchases/rfq/approvals.html),
[Odoo payment terms](https://www.cybrosys.com/blog/how-to-create-and-use-payment-terms-in-odoo),
[NetSuite company preferences](https://www.anchorgroup.tech/netsuite-general-preferences-company-information).

What Lynk takes from them:
- **Price lists:** Zoho's two kinds (per-item rates, or a % markup/markdown with rounding),
  with BC's currency, dates and quantity breaks, and Odoo's *one list per document* chosen by
  the most specific assignment (account → customer group → company default for the
  currency). Not BC's "lowest price wins": a customer-specific list that is higher on purpose
  would lose to a general promotion.
- **Approvals:** Odoo's *To approve* gate on the transition that commits the document, with
  BC's approver kinds (specific user, role, owner's manager) and Zoho's sales and purchase
  coverage. One level per rule; several matching rules each need their approval.
- **Credit limit:** Zoho's setting (off / warn / block) with ERPNext's override role and its
  exposure (open invoices plus confirmed, uninvoiced orders).
- **Negative stock:** BC's setting, with Odoo's correction when stock arrives.
- **Units:** Zoho's base unit plus a default purchase unit and factor; prices and costs stay
  on the base unit.
- **Numbering, terms, timezone, date format:** what all five have.

## 3. Design

### 3.1 Company timezone and date format (F6.8 A8, F6.0 H25)

- `company_profiles.timezone` (IANA name; default: the first admin's timezone, else `UTC`)
  and `company_profiles.date_format` (`DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`,
  `D MMM YYYY`; default from the company's country, `D MMM YYYY` when unknown). Both on
  Settings → General.
- `app/core/business_dates.py`: `company_today(db, tenant_id)` and `company_now(...)`,
  cached per tenant like the operating currencies. All 34 server-today calls go through it,
  including `quote_is_past_expiry`, overdue flags, recurring runs, reminders, statements,
  receipt / delivery / bill / payment dates and the portal's overdue flag.
- `allocate_business_number` takes the period from the company's day.
- Scheduled scans run hourly and act on each tenant's own day: the quote expiry scan expires
  what is past the tenant's today; payment reminders go out once the tenant's local hour is
  09:00 or later (their once-per-rule-and-invoice row already stops repeats); recurring
  invoices run when the tenant's today reaches `next_run_date`.
- Frontend: `todayIsoDate()` returns the company's today (from `/users/company`) for
  business dates; the user's timezone stays for showing date-times. `formatDateOnly` uses
  the company format.
- **`DateInput` primitive** (`components/ui/DateInput.tsx`): a text field in the company
  format with a calendar popover built on the existing `MonthGrid`; it reads and writes
  `YYYY-MM-DD`. It replaces every `<input type="date">` (11 screens) and the `date` case of
  `FieldControl`. `check-design.sh` gains a rule against raw `type="date"`.

### 3.2 Numbering (F6.1)

- `document_number_settings`: per tenant and scope (each existing scope: quotes, sales orders,
  invoices, credit notes, payments, POs, receipts, bills, vendor credits, vendor returns,
  deliveries, returns, adjustments, transfers, revaluations): `prefix`, `date_part`
  (`none`, `year`, `month`, `day`), `padding` (3–8), `separator` (`-` or `/` or none).
  Defaults reproduce today's `PREFIX-YYYYMMDD-NNNN`.
- The counter period follows the date part (`2026`, `202610`, `20261009`, or `all`), so a
  yearly series restarts each year. *Next number* can be set for the current period, never
  below the highest already used (the unique indexes stay the guard).
- Changes apply to documents numbered from then on. Settings → Documents gains a *Numbers*
  tab with a live example ("Next quote: Q-2026-0042"). F7's journals add their own scopes.

### 3.3 Payment terms (F6.3)

- `payment_terms`: name, `kind` (`net` = N days after the document date, `end_of_month` = N
  days after the end of the document's month, `due_on_receipt`), `days`, `is_default`,
  `active`. Seeded: *Due on receipt*, *Net 15*, *Net 30*, *Net 60*, *End of month*, *End of next
  month* (end of month + 30, clamped to that month's end, as Zoho does).
- `sales_organizations.payment_term_id` (customer terms) and `vendor_payment_term_id`
  (vendor terms) replace `payment_terms_days`; `company_profiles.default_payment_term_id`
  replaces `default_payment_terms_days`. The migration creates a *Net N* term for each day
  count in use and points the rows at it; the day columns are dropped (no users yet).
- Invoices and bills get `payment_term_id`; the free-text `payment_terms` becomes the term's
  printed name (kept as a snapshot when issued). `default_due_date` uses the term; the due
  date stays editable on a draft. Recurring profiles take a term too.
- Settings → Receivables gains the terms list (reorder, default, deactivate; a term in use
  cannot be deleted).

### 3.4 Units and the warehouse default (F6.2, F6.4)

- Products gain `purchase_unit` (from the `unit` picklist) and `purchase_unit_factor`
  (base units in one purchase unit, > 0; default 1). The base `unit` is how stock is counted,
  priced and costed.
- PO lines gain `unit_factor`: a line in the purchase unit has quantity and cost per purchase
  unit (as the vendor quotes it). Receiving converts to base units for stock
  (`quantity × factor`) and cost (`net_unit_cost ÷ factor`); *to receive* and receipts show
  both ("2 boxes = 24 units"). Bills match PO lines in the PO's unit. Existing lines get
  factor 1. Sales lines stay in the base unit (decision 5).
- `users.default_warehouse_id` (Profile → Preferences): new adjustments, transfers (source),
  receipts and deliveries start with it, else the company default.

### 3.5 Price lists (F6.6, H6, C8)

- `price_lists`: name, `currency`, `kind` (`rates` = per-item prices, `percentage` =
  markup/markdown on the item's list price), `percentage`, `rounding` (`none`, `0.01`, `1`,
  `0.99`), `valid_from` / `valid_to`, `is_default` (one per currency), `active`.
- `price_list_items` (for `rates`, or exceptions on a `percentage` list): product or service,
  `unit_price`, `min_quantity` (quantity breaks; the highest break not above the line's
  quantity wins).
- Assignment: `sales_organizations.price_list_id` and `customer_groups.price_list_id`.
- **Resolution** for a sales line, in the document's currency (one list per document,
  shown in the document header and changeable on a draft):
  1. the account's list, if it is in the document's currency;
  2. the account's (or the contact's) customer group's list, same currency;
  3. the company's default list for that currency;
  4. the item's own `list_price` when the item is priced in the document's currency;
  5. otherwise no price: the line starts empty and says "No USD price for this item"
     (decision 4).
- `catalog_search` returns **every** active item with its resolved price for the document's
  currency and account (H6); the picker stops filtering by currency.
- One resolver (`catalog/services/pricing.py`) serves quotes, orders, invoices, the website
  and the client portal (C8). Changing a line's quantity re-resolves quantity breaks on a
  draft; a typed price is kept (the line remembers it was overridden).
- **Customer-group discounts become price lists**: the migration turns each group with a
  discount into a `percentage` list in the company's base currency (`fixed` amount discounts
  become per-item rates), assigns it to the group, and drops `discount_type` /
  `discount_value` (no users yet). The portal shows the same price a quote would.
- Pages: Catalog → *Price lists* (shared list page, form with an items grid and CSV import of
  rates); the account form gets *Price list*; customer groups get *Price list*. Product page
  shows its prices across lists.

### 3.6 Credit limit and negative stock (F6.9, C7)

**Credit limit**
- `sales_organizations.credit_limit` (base currency; empty = none) and company
  `credit_limit_action` (`off` default, `warn`, `block`).
- Exposure = unpaid balances of issued invoices + confirmed orders' uninvoiced value, in the
  base currency: a document in the base currency counts as is; an order or an invoice made
  from an order counts at the order's exchange rate; a foreign-currency invoice with no rate
  is listed as "not counted" (F7 adds rates to invoices and closes this).
- Checked when an order is confirmed (manually, by conversion, from the portal or the
  website) and when an invoice is issued. *Warn*: a confirmation dialog with the figures;
  *Block*: refused unless the user has `finance_pos` *configure* (ERPNext's credit
  controller), who confirms with a reason logged on the document.
- The account page shows limit, exposure and what is left; a report source *Accounts over
  their credit limit*.

**Negative stock**
- Company `negative_stock` (`refuse` default, `allow`). With `allow`, a **delivery** may take
  a tracked product below zero; adjustments, transfers and vendor returns still refuse.
- The shortfall leaves at the current average (or the product's cost price, flagged as
  *fallback*, as E6 does for missing cost). The next receipt into that warehouse first
  settles the negative quantity: the difference between its cost and the cost the shortfall
  left at becomes a `negative_settlement` revaluation to cost of goods sold, so stock value and
  margin end up right.
- `ck_inventory_level_nonnegative` is dropped; the ledger enforces the setting instead.
  Stock and Valuation get a *Below zero* filter and flag; the order fulfilment panel says
  "Shipped 3 more than in stock".

### 3.7 Approvals (F6.7)

Built on the automation engine (13 F6.7): approval rules are automation rules with a
synchronous trigger, evaluated in the service at the moment of commitment, with the engine's
condition fields and evaluator (`_condition_matches`) and its notifications.

- **Triggers (gates):** *Before a quote is sent* (Send / mark Sent), *Before a sales order is
  confirmed*, *Before a purchase order is placed*. The rule's only action is *Require
  approval*.
- **Conditions:** the engine's condition builder, over the document's fields plus derived
  ones: `total_base` (total in the base currency, at the document's rate), `max_line_discount_percent`,
  `discount_percent` (document discount over gross), account, owner, team.
- **Approver:** a specific user, any user with a role, or the owner's manager
  (`users.manager_id`, new, set on the user form; a user without a manager falls back to the
  rule's fallback approver). Approvers need view access to the module.
- **Flow:**
  1. The gated action finds matching rules with no current approval → it creates
     `approval_requests` (rule, document, snapshot of the gated figures, requester, approver
     user or role, status `pending`), notifies the approvers, logs `approval.requested`, and
     answers 409 "Waiting for approval from …". The document shows *Awaiting approval*.
  2. An approver approves or rejects with a note from the document page or the new
     *Approvals* inbox (`/dashboard/approvals`: waiting for me, requested by me).
  3. Approval logs `approval.approved` and notifies the requester, who then performs the
     action (decision 9); rejection logs the note and the document stays a draft.
  4. Editing a gated figure (lines, prices, discounts, currency) after approval voids the
     approval; the next attempt asks again.
- Events `approval.requested`, `approval.approved`, `approval.rejected` on the automation bus,
  so ordinary rules can react (e.g. email the approver once F12 adds email actions).

### 3.8 Permissions, events, backup

- Settings pages (date and time, numbering, terms, credit and stock policies, approvals) are
  admin; price lists are a catalog module with its own actions (`catalog_price_lists`, new seed
  module); approving needs the approver match plus view on the document's module.
- Backup and restore: numbering settings, payment terms, price lists and items, approval
  rules and requests; company columns already travel with the company profile.
- Recycle bin: price lists.

### 3.9 Migrations (chain after `20261021_client_portal`)

| Revision | Content |
|---|---|
| `20261022_company_dates` | company `timezone`, `date_format` |
| `20261023_numbering` | `document_number_settings`; counter period widened for `all` |
| `20261024_payment_terms` | `payment_terms`, term ids on accounts / company / invoices / bills / recurring profiles; *Net N* backfill; day columns dropped |
| `20261025_units_warehouses` | product `purchase_unit`, `purchase_unit_factor`; PO line `unit_factor`; `users.default_warehouse_id` |
| `20261026_price_lists` | `price_lists`, `price_list_items`, list ids on accounts and customer groups; group discounts converted and dropped |
| `20261027_credit_stock` | account `credit_limit`; company `credit_limit_action`, `negative_stock`; drop `ck_inventory_level_nonnegative`; revaluation kind `negative_settlement` |
| `20261028_approvals` | `users.manager_id`; automation rule gate triggers; `approval_requests` |

All IDs ≤ 32 characters; new Boolean columns get a Python `default=` too.

## 4. Slices (built in order; no test runs until after F6)

1. **6.1 Company dates:** timezone, date format, `company_today`, the 34 call sites, numbering
   period, hourly per-tenant scans, `DateInput`, design rule. First, because every later slice
   writes dates.
2. **6.2 Numbering.**
3. **6.3 Payment terms.**
4. **6.4 Units and warehouse default.**
5. **6.5 Price lists** (H6, C8).
6. **6.6 Credit limit and negative stock.**
7. **6.7 Approvals.**

Tests written per slice and run in the shared pass: `test_company_dates.py` (company today
across a date line, numbering period, scans per tenant), `test_numbering.py`,
`test_payment_terms.py` (end of month clamps, migration), `test_units.py` (receipt
conversion and cost), `test_price_lists.py` (resolution order, breaks, rounding, currency, portal
equals quote), `test_credit_limit.py`, `test_negative_stock.py` (settlement revaluation),
`test_approvals.py` (gate, approve, reject, void on edit, manager fallback).
E2e: `price-lists.spec.ts`, `approvals.spec.ts`; the line-editor specs updated for the
unfiltered picker; new pages into both guard route lists.

## 5. Decisions (recommendations; for the owner)

1. **Company timezone drives business dates; the user's timezone only shows times.** The
   alternative, each user's own today, gives two users different due dates for the same
   invoice.
2. **One `DateInput` primitive replaces the native date input.** A native input cannot show
   the company format; the primitive is the only way H25 holds everywhere.
3. **Numbering restarts per period by the chosen date part, and the default keeps today's
   format.** The alternative (one ever-increasing counter) is available by choosing *no date
   part*.
4. **An item with no price in the document's currency is offered with an empty price**, not
   converted at an exchange rate (H6's interim idea). Conversion hides a pricing decision in
   a rate; a price list in that currency is the deliberate fix, and the empty line says so.
5. **Unit conversion on purchases only** (buy in boxes, stock and sell in units). Sales units
   (sell by the dozen) can follow the same factor model later.
6. **One price list per document, most specific first** (account → group → company default),
   not BC's lowest price.
7. **Customer-group discounts become price lists and the discount columns are removed** (no
   users yet), so the portal and quotes cannot disagree.
8. **Credit limit is off by default; when on, it is checked at order confirmation and invoice
   issue, in the base currency**, and a finance administrator may override a block with a
   reason.
9. **Approval unlocks; the requester completes the action.** Approving does not send the quote
   or place the PO by itself, because sending needs the composer and placing may need a final
   check. (Odoo and Zoho move the document on approval; the alternative is noted.)
10. **One approval level per rule; several matching rules each need their approval.** Multi-level
    chains (Zoho's 10 levels, BC's approver chain) are a later addition.
11. **Negative stock stays refused by default; *allow* covers deliveries only**, settled with a
    revaluation when stock arrives.
12. **Approval rules live in the automation engine** (synchronous gate triggers with a
    *Require approval* action) rather than a separate approvals engine, as 13 F6.7 says.

## 6. Out of scope

- Purchase price lists (vendor price lists): the PO cost default already uses the last bill
  price from the vendor (F4); vendor lists can follow.
- Sales units of measure (decision 5), pricing formulas on cost or on another list, minimum
  margins (Odoo).
- Multi-level approval chains, approval substitutes and delegation (BC).
- Approvals on invoices, bills and credit notes (Zoho has them; none was asked for).
- Exchange rates on invoices, credit notes, bills and payments: F7's prerequisite.
- Automation actions that email (F12).

## 7. Build notes

(Filled in per slice as it is built.)
