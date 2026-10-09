"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, PackagePlus, Printer } from "lucide-react";
import { toast } from "sonner";

import { CatalogItemQuickCreate } from "@/components/catalog/CatalogItemQuickCreate";
import LinkedRecordPicker, { type LinkedRecordOption } from "@/components/crm/LinkedRecordPicker";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormValue } from "@/components/forms/RecordForm";
import { validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { vendorFieldRenderer } from "@/components/purchasing/vendorFieldRenderer";
import {
  emptyPurchaseLineTax, PurchaseLineTaxCell, purchaseLinePreview, purchaseLineTaxFrom, purchaseLineTaxPayload, usePurchaseTaxRates, type PurchaseLineTax,
} from "@/components/finance/tax/purchaseLineTax";
import { DocumentSendAction } from "@/components/transactions/DocumentSendAction";
import { TaxSummary } from "@/components/finance/tax/TaxSummary";
import { DocumentDetailHeader } from "@/components/transactions/DocumentLayoutHeader";
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
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/TextLink";
import { useWarehouses } from "@/hooks/inventory/useInventory";
import { fetchLineCostDefault, usePurchaseOrder, usePurchasingActions, type PurchaseOrder, type PurchaseOrderLine } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { cloneHref, useCloneDraft } from "@/hooks/useCloneDraft";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { OVERDUE_STATUS, getBillStatus, getPosPaymentStatus, getPurchaseOrderBillStatus, getPurchaseOrderStatus, getPurchaseReceiptStatus, getVendorReturnResolution, getVendorReturnStatus } from "@/lib/statusStyles";
import { formatQuantity as quantity } from "@/lib/quantity";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";
import { DocumentHistory } from "@/components/recordActivity/DocumentHistory";

/** A line is a product (tracked or not) or a service (13c §3.5); `itemId` is that record's id. */
type DraftLine = {
  key: number; kind: "product" | "service"; itemId: number | null; name: string; description: string; quantity: string; unitCost: string; discount: string;
  tax: PurchaseLineTax;
};
let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, kind: "product", itemId: null, name: "", description: "", quantity: "1", unitCost: "0", discount: "", tax: emptyPurchaseLineTax() });
const lineTotal = (line: Pick<DraftLine, "quantity" | "unitCost" | "discount">) =>
  (Number(line.quantity) || 0) * (Number(line.unitCost) || 0) - (Number(line.discount) || 0);
const draftLine = (line: {
  product_id?: unknown; catalog_service_id?: unknown; product_name?: unknown; description?: unknown; quantity?: unknown; unit_cost?: unknown; discount_amount?: unknown;
  tax_rate_id?: number | null; tax_manual?: boolean | null; tax_amount?: unknown;
}): DraftLine => {
  const serviceId = (line.catalog_service_id as number | null | undefined) ?? null;
  return {
    key: nextKey++,
    kind: serviceId ? "service" : "product",
    itemId: serviceId ?? (line.product_id as number | null | undefined) ?? null,
    name: String(line.product_name ?? ""),
    description: String(line.description ?? ""),
    quantity: String(Number(line.quantity ?? 1)),
    unitCost: String(Number(line.unit_cost ?? 0)),
    discount: Number(line.discount_amount ?? 0) ? String(Number(line.discount_amount)) : "",
    tax: purchaseLineTaxFrom(line),
  };
};

/** The header the `full_form` layout draws (13b Phase 4e), keyed by field key. */
type PurchaseOrderHeader = RecordFormValue & {
  vendor_id: number | null;
  vendor_name: string;
  warehouse_id: number | null;
  warehouse_name: string;
  currency: string;
  exchange_rate: string;
  expected_date: string;
  vendor_reference: string;
  notes: string;
};

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const PO_INPUT_IDS: Record<string, string> = {
  vendor_id: "po-vendor",
  warehouse_id: "po-warehouse",
  currency: "po-currency",
  exchange_rate: "po-rate",
  expected_date: "po-expected",
  vendor_reference: "po-reference",
  notes: "po-notes",
};
const poInputId = (fieldKey: string) => PO_INPUT_IDS[fieldKey] ?? `po-${fieldKey.replace(/_/g, "-")}`;


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
  // *Clone* (13b Phase 5): `?clone=<id>` starts a new draft from that order's vendor and lines.
  const clone = useCloneDraft("purchase_orders", orderId === null);
  const canCreateProduct = Boolean(modules.find((module) => module.name === "catalog_products")?.actions?.can_create);
  const [creatingLine, setCreatingLine] = useState<{ key: number; name: string } | null>(null);
  const mutations = usePurchasingActions();

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [header, setHeader] = useState<PurchaseOrderHeader | null>(null);
  // The rate set on a placed order that has none yet (below the header).
  const [exchangeRate, setExchangeRate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const layoutQuery = useResolvedRecordLayout("purchase_orders", "full_form");
  const [error, setError] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [panel, setPanel] = useState<"close" | "cancel" | "alternative" | null>(null);
  const [alternativeVendor, setAlternativeVendor] = useState<{ id: number | null; name: string }>({ id: null, name: "" });
  const [reason, setReason] = useState("");

  const isNew = orderId === null;
  // Before it is placed a purchase order is a request for quotation: draft, then sent (13c §3.8).
  const isRfq = order?.status === "draft" || order?.status === "sent";
  const editable = isNew ? Boolean(actions?.can_create) : isRfq && Boolean(actions?.can_edit);
  const activeWarehouses = warehouses.data?.filter((row) => row.is_active) ?? [];
  // What the currency select shows while the field is blank: the base currency.
  const defaultCurrency = baseCurrencyQuery.data ?? currencies?.[0] ?? "USD";

  // Seed the form once per loaded document, while rendering.
  const seedKey = isNew
    ? clone.cloneId ? (clone.draft ? `clone-${clone.cloneId}` : null) : "new"
    : order ? `order-${order.id}-${order.status}-${order.updated_at}` : null;
  if (seedKey && seedKey !== loadedKey && clone.draft) {
    // A copy: the vendor, warehouse, currency, notes and lines; a new number, status and rate.
    const fields = clone.draft.fields as Partial<PurchaseOrderHeader>;
    setLoadedKey(seedKey);
    setCustomValues(clone.draft.custom_fields);
    setHeader({
      vendor_id: fields.vendor_id ?? null,
      vendor_name: fields.vendor_name ?? "",
      warehouse_id: fields.warehouse_id ?? null,
      warehouse_name: fields.warehouse_name ?? "",
      currency: fields.currency ?? "",
      exchange_rate: "",
      expected_date: "",
      vendor_reference: "",
      notes: fields.notes ?? "",
    });
    const copied = clone.draft.lines.map((line) => draftLine(line));
    setLines(copied.length ? copied : [blankLine()]);
  } else if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setCustomValues(order?.custom_fields ?? {});
    setHeader({
      vendor_id: order?.vendor_id ?? null,
      vendor_name: order?.vendor_name ?? "",
      warehouse_id: order?.warehouse_id ?? null,
      warehouse_name: order?.warehouse_name ?? "",
      currency: order?.currency ?? "",
      exchange_rate: order?.exchange_rate ?? order?.suggested_exchange_rate ?? "",
      expected_date: order?.expected_date ?? "",
      vendor_reference: order?.vendor_reference ?? "",
      notes: order?.notes ?? "",
    });
    setExchangeRate(order?.exchange_rate ?? order?.suggested_exchange_rate ?? "");
    setLines(order?.lines?.length ? order.lines.map((line) => draftLine(line)) : [blankLine()]);
  }

  const taxRates = usePurchaseTaxRates();
  const total = lines.reduce((sum, line) => sum + purchaseLinePreview(line, taxRates).total, 0);
  const currencyCode = header?.currency || order?.currency || defaultCurrency;
  // Stock is costed in the base currency, so an order in another one carries a rate (12d §3.5).
  const baseCurrency = order?.base_currency ?? baseCurrencyQuery.data ?? defaultCurrency;
  const foreign = currencyCode !== baseCurrency;
  const updateLine = (updated: DraftLine) => setLines((current) => current.map((line) => (line.key === updated.key ? updated : line)));

  // A tenant with one warehouse never sees the choice; the rate only matters in another currency.
  const omitFieldKeys = [...(activeWarehouses.length > 1 ? [] : ["warehouse_id"]), ...(foreign ? [] : ["exchange_rate"])];

  /** A picked item takes the vendor's last price, then the item's cost (13c §5 decision 7). */
  async function pickItem(line: DraftLine, option: LinkedRecordOption) {
    const kind = option.module_key === "catalog_services" ? "service" : "product";
    const raw = (option.raw ?? {}) as { purchase_tax_rate_id?: number | null };
    updateLine({ ...line, kind, itemId: option.id, name: option.label, tax: { ...line.tax, auto_rate_id: raw.purchase_tax_rate_id ?? null } });
    if (!header?.vendor_id) return;
    const cost = await fetchLineCostDefault(header.vendor_id, kind, option.id).catch(() => null);
    if (cost != null) setLines((current) => current.map((row) => (row.key === line.key && row.itemId === option.id ? { ...row, unitCost: String(Number(cost)) } : row)));
  }

  async function save() {
    if (!header) return;
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, header, customValues, omitFieldKeys) : {};
    if (!header.vendor_id && !nextErrors.vendor_id) nextErrors.vendor_id = "Choose a vendor.";
    if (foreign && header.exchange_rate.trim() && !(Number(header.exchange_rate) > 0)) nextErrors.exchange_rate = "The exchange rate must be greater than zero.";
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      document.getElementById(firstInvalid.startsWith("custom:") ? `custom-field-purchase_orders-${firstInvalid.slice(7)}` : poInputId(firstInvalid))?.focus();
      setError("Check the highlighted fields.");
      return;
    }
    if (!lines.length || lines.some((line) => !line.itemId || !(Number(line.quantity) > 0) || !(Number(line.unitCost) >= 0))) {
      setError("Choose a product or service and enter a quantity above zero and a unit cost on every line."); return;
    }
    if (lines.some((line) => (Number(line.discount) || 0) < 0 || lineTotal(line) < 0)) {
      setError("A line's discount cannot be more than the line."); return;
    }
    const payload = {
      custom_fields: customValues,
      vendor_id: header.vendor_id!, warehouse_id: header.warehouse_id, currency: currencyCode, exchange_rate: foreign && header.exchange_rate.trim() ? header.exchange_rate.trim() : null, expected_date: header.expected_date || null,
      vendor_reference: header.vendor_reference.trim() || null, notes: header.notes.trim() || null,
      lines: lines.map((line) => ({
        product_id: line.kind === "product" ? line.itemId : null, catalog_service_id: line.kind === "service" ? line.itemId : null,
        description: line.description.trim() || null, quantity: line.quantity, unit_cost: line.unitCost, discount_amount: line.discount || "0",
        ...purchaseLineTaxPayload(line.tax),
      })),
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
    const open = (order.alternatives ?? []).filter((item) => item.status === "draft" || item.status === "sent");
    const others = open.length ? ` The other ${open.length === 1 ? "request" : `${open.length} requests`} in this comparison (${open.map((item) => item.number).join(", ")}) will be cancelled.` : "";
    if (!(await confirm({ title: `Place ${order.number}?`, description: `${effect}${others} A placed order can no longer be edited.`, confirmLabel: "Place order" }))) return;
    try { setError(null); await mutations.placeOrder(order.id); toast.success(`${order.number} placed.`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The order could not be placed."); }
  }

  async function markSent() {
    if (!order) return;
    try { setError(null); await mutations.sendOrder(order.id); toast.success(`${order.number} marked as sent.`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The request could not be marked as sent."); }
  }

  async function submitPanel() {
    if (!order || !panel) return;
    if (panel === "alternative") {
      if (!alternativeVendor.id) { setError("Choose a vendor."); return; }
      try {
        setError(null);
        const created = await mutations.createAlternative({ id: order.id, vendorId: alternativeVendor.id });
        toast.success(`${created.number} asks ${created.vendor_name ?? "the vendor"} for the same.`);
        setPanel(null); setAlternativeVendor({ id: null, name: "" });
        router.push(`${DASHBOARD_ROUTES.purchaseOrders}/${created.id}`);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "The alternative could not be created."); }
      return;
    }
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
      title={order ? `${isRfq ? "Request for quotation" : "Purchase order"} ${order.number}` : "New request for quotation"}
      description={order
        ? [order.vendor_name, order.ordered_at ? `Placed ${formatDateTime(order.ordered_at)}` : order.sent_at ? `Sent ${formatDateTime(order.sent_at)}` : "Not sent yet",
          order.expected_date ? `Expected ${formatDateOnly(order.expected_date)}` : null].filter(Boolean).join(" · ")
        : "Choose a vendor and what to buy. Save it, send it for a price, then place it as an order."}
      backHref={DASHBOARD_ROUTES.purchaseOrders}
      isLoading={isNew ? modulesLoading || clone.isLoading : query.isLoading}
      isPermissionDenied={isForbiddenError(query.error) || isForbiddenError(clone.error) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={(Boolean(query.error) && !isForbiddenError(query.error)) || (Boolean(clone.error) && !isForbiddenError(clone.error))}
      onRetry={() => void (clone.error ? clone.refetch() : query.refetch())}
      actions={
        <div className="flex flex-wrap gap-2">
          {order ? <StatusValue status={purchaseOrderStatus(order)} context="record" /> : null}
          {isRfq && actions?.can_edit ? <Button onClick={() => void place()} disabled={mutations.isSaving}>Place order</Button> : null}
          {/* 13c §3.8: F5's *Send* emails the RFQ; until then the buyer marks it sent. */}
          {order?.status === "draft" && actions?.can_edit ? <Button variant="outline" onClick={() => void markSent()} disabled={mutations.isSaving}>Mark as sent</Button> : null}
          {isRfq && actions?.can_create ? <Button variant="outline" onClick={() => { setError(null); setPanel("alternative"); }}>Ask another vendor</Button> : null}
          {order?.rfq_group_id ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.purchaseOrders}/${order.id}/compare`}>Compare</Link></Button> : null}
          {order?.status === "ordered" && toReceive && receiptActions?.can_create ? (
            <Button asChild><Link href={`${DASHBOARD_ROUTES.purchaseReceipts}/new?order_id=${order.id}`}><PackagePlus />Receive</Link></Button>
          ) : null}
          {/* E5 (12c §3.5): bill what was received and not yet billed. */}
          {order?.bill_status === "to_bill" && billActions?.can_create ? (
            <Button asChild variant={toReceive && receiptActions?.can_create ? "outline" : "default"}><Link href={`${DASHBOARD_ROUTES.purchaseBills}/new?order_id=${order.id}`}>Create bill</Link></Button>
          ) : null}
          {/* Sending a draft is what sends the request for quotation (13c §3.8, 13d §3.4). */}
          {order ? <DocumentSendAction moduleKey="purchase_orders" recordId={order.id} label={order.status === "draft" ? "Send request" : "Send"} /> : null}
          {order && order.status !== "draft" ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.purchaseOrders}/${order.id}/print`}><Printer />{order.status === "sent" ? "Request PDF" : "Preview and PDF"}</Link></Button> : null}
          {/* 13b Phase 5: a new draft with this order's vendor and lines. */}
          {order && actions?.can_create ? <Button asChild variant="outline"><Link href={cloneHref(`${DASHBOARD_ROUTES.purchaseOrders}/new`, order.id)}><Copy />Clone</Link></Button> : null}
          {order?.status === "ordered" && order.receipt_status === "partial" && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setPanel("close"); }}>Close remaining</Button> : null}
          {((order?.status === "ordered" && order.receipt_status === "none") || order?.status === "sent") && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setPanel("cancel"); }}>{order?.status === "sent" ? "Cancel request" : "Cancel order"}</Button> : null}
          {order?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {editable && header ? (
        <LayoutRecordFormBody<PurchaseOrderHeader>
          moduleKey="purchase_orders"
          value={header}
          onChange={setHeader}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={poInputId}
          action={isNew ? "create" : "edit"}
          errors={fieldErrors}
          renderField={vendorFieldRenderer(header)}
          slots={{ omitFieldKeys }}
        />
      ) : order ? (
        <>
          <DocumentDetailHeader
            moduleKey="purchase_orders"
            record={order}
            currency={order.currency}
            links={{ vendor_id: `/dashboard/sales/organizations/${order.vendor_id}` }}
            omitFieldKeys={[
              ...(activeWarehouses.length > 1 ? [] : ["warehouse_id"]),
              ...(order.base_currency && order.currency !== order.base_currency ? [] : ["exchange_rate"]),
            ]}
            renderValue={(field, value) => {
              if (field.field_key === "exchange_rate" && order.base_currency) {
                return value
                  ? <span className="tabular-nums">1 {order.currency} = {Number(value).toLocaleString(undefined, { maximumFractionDigits: 8 })} {order.base_currency}</span>
                  : <span className="text-copy-muted">Not set</span>;
              }
              if (field.field_key === "bill_status" && typeof value === "string" && value !== "none") return <StatusValue status={getPurchaseOrderBillStatus(value)} />;
              return undefined;
            }}
          />
          {order.close_reason || order.cancel_reason ? (
            <FactList className="grid-cols-2 lg:grid-cols-4">
              {order.close_reason ? <Fact label="Rest closed because">{order.close_reason}</Fact> : null}
              {order.cancel_reason ? <Fact label="Cancelled because">{order.cancel_reason}</Fact> : null}
            </FactList>
          ) : null}
        </>
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
            addLabel="Add line"
            lineLabel={(line) => line.name || "line"}
            columns={[
              { key: "product", label: "Product", size: "lg", share: 4, render: (line, { index, cellProps }) => {
                const productCell = cellProps("product");
                return (
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <LinkedRecordPicker inputId={`po-product-${line.key}`} ariaLabel={`Item, line ${index + 1}`} recordType="catalog_item" valueId={line.itemId} displayValue={line.name}
                      queryKeyPrefix="po-catalog-item"
                      onDisplayValueChange={(value) => updateLine({ ...line, name: value, itemId: null })}
                      onSelect={(option) => void pickItem(line, option)}
                      onClear={() => updateLine({ ...line, itemId: null, name: "" })} placeholder="Search products and services"
                      createOption={canCreateProduct ? { label: (text) => `Create product "${text}"`, onCreate: (text) => setCreatingLine({ key: line.key, name: text }) } : undefined}
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
              { key: "discount", label: "Discount", size: "sm", align: "right", share: 1.25, render: (line, { cellProps }) => (
                <LineNumberInput cellProps={cellProps("discount")} ariaLabel={`Discount for ${line.name || "line"}`} step="0.01" value={line.discount} onChange={(value) => updateLine({ ...line, discount: value })} />
              ) },
              { key: "tax", label: "Tax", size: "md", share: 1.75, render: (line, { cellProps }) => (
                <PurchaseLineTaxCell value={line.tax} rates={taxRates} label={line.name || "line"} cellProps={cellProps("tax")}
                  onChange={(tax) => updateLine({ ...line, tax })} />
              ) },
              { key: "total", label: "Total", size: "sm", align: "right", share: 1.5, render: (line) => <span className="block truncate tabular-nums"><Money amount={purchaseLinePreview(line, taxRates).total} currency={currencyCode} /></span> },
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
              { key: "product", label: "Item", size: "lg", render: (line) => (line.catalog_service_id
                ? <TextLink href={`${DASHBOARD_ROUTES.services}/${line.catalog_service_id}`}>{line.product_name}</TextLink>
                : <TextLink href={`${DASHBOARD_ROUTES.products}/${line.product_id}${line.track_inventory ? "?tab=stock" : ""}`}>{line.product_name}</TextLink>) },
              { key: "vendor_sku", label: "Vendor SKU", size: "sm", render: (line) => line.vendor_sku ?? "—" },
              { key: "quantity", label: "Ordered", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}{line.unit ? ` ${line.unit}` : ""}</span> },
              { key: "cost", label: "Unit cost", size: "sm", align: "right", render: (line) => <Money amount={line.unit_cost} currency={order?.currency ?? currencyCode} /> },
              { key: "discount", label: "Discount", size: "sm", align: "right", render: (line) => (Number(line.discount_amount) ? <Money amount={line.discount_amount} currency={order?.currency ?? currencyCode} /> : "—") },
              { key: "tax", label: "Tax", size: "sm", align: "right", render: (line) => (Number(line.tax_amount) ? <Money amount={line.tax_amount} currency={order?.currency ?? currencyCode} /> : "—") },
              { key: "total", label: "Total", size: "sm", align: "right", render: (line) => <Money amount={line.line_total} currency={order?.currency ?? currencyCode} /> },
              { key: "received", label: "Received", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.received)}</span> },
              { key: "to_receive", label: "To receive", size: "sm", align: "right", render: (line) => (line.needs_receipt === false
                ? <span className="text-copy-muted">Not received</span>
                : <span className="tabular-nums">{quantity(line.to_receive)}</span>) },
              { key: "billed", label: "Billed", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.billed)}</span> },
            ]}
          />
        )}
        {!editable ? <TaxSummary rows={order?.tax_summary} currency={order?.currency} /> : null}
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

      {order?.alternatives?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading description="The same request asked of other vendors. Placing one cancels the others.">Alternatives</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Alternative requests"
            rows={order.alternatives}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.purchaseOrders}/${row.id}`}
            emptyState={{ title: "No alternatives" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPurchaseOrderStatus(row.status)} /> },
              { key: "vendor", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
              { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.subtotal} currency={row.currency} /> },
            ]}
          />
        </section>
      ) : null}

      {order?.vendor_returns?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Vendor returns</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Vendor returns for this purchase order"
            rows={order.vendor_returns}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.vendorReturns}/${row.id}`}
            emptyState={{ title: "No vendor returns" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getVendorReturnStatus(row.status)} /> },
              { key: "resolution", label: "Vendor will", size: "sm", render: (row) => <StatusValue status={getVendorReturnResolution(row.resolution)} /> },
              { key: "reason", label: "Reason", render: (row) => row.reason },
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

      {order ? <DocumentHistory moduleKey="purchase_orders" entityId={order.id} canEdit={Boolean(actions?.can_edit)} /> : null}

      {editable ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : order ? "A request is not an order until you place it." : "Save the request, send it for a price, then place it."}>
          <Button type="button" variant="outline" asChild><Link href={DASHBOARD_ROUTES.purchaseOrders}>Back</Link></Button>
          <Button type="button" onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button>
        </FormFooter>
      ) : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={panel !== null}
        onOpenChange={(open) => { if (!open) setPanel(null); }}
        title={panel === "alternative" ? "Ask another vendor" : panel === "close" ? "Close the rest of this purchase order" : `Cancel ${order?.number ?? "purchase order"}`}
        description={panel === "alternative"
          ? "A new request with the same lines goes to the vendor you choose. Compare the prices they send back, then place the best one."
          : panel === "close" ? "What has not arrived will not be received: it stops counting as incoming stock. Cancelling a receipt reopens the order."
          : isRfq ? "The request is withdrawn; nothing counts as incoming." : "Nothing has been received on this order. Cancelling it removes it from incoming stock."}
        closeLabel="Close panel"
        onSubmit={() => void submitPanel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setPanel(null)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>
          {panel === "alternative" ? "Create request" : panel === "close" ? "Close remaining" : isRfq ? "Cancel request" : "Cancel order"}</Button></>}
      >
        {panel === "alternative" ? (
          <Field>
            <FieldLabel htmlFor="po-alternative-vendor">Vendor</FieldLabel>
            <LinkedRecordPicker inputId="po-alternative-vendor" recordType="vendor" valueId={alternativeVendor.id} displayValue={alternativeVendor.name}
              onDisplayValueChange={(name) => setAlternativeVendor({ id: null, name })} onSelect={(option) => setAlternativeVendor({ id: option.id, name: option.label })}
              onClear={() => setAlternativeVendor({ id: null, name: "" })} placeholder="Search vendors" suggestOnFocus />
          </Field>
        ) : (
          <Field><FieldLabel htmlFor="po-panel-reason">Reason</FieldLabel><Textarea id="po-panel-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        )}
      </EditorPanel>

      {/* *Create product "…"* on a line (13b Phase 5): a stock-tracked product bought from this vendor. */}
      {editable && canCreateProduct ? (
        <CatalogItemQuickCreate
          kind="products"
          open={creatingLine !== null}
          onOpenChange={(open) => { if (!open) setCreatingLine(null); }}
          embedded
          context={{
            relationshipIntent: "purchase_order_line",
            defaults: {
              name: creatingLine?.name ?? "",
              track_inventory: true,
              preferred_vendor_id: header?.vendor_id ?? null,
              preferred_vendor_name: header?.vendor_name ?? "",
            },
          }}
          onCreated={(record) => {
            if (!creatingLine) return;
            setLines((current) => current.map((line) => (line.key === creatingLine.key
              ? { ...line, kind: "product", itemId: record.id, name: record.name, unitCost: record.cost_price != null ? String(Number(record.cost_price)) : line.unitCost }
              : line)));
          }}
        />
      ) : null}
    </PageShell>
  );
}
