"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, Search } from "lucide-react";
import { toast } from "sonner";

import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormFieldContext, RecordFormValue } from "@/components/forms/RecordForm";
import { QuickCreateField, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RouteLoadingState } from "@/components/ui/RouteStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { usePaymentInvoices, type PosInvoice } from "@/hooks/finance/usePosInvoices";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { formatDateOnly, todayIsoDate } from "@/lib/datetime";
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { formatMoney } from "@/lib/currency";
import { useResolvedRecordLayout, type ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";

/** The payment the `full_form` layout draws (13b Phase 4e), keyed by field key. */
type PaymentForm = RecordFormValue & { amount: string; paid_on: string; method: string; reference: string; notes: string };

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const PAYMENT_INPUT_IDS: Record<string, string> = {
  amount: "record-payment-amount",
  method: "record-payment-method",
  paid_on: "record-payment-date",
  reference: "record-payment-reference",
};
const paymentInputId = (fieldKey: string) => PAYMENT_INPUT_IDS[fieldKey] ?? `record-payment-${fieldKey.replace(/_/g, "-")}`;

// The unknown-code fallback lives in lib/currency.ts now (design.md 7.1); this keeps only
// the empty spelling this surface wants (3.6).
function money(amount: number, currency: string) {
  return formatMoney(amount, currency) ?? EMPTY_CELL_VALUE;
}

/** Payments are recorded against issued invoices with something still due (12c §3.3). */
function isEligible(invoice: PosInvoice) {
  return invoice.status === "issued" && invoice.balance_due > 0;
}

export default function RecordPaymentPage() {
  const router = useRouter();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const canRecordPayment = Boolean(modules.find((module) => module.name === "finance_payments")?.actions?.can_create);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [form, setForm] = useState<PaymentForm>(() => ({ amount: "", paid_on: todayIsoDate(), method: "", reference: "", notes: "" }));
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const layoutQuery = useResolvedRecordLayout("finance_payments", "full_form");
  const [saveComplete, setSaveComplete] = useState(false);
  const filters = useMemo<SavedViewFilters>(() => ({
    search: deferredSearch,
    status: "issued",
    payment_status: "all",
    logic: "all",
    conditions: [],
    all_conditions: [],
    any_conditions: [],
  }), [deferredSearch]);
  const payments = usePaymentInvoices(filters, { key: "due_date", direction: "asc" });
  const eligibleInvoices = payments.invoices.filter(isEligible);
  const isDirty = Boolean(invoice || form.amount.trim() || form.method.trim());
  useUnsavedChangesGuard(isDirty, saveComplete);

  function selectInvoice(next: PosInvoice) {
    setInvoice(next);
    setForm((current) => ({ ...current, amount: next.balance_due.toFixed(2), method: next.payment_method ?? "" }));
    setError(null);
    setFieldErrors({});
  }

  async function submitPayment() {
    if (!invoice) {
      setError("Select an outstanding invoice.");
      return;
    }
    const parsedAmount = Number(form.amount);
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, form, customValues) : {};
    if (!nextErrors.amount && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) nextErrors.amount = "Enter a payment amount greater than zero.";
    else if (!nextErrors.amount && parsedAmount > invoice.balance_due) nextErrors.amount = "Payment amount cannot exceed the outstanding balance.";
    setFieldErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      document.getElementById(firstInvalid.startsWith("custom:") ? `custom-field-finance_payments-${firstInvalid.slice(7)}` : paymentInputId(firstInvalid))?.focus();
      return;
    }
    try {
      await payments.recordPayment(invoice.id, {
        amount: parsedAmount,
        payment_method: form.method || null,
        paid_on: form.paid_on || null,
        reference: form.reference.trim() || null,
        notes: form.notes.trim() || null,
        custom_fields: customValues,
      });
      setSaveComplete(true);
      toast.success("Payment recorded.");
      router.push(`/dashboard/finance/payments?recordedInvoiceId=${invoice.id}`);
    } catch {
      setError("We could not record this payment. Check the invoice balance and try again.");
    }
  }

  if (modulesLoading || (payments.isLoading && !payments.invoices.length)) return <RouteLoadingState label="payment workflow" />;
  if (!canRecordPayment) return <PermissionDeniedState />;

  return (
    <PageShell
      title="Record payment"
      description="Select an outstanding invoice and apply a customer payment."
      actions={<Button asChild variant="outline"><Link href="/dashboard/finance/payments"><ArrowLeft />Back to payments</Link></Button>}
    >
      <RecordFormLayout
        title="Record payment"
        sidebar={
          <Card className="p-6">
            <SectionHeading>Selected invoice</SectionHeading>
            {invoice ? (
              <dl className="mt-4 grid gap-3 text-sm">
                <div><dt className="text-copy-muted">Invoice</dt><dd className="mt-1 font-medium text-copy-primary">{invoice.invoice_number ?? "Draft invoice"}</dd></div>
                <div><dt className="text-copy-muted">Customer</dt><dd className="mt-1 text-copy-secondary">{invoice.customer_name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-copy-muted">Already paid</dt><dd className="text-copy-primary">{money(invoice.amount_paid, invoice.currency)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-line-subtle pt-3"><dt className="text-copy-muted">Outstanding</dt><dd className="font-semibold text-state-warning">{money(invoice.balance_due, invoice.currency)}</dd></div>
              </dl>
            ) : (
              <p className="mt-2 text-p-sm text-copy-secondary">Choose an invoice from the outstanding receivables list.</p>
            )}
          </Card>
        }
        status={invoice ? `Recording against ${invoice.invoice_number}` : "Select an invoice to continue"}
        actions={(
          <>
            <Button asChild variant="outline"><Link href="/dashboard/finance/payments">Cancel</Link></Button>
            <Button type="button" onClick={() => void submitPayment()} disabled={!invoice || payments.isRecordingPayment}>
              <CreditCard />
              {payments.isRecordingPayment ? "Recording…" : "Record payment"}
            </Button>
          </>
        )}
      >
        <FormSection title="Outstanding invoice" description="Search by invoice number, customer, method, or payment status.">
          <Field>
            <FieldLabel htmlFor="payment-invoice-search">Search invoices</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-copy-muted" />
              <Input id="payment-invoice-search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Invoice number or customer" />
            </div>
          </Field>
          {payments.error ? (
            <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
              <span>We could not load outstanding invoices.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void payments.refresh()}>Try again</Button>
            </div>
          ) : eligibleInvoices.length ? (
            <div className="mt-4 grid gap-2">
              {eligibleInvoices.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectInvoice(item)}
                  aria-pressed={invoice?.id === item.id}
                  className="grid gap-2 rounded-[var(--radius-control)] border border-line-subtle p-4 text-left transition-colors hover:border-line-strong hover:bg-surface-muted aria-pressed:border-primary aria-pressed:bg-action-primary-muted sm:grid-cols-[1fr_auto]"
                >
                  <span>
                    <span className="block font-medium text-copy-primary">{item.invoice_number} · {item.customer_name}</span>
                    <span className="mt-1 block text-xs text-copy-muted">{item.due_date ? `Due ${formatDateOnly(item.due_date)}` : "No due date"} · {item.payment_status.replace(/_/g, " ")}</span>
                  </span>
                  <span className="font-semibold text-state-warning">{money(item.balance_due, item.currency)}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={CreditCard}
              title={deferredSearch ? "No outstanding invoices match this search" : "No outstanding invoices"}
              description={deferredSearch ? "Change the search and try again." : "Invoices with an available balance will appear here."}
            />
          )}
        </FormSection>

        {error ? <p role="alert" className="text-sm text-state-danger">{error}</p> : null}
        <LayoutRecordFormBody<PaymentForm>
          moduleKey="finance_payments"
          value={form}
          onChange={setForm}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={paymentInputId}
          errors={fieldErrors}
          // Nothing to fill in until there is an invoice to pay.
          lockedFieldKeys={invoice ? [] : ["amount", "paid_on", "method", "reference", "notes"]}
          renderField={(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) => {
            if (field.field_key === "amount") {
              return (
                <QuickCreateField field={field} aria={context.aria} error={context.error}>
                  <Input
                    id={context.inputId}
                    type="number"
                    min="0.01"
                    max={invoice?.balance_due}
                    step="0.01"
                    inputMode="decimal"
                    value={form.amount}
                    onChange={(event) => context.set({ amount: event.target.value })}
                    disabled={context.disabled}
                    aria-invalid={context.aria.invalid || undefined}
                    aria-describedby={context.aria.describedBy}
                  />
                  {invoice ? <FieldDescription>Maximum outstanding balance: {money(invoice.balance_due, invoice.currency)}.</FieldDescription> : null}
                </QuickCreateField>
              );
            }
            if (field.field_key === "paid_on") {
              return (
                <QuickCreateField field={field} aria={context.aria} error={context.error}>
                  <Input id={context.inputId} type="date" value={form.paid_on} max={todayIsoDate()} onChange={(event) => context.set({ paid_on: event.target.value })}
                    disabled={context.disabled} aria-invalid={context.aria.invalid || undefined} aria-describedby={context.aria.describedBy} />
                </QuickCreateField>
              );
            }
            return undefined;
          }}
        />
      </RecordFormLayout>
    </PageShell>
  );
}
