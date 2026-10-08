# 13c — Step 7, F4: ERP documents get the record platform

This is the plan for **F4** of `13-final-fixes.md`, the first phase of §7 Step 7 (F4 → F5 → F6).
It was written on 2026-10-08. **The §5 decisions are awaiting the owner.**

**Test cadence (owner, 2026-10-08):** F4, F5 and F6 share **one** test pass after F6 is built
(13 §6). Nothing in F4 is run on its own, not even its new test modules. Each slice below
records its migrations and touched files in STATUS.md, so a failure in the shared pass can be
traced to its phase by diff.

## 1. Where things stand (inspected 2026-10-08)

**Already done, so F4 drops them:**
- **F4.5, document flow polish (I3, I4):** done in Step 3, covering *Create credit note*
  disabled with its reason, the order number on new deliveries, one spelling of "Fulfilment",
  the Reallocate row menu, and `TrackingNumber` carrier links.
- **Parts of H18,** done in Step 6 Phase 5: *Create product* inside the PO line picker, which
  sets the preferred vendor to the PO's vendor and the unit cost from it, and *Create vendor*
  in the vendor picker.

**History.** Every ERP document writes `activity_logs` rows (entity types `purchase_order`,
`purchase_receipt`, `purchase_bill`, `inventory_adjustment`, `inventory_delivery`,
`inventory_return`, `finance_credit_note`, `finance_payment`). No document page shows them,
and no document can be commented on. `RECORD_COMMENT_MODULES` covers the CRM records, quotes,
orders, invoices and the catalog. `RecordAuditHistory` and `RecordTimeline` exist, but only the
`RecordWorkspace` pages use them. The `lifecycle` activity adapter covers four CRM modules and
only the `create` and `convert` actions.

**Lists.** The current state of each ERP list:

| List | Saved views | Search | Export button | Export API |
|---|---|---|---|---|
| Purchase orders, receipts, bills | — | yes | — | `export-job` |
| Deliveries, returns | — | yes | — | `export-job` |
| Credit notes, payments | — (payments is in `SAVED_VIEW_MODULES` but its page ignores it) | yes | — | `export-job` |
| Invoices | yes | yes | — | `export-job` |
| Sales orders | yes | yes | — | **none**, and no import |
| Adjustments, transfers | — | **none** | — | **none** |
| Stock, valuation | yes / — | yes | yes | yes |

Presets live in `PRESET_SAVED_VIEWS` (`profile.py`) and are seeded on a user's first visit to
the module.

**Global search** covers invoices, credit notes and bills: bills by number and vendor
invoice number, but **not by vendor name**. It does not cover POs, receipts, deliveries,
returns, adjustments, transfers or payments.

**Purchase orders** (H18, H19):
- `PurchaseOrderLine.product_id` is `NOT NULL`. `_normalize_lines` refuses any product that
  does not track inventory, so services and non-stock items cannot be bought on a PO.
- Lines have no tax or discount (bill lines have `tax_amount`).
- PO statuses are `draft → ordered → received / closed / cancelled`, with no request or sent
  state.
- No table records a vendor's price. `CatalogProduct` has `preferred_vendor_id`,
  `vendor_sku` and `cost_price`.
- A receipt is saved and then posted, while a bill has *Save and post*.

**Missing purchasing documents (D12):**
- No vendor credit. `FinanceCreditNote` is customer-only and allocates to invoices.
  `FinancePaymentAllocation` already targets invoice, credit note or bill.
- No return to vendor. `InventoryReturn` is customer-only, against a delivery.
- No RFQ.

**E5/E6 tails:**
- A payment date is accepted up to one day ahead, because a user's today can be the server's
  tomorrow.
- Bill price differences on goods already sold go to the *Revaluations* report source, not
  *Cost of goods sold*.

## 2. Benchmark

| | Odoo 18 | Business Central | NetSuite | Zoho Books / Inventory | ERPNext |
|---|---|---|---|---|---|
| **Document history** | Chatter on every document: messages, notes, tracked field changes, followers | Notes and links FactBoxes; change log is an admin setting | System notes + user notes per transaction | *Comments & History* on every transaction | Comments + activity timeline on every doctype |
| **Return to vendor** | Return from the receipt; *To refund (update PO)* lowers the received quantity, then *Refund* makes the vendor credit for it | Purchase return order (*Get posted document lines to reverse*), which issues the credit memo | Vendor Return Authorization: approve → ship → credit | Vendor credit note from a bill adjusts stock itself | Purchase Receipt with *Is Return* |
| **Vendor credit** | Vendor refund (credit note) from the bill; reconciled against bills or refunded | Purchase credit memo from the posted invoice, applied to open entries | Vendor credit, applied to bills | Vendor credit: *Apply to bills* (split over several), *Refund*, refund history | Debit note (Purchase Invoice *Is Return*) |
| **RFQ** | The draft PO *is* the RFQ: *Send by email* → *RFQ sent* → *Confirm*. Alternatives and a comparison grid via purchase agreements (call for tenders) | Purchase quote document → *Make order* | Request for quote (advanced procurement) | No RFQ in Books; Zoho Inventory has none either | RFQ → Supplier Quotation per vendor → comparison report → PO |
| **Unit cost default** | Vendor pricelist (`supplierinfo`: vendor, min qty, price, dates), else product cost | Purchase prices per vendor, else last direct cost | Vendor price on the item record | Item's purchase rate | Buying price list, else last purchase rate |
| **Services on a PO** | Yes; billed on ordered or received quantities (control policy) | Yes (G/L account, resource, non-inventory items) | Yes (non-inventory, service items) | Yes | Yes (non-stock items) |

What Lynk takes from each:
- **History:** Odoo's and Zoho's single panel, with comments and history in one place on every
  document. It is built once and used everywhere.
- **Return to vendor:** Odoo's flow. The return starts from the receipt, and its resolution
  decides whether the PO expects the goods again or a credit follows. Business Central and
  NetSuite add a separate authorization document, which is too heavy for Lynk's users.
- **Vendor credit:** Zoho's behaviour, which mirrors Lynk's customer credit notes. It applies
  to one or several bills and is refunded through a payment. Stock stays with the return
  document, as on the customer side, so goods and money remain separate (unlike Zoho, where
  the credit moves stock).
- **RFQ:** Odoo's model. The draft is the request, *Mark as sent* (real email in F5), then
  *Confirm*, plus *alternatives* that compare vendors side by side. There is no second
  document type as in ERPNext.
- **Unit cost:** the last price paid to this vendor for this product, then the product's cost.
  Vendor price lists (Odoo's `supplierinfo`) belong with F6's price lists.

Sources:
- [Odoo 18 vendor refunds (Cybrosys)](https://www.cybrosys.com/blog/how-to-manage-vendor-refunds-in-odoo-18-accounting)
- [Odoo 18 vendor price lists](https://www.cybrosys.com/odoo/odoo-books/v18-ce/purchase/vendor-price-lists/)
- [Odoo 18 purchase orders menu](https://www.cybrosys.com/odoo/odoo-books/v18/purchase/orders-menu/)
- [Business Central purchase returns](https://learn.microsoft.com/en-gb/dynamics365/business-central/purchasing-how-process-purchase-returns-cancellations)
- [NetSuite Vendor Return Authorization](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N3199760.html)
- [Zoho Books vendor credit functions](https://www.zoho.com/books/help/vendor-credits/functions.html)
- [Zoho Books: tracking vendor credits](https://help.zoho.com/portal/en/community/topic/new-track-vendor-credits-in-zoho-books)
- [Zoho Books: tracking changes on transactions](https://www.zoho.com/en-fr/books/kb/quotes/track-changes-on-quotes.html)
- [ERPNext procurement cycle](https://docs.frappe.io/erpnext/user/manual/en/procurement-cycle-overview)

## 3. Design

### 3.1 Document history panel (F4.1)

**Backend.**
- `RECORD_COMMENT_MODULES` gains:
  - inventory: `inventory_adjustments`, `inventory_transfers`, `inventory_deliveries`,
    `inventory_returns`;
  - purchasing: `purchase_orders`, `purchase_receipts`, `purchase_bills`;
  - finance: `finance_credit_notes`, `finance_payments`;
  - the two new documents (§3.6, §3.7).
- Each entry names its `number` as the label and its dashboard path. Mentions and
  notifications come with it, as they do for quotes.
- `record_activity`: a `document` adapter, record-scoped like `lifecycle`, reads a
  document's own `activity_logs` rows (every action: created, posted, ordered, sent,
  cancelled, voided, allocated). It applies to the document module set only, so CRM timelines
  are unchanged.
- The audit endpoint `/activity/record` already serves any module key, and the frontend's
  `RecordModuleKey` union widens to match.

**Frontend.**
- One component, `components/recordActivity/DocumentHistory.tsx`, sits at the foot of every
  document page, under the lines and totals, as Odoo's chatter does.
- It has a comment composer (the existing record-comment input, with mentions) and one list
  that merges comments and the document's history by time. `RecordAuditHistory`'s
  `moduleEvents` merge is reused, so nothing new paginates.
- Filter chips *All · Comments · History*.
- Read-only for users without `edit` on the module, which is the existing comment rule.

**Pages that get it:** adjustment, transfer, delivery, return, PO, receipt, bill, credit note,
payment, vendor credit, vendor return. Invoices and orders keep their workspace timeline.
F7's journal entries take the same component when they land.

### 3.2 Saved views, filters and search on every document list (F4.2)

- `SAVED_VIEW_MODULES` gains every document module above. Each list page moves onto
  `ModuleListToolbar` + `SavedViewSelector` + `InlineSavedViewFilters`, as invoices and orders
  already are, and `lib/moduleViewConfigs.ts` gets each module's filter fields.
- Adjustments and transfers get server search by number, reason or warehouse, plus a search
  box. `InventoryDocumentListPage` is generic, so it gains it once.
- Presets (`PRESET_SAVED_VIEWS`) are below. *Mine* means owner, or creator where a document
  has no owner.

| Module | Presets |
|---|---|
| Purchase orders | Drafts · RFQs sent · To receive · To bill · Mine |
| Receipts | Drafts · Mine |
| Bills | Drafts · Overdue · Unpaid · Mine |
| Vendor credits | Drafts · Open credit · Mine |
| Vendor returns | Drafts · Awaiting credit |
| Deliveries | Drafts · Mine |
| Returns | Drafts · To credit |
| Adjustments, transfers | Drafts · Mine |
| Credit notes | Drafts · Refund due |
| Payments | Received · Made · Refunds |
| Invoices (has *Overdue*) | + Drafts · Unpaid |

- Nobody has saved views for the new modules yet, so first-visit seeding covers everyone and
  no migration is needed. There are no users yet in any case.
- Invoices and payments already have views. Their added presets reach existing users through
  the same first-visit rule only if they have none, which is acceptable with no users.

### 3.3 Export and import (F4.3)

- The shared `ExportControls` goes onto every document list. It calls the existing
  `*/export-job` with the list's current saved-view filters. `InventoryDataTransferActions`
  is the working pattern; it is generalised into `DocumentExportControl` rather than copied
  eleven times.
- **New export routes:** adjustments, transfers, sales orders, and the two new documents.
  Each goes through the list's own query (`test_list_export_parity` already enforces one
  query per list and gains the new ones).
- **Sales order import:** one CSV row per line. Rows sharing an `order_reference` become one
  order, created as a draft. Account, contact and product are matched by name or code. An
  order with any bad row is refused whole, while the other orders still import. It runs as a
  persisted `data_transfer_jobs` job, through the existing `ImportControls`. (§5 decision 6.)

### 3.4 Global search (F4.4)

Global search gains:
- POs: number, vendor name, vendor reference;
- receipts: number, PO number;
- deliveries and returns: number, order number, customer;
- adjustments and transfers: number;
- payments: number, party, reference;
- vendor credits and vendor returns: number, vendor.

Bills add vendor name. Each module's result function checks `view` on its module through
`can_access`, as the existing ones do. There is one query per module with `limit`, and
tenant-scoped, soft-deleted rows are excluded.

### 3.5 Purchase orders and receipts (F4.6, H18, H19)

**Lines take any catalog item.** The `20261014_po_lines` migration changes PO lines:
- `product_id` becomes nullable;
- adds `catalog_service_id`, with a check that exactly one of the two is set;
- adds `discount_amount` (≥ 0), with `line_total = qty × cost − discount`.

How each kind of item is received and billed:
- **Tracked products** are received as today, with a stock move.
- **Non-stock products** are received on the receipt, with no stock move. The receipt still
  confirms the quantity, so the bill matches against it.
- **Services** need no receipt. They are billed on the ordered quantity, which is Odoo's
  *ordered quantities* control policy. Their lines show *Not received in stock*.
- `receipt_status` counts only lines that need receiving. A PO of services only goes from
  *ordered* straight to billing.

**Tax on PO lines waits for F5** (§5 decision 1). F5 gives every line a tax rate, POs
included. Adding a typed tax amount now would mean building the field once and migrating it
again in the same step.

**Unit cost default:** a new `GET /purchasing/orders/line-defaults?vendor_id=&product_id=` (or
`service_id`) returns the last posted bill line's unit cost for this vendor and item. Failing
that, the last PO line's cost, then the item's `cost_price`. The line editor calls it when an
item is picked, and the user can override.

**Vendor picker:** shows the five most recent vendors on focus, from the tenant's latest POs
and bills, before any typing.

**PO page:**
- the number as its heading;
- a status line;
- *Create bill* when anything is billable;
- a *Receipts and bills* section listing both with status and amounts;
- `DocumentHistory`.

**Receipt:**
- *Save and post* in one step, matching the bill;
- the receipt date defaults to the user's today.

**Required fields** are marked on the PO, receipt and bill forms (vendor, warehouse, vendor
invoice number), through the shared `FormField` `required`.

**Bill:**
- the price-difference banner shows before posting, from a dry-run `match` computed with the
  form's lines;
- a posted bill shows the vendor invoice number in its header.

### 3.6 Vendor credits (D12)

**New tables:**
- `purchase_vendor_credits`:
  - `number` (allocated on issue, prefix `VC`);
  - `vendor_id`, plus `bill_id` and `vendor_return_id`, both optional;
  - `status` `draft · issued · void`;
  - `credit_date`, `currency`, `exchange_rate`;
  - amounts: subtotal, tax, total, `credit_remaining`;
  - `reason`, `notes`, owner, the issue and void stamps, `deleted_at`.
- `purchase_vendor_credit_lines`: optional `bill_line_id` and `vendor_return_line_id`, the
  catalog link, description, quantity, unit cost, tax and line total.
- `purchase_vendor_credit_allocations`: credit → bill, amount > 0.
- `FinancePaymentAllocation` gains a fourth target, `vendor_credit_id`, and its one-target
  check widens. A vendor refund is a `received` payment of kind `refund`, allocated to the
  credit.

**Behaviour:**
- **Sources:** *Create vendor credit* from a posted bill (lines limited to what was billed,
  less what was already credited), from a vendor return (§3.7), or blank for a vendor.
- **Issue:** validates the lines and allocates the number. If the credit came from a bill
  with a balance due, it allocates there automatically, up to that balance, as customer
  credit notes do with their invoice.
- *Apply to bills*: split the remaining credit over the vendor's open bills in the same
  currency. *Refund*: record money back.
- A bill's `balance_due` includes credit allocations (`refresh_bill_balance`).
- **Void:** only while nothing is applied or refunded. Allocations are removed in the same
  unit of work.
- **Costing:** a credit with no return, on tracked goods still in stock, is a price
  correction. It revalues the remaining stock through the existing `bill_variance` path in
  `costing.py`, and the share on goods already sold goes to cost of goods sold (§3.8). A
  credit tied to a return carries no extra cost entry, because the return already moved the
  value.
- **Permissions:** new module key `purchase_vendor_credits` (seed, role matrix, sidebar under
  Purchasing, registries, both guard lists).
- **Page:** `/dashboard/purchasing/vendor-credits`, built like the credit note page.
- **Backup** includes the three tables.
- **Activity:** created, issued, applied, refunded, voided.

### 3.7 Return to vendor (D12)

**New tables:**
- `purchase_vendor_returns`:
  - `number` (`VRT`);
  - `vendor_id`, `order_id`, `receipt_id`, `warehouse_id`;
  - `status` `draft · shipped · cancelled`;
  - `resolution` `credit · replace` (§5 decision 3);
  - `reason`, `notes`, shipped and cancel stamps, `deleted_at`.
- `purchase_vendor_return_lines`: `receipt_line_id`, `order_line_id`, `product_id`, quantity
  > 0, `unit_cost` (copied from the receipt's move).

**Behaviour:**
- Started from a posted receipt with *Return to vendor*. Lines are limited to the received
  quantity, less what was already returned, and only products are returned (not services).
- **Ship** posts an outbound move, `move_type='vendor_return'` and `source_type='vendor_return'`,
  for each tracked line. The move is valued at the receipt line's unit cost, not the current
  average (as 13 §F4.7 says). The difference to the average adjusts the remaining stock's
  value, which is how Odoo's AVCO handles a return at its original price. Non-stock lines post
  no move.
- Stock is checked against the warehouse's available quantity. The negative-stock policy
  arrives in F6.9, so until then a return that would go negative is refused.
- **`resolution = replace`:** the returned quantity is taken off the PO line's received
  quantity, so the PO shows it as *to receive* again and the vendor's replacement is received
  as normal.
- **`resolution = credit`:** the return shows *Create vendor credit*, pre-filled from its lines
  at the bill's cost if billed, else the receipt's. It is disabled with a reason while
  nothing is billed, as I3 does for customer returns.
- **Cancel** a shipped return reverses its moves (`reverses_move_id`), as delivery
  cancellation does.
- **Permissions:** new module key `purchase_vendor_returns`.
- **Page:** `/dashboard/purchasing/vendor-returns`, built like `ReturnDocumentPage`.
- The receipt and PO pages list their returns.
- **Backup** includes both tables.

### 3.8 RFQs (D12)

The PO status set gains `sent`: `draft → sent → ordered`. In the UI:
- a draft PO is labelled *Request for quotation*;
- `sent` is labelled *RFQ sent*;
- `ordered` is labelled *Purchase order*.

There is one document type and one numbering, as in Odoo. The number keeps its `PO` prefix
(§5 decision 4).

The actions:
- **Mark as sent** stamps `sent_at` and `sent_by`. F5 replaces the manual step with *Send*,
  which emails the PDF and marks it sent.
- **Alternatives:** *Create alternative* copies the RFQ to another vendor in the same
  `rfq_group_id` (new nullable column, set to the first RFQ's id).
- **Compare:** a page `/dashboard/purchasing/orders/{id}/compare` shows, for each line, every
  alternative's unit cost, discount, line total and expected date. It also shows each RFQ's
  total, and marks the lowest per line and overall.
- **Choose:** *Confirm this one* orders the chosen RFQ and cancels the others in the group
  with the reason "Another vendor chosen". Each sibling gets a history entry.
- A `sent` RFQ can still be edited (prices come back from the vendor). Once ordered, it locks
  as today.

**Migration `20261015_vendor_documents`:**
- widens the PO status check;
- adds `sent_at`, `sent_by`, `rfq_group_id`;
- creates the vendor credit and vendor return tables;
- widens the payment allocation check.

### 3.9 E5/E6 tails (F4.6 first list)

- **Payment date:** the payment form defaults to the user's today from `lib/datetime.ts`
  (`todayInUserZone`), not the browser's UTC date. The server's one-day tolerance stays until
  F6.8 gives the company a timezone; F6.8 then removes it.
- **Cost of goods sold:** the bill-variance revaluation already splits stock that is still
  held from stock already sold. The share on sold goods now also appears as a row in the
  *Cost of goods sold* report source (source type `bill_variance`), as well as in
  *Revaluations*. Vendor credits that correct price (§3.6) follow the same split.

### 3.10 Permissions, events, backup

- **New module keys:** `purchase_vendor_credits` and `purchase_vendor_returns`. They need
  seed entries, defaults in the role matrix (as `purchase_bills` and `purchase_receipts`),
  `module-registry`, `routes`, `moduleViewConfigs`, `module-display`, the sidebar Purchasing
  group, and both guard route lists.
- **Webhook events** for the new documents wait for F10 (Step 10), which catalogues every
  module once. `activity_logs` and the history panel cover them until then.
- **Backup and restore:** the five new tables, and the G1 round-trip test gains them.
- **Recycle bin:** draft vendor credits and draft vendor returns are soft-deleted and
  restorable, as other drafts are.
- **Accounting:** F7 posts vendor credits, vendor returns and refunds. Nothing here posts
  journals.

### 3.11 Migrations (chain after `20261013_layout_overrides`)

1. `20261014_po_lines`: PO line `product_id` nullable, `catalog_service_id`,
   `discount_amount`, the one-item check. Downgrade refuses if any service line exists.
2. `20261015_vendor_documents`: PO `sent` status, `sent_at`, `sent_by`, `rfq_group_id`;
   vendor credit and vendor return tables; payment allocation `vendor_credit_id` and the
   widened check. Downgrade refuses if any of the new rows exist.

Both revision ids are ≤ 32 characters. Both get Python `default=`s for new boolean and
numeric columns (SQLite reads `server_default "false"` as true).

## 4. Slices (built in order; no test runs until after F6)

| Slice | Contents | Main files |
|---|---|---|
| **4.1 History** | §3.1: comment modules, `document` adapter, `DocumentHistory`, on 9 existing document pages | `record_comments.py`, `record_activity.py`, `components/recordActivity/DocumentHistory.tsx`, the document pages |
| **4.2 Lists** | §3.2–3.4: saved views and presets, adjustments/transfers search, `DocumentExportControl`, new export routes, sales order import, global search | `profile.py`, `moduleViewConfigs.ts`, the list pages, `global_search.py`, `orders_routes.py`, `document_routes.py` |
| **4.3 PO and receipt** | §3.5 and §3.9: any-item PO lines, discount, cost defaults, recent vendors, PO page sections, one-step receipt, required marks, bill dry-run match and invoice number; payment today; COGS row | `20261014_po_lines`, `purchase_order_services.py`, `receipt_services.py`, `bill_services.py`, `PurchaseOrderDocumentPage.tsx`, `ReceiptDocumentPage.tsx`, `BillDocumentPage.tsx`, `report_catalog.py` |
| **4.4 Vendor documents** | §3.6–3.8: RFQ status, alternatives and compare; vendor returns; vendor credits; permissions, registries, backup | `20261015_vendor_documents`, `purchasing/services/vendor_credit_services.py`, `vendor_return_services.py`, `rfq_services.py`, new routes and pages |

Tests written as each slice lands, and run in the step's one pass:
- `test_document_history.py`
- `test_document_lists.py` (presets, search, export parity for the new routes)
- `test_sales_order_import.py`
- `test_purchase_order_lines.py`
- `test_vendor_credits.py`
- `test_vendor_returns.py` (including move cost and reversal)
- `test_rfqs.py`
- an extended `test_tenant_backup_roundtrip`

E2e coverage:
- `purchasing.spec.ts` extended (services line, one-step receipt, RFQ compare and confirm);
- new `vendor-documents.spec.ts` (return → credit → apply → refund);
- `document-history.spec.ts` (comment on a PO and a delivery).

## 5. Decisions (awaiting the owner)

1. **PO line tax waits for F5's tax rates**, so it is not built twice in one step. PO lines
   get discount now.
2. **Services on a PO are billed on the ordered quantity, with no receipt.** Non-stock products
   are received but move no stock.
3. **A vendor return chooses *credit* or *replace*.** *Replace* puts the quantity back to
   *to receive* on the PO; *credit* leads to a vendor credit.
4. **RFQ = a PO before it is ordered** (Odoo's model): same document, numbering and page, with
   a *sent* status, alternatives and a comparison page. There is no separate RFQ document type.
5. **Vendor credits mirror customer credit notes:**
   - they apply to bills through allocations and are refunded through payments;
   - stock moves only on the vendor return, never on the credit;
   - a price-only credit revalues like a bill variance.
6. **Sales order import:** one CSV row per line grouped by `order_reference`, created as
   drafts, all-or-nothing per order.
7. **Unit cost default:** last billed price from this vendor, then last PO price, then the
   item's cost. Vendor price lists wait for F6.
8. **New permission modules** `purchase_vendor_credits` and `purchase_vendor_returns`, as
   customer credit notes and returns have their own.
9. **History panel at the foot of document pages** (Odoo's chatter), with comments and history
   merged and filter chips. It does not use `RecordWorkspace`'s tab layout, which ERP
   documents do not use.

## 6. Out of scope

These items stay out:
- **Email sending of POs and RFQs:** F5.
- **PDFs:** F5.
- **Tax on any line:** F5.
- **Approvals of POs above an amount:** F6.7.
- **Vendor price lists:** F6.6.
- **Numbering settings:** F6.1.
- **Journals for any of this:** F7.
- **Webhooks:** F10.
- **Supplier portal for RFQ replies (ERPNext):** not planned.
- **Blanket orders and purchase agreements:** after go-live (13 §5) unless a client needs them.
