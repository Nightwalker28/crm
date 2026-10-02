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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { TextLink } from "@/components/ui/TextLink";
import { useDelivery, type DeliveryLine } from "@/hooks/inventory/useDeliveries";
import { useWarehouses } from "@/hooks/inventory/useInventory";
import { useReturn, useReturnActions, type ReturnLine } from "@/hooks/inventory/useReturns";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getReturnStatus } from "@/lib/statusStyles";

function quantity(value: string | number | null | undefined) {
  if (value == null || value === "") return "—";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

type Draft = { quantity: string; restock: boolean };

/**
 * A customer return against one posted delivery (12a-erp-fulfilment.md §3.5).
 *
 * Lines default to what the delivery shipped less what has already come back. *Receive*
 * puts restocked lines back into stock; a line with Restock off (damaged goods) is recorded
 * and moves nothing. A received return is cancelled by reversal.
 */
export function ReturnDocumentPage({ returnId = null, deliveryId = null }: { returnId?: number | null; deliveryId?: number | null }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "inventory_returns")?.actions;
  const canCredit = Boolean(modules.find((module) => module.name === "finance_credit_notes")?.actions?.can_create);
  const canViewStock = Boolean(modules.find((module) => module.name === "inventory_stock")?.actions?.can_view);
  const warehouses = useWarehouses(false, canViewStock);
  const query = useReturn(returnId);
  const doc = query.data;
  const effectiveDeliveryId = doc?.delivery_id ?? deliveryId;
  const delivery = useDelivery(effectiveDeliveryId ?? null);
  const mutations = useReturnActions();

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const isNew = returnId === null;
  const editable = isNew ? Boolean(actions?.can_create) : doc?.status === "draft" && Boolean(actions?.can_edit);
  const activeWarehouses = warehouses.data?.filter((row) => row.is_active) ?? [];
  const deliveryLines = delivery.data?.lines ?? [];
  // What can still come back per delivery line; a draft's own lines are not yet counted as back.
  const returnable = (line: DeliveryLine) => Number(line.quantity) - Number(line.returned ?? 0);

  // Seed the form once per loaded document (or delivery, for a new one), while rendering.
  const seedKey = isNew ? (delivery.data ? `delivery-${delivery.data.id}` : null) : doc && delivery.data ? `return-${doc.id}-${doc.status}` : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setReason(doc?.reason ?? "");
    setNotes(doc?.notes ?? "");
    setWarehouseId(doc?.warehouse_id ?? delivery.data?.warehouse_id ?? null);
    const seeded: Record<number, Draft> = {};
    for (const line of delivery.data?.lines ?? []) {
      const onDraft = doc?.lines?.find((item) => item.delivery_line_id === line.id);
      seeded[line.id] = onDraft ? { quantity: String(Number(onDraft.quantity)), restock: onDraft.restock } : { quantity: isNew ? String(returnable(line)) : "0", restock: true };
    }
    setDrafts(seeded);
  }

  const chosen = deliveryLines.filter((line) => Number(drafts[line.id]?.quantity || 0) > 0);
  const invalidLine = deliveryLines.find((line) => {
    const value = Number(drafts[line.id]?.quantity || 0);
    return !Number.isFinite(value) || value < 0 || value > returnable(line);
  });

  async function save() {
    if (!effectiveDeliveryId) return;
    if (!reason.trim()) { setError("Enter a reason for the return."); return; }
    if (invalidLine) { setError(`${invalidLine.name}: return between 0 and ${quantity(returnable(invalidLine))}.`); return; }
    if (!chosen.length) { setError("Enter a quantity on at least one line."); return; }
    const payload = {
      reason: reason.trim(), notes: notes.trim() || null, warehouse_id: warehouseId,
      lines: chosen.map((line) => ({ delivery_line_id: line.id, quantity: drafts[line.id].quantity, restock: drafts[line.id].restock })),
    };
    try {
      setError(null);
      if (isNew) {
        const saved = await mutations.create({ ...payload, delivery_id: effectiveDeliveryId });
        toast.success(`Draft ${saved.number} saved.`);
        router.push(`${DASHBOARD_ROUTES.inventoryReturns}/${saved.id}`);
      } else if (doc) {
        await mutations.update({ id: doc.id, payload });
        toast.success("Draft saved.");
        setLoadedKey(null);
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The return could not be saved."); }
  }

  async function receive() {
    if (!doc) return;
    const lines = doc.lines ?? [];
    const restocked = lines.filter((line) => line.restock).reduce((sum, line) => sum + Number(line.quantity), 0);
    const kept = lines.filter((line) => !line.restock).reduce((sum, line) => sum + Number(line.quantity), 0);
    const effect = restocked > 0 ? `Receiving puts ${plural(restocked, "unit")} back into ${doc.warehouse_name ?? "stock"}.` : "Receiving records the return; nothing goes back into stock.";
    const damaged = kept > 0 ? ` ${plural(kept, "unit")} ${kept === 1 ? "is" : "are"} recorded without restocking.` : "";
    if (!(await confirm({ title: `Receive ${doc.number}?`, description: `${effect}${damaged} It can be undone by cancelling.`, confirmLabel: "Receive return" }))) return;
    try { setError(null); await mutations.receive(doc.id); toast.success(`${doc.number} received.`); setLoadedKey(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The return could not be received."); }
  }

  async function cancel() {
    if (!doc || !cancelReason.trim()) { setError("Enter a reason."); return; }
    try { setError(null); await mutations.cancel({ id: doc.id, reason: cancelReason.trim() }); setCancelOpen(false); setCancelReason(""); toast.success(`${doc.number} cancelled.`); setLoadedKey(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Cancellation failed."); }
  }

  async function remove() {
    if (!doc || !(await confirm({ title: `Remove ${doc.number}?`, description: "This draft can be restored from the recycle bin.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.remove(doc.id); toast.success("Draft removed."); router.push(`${DASHBOARD_ROUTES.inventoryDeliveries}/${doc.delivery_id}`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  const missingDelivery = isNew && !deliveryId;
  const loading = isNew ? modulesLoading || delivery.isLoading : query.isLoading;
  const loadError = isNew ? delivery.error : query.error;
  const backHref = effectiveDeliveryId ? `${DASHBOARD_ROUTES.inventoryDeliveries}/${effectiveDeliveryId}` : DASHBOARD_ROUTES.inventoryReturns;

  return (
    <PageShell
      variant="document"
      title={doc ? `Return ${doc.number}` : "New return"}
      description={doc
        ? [doc.delivery_number, doc.order_number, doc.customer_name, doc.received_at ? `Received ${formatDateTime(doc.received_at)}` : null].filter(Boolean).join(" · ")
        : missingDelivery ? "A return starts from a posted delivery: open the delivery and choose Record return." : "Choose what came back and whether it goes back into stock."}
      backHref={DASHBOARD_ROUTES.inventoryReturns}
      isLoading={loading}
      isPermissionDenied={isForbiddenError(loadError) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={Boolean(loadError) && !isForbiddenError(loadError)}
      onRetry={() => void (isNew ? delivery.refetch() : query.refetch())}
      actions={
        <div className="flex flex-wrap gap-2">
          {doc ? <StatusValue status={getReturnStatus(doc.status)} context="record" /> : null}
          {doc?.status === "draft" && actions?.can_edit ? <Button onClick={() => void receive()} disabled={mutations.isSaving}>Receive</Button> : null}
          {/* E5 (12c §3.5): credit what came back, against the invoice that charged for it. */}
          {doc?.status === "received" && canCredit ? <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.creditNotes}/new?return_id=${doc.id}`}>Create credit note</Link></Button> : null}
          {doc?.status === "received" && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setCancelOpen(true); }}>Cancel return</Button> : null}
          {doc?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {missingDelivery ? null : (
        <>
          <FactList className="grid-cols-2 lg:grid-cols-4">
            <Fact label="Delivery">
              {effectiveDeliveryId ? <TextLink href={`${DASHBOARD_ROUTES.inventoryDeliveries}/${effectiveDeliveryId}`}>{delivery.data?.number ?? doc?.delivery_number ?? "Delivery"}</TextLink> : "—"}
            </Fact>
            <Fact label="Order">
              {(doc?.order_id ?? delivery.data?.order_id) ? <TextLink href={`/dashboard/sales/orders/${doc?.order_id ?? delivery.data?.order_id}?tab=fulfilment`}>{doc?.order_number ?? delivery.data?.order_number ?? "Order"}</TextLink> : "—"}
            </Fact>
            {!editable && doc ? <Fact label="Reason">{doc.reason}</Fact> : null}
            {!editable && doc && activeWarehouses.length > 1 ? <Fact label="Warehouse">{doc.warehouse_name ?? "—"}</Fact> : null}
            {doc?.status === "cancelled" && doc.cancel_reason ? <Fact label="Cancelled because">{doc.cancel_reason}</Fact> : null}
          </FactList>

          {editable ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <Field><FieldLabel htmlFor="return-reason">Reason</FieldLabel><Input id="return-reason" maxLength={120} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Damaged in transit" /></Field>
              {activeWarehouses.length > 1 ? (
                <Field>
                  <FieldLabel htmlFor="return-warehouse">Receive into</FieldLabel>
                  <Select value={String(warehouseId ?? "")} onValueChange={(value) => setWarehouseId(Number(value))}>
                    <SelectTrigger id="return-warehouse"><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                    <SelectContent>{activeWarehouses.map((row) => <SelectItem key={row.id} value={String(row.id)}>{row.name}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Field className="lg:col-span-2"><FieldLabel htmlFor="return-notes">Notes</FieldLabel><Textarea id="return-notes" value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
            </div>
          ) : doc?.notes ? <p className="text-p-sm text-copy-secondary">{doc.notes}</p> : null}

          <section className="flex flex-col gap-3">
            <SectionHeading description={editable ? "Turn Restock off for damaged goods: the return is recorded, but nothing goes back into sellable stock." : undefined}>Lines</SectionHeading>
            {editable ? (
              <RecordTable<DeliveryLine>
                variant="lineItems"
                label="Return lines"
                rows={deliveryLines}
                rowKey={(line) => line.id}
                isLoading={delivery.isLoading}
                emptyState={{ title: "Nothing to return" }}
                columns={[
                  { key: "item", label: "Item", size: "lg", render: (line) => line.name },
                  { key: "shipped", label: "Shipped", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
                  { key: "back", label: "Already back", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.returned)}</span> },
                  { key: "quantity", label: "Returning", size: "md", align: "right", interactive: true, render: (line) => (
                    <Input
                      aria-label={`Returning: ${line.name}`}
                      type="number"
                      min={0}
                      max={returnable(line)}
                      step="0.0001"
                      inputMode="decimal"
                      value={drafts[line.id]?.quantity ?? "0"}
                      onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...(current[line.id] ?? { restock: true }), quantity: event.target.value } }))}
                    />
                  ) },
                  { key: "restock", label: "Restock", size: "sm", interactive: true, render: (line) => {
                    const restock = drafts[line.id]?.restock ?? true;
                    return (
                      // The state is also written out, so it is never carried by the switch's colour alone (§8).
                      <span className="inline-flex items-center gap-2">
                        <Switch
                          aria-label={`Restock ${line.name}`}
                          checked={restock}
                          onCheckedChange={(checked) => setDrafts((current) => ({ ...current, [line.id]: { ...(current[line.id] ?? { quantity: "0" }), restock: checked } }))}
                          className="relative h-6 w-11 shrink-0 rounded-full border border-line-control bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-60 data-[state=checked]:bg-action-primary"
                        >
                          <SwitchThumb className="block h-5 w-5 rounded-full bg-copy-primary data-[state=checked]:translate-x-5" />
                        </Switch>
                        <span className="text-sm text-copy-secondary">{restock ? "Yes" : "No, damaged"}</span>
                      </span>
                    );
                  } },
                ]}
              />
            ) : (
              <RecordTable<ReturnLine>
                variant="readOnly"
                label="Return lines"
                rows={doc?.lines ?? []}
                rowKey={(line) => line.id}
                emptyState={{ title: "No lines" }}
                columns={[
                  { key: "item", label: "Item", size: "lg", render: (line) => line.name },
                  { key: "shipped", label: "Shipped", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.shipped)}</span> },
                  { key: "quantity", label: "Returned", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
                  { key: "restock", label: "Restocked", size: "sm", render: (line) => (line.restock ? "Yes" : "No, damaged") },
                ]}
              />
            )}
          </section>
        </>
      )}

      {editable && !missingDelivery ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : doc ? "A draft moves no stock until it is received." : "Save a draft, then receive it when the goods arrive."}>
          <Button type="button" variant="outline" asChild><Link href={backHref}>Back</Link></Button>
          <Button type="button" onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button>
        </FormFooter>
      ) : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${doc?.number ?? "return"}`}
        description="Restocked units leave stock again, if enough remains; the delivery can then take a new return."
        closeLabel="Close cancellation"
        onSubmit={() => void cancel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>Reverse and cancel</Button></>}
      >
        <Field><FieldLabel htmlFor="return-cancel-reason">Reason</FieldLabel><Input id="return-cancel-reason" maxLength={120} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field>
      </EditorPanel>
    </PageShell>
  );
}
