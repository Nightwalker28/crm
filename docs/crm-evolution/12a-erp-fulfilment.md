# 12a — ERP E3: sales fulfilment

The E3 plan from `12-erp-inventory.md` §2: reservation on confirmed orders, deliveries
(partial, backorders) and returns. Written 2026-10-02 under the owner's ERP rule: benchmark
first, then the plan, then **the owner's decisions (§5) before any code**. The owner accepted
every recommendation on 2026-10-02 and extended decision 2: oldest first is only the
default, and users can edit holds and move them between orders (§3.2, §3.5).

E3 builds on E2's ledger (`inventory/services/stock_ledger.py`) and keeps its rules: one
service writes stock, posted is permanent, a cancel posts a reversal, and nothing goes below
zero.

## 1. Where things stand (inspected 2026-10-02)

There are **two order systems**, and they treat stock differently.

**CRM sales orders** (`sales_orders`, `orders_services.py`). The status is
`draft → confirmed → fulfilled | cancelled`, set by hand from the order form. Since E2,
marking an order *Fulfilled* posts one `sales_order` move per tracked product line from the
default warehouse, and *Cancelled* after *Fulfilled* reverses those moves (E2 decision 4,
explicitly a stopgap until E3). This means:

1. **Confirming reserves nothing.** `inventory_stock_levels.reserved` exists and feeds
   *Available* on the Stock list, reports and exports, but nothing writes it, so it is always
   0. Two confirmed orders can promise the same last unit.
2. **Delivery is all or nothing.** The order cannot ship 40 of 100. A shortfall on any line
   refuses the whole *Fulfilled* change.
3. **No delivery record.** Nothing holds when goods left, from where, by which carrier, or
   how much remains to ship.
4. **No returns.** The only way to bring stock back is cancelling the whole order, which
   pretends the delivery never happened.
5. **The order has no warehouse.** Every fulfilment comes from the default one.

**Website and client-portal orders** (`website_integration_orders`). These are a separate
table with their own statuses (`submitted … completed | cancelled | rejected`). They are
not linked to sales orders. The only conversion is to a POS invoice.

6. **Website orders take stock at submission** (`website_order` move, default warehouse).
   They check *on hand*, not *available*, so once reservations exist they could sell stock
   promised to a CRM order.
7. **Defect: cancelling or rejecting a website order never returns its stock.**
   `update_order_status` changes the status and logs it. `reverse_moves` is called only by
   sales orders and inventory documents. Every cancelled website order today leaves its
   quantity missing from the ledger.
8. **Client-portal orders never touch stock.** They are created as `submitted` requests
   (`create_client_catalog_order`) and staff review them.

Also relevant: tenant restore already refuses a level whose `reserved` exceeds `on_hand`
(`tenant_restore_runs.py`). Without a reservation table it cannot rebuild `reserved`, so
the restore side has to change with Phase 1. Invoices have no link to sales orders; that
is E5.

## 2. Benchmark

Checked 2026-10-02 against current vendor documentation:

- Odoo: [reservation methods](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/reservation_methods.html), [at-confirmation reservation](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/reservation_methods/at_confirmation.html), [returns and refunds](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/returns.html), [multi-step delivery](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/delivery_three_steps.html).
- Business Central: [partial shipments](https://learn.microsoft.com/en-us/dynamics365/business-central/sales-how-send-partial-shipments), [reserving items](https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-how-to-reserve-items).
- NetSuite: [committing orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_3765928460.html), [backorders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2263962.html), [reallocating items](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2263567.html), [receiving a customer return](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1307628.html).
- Zoho: [sales orders and committed stock](https://www.zoho.com/us/books/kb/sales-order/sales-order-inventory.html), [shipments](https://www.zoho.com/us/inventory/help/sales-orders/shipments.html), [backorders](https://www.zoho.com/us/inventory/help/backorder/backorders.html), [sales returns](https://www.zoho.com/us/inventory/help/sales-returns/sales-returns-overview.html).
- ERPNext: [delivery note](https://docs.frappe.io/erpnext/delivery-note), [sales order](https://docs.frappe.io/erpnext/user/manual/en/sales-order), [stock reservation](https://docs.frappe.io/erpnext/user/manual/en/stock-reservation), [sales return](https://docs.erpnext.com/docs/user/manual/en/sales-return).

HubSpot has no fulfilment. Salesforce has it only in its separate Order Management product,
so the CRM players do not shape this module.

| | Odoo | Business Central | NetSuite | Zoho Inventory | ERPNext |
|---|---|---|---|---|---|
| **When stock is held** | On confirmation, manually, or N days before the scheduled date (per operation type) | Reservation per line, manual or automatic; *Reserved from stock* Full/Partial/None | *Commit*: available quantity, complete quantity only, or do not commit; automatic or scheduled | Committed stock as soon as the sales order exists | *Reserved qty* on submit; explicit Stock Reservation Entries when enabled |
| **Is holding a movement** | No; reserved quantity on the delivery | No; reservation entries | No; committed quantity | No; a figure | No; reservation entries, not stock ledger |
| **Short on stock** | Order confirms; delivery waits, availability shown red | Order stands; partial reservation | Backordered quantity on the line; committed later by priority | Backorder → purchase order | Order stands; projected quantity goes negative |
| **When stock arrives** | Scheduler or *Check availability* reserves it | Planning, manual reserve | Auto-commit by order priority, or *Reallocate items* | Received, then fulfil pending orders | Auto-reserve on purchase receipt (setting) |
| **Shipping document** | Delivery order (one to three steps: pick, pack, ship) | Posted sales shipment, from *Qty. to Ship* on the order | Item fulfillment | Package, then shipment (carrier, tracking, Shipped → Delivered) | Delivery Note |
| **Partial delivery** | Validate part; *Create backorder?* makes a second delivery order | *Qty. to Ship* per line; no limit on shipments; customer-level *Shipping Advice* can forbid partial | Fulfil part; the rest stays backordered | Several packages per order | Several delivery notes per order |
| **Remainder** | A backorder document, or *No backorder* to drop it | Stays on the order line | Stays on the line as backordered | Stays on the order; optional backorder PO | Stays on the order; *Close* to drop it on purpose |
| **Undo a shipment** | Return | *Undo shipment* | Delete or void the fulfillment | Delete the package | Cancel the delivery note (reverses stock) |
| **Returns** | *Return* on the delivery creates a reverse transfer, quantities default to what was shipped | Sales return order | Return authorization, then item receipt | Sales return from the order; *Receive* (partial allowed) puts stock back; damaged items can be credit-only | Return delivery note against the original |
| **Order shows** | Delivered quantity per line, delivery smart button | Quantity shipped, outstanding | Committed, fulfilled, backordered per line | Packed, shipped, invoiced status | % delivered, *To Deliver and Bill* style status |

What each does best:

- **Odoo:** reservation at confirmation as the default, a visible availability state on the
  order, and *Return* as an action on the delivery that pre-fills what was shipped.
- **Business Central and ERPNext:** the remainder stays on the order line (*outstanding*,
  *to deliver*), so there is no second document to chase. ERPNext's *Close* (deliberately
  not shipping the rest) is distinct from *Cancel* (the order never happened).
- **NetSuite:** the line-level vocabulary (*committed*, *fulfilled*, *backordered*) and
  automatic commitment of new stock to waiting orders in priority order. Reducing stock
  de-commits rather than refusing.
- **Zoho:** a light shipment record (carrier, tracking number, date), and returns that put
  stock back only when *received*, with a credit-only option for damaged goods.
- **Everyone:** reservation is a hold, not a stock movement. On hand changes only when goods
  physically leave or come back.

What Lynk takes:

1. **Reserve at confirmation, partial allowed** (Odoo *at confirmation*, NetSuite *available
   quantity*). A short order still confirms; the short quantity is *Waiting*.
2. **Reservation is a hold, not a move.** A reservation row per order line and warehouse.
   `inventory_stock_levels.reserved` is its cached sum, written by the ledger service in the
   same locked transaction as moves.
3. **New stock goes to waiting orders automatically, oldest confirmed first** (NetSuite
   auto-commit, ERPNext auto-reserve on receipt). Stock that falls below what is reserved
   releases the newest holds first (NetSuite de-commit). A count records reality instead of
   being refused.
4. **Users can edit holds and move them between orders** (NetSuite *Reallocate items*, Odoo
   *Unreserve*; owner, 2026-10-02). Oldest first is the default, not a rule: a newer, more
   urgent order can be given stock an older one holds. A hold set by hand is *manual*, and a
   shortage releases automatic holds before manual ones (NetSuite's *firm* lines).
5. **One-step deliveries with a light shipment record**: warehouse, date, carrier and
   tracking number (Zoho, ERPNext). Pick and pack steps, packages and carrier integrations
   are out (§7).
6. **The remainder stays on the order line** (Business Central, ERPNext, NetSuite), shown
   as *To deliver*. There is no separate backorder document. **Close remaining** (ERPNext)
   ends an order without shipping the rest and releases its holds.
7. **Cancelling a posted delivery undoes it** (ERPNext cancel, Business Central *Undo
   shipment*), posted as a reversal. That is for mistakes. Goods coming back are a
   **return**.
8. **Returns start from a delivery** and default to what it shipped (Odoo). Stock comes back
   on *Receive*. Each line can be marked *Don't restock* for damaged goods (Zoho
   credit-only). Credit notes are E5.
9. **Line vocabulary:** Ordered, Reserved, Delivered, Returned, To deliver (NetSuite,
   Business Central).

## 3. Design

### 3.1 Data

```text
inventory_reservations     tenant, order (sales_orders), order line, product, warehouse,
                           quantity (> 0), manual (bool: set by a user, §3.2),
                           created_at, updated_at, updated_by;
                           unique (tenant, order_line, warehouse)
inventory_deliveries       document: number (DEL-0001), tenant, sales order, warehouse,
                           status (draft | posted | cancelled), shipped_on, carrier,
                           tracking_number, notes, posted_at, posted_by, cancel_reason,
                           migrated (bool, §3.6), deleted_at (drafts only), created_at
inventory_delivery_lines   delivery, order line, product, quantity (> 0);
                           unique (delivery, order line)
inventory_returns          document: number (RET-0001), tenant, delivery, sales order,
                           warehouse (defaults to the delivery's), status
                           (draft | received | cancelled), reason, received_at,
                           received_by, notes, deleted_at (drafts only), created_at
inventory_return_lines     return, delivery line, product, quantity (> 0), restock (bool)
sales_orders               + warehouse_id (nullable, default warehouse when NULL)
                           + delivery_status (none | pending | partial | delivered),
                             a cached figure for lists and saved views
```

New `move_type`s: `delivery`, `return`. Reversals keep `reversal`.

Per order line, the quantities are derived, not stored:

- **Delivered** = posted delivery lines − cancelled ones.
- **Returned** = received, restocked or not, return lines.
- **Reserved** = its reservation rows.
- **To deliver** = ordered − delivered, or 0 once the order is closed.

Only tracked product lines take part. Service, free-text and untracked-product lines are
never reserved or delivered; an order made only of those has `delivery_status = none` and
keeps today's manual *Fulfilled*.

### 3.2 The ledger service grows a reservation half

`stock_ledger.py` remains the only writer of moves, levels and reservations. It gains:

```python
reserve_for_order(db, *, tenant_id, order) -> None        # hold what is available, per line
release_for_order(db, *, tenant_id, order, lines=None)    # drop holds (cancel, close, edit)
set_reservations(db, *, tenant_id, product_id, warehouse_id, holds, expected_version)
                                                          # a user's edit or reallocation
```

- Same locks and order as `post_moves`: products by ID, then levels by product and
  warehouse. A posting and a reservation on the same product serialise.
- `reserve_for_order` holds `min(to deliver − reserved, available)` per line. *Available*
  is on hand minus other holds. It never fails for shortage; the shortfall is the line's
  *Waiting* quantity.
- **`post_moves` changes in three places:**
  - A delivery move consumes its line's reservation, then on hand.
  - A positive move, such as an adjustment, transfer in, return or opening stock, then
    reserves for waiting lines of confirmed orders on that product and warehouse,
    oldest order first, until the new stock runs out. One query, under locks already held.
  - A negative move that is not a delivery may take on hand below reserved (a count that
    finds less), but never below zero. Holds on that level are then released until
    reserved ≤ on hand: automatic holds before manual ones, newest order first within each. The affected orders get an activity entry and their owner a
    notification, *"2 units of X are no longer reserved for SO-0042"*.
- **`set_reservations`** applies a user's edit of the holds on one product in one warehouse
  in a single locked step: for each confirmed order line, its new reserved quantity. It
  refuses a hold above the line's *To deliver*, a line that is not on a confirmed order for
  that product and warehouse in the tenant, a total above on hand, and a stale edit (the
  level changed since the user opened it; `expected_version` is the level's `updated_at`).
  Every hold it changes becomes `manual`. Moving 3 units from SO-0040 to SO-0042 is one
  call that lowers one hold and raises the other, so nothing else can take them in
  between. Units a user releases without giving them to another order stay free until the
  next positive move or *Check availability* offers them to waiting orders, oldest first.
  Each affected order gets an activity entry, and the owner of an order that lost stock is
  notified.
- **Planned outbound moves check available, not on hand**: `website_order`, the
  *Fulfilled* shortcut's `sales_order` moves, and `transfer_out`. A website order can no
  longer take stock promised to a confirmed order (§1 item 6), and a transfer cannot strip
  a warehouse of held stock; reallocate first. Only adjustments and counts, which record
  what is physically there, may go below what is held.
- The invariant test widens: levels equal the ledger's sums, and `reserved` equals the sum
  of reservation rows, never more than on hand.

### 3.3 Sales order rules

| Event | Stock effect |
|---|---|
| Draft saved | Nothing |
| Confirmed (or created confirmed, or converted from a quote) | `reserve_for_order` |
| Confirmed order's lines or warehouse edited | Release and re-reserve the changed lines. A line cannot drop below its delivered quantity, and a line with deliveries keeps its product |
| Delivery posted | Its moves consume holds; `delivery_status` recomputed; all lines delivered → status *Fulfilled* |
| Delivery cancelled | Reversal moves; the quantity goes back to *To deliver*, re-reserved if stock allows; *Fulfilled* → *Confirmed* |
| *Close remaining* | Holds released, *To deliver* becomes 0, status *Fulfilled*; logged with a reason |
| Order cancelled | Allowed only while no delivery is posted (cancel those first, or return the goods). Holds released |
| *Fulfilled* chosen by hand on an order with undelivered tracked lines | Shortcut: creates and posts one delivery for everything remaining from the order's warehouse, in the same transaction. Refused with the shortfall named if stock is short. Today's one-click path keeps working, but now through a document |

The order's existing *Fulfillment* form section gains **Warehouse**. It is shown only with
two or more warehouses (E2's rule) and editable until something is delivered.

### 3.4 Routes, modules and permissions

| Module key (seeded) | Sidebar | Covers |
|---|---|---|
| `inventory_deliveries` | Inventory → Deliveries | Deliveries |
| `inventory_returns` | Inventory → Returns | Returns |

Reservation needs no module of its own. It follows the order, and its figures appear where
`inventory_stock` is visible.

- `view` lists and opens; `create` saves drafts; `edit` edits drafts, **posts** and cancels
  posted ones (cancel needs a reason); `delete`/`restore` remove and restore drafts through
  the Recycle Bin; `export` exports.
- Creating a delivery from an order needs `view` on `sales_orders` and `create` on
  `inventory_deliveries`. Posting needs `edit`. A return needs `view` on the delivery and
  `create`/`edit` on `inventory_returns`.
- **The *Fulfilled* shortcut needs `edit` on the order and `create` + `edit` on
  `inventory_deliveries`.** Without them, *Fulfilled* is disabled on orders with tracked
  lines, with the reason shown. This is a behaviour change for users who can edit orders
  but cannot ship. *Close remaining* needs `edit` on the order.
- **Editing or reallocating holds needs `edit` on `sales_orders` and `view` on
  `inventory_stock`.** It changes several orders at once, so the role action is checked
  once for the module; every order it touches is in the tenant and confirmed.
- All three access layers on every route. Linked records (order, delivery, warehouse,
  product) are checked in the tenant, as in E2.

```text
GET    /inventory/deliveries                list, paged, saved-view filters
POST   /inventory/deliveries                draft from an order (lines default to To deliver)
GET    /inventory/deliveries/{id}
PATCH  /inventory/deliveries/{id}           draft only
POST   /inventory/deliveries/{id}/post
POST   /inventory/deliveries/{id}/cancel    reason required
DELETE /inventory/deliveries/{id}           draft → recycle bin
(the same five for /inventory/returns, with /receive in place of /post)
GET    /sales/orders/{id}/fulfilment        per line: ordered, reserved, delivered, returned,
                                            to deliver, waiting; deliveries and returns
POST   /sales/orders/{id}/reserve           "Check availability": reserve what is free now
POST   /sales/orders/{id}/close-remaining   reason required
GET    /inventory/products/{id}/reservations?warehouse_id=
                                            open order lines for that product and warehouse:
                                            order, customer, confirmed, delivery date, to
                                            deliver, reserved, manual; plus on hand and version
PUT    /inventory/products/{id}/reservations   set_reservations (§3.2)
```

### 3.5 UX

- **Order record.** A *Fulfilment* tab, archetype per `docs/design/design.md`. The line table
  shows Ordered, Reserved, Delivered, Returned and To deliver in tabular numerals, with an
  availability chip per line (*Reserved*, *Partly reserved*, *Waiting*) as text plus colour,
  never colour alone. Below it are the order's deliveries and returns, each linked. Header
  actions: **Create delivery** (primary when anything is reservable or reserved), *Check
  availability*, *Close remaining*.
- **Order list.** A *Delivery* column (`StatusValue`). Saved views *To deliver* and
  *Waiting for stock* are seeded once, on first visit, as E2's *Low stock* is.
- **Delivery.** The adjustment/transfer document layout. The header holds order, warehouse,
  shipped on, carrier and tracking number. Lines are order line, product, To deliver and
  *This delivery*, pre-filled with what is reserved. *Post* confirms the effect: *"Posting
  takes 12 units of 3 products out of Main. The rest of SO-0042 stays to deliver."*
- **Return.** Started from a posted delivery (*Return* action). Lines default to delivered
  minus already returned, each with a *Restock* switch (on by default). Reason is required;
  *Receive* confirms the effect.
- **Reservations dialog** (NetSuite *Reallocate items*). One product in one warehouse:
  every open order line for it, with order, customer, confirmed date, delivery date, To
  deliver and an editable **Reserved** quantity. Rows are oldest first, the default
  allocation. The footer keeps a running *Unallocated: 4 of 20 on hand* and refuses to save
  above on hand. Manual holds carry a *Manual* chip. Saving shows what changes (*"SO-0040
  loses 3, SO-0042 gains 3"*). It opens from the product's Stock tab (the *Reserved* figure)
  and from a line on the order's Fulfilment tab (*Reallocate…*). With several warehouses, a
  warehouse switcher heads it.
- **Product record, Stock tab.** A *Reserved* figure beside On hand and Available, opening
  the Reservations dialog.
- **Movements.** Delivery and return moves link to their documents.

### 3.6 Existing data

One schema migration, revision ID ≤ 32 characters:

1. Adds the tables and the two order columns. `delivery_status` is computed for existing
   orders.
2. **Confirmed orders get reservations** in order of confirmation (`created_at`, then ID),
   from available stock, exactly as `reserve_for_order` would. Some may be partly
   *Waiting*. That is accurate, and the migration review lists the count.
3. **Historically fulfilled orders get one posted delivery each, flagged `migrated`.** Its
   lines mirror the order's `sales_order` moves. Moves are append-only and cannot be
   re-sourced, so a migrated delivery is cancelled by reversing those `sales_order` moves.
   Every order with stock history then has a delivery to show and to return from. No new
   move is posted.
4. Orders fulfilled before E2, with no moves, get no delivery. They had no stock effect
   then and get none now.

`verify_migrations` replays it. A populated-data test covers a confirmed order with full,
partial and no stock, a fulfilled order with moves, a pre-E2 fulfilled order, and a
cancelled order. The dev database's order counts by status are checked read-only before
writing the migration (they were not checked for this plan; the stack was down).

### 3.7 Website and portal orders

- **Fix:** cancelling or rejecting a website order reverses its `website_order` moves, in the
  same transaction as the status change. Reopening a cancelled website order is refused,
  as for sales orders. This is §1 defect 7, fixed first as its own commit with a test.
- Website orders take only **available** stock (§3.2).
- Client-portal orders stay stock-free requests in E3 (§5 decision 7).

### 3.8 Platform pieces

- **Activity and timeline:** delivery and return create, post or receive, and cancel are
  logged against the document and the order. Reservation releases caused by a count are
  logged on the order.
- **Automation:** triggers `inventory.delivery_posted`, `inventory.return_received`, staged
  with the transaction and dispatched after commit (E2's `stage_inventory_event`). Webhooks
  wait for 4A Phase 2, as in E2.
- **Notifications:** the order owner, when stock arrives and fully reserves a waiting order
  (*"SO-0042 is ready to deliver"*), and when a count releases a hold.
- **Reports:** sources *Deliveries* and *Order lines to deliver* (the backorder report),
  with templates *Backorders by product*, *Deliveries this month* and *Returns by reason*.
- **Export:** deliveries and returns lists through `module_export`.
- **Recycle bin:** draft deliveries and returns, as E2's drafts.
- **Backup and restore:** deliveries and returns join the inventory set. Reservations do
  not: they are derived from confirmed orders and stock, and orders and stock are restored
  separately. After an inventory or sales-order restore, `rebuild_reservations` keeps each
  hold that still belongs to a confirmed order line in that warehouse, clamps holds to stock
  (automatic first, newest order first) and recomputes `reserved`. The backup's `reserved`
  figure is ignored. `scripts/rebuild_stock_levels.py` reports and fixes the same drift.

## 4. Phases

### E3 Phase 0 — the website defect

Cancelling or rejecting a website order returns its stock (§3.7). Its own commit with a test.

### E3 Phase 1 — reservation

Reservation table, `reserve_for_order` / `release_for_order` / `set_reservations`, the
three `post_moves` changes, the Reservations dialog, order lines that keep their IDs when
an order is edited (holds, and Phase 2's deliveries, point at them), order confirm, edit, cancel and warehouse, website orders on available stock, the
migration's reservation step, *Check availability*, Reserved on the product's Stock tab, and
restore rebuilding `reserved`.

Acceptance:

- Two confirmed orders for the last 5 units: the first holds 5, the second waits.
- An adjustment of +3 reserves 3 for the second order automatically.
- A count that finds 2 fewer releases the newest automatic hold and tells its owner.
- Moving 3 units from the older order to a newer one in the Reservations dialog makes both
  holds manual; a later shortfall releases automatic holds first; a stale edit is refused;
  a total above on hand is refused.
- A website order cannot take reserved stock.
- `reserved` equals the reservation rows and never exceeds on hand.
- Another tenant's order or warehouse is a 404.

### E3 Phase 2 — deliveries

Delivery documents, partial delivery, *To deliver*, *Close remaining*, the *Fulfilled*
shortcut, cancelling a delivery, `delivery_status`, the order's Fulfilment tab, the order
list column and saved views, and migrated deliveries for historical orders.

Acceptance:

- An order for 100 ships 40, then 60, and becomes *Fulfilled* after the second.
- Cancelling the second delivery returns 60 to stock and to *To deliver*, re-reserved.
- *Close remaining* after 40 releases the other 60.
- Cancelling an order with a posted delivery is refused.
- The one-click *Fulfilled* on a fully stocked order posts one delivery.
- A historically fulfilled order shows its migrated delivery.

### E3 Phase 3 — returns and the platform

Return documents (receive, restock or not, partial, cancel by reversal), the Returned column,
automation triggers, notifications, report sources and templates, exports, recycle bin,
backup and restore.

Acceptance:

- Returning 5 of 40 delivered, 2 not restocked, adds 3 to stock and shows Returned 5.
- A second return cannot exceed the 35 remaining.
- An automation rule on `inventory.delivery_posted` creates a task.
- *Backorders by product* runs as a report.

### Verification for every phase

As E2: backend tests per phase (tenant isolation, each permission action, the reservation
invariant, idempotent re-post, refusal paths, reversal), a PostgreSQL smoke run for each
phase that changes locking (reservation and posting racing on one product, rolled back),
one e2e spec per phase through `scripts/e2e.sh` with the guards scoped to the touched
routes, the full rendered walk once at E3's close, and `codex-check.sh`. Per the owner's
cadence, implement the whole phase, then test once and fix once.

## 5. Decisions (owner, 2026-10-02: every recommendation accepted, decision 2 extended)

| # | Decision | Recommended | Why |
|---|---|---|---|
| 1 | When to reserve | **On confirmation, automatically, partial allowed** | Odoo's default and NetSuite's *available quantity*. Manual reservation is a step people forget |
| 2 | New stock and waiting orders | **Reserved automatically, oldest confirmed order first, by default. Owner: users can also edit holds and move them to another order (a newer, more urgent one), and a hold set by hand is released last** | NetSuite auto-commit and *Reallocate items*, ERPNext auto-reserve on receipt. E4 receipts fill backorders with no extra step |
| 3 | A count finds less than is reserved | **The count posts; automatic holds are released before manual ones, newest first, and their owners told** | Refusing a count denies physical reality; NetSuite de-commits the same way |
| 4 | Where the remainder lives | **On the order line as *To deliver*, no backorder document** | Business Central, ERPNext, NetSuite and Zoho. Odoo's second delivery order adds a document to chase |
| 5 | Marking an order *Fulfilled* by hand | **Kept, as a shortcut that posts one full delivery**; needs delivery permissions | Keeps today's one-click path for simple sellers while every stock change has a document |
| 6 | Cancelling an order that has shipped | **Refused; cancel the delivery (a mistake) or return the goods** | Replaces E2's stopgap where cancelling a fulfilled order quietly put stock back. ERPNext and Business Central work this way |
| 7 | Client-portal orders | **Stay stock-free requests in E3** | They arrive as `submitted` for staff review. Holding stock for an unreviewed request needs its own rule; revisit with E5 when orders and invoices meet |
| 8 | Returns without restocking | **Yes, a per-line *Restock* switch** | Zoho credit-only; damaged goods must not re-enter sellable stock |
| 9 | Shipping depth | **Carrier and tracking number as text; no packages, labels or carrier integrations** | Every player has a light record; integrations are provider work, deferred like WhatsApp sending |
| 10 | Pick, pack, ship steps | **One step** | Odoo's two- and three-step flows need bins and locations, which are out of scope |

## 6. What changes for current users

- Confirmed orders begin holding stock, so *Available* drops on the Stock list. Website
  orders can no longer sell stock that is held.
- Cancelling a fulfilled order no longer puts stock back silently; the delivery is
  cancelled, or the goods returned.
- Users who can edit orders but have no delivery permission lose *Fulfilled* on orders with
  tracked lines (§3.4). Seeded roles that edit orders get delivery permissions, so this
  affects only custom roles.

## 6a. Follow-ups (owner, 2026-10-02)

The owner asked for three items the first E3 cut left out:

1. **Delivery notes.** `/dashboard/inventory/deliveries/{id}/print` is a packing slip: company,
   ship-to (the order's delivery address), order, carrier and tracking, quantities only (no
   prices), a signature line. It is drawn in semantic tokens, and the `print-document` print
   rule turns it into black ink on white paper, so it needs no design exemption.
2. **Client-portal orders and stock** (replaces §5 decision 7). A portal order stays a request
   while staff review it. Confirming it (or moving it to in progress or completed) creates a
   linked CRM sales order (`website_integration_orders.sales_order_id`), which holds stock
   like any confirmed order. *Completed* ships everything left through a delivery, refused
   with the shortfall named; *cancelled* or *rejected* cancels the sales order and releases
   its holds, refused once it has shipped. A confirmed portal order cannot go back to review.
   Website API orders keep taking stock at submission.
3. **Order priority**: urgent, high or normal (default) on the order, editable in place on
   the record. Arriving stock goes to waiting orders by priority, then oldest; a shortage
   releases automatic holds before manual ones and, within each, the lowest priority, newest
   order first. Raising a priority does not take stock from other orders on its own; use
   the Reservations dialog for that.

Webhooks for the two E3 events still wait for 4A Phase 2.

## 7. Out of scope

Pick/pack/ship steps, packages, shipping labels, carrier rate quotes and tracking sync, drop
shipping, reservation for draft orders or quotes,
credit notes and refunds (E5), purchase-driven backorders (E4), and everything in
`12-erp-inventory.md` §8.
