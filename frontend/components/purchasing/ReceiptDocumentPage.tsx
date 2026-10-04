"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { usePurchaseOrder, usePurchaseReceipt, usePurchasingActions, type PurchaseOrderLine, type ReceiptLine } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPurchaseReceiptStatus } from "@/lib/statusStyles";
import { formatQuantity as quantity } from "@/lib/quantity";


function plural(count: number, word: string) {
  return `${count.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A receipt: stock arriving against a purchase order (12b-erp-purchasing.md §3.4).
 *
 * Lines default to what is still to receive. *Post* moves the stock in at the purchase
 * order's cost, and waiting sales orders are reserved from it at once.
 */
export function ReceiptDocumentPage({ receiptId = null, orderId = null }: { receiptId?: number | null; orderId?: number | null }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "purchase_receipts")?.actions;
  const canBill = Boolean(modules.find((module) => module.name === "purchase_bills")?.actions?.can_create);
  const query = usePurchaseReceipt(receiptId);
  const receipt = query.data;
  const effectiveOrderId = receipt?.order_id ?? orderId;
  const order = usePurchaseOrder(effectiveOrderId ?? null);
  const mutations = usePurchasingActions();

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [receivedOn, setReceivedOn] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const isNew = receiptId === null;
  const editable = isNew ? Boolean(actions?.can_create) : receipt?.status === "draft" && Boolean(actions?.can_edit);
  const orderLines = order.data?.lines ?? [];

  // Seed once per loaded receipt (or purchase order, for a new one), while rendering.
  const seedKey = isNew ? (order.data ? `order-${order.data.id}` : null) : receipt && order.data ? `receipt-${receipt.id}-${receipt.status}` : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setReceivedOn(receipt?.received_on ?? "");
    setReference(receipt?.vendor_delivery_ref ?? "");
    setNotes(receipt?.notes ?? "");
    const seeded: Record<number, string> = {};
    for (const line of order.data?.lines ?? []) {
      const onDraft = receipt?.lines?.find((item) => item.order_line_id === line.id);
      seeded[line.id] = onDraft ? String(Number(onDraft.quantity)) : isNew ? String(Number(line.to_receive)) : "0";
    }
    setQuantities(seeded);
  }

  const receiving = orderLines.filter((line) => Number(quantities[line.id] || 0) > 0);
  const totalUnits = receiving.reduce((sum, line) => sum + Number(quantities[line.id] || 0), 0);
  const invalidLine = orderLines.find((line) => {
    const value = Number(quantities[line.id] || 0);
    return !Number.isFinite(value) || value < 0 || value > Number(line.to_receive);
  });

  async function save() {
    if (!effectiveOrderId) return;
    if (invalidLine) { setError(`${invalidLine.product_name}: receive between 0 and ${quantity(invalidLine.to_receive)}.`); return; }
    if (!receiving.length) { setError("Enter a received quantity on at least one line."); return; }
    const payload = {
      received_on: receivedOn || null, vendor_delivery_ref: reference.trim() || null, notes: notes.trim() || null,
      lines: receiving.map((line) => ({ order_line_id: line.id, quantity: quantities[line.id] })),
    };
    try {
      setError(null);
      if (isNew) {
        const saved = await mutations.createReceipt({ ...payload, order_id: effectiveOrderId });
        toast.success(`Draft ${saved.number} saved.`);
        router.push(`${DASHBOARD_ROUTES.purchaseReceipts}/${saved.id}`);
      } else if (receipt) {
        await mutations.updateReceipt({ id: receipt.id, payload });
        toast.success("Draft saved.");
        setLoadedKey(null);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The receipt could not be saved."); }
  }

  async function post() {
    if (!receipt) return;
    const units = (receipt.lines ?? []).reduce((sum, line) => sum + Number(line.quantity), 0);
    const left = orderLines.reduce((sum, line) => sum + Number(line.to_receive), 0) - units;
    const effect = `Posting adds ${plural(units, "unit")} to ${receipt.warehouse_name ?? "the warehouse"} at the purchase order's cost; any confirmed sales orders waiting for them are reserved first.`;
    const rest = left > 0 ? ` The rest of ${receipt.order_number} stays to receive.` : ` This completes ${receipt.order_number}.`;
    if (!(await confirm({ title: `Post ${receipt.number}?`, description: `${effect}${rest} It can be undone by cancelling.`, confirmLabel: "Post receipt" }))) return;
    try { setError(null); await mutations.postReceipt(receipt.id); toast.success(`${receipt.number} posted.`); setLoadedKey(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Posting failed."); }
  }

  async function cancel() {
    if (!receipt || !cancelReason.trim()) { setError("Enter a reason."); return; }
    try { setError(null); await mutations.cancelReceipt({ id: receipt.id, reason: cancelReason.trim() }); setCancelOpen(false); setCancelReason(""); toast.success(`${receipt.number} cancelled; its stock is out again.`); setLoadedKey(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Cancellation failed."); }
  }

  async function remove() {
    if (!receipt || !(await confirm({ title: `Remove ${receipt.number}?`, description: "This draft can be restored from the recycle bin.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.removeReceipt(receipt.id); toast.success("Draft removed."); router.push(`${DASHBOARD_ROUTES.purchaseOrders}/${receipt.order_id}`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  const missingOrder = isNew && !orderId;
  const loading = isNew ? modulesLoading || order.isLoading : query.isLoading;
  const loadError = isNew ? order.error : query.error;

  return (
    <PageShell
      variant="document"
      title={receipt ? `Receipt ${receipt.number}` : "New receipt"}
      description={receipt
        ? [receipt.order_number, receipt.vendor_name, receipt.posted_at ? `Posted ${formatDateTime(receipt.posted_at)}` : null].filter(Boolean).join(" · ")
        : missingOrder ? "A receipt starts from a placed purchase order: open the order and choose Receive."
        : "Enter what arrived. The rest stays on the purchase order to receive."}
      backHref={DASHBOARD_ROUTES.purchaseReceipts}
      isLoading={loading}
      isPermissionDenied={isForbiddenError(loadError) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={Boolean(loadError) && !isForbiddenError(loadError)}
      onRetry={() => void (isNew ? order.refetch() : query.refetch())}
      actions={
        <div className="flex flex-wrap gap-2">
          {receipt ? <StatusValue status={getPurchaseReceiptStatus(receipt.status)} context="record" /> : null}
          {receipt?.status === "draft" && actions?.can_edit ? <Button onClick={() => void post()} disabled={mutations.isSaving}>Post</Button> : null}
          {receipt?.status === "posted" && canBill && order.data?.bill_status === "to_bill" ? (
            <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.purchaseBills}/new?receipt_id=${receipt.id}`}>Bill this receipt</Link></Button>
          ) : null}
          {receipt?.status === "posted" && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setCancelOpen(true); }}>Cancel receipt</Button> : null}
          {receipt?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {missingOrder ? null : (
        <>
          <FactList className="grid-cols-2 lg:grid-cols-4">
            <Fact label="Purchase order">
              {effectiveOrderId ? <TextLink href={`${DASHBOARD_ROUTES.purchaseOrders}/${effectiveOrderId}`}>{order.data?.number ?? receipt?.order_number ?? "Purchase order"}</TextLink> : "—"}
            </Fact>
            <Fact label="Vendor">{order.data?.vendor_name ?? receipt?.vendor_name ?? "—"}</Fact>
            {!editable && receipt ? <Fact label="Received on">{receipt.received_on ? formatDateOnly(receipt.received_on) : "—"}</Fact> : null}
            {!editable && receipt?.vendor_delivery_ref ? <Fact label="Vendor delivery ref">{receipt.vendor_delivery_ref}</Fact> : null}
            {receipt?.status === "cancelled" && receipt.cancel_reason ? <Fact label="Cancelled because">{receipt.cancel_reason}</Fact> : null}
          </FactList>

          {editable ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <Field><FieldLabel htmlFor="receipt-received-on">Received on</FieldLabel><Input id="receipt-received-on" type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} /></Field>
              <Field><FieldLabel htmlFor="receipt-reference">Vendor delivery reference</FieldLabel><Input id="receipt-reference" maxLength={120} value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
              <Field className="lg:col-span-2"><FieldLabel htmlFor="receipt-notes">Notes</FieldLabel><Textarea id="receipt-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
            </div>
          ) : receipt?.notes ? <p className="text-p-sm text-copy-secondary">{receipt.notes}</p> : null}

          <section className="flex flex-col gap-3">
            <SectionHeading description={editable ? `${plural(totalUnits, "unit")} on this receipt.` : undefined}>Lines</SectionHeading>
            {editable ? (
              <RecordTable<PurchaseOrderLine>
                variant="lineItems"
                label="Receipt lines"
                rows={orderLines.filter((line) => Number(line.to_receive) > 0 || Number(quantities[line.id] || 0) > 0)}
                rowKey={(line) => line.id}
                isLoading={order.isLoading}
                emptyState={{ title: "Nothing left to receive" }}
                columns={[
                  { key: "product", label: "Product", size: "lg", render: (line) => line.product_name },
                  { key: "vendor_sku", label: "Vendor SKU", size: "sm", render: (line) => line.vendor_sku ?? "—" },
                  { key: "ordered", label: "Ordered", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
                  { key: "to_receive", label: "To receive", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.to_receive)}</span> },
                  { key: "this", label: "Received now", size: "md", align: "right", interactive: true, render: (line) => (
                    <Input
                      aria-label={`Received now: ${line.product_name}`}
                      type="number"
                      min={0}
                      max={Number(line.to_receive)}
                      step="0.0001"
                      inputMode="decimal"
                      value={quantities[line.id] ?? "0"}
                      onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                    />
                  ) },
                ]}
              />
            ) : (
              <RecordTable<ReceiptLine>
                variant="readOnly"
                label="Receipt lines"
                rows={receipt?.lines ?? []}
                rowKey={(line) => line.id}
                emptyState={{ title: "No lines" }}
                columns={[
                  { key: "product", label: "Product", size: "lg", render: (line) => <TextLink href={`${DASHBOARD_ROUTES.products}/${line.product_id}?tab=stock`}>{line.product_name}</TextLink> },
                  { key: "sku", label: "SKU", size: "sm", render: (line) => line.sku ?? "—" },
                  { key: "ordered", label: "Ordered", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.ordered)}</span> },
                  { key: "quantity", label: "Received", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
                ]}
              />
            )}
          </section>
        </>
      )}

      {editable && !missingOrder ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : receipt ? "A draft adds no stock until it is posted." : "Save a draft, then post it to add the stock."}>
          <Button type="button" variant="outline" asChild><Link href={effectiveOrderId ? `${DASHBOARD_ROUTES.purchaseOrders}/${effectiveOrderId}` : DASHBOARD_ROUTES.purchaseReceipts}>Back</Link></Button>
          <Button type="button" onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button>
        </FormFooter>
      ) : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${receipt?.number ?? "receipt"}`}
        description="The stock comes out again, if enough remains, and the purchase order has it to receive again."
        closeLabel="Close cancellation"
        onSubmit={() => void cancel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>Reverse and cancel</Button></>}
      >
        <Field><FieldLabel htmlFor="receipt-cancel-reason">Reason</FieldLabel><Input id="receipt-cancel-reason" maxLength={120} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field>
      </EditorPanel>
    </PageShell>
  );
}
