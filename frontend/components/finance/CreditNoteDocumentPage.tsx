"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormValue } from "@/components/forms/RecordForm";
import { validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { DocumentSendAction } from "@/components/transactions/DocumentSendAction";
import { DocumentPdfButton } from "@/components/transactions/DocumentPdfButton";
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
import { Textarea } from "@/components/ui/textarea";
import { useCreditNote, useFinanceDocumentActions, useReturnCreditCandidates } from "@/hooks/finance/useFinanceDocuments";
import { usePosInvoice, type PaymentRecord, type PosInvoiceLine } from "@/hooks/finance/usePosInvoices";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly, todayIsoDate } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getCreditNoteStatus, getPaymentRecordStatus } from "@/lib/statusStyles";
import { formatQuantity as quantity } from "@/lib/quantity";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { PicklistText } from "@/components/picklists/PicklistText";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";
import { DocumentHistory } from "@/components/recordActivity/DocumentHistory";

/** The header the `full_form` layout draws (13b Phase 4e), keyed by field key. */
type CreditNoteHeader = RecordFormValue & {
  invoice_id: number | null;
  invoice_name: string;
  return_id: number | null;
  return_name: string;
  issue_date: string;
  reason: string;
  notes: string;
};

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const CREDIT_INPUT_IDS: Record<string, string> = { reason: "credit-reason", notes: "credit-notes" };
const creditInputId = (fieldKey: string) => CREDIT_INPUT_IDS[fieldKey] ?? `credit-${fieldKey.replace(/_/g, "-")}`;


type Row = { line: PosInvoiceLine; creditable: number };

/**
 * A credit note (12c-erp-invoicing.md §3.3, §3.5): E3's document layout. It credits lines of
 * one issued invoice, never more than was invoiced; prices, discount and tax come from the
 * invoice line. Issuing reduces the invoice's balance; anything beyond the balance is a
 * refund due, settled by *Record refund*.
 */
export function CreditNoteDocumentPage({ creditNoteId = null, invoiceId = null, returnId = null }: {
  creditNoteId?: number | null; invoiceId?: number | null; returnId?: number | null;
}) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "finance_credit_notes")?.actions;
  const canRefund = Boolean(modules.find((module) => module.name === "finance_payments")?.actions?.can_create);
  const query = useCreditNote(creditNoteId);
  const note = query.data;
  const candidates = useReturnCreditCandidates(creditNoteId === null ? returnId : null);
  const candidateList = candidates.data?.candidates ?? [];
  const [chosenInvoice, setChosenInvoice] = useState<number | null>(null);
  const effectiveInvoiceId = note?.invoice_id ?? invoiceId ?? chosenInvoice ?? candidateList[0]?.invoice_id ?? null;
  const invoiceQuery = usePosInvoice(effectiveInvoiceId);
  const invoice = invoiceQuery.data;
  const mutations = useFinanceDocumentActions();

  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [header, setHeader] = useState<CreditNoteHeader | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const layoutQuery = useResolvedRecordLayout("finance_credit_notes", "full_form");
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [panel, setPanel] = useState<"void" | "refund" | null>(null);
  const [panelReason, setPanelReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("");
  const [refundDate, setRefundDate] = useState(todayIsoDate);

  const isNew = creditNoteId === null;
  const editable = isNew ? Boolean(actions?.can_create) : note?.status === "draft" && Boolean(actions?.can_edit);
  const candidate = candidateList.find((row) => row.invoice_id === effectiveInvoiceId);

  // Seed once per loaded document (or invoice, for a new one), while rendering.
  const seedKey = isNew ? (invoice ? `invoice-${invoice.id}-${candidate ? "return" : "all"}` : null) : note && invoice ? `note-${note.id}-${note.status}-${note.updated_at}` : null;
  if (seedKey && seedKey !== loadedKey) {
    setLoadedKey(seedKey);
    setCustomValues(note?.custom_fields ?? {});
    setHeader({
      invoice_id: invoice?.id ?? note?.invoice_id ?? null,
      invoice_name: invoice?.invoice_number ?? note?.invoice_number ?? "",
      return_id: note?.return_id ?? returnId,
      return_name: candidates.data?.return_number ?? "",
      issue_date: note?.issue_date ?? "",
      reason: note?.reason ?? (candidates.data ? `Return ${candidates.data.return_number}` : ""),
      notes: note?.notes ?? "",
    });
    const seeded: Record<number, string> = {};
    for (const line of invoice?.lines ?? []) {
      if (line.id == null) continue;
      const onNote = note?.lines?.find((item) => item.invoice_line_id === line.id);
      const fromReturn = candidate?.lines.find((item) => item.invoice_line_id === line.id);
      seeded[line.id] = onNote ? String(Number(onNote.quantity)) : isNew ? String(Number(fromReturn ? fromReturn.quantity : candidate ? 0 : line.creditable ?? line.quantity)) : "0";
    }
    setQuantities(seeded);
  }

  const rows: Row[] = (invoice?.lines ?? []).filter((line) => line.id != null).map((line) => {
    const onNote = note?.lines?.find((item) => item.invoice_line_id === line.id);
    return { line, creditable: Number(onNote?.creditable ?? line.creditable ?? line.quantity) };
  });
  const estimate = rows.reduce((sum, row) => {
    const amount = Number(quantities[row.line.id!] || 0);
    if (!(amount > 0) || !(row.line.quantity > 0)) return sum;
    return sum + (row.line.line_total ?? 0) * (amount / row.line.quantity);
  }, 0);

  async function save(andIssue: boolean) {
    const lines = rows.map((row) => ({
      invoice_line_id: row.line.id!, quantity: quantities[row.line.id!] ?? "0",
      return_line_id: candidate?.lines.find((item) => item.invoice_line_id === row.line.id)?.return_line_id ?? null,
    })).filter((line) => Number(line.quantity) > 0);
    if (!lines.length) { setError("Enter a quantity to credit on at least one line."); return; }
    const over = rows.find((row) => Number(quantities[row.line.id!] || 0) > row.creditable);
    if (over) { setError(`${over.line.description}: only ${quantity(over.creditable)} left to credit.`); return; }
    if (!header) return;
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, header, customValues) : {};
    if (!header.reason.trim() && !nextErrors.reason) nextErrors.reason = "Say why the customer is credited.";
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      setError("Check the highlighted fields.");
      document.getElementById(firstInvalid.startsWith("custom:") ? `custom-field-finance_credit_notes-${firstInvalid.slice(7)}` : creditInputId(firstInvalid))?.focus();
      return;
    }
    const headerPayload = { reason: header.reason.trim(), notes: header.notes.trim() || null, issue_date: header.issue_date || null };
    try {
      setError(null);
      let id = note?.id ?? null;
      if (isNew && invoice) {
        const created = await mutations.createCreditNote({ invoice_id: invoice.id, return_id: returnId, ...headerPayload, lines, custom_fields: customValues });
        id = created.id;
      } else if (note) {
        await mutations.updateCreditNote({ id: note.id, payload: { ...headerPayload, lines, custom_fields: customValues } });
      }
      if (id && andIssue) {
        const issued = await mutations.issueCreditNote(id);
        toast.success(`Credit note ${issued.number} issued.`);
      } else {
        toast.success("Draft saved.");
      }
      if (isNew && id) router.push(`${DASHBOARD_ROUTES.creditNotes}/${id}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The credit note could not be saved."); }
  }

  async function issue() {
    if (!note) return;
    if (!(await confirm({ title: `Issue a credit of ${Number(note.total_amount).toFixed(2)} ${note.currency}?`,
      description: `It reduces what ${note.customer_name ?? "the customer"} owes on ${note.invoice_number}. Anything beyond the balance becomes a refund to pay back. An issued credit note cannot be edited.`,
      confirmLabel: "Issue credit note" }))) return;
    try { setError(null); const issued = await mutations.issueCreditNote(note.id); toast.success(`Credit note ${issued.number} issued.`); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The credit note could not be issued."); }
  }

  async function submitPanel() {
    if (!note || !panel) return;
    try {
      setError(null);
      if (panel === "void") {
        if (!panelReason.trim()) { setError("Enter a reason."); return; }
        await mutations.voidCreditNote({ id: note.id, reason: panelReason.trim() });
        toast.success(`${note.number} voided; the invoice balance is back.`);
      } else {
        await mutations.recordPayment({ direction: "made", kind: "refund", paid_on: refundDate || null, method: refundMethod || null,
          allocations: [{ credit_note_id: note.id, amount: note.refund_due }] });
        toast.success("Refund recorded.");
      }
      setPanel(null); setPanelReason("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The credit note could not be changed."); }
  }

  async function remove() {
    if (!note || !(await confirm({ title: "Remove this draft?", description: "It can be restored from the recycle bin.", confirmLabel: "Remove draft", variant: "destructive" }))) return;
    try { await mutations.removeCreditNote(note.id); toast.success("Draft removed."); router.push(DASHBOARD_ROUTES.creditNotes); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Removal failed."); }
  }

  const noInvoice = isNew && !invoiceId && returnId !== null && candidates.isSuccess && candidateList.length === 0;

  return (
    <PageShell
      variant="document"
      title={note ? (note.number ? `Credit note ${note.number}` : "Draft credit note") : "New credit note"}
      description={note
        ? [note.customer_name, note.invoice_number ? `Against ${note.invoice_number}` : null, note.issue_date ? `Issued ${formatDateOnly(note.issue_date)}` : "Not issued yet"].filter(Boolean).join(" · ")
        : invoice ? `Credit lines of ${invoice.invoice_number ?? "the invoice"} for ${invoice.customer_name}.` : "Credit lines of an issued invoice."}
      backHref={DASHBOARD_ROUTES.creditNotes}
      isLoading={isNew ? modulesLoading || invoiceQuery.isLoading || candidates.isLoading : query.isLoading}
      isPermissionDenied={isForbiddenError(query.error) || isForbiddenError(invoiceQuery.error) || (isNew && !modulesLoading && !actions?.can_create)}
      hasError={(Boolean(query.error) && !isForbiddenError(query.error)) || (isNew && !invoiceId && !returnId)}
      onRetry={() => void query.refetch()}
      actions={
        <div className="flex flex-wrap gap-2">
          {note ? <StatusValue status={getCreditNoteStatus(note.status)} context="record" /> : null}
          {note?.id ? <DocumentPdfButton moduleKey="finance_credit_notes" recordId={note.id} /> : null}
          {note?.id && note.status !== "draft" ? <DocumentSendAction moduleKey="finance_credit_notes" recordId={note.id} /> : null}
          {note?.status === "draft" && actions?.can_edit ? <Button onClick={() => void issue()} disabled={mutations.isSaving}>Issue credit note</Button> : null}
          {note?.status === "issued" && Number(note.refund_due) > 0 && canRefund ? <Button onClick={() => { setError(null); setPanel("refund"); }}>Record refund</Button> : null}
          {note?.status === "issued" && actions?.can_edit && !(note.refunds ?? []).some((refund) => refund.status === "posted") ? (
            <Button variant="outline" onClick={() => { setError(null); setPanel("void"); }}>Void</Button>
          ) : null}
          {note?.status === "draft" && actions?.can_delete ? <Button variant="destructiveGhost" onClick={() => void remove()}>Remove draft</Button> : null}
        </div>
      }
    >
      {noInvoice ? (
        <p className="text-sm text-copy-secondary">Nothing on this return has been invoiced, so there is nothing to credit. Its goods are simply not invoiced.</p>
      ) : null}
      {isNew && candidateList.length > 1 ? (
        <Field className="max-w-sm">
          <FieldLabel htmlFor="credit-invoice">Invoice to credit</FieldLabel>
          <Select value={String(effectiveInvoiceId ?? "")} onValueChange={(value) => setChosenInvoice(Number(value))}>
            <SelectTrigger id="credit-invoice"><SelectValue /></SelectTrigger>
            <SelectContent>{candidateList.map((row) => <SelectItem key={row.invoice_id} value={String(row.invoice_id)}>{row.invoice_number ?? `Invoice ${row.invoice_id}`}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      ) : null}

      {note && !editable ? (
        <>
          <DocumentDetailHeader
            moduleKey="finance_credit_notes"
            record={note}
            currency={note.currency}
            links={{
              invoice_id: `${DASHBOARD_ROUTES.invoices}/${note.invoice_id}`,
              return_id: note.return_id ? `${DASHBOARD_ROUTES.inventoryReturns}/${note.return_id}` : null,
            }}
            omitFieldKeys={[...(note.return_id ? [] : ["return_id"]), ...(note.status === "issued" ? [] : ["refund_due"])]}
          />
          {note.applied_amount != null || note.void_reason ? (
            <FactList className="grid-cols-2 lg:grid-cols-4">
              {note.applied_amount != null ? <Fact label="Applied to the invoice"><Money amount={note.applied_amount} currency={note.currency} context="field" /></Fact> : null}
              {note.void_reason ? <Fact label="Voided because">{note.void_reason}</Fact> : null}
            </FactList>
          ) : null}
        </>
      ) : invoice && !noInvoice && header ? (
        <LayoutRecordFormBody<CreditNoteHeader>
          moduleKey="finance_credit_notes"
          value={header}
          onChange={setHeader}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={creditInputId}
          action={isNew ? "create" : "edit"}
          errors={fieldErrors}
          slots={{ omitFieldKeys: header.return_id ? [] : ["return_id"] }}
        />
      ) : null}

      {!noInvoice ? (
        <section className="flex flex-col gap-3">
          <SectionHeading description={editable ? `About ${estimate.toFixed(2)} ${invoice?.currency ?? ""}, before the invoice's own discount and tax rate` : undefined}>Lines</SectionHeading>
          {editable ? (
            <RecordTable<Row>
              variant="lineItems"
              label="Lines to credit"
              rows={rows}
              rowKey={(row) => row.line.id!}
              emptyState={{ title: "No lines" }}
              columns={[
                { key: "description", label: "Description", size: "lg", render: (row) => row.line.description },
                { key: "invoiced", label: "Invoiced", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.line.quantity)}</span> },
                { key: "creditable", label: "Left to credit", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.creditable)}</span> },
                { key: "price", label: "Unit price", size: "sm", align: "right", render: (row) => <Money amount={row.line.unit_price} currency={invoice?.currency} /> },
                { key: "quantity", label: "Credit", size: "sm", align: "right", interactive: true, render: (row) => (
                  <Input aria-label={`Quantity to credit for ${row.line.description}`} type="number" min={0} max={row.creditable} step="0.0001" inputMode="decimal"
                    value={quantities[row.line.id!] ?? "0"} onChange={(event) => setQuantities((current) => ({ ...current, [row.line.id!]: event.target.value }))} />
                ) },
              ]}
            />
          ) : (
            <RecordTable
              variant="readOnly"
              label="Credited lines"
              rows={note?.lines ?? []}
              rowKey={(row) => row.id}
              emptyState={{ title: "No lines" }}
              columns={[
                { key: "description", label: "Description", size: "lg", render: (row) => row.description },
                { key: "quantity", label: "Quantity", size: "sm", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.quantity)}</span> },
                { key: "price", label: "Unit price", size: "sm", align: "right", render: (row) => <Money amount={row.unit_price} currency={note?.currency} /> },
                { key: "discount", label: "Discount", size: "sm", align: "right", render: (row) => <Money amount={row.discount_amount} currency={note?.currency} /> },
                { key: "tax", label: "Tax", size: "sm", align: "right", render: (row) => <Money amount={row.tax_amount} currency={note?.currency} /> },
                { key: "total", label: "Total", size: "sm", align: "right", render: (row) => <Money amount={row.line_total} currency={note?.currency} /> },
              ]}
            />
          )}
        </section>
      ) : null}

      {note?.refunds?.length ? (
        <section className="flex flex-col gap-3">
          <SectionHeading>Refunds</SectionHeading>
          <RecordTable<PaymentRecord>
            variant="readOnly"
            label="Refunds against this credit note"
            rows={note.refunds}
            rowKey={(row) => row.id}
            rowHref={(row) => `${DASHBOARD_ROUTES.payments}/${row.id}`}
            emptyState={{ title: "No refunds" }}
            columns={[
              { key: "number", label: "Number", size: "sm", render: (row) => <span className="font-semibold text-copy-primary">{row.number}</span> },
              { key: "paid_on", label: "Paid on", size: "sm", render: (row) => formatDateOnly(row.paid_on) },
              { key: "method", label: "Method", size: "sm", render: (row) => <PicklistText listKey="payment_method" value={row.method} /> },
              { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPaymentRecordStatus(row.status)} /> },
              { key: "amount", label: "Amount", size: "sm", align: "right", render: (row) => <Money amount={row.amount} currency={row.currency} /> },
            ]}
          />
        </section>
      ) : null}

      {note ? <DocumentHistory moduleKey="finance_credit_notes" entityId={note.id} canEdit={Boolean(actions?.can_edit)} /> : null}

      {editable && invoice && !noInvoice ? (
        <FormFooter status={error ? <span role="alert" className="text-state-danger">{error}</span> : "A draft changes nothing until it is issued."}>
          <Button type="button" variant="outline" asChild><Link href={note ? DASHBOARD_ROUTES.creditNotes : `${DASHBOARD_ROUTES.invoices}/${invoice.id}`}>Back</Link></Button>
          <Button type="button" variant="outline" onClick={() => void save(false)} disabled={mutations.isSaving}>Save draft</Button>
          {actions?.can_edit ? <Button type="button" onClick={() => void save(true)} disabled={mutations.isSaving}>{mutations.isSaving ? "Saving…" : "Save and issue"}</Button> : null}
        </FormFooter>
      ) : error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}

      <EditorPanel
        open={panel !== null}
        onOpenChange={(open) => { if (!open) setPanel(null); }}
        title={panel === "refund" ? "Record refund" : `Void ${note?.number ?? "credit note"}`}
        description={panel === "refund"
          ? `Money paid back to ${note?.customer_name ?? "the customer"}: ${note ? `${Number(note.refund_due).toFixed(2)} ${note.currency}` : ""}.`
          : "The credit note stays on record as void, and the invoice's balance comes back."}
        closeLabel="Close panel"
        onSubmit={() => void submitPanel()}
        status={error ? <span role="alert">{error}</span> : null}
        footer={<><Button variant="outline" onClick={() => setPanel(null)}>Back</Button><Button type="submit" variant={panel === "void" ? "destructive" : "default"} disabled={mutations.isSaving}>{panel === "refund" ? "Record refund" : "Void credit note"}</Button></>}
      >
        {panel === "refund" ? (
          <>
            <PicklistField id="refund-method" listKey="payment_method" label="Method" value={refundMethod} onChange={setRefundMethod} />
            <Field><FieldLabel htmlFor="refund-date">Paid on</FieldLabel><Input id="refund-date" type="date" max={todayIsoDate()} value={refundDate} onChange={(event) => setRefundDate(event.target.value)} /></Field>
          </>
        ) : (
          <Field><FieldLabel htmlFor="credit-void-reason">Reason</FieldLabel><Textarea id="credit-void-reason" maxLength={500} value={panelReason} onChange={(event) => setPanelReason(event.target.value)} /></Field>
        )}
      </EditorPanel>
    </PageShell>
  );
}
