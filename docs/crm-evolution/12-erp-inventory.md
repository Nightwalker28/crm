# 12 — ERP: products, inventory and stock

## 1. Objective

The owner asked for **ERP modules one at a time**, to the same standard as the CRM modules,
**with a written plan first** (STATUS.md, 2026-10-01). This document is that plan:

- §2 gives the order of the ERP programme. Each module gets its own detailed plan when it starts.
- §3–§6 are the detailed plan for the first two modules: **E1 Products and services** and
  **E2 Inventory**.
- §7 records the owner's decisions (2026-10-01: every recommendation accepted).

**Owner rule (2026-10-01): every module is researched before it is built.** Each E-wave starts
by benchmarking the major players for that module: what each offers, what each does best, and
what Lynk takes. E1 and E2 are benchmarked here (§4.1, §4.2). E3–E6 each get their own
benchmark, in their own plan, before any code. The build follows Lynk's existing design
language, shared primitives and patterns (`docs/design/design.md`); it does not introduce a
new look. As with Reports, Lynk takes the best of each player and copies none of them.

## 2. The ERP programme, in order

| # | Module | What it gives | Depends on |
|---|---|---|---|
| **E1** | **Products and services, first class** | Quote, order and invoice lines linked to the catalog; a product picker; categories, cost, unit, barcode | — |
| **E2** | **Inventory** | Warehouses, a stock ledger, stock per warehouse, adjustments, stock counts, transfers, low stock | E1 |
| E3 | Sales fulfilment | Reservation on confirmed orders, deliveries (partial, backorders), returns | E2 |
| E4 | Purchasing | Vendors, purchase orders, receipts, incoming stock, reorder suggestions → draft PO | E2 |
| E5 | Invoicing and bills | Invoices from orders and deliveries (the roadmap's "invoice generator"), vendor bills from receipts | E3, E4 |
| E6 | Costing and valuation | Average cost, stock valuation, cost of goods sold, margin reports | E2–E5 |

Each row is one wave run under `CODEX-RUNBOOK.md`: plan, build, verify, update STATUS.md.
The next row does not start until the previous one is closed.

Not in the programme until the owner asks: manufacturing and bills of materials, kits,
lots and serial numbers, variants, several units per product, bins inside a warehouse,
landed costs, a general ledger, and multi-currency valuation (§8).

## 3. Where things stand (inspected 2026-10-01)

**Catalog** (`backend/app/modules/catalog/`, `frontend/components/catalog/`). Products and
services are separate tables and modules (`catalog_products`, `catalog_services`), each with
name, slug, SKU (products only), description, currency, public unit price, active, public,
and one image. Stock is two columns on the product: `stock_status` (`untracked`, `in_stock`,
`out_of_stock`, `preorder`) and `stock_quantity` (nullable, ≥ 0).

**Transactions.** Quote lines (`sales_quote_items`), order lines (`sales_order_items`) and
invoice lines (`finance_pos_invoice_lines`) share one editor, `TransactionLineItemsEditor`.
Orders are `draft → confirmed → fulfilled | cancelled`. Payments are applied to invoices
(`/dashboard/finance/payments`).

Defects and gaps found by reading it:

1. **Quote and order lines are free text.** `sales_quote_items` and `sales_order_items` have
   no product or service column, and the editor has no picker. Nothing can tell how many of a
   product were sold, so neither stock nor sales-by-product reports are possible.
2. **Invoice lines accept another tenant's product ID.** `pos_invoice_services.py` copies
   `catalog_product_id` and `catalog_service_id` from the request without checking the tenant.
   The foreign key only checks that the row exists somewhere. Only the ID is echoed back, so
   nothing leaks, but it breaks the tenant rule and must be fixed first.
3. **Stock is one number with no history.** The product form overwrites `stock_quantity`.
   There is no record of who changed it, when, or why, and no per-warehouse figure.
4. **Two writers, two rules.** Website orders (`_apply_stock_decrement` in
   `website_integration_services.py`) lock the product, refuse insufficient stock and flip
   `stock_status`. The product form writes any value and leaves the status as typed. Client
   portal orders do not touch stock.
5. **Order status means nothing to stock.** Marking an order Fulfilled or Cancelled changes
   no quantity.
6. **No cost.** Products have only a selling price, so margin cannot be computed.
7. **No categories.** A catalog of a few hundred products has no way to group them other
   than saved-view filters on the name.

## 4. Benchmark

### 4.1 E1 — products and services

| | Salesforce | HubSpot | Dynamics 365 Sales | Zoho CRM | Odoo |
|---|---|---|---|---|---|
| **Goods and services** | One Product object | One product library, with a product type | One catalog; products, bundles, families | One Products module | One product table; type *Goods*, *Service* or *Combo* |
| **Grouping** | Product Family (a picklist) | Product type, folders | Product families (a hierarchy) | Product Category | Product categories (a hierarchy) |
| **Codes** | Product Code | SKU | Product ID | Product Code | Internal reference, barcode |
| **Cost** | Custom field | Unit cost (COGS), the basis of margin reports | Standard and current cost | Custom field | Cost |
| **Units** | Quantity only | Quantity only | Unit groups (each, box of 12) | Usage unit | Units of measure |
| **Prices** | Price books; a product must be in one | Price per currency; price books (beta, 2026) | Price lists per currency and customer type | Unit price; price books with list prices | Sales price; pricelists with rules |
| **On a quote line** | Must come from the price book | A product, or a custom line item | A product, or a *write-in* product | A product | A product; notes and sections for text |
| **Line price** | Sales price editable | Editable per deal | Overridable | Editable | Editable |
| **On the product record** | Related opportunities and quotes | Associated deals and quotes | Related quotes, orders, invoices | Related deals, quotes, orders | *Sold* figure, opening the sales lines |

What each does best:

- **HubSpot:** a custom line item next to catalog products, and unit cost on the product as the
  basis of margin.
- **Dynamics:** *write-in* products (free text that is still a real line), and a family
  hierarchy sales reps can browse.
- **Odoo:** one picker that searches name, internal reference and barcode, and the product
  record's *Sold* figure that opens exactly those sales lines.
- **Salesforce, Zoho and Dynamics:** price books. Each needs its own model (per currency,
  per customer type, per date); see the note below.
- **Everyone:** the line keeps its own copy of name and price, so changing the catalog does
  not rewrite a sent quote, and an inactive product stays on old lines but leaves the picker.

What Lynk takes:

1. **Lines link to a product or a service, and free text stays** (HubSpot custom line items,
   Dynamics write-ins). A free-text line is a normal line that just has no catalog link.
2. **One picker for both**, labelled by type, searching name, SKU and barcode (Odoo). Active
   items only.
3. **The line keeps its own copy**; picking fills it, editing it later is allowed (everyone).
4. **Categories, one level of nesting** (Odoo, Dynamics), on products and services.
5. **Cost price** on products and services (HubSpot, Odoo), shown on the record and in reports.
   Margin reports wait for E6.
6. **A unit label** (Zoho usage unit): "unit", "hour", "box". Converting between units
   (Dynamics unit groups, Odoo UoM) is out of scope (§8).
7. **SKU on services too** (Odoo's internal reference applies to every product type).
8. **A *Sales* section on the product and service record** listing the quote and order lines
   that use it, each linked to its document (Odoo, Dynamics).

Not taken in E1: **price books.** Every CRM player has them and Lynk will need them, but they
touch quotes, orders, invoices, the client portal's customer-group discounts and currencies at
once. They get their own benchmark and plan as a later pricing module, not a corner of E1.

### 4.2 E2 — inventory

Benchmark rechecked 2026-10-02 against the vendors' current product documentation. The
comparison below describes their product models; the choices after it are Lynk's design.

- [Odoo inventory adjustments](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html) apply a counted difference and create a traceable stock move line. [Odoo's location model](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/operations_valuation.html) distinguishes internal transfers from stock entering or leaving the business.
- [Business Central item ledger entries](https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/page/microsoft.inventory.ledger.item-ledger-entries) are a read-only history of posted item transactions; its [inventory training](https://learn.microsoft.com/en-us/training/modules/adjust-inventory/) covers journals, counts and location reclassification.
- [NetSuite location balances](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_1504284372.html) distinguish on hand, committed, available, on order and in transit. Its [adjustments](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_0902105416.html) carry a location and quantity.
- [Zoho Inventory adjustments](https://www.zoho.com/us/inventory/help/items/inventory-adjustments.html) capture a reason for a quantity correction; [transfer orders](https://www.zoho.com/us/inventory/help/warehouses/transfer-orders.html) record movement between two warehouses.
- [ERPNext stock entries](https://docs.frappe.io/erpnext/stock-entry) post receipts, issues and transfers, and a submitted entry is corrected by cancelling and amending it. [Stock reconciliation](https://docs.frappe.io/erpnext/stock-reconciliation) handles opening balances and physical counts.

| | Odoo | Business Central | NetSuite | Zoho Inventory | ERPNext |
|---|---|---|---|---|---|
| **Stock record** | Stock moves between locations (double entry), quants per location | Item ledger entries per location | Transaction lines per location | Stock per warehouse, item history | Stock ledger entries; "Bin" holds per-warehouse totals |
| **Where stock lives** | Warehouse → locations (bins), virtual locations for vendors, customers, losses | Locations, optional bins | Locations (subsidiaries) | Warehouses | Warehouse tree |
| **Quantities shown** | On hand, forecast, reserved | Inventory, qty on sales/purchase orders, available | On hand, committed, available, on order, backordered | Stock on hand, committed, available for sale | Actual, reserved, ordered, projected |
| **Changing stock by hand** | Physical inventory: count, then apply | Item journal, physical inventory journal | Inventory adjustment, inventory count | Inventory adjustment (quantity or value), with reasons | Stock Reconciliation |
| **Transfers** | Internal transfer, one or two steps | Transfer order, in transit | Transfer order | Transfer order | Stock Entry: Material Transfer |
| **Corrections** | Done moves can't be edited; return or adjust | Posted entries are permanent; reverse | Void or reverse | Adjustments can be deleted | Cancel posts a reversing entry |
| **Low stock** | Reordering rules (min/max) → draft PO | Reorder point / quantity, planning worksheet | Reorder point, preferred stock level | Reorder point, notification | Reorder level per warehouse → material request |
| **Costing** | Standard, average, FIFO per category | FIFO, LIFO, average, standard, specific | Average, FIFO, LIFO, standard | FIFO or weighted average | FIFO or moving average |
| **Product picker on lines** | Required (notes and sections for text) | Required (comment lines for text) | Required | Required | Required |

What each does best:

- **ERPNext:** the shape of the data. An append-only ledger is the truth, and a per-product,
  per-warehouse balance row (its "Bin") answers "how many?" without summing the ledger.
  Cancelling a document posts a reversing entry rather than deleting one.
- **Business Central:** posted means permanent. Every quantity change is a posted line with a
  document behind it, which is what an auditor asks for.
- **NetSuite and Zoho:** the quantity vocabulary people already know: *on hand*,
  *committed* (reserved), *available*, *on order*. Zoho's adjustment reasons.
- **Odoo:** the count workflow. Pick products, record what was counted, see the difference,
  then apply it. Also the product page's smart buttons: *On hand*, *Forecast*, *Moves*.
- **Zoho:** its transfer flow requires a second warehouse, supporting Lynk's choice to hide
  warehouse selection while a tenant has only Main. That UI choice is Lynk's inference, not a
  claim about Zoho's interface.

What Lynk takes:

1. **An append-only stock ledger plus a balance row per product and warehouse** (ERPNext,
   Business Central). One service writes both in the same transaction. Nothing else writes
   stock.
2. **Single-entry moves with a warehouse and a signed quantity**, not Odoo's double entry
   between locations. A transfer is two moves sharing a document. This is enough until bins
   or in-transit stock are needed (E3+).
3. **Posted is permanent.** Draft documents can be edited and deleted. Posted ones are
   cancelled by reversing moves, which link to what they reverse.
4. **The NetSuite/Zoho words:** On hand, Reserved (from E3), Available = On hand − Reserved,
   Incoming (from E4).
5. **One warehouse is invisible.** Every tenant gets a default warehouse. Warehouse pickers
   and columns appear only when a second one exists (Zoho).
6. **Odoo's count workflow and smart figures** on the product record: on hand, available,
   and the latest movements, each one click from its full list.
7. **Lines link to a product or service, but free text stays allowed.** Every benchmark
   requires a product. Lynk's users already write free-text quotes, so a free-text line keeps
   working and simply does not touch stock. This is the HubSpot "custom line item" behaviour.

## 5. Design

### 5.1 E1 — products and services, first class

**Data.**

- `sales_quote_items` and `sales_order_items` gain `catalog_product_id` and
  `catalog_service_id` (nullable, at most one set, `ON DELETE SET NULL`). Converting a quote to
  an order copies them.
- `catalog_categories`: tenant, name, parent (one level of nesting), description, sort order.
  Products and services gain `category_id`. A category is configuration, so deleting one is
  permanent, logged, and refused while a product, service (binned ones included) or
  subcategory still uses it.
- `catalog_products` gains `cost_price` (nullable), `unit` (free text label, default
  "unit"), `barcode` (unique per tenant when set). Services gain `cost_price`, `unit`
  ("hour", "session") and `sku` (unique per tenant when set).

**Rules.**

- Every line write validates that a linked product or service is in the document's tenant:
  one shared helper, `catalog/services/line_links.py`, used by quotes, orders, quote → order
  conversion and invoices. It fixes defect 2. A deactivated or binned item still qualifies,
  so an old quote whose product was retired can still be saved; the picker offers active
  items only.
- Linking exposes the item, so a route requires `view` on the catalog module for each link
  the write *adds* (`require_linked_record_access`). A link the document already had is not
  re-checked, so someone without catalog access can still edit a quote built from it.
- Picking an item fills name, the description's first line, and unit price. The line keeps its
  own copies, so later price changes do not rewrite sent quotes; renaming a picked line keeps
  its link (HubSpot). *Unlink* makes it a custom line again.
- The picker offers only items priced in the document's currency (there is no conversion).
  The server does not refuse a currency mismatch, because a product's currency can change
  after the quote was written.

**UI.** `TransactionLineItemsEditor`'s item cell is a `LinkedRecordPicker` over
`GET /catalog/items/search` (name or SKU contains, barcode exact; exact codes listed first;
products and services in one list, labelled). Users without catalog access get the plain
text cell. Line tables on CRM pages link to the item; the client portal's do not. Product and
service records gain a *Sales* tab (`GET /catalog/{products|services}/{id}/sales`) listing
only the quotes and orders the viewer can open. Categories get Settings → Catalog
categories, a column and a filter on the catalog lists.

### 5.2 E2 — inventory data

```text
inventory_warehouses       tenant, code (unique per tenant), name, address, is_default
                           (one per tenant), is_active, deleted_at
inventory_stock_moves      append-only ledger: tenant, product, warehouse, quantity (signed,
                           never 0), move_type, occurred_at, source_type, source_id,
                           source_line_id, reverses_move_id, unit_cost (nullable),
                           on_hand_after, reason, note, created_by, created_at
inventory_stock_levels     tenant, product, warehouse, on_hand, reserved (0 until E3),
                           updated_at; unique (tenant, product, warehouse)
inventory_adjustments      document: number (ADJ-0001), warehouse, mode (quantity | count),
                           reason, status (draft | posted | cancelled), posted_at, posted_by,
                           notes, deleted_at (drafts only)
inventory_adjustment_lines product, expected (snapshot at count time), counted or delta
inventory_transfers        document: number (TRF-0001), from and to warehouse, status,
                           posted_at, posted_by, deleted_at (drafts only)
inventory_transfer_lines   product, quantity
```

`move_type`: `opening`, `adjustment`, `count`, `transfer_out`, `transfer_in`,
`website_order`, `sales_order` (§7 decision 4), `reversal`. E3 and E4 add `delivery`,
`return` and `receipt`.

The product keeps `stock_quantity` as a **cached total across warehouses**, written only by
the ledger service, so the website API, client portal, list views, saved views and reports
keep working unchanged. `track_inventory` (new, boolean) says whether the ledger applies:

- tracked: `stock_status` is derived (`in_stock` when available > 0, otherwise
  `out_of_stock`), and the product form shows the quantity read-only with an *Adjust stock*
  action instead of a field;
- not tracked: `stock_status` stays the manual value it is today (`untracked`, `in_stock`,
  `out_of_stock`, `preorder`) and nothing moves.

`unit_cost` on each move is captured from the start (the product's cost price at posting
time) even though valuation is E6, because cost history cannot be reconstructed later.

### 5.3 E2 — the ledger service

`app/modules/inventory/services/stock_ledger.py` is the only code that writes moves, levels
or a tracked product's stock fields.

```python
post_moves(db, *, tenant_id, actor_user_id, moves: list[MoveSpec]) -> list[InventoryStockMove]
```

- Validates every product and warehouse is in `tenant_id`, active, not binned, and that the
  product is tracked.
- Locks the affected level rows with `SELECT … FOR UPDATE` **in a fixed order** (product,
  then warehouse) so two postings cannot deadlock. A missing level row is inserted first.
- Refuses a move that takes on hand below zero (§7 decision 3), naming the product, the
  warehouse and the shortfall.
- Writes the moves, updates the levels and the product's cached total and status, and logs
  one activity entry per document. It flushes and never commits: the caller's document and
  its stock change succeed or fail together.
- Is idempotent per source line: a unique index on
  `(tenant_id, source_type, source_line_id, move_type)` makes a retried post a no-op instead of
  a double count.
- Emits `inventory.stock_low` when available crosses down through the reorder point (E2
  Phase 3).

`reverse_moves(db, …, source_type, source_id)` posts the opposite of every move of a
document, linked through `reverses_move_id`, under the same checks.

A rebuild command (`python -m scripts.rebuild_stock_levels`) recomputes every level from the
ledger. A test asserts that the levels always equal the ledger's sums.

### 5.4 E2 — routes, modules and permissions

| Module key (seeded) | Sidebar | Covers |
|---|---|---|
| `inventory_stock` | Inventory → Stock, Movements | Stock levels and the ledger; `configure` manages warehouses |
| `inventory_adjustments` | Inventory → Adjustments | Adjustments and stock counts |
| `inventory_transfers` | Inventory → Transfers | Transfers between warehouses |

A new sidebar group, `inventory`, sits after Catalog. Each module goes through all three
access layers (tenant enablement, department availability, role action). Actions:

- `view` lists and opens; `export` exports; `create` saves drafts; `edit` edits drafts **and
  posts** them; `delete` deletes drafts and `restore` restores them; cancelling a posted
  document needs `edit` and is logged with its reason.
- *Adjust stock* on a product record needs `create` and `edit` on `inventory_adjustments`. It
  creates and posts a one-line adjustment, so it has a document like everything else.
- A separate *post* or *approve* action and approval chains are not added here.

```text
/dashboard/inventory/stock               product × warehouse: on hand, available, reorder point
/dashboard/inventory/movements           the ledger, read only, filters, export
/dashboard/inventory/adjustments         list, /new, /[id] (draft is editable, posted is read only)
/dashboard/inventory/transfers           list, /new, /[id]
/dashboard/settings/warehouses           warehouses (configure on inventory_stock)
```

```text
GET    /inventory/stock                     levels, paged, saved-view filters
GET    /inventory/movements                 ledger, cursor-paged (strict descending id)
GET    /inventory/products/{id}/stock       one product's levels and latest movements
POST   /inventory/products/{id}/adjust      quick adjustment (create + post)
CRUD   /inventory/adjustments               plus POST /{id}/post, POST /{id}/cancel
CRUD   /inventory/transfers                 plus POST /{id}/post, POST /{id}/cancel
CRUD   /inventory/warehouses                admin
```

### 5.5 E2 — UX

- **Stock** is archetype 1 (list) on `ModuleTableShell`: product, SKU, category, warehouse
  (hidden with one warehouse), On hand, Available, Reorder point, status chip. Saved views
  ship with *Low stock* and *Out of stock*. A row opens the product.
- **Product record** gains a *Stock* section (Odoo's smart figures): On hand, Available, per
  warehouse when there are several, the last 10 movements, *View all movements* and *Adjust
  stock* (a `QuickCreateSurface`: new quantity or change, reason, note).
- **Adjustments and transfers** use the order page's document layout with
  `TransactionLineItemsEditor`'s table language: header, lines, totals of units, and a
  primary *Post* action with a confirmation that states the effect ("Posting changes stock
  for 4 products in Main warehouse. It can be reversed by cancelling, not edited").
- **Stock count** is an adjustment in `count` mode: choose a warehouse and products (or a
  category), the expected quantity is snapshotted, the counter fills *Counted*, and the
  *Difference* column shows what posting will do (Odoo). Each save of the draft re-snapshots
  the expected quantities; posting is refused if stock moved after the last save.
- **Movements** reads like a bank statement: date, product, warehouse, type, document
  (linked), change (+/−), on hand after, by whom.

All copy and visuals follow `docs/design/design.md`; quantities use tabular numerals and a
signed format, never colour alone.

### 5.6 E2 — the platform pieces it plugs into

- **Activity and timeline:** document create, post and cancel are logged; the product's
  timeline shows its movements through a `record_activity` adapter.
- **Reports:** `report_catalog.py` gains *Stock levels* and *Stock movements* sources, with
  templates *Stock on hand by warehouse*, *Low stock* and *Movements by type this month*.
- **Automation:** triggers `inventory.stock_low` and `inventory.adjustment_posted`.
- **Webhooks:** the same two events are added to `08a-webhook-event-contract.md` when 4A
  Phase 2 is approved, not before.
- **Notifications:** low stock notifies users who can view `inventory_stock`, at most once
  per product and warehouse until it recovers.
- **Import and export:** stock levels and movements export through `module_export`. Opening
  stock imports from CSV (SKU, warehouse code, quantity, unit cost) as one *opening*
  adjustment, through the persisted data-transfer jobs.
- **Recycle bin:** draft documents and warehouses (only with zero on hand everywhere).
  Posted documents and moves are never deleted.
- **Backup and restore:** the new tables join the tenant backup set.

### 5.7 Migration of existing stock

Two migrations (revision IDs ≤ 32 characters): one for the schema and backfill, then one
for PostgreSQL's append-only movement trigger:

1. Creates a *Main* warehouse (code `MAIN`, default) for every tenant.
2. Sets `track_inventory = (stock_quantity IS NOT NULL)`. This is exactly the set of products
   the website already decrements today. Recomputing tracked `stock_status` may, however,
   change a manually assigned `preorder` or `untracked` status on a quantified product; the
   migration test must cover those existing states explicitly. The 2026-10-02 dev database
   has 12 quantified `in_stock` products and 2 quantified `preorder` products. Per the
   accepted derived-status rule, the latter become `in_stock` when their balance is positive;
   this is a visible status transition and must be called out in the migration review.
3. For each tracked product with quantity > 0, writes one `opening` move into Main and its
   level row. `stock_status` is recomputed for tracked products only.

`verify_migrations` replays it. A test builds products in each of today's states and
checks the result.

## 6. Phases

### E1 — products and services (one wave)

1. Tenant check on invoice line products (defect 2), as its own commit with a test.
2. Product and service links on quote and order lines, the shared validator, quote → order
   copy, the picker in `TransactionLineItemsEditor`.
3. Categories, cost price, unit, barcode; the *Sales* section on product and service records;
   the category filter.

Acceptance: a quote built from catalog items and a free-text line converts to an order whose
lines still point at the same items; another tenant's item is refused on quotes, orders and
invoices; the product record's Sales tab lists those lines. (Grouping order *lines* in a
report needs a line-level report source, which is not in E1.)

### E2 Phase 1 — the ledger

Warehouses (one default), moves, levels, `post_moves` / `reverse_moves`, the migration, the
website order path moved onto the ledger, the product *Stock* section with *Adjust stock*,
Stock and Movements lists, Settings → Warehouses.

Acceptance: a website order and a quick adjustment both appear in Movements with who, when and
why; levels equal the ledger's sums; going below zero is refused with the shortfall named;
another tenant's product or warehouse is a 404; a tenant with one warehouse never sees a
warehouse picker.

**Phase 1 integration check (verified 2026-10-02).** The current writers are
`catalog/services/product_services.py` (`create_product` and `update_product` write
`stock_quantity`/`stock_status`) and
`website_integrations/services/website_integration_services.py::_apply_stock_decrement`.
The website order resolves and locks catalog products, creates its order and lines, then
commits once. Its ledger move must use the persisted website line ID as the idempotency key
and remain in that transaction; the line's before/after snapshots must still match the
ledger. New tracked products need an opening move for any supplied starting quantity.
The form must stop writing a tracked product's cached stock directly when the migration
lands. Phase 1 also needs a deliberate rule for existing quantified products marked
`preorder` or `untracked`, since deriving tracked status changes their displayed state.

### E2 Phase 2 — documents

Adjustments (quantity and count modes), transfers, posting and cancelling by reversal,
draft deletion through the recycle bin.

Acceptance: a count of 20 products posts only the differences; cancelling a posted transfer
returns both warehouses to their earlier quantities; cancelling is refused if it would take a
warehouse below zero.

### E2 Phase 3 — low stock and the platform

Reorder point and quantity per product (per warehouse override later), low-stock saved
views, the notification, automation triggers, report sources and templates, opening-stock
import, exports.

Acceptance: crossing the reorder point notifies once; an automation rule on
`inventory.stock_low` creates a task; *Stock on hand by warehouse* runs as a report.

### Verification for every phase

Backend unit tests per module (tenant isolation, each permission action, the ledger
invariant, idempotent re-post, negative refusal, reversal). The row locking cannot be
exercised on SQLite, so each phase that touches posting adds a PostgreSQL smoke run (two
concurrent posts to one level, rolled back), as Reports did for its date SQL. e2e at
`--workers=1`: one spec per phase, plus the rendered design guards. The usual close-out:
`codex-check.sh`.

## 7. Decisions (owner, 2026-10-01: every recommendation accepted)

| # | Decision | Decided | Why |
|---|---|---|---|
| 1 | Fulfilment (E3) or purchasing (E4) first after inventory | **Fulfilment first** | Orders already exist and are used; purchasing is all new surface |
| 2 | Several warehouses from the start | **Yes, with a default that hides itself** | Adding warehouses later means migrating every level and move |
| 3 | Can stock go below zero | **No**, refused with the shortfall named; a tenant setting can come later | The website already refuses; a ledger with negatives makes average cost meaningless |
| 4 | Until E3, should marking an order *Fulfilled* take stock out | **Yes**: from the default warehouse, for product lines only; *Cancelled* after *Fulfilled* reverses it. E3 replaces this with deliveries | Otherwise every tenant using orders has wrong stock for a whole wave |
| 5 | Costing method (E6) | **Moving average**, with FIFO as a later option | Simplest to explain and audit; Zoho and ERPNext default to it. Cost is captured on every move from E2 either way |
| 6 | Vendors (E4) | **Accounts with a *Vendor* flag**, not a separate module | One company can be both; Odoo, HubSpot and Zoho CRM work this way, and contacts and email already hang off Accounts |
| 7 | Lots, serial numbers, expiry | **Not now** | Each needs its own phase; worth it only if a tenant sells regulated or serialised goods |

## 8. Out of scope

- Support and contracts (owner ruling).
- Manufacturing, bills of materials, kits, variants, several units per product, bins, landed
  costs, drop shipping.
- A general ledger and accounting entries. E6 reports valuation and cost of goods; posting
  them to accounts belongs to an accounting module that is not planned.
- Payment links: still deferred until the owner opens them after E5.
- Multi-currency stock valuation. Valuation is in one currency, which E6 must settle (the
  tenant has no base currency today).
