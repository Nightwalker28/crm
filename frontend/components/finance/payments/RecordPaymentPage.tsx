"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CreditCard, Search } from "lucide-react";
import { toast } from "sonner";

import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { RouteLoadingState } from "@/components/ui/RouteStates";
import { usePaymentInvoices, type PosInvoice } from "@/hooks/finance/usePosInvoices";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { formatDateOnly } from "@/lib/datetime";

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function isEligible(invoice: PosInvoice) {
  return invoice.balance_due > 0 && invoice.status !== "void" && invoice.payment_status !== "refunded";
}

export default function RecordPaymentPage() {
  const router = useRouter();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const canRecordPayment = Boolean(modules.find((module) => module.name === "finance_pos")?.actions?.can_edit);
  const amountRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [invoice, setInvoice] = useState<PosInvoice | null>(null);
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveComplete, setSaveComplete] = useState(false);
  const filters = useMemo<SavedViewFilters>(() => ({
    search: deferredSearch,
    status: "all",
    payment_status: "all",
    logic: "all",
    conditions: [],
    all_conditions: [],
    any_conditions: [],
  }), [deferredSearch]);
  const payments = usePaymentInvoices(filters, { key: "due_date", direction: "asc" });
  const eligibleInvoices = payments.invoices.filter(isEligible);
  const isDirty = Boolean(invoice || amount.trim() || paymentMethod.trim());
  useUnsavedChangesGuard(isDirty, saveComplete);

  function selectInvoice(next: PosInvoice) {
    setInvoice(next);
    setAmount(next.balance_due.toFixed(2));
    setPaymentMethod(next.payment_method ?? "");
    setError(null);
  }

  async function submitPayment() {
    if (!invoice) {
      setError("Select an outstanding invoice.");
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a payment amount greater than zero.");
      amountRef.current?.focus();
      return;
    }
    if (parsedAmount > invoice.balance_due) {
      setError("Payment amount cannot exceed the outstanding balance.");
      amountRef.current?.focus();
      return;
    }
    try {
      await payments.recordPayment(invoice.id, {
        amount: parsedAmount,
        payment_method: paymentMethod.trim() || null,
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
    <div className="grid gap-6">
      <PageHeader
        title="Record payment"
        description="Select an outstanding invoice and apply a customer payment."
        actions={<Button asChild variant="outline"><Link href="/dashboard/finance/payments"><ArrowLeft />Back to payments</Link></Button>}
      />

      <RecordFormLayout
        sidebar={
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-copy-primary">Selected invoice</h2>
            {invoice ? (
              <dl className="mt-4 grid gap-3 text-sm">
                <div><dt className="text-copy-muted">Invoice</dt><dd className="mt-1 font-medium text-copy-primary">{invoice.invoice_number}</dd></div>
                <div><dt className="text-copy-muted">Customer</dt><dd className="mt-1 text-copy-secondary">{invoice.customer_name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-copy-muted">Already paid</dt><dd className="text-copy-primary">{money(invoice.amount_paid, invoice.currency)}</dd></div>
                <div className="flex justify-between gap-3 border-t border-line-subtle pt-3"><dt className="text-copy-muted">Outstanding</dt><dd className="font-semibold text-state-warning">{money(invoice.balance_due, invoice.currency)}</dd></div>
              </dl>
            ) : (
              <p className="mt-2 text-sm leading-6 text-copy-secondary">Choose an invoice from the outstanding receivables list.</p>
            )}
          </Card>
        }
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-copy-muted">{invoice ? `Recording against ${invoice.invoice_number}` : "Select an invoice to continue"}</span>
            <div className="flex gap-2">
              <Button asChild variant="outline"><Link href="/dashboard/finance/payments">Cancel</Link></Button>
              <Button type="button" onClick={() => void submitPayment()} disabled={!invoice || payments.isRecordingPayment}>
                <CreditCard />
                {payments.isRecordingPayment ? "Recording..." : "Record payment"}
              </Button>
            </div>
          </div>
        }
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
                  className="grid gap-2 rounded-[var(--radius-card)] border border-line-default bg-surface p-4 text-left transition-colors hover:border-line-strong aria-pressed:border-primary aria-pressed:bg-action-primary-muted sm:grid-cols-[1fr_auto]"
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

        <FormSection title="Payment details" description="The backend rechecks the current outstanding balance before applying the payment.">
          <FieldGroup>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor="record-payment-amount">Payment amount <RequiredMark /></FieldLabel>
              <Input
                ref={amountRef}
                id="record-payment-amount"
                type="number"
                min="0.01"
                max={invoice?.balance_due}
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setError(null);
                }}
                disabled={!invoice}
                aria-invalid={Boolean(error)}
              />
              {invoice ? <FieldDescription>Maximum outstanding balance: {money(invoice.balance_due, invoice.currency)}.</FieldDescription> : null}
              <FieldError>{error}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor="record-payment-method">Payment method</FieldLabel>
              <Input id="record-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} disabled={!invoice} maxLength={100} placeholder="Bank transfer, card, cash…" />
            </Field>
          </FieldGroup>
        </FormSection>
      </RecordFormLayout>
    </div>
  );
}
