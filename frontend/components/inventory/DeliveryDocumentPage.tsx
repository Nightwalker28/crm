"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/TextLink";
import { useDelivery, useDeliveryActions, type DeliveryLine } from "@/hooks/inventory/useDeliveries";
import { useWarehouses } from "@/hooks/inventory/useInventory";
import { useOrderFulfilment, type OrderFulfilmentLine } from "@/hooks/inventory/useReservations";
import { useInvoiceActions } from "@/hooks/finance/usePosInvoices";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { TrackingNumber } from "@/components/inventory/TrackingNumber";
import { getDeliveryStatus, getReturnStatus } from "@/lib/statusStyles";
import type { InventoryReturn } from "@/hooks/inventory/useReturns";
import { formatQuantity as quantity } from "@/lib/quantity";
import { RecordCustomFieldsFacts, RecordCustomFieldsSection } from "@/components/customFields/RecordCustomFields";


function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A delivery: goods leaving a warehouse for one sales order (12a-erp-fulfilment.md §3.5).
 *
 * The inventory document layout: a draft edits the shipment record and how much of each
 * line ships now; *Post* takes the stock out; a posted delivery is read-only and can be
 * cancelled, which posts the reversal.
 */
export function DeliveryDocumentPage({ deliveryId = null, orderId = null }: { deliveryId?: number | null; orderId?: number | null }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "inventory_deliveries")?.actions;
  const returnActions = modules.find((module) => module.name === "inventory_returns")?.actions;
  const canInvoice = Boolean(modules.find((module) => module.name === "finance_pos")?.actions?.can_create);
  const invoicing = useInvoiceActions();
  const canViewStock = Boolean(modules.find((module) => module.name === "inventory_stock")?.actions?.can_view);
  const warehouses = useWarehouses(false, canViewStock);
  const query = useDelivery(deliveryId);
  const doc = query.data;
  const effectiveOrderId = doc?.order_id ?? orderId;
  const fulfilment = useOrderFulfilment(effectiveOrderId ?? null);
  const mutations = useDeliveryActions();

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [shippedOn, setShippedOn] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const isNew = deliveryId === null;
  const editable = isNew ? Boolean(actions?.can_create) : doc?.status === "draft" && Boolean(actions?.can_edit);
  const orderLines = (fulfilment.data?.lines ?? []).filter((line) => line.tracked);
  const multipleWarehouses = (warehouses.data?.filter((row) => row.is_active).length ?? 0) > 1;

  // Seed the form once per loaded document (or order, for a new one) — adjusting state while
  // rendering, which React re-runs immediately, rather than an effect that renders twice.
  const seedKey = isNew ? (fulfilment.data ? `order-${fulfilment.data.order_id}` : null) : doc && fulfilment.data ? `delivery-${doc.id}-${doc.status}` : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setCustomValues(doc?.custom_fields ?? {});
    setShippedOn(doc?.shipped_on ?? "");
    setCarrier(doc?.carrier ?? "");
    setTracking(doc?.tracking_number ?? "");
    setNotes(doc?.notes ?? "");
    const seeded: Record<number, string> = {};
    for (const line of fulfilment.data?.lines ?? []) {
      const onDraft = doc?.lines?.find((item) => item.order_line_id === line.order_line_id);
      seeded[line.order_line_id] = onDraft ? String(Number(onDraft.quantity)) : isNew ? String(Math.min(Number(line.reserved), Number(line.to_deliver))) : "0";
    }
    setQuantities(seeded);
  }

  const shippingLines = orderLines.filter((line) => Number(quantities[line.order_line_id] || 0) > 0);
  const totalUnits = shippingLines.reduce((sum, line) => sum + Number(quantities[line.order_line_id] || 0), 0);
  const invalidLine = orderLines.find((line) => {
    const value = Number(quantities[line.order_line_id] || 0);
    return !Number.isFinite(value) || value < 0 || value > Number(line.to_deliver);
  });

  async function save() {
    if (!effectiveOrderId) return;
    if (invalidLine) { setError(`${invalidLine.name}: ship between 0 and ${quantity(invalidLine.to_deliver)}.`); return; }
    if (!shippingLines.length) { setError("Enter a quantity to ship on at least one line."); return; }
    const payload = {
      custom_fields: customValues,
      shipped_on: shippedOn || null, carrier: carrier.trim() || null, tracking_number: tracking.trim() || null, notes: notes.trim() || null,
      lines: shippingLines.map((line) => ({ order_line_id: line.order_line_id, quantity: quantities[line.order_line_id] })),
    };
    try {
      setError(null);
      if (isNew) {
        const saved = await mutations.create({ ...payload, order_id: effectiveOrderId });
        toast.success(`Draft ${saved.number} saved.`);
        router.push(`${DASHBOARD_ROUTES.inventoryDeliveries}/${saved.id}`);
      } else if (doc) {
        await mutations.update({ id: doc.id, payload });
        toast.success("Draft saved.");
        setLoadedKey(null);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The delivery could not be saved."); }
  }

  async function post() {
    if (!doc) return;
    const units = (doc.lines ?? []).reduce((sum, line) => sum + Number(line.quantity), 0);
    const left = orderLines.reduce((sum, line) => sum + Number(line.to_deliver), 0) - units;
    const effect = `Posting takes ${plural(units, "unit")} of ${plural(doc.line_count, "product")} out of ${doc.warehouse_name ?? "the warehouse"}.`;
    const rest = left > 0 ? ` The rest of ${doc.order_number} stays to deliver.` : ` This completes ${doc.order_number}.`;
    if (!(await confirm({ title: `Post ${doc.number}?`, description: `${effect}${rest} It can be undone by cancelling; a posted delivery cannot be edited.`, confirmLabel: "Post delivery" }))) return;
    try { setError(null); await mutations.post(doc.id); toast.success(`${doc.number} posted.`); setLoadedKey(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Posting failed."); }
  }

  async function cancel() {
    if (!doc || !cancelReason.trim()) { setError("Enter a reason."); return; }
    try { setError(null); await mutations.cancel({ id: doc.id, reason: cancelReason.trim() }); setCancelOpen(false); setCancelReason(""); toast.success(`${doc.number} cancelled; its stock is back.`); setLoadedKey(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Cancellation failed."); }
  }

  async function remove() {
    if (!doc || !(await confirm({ title: `Remove ${doc.number}?`, description: "This draft can be restored from the recycle bin.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.remove(doc.id); toast.success("Draft removed."); router.push(`/dashboard/sales/orders/${doc.order_id}?tab=fulfilment`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  // I4: a new delivery names its order by number from the start, not "Order 41".
  const orderNumber = doc?.order_number ?? fulfilment.data?.order_number ?? null;
  const missingOrder = isNew && !orderId;
  const canReturn = doc?.status === "posted" && Boolean(returnActions?.can_create)
    && (doc.lines ?? []).some((line) => Number(line.quantity) > Number(line.returned ?? 0));
  const title = doc ? `Delivery ${doc.number}` : "New delivery";
  const loading = isNew ? modulesLoading || fulfilment.isLoading : query.isLoading;
  const loadError = isNew ? fulfilment.error : query.error;

  return (
    <PageShell
      variant="document"
      title={title}
      description={doc
        ? [doc.order_number, doc.customer_name, doc.posted_at ? `Posted ${formatDateTime(doc.posted_at)}` : null].filter(Boolean).join(" · ")
        : missingOrder ? "A delivery starts from a confirmed order: open the order's Fulfilment tab and choose Create delivery."
        : "Choose how much of each line ships now. The rest stays on the order to deliver."}
      backHref={DASHBOARD_ROUTES.inventoryDeliveries}
      isLoading={loading}
      isPermissionDenied={isForbiddenError(loadError) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={Boolean(loadError) && !isForbiddenError(loadError)}
      onRetry={() => void (isNew ? fulfilment.refetch() : query.refetch())}
      actions={
        <div className="flex flex-wrap gap-2">
          {doc ? <StatusValue status={getDeliveryStatus(doc.status)} context="record" /> : null}
          {doc?.status === "draft" && actions?.can_edit ? <Button onClick={() => void post()} disabled={mutations.isSaving}>Post</Button> : null}
          {doc && doc.status !== "cancelled" ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.inventoryDeliveries}/${doc.id}/print`}><Printer />Delivery note</Link></Button> : null}
          {canReturn && doc ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.inventoryReturns}/new?delivery_id=${doc.id}`}>Record return</Link></Button> : null}
          {/* E5 (12c §3.5): invoice exactly what this delivery shipped (Business Central's Get Shipment Lines). */}
          {doc?.status === "posted" && canInvoice ? (
            <Button variant="outline" disabled={invoicing.isSaving} onClick={() => void invoicing.draftFromSource({ order_id: doc.order_id, delivery_id: doc.id })
              .then((draft) => router.push(`${DASHBOARD_ROUTES.invoices}/${draft.id}`))
              .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : "The invoice could not be drafted."))}>
              Create invoice
            </Button>
          ) : null}
          {doc?.status === "posted" && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setCancelOpen(true); }}>Cancel delivery</Button> : null}
          {doc?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {missingOrder ? null : (<>
      <FactList className="grid-cols-2 lg:grid-cols-4">
        <Fact label="Order">
          {effectiveOrderId ? <TextLink href={`/dashboard/sales/orders/${effectiveOrderId}?tab=fulfilment`}>{orderNumber ?? "Open order"}</TextLink> : "—"}
        </Fact>
        {doc?.customer_name ? <Fact label="Customer">{doc.customer_name}</Fact> : null}
        {multipleWarehouses ? <Fact label="Warehouse">{doc?.warehouse_name ?? fulfilment.data?.warehouse_name ?? "—"}</Fact> : null}
        {!editable && doc ? <Fact label="Shipped on">{doc.shipped_on ? formatDateOnly(doc.shipped_on) : "—"}</Fact> : null}
        {!editable && doc?.carrier ? <Fact label="Carrier">{doc.carrier}</Fact> : null}
        {!editable && doc?.tracking_number ? <Fact label="Tracking number"><TrackingNumber carrier={doc.carrier} number={doc.tracking_number} /></Fact> : null}
        {doc?.status === "cancelled" && doc.cancel_reason ? <Fact label="Cancelled because">{doc.cancel_reason}</Fact> : null}
      </FactList>

      {editable ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Field><FieldLabel htmlFor="delivery-shipped-on">Shipped on</FieldLabel><Input id="delivery-shipped-on" type="date" value={shippedOn} onChange={(event) => setShippedOn(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="delivery-carrier">Carrier</FieldLabel><Input id="delivery-carrier" maxLength={120} value={carrier} onChange={(event) => setCarrier(event.target.value)} /></Field>
          <Field><FieldLabel htmlFor="delivery-tracking">Tracking number</FieldLabel><Input id="delivery-tracking" maxLength={120} value={tracking} onChange={(event) => setTracking(event.target.value)} /></Field>
          <Field className="lg:col-span-3"><FieldLabel htmlFor="delivery-notes">Notes</FieldLabel><Textarea id="delivery-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
        </div>
      ) : doc?.notes ? <p className="text-p-sm text-copy-secondary">{doc.notes}</p> : null}

      {editable ? <RecordCustomFieldsSection moduleKey="inventory_deliveries" values={customValues} onChange={setCustomValues} /> : doc ? <RecordCustomFieldsFacts moduleKey="inventory_deliveries" values={doc.custom_fields} /> : null}

      <section className="flex flex-col gap-3">
        <SectionHeading description={editable ? `${plural(totalUnits, "unit")} on this delivery.` : undefined}>Lines</SectionHeading>
        {editable ? (
          <RecordTable<OrderFulfilmentLine>
            variant="lineItems"
            label="Delivery lines"
            rows={orderLines.filter((line) => Number(line.to_deliver) > 0 || Number(quantities[line.order_line_id] || 0) > 0)}
            rowKey={(line) => line.order_line_id}
            isLoading={fulfilment.isLoading}
            emptyState={{ title: "Nothing left to deliver" }}
            columns={[
              { key: "item", label: "Item", size: "lg", render: (line) => line.name },
              { key: "ordered", label: "Ordered", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.ordered)}</span> },
              { key: "to_deliver", label: "To deliver", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.to_deliver)}</span> },
              { key: "reserved", label: "Reserved", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.reserved)}</span> },
              { key: "this", label: "This delivery", size: "md", align: "right", interactive: true, render: (line) => (
                <Input
                  aria-label={`Ship now: ${line.name}`}
                  type="number"
                  min={0}
                  max={Number(line.to_deliver)}
                  step="0.0001"
                  inputMode="decimal"
                  value={quantities[line.order_line_id] ?? "0"}
                  onChange={(event) => setQuantities((current) => ({ ...current, [line.order_line_id]: event.target.value }))}
                />
              ) },
            ]}
          />
        ) : (
          <RecordTable<DeliveryLine>
            variant="readOnly"
            label="Delivery lines"
            rows={doc?.lines ?? []}
            rowKey={(line) => line.id}
            emptyState={{ title: "No lines" }}
            columns={[
              { key: "item", label: "Item", size: "lg", render: (line) => line.name },
              { key: "sku", label: "SKU", size: "sm", render: (line) => line.sku ?? "—" },
              { key: "ordered", label: "Ordered", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.ordered)}</span> },
              { key: "quantity", label: "Shipped", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
              { key: "returned", label: "Returned", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.returned)}</span> },
            ]}
          />
        )}
      </section>

      {doc?.returns?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Returns</SectionHeading>
          <RecordTable<InventoryReturn>
            variant="readOnly"
            label="Returns against this delivery"
            rows={doc.returns}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.inventoryReturns}/${row.id}`}
            emptyState={{ title: "No returns" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getReturnStatus(row.status)} /> },
              { key: "reason", label: "Reason", render: (row) => row.reason },
              { key: "units", label: "Units", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.total_quantity)}</span> },
            ]}
          />
        </section>
      ) : null}
      </>)}

      {editable && !missingOrder ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : doc ? "A draft takes no stock until it is posted." : "Save a draft, then post it to take the stock out."}>
          <Button type="button" variant="outline" asChild><Link href={effectiveOrderId ? `/dashboard/sales/orders/${effectiveOrderId}?tab=fulfilment` : DASHBOARD_ROUTES.inventoryDeliveries}>Back</Link></Button>
          <Button type="button" onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button>
        </FormFooter>
      ) : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${doc?.number ?? "delivery"}`}
        description="The stock goes back to the warehouse and the order has it to deliver again. For goods the customer sends back, record a return instead."
        closeLabel="Close cancellation"
        onSubmit={() => void cancel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>Reverse and cancel</Button></>}
      >
        <Field><FieldLabel htmlFor="delivery-cancel-reason">Reason</FieldLabel><Input id="delivery-cancel-reason" maxLength={120} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field>
      </EditorPanel>
    </PageShell>
  );
}

