"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormValue } from "@/components/forms/RecordForm";
import { validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { DocumentDetailHeader } from "@/components/transactions/DocumentLayoutHeader";
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
import { TextLink } from "@/components/ui/TextLink";
import { usePurchaseOrder, usePurchaseReceipt, usePurchasingActions, type PurchaseOrderLine, type ReceiptLine } from "@/hooks/purchasing/usePurchasing";
import { useReceiptVendorReturns } from "@/hooks/purchasing/useVendorDocuments";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime, todayIsoDate } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPurchaseReceiptStatus, getVendorReturnResolution, getVendorReturnStatus } from "@/lib/statusStyles";
import { formatQuantity as quantity } from "@/lib/quantity";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";
import { DocumentHistory } from "@/components/recordActivity/DocumentHistory";

/** The header the `full_form` layout draws (13b Phase 4e), keyed by field key. */
type ReceiptHeader = RecordFormValue & {
  order_id: number | null;
  order_name: string;
  warehouse_id: number | null;
  warehouse_name: string;
  received_on: string;
  vendor_delivery_ref: string;
  notes: string;
};

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const RECEIPT_INPUT_IDS: Record<string, string> = {
  received_on: "receipt-received-on",
  vendor_delivery_ref: "receipt-reference",
  notes: "receipt-notes",
};
const receiptInputId = (fieldKey: string) => RECEIPT_INPUT_IDS[fieldKey] ?? `receipt-${fieldKey.replace(/_/g, "-")}`;


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
  const canReturn = Boolean(modules.find((module) => module.name === "purchase_vendor_returns")?.actions?.can_create);
  const query = usePurchaseReceipt(receiptId);
  const receipt = query.data;
  const effectiveOrderId = receipt?.order_id ?? orderId;
  const order = usePurchaseOrder(effectiveOrderId ?? null);
  const mutations = usePurchasingActions();
  const vendorReturns = useReceiptVendorReturns(receiptId);

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [header, setHeader] = useState<ReceiptHeader | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const layoutQuery = useResolvedRecordLayout("purchase_receipts", "full_form");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const isNew = receiptId === null;
  const editable = isNew ? Boolean(actions?.can_create) : receipt?.status === "draft" && Boolean(actions?.can_edit);
  // Services are billed, never received (13c §3.5).
  const orderLines = (order.data?.lines ?? []).filter((line) => line.needs_receipt !== false);

  // Seed once per loaded receipt (or purchase order, for a new one), while rendering.
  const seedKey = isNew ? (order.data ? `order-${order.data.id}` : null) : receipt && order.data ? `receipt-${receipt.id}-${receipt.status}` : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setCustomValues(receipt?.custom_fields ?? {});
    setHeader({
      order_id: order.data?.id ?? receipt?.order_id ?? null,
      order_name: order.data?.number ?? receipt?.order_number ?? "",
      warehouse_id: receipt?.warehouse_id ?? order.data?.warehouse_id ?? null,
      warehouse_name: receipt?.warehouse_name ?? order.data?.warehouse_name ?? "",
      // A new receipt is received today unless told otherwise (13c §3.5, H19).
      received_on: receipt?.received_on ?? (isNew ? todayIsoDate() : ""),
      vendor_delivery_ref: receipt?.vendor_delivery_ref ?? "",
      notes: receipt?.notes ?? "",
    });
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

  async function save(andPost = false) {
    if (!effectiveOrderId || !header) return;
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, header, customValues) : {};
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setError("Check the highlighted fields."); return; }
    if (invalidLine) { setError(`${invalidLine.product_name}: receive between 0 and ${quantity(invalidLine.to_receive)}.`); return; }
    if (!receiving.length) { setError("Enter a received quantity on at least one line."); return; }
    const payload = {
      custom_fields: customValues,
      received_on: header.received_on || null, vendor_delivery_ref: header.vendor_delivery_ref.trim() || null, notes: header.notes.trim() || null,
      lines: receiving.map((line) => ({ order_line_id: line.id, quantity: quantities[line.id] })),
    };
    // *Save and post* (H19): one step, as the bill has, after the same confirmation as *Post*.
    if (andPost && !(await confirmPost(totalUnits, header.warehouse_name || order.data?.warehouse_name, order.data?.number))) return;
    try {
      setError(null);
      let saved: { id: number; number: string } | null = receipt ?? null;
      if (isNew) {
        saved = await mutations.createReceipt({ ...payload, order_id: effectiveOrderId });
      } else if (receipt) {
        await mutations.updateReceipt({ id: receipt.id, payload });
      }
      if (saved && andPost) {
        await mutations.postReceipt(saved.id);
        toast.success(`${saved.number} posted.`);
      } else {
        toast.success(isNew && saved ? `Draft ${saved.number} saved.` : "Draft saved.");
      }
      if (isNew && saved) router.push(`${DASHBOARD_ROUTES.purchaseReceipts}/${saved.id}`);
      else setLoadedKey(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The receipt could not be saved."); }
  }

  function confirmPost(units: number, warehouseName: string | null | undefined, orderNumber: string | null | undefined) {
    const left = orderLines.reduce((sum, line) => sum + Number(line.to_receive), 0) - units;
    const effect = `Posting adds ${plural(units, "unit")} to ${warehouseName || "the warehouse"} at the purchase order's cost; any confirmed sales orders waiting for them are reserved first.`;
    const rest = left > 0 ? ` The rest of ${orderNumber ?? "the purchase order"} stays to receive.` : ` This completes ${orderNumber ?? "the purchase order"}.`;
    return confirm({ title: receipt ? `Post ${receipt.number}?` : "Post this receipt?", description: `${effect}${rest} It can be undone by cancelling.`, confirmLabel: "Post receipt" });
  }

  async function post() {
    if (!receipt) return;
    const units = (receipt.lines ?? []).reduce((sum, line) => sum + Number(line.quantity), 0);
    if (!(await confirmPost(units, receipt.warehouse_name, receipt.order_number))) return;
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
          {/* 13c §3.7: goods go back against the receipt that brought them in. */}
          {receipt?.status === "posted" && canReturn && (receipt.lines ?? []).some((line) => Number(line.quantity) > Number(line.returned ?? 0)) ? (
            <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.vendorReturns}/new?receipt_id=${receipt.id}`}>Return to vendor</Link></Button>
          ) : null}
          {receipt?.status === "posted" && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setCancelOpen(true); }}>Cancel receipt</Button> : null}
          {receipt?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {missingOrder ? null : (
        <>
          <FactList className="grid-cols-2 lg:grid-cols-4">
            <Fact label="Vendor">{order.data?.vendor_name ?? receipt?.vendor_name ?? "—"}</Fact>
            {receipt?.status === "cancelled" && receipt.cancel_reason ? <Fact label="Cancelled because">{receipt.cancel_reason}</Fact> : null}
          </FactList>

          {editable && header ? (
            <LayoutRecordFormBody<ReceiptHeader>
              moduleKey="purchase_receipts"
              value={header}
              onChange={setHeader}
              customValues={customValues}
              onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
              inputId={receiptInputId}
              action={isNew ? "create" : "edit"}
              errors={fieldErrors}
            />
          ) : receipt ? (
            <DocumentDetailHeader
              moduleKey="purchase_receipts"
              record={receipt}
              links={{ order_id: `${DASHBOARD_ROUTES.purchaseOrders}/${receipt.order_id}` }}
            />
          ) : null}

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

      {vendorReturns.data?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Vendor returns</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Vendor returns against this receipt"
            rows={vendorReturns.data}
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

      {receipt ? <DocumentHistory moduleKey="purchase_receipts" entityId={receipt.id} canEdit={Boolean(actions?.can_edit)} /> : null}

      {editable && !missingOrder ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : receipt ? "A draft adds no stock until it is posted." : "Save a draft, then post it to add the stock."}>
          <Button type="button" variant="outline" asChild><Link href={effectiveOrderId ? `${DASHBOARD_ROUTES.purchaseOrders}/${effectiveOrderId}` : DASHBOARD_ROUTES.purchaseReceipts}>Back</Link></Button>
          <Button type="button" variant={actions?.can_edit ? "outline" : "default"} onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button>
          {actions?.can_edit ? <Button type="button" onClick={() => void save(true)} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save and post"}</Button> : null}
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
