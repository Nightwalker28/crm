"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PicklistField } from "@/components/picklists/PicklistSelect";
import { PicklistText } from "@/components/picklists/PicklistText";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormValue } from "@/components/forms/RecordForm";
import { validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { vendorFieldRenderer } from "@/components/purchasing/vendorFieldRenderer";
import { DocumentHistory } from "@/components/recordActivity/DocumentHistory";
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
import { useFinanceDocumentActions } from "@/hooks/finance/useFinanceDocuments";
import type { PaymentRecord } from "@/hooks/finance/usePosInvoices";
import { usePurchaseBill } from "@/hooks/purchasing/usePurchasing";
import { useVendorCredit, useVendorDocumentActions, useVendorReturn, type VendorCredit } from "@/hooks/purchasing/useVendorDocuments";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useBaseCurrency, useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useConfirm } from "@/hooks/useConfirm";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";
import { isForbiddenError } from "@/lib/api";
import { formatMoney } from "@/lib/currency";
import { formatDateOnly, todayIsoDate } from "@/lib/datetime";
import { formatQuantity as quantity } from "@/lib/quantity";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPaymentRecordStatus, getVendorCreditStatus } from "@/lib/statusStyles";

/** The header the `full_form` layout draws, keyed by field key. */
type CreditHeader = RecordFormValue & {
  vendor_id: number | null;
  vendor_name: string;
  bill_id: number | null;
  bill_name: string;
  vendor_return_id: number | null;
  vendor_return_name: string;
  vendor_reference: string;
  credit_date: string;
  currency: string;
  reason: string;
  notes: string;
};

type DraftLine = {
  key: number; billLineId: number | null; returnLineId: number | null; productId: number | null; serviceId: number | null;
  description: string; quantity: string; unitCost: string; tax: string;
};
let nextKey = 1;
const blankLine = (): DraftLine => ({ key: nextKey++, billLineId: null, returnLineId: null, productId: null, serviceId: null, description: "", quantity: "1", unitCost: "0", tax: "" });

const inputId = (fieldKey: string) => `vendor-credit-${fieldKey.replace(/_/g, "-")}`;
const lineTotal = (line: DraftLine) => (Number(line.quantity) || 0) * (Number(line.unitCost) || 0) + (Number(line.tax) || 0);

/**
 * A vendor credit (13c §3.6): what a vendor owes back, the mirror of a bill.
 *
 * From a bill or a vendor return, *Create draft* lets the server take the lines (what is left
 * to credit on the bill, or what went back at the bill's cost); a blank credit takes typed
 * lines. *Issue* numbers it and applies it to its bill first. What is left is applied to other
 * open bills of the vendor, or refunded.
 */
export function VendorCreditDocumentPage({ creditId = null, billId = null, vendorReturnId = null }: {
  creditId?: number | null; billId?: number | null; vendorReturnId?: number | null;
}) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "purchase_vendor_credits")?.actions;
  const canRefund = Boolean(modules.find((module) => module.name === "finance_payments")?.actions?.can_create);
  const query = useVendorCredit(creditId);
  const credit = query.data;
  const isNew = creditId === null;
  const sourceBill = usePurchaseBill(isNew ? billId : null);
  const sourceReturn = useVendorReturn(isNew ? vendorReturnId : null);
  const fromSource = isNew ? Boolean(billId || vendorReturnId) : Boolean(credit?.bill_id || credit?.vendor_return_id);
  const currencies = useCompanyCurrencies().data;
  const baseCurrency = useBaseCurrency().data;
  const layoutQuery = useResolvedRecordLayout("purchase_vendor_credits", "full_form");
  const mutations = useVendorDocumentActions();
  const finance = useFinanceDocumentActions();

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [header, setHeader] = useState<CreditHeader | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"apply" | "refund" | "void" | null>(null);
  const [applyAmounts, setApplyAmounts] = useState<Record<number, string>>({});
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("");
  const [refundDate, setRefundDate] = useState(todayIsoDate);
  const [refundReference, setRefundReference] = useState("");
  const [reason, setReason] = useState("");

  const editable = isNew ? Boolean(actions?.can_create) : credit?.status === "draft" && Boolean(actions?.can_edit);
  // A credit from a bill or a return belongs to that vendor and currency; the server sets both.
  const omitFieldKeys = fromSource ? ["vendor_id", "currency"] : ["bill_id", "vendor_return_id"];

  const seedKey = isNew
    ? (billId ? (sourceBill.data ? `bill-${billId}` : null) : vendorReturnId ? (sourceReturn.data ? `return-${vendorReturnId}` : null) : "new")
    : credit ? `credit-${credit.id}-${credit.status}-${credit.updated_at}` : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setCustomValues(credit?.custom_fields ?? {});
    const bill = sourceBill.data;
    const doc = sourceReturn.data;
    setHeader({
      vendor_id: credit?.vendor_id ?? bill?.vendor_id ?? doc?.vendor_id ?? null,
      vendor_name: credit?.vendor_name ?? bill?.vendor_name ?? doc?.vendor_name ?? "",
      bill_id: credit?.bill_id ?? bill?.id ?? null,
      bill_name: credit?.bill_number ?? bill?.number ?? "",
      vendor_return_id: credit?.vendor_return_id ?? doc?.id ?? null,
      vendor_return_name: credit?.vendor_return_number ?? doc?.number ?? "",
      vendor_reference: credit?.vendor_reference ?? "",
      credit_date: credit?.credit_date ?? todayIsoDate(),
      currency: credit?.currency ?? bill?.currency ?? doc?.currency ?? "",
      reason: credit?.reason ?? (doc ? doc.reason : ""),
      notes: credit?.notes ?? "",
    });
    setLines(credit?.lines?.length ? credit.lines.map((line) => ({
      key: nextKey++, billLineId: line.bill_line_id, returnLineId: line.vendor_return_line_id, productId: line.catalog_product_id,
      serviceId: line.catalog_service_id, description: line.description, quantity: String(Number(line.quantity)),
      unitCost: String(Number(line.unit_cost)), tax: Number(line.tax_amount) ? String(Number(line.tax_amount)) : "",
    })) : [blankLine()]);
  }

  const currencyCode = header?.currency || credit?.currency || baseCurrency || currencies?.[0] || "USD";
  const total = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const updateLine = (updated: DraftLine) => setLines((current) => current.map((line) => (line.key === updated.key ? updated : line)));
  // A new credit from a source lets the server take the lines; everything else edits them here.
  const showLines = !(isNew && fromSource);

  async function save(andIssue: boolean) {
    if (!header) return;
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, header, customValues, omitFieldKeys) : {};
    if (!fromSource && !header.vendor_id) nextErrors.vendor_id = "Choose a vendor.";
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setError("Check the highlighted fields."); return; }
    const chosen = lines.filter((line) => Number(line.quantity) > 0);
    if (showLines) {
      if (!chosen.length) { setError("Credit at least one line."); return; }
      if (chosen.some((line) => !line.billLineId && !line.description.trim())) { setError("Describe every line."); return; }
    }
    const payload = {
      custom_fields: customValues,
      vendor_reference: header.vendor_reference.trim() || null, credit_date: header.credit_date || null,
      reason: header.reason.trim() || null, notes: header.notes.trim() || null,
      ...(fromSource ? {} : { vendor_id: header.vendor_id, currency: currencyCode }),
      ...(showLines ? { lines: chosen.map((line) => ({
        bill_line_id: line.billLineId, vendor_return_line_id: line.returnLineId, catalog_product_id: line.billLineId ? null : line.productId,
        catalog_service_id: line.billLineId ? null : line.serviceId, description: line.description.trim() || null,
        quantity: line.quantity, unit_cost: line.unitCost, tax_amount: line.tax || null,
      })) } : {}),
    };
    if (andIssue && !(await confirm({ title: credit?.number ? `Issue ${credit.number}?` : "Issue this vendor credit?",
      description: `${header.vendor_name || "The vendor"} owes ${formatMoney(showLines ? total : Number(credit?.total ?? 0), currencyCode) ?? total} back. `
        + (header.bill_id ? "It is applied to its bill first. " : "") + "An issued credit cannot be edited.", confirmLabel: "Issue credit" }))) return;
    try {
      setError(null);
      let saved: VendorCredit | null = credit ?? null;
      if (isNew) saved = await mutations.createCredit({ ...payload, bill_id: billId, vendor_return_id: vendorReturnId });
      else if (credit) await mutations.updateCredit({ id: credit.id, payload });
      if (saved && andIssue) {
        const issued = await mutations.issueCredit(saved.id);
        toast.success(`Vendor credit ${issued.number} issued.`);
      } else {
        toast.success("Draft saved.");
      }
      if (isNew && saved) router.push(`${DASHBOARD_ROUTES.vendorCredits}/${saved.id}`);
      else setLoadedKey(null);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The vendor credit could not be saved."); }
  }

  function openApply() {
    if (!credit) return;
    // Fill the oldest bills first, up to what is left of the credit.
    let left = Number(credit.credit_remaining);
    const seeded: Record<number, string> = {};
    for (const bill of credit.open_bills ?? []) {
      const amount = Math.min(left, Number(bill.balance_due));
      seeded[bill.id] = amount > 0 ? amount.toFixed(2) : "";
      left -= Math.max(amount, 0);
    }
    setApplyAmounts(seeded);
    setError(null);
    setPanel("apply");
  }

  async function submitPanel() {
    if (!credit || !panel) return;
    try {
      setError(null);
      if (panel === "apply") {
        const allocations = Object.entries(applyAmounts).filter(([, amount]) => Number(amount) > 0).map(([billId, amount]) => ({ bill_id: Number(billId), amount }));
        if (!allocations.length) { setError("Enter an amount on at least one bill."); return; }
        await mutations.applyCredit({ id: credit.id, allocations });
        toast.success("Vendor credit applied.");
      } else if (panel === "refund") {
        if (!(Number(refundAmount) > 0)) { setError("Enter the amount the vendor paid back."); return; }
        await finance.recordPayment({ direction: "received", kind: "refund", paid_on: refundDate || null, method: refundMethod || null,
          reference: refundReference.trim() || null, allocations: [{ vendor_credit_id: credit.id, amount: refundAmount }] });
        toast.success("Refund recorded.");
      } else {
        if (!reason.trim()) { setError("Enter a reason."); return; }
        await mutations.voidCredit({ id: credit.id, reason: reason.trim() });
        toast.success(`${credit.number} voided.`);
      }
      setPanel(null);
      setReason("");
      setLoadedKey(null);
      void query.refetch();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The vendor credit could not be changed."); }
  }

  async function remove() {
    if (!credit || !(await confirm({ title: "Remove this draft?", description: "It can be restored from the recycle bin.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.removeCredit(credit.id); toast.success("Draft removed."); router.push(DASHBOARD_ROUTES.vendorCredits); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  const remaining = Number(credit?.credit_remaining ?? 0);
  const refunded = (credit?.refunds ?? []).some((refund) => refund.status === "posted");
  const loading = isNew ? modulesLoading || sourceBill.isLoading || sourceReturn.isLoading : query.isLoading;
  const loadError = isNew ? sourceBill.error ?? sourceReturn.error : query.error;

  return (
    <PageShell
      variant="document"
      title={credit ? `Vendor credit ${credit.number ?? "(draft)"}` : "New vendor credit"}
      description={credit
        ? [credit.vendor_name, credit.bill_number, credit.vendor_return_number, credit.credit_date ? formatDateOnly(credit.credit_date) : null].filter(Boolean).join(" · ")
        : fromSource ? "Create the draft: it takes what is left to credit, and you can adjust it before issuing." : "A credit the vendor sent on its own: enter what it covers."}
      backHref={DASHBOARD_ROUTES.vendorCredits}
      isLoading={loading}
      isPermissionDenied={isForbiddenError(loadError) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={Boolean(loadError) && !isForbiddenError(loadError)}
      onRetry={() => void (isNew ? (billId ? sourceBill.refetch() : sourceReturn.refetch()) : query.refetch())}
      actions={
        <div className="flex flex-wrap gap-2">
          {credit ? <StatusValue status={getVendorCreditStatus(credit.status)} context="record" /> : null}
          {credit?.status === "issued" && remaining > 0 && actions?.can_edit && credit.open_bills?.length ? <Button onClick={openApply}>Apply to bills</Button> : null}
          {credit?.status === "issued" && remaining > 0 && canRefund ? (
            <Button variant="outline" onClick={() => { setRefundAmount(remaining.toFixed(2)); setError(null); setPanel("refund"); }}>Record refund</Button>
          ) : null}
          {credit?.status === "issued" && actions?.can_edit && !refunded ? <Button variant="outline" onClick={() => { setError(null); setPanel("void"); }}>Void</Button> : null}
          {credit?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {credit?.status === "void" && credit.void_reason ? (
        <FactList className="grid-cols-2 lg:grid-cols-4"><Fact label="Voided because">{credit.void_reason}</Fact></FactList>
      ) : null}
      {editable && fromSource && header ? (
        <FactList className="grid-cols-2 lg:grid-cols-4"><Fact label="Vendor">{header.vendor_name || "—"}</Fact><Fact label="Currency">{currencyCode}</Fact></FactList>
      ) : null}

      {editable && header ? (
        <LayoutRecordFormBody<CreditHeader>
          moduleKey="purchase_vendor_credits"
          value={header}
          onChange={setHeader}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={inputId}
          action={isNew ? "create" : "edit"}
          errors={fieldErrors}
          renderField={vendorFieldRenderer(header)}
          slots={{ omitFieldKeys }}
        />
      ) : credit ? (
        <DocumentDetailHeader
          moduleKey="purchase_vendor_credits"
          record={credit}
          currency={credit.currency}
          links={{
            vendor_id: `/dashboard/sales/organizations/${credit.vendor_id}`,
            bill_id: credit.bill_id ? `${DASHBOARD_ROUTES.purchaseBills}/${credit.bill_id}` : null,
            vendor_return_id: credit.vendor_return_id ? `${DASHBOARD_ROUTES.vendorReturns}/${credit.vendor_return_id}` : null,
          }}
          omitFieldKeys={[...(credit.bill_id ? [] : ["bill_id"]), ...(credit.vendor_return_id ? [] : ["vendor_return_id"]),
            ...(credit.status === "issued" ? [] : ["credit_remaining"])]}
        />
      ) : null}

      {showLines ? (
        <section className="flex flex-col gap-3">
          <SectionHeading description={editable ? `Total ${formatMoney(total, currencyCode, { maximumFractionDigits: 2 }) ?? total}` : undefined}>Lines</SectionHeading>
          {editable ? (
            <LineItemsEditor<DraftLine>
              id="vendor-credit-lines"
              label="Vendor credit lines"
              lines={lines}
              lineKey={(line) => line.key}
              onChange={setLines}
              // A bill's or a return's lines are theirs; only a blank credit adds its own.
              createLine={fromSource ? undefined : blankLine}
              addLabel="Add line"
              lineLabel={(line) => line.description || "line"}
              columns={[
                { key: "description", label: "Description", size: "lg", share: 4, render: (line, { index, cellProps }) => (line.billLineId || line.returnLineId
                  ? <span className="block truncate">{line.description}</span>
                  : <LineTextInput cellProps={cellProps("description")} ariaLabel={`Description, line ${index + 1}`} value={line.description}
                      onChange={(value) => updateLine({ ...line, description: value })} />) },
                { key: "quantity", label: "Quantity", size: "sm", align: "right", share: 1.25, render: (line, { cellProps }) => (
                  <LineNumberInput cellProps={cellProps("quantity")} ariaLabel={`Quantity for ${line.description || "line"}`} step="0.0001" value={line.quantity} onChange={(value) => updateLine({ ...line, quantity: value })} />
                ) },
                { key: "cost", label: "Unit cost", size: "sm", align: "right", share: 1.5, render: (line, { cellProps }) => (
                  <LineNumberInput cellProps={cellProps("cost")} ariaLabel={`Unit cost for ${line.description || "line"}`} step="0.0001" value={line.unitCost} onChange={(value) => updateLine({ ...line, unitCost: value })} />
                ) },
                { key: "tax", label: "Tax", size: "sm", align: "right", share: 1.25, render: (line, { cellProps }) => (
                  <LineNumberInput cellProps={cellProps("tax")} ariaLabel={`Tax for ${line.description || "line"}`} value={line.tax} onChange={(value) => updateLine({ ...line, tax: value })} />
                ) },
                { key: "total", label: "Total", size: "sm", align: "right", share: 1.5, render: (line) => <span className="block truncate tabular-nums"><Money amount={lineTotal(line)} currency={currencyCode} /></span> },
              ]}
            />
          ) : (
            <RecordTable<NonNullable<VendorCredit["lines"]>[number]>
              variant="readOnly"
              label="Vendor credit lines"
              rows={credit?.lines ?? []}
              rowKey={(row) => row.id}
              emptyState={{ title: "No lines" }}
              columns={[
                { key: "description", label: "Description", size: "lg", render: (row) => row.description },
                { key: "quantity", label: "Quantity", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.quantity)}</span> },
                { key: "cost", label: "Unit cost", size: "sm", align: "right", render: (row) => <Money amount={row.unit_cost} currency={credit?.currency} /> },
                { key: "tax", label: "Tax", size: "sm", align: "right", render: (row) => <Money amount={row.tax_amount} currency={credit?.currency} /> },
                { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.line_total} currency={credit?.currency} /> },
              ]}
            />
          )}
        </section>
      ) : null}

      {credit?.applications?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Applied to bills</SectionHeading>
          <RecordTable
            variant="readOnly"
            label="Bills this credit is applied to"
            rows={credit.applications}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.purchaseBills}/${row.bill_id}`}
            emptyState={{ title: "Not applied" }}
            columns={[
              { key: "bill", label: "Bill", size: "md", render: (row) => <span className="font-semibold text-copy-primary">{row.bill_number}</span> },
              { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={credit.currency} /> },
            ]}
          />
        </section>
      ) : null}

      {credit?.refunds?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Refunds</SectionHeading>
          <RecordTable<PaymentRecord>
            variant="readOnly"
            label="Refunds of this vendor credit"
            rows={credit.refunds}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.payments}/${row.id}`}
            emptyState={{ title: "No refunds" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "paid_on", label: "Received on", size: "sm", render: (row) => formatDateOnly(row.paid_on) },
              { key: "method", label: "Method", size: "sm", render: (row) => <PicklistText listKey="payment_method" value={row.method} /> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPaymentRecordStatus(row.status)} /> },
              { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={row.currency} /> },
            ]}
          />
        </section>
      ) : null}

      {credit ? <DocumentHistory moduleKey="purchase_vendor_credits" entityId={credit.id} canEdit={Boolean(actions?.can_edit)} /> : null}

      {editable && header ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : "A draft changes nothing until it is issued."}>
          <Button type="button" variant="outline" asChild><Link href={credit ? DASHBOARD_ROUTES.vendorCredits
            : billId ? `${DASHBOARD_ROUTES.purchaseBills}/${billId}` : vendorReturnId ? `${DASHBOARD_ROUTES.vendorReturns}/${vendorReturnId}` : DASHBOARD_ROUTES.vendorCredits}>Back</Link></Button>
          <Button type="button" variant={actions?.can_edit && showLines ? "outline" : "default"} onClick={() => void save(false)} disabled={mutations.isSaving}>
            {isNew && fromSource ? "Create draft" : "Save draft"}
          </Button>
          {actions?.can_edit && showLines ? <Button type="button" onClick={() => void save(true)} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save and issue"}</Button> : null}
        </FormFooter>
      ) : error && !panel ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={panel !== null}
        onOpenChange={(open) => { if (!open) setPanel(null); }}
        title={panel === "apply" ? "Apply to bills" : panel === "refund" ? "Record refund" : `Void ${credit?.number ?? "vendor credit"}`}
        description={panel === "apply"
          ? `${formatMoney(remaining, credit?.currency) ?? remaining} left to apply to ${credit?.vendor_name ?? "the vendor"}'s open bills in ${credit?.currency ?? ""}.`
          : panel === "refund" ? `Money ${credit?.vendor_name ?? "the vendor"} paid back against this credit.`
          : "Its bill applications are undone; the bills owe that amount again."}
        closeLabel="Close panel"
        onSubmit={() => void submitPanel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setPanel(null)}>Back</Button><Button type="submit" variant={panel === "void" ? "destructive" : "default"} disabled={mutations.isSaving || finance.isSaving}>
          {panel === "apply" ? "Apply credit" : panel === "refund" ? "Record refund" : "Void credit"}</Button></>}
      >
        {panel === "apply" ? (
          <div className="flex flex-col gap-4">
            {(credit?.open_bills ?? []).map((bill) => (
              <Field key={bill.id}>
                <FieldLabel htmlFor={`apply-bill-${bill.id}`}>{bill.number} · {bill.vendor_invoice_number}</FieldLabel>
                <Input id={`apply-bill-${bill.id}`} type="number" min="0" step="0.01" inputMode="decimal" max={Number(bill.balance_due)} value={applyAmounts[bill.id] ?? ""}
                  onChange={(event) => setApplyAmounts((current) => ({ ...current, [bill.id]: event.target.value }))} aria-describedby={`apply-bill-${bill.id}-owed`} />
                <FieldDescription id={`apply-bill-${bill.id}-owed`}>{formatMoney(bill.balance_due, bill.currency)} owed{bill.due_date ? `, due ${formatDateOnly(bill.due_date)}` : ""}.</FieldDescription>
              </Field>
            ))}
          </div>
        ) : panel === "refund" ? (
          <div className="flex flex-col gap-4">
            <Field>
              <FieldLabel htmlFor="vendor-refund-amount">Amount</FieldLabel>
              <Input id="vendor-refund-amount" type="number" min="0.01" max={remaining} step="0.01" inputMode="decimal" value={refundAmount} onChange={(event) => setRefundAmount(event.target.value)} />
            </Field>
            <PicklistField id="vendor-refund-method" listKey="payment_method" label="Method" value={refundMethod} onChange={setRefundMethod} />
            <Field><FieldLabel htmlFor="vendor-refund-date">Received on</FieldLabel><Input id="vendor-refund-date" type="date" max={todayIsoDate()} value={refundDate} onChange={(event) => setRefundDate(event.target.value)} /></Field>
            <Field><FieldLabel htmlFor="vendor-refund-reference">Reference</FieldLabel><Input id="vendor-refund-reference" maxLength={200} value={refundReference} onChange={(event) => setRefundReference(event.target.value)} /></Field>
          </div>
        ) : (
          <Field><FieldLabel htmlFor="vendor-credit-void-reason">Reason</FieldLabel><Textarea id="vendor-credit-void-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
        )}
      </EditorPanel>
    </PageShell>
  );
}
