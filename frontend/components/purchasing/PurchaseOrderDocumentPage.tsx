"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus, Printer } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { LineItemsEditor, LineNumberInput, LineTextInput } from "@/components/transactions/LineItemsEditor";
import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/TextLink";
import { useWarehouses } from "@/hooks/inventory/useInventory";
import { usePurchaseOrder, usePurchasingActions, type PurchaseOrder, type PurchaseOrderLine } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { OVERDUE_STATUS, getBillStatus, getPosPaymentStatus, getPurchaseOrderBillStatus, getPurchaseOrderStatus, getPurchaseReceiptStatus } from "@/lib/statusStyles";
import { formatQuantity as quantity } from "@/lib/quantity";

type DraftLine = { key: number; productId: number | null; name: string; description: string; quantity: string; unitCost: string };
let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, productId: null, name: "", description: "", quantity: "1", unitCost: "0" });


/** The status a reader cares about: *Partly received* while an ordered PO has some stock in. */
export function purchaseOrderStatus(order: Pick<PurchaseOrder, "status" | "receipt_status">) {
  return getPurchaseOrderStatus(order.status === "ordered" && order.receipt_status === "partial" ? "partial" : order.status);
}

/**
 * A purchase order (12b-erp-purchasing.md §3.4): E3's document layout. A draft edits the vendor,
 * warehouse and lines; *Place order* locks it and counts it as incoming stock; receipts
 * bring the stock in, partially if need be.
 */
export function PurchaseOrderDocumentPage({ orderId = null }: { orderId?: number | null }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "purchase_orders")?.actions;
  const receiptActions = modules.find((module) => module.name === "purchase_receipts")?.actions;
  const billActions = modules.find((module) => module.name === "purchase_bills")?.actions;
  const canViewStock = Boolean(modules.find((module) => module.name === "inventory_stock")?.actions?.can_view);
  const warehouses = useWarehouses(false, canViewStock);
  const currencies = useCompanyCurrencies().data;
  const baseCurrencyQuery = useBaseCurrency();
  const query = usePurchaseOrder(orderId);
  const order = query.data;
  const mutations = usePurchasingActions();

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [vendorName, setVendorName] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [currency, setCurrency] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [vendorReference, setVendorReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"close" | "cancel" | null>(null);
  const [reason, setReason] = useState("");

  const isNew = orderId === null;
  const editable = isNew ? Boolean(actions?.can_create) : order?.status === "draft" && Boolean(actions?.can_edit);
  const activeWarehouses = warehouses.data?.filter((row) => row.is_active) ?? [];
  const defaultCurrency = currencies?.[0] ?? "USD";

  // Seed the form once per loaded document, while rendering.
  const seedKey = isNew ? "new" : order ? `order-${order.id}-${order.status}-${order.updated_at}` : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setVendorId(order?.vendor_id ?? null);
    setVendorName(order?.vendor_name ?? "");
    setWarehouseId(order?.warehouse_id ?? null);
    setCurrency(order?.currency ?? "");
    setExchangeRate(order?.exchange_rate ?? order?.suggested_exchange_rate ?? "");
    setExpectedDate(order?.expected_date ?? "");
    setVendorReference(order?.vendor_reference ?? "");
    setNotes(order?.notes ?? "");
    setLines(order?.lines?.length ? order.lines.map((line) => ({
      key: nextKey++, productId: line.product_id, name: line.product_name, description: line.description ?? "",
      quantity: String(Number(line.quantity)), unitCost: String(Number(line.unit_cost)),
    })) : [blankLine()]);
  }

  const total = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0);
  const currencyCode = currency || order?.currency || defaultCurrency;
  // Stock is costed in the base currency, so an order in another one carries a rate (12d §3.5).
  const baseCurrency = order?.base_currency ?? baseCurrencyQuery.data ?? defaultCurrency;
  const foreign = currencyCode !== baseCurrency;
  const updateLine = (updated: DraftLine) => setLines((current) => current.map((line) => (line.key === updated.key ? updated : line)));

  async function save() {
    if (!vendorId) { setError("Choose a vendor."); return; }
    if (foreign && exchangeRate.trim() && !(Number(exchangeRate) > 0)) { setError("The exchange rate must be greater than zero."); return; }
    if (!lines.length || lines.some((line) => !line.productId || !(Number(line.quantity) > 0) || !(Number(line.unitCost) >= 0))) {
      setError("Choose a product and enter a quantity above zero and a unit cost on every line."); return;
    }
    const payload = {
      vendor_id: vendorId, warehouse_id: warehouseId, currency: currencyCode, exchange_rate: foreign && exchangeRate.trim() ? exchangeRate.trim() : null, expected_date: expectedDate || null,
      vendor_reference: vendorReference.trim() || null, notes: notes.trim() || null,
      lines: lines.map((line) => ({ product_id: line.productId!, description: line.description.trim() || null, quantity: line.quantity, unit_cost: line.unitCost })),
    };
    try {
      setError(null);
      if (isNew) {
        const saved = await mutations.createOrder(payload);
        toast.success(`Draft ${saved.number} saved.`);
        router.push(`${DASHBOARD_ROUTES.purchaseOrders}/${saved.id}`);
      } else if (order) {
        await mutations.updateOrder({ id: order.id, payload });
        toast.success("Draft saved.");
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The purchase order could not be saved."); }
  }

  async function place() {
    if (!order) return;
    const effect = `${order.vendor_name ?? "The vendor"} is expected to deliver ${quantity(order.total_quantity)} units to ${order.warehouse_name ?? "the warehouse"}. They count as incoming stock until received.`;
    if (!(await confirm({ title: `Place ${order.number}?`, description: `${effect} A placed order can no longer be edited.`, confirmLabel: "Place order" }))) return;
    try { setError(null); await mutations.placeOrder(order.id); toast.success(`${order.number} placed.`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The order could not be placed."); }
  }

  async function submitPanel() {
    if (!order || !panel) return;
    if (!reason.trim()) { setError("Enter a reason."); return; }
    try {
      setError(null);
      if (panel === "close") await mutations.closeOrder({ id: order.id, reason: reason.trim() });
      else await mutations.cancelOrder({ id: order.id, reason: reason.trim() });
      toast.success(panel === "close" ? `${order.number} closed; the rest will not be received.` : `${order.number} cancelled.`);
      setPanel(null); setReason("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The purchase order could not be changed."); }
  }

  async function remove() {
    if (!order || !(await confirm({ title: `Remove ${order.number}?`, description: "This draft can be restored from the recycle bin.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.removeOrder(order.id); toast.success("Draft removed."); router.push(DASHBOARD_ROUTES.purchaseOrders); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  const toReceive = (order?.lines ?? []).some((line) => Number(line.to_receive) > 0);

  return (
    <PageShell
      variant="document"
      title={order ? `Purchase order ${order.number}` : "New purchase order"}
      description={order
        ? [order.vendor_name, order.ordered_at ? `Placed ${formatDateTime(order.ordered_at)}` : "Not placed yet", order.expected_date ? `Expected ${formatDateOnly(order.expected_date)}` : null].filter(Boolean).join(" · ")
        : "Choose a vendor and the products to order. Save a draft, then place it."}
      backHref={DASHBOARD_ROUTES.purchaseOrders}
      isLoading={isNew ? modulesLoading : query.isLoading}
      isPermissionDenied={isForbiddenError(query.error) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={Boolean(query.error) && !isForbiddenError(query.error)}
      onRetry={() => void query.refetch()}
      actions={
        <div className="flex flex-wrap gap-2">
          {order ? <StatusValue status={purchaseOrderStatus(order)} context="record" /> : null}
          {order?.status === "draft" && actions?.can_edit ? <Button onClick={() => void place()} disabled={mutations.isSaving}>Place order</Button> : null}
          {order?.status === "ordered" && toReceive && receiptActions?.can_create ? (
            <Button asChild><Link href={`${DASHBOARD_ROUTES.purchaseReceipts}/new?order_id=${order.id}`}><PackagePlus />Receive</Link></Button>
          ) : null}
          {/* E5 (12c §3.5): bill what was received and not yet billed. */}
          {order?.bill_status === "to_bill" && billActions?.can_create ? (
            <Button asChild variant={toReceive && receiptActions?.can_create ? "outline" : "default"}><Link href={`${DASHBOARD_ROUTES.purchaseBills}/new?order_id=${order.id}`}>Create bill</Link></Button>
          ) : null}
          {order && order.status !== "draft" ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.purchaseOrders}/${order.id}/print`}><Printer />Print</Link></Button> : null}
          {order?.status === "ordered" && order.receipt_status === "partial" && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setPanel("close"); }}>Close remaining</Button> : null}
          {(order?.status === "ordered" && order.receipt_status === "none") && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setPanel("cancel"); }}>Cancel order</Button> : null}
          {order?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {editable ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Field className="lg:col-span-2">
            <FieldLabel htmlFor="po-vendor">Vendor</FieldLabel>
            <LinkedRecordPicker inputId="po-vendor" recordType="vendor" valueId={vendorId} displayValue={vendorName}
              onDisplayValueChange={(value) => { setVendorName(value); setVendorId(null); }}
              onSelect={(option) => { setVendorId(option.id); setVendorName(option.label); }}
              onClear={() => { setVendorId(null); setVendorName(""); }} placeholder="Search vendors" />
          </Field>
          <Field>
            <FieldLabel htmlFor="po-currency">Currency</FieldLabel>
            <Select value={currencyCode} onValueChange={setCurrency}>
              <SelectTrigger id="po-currency"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from(new Set([currencyCode, ...(currencies ?? [])])).map((code) => <SelectItem key={code} value={code}>{code}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {foreign ? (
            <Field>
              <FieldLabel htmlFor="po-rate">Exchange rate</FieldLabel>
              <Input id="po-rate" type="number" min="0" step="0.00000001" inputMode="decimal" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} aria-describedby="po-rate-description" />
              <FieldDescription id="po-rate-description">{baseCurrency} for one {currencyCode}. Needed to place the order: stock is valued in {baseCurrency}.</FieldDescription>
            </Field>
          ) : null}
          {activeWarehouses.length > 1 ? (
            <Field>
              <FieldLabel htmlFor="po-warehouse">Deliver to</FieldLabel>
              <Select value={String(warehouseId ?? activeWarehouses.find((row) => row.is_default)?.id ?? "")} onValueChange={(value) => setWarehouseId(Number(value))}>
                <SelectTrigger id="po-warehouse"><SelectValue /></SelectTrigger>
                <SelectContent>{activeWarehouses.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field><FieldLabel htmlFor="po-expected">Expected on</FieldLabel><Input id="po-expected" type="date" value={expectedDate} onChange={(event) => setExpectedDate(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="po-reference">Vendor reference</FieldLabel><Input id="po-reference" maxLength={120} value={vendorReference} onChange={(event) => setVendorReference(event.target.value)} /></Field>
          <Field className="lg:col-span-3"><FieldLabel htmlFor="po-notes">Notes</FieldLabel><Textarea id="po-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        </div>
      ) : order ? (
        <FactList className="grid-cols-2 lg:grid-cols-4">
          <Fact label="Vendor"><TextLink href={`/dashboard/sales/organizations/${order.vendor_id}`}>{order.vendor_name ?? "Vendor"}</TextLink></Fact>
          {activeWarehouses.length > 1 ? <Fact label="Deliver to">{order.warehouse_name ?? "—"}</Fact> : null}
          {order.vendor_reference ? <Fact label="Vendor reference">{order.vendor_reference}</Fact> : null}
          <Fact label="Total"><Money amount={order.subtotal} currency={order.currency} /></Fact>
          {order.base_currency && order.currency !== order.base_currency ? <Fact label="Exchange rate">{order.exchange_rate
            ? <span className="tabular-nums">1 {order.currency} = {Number(order.exchange_rate).toLocaleString(undefined, { maximumFractionDigits: 8 })} {order.base_currency}</span>
            : <span className="text-copy-muted">Not set</span>}</Fact> : null}
          {order.bill_status && order.bill_status !== "none" ? <Fact label="Billing"><StatusValue status={getPurchaseOrderBillStatus(order.bill_status)} /></Fact> : null}
          {order.close_reason ? <Fact label="Rest closed because">{order.close_reason}</Fact> : null}
          {order.cancel_reason ? <Fact label="Cancelled because">{order.cancel_reason}</Fact> : null}
        </FactList>
      ) : null}
      {order && order.status === "ordered" && foreign && !order.exchange_rate && actions?.can_edit ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field className="w-56">
            <FieldLabel htmlFor="po-rate-placed">Exchange rate</FieldLabel>
            <Input id="po-rate-placed" type="number" min="0" step="0.00000001" inputMode="decimal" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} aria-describedby="po-rate-placed-description" />
            <FieldDescription id="po-rate-placed-description">{baseCurrency} for one {order.currency}. Needed before receiving.</FieldDescription>
          </Field>
          <Button type="button" variant="outline" disabled={mutations.isSaving || !(Number(exchangeRate) > 0)} onClick={() => void mutations.setExchangeRate({ id: order.id, rate: exchangeRate })
            .then(() => toast.success("Exchange rate saved."))
            .catch((failure) => toast.error(failure instanceof Error ? failure.message : "The exchange rate could not be saved."))}>Save rate</Button>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <SectionHeading description={editable ? `Total ${formatMoney(total, currencyCode, { maximumFractionDigits: 2 }) ?? total}` : undefined}>Lines</SectionHeading>
        </div>
        {editable ? (
          <LineItemsEditor<DraftLine>
            id="po-lines"
            label="Purchase order lines"
            lines={lines}
            lineKey={(line) => line.key}
            onChange={setLines}
            createLine={blankLine}
            addLabel="Add product"
            lineLabel={(line) => line.name || "line"}
            columns={[
              { key: "product", label: "Product", size: "lg", share: 4, render: (line, { index, cellProps }) => {
                const productCell = cellProps("product");
                return (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <LinkedRecordPicker inputId={`po-product-${line.key}`} ariaLabel={`Product, line ${index + 1}`} recordType="inventory_product" valueId={line.productId} displayValue={line.name}
                      onDisplayValueChange={(value) => updateLine({ ...line, name: value, productId: null })}
                      onSelect={(option) => {
                        const raw = option.raw as { cost_price?: string | number | null } | undefined;
                        updateLine({ ...line, productId: option.id, name: option.label, unitCost: raw?.cost_price != null ? String(Number(raw.cost_price)) : line.unitCost });
                      }}
                      onClear={() => updateLine({ ...line, productId: null, name: "" })} placeholder="Search tracked products"
                      onInputKeyDown={productCell.onKeyDown}
                      inputDataAttributes={{ "data-line-editor": productCell["data-line-editor"], "data-line-row": index, "data-line-field": "product" }} />
                    <LineTextInput cellProps={cellProps("description")} ariaLabel={`Description for ${line.name || "line"}`} placeholder="Description (optional)"
                      value={line.description} onChange={(value) => updateLine({ ...line, description: value })} />
                  </div>
                );
              } },
              { key: "quantity", label: "Quantity", size: "sm", align: "right", share: 1.25, render: (line, { cellProps }) => (
                <LineNumberInput cellProps={cellProps("quantity")} ariaLabel={`Quantity for ${line.name || "line"}`} step="0.0001" value={line.quantity} onChange={(value) => updateLine({ ...line, quantity: value })} />
              ) },
              { key: "cost", label: "Unit cost", size: "sm", align: "right", share: 1.5, render: (line, { cellProps }) => (
                <LineNumberInput cellProps={cellProps("cost")} ariaLabel={`Unit cost for ${line.name || "line"}`} step="0.0001" value={line.unitCost} onChange={(value) => updateLine({ ...line, unitCost: value })} />
              ) },
              { key: "total", label: "Total", size: "sm", align: "right", share: 1.5, render: (line) => <span className="block truncate tabular-nums"><Money amount={(Number(line.quantity) || 0) * (Number(line.unitCost) || 0)} currency={currencyCode} /></span> },
            ]}
          />
        ) : (
          <RecordTable<PurchaseOrderLine>
            variant="readOnly"
            label="Purchase order lines"
            rows={order?.lines ?? []}
            rowKey={(line) => line.id}
            emptyState={{ title: "No lines" }}
            columns={[
              { key: "product", label: "Product", size: "lg", render: (line) => <TextLink href={`${DASHBOARD_ROUTES.products}/${line.product_id}?tab=stock`}>{line.product_name}</TextLink> },
              { key: "vendor_sku", label: "Vendor SKU", size: "sm", render: (line) => line.vendor_sku ?? "—" },
              { key: "quantity", label: "Ordered", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
              { key: "cost", label: "Unit cost", size: "sm", align: "right", render: (line) => <Money amount={line.unit_cost} currency={order?.currency ?? currencyCode} /> },
              { key: "total", label: "Total", size: "sm", align: "right", render: (line) => <Money amount={line.line_total} currency={order?.currency ?? currencyCode} /> },
              { key: "received", label: "Received", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.received)}</span> },
              { key: "to_receive", label: "To receive", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.to_receive)}</span> },
              { key: "billed", label: "Billed", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.billed)}</span> },
            ]}
          />
        )}
      </section>

      {order?.receipts?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Receipts</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Receipts for this purchase order"
            rows={order.receipts}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.purchaseReceipts}/${row.id}`}
            emptyState={{ title: "No receipts" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPurchaseReceiptStatus(row.status)} /> },
              { key: "received", label: "Received on", size: "sm", render: (row) => (row.received_on ? formatDateOnly(row.received_on) : "—") },
              { key: "reference", label: "Vendor delivery ref", render: (row) => row.vendor_delivery_ref ?? "—" },
              { key: "units", label: "Units", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.total_quantity)}</span> },
            ]}
          />
        </section>
      ) : null}

      {order?.bills?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Bills</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Bills for this purchase order"
            rows={order.bills}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.purchaseBills}/${row.id}`}
            emptyState={{ title: "No bills" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getBillStatus(row.status)} /> },
              { key: "reference", label: "Vendor invoice", size: "md", render: (row) => row.vendor_invoice_number },
              { key: "payment", label: "Payment", size: "sm", render: (row) => (row.status !== "posted" ? "—" : row.is_overdue ? <StatusValue status={OVERDUE_STATUS} /> : <StatusValue status={getPosPaymentStatus(row.payment_status)} />) },
              { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.total} currency={row.currency} /> },
            ]}
          />
        </section>
      ) : null}

      {editable ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : order ? "A draft is not ordered until you place it." : "Save a draft, then place it with the vendor."}>
          <Button type="button" variant="outline" asChild><Link href={DASHBOARD_ROUTES.purchaseOrders}>Back</Link></Button>
          <Button type="button" onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button>
        </FormFooter>
      ) : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={panel !== null}
        onOpenChange={(open) => { if (!open) setPanel(null); }}
        title={panel === "close" ? "Close the rest of this purchase order" : `Cancel ${order?.number ?? "purchase order"}`}
        description={panel === "close" ? "What has not arrived will not be received: it stops counting as incoming stock. Cancelling a receipt reopens the order." : "Nothing has been received on this order. Cancelling it removes it from incoming stock."}
        closeLabel="Close panel"
        onSubmit={() => void submitPanel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setPanel(null)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>{panel === "close" ? "Close remaining" : "Cancel order"}</Button></>}
      >
        <Field><FieldLabel htmlFor="po-panel-reason">Reason</FieldLabel><Textarea id="po-panel-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
      </EditorPanel>
    </PageShell>
  );
}
