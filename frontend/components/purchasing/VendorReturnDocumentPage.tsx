"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormFieldContext, RecordFormValue } from "@/components/forms/RecordForm";
import { QuickCreateField, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { DocumentHistory } from "@/components/recordActivity/DocumentHistory";
import { DocumentDetailHeader } from "@/components/transactions/DocumentLayoutHeader";
import { FormFooter } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusValue } from "@/components/ui/StatusValue";
import { usePurchaseReceipt, type ReceiptLine } from "@/hooks/purchasing/usePurchasing";
import { useVendorDocumentActions, useVendorReturn, type VendorReturn } from "@/hooks/purchasing/useVendorDocuments";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useBaseCurrency } from "@/hooks/useCompanyCurrencies";
import { useConfirm } from "@/hooks/useConfirm";
import { useResolvedRecordLayout, type ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { formatQuantity as quantity } from "@/lib/quantity";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getVendorCreditStatus, getVendorReturnResolution, getVendorReturnStatus } from "@/lib/statusStyles";

/** The header the `full_form` layout draws, keyed by field key. */
type VendorReturnHeader = RecordFormValue & {
  receipt_id: number | null;
  receipt_name: string;
  resolution: "credit" | "replace";
  reason: string;
  notes: string;
};

const RESOLUTIONS = [
  { value: "credit", label: "Credit: the vendor owes us a credit" },
  { value: "replace", label: "Replace: the vendor sends the goods again" },
] as const;

const inputId = (fieldKey: string) => `vendor-return-${fieldKey.replace(/_/g, "-")}`;
const returnable = (line: ReceiptLine) => Math.max(Number(line.quantity) - Number(line.returned ?? 0), 0);

/**
 * Goods sent back to a vendor against one posted receipt (13c §3.7).
 *
 * Lines default to what the receipt brought in less what earlier returns hold. *Ship* takes
 * stocked goods out at the receipt's cost. The resolution says what comes back: a credit (the
 * page then offers *Create vendor credit*) or the goods again (the purchase order has the
 * quantity to receive again).
 */
export function VendorReturnDocumentPage({ returnId = null, receiptId = null }: { returnId?: number | null; receiptId?: number | null }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "purchase_vendor_returns")?.actions;
  const canCredit = Boolean(modules.find((module) => module.name === "purchase_vendor_credits")?.actions?.can_create);
  const query = useVendorReturn(returnId);
  const doc = query.data;
  const effectiveReceiptId = doc?.receipt_id ?? receiptId;
  const receipt = usePurchaseReceipt(effectiveReceiptId ?? null);
  const mutations = useVendorDocumentActions();
  // A return's cost is the receipt's, in the base currency (12d §3.1).
  const baseCurrency = useBaseCurrency().data;
  const layoutQuery = useResolvedRecordLayout("purchase_vendor_returns", "full_form");

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [header, setHeader] = useState<VendorReturnHeader | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const isNew = returnId === null;
  const editable = isNew ? Boolean(actions?.can_create) : doc?.status === "draft" && Boolean(actions?.can_edit);
  const receiptLines = receipt.data?.lines ?? [];

  // Seed the form once per loaded document (or receipt, for a new one), while rendering.
  const seedKey = isNew ? (receipt.data ? `receipt-${receipt.data.id}` : null) : doc && receipt.data ? `return-${doc.id}-${doc.status}-${doc.updated_at}` : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setCustomValues(doc?.custom_fields ?? {});
    setHeader({
      receipt_id: doc?.receipt_id ?? receipt.data?.id ?? null,
      receipt_name: receipt.data?.number ?? doc?.receipt_number ?? "",
      resolution: doc?.resolution ?? "credit",
      reason: doc?.reason ?? "",
      notes: doc?.notes ?? "",
    });
    const seeded: Record<number, string> = {};
    for (const line of receiptLines) {
      const onDraft = doc?.lines?.find((item) => item.receipt_line_id === line.id);
      // A draft's own lines are part of `returned`; give them back to it.
      seeded[line.id] = onDraft ? String(Number(onDraft.quantity)) : isNew ? String(returnable(line)) : "0";
    }
    setQuantities(seeded);
  }

  const leftFor = (line: ReceiptLine) => returnable(line) + Number(doc?.lines?.find((item) => item.receipt_line_id === line.id)?.quantity ?? 0);
  const chosen = receiptLines.filter((line) => Number(quantities[line.id] || 0) > 0);
  const invalidLine = receiptLines.find((line) => {
    const value = Number(quantities[line.id] || 0);
    return !Number.isFinite(value) || value < 0 || value > leftFor(line);
  });

  function renderField(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) {
    if (field.field_key !== "resolution" || !header) return undefined;
    return (
      <QuickCreateField field={field} aria={context.aria} error={context.error}>
        <Select value={header.resolution} onValueChange={(value) => context.set({ resolution: value })} disabled={context.disabled}>
          <SelectTrigger id={context.inputId} aria-invalid={context.aria.invalid || undefined} aria-describedby={context.aria.describedBy}><SelectValue /></SelectTrigger>
          <SelectContent>{RESOLUTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
        </Select>
      </QuickCreateField>
    );
  }

  async function save(andShip = false) {
    if (!effectiveReceiptId || !header) return;
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, header, customValues) : {};
    if (!header.reason.trim()) nextErrors.reason = "Say why the goods go back.";
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      setError("Check the highlighted fields.");
      document.getElementById(firstInvalid.startsWith("custom:") ? `custom-field-purchase_vendor_returns-${firstInvalid.slice(7)}` : inputId(firstInvalid))?.focus();
      return;
    }
    if (invalidLine) { setError(`${invalidLine.product_name}: return between 0 and ${quantity(leftFor(invalidLine))}.`); return; }
    if (!chosen.length) { setError("Enter a quantity on at least one line."); return; }
    if (andShip && !(await confirmShip(chosen.reduce((sum, line) => sum + Number(quantities[line.id]), 0), header.resolution))) return;
    const payload = {
      custom_fields: customValues,
      reason: header.reason.trim(), resolution: header.resolution, notes: header.notes.trim() || null,
      lines: chosen.map((line) => ({ receipt_line_id: line.id, quantity: quantities[line.id] })),
    };
    try {
      setError(null);
      let saved: VendorReturn | null = doc ?? null;
      if (isNew) saved = await mutations.createReturn({ ...payload, receipt_id: effectiveReceiptId });
      else if (doc) await mutations.updateReturn({ id: doc.id, payload });
      if (saved && andShip) {
        await mutations.shipReturn(saved.id);
        toast.success(`${saved.number} shipped.`);
      } else {
        toast.success(isNew && saved ? `Draft ${saved.number} saved.` : "Draft saved.");
      }
      if (isNew && saved) router.push(`${DASHBOARD_ROUTES.vendorReturns}/${saved.id}`);
      else setLoadedKey(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The vendor return could not be saved."); }
  }

  function confirmShip(units: number, resolution: "credit" | "replace") {
    const effect = `Shipping takes ${quantity(units)} units out of stock at the cost they were received at.`;
    const next = resolution === "replace" ? " The purchase order will have them to receive again." : " Record the vendor's credit when it comes.";
    return confirm({ title: doc ? `Ship ${doc.number}?` : "Ship this return?", description: `${effect}${next} It can be undone by cancelling.`, confirmLabel: "Ship return" });
  }

  async function ship() {
    if (!doc) return;
    const units = (doc.lines ?? []).reduce((sum, line) => sum + Number(line.quantity), 0);
    if (!(await confirmShip(units, doc.resolution))) return;
    try { setError(null); await mutations.shipReturn(doc.id); toast.success(`${doc.number} shipped.`); setLoadedKey(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The return could not be shipped."); }
  }

  async function cancel() {
    if (!doc || !cancelReason.trim()) { setError("Enter a reason."); return; }
    try { setError(null); await mutations.cancelReturn({ id: doc.id, reason: cancelReason.trim() }); setCancelOpen(false); setCancelReason(""); toast.success(`${doc.number} cancelled; its stock is back.`); setLoadedKey(null); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Cancellation failed."); }
  }

  async function remove() {
    if (!doc || !(await confirm({ title: `Remove ${doc.number}?`, description: "This draft can be restored from the recycle bin.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.removeReturn(doc.id); toast.success("Draft removed."); router.push(`${DASHBOARD_ROUTES.purchaseReceipts}/${doc.receipt_id}`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  const missingReceipt = isNew && !receiptId;
  const loading = isNew ? modulesLoading || receipt.isLoading : query.isLoading;
  const loadError = isNew ? receipt.error : query.error;
  const backHref = effectiveReceiptId ? `${DASHBOARD_ROUTES.purchaseReceipts}/${effectiveReceiptId}` : DASHBOARD_ROUTES.vendorReturns;
  const issuedCredit = doc?.credits.some((credit) => credit.status === "issued");

  return (
    <PageShell
      variant="document"
      title={doc ? `Vendor return ${doc.number}` : "New vendor return"}
      description={doc
        ? [doc.vendor_name, doc.receipt_number, doc.order_number, doc.shipped_at ? `Shipped ${formatDateTime(doc.shipped_at)}` : null].filter(Boolean).join(" · ")
        : missingReceipt ? "A vendor return starts from a posted receipt: open the receipt and choose Return to vendor."
        : "Choose what goes back and whether the vendor credits or replaces it."}
      backHref={DASHBOARD_ROUTES.vendorReturns}
      isLoading={loading}
      isPermissionDenied={isForbiddenError(loadError) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={Boolean(loadError) && !isForbiddenError(loadError)}
      onRetry={() => void (isNew ? receipt.refetch() : query.refetch())}
      actions={
        <div className="flex flex-wrap gap-2">
          {doc ? <StatusValue status={getVendorReturnStatus(doc.status)} context="record" /> : null}
          {doc?.status === "draft" && actions?.can_edit ? <Button onClick={() => void ship()} disabled={mutations.isSaving}>Ship</Button> : null}
          {doc?.status === "shipped" && doc.resolution === "credit" && canCredit && !issuedCredit ? (
            <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.vendorCredits}/new?vendor_return_id=${doc.id}`}>Create vendor credit</Link></Button>
          ) : null}
          {doc?.status === "shipped" && actions?.can_edit ? <Button variant="outline" onClick={() => { setError(null); setCancelOpen(true); }}>Cancel return</Button> : null}
          {doc?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {missingReceipt ? null : (
        <>
          {doc?.status === "cancelled" && doc.cancel_reason ? (
            <FactList className="grid-cols-2 lg:grid-cols-4"><Fact label="Cancelled because">{doc.cancel_reason}</Fact></FactList>
          ) : null}

          {editable && header ? (
            <LayoutRecordFormBody<VendorReturnHeader>
              moduleKey="purchase_vendor_returns"
              value={header}
              onChange={setHeader}
              customValues={customValues}
              onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
              inputId={inputId}
              action={isNew ? "create" : "edit"}
              errors={fieldErrors}
              renderField={renderField}
            />
          ) : doc ? (
            <DocumentDetailHeader
              moduleKey="purchase_vendor_returns"
              record={doc}
              links={{
                vendor_id: `/dashboard/sales/organizations/${doc.vendor_id}`,
                receipt_id: `${DASHBOARD_ROUTES.purchaseReceipts}/${doc.receipt_id}`,
                order_id: `${DASHBOARD_ROUTES.purchaseOrders}/${doc.order_id}`,
              }}
              omitFieldKeys={["warehouse_id"]}
              renderValue={(field, value) => (field.field_key === "resolution" && typeof value === "string"
                ? <StatusValue status={getVendorReturnResolution(value)} />
                : undefined)}
            />
          ) : null}

          <section className="flex flex-col gap-3">
            <SectionHeading description={editable ? "Up to what the receipt brought in, less what other returns already hold." : undefined}>Lines</SectionHeading>
            {editable ? (
              <RecordTable<ReceiptLine>
                variant="lineItems"
                label="Vendor return lines"
                rows={receiptLines}
                rowKey={(line) => line.id}
                isLoading={receipt.isLoading}
                emptyState={{ title: "Nothing to return" }}
                columns={[
                  { key: "item", label: "Item", size: "lg", render: (line) => line.product_name },
                  { key: "received", label: "Received", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
                  { key: "left", label: "Can return", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(leftFor(line))}</span> },
                  { key: "quantity", label: "Returning", size: "md", align: "right", interactive: true, render: (line) => (
                    <Input aria-label={`Returning: ${line.product_name}`} type="number" min={0} max={leftFor(line)} step="0.0001" inputMode="decimal"
                      value={quantities[line.id] ?? "0"} onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))} />
                  ) },
                ]}
              />
            ) : (
              <RecordTable<NonNullable<VendorReturn["lines"]>[number]>
                variant="readOnly"
                label="Vendor return lines"
                rows={doc?.lines ?? []}
                rowKey={(line) => line.id}
                emptyState={{ title: "No lines" }}
                columns={[
                  { key: "item", label: "Item", size: "lg", render: (line) => line.product_name },
                  { key: "quantity", label: "Returned", size: "sm", align: "right", render: (line) => <span className="tabular-nums">{quantity(line.quantity)}</span> },
                  { key: "cost", label: "Unit cost", size: "sm", align: "right", render: (line) => (line.unit_cost != null ? <Money amount={line.unit_cost} currency={baseCurrency} /> : "—") },
                ]}
              />
            )}
          </section>

          {doc?.credits.length ? (
            <section className="flex flex-col gap-3">
              <SectionHeading>Vendor credits</SectionHeading>
              <RecordTable
                variant="readOnly"
                label="Vendor credits for this return"
                rows={doc.credits}
                rowKey={(row) => row.id}
                rowHref={(row) => `${DASHBOARD_ROUTES.vendorCredits}/${row.id}`}
                emptyState={{ title: "No vendor credits" }}
                columns={[
                  { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number ?? "Draft"}</span> },
                  { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getVendorCreditStatus(row.status)} /> },
                  { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.total} currency={row.currency} /> },
                ]}
              />
            </section>
          ) : null}
        </>
      )}

      {doc ? <DocumentHistory moduleKey="purchase_vendor_returns" entityId={doc.id} canEdit={Boolean(actions?.can_edit)} /> : null}

      {editable && !missingReceipt ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : doc ? "A draft moves no stock until it is shipped." : "Save a draft, then ship it when the goods leave."}>
          <Button type="button" variant="outline" asChild><Link href={backHref}>Back</Link></Button>
          <Button type="button" variant={actions?.can_edit ? "outline" : "default"} onClick={() => void save()} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save draft"}</Button>
          {actions?.can_edit ? <Button type="button" onClick={() => void save(true)} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save and ship"}</Button> : null}
        </FormFooter>
      ) : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${doc?.number ?? "vendor return"}`}
        description="The goods come back into stock, and a replacement no longer counts as to receive."
        closeLabel="Close cancellation"
        onSubmit={() => void cancel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setCancelOpen(false)}>Back</Button><Button type="submit" disabled={mutations.isSaving}>Reverse and cancel</Button></>}
      >
        <Field><FieldLabel htmlFor="vendor-return-cancel-reason">Reason</FieldLabel><Input id="vendor-return-cancel-reason" maxLength={120} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></Field>
      </EditorPanel>
    </PageShell>
  );
}
