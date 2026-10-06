# 12d — ERP E6: costing and valuation

This is the E6 plan from `12-erp-inventory.md` §2. It covers average cost, stock valuation,
cost of goods sold and margin. It was written on 2026-10-03 under the owner's ERP rule
(benchmark first, then plan), and no code has changed. **Twelve §5 decisions are waiting for
the owner.**

E6 builds on every earlier wave:

- E2 records a `unit_cost` on every stock move.
- E3 delivers and returns stock.
- E4 receives stock at the purchase order's cost.
- E5 flags bills whose price differs from the purchase order, and leaves stock cost alone
  "until E6" (12c §5 decision 8).

E6 also settles the currency question that `12-erp-inventory.md` §8 left open. Like every
earlier wave, it posts no accounting entries, because Lynk has no general ledger.

## 1. Where things stand (inspected 2026-10-03)

Today the cost of a stock move is `MoveSpec.unit_cost`, or the product's `cost_price` when
the caller passes none (`stock_ledger.post_moves`). `cost_price` is a manual field on the
product form.

What reading the code found:

1. **Nothing computes an average.** Every outbound move (deliveries, legacy order and website
   moves, transfers, adjustments) takes whatever `cost_price` someone last typed. Receipts are
   the only moves with a real cost (the PO line's), and that cost never reaches `cost_price`.
2. **Reversals are costed at today's price.** `reverse_moves` passes no cost, so a cancelled
   receipt or delivery comes back at the current `cost_price`, not the cost of the move it
   reverses. The value of stock drifts every time a document is cancelled.
3. **Customer returns are costed at today's price** rather than the cost the delivery left
   at (`return_services`, `move_type` `return`).
4. **There is no money on the ledger.** Moves carry a unit cost but no value. There is no
   stock value per product or warehouse, no cost of goods sold, and no margin anywhere. The
   *Stock levels* and *Stock movements* report sources have no value field.
5. **Currencies do not line up.** Each product has a `currency` (its sale price's). Purchase
   orders and sales orders each carry their own currency, and the company has a list of
   `operating_currencies` but no base currency. Nothing converts between currencies.
6. **Stock is never backdated.** `occurred_at` is always the posting time, so a moving
   average can be computed forward, move by move. BC, ERPNext and Zoho need recalculation jobs
   only because they allow backdated postings, and Lynk does not need one.

**Dev database (read on 2026-10-03):**

- 53 moves across 3 tenants: 36 opening, 11 delivery and 6 receipt. **47 of them have no
  cost**; only the 6 receipts do.
- 43 tracked products, **36 of them with no cost price**. Of the 37 products in stock,
  **32 have no cost at all**.
- Tenant 1's company lists only USD, yet 6 of its products are priced in LKR. Tenant 3 has no
  company profile.
- Receipts so far always match the product's currency.

So the migration cannot invent costs. It has to say which costs are missing (§3.6).

## 2. Benchmark

Checked 2026-10-03:

- Odoo: [automatic inventory valuation](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/inventory_valuation_config.html), [using inventory valuation](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/inventory_valuation/using_inventory_valuation.html), [average price on returned goods](https://www.odoo.com/documentation/18.0/applications/finance/accounting/get_started/avg_price_valuation.html), [valuation cheat sheet](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/inventory_valuation/cheat_sheet.html), [stock valuation dashboard](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/reporting/aging.html).
- Business Central: [costing methods](https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-costing-methods), [average cost](https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-average-cost), [cost adjustment](https://learn.microsoft.com/en-us/dynamics365/business-central/design-details-cost-adjustment), [manually adjust item costs](https://learn.microsoft.com/en-us/dynamics365/business-central/inventory-how-adjust-item-costs), [item charges](https://learn.microsoft.com/en-us/dynamics365/business-central/payables-how-assign-item-charges).
- NetSuite: [costing methods](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2191818.html), [item costing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2191369.html), [returned-item costing with multi-location inventory](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2307937.html), [group average costing](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4345703444.html), [inventory profitability report](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2358569.html), [gross profit](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1752846.html).
- Zoho Inventory: [valuation method](https://www.zoho.com/us/inventory/kb/items/item-inventory-evaluation.html), [WAC](https://www.zoho.com/us/inventory/kb/items/inventory-wac-report.html), [inventory valuation report](https://www.zoho.com/en-in/erp/help/analytic-reports/inventory-valuation-reports.html).
- ERPNext: [FIFO and moving average](https://docs.frappe.io/erpnext/fifo-and-moving-average), [calculation difference](https://docs.erpnext.com/docs/user/manual/en/calculation-of-valuation-rate-in-fifo-and-moving-average), [repost item valuation](https://docs.frappe.io/erpnext/repost-item-valuation), [change valuation method](https://docs.frappe.io/erpnext/change-valuation-method).

| | Odoo | Business Central | NetSuite | Zoho | ERPNext |
|---|---|---|---|---|---|
| **Methods** | Standard, AVCO, FIFO per category | FIFO, LIFO, average, standard, specific | Average (default), FIFO, LIFO, standard, group average | FIFO or WAC | Moving average or FIFO, per item or company |
| **Average scope** | Per product, company-wide | Setting: per item, or per item, location and variant | Per location; group average across locations | Per item | Per item and warehouse |
| **When the average moves** | Every receipt; outbound never changes it | Per average-cost period (day to month), settled by a batch job | Every receipt | Every receipt; backdated entries recalculate | Every receipt; backdating triggers a repost job |
| **Customer return cost** | Current average | Original cost (exact cost reversing) | Original sale cost, when linked to the sale | — | Original outgoing rate |
| **Bill ≠ receipt cost** | Price difference revalues stock still on hand | Expected cost replaced by actual on invoice; adjust job | Variance posted on the bill | Bill is the cost | Purchase invoice can update the receipt's rate |
| **Manual cost change** | Editing cost on an AVCO product revalues stock | Revaluation journal | Inventory revaluation (standard), adjustment | Adjustment by value | Stock reconciliation with a rate |
| **Currency** | Company currency; foreign POs converted | Local currency (LCY) | Base currency per subsidiary | Base currency | Company currency |
| **Valuation report** | Valuation per product, as of any date; aging | Inventory valuation by posting date | Inventory valuation, by location | Inventory valuation summary, FIFO lot tracking | Stock balance with value, as of any date |
| **Margin** | Margin on each order line (price − cost) | Profit % on sales lines; item sales reports | Estimated gross profit on transactions; *Inventory profitability* report | Sales by item | Gross profit report |

What each does best:

- **Odoo:** the simplest average to explain. Receipts move it, outbound never does, and the
  cost a user sees on the product is the average. Editing the cost on an average-costed
  product does not silently rewrite it: Odoo posts a revaluation of the stock on hand.
- **Business Central:** valuation is entries all the way down. Quantity and value live in
  separate entries, so a value-only correction (an item charge, a revaluation) never touches
  quantities. Returns can reverse at exactly the cost the goods left at.
- **NetSuite:** its returned-item rule is what Lynk wants: a return linked to its sale comes
  back at the sale's cost, even into another location. The *Inventory profitability* report
  shows quantity sold, cost, revenue, gross profit and margin per item, which is the margin
  report a small business asks for.
- **Zoho:** one plain valuation summary (stock on hand × average = asset value) and nothing
  else to learn.
- **ERPNext:** valuation as of any date, read straight off the stock ledger, because every
  entry stores its value. Its repost jobs show the cost of allowing backdating.

What Lynk takes:

1. **A perpetual moving average per product** (Odoo, Zoho, BC's *Item* setting), updated on
   every inbound move and unchanged by outbound ones. No recalculation jobs, because Lynk does
   not backdate (§1 finding 6).
2. **Every move stores its value** (ERPNext, BC). Value-only changes are separate entries
   (BC's value entries, Odoo's revaluations), so the quantity ledger stays as it is.
   Valuation as of any date is a sum.
3. **One base currency per company** (all five). Purchase and sales orders in another
   currency carry an exchange rate.
4. **Returns and reversals at the cost they left at** (NetSuite, BC, ERPNext).
5. **A bill price difference revalues the stock still on hand.** The rest goes to cost of
   goods sold (Odoo, BC).
6. **The product's cost becomes its average** for tracked products. Changing it is a
   *Revalue* action, not a field edit (Odoo).
7. **A valuation page and a profitability report** (Zoho's summary, NetSuite's
   *Inventory profitability*), plus margin on the order (Odoo).

## 3. Design

### 3.1 Data

```text
company profile           + base_currency (3 letters; locked once any move carries a value)
catalog_products          + stock_value (cached, base currency)
                            cost_price: for tracked products, the moving average, written only
                            by the ledger; for untracked products and services, manual, as today.
                            Every cost price is in the base currency from E6 on
inventory_stock_moves     + value (signed, base currency: quantity × unit_cost, to 0.0001)
                          + average_cost_after (the product's average once this move posted)
                          + cost_source (receipt | opening | average | return | reversal |
                                         manual | fallback | missing)
                            unit_cost: now always set, in the base currency
                          + sales_order_item_id (the order line a delivery, return or their
                            reversal served, so cost of goods per line is a sum)
inventory_revaluations    number (REV-…), tenant, product, kind (manual | bill_variance |
                          migration), bill line (optional), on_hand, average_before,
                          average_after, stock_change (value moved into or out of stock),
                          cogs_change (the part charged to goods already sold), reason,
                          reverses_id, created_by, created_at
purchase_orders           + exchange_rate (base units per one PO currency unit; NULL when equal)
sales_orders              + exchange_rate (the same; used only for margin)
adjustment lines          + unit_cost (optional; required when the product has no average yet)
```

The invariant, tested like E2's quantity invariant:

```text
product.stock_value = Σ moves.value + Σ revaluations.stock_change
                    = on hand × average (to 0.01)
```

When a move takes the last unit out, its value is −stock_value, not quantity × average.
That move absorbs the rounding, and the value is exactly zero whenever the quantity is.

### 3.2 Costing rules

Average after an inbound move = (stock value before + move value) ÷ (on hand before +
quantity). Stock never goes negative (`12-erp-inventory.md` §7 decision 3), so the division
is always defined.

| Move | Unit cost | Changes the average |
|---|---|---|
| `receipt` | PO line cost × PO exchange rate | Yes |
| `opening` (import) | The CSV's `unit_cost` (base currency) | Yes |
| `adjustment` / `count`, positive | Current average; the line's unit cost if the product has none yet | Only in the second case |
| `adjustment` / `count`, negative | Current average | No |
| `delivery`, `sales_order`, `website_order` | Current average | No |
| `return` | The cost of the delivery move it returns (`cost_source` `return`) | Yes |
| `transfer_out` / `transfer_in` | Current average, the same on both sides | No (per-product average) |
| `reversal` | **The cost of the move it reverses** (fixes §1 finding 2) | Yes, when it reverses an outbound move |

**Bill variance (Phase 2).** When a bill line is posted for a receipt line and its cost
(× exchange rate) differs from the receipt's unit cost, the service writes one revaluation:

```text
difference = (bill cost − receipt cost) × billed quantity
stock_change = difference × min(billed quantity, product on hand) ÷ billed quantity
cogs_change  = difference − stock_change
```

`stock_change` moves the average. `cogs_change` is charged to goods already gone, so cost of
goods sold for the period includes it. Voiding the bill writes the reversing revaluation. A
blank bill with no PO touches no stock, as in E5.

**Manual revaluation.** *Revalue* on a tracked product sets a new average for the quantity on
hand and requires a reason. With nothing on hand it sets the cost used by the next positive
adjustment. A revaluation is final: correcting one means making another.

### 3.3 Cost of goods sold and margin

- **Cost of goods sold** for a period is − Σ value of `delivery`, `sales_order` and
  `website_order` moves, plus the value of `return` moves (which reduces it), plus
  Σ `cogs_change`, with reversals counted against the move they reverse. (As built, the
  *Cost of goods sold* report source holds the moves; bill price differences charged to goods
  already sold are on the *Revaluations* source as *Change to cost of goods*.)
- **Order line margin**, in the base currency:
  - Revenue is the line net of tax × (delivered − returned) ÷ ordered × the order's
    exchange rate.
  - Cost of goods is the actual delivered cost minus returns.
  - Untracked products and services use their manual cost price × quantity, marked
    *estimated* (Odoo's line margin).
  - An order in another currency with no rate shows cost, but *No exchange rate* in place
    of the margin.
- **Order margin** (estimated, before delivery): the remaining quantity is costed at the
  current average, and labelled as such (NetSuite's estimated gross profit).

### 3.4 Routes, modules and permissions

| Module key | Sidebar | Covers |
|---|---|---|
| `inventory_valuation` (new) | Inventory → Valuation | Stock value, revaluations, the margin panel on orders, and the valuation and margin report sources. `edit` revalues |

The migration gives every role the same actions on `inventory_valuation` that it has on
`inventory_stock`, so nobody loses a figure they can see today. Product cost price stays
visible wherever it is visible now. Margin and stock value need `view` here.

```text
GET   /inventory/valuation                    per product: on hand, average, value; ?as_of, warehouse, category, cost_missing
GET   /inventory/valuation/summary            totals by warehouse and category, cost-missing count
CRUD  /inventory/revaluations                 list, get, create (manual); no edit or delete
GET   /sales/orders/{id}/margin               per line and total; needs view on sales_orders and inventory_valuation
existing PO and order payloads                + exchange_rate; company profile + base_currency
existing adjustment lines                     + unit_cost
```

### 3.5 UX

Everything uses the existing record, list and document primitives.

- **Inventory → Valuation** (new list page):
  - Each product shows SKU, category, on hand, average cost and stock value. Totals are in
    the base currency.
  - Filters: warehouse, category, *As of* date, and *Cost missing*. Presets: *All stock*
    and *Cost missing*.
  - A banner counts products in stock with no cost, linking to that preset.
  - The list has a *Revaluations* section tab and a CSV export.
- **Product → Stock tab:** *Average cost* and *Stock value* in the summary rail, value per
  warehouse, and *Unit cost* and *Value* columns on movements. *Revalue* opens a dialog
  (new average, reason) and shows the change in value before you confirm.
- **Product form:** for tracked products, Cost becomes read-only *Average cost*, with *Revalue*
  beside it. Untracked products and services keep an editable Cost. The field names the base
  currency.
- **Adjustment lines:** a *Unit cost* column, shown and required only for a product with no
  average yet.
- **Purchase order / sales order:** an *Exchange rate* field, shown only when the document's
  currency is not the base currency. It defaults to the last rate the tenant used for that
  currency. A PO in another currency cannot be placed without one.
- **Sales order:** a *Margin* section beside *Invoicing* (revenue, cost, margin, margin %,
  per line and total; estimated parts labelled). It is hidden without `view` on
  `inventory_valuation`.
- **Bill:** a variance line says what it did to stock (*Revalued 4 in stock, 6 to cost of
  goods*).
- **Settings → Company:** *Base currency*, locked once valuation has started, with a note
  explaining why.

### 3.6 Migration

1. **Base currency** per tenant: the first operating currency, else `USD`.
2. **Replay** every tenant's moves per product in ID order. Each move takes its unit cost as
   follows:
   - a receipt: its PO line cost;
   - a return: its delivery's cost;
   - a reversal: the cost of the move it reverses;
   - any other move that recorded a cost: that cost;
   - otherwise, the product's current `cost_price` (`cost_source` `fallback`);
   - otherwise, zero with `cost_source` `missing`.

   Each move's `value` and `average_cost_after` are written, then the product's
   `stock_value`, and `cost_price` becomes the final average when it is known.
3. **Report:** products valued, products in stock with missing cost, and receipts whose PO
   currency differs from the base currency (they get rate 1 and are listed for review). On dev
   that is expected to be about 32 products with missing cost and no currency mismatches.
4. Missing costs are fixed by *Revalue*, which is a `migration` revaluation when it is the
   first one. Nothing invents a cost.

### 3.7 Platform

- **Activity:** on the product, for revaluations and average changes from bills; on the order,
  for an exchange rate change.
- **Automation:** trigger `inventory.revalued` with the revaluation as record source. Webhooks
  wait for 4A Phase 2.
- **Reports:**
  - Sources: *Stock valuation* (product × warehouse, value as of now), *Cost of goods sold*
    (moves and `cogs_change`, by product, category, customer and month), *Sales margin*
    (order lines: delivered quantity, revenue, cost, margin, margin %), and *Revaluations*.
  - Templates: *Stock value by category*, *Stock value by warehouse*, *Cost of goods sold by
    month*, *Margin by product this month*, *Margin by customer*, *Products with missing
    cost*.
  - Value and cost fields are added to *Stock levels* and *Stock movements*, gated by
    `inventory_valuation`.
- **Exports, recycle bin and backup:** CSV exports of Valuation and Revaluations, and the
  movements export gains its value. Revaluations are final, so they never enter the recycle
  bin. Revaluations and the new columns join the inventory backup set; older backups restore,
  with their moves marked `missing`.
- **Seed samples:** a costed product received twice at different costs, delivered in part,
  with one return and one bill at a different price.

## 4. Phases

**Phase 1: the cost engine and valuation.**

- Base currency.
- The move value, average and `cost_source` columns.
- The §3.2 rules for every move type, including the reversal and return fixes.
- The PO exchange rate and adjustment unit cost.
- The migration replay.
- Manual revaluation.
- The product Stock tab and form changes.
- The Valuation page with *As of* and *Cost missing*.

This fixes §1 findings 1–4.

**Phase 2: bills and margin.**

- Bill variance revaluation and its reversal.
- The sales order exchange rate.
- Cost of goods sold.
- The order *Margin* section and `/margin`.

**Phase 3: the platform.**

- The trigger, report sources and templates.
- Value fields on the existing stock sources.
- Exports, backup and seed samples.

Acceptance, across all phases:

- **Averaging:**
  - Receive 10 at 5 and then 10 at 8: average 6.5, value 130.
  - Deliver 5: value 97.5, average still 6.5.
  - Return 2 of that delivery: they come back at 6.5 and the average stays 6.5.
  - Deliver everything: value exactly 0.
  - Cancel a receipt: it reverses at its own cost and the average returns to what it was.
- **Exchange rates:** a PO in EUR at rate 2.0 for a cost of 4 receives at 8. A PO in a
  foreign currency without a rate cannot be placed.
- **Positive adjustments:** one on a product with an average takes the average; one on a
  product with none needs a unit cost.
- **Bill variance:** a bill at 9 against a receipt at 8 for 10 units, with 4 still on hand,
  moves 4 into stock and 6 into cost of goods. Voiding the bill reverses both.
- **Revaluation:** revaluing 3 on hand to 7 sets the value to 21.
- **As of date:** valuation as of yesterday leaves out today's moves.
- **Invariant:** the §3.1 invariant holds after every scenario.
- **Margin:** an order delivered 4 of 10 at a net price of 20 and a cost of 6.5 shows revenue
  80, cost 26, margin 54.
- **Isolation and access:**
  - Another tenant's product, revaluation or order is a 404.
  - Margin and value are hidden without `inventory_valuation`.
  - Each route checks all three access layers.
- **Concurrency:** a PostgreSQL smoke run of two concurrent receipts on one product leaves a
  consistent average. The product row lock in `post_moves` already serializes them.

Verification is one pass after all phases (owner, 2026-10-02):

1. The backend tests.
2. The PostgreSQL migration replay, with the migration report run against the dev database.
3. `codex-check.sh`.
4. A browser spec.
5. The rendered guards scoped to Inventory, Purchasing and Sales orders. The new Valuation
   pages must first be added to the hand-kept guard route lists.
6. The full walk, once at the end.

## 5. Decisions (owner accepted all, 2026-10-03)

| # | Decision | Recommended | Why |
|---|---|---|---|
| 1 | Average scope | **Per product, across warehouses**; transfers do not change cost | Odoo, Zoho and BC's default; Lynk's default warehouse hides itself. Per warehouse (ERPNext, NetSuite) is additive later (§5a) |
| 2 | Valuation currency | **One base currency per company; POs and sales orders in another currency carry a typed exchange rate**, defaulting to the last one used; no rate table or feed | All five value in one company currency. Valuing each product in its own currency would make totals impossible to add up |
| 3 | What a cost price means | **Base currency from E6 on; for tracked products it is the average, read-only, changed by *Revalue*** | Odoo's AVCO behaviour; a typed cost that silently disagrees with the ledger is §1 finding 1 |
| 4 | Customer return cost | **The cost the delivery left at** | NetSuite, BC and ERPNext; Odoo's current-average rule lets a return change the average for no reason |
| 5 | Bill price differs from the receipt | **Revalue the share still on hand; charge the rest to cost of goods** | Odoo and BC; it keeps the average true. Flag-only (NetSuite's variance account) needs a ledger Lynk does not have |
| 6 | Positive adjustment cost | **Current average; a unit cost is required only when there is no average** | Odoo; a found unit is worth what the others are |
| 7 | Existing moves with no cost | **Fall back to the product's current cost price, otherwise mark *Cost missing*; never invent a cost.** Fixed by *Revalue* | 47 of 53 dev moves have none; a silent zero would understate stock |
| 8 | Who sees value and margin | **A new `inventory_valuation` module, granted like `inventory_stock`**; product cost price stays where it is visible today | Margin is sensitive; a module key reuses the three access layers instead of a field-level rule |
| 9 | Margin basis | **Delivered quantity at actual cost; services and untracked products at their manual cost, marked estimated; the undelivered rest at the current average, marked estimated** | NetSuite's actual and estimated gross profit; Odoo's line margin |
| 10 | Changing the base currency | **Locked once any move carries a value** | Changing it would need every value restated at a rate nobody has |
| 11 | Revaluations | **Final: no edit or delete; corrected by another revaluation** | Like posted moves since E2 |
| 12 | Costing method | **Moving average only** (`12-erp-inventory.md` §7 decision 5); FIFO later | Already decided; §5a keeps FIFO additive |

## 5a. Built so the deferred items are additive

| Deferred | What E6 builds now so that it is additive later |
|---|---|
| FIFO | Every move stores its quantity, unit cost and value in order. FIFO layers are a fold over those moves, and the average is computed in one function (`next_average`), so FIFO is a second strategy there |
| Average per warehouse (1) | The scope of an average comes from one function (`cost_key(product, warehouse)`), which returns the product today |
| Exchange rate table or feed (2) | The default rate comes from one function (`default_exchange_rate`). Today it reads the last rate used; later it can read a table |
| Landed costs | A landed cost is a revaluation `kind` with a source, like `bill_variance` |
| Accounting entries | Each move value and each revaluation's `stock_change` and `cogs_change` is a postable amount with a fixed meaning; a ledger maps them to accounts |
| Margin on invoices | Order line margin is computed in one function from quantities, so an invoiced basis is another input to it |

## 6. Out of scope

- A general ledger and journal entries.
- FIFO, LIFO and standard cost.
- Average per warehouse.
- Exchange rate tables and feeds, and valuation in several currencies.
- Landed costs and freight allocation.
- Backdated stock postings and recalculation jobs.
- Inventory aging.
- Lots and serial numbers.
- Manufacturing costs.
- Returns to vendors.
- Margin on the client portal.
