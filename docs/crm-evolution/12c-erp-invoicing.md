# 12c — ERP E5: invoicing and bills

The E5 plan from `12-erp-inventory.md` §2: invoices from orders and deliveries (the roadmap's
"invoice generator"), credit notes, payments as records, and vendor bills from purchase orders
and receipts. Written 2026-10-03 under the owner's ERP rule (benchmark, then plan). No code
changed. **The owner accepted every §5 decision (2026-10-03)** and added a rule: whatever is
deferred must be built so that adding it later is additive, not a rewrite (§5a).

E5 sits on E3 and E4: an order line is invoiced against what was delivered (E3 deliveries and
returns), and a purchase order line is billed against what was received (E4 receipts). It does
not post accounting entries; there is no general ledger (`12-erp-inventory.md` §8).

## 1. Where things stand (inspected 2026-10-03)

**Invoices** are the `finance_pos` module (*Invoices* in the sidebar), table
`finance_pos_invoices` + `finance_pos_invoice_lines`, routes `/finance/pos-invoices`, pages
`/dashboard/finance/pos`. Lines link to the catalog (E1). Totals use a header discount and a
header tax rate. Three templates and a print page. Website orders can create one
(`create_pos_invoice_for_order`, linked by `website_integration_orders.pos_invoice_id`).

What reading the code found:

1. **An invoice is never final.** `PUT /finance/pos-invoices/{id}` rewrites lines, totals,
   `status`, `payment_status` and `amount_paid` on any invoice, issued, paid or void. A paid
   invoice can be set back to unpaid, a void one back to issued, and `payment_status` can say
   *paid* with nothing paid. Only the activity log remembers what it was.
2. **Payments are not records.** `record_invoice_payment` adds to `amount_paid`; there is no
   date, reference or history beyond the activity log, and a payment cannot be undone. The
   *Payments* page is the invoice list with a payment-status filter.
3. **Invoice numbers come from one PostgreSQL sequence shared by every tenant**
   (`finance_pos_invoice_number_seq`, `POS000123`). Each tenant's numbers have gaps, and the
   gaps show other tenants' volume. Every other document already uses the per-tenant
   `allocate_business_number` (`PO-20261003-0001`).
4. **Sales orders cannot be invoiced at all.** Nothing links an order or delivery to an
   invoice; an order shows no invoiced or to-invoice figure.
5. **Two tax models.** Quotes and orders carry a discount and a tax *amount* per line; invoices
   carry a header discount and a header tax *rate*. Nothing in Lynk defines tax rates.
6. **Nothing becomes overdue.** The `invoice.overdue` automation trigger belongs to *insertion
   orders* (`finance_io`), not invoices, and the 08a webhook contract (awaiting approval) names
   it that way. Invoices have a due date that nothing reads.
7. **No vendor bills, credit notes or refunds.** E4 deferred services and expenses to bills.
8. **Gaps:** no report source over invoices or payments; invoices are not in the tenant backup
   set; the client portal shows no invoices; there is no PDF generation (print pages only).

The dev database was not counted (stack down); Phase 1 starts by counting invoices by status,
payment status and `amount_paid > 0`, which sizes the migration.

## 2. Benchmark

Checked 2026-10-03:

- Odoo: [invoicing policy (ordered or delivered)](https://www.odoo.com/documentation/18.0/applications/sales/sales/invoicing/invoicing_policy.html), [invoicing processes](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/overview.html), [payments](https://www.odoo.com/documentation/18.0/applications/finance/accounting/payments.html), [bill control and 3-way matching](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/manage_deals/control_bills.html), [manage vendor bills](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/manage_deals/manage.html).
- Business Central: [correct or cancel a posted sales invoice](https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-correct-cancel-sales-invoice), [combine shipments on one invoice](https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-to-combine-shipments-on-a-single-invoice), [process sales returns](https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-process-sales-returns-cancellations), [amend or cancel unpaid purchase invoices](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-how-correct-cancel-unpaid-purchase-invoices).
- NetSuite: [invoicing sales orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1219162.html), [invoice in advance of fulfillment](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/bridgehead_4438064774.html), [vendor bill variances](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2371184.html), [3-way match approval](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4096219721.html).
- Zoho Inventory / Books: [convert a sales order to an invoice](https://www.zoho.com/us/books/help/sales-order/convert-to-invoice.html), [invoice sales orders partially](https://www.zoho.com/us/books/kb/sales-order/invoice-sales-orders-partially.html), [bills](https://www.zoho.com/us/inventory/help/purchase-orders/bills.html), [converting purchase receives to bills](https://www.zoho.com/us/inventory/kb/bill/receive-bill.html).
- ERPNext: [sales invoice](https://docs.erpnext.com/docs/user/manual/en/sales-invoice), [credit note](https://docs.erpnext.com/docs/user/manual/en/credit-note), [purchase invoice](https://docs.erpnext.com/docs/user/manual/en/purchase-invoice).

| | Odoo | Business Central | NetSuite | Zoho | ERPNext |
|---|---|---|---|---|---|
| **Invoice from** | Sales order (*Create invoice*) | Order, or *Get Shipment Lines* on an invoice | *Bill* on the order, or the *Bill Sales Orders* queue | *Convert to invoice* on the order | Sales order, delivery note or quotation |
| **What is invoiced** | Policy per product: ordered or delivered | Shipped quantity (*Qty. to Invoice*) | Fulfilled; a preference allows invoicing ahead | Any lines; order becomes *Partially invoiced* | Ordered or delivered; *% billed* on the order |
| **Several orders, one invoice** | Yes, from the orders list | Yes, combine shipments | Yes, billing queue | No | Yes, *Get items from* |
| **Once issued** | Posted; reset to draft only if unreconciled | Posted, immutable; *Cancel* / *Correct* post a corrective credit memo | Editable until closed periods | Editable until paid | Submitted, immutable; *Cancel* and amend |
| **Credit** | Credit note (reversal), full or partial | Corrective credit memo, *Get Return Receipt Lines* | Credit memo, from a return authorisation | Credit note from the invoice; credits apply to other invoices | *Return / Credit Note* from the invoice; cannot exceed what was invoiced |
| **Payments** | Payment records; *In payment* → *Paid* | Payment journal, applied entries | Customer payment, applied to invoices | Payments received, one payment over several invoices | Payment entry, allocated to invoices |
| **Vendor bill from** | PO, by bill-control policy (ordered or received) | Purchase invoice, *Get Receipt Lines* | PO or receipt; variance lines | *Convert to bill* on the receive | Purchase order or purchase receipt |
| **Matching** | 3-way: *Should be paid* when received | Qty. to Invoice ≤ received | Quantity and rate tolerances, variance lines, approval workflow | Bill ≤ received (receive first) | Over-billing allowance |
| **Number** | At posting; drafts unnumbered | At posting (posted series) | At save | At save | At submit |

What each does best:

- **Odoo:** one setting answers "invoice what was ordered, or what was delivered?", and a
  product can override it. The same idea on the purchase side (bill control) feeds 3-way
  matching. Numbers are given only when an invoice is posted.
- **Business Central:** a posted invoice never changes. *Cancel* posts a corrective credit memo
  for you; *Correct* cancels and opens a copy to fix. Paid invoices need a manual credit memo.
- **NetSuite:** price and quantity variances between PO, receipt and bill are shown on the bill
  instead of silently accepted.
- **Zoho:** the simplest flow: *Convert to invoice* on the order, delete lines you are not
  invoicing yet, the order says *Partially invoiced*; *Convert to bill* on a receive.
- **ERPNext:** the credit note is made from the invoice and cannot credit more than was
  invoiced; the order shows how much is billed.

What Lynk takes:

1. **The existing Invoices module becomes the real one** (keeps POS, website orders, saved
   views, record layouts and history). Its URL paths and module key stay.
2. **Draft → issued → void, and issued is final** (BC, ERPNext, Odoo). An issued invoice
   changes only its due date, notes and presentation; anything else is a credit note or, when
   nothing is paid or credited, *Void* (BC's *Cancel*) and *Void and copy* (BC's *Correct*).
3. **Numbers per tenant, given at issue** (Odoo, BC); drafts are unnumbered.
4. **Payments are records** with date, amount, method and reference, voidable, and the
   invoice's paid amount and status are derived from them (all five).
5. **Invoice from the order, partial by default** (Zoho's *Convert to invoice*, Odoo's *Create
   invoice*): the draft opens with what is to invoice; remove or reduce lines to invoice less.
   From a delivery, the same with that delivery's lines (BC's *Get Shipment Lines*).
6. **One policy setting** (Odoo, NetSuite's preference): tracked products are invoiced as
   delivered by default; services and untracked products as ordered.
7. **The order shows Invoiced and To invoice per line and an invoice status** (Zoho's
   *Partially invoiced*, ERPNext's *% billed*, BC's *Qty. to Invoice*).
8. **Credit notes from the invoice or from a return**, never above what was invoiced
   (ERPNext, BC's *Get Return Receipt Lines*); an excess over the balance due becomes a refund.
9. **Bills from the PO or the receipt, against received quantities** (Odoo's bill control,
   Zoho, ERPNext), with price differences from the PO flagged on the line (NetSuite), and
   bills without a PO for services and expenses.

## 3. Design

### 3.1 Data

```text
finance_pos_invoices      + sales_order_id (→ sales_orders, SET NULL), source (manual | pos |
                            sales_order | website_order), issued_at, issued_by, voided_at,
                            void_reason, amount_credited, balance_due (cached)
                          status: draft | issued | void   ('paid' migrates to issued + paid)
                          payment_status: unpaid | partial | paid  (derived, never written by PUT)
                          invoice_number: NULL while draft; INV-YYYYMMDD-NNNN per tenant at issue
finance_pos_invoice_lines + sales_order_item_id, delivery_line_id (both SET NULL),
                            discount_amount, tax_amount, credited_quantity (cached)
finance_credit_notes      number (CN-…), tenant, invoice (required), return (→ inventory_returns,
                          optional), status (draft | issued | void), reason, issue_date,
                          subtotal, discount, tax, total, refund_due (cached), issued_at/by
finance_credit_note_lines credit note, invoice line, description, quantity, unit_price,
                          discount_amount, tax_amount, line_total
finance_payments          number (PAY-…), tenant, direction (received | made), kind (payment |
                          refund), account, contact, amount (> 0), currency, paid_on, method,
                          reference, notes, status (posted | void), void_reason, created_by
finance_payment_allocations  payment, exactly one of invoice / credit note / bill, amount (> 0)
finance_credit_allocations   credit note, invoice, amount (> 0)
purchase_bills            number (BILL-…), tenant, vendor (flagged Account), purchase order
                          (optional), vendor_invoice_number, bill_date, due_date, currency,
                          status (draft | posted | void), payment_status, match_status (none |
                          matched | variance), subtotal, tax, total, amount_paid, balance_due
purchase_bill_lines       bill, purchase order line, receipt line (both optional), product or
                          service (optional), description, quantity, unit_cost, po_unit_cost
                          (snapshot), tax_amount, line_total
sales_orders              + invoice_status (none | to_invoice | partial | invoiced)
sales_order_items         + invoiced_quantity (cached)
purchase_orders           + bill_status (none | to_bill | partial | billed)
purchase_order_lines      + billed_quantity (cached)
sales_organizations       + payment_terms_days (customer and vendor default)
tenant setting            invoicing_policy: delivered | ordered (tracked products)
```

Line totals follow quotes and orders: quantity × price − discount + tax. Invoices keep the
header discount and tax rate so POS and older invoices still total the same; invoices made
from an order leave them at zero. Cached figures are written only by their service, as E3 does
for `delivery_status`.

### 3.2 Quantities

Per order line:

- **Invoiceable**: services and untracked products, or every product under the *ordered*
  policy: the ordered quantity (what was delivered, if the remainder was closed). Tracked
  products under the *delivered* policy: delivered − returned.
- **Invoiced**: issued, non-void invoice lines for that order line. Credit notes do not reduce
  it (§5 decision 6).
- **To invoice**: invoiceable − invoiced, never below zero; zero on a cancelled order.
- **Order invoice status**: *none* (draft or nothing invoiceable yet and nothing expected),
  *to_invoice*, *partial*, *invoiced*.

Per PO line: **To bill** = received − billed (posted, non-void bill lines). PO bill status the
same way.

Per invoice: **Balance due** = total − credit allocations − allocations of posted payments.
Per credit note: **Refund due** = total − its allocations − allocations of posted refunds.
*Overdue* = issued, balance due > 0, due date before today (derived, not stored).

### 3.3 Rules

| Event | Effect |
|---|---|
| Invoice from order | A draft with every line's To invoice, prices pro-rated: line discount and tax × quantity ÷ ordered (the last invoice takes the rounding remainder) |
| Invoice from delivery | The same, limited to that delivery's lines and their To invoice |
| Draft saved | Order-linked lines cannot exceed To invoice; manual lines are free |
| *Issue* | Number given; lines, customer, currency and totals lock; order Invoiced and invoice status recomputed |
| Issued invoice edit | Only due date, notes, payment terms text, template; everything else refused |
| *Void* | Only with no posted payment and no issued credit note; quantities return to To invoice |
| *Void and copy* | Voids, opens a draft copy (BC's *Correct*) |
| Credit note issued | Reduces balance due; quantity per line ≤ invoiced − already credited; any excess over the balance due is *Refund due* |
| Payment recorded | ≤ balance due; status derived; voiding a payment restores the balance |
| Refund recorded | Against a credit note's refund due |
| Order cancelled | Refused while an issued invoice is not fully credited or void |
| Delete | Draft invoices, credit notes and bills only (recycle bin); issued documents are voided, never deleted |
| Bill from PO / receipt | Draft with To bill per line at the PO cost; vendor invoice number required, unique per vendor among non-void bills |
| Bill line over To bill | Refused (as over-receipt is) |
| Bill price ≠ PO cost | Allowed; the line and the bill show *Price variance*; stock cost is unchanged until E6 |
| Bill posted / voided | PO billed quantities and bill status recomputed; void only with no posted payment |

POS keeps its fast path: *Create and mark paid* issues the invoice and records the payment in
one step. Website orders issue directly, as now.

### 3.4 Routes, modules and permissions

| Module key | Sidebar | Covers |
|---|---|---|
| `finance_pos` (existing) | Finance → Invoices | Invoices; *Create invoice* on orders needs `create` here and `view` on `sales_orders` |
| `finance_credit_notes` (new) | Finance → Credit notes | Credit notes; from a return also needs `view` on `inventory_returns` |
| `finance_payments` (now seeded) | Finance → Payments | Payment and refund records, both directions; recording needs `create` here and `view` on the document |
| `purchase_bills` (new) | Purchasing → Bills | Vendor bills |

The migration gives every role the same actions on `finance_credit_notes` and
`finance_payments` that it has on `finance_pos`, and on `purchase_bills` what it has on
`purchase_orders`, so nobody loses a button. `edit` issues and voids.

```text
existing  /finance/pos-invoices           + /{id}/issue, /{id}/void, /{id}/void-and-copy
GET       /sales/orders/{id}/invoiceable  lines with Invoiceable, Invoiced, To invoice
POST      /finance/pos-invoices/from-order   {order_id, delivery_id?} → draft
CRUD      /finance/credit-notes           + /{id}/issue, /{id}/void; from invoice, from return
CRUD      /finance/payments               + /{id}/void; list filters direction, method, dates
CRUD      /purchasing/bills               + /{id}/post, /{id}/void
POST      /purchasing/bills/from-order    {purchase_order_id, receipt_id?} → draft
```

The old `POST /finance/pos-invoices/{id}/payments` stays as a thin wrapper that creates a
payment record. `status`, `payment_status` and `amount_paid` leave the update schema.

### 3.5 UX

Everything uses E3's document layout and the existing list primitives.

- **Invoice:** draft shows the line editor (now with discount and tax per line, as on orders),
  *Issue* as the primary action. Issued: read-only lines, a summary rail with Total, Credited,
  Paid, **Balance due**, the *Payments* and *Credit notes* sections, *Record payment*
  (primary while a balance is due), *Create credit note*, *Void* / *Void and copy*, *Print*.
  Overdue shows as a status.
- **Invoices list:** Balance due and Due columns; filters Overdue, Unpaid; presets *Overdue*,
  *Draft*.
- **Order:** an *Invoicing* section beside Fulfilment: per line Invoiced and To invoice, the
  order's invoices, *Create invoice* (primary once something is to invoice). The orders list
  gains an Invoice column, filter and a *To invoice* preset.
- **Delivery:** *Create invoice* for its lines. **Return:** *Create credit note* when the
  delivery's order was invoiced.
- **Payments:** a real list of payment records (number, date, customer or vendor, document,
  method, reference, amount, direction), *Void* on the record. Record payment stays a dialog
  on the invoice or bill and a standalone page.
- **Bill:** from the PO (*Create bill*) or the receipt (*Bill this receipt*), or blank for a
  service or expense; lines show the PO cost beside the billed cost and flag variances; *Post*,
  *Record payment*, *Void*, *Print*.
- **Account:** *Payment terms (days)* on the form, defaulting due dates; the record's summary
  shows *Receivables* (open invoice balance) and, for vendors, *Payables*.
- **Settings → Sales:** *Invoice tracked products when* delivered / ordered.

### 3.6 Platform

- Activity on every document action, also on the order, PO and Account.
- Automation triggers `finance.invoice_issued`, `finance.invoice_overdue` (a beat scan shaped like
  `scan_due_task_alerts`, which emits `task.overdue` once per task), `finance.payment_recorded`, `purchase.bill_posted`,
  `purchase.bill_overdue`; record sources for each document. The insertion-order
  `invoice.overdue` trigger and its 08a contract name are untouched; webhooks for the new
  events wait for 4A Phase 2, as E2–E4's do.
- Reports: sources *Invoices*, *Invoice lines*, *Credit notes*, *Payments*, *Bills*;
  templates *Overdue invoices by customer*, *Invoiced this month*, *Unpaid invoices by due
  month*, *Bills due this month*, *Billed spend by vendor*, *Orders to invoice*.
- CSV exports of every list; drafts in the recycle bin and purge; a new `finance` backup set
  (invoices, lines, credit notes, payments) and bills in the purchasing set (older backups
  without them still restore).
- Global search over credit notes and bills; record comments on all four documents.

## 4. Phases

**Phase 1 — invoices become documents.** Lifecycle and locking, per-tenant numbering at
issue, line discount and tax, payment records (each invoice with `amount_paid > 0` gets one
`migrated` payment for that amount, dated its last update), voiding payments, overdue, the
Payments list, Account payment terms. Fixes §1 findings 1–3.

**Phase 2 — invoicing orders, and credit notes.** The policy setting, invoiceable quantities,
invoice from order and from delivery, order invoice status and list, the cancel guard, credit
notes from invoices and returns, refunds.

**Phase 3 — vendor bills.** Bills from PO, receipt or blank, matching and variance, PO bill
status, vendor payments, payables.

**Phase 4 — the platform.** Triggers, reports, exports, recycle bin, backup, search, seed
samples (an order invoiced in two parts, a credit note from a return, a billed PO).

Acceptance (all phases): an issued invoice refuses a line edit and a status edit; a payment of
40 on 100 leaves 60 due and *partial*, voiding it leaves 100; numbers are per tenant and drafts
have none; an order for 10 delivered 4 invoices 4 under *delivered* and 10 under *ordered*;
a second invoice takes the remaining 6 and the order is *invoiced*; a credit note above what
was invoiced is refused; a credit note of 30 on a paid invoice of 100 shows 30 refund due; an
invoiced order cannot be cancelled; a bill for more than was received is refused; a bill at a
different cost shows *Price variance*; another tenant's order, invoice, receipt or vendor is a
404; each route checks all three access layers.

Verification: one pass after all phases (owner, 2026-10-02): backend tests, the PostgreSQL
migration replay, `codex-check.sh`, a browser spec, the rendered guards scoped to Finance and
Purchasing, then the full walk once (E5 closes the finance module).

## 5. Decisions (owner accepted all, 2026-10-03)

| # | Decision | Recommended | Why |
|---|---|---|---|
| 1 | New invoice module or evolve *Invoices* | **Evolve `finance_pos`**, keep its key and paths | POS, website orders, saved views and history keep working |
| 2 | What tracked products invoice | **A tenant setting, default *delivered***; services and untracked products always *ordered* | Odoo's two policies, NetSuite's preference; delivered is the safe default for goods |
| 3 | Can an issued invoice change | **No.** Due date, notes and template only; otherwise *Void* (unpaid, uncredited), *Void and copy*, or a credit note | BC, ERPNext, Odoo; an invoice the customer holds must match ours |
| 4 | Invoice numbers | **Per tenant, `INV-YYYYMMDD-NNNN`, given at issue**; existing numbers kept | Fixes the shared sequence; drafts burn no numbers; matches every other Lynk document |
| 5 | Payment allocation | **One payment pays one document**; one payment over several invoices and unapplied customer credit later | Zoho and ERPNext allocate across invoices; it is a flow of its own |
| 6 | Does a credit note reopen order quantities | **No**; re-billing is a manual invoice | ERPNext's open issue #59730 shows the ambiguity either way; a return already records the goods |
| 7 | Tax | **Discount and tax amount per line, as on quotes and orders**; header rate kept for POS; no tax codes yet | One model across the sales documents; tax codes are their own wave |
| 8 | Bill matching | **Bill against received quantities; over-billing refused; price variance allowed and flagged**, stock cost unchanged until E6 | Odoo bill control, NetSuite variances; E6 owns valuation |
| 9 | Vendor invoice number | **Required, unique per vendor among non-void bills** | The duplicate-bill guard every player has |
| 10 | Invoices on the client portal | **Not in E5**: with payment links, when the owner opens them | Both are the portal's auth boundary and belong together |
| 11 | Several orders on one invoice | **Not now**; one order (or one delivery) per invoice | BC and NetSuite do it; Zoho does not; it complicates pro-rating |
| 12 | Emailing invoices | **Not now**: print covers it, as for POs; PDF generation needs a library | No PDF engine in the stack today |

## 5a. Built so the deferred items are additive (owner, 2026-10-03)

| Deferred | What E5 builds now so that it is additive later |
|---|---|
| One payment over several invoices; unapplied customer credit (5) | A payment is a header with **allocation rows**. E5's API and UI create exactly one allocation for the whole amount; the service already takes a list. Unapplied = amount − allocations, always 0 today |
| Applying a credit note to another invoice (5) | Credit notes reach invoices only through **credit allocation rows**; E5 makes one, to the credit note's own invoice |
| Credit notes reopening order quantities (6) | Invoiced quantity per order line is computed in one function (`invoicing_quantities`), the single place a policy would change |
| Tax codes (7) | Line amounts are computed in one function shared by invoices, credit notes and bills; a tax code is a nullable column plus a branch there |
| Portal invoices, payment links (10) | Invoice serialization and the printable document are shared building blocks (`serialize_invoice`, `InvoiceDocument`), not page code |
| Several orders or receipts on one document (11) | Every invoice and bill line carries its own source line (`sales_order_item_id`, `purchase_order_line_id`); quantities are computed from lines, never from the header. `from-order` takes a list of sources, limited to one today |
| Emailing invoices (12) | The print page renders `InvoiceDocument`; a PDF or email renders the same component |

## 6. Out of scope

A general ledger and journal entries, tax codes and tax reports, down payments and deposits,
recurring and subscription invoices, invoicing several orders together, multi-invoice payment
allocation and customer credit balances, payment links and portal invoices, debit notes and
returns to vendors, approval workflows and tolerances on bills, landed costs and cost
revaluation (E6), multi-currency settlement, bank reconciliation, emailed or PDF invoices,
and insertion orders (`finance_io`), which keep their own `invoice.overdue` trigger.
