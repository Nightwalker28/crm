# 12b — ERP E4: purchasing

The E4 plan from `12-erp-inventory.md` §2: vendors, purchase orders, receipts, incoming
stock, and reorder suggestions that become draft purchase orders. Written 2026-10-02 under
the owner's ERP rule (benchmark, then plan). The owner asked for E4 to be built through all
its phases before testing, so the decisions in §5 are the recommended ones, taken and listed
for the owner to override.

E4 builds on E2's ledger and E3's reservations: a receipt is a positive stock move, so it fills
waiting sales-order lines automatically (E3 §3.2), and it records the purchase cost on the
move, which E6 needs for valuation.

## 1. Where things stand (inspected 2026-10-02)

- **No vendors.** Accounts (`sales_organizations`) are customers only. §7 decision 6 of
  `12-erp-inventory.md` (accepted): vendors are Accounts with a *Vendor* flag.
- **No purchasing at all.** Stock comes in only through adjustments, counts, opening stock
  and returns. The ledger already records `unit_cost` on every move, taken from the
  product's `cost_price` when the caller gives none.
- **Reorder points exist** (E2 Phase 3): `catalog_products.reorder_point` and
  `reorder_quantity`, the *Low stock* view, notification and `inventory.stock_low` trigger.
  Nothing turns them into an order.
- **Backorders exist** (E3): confirmed orders wait for stock, and any positive move fills
  them by priority, then age.

## 2. Benchmark

Checked 2026-10-02:

- Odoo: [reordering rules](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html), [replenishment strategies](https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/inventory/product_management/product_replenishment/strategies.html), [receiving entirely or partially](https://www.odoo.com/documentation/13.0/applications/inventory_and_mrp/purchase/purchases/rfq/reception.html).
- Business Central: [purchasing overview](https://learn.microsoft.com/en-us/dynamics365/business-central/purchasing-manage-purchasing), [receiving items](https://learn.microsoft.com/en-us/dynamics365/business-central/warehouse-how-receive-items), [requisition lines](https://learn.microsoft.com/en-us/dynamics365/business-central/application/base-application/table/microsoft.inventory.requisition.requisition-line).
- NetSuite: [receiving purchase orders](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2411320.html), [partially receiving](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2411754.html), [ordering items (reorder point, preferred vendor)](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2403352.html).
- Zoho Inventory: [reorder level](https://www.zoho.com/us/inventory/kb/items/item-reorder.html), [preferred vendor](https://www.zoho.com/us/books/kb/items/preferred-vendor.html).
- ERPNext: [procurement cycle](https://docs.erpnext.com/docs/user/manual/en/procurement-cycle-overview), [purchase order](https://docs.erpnext.com/docs/user/manual/en/purchase-order), [auto material request at reorder level](https://docs.erpnext.com/docs/user/manual/en/auto-creation-of-material-request).

| | Odoo | Business Central | NetSuite | Zoho Inventory | ERPNext |
|---|---|---|---|---|---|
| **Vendor** | A contact (any partner can be a vendor) | Vendor card, separate from customer | Vendor record | Vendor contact | Supplier |
| **Product's vendor** | Vendor price lines on the product | Vendor No., vendor item no. | Preferred vendor, vendor price | Preferred vendor | Default supplier |
| **Before the order** | RFQ, sent, then confirmed as PO | Requisition worksheet lines → POs | Order Items page → POs | *Order now* on reorder items | Material Request → RFQ → Supplier Quotation |
| **Receiving** | Receipt (a transfer), partial with *Create backorder?* | *Qty. to Receive* on the PO, posted receipt | Item Receipt from the PO, partial | Purchase Receive from the PO, partial | Purchase Receipt from the PO, partial |
| **Remainder** | A backorder receipt, or none | Stays on the PO line | Stays on the PO line | Stays on the PO | Stays on the PO; *Close* |
| **On order** | Forecast includes incoming | Qty. on Purch. Order | On Order | Quantity ordered (incoming) | Ordered qty, projected qty |
| **Reorder** | Min/max rules; manual (Replenishment report) or automatic PO | Planning / requisition worksheet | Reorder point, *Order Items* by preferred vendor | Reorder level + preferred vendor → *Order now* | Reorder level → auto Material Request |
| **Cost** | PO price → receipt valuation | Direct unit cost → item ledger | PO rate → receipt | PO rate | PO rate → valuation rate |

What each does best:

- **Odoo:** any contact can be a vendor (the same company can buy and sell), and the manual
  Replenishment report with a *To reorder* filter: one screen that answers "what should I
  buy?".
- **Zoho and NetSuite:** the preferred vendor on the product, so reorder items group by
  vendor into one purchase order each (*Order now*, *Order Items*).
- **Business Central, NetSuite, ERPNext:** the remainder stays on the PO line; a receipt is a
  separate posted document, partial as often as needed. ERPNext's *Close* ends a PO short.
- **NetSuite and Zoho:** the vocabulary: On order (incoming), Available, and projected stock
  that adds what is coming.
- **Everyone:** the receipt carries the PO's cost into stock.

What Lynk takes:

1. **Vendors are Accounts with a Vendor flag** (Odoo; §7 decision 6). Vendor pickers search
   flagged accounts; contacts and email already hang off Accounts.
2. **Preferred vendor, vendor SKU and lead time on the product** (Zoho, NetSuite, BC).
3. **Purchase orders:** draft → ordered → received, with *Close remaining* (ERPNext) and
   cancel while nothing is received. Lines are tracked products with quantity and unit cost.
4. **Receipts are separate posted documents, partial allowed, remainder on the PO line**
   (BC, NetSuite, ERPNext, Zoho), mirroring E3's deliveries. Posting moves stock in at the PO
   line's cost; cancelling posts the reversal.
5. **Incoming** (on order less received) shown beside On hand and Available, and a projected
   figure (Available − Backordered + Incoming) for reordering (NetSuite, Zoho, ERPNext's
   projected quantity).
6. **A Reorder screen** (Odoo's Replenishment report, Zoho's *Order now*): tracked products
   whose projected stock is at or below their reorder point, with a suggested quantity,
   grouped by preferred vendor; selected rows become one draft PO per vendor and warehouse.
   Nothing is ordered automatically.
7. **Receipts fill backorders.** A posted receipt is a positive move, so E3 reserves it for
   waiting sales orders at once, by priority, then age.

## 3. Design

### 3.1 Data

```text
sales_organizations     + is_vendor (0/1)
catalog_products        + preferred_vendor_id (→ sales_organizations, SET NULL),
                          vendor_sku, lead_time_days
purchase_orders         number (PO-…), tenant, vendor (→ sales_organizations), warehouse,
                        currency, status (draft | ordered | received | closed | cancelled),
                        receipt_status (none | partial | received), expected_date,
                        vendor_reference, notes, subtotal, ordered_at, ordered_by,
                        closed_at, close_reason, cancel_reason, owner, deleted_at (drafts)
purchase_order_lines    order, product (tracked), description, quantity (> 0),
                        unit_cost (≥ 0), line_total, sort_order
purchase_receipts       number (RCV-…), tenant, purchase order, warehouse, status
                        (draft | posted | cancelled), received_on, vendor_delivery_ref,
                        notes, posted_at, posted_by, cancel_reason, deleted_at (drafts)
purchase_receipt_lines  receipt, purchase order line, product, quantity (> 0)
```

New `move_type`: `receipt` (`source_type` `purchase_receipt`), with `unit_cost` from the
PO line.

Per PO line: **Received** = posted receipt lines; **To receive** = ordered − received, or 0
once the PO is closed. Per product and warehouse: **Incoming** = To receive across ordered
POs; **Backordered** = what confirmed orders still need beyond their holds (E3 *Waiting*);
**Projected** = Available − Backordered + Incoming. The product's Stock tab and the Reorder
screen show the same Projected.

### 3.2 Rules

| Event | Effect |
|---|---|
| Draft PO saved | Nothing. Lines editable, vendor must be a flagged Account in the tenant |
| *Mark as ordered* | Lines lock; the PO counts as Incoming. Needs at least one line |
| Receipt posted | Stock moves in at each PO line's unit cost; waiting sales orders are reserved at once; PO `receipt_status` recomputed; all received → status *received* |
| Receipt cancelled | Reversal moves (may release holds, as a count does); PO back to *ordered* |
| *Close remaining* | To receive becomes 0; status *closed*; needs something received and no draft receipt |
| PO cancelled | Only while ordered or draft with no posted receipt |
| Over-receipt | Refused: a receipt line cannot exceed To receive |

### 3.3 Routes, modules and permissions

| Module key (seeded) | Sidebar | Covers |
|---|---|---|
| `purchase_orders` | Purchasing → Purchase orders, Reorder | Purchase orders, the Reorder screen |
| `purchase_receipts` | Purchasing → Receipts | Receipts |

A new sidebar group, *Purchasing*, after Inventory. All three access layers on every route.
`edit` on purchase orders marks ordered, closes and cancels; `edit` on receipts posts and
cancels. The Reorder screen needs `view` on `inventory_stock` and `purchase_orders`;
creating POs from it needs `create` on `purchase_orders`. Flagging an Account as a vendor is
an ordinary Account edit.

```text
CRUD   /purchasing/orders              + /{id}/order, /{id}/close, /{id}/cancel, /{id}/restore
CRUD   /purchasing/receipts            + /{id}/post, /{id}/cancel, /{id}/restore
GET    /purchasing/reorder             suggestions (projected ≤ reorder point)
POST   /purchasing/reorder/orders      selected rows → draft POs, one per vendor and warehouse
GET    /catalog/vendors/search         flagged Accounts, for pickers
```

### 3.4 UX

- **Accounts:** a *Vendor* switch on the form and record, a Vendor column and filter, and a
  *Vendors* preset view.
- **Product:** Preferred vendor (picker over vendors), Vendor SKU, Lead time (days) on the
  form; the Stock tab gains *Incoming* and *Projected*.
- **Purchase order:** E3's document layout. Draft: vendor, warehouse (only with two or
  more), expected date, vendor reference, lines (product, description, quantity, unit cost,
  total). Ordered: read-only lines with Received and To receive, *Receive* (primary), *Close
  remaining*, *Cancel*, *Print* (a purchase order document with prices, `print-document`).
- **Receipt:** from the PO (*Receive*), lines default to To receive; received on, vendor
  delivery reference; *Post* states the effect, including backorders it will fill.
- **Reorder:** archetype 1. Product, warehouse, available, incoming, projected, reorder point,
  suggested quantity (editable), preferred vendor; select rows, *Create draft purchase
  orders*. Rows without a preferred vendor link to the product to set one.
- **Stock list:** Incoming column.

### 3.5 Platform

- Activity on PO and receipt create, order, post, close and cancel, and on the vendor Account.
- Automation trigger `purchase.receipt_posted`; record sources for both documents.
- Reports: *Purchase orders* and *Purchase lines to receive*; templates *Incoming stock by
  product*, *Spend by vendor this month*.
- CSV exports of both lists; draft POs and receipts in the recycle bin; both in the inventory
  backup set.

## 4. Phases

**Phase 1 — vendors and purchase orders.** Vendor flag, product purchasing fields, purchase
orders through ordered, close and cancel, Incoming and Projected, PO print.

**Phase 2 — receipts.** Receipt documents, partial receipts, stock in at cost, backorders
filled, PO status, cancel by reversal.

**Phase 3 — reorder and the platform.** The Reorder screen and draft POs from it, the
trigger, reports, exports, recycle bin, backup.

Acceptance (all phases): a PO for 10 receives 4, then 6, and becomes received; the receipt
moves carry the PO cost; a receipt of 3 for a product with a waiting order of 2 reserves 2
for that order; cancelling a receipt reverses it; over-receipt is refused; another tenant's
vendor or product is a 404; the Reorder screen suggests a product at its reorder point, and
creating POs groups lines by preferred vendor.

Verification: one pass after all three phases (owner, 2026-10-02): backend tests, the
PostgreSQL migration replay, `codex-check.sh`, a browser spec, the rendered guards.

## 5. Decisions (taken as recommended; owner reviewed and accepted all, 2026-10-03)

| # | Decision | Taken | Why |
|---|---|---|---|
| 1 | Who is a vendor | **An Account with a Vendor flag** | Already decided (§7 decision 6 of `12-erp-inventory.md`) |
| 2 | Receiving | **Separate receipt documents, partial allowed, the rest stays on the PO line** | BC, NetSuite, ERPNext, Zoho; mirrors E3 deliveries |
| 3 | What can be bought | **Tracked products only** | Services and expenses are vendor bills (E5); untracked products have no stock to receive into |
| 4 | Reordering | **A suggestion screen; draft POs on request, never automatic** | Odoo's manual mode, Zoho's *Order now*; no PO is sent without a person |
| 5 | Suggested quantity | **The larger of the reorder quantity and what brings projected stock back to the reorder point** | Reorder quantity is the lot size; the floor guarantees the point is reached |
| 6 | Over-receipt | **Refused** | Edit the PO first; tolerances can come later |
| 7 | Cost on receipt | **The PO line's unit cost**, captured on the move | E6 needs it; changing cost means editing the PO before ordering |
| 8 | Approvals, RFQs, vendor price lists, emailing POs | **Not now** | Each is its own flow; print covers sending today |

## 6. Out of scope

Vendor bills and three-way matching (E5), landed costs and valuation (E6), RFQs and vendor
quotations, vendor price lists and minimum order quantities, purchase approvals, drop
shipping, automatic PO creation, returns to vendor, multi-currency costing (E6 settles the
base currency), and everything in `12-erp-inventory.md` §8.
