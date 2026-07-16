"use client";

import { useState } from "react";

import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { PosInvoice, RecordPaymentPayload } from "@/hooks/finance/usePosInvoices";

type Props = {
  open: boolean;
  invoice: PosInvoice | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (payload: RecordPaymentPayload) => Promise<void>;
};

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export default function RecordPaymentDialog({ open, invoice, isSubmitting, onClose, onSubmit }: Props) {
  const [amount, setAmount] = useState(() => invoice ? invoice.balance_due.toFixed(2) : "");
  const [paymentMethod, setPaymentMethod] = useState(() => invoice?.payment_method ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!invoice) return;
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter a payment amount greater than zero.");
      return;
    }
    if (parsedAmount > invoice.balance_due) {
      setError("Payment amount cannot exceed the outstanding balance.");
      return;
    }
    try {
      setError(null);
      await onSubmit({ amount: parsedAmount, payment_method: paymentMethod.trim() || null });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We could not record this payment.");
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="md" className="rounded-[var(--radius-dialog)] border-line-default bg-surface-raised">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogIconClose />
          </DialogHeader>
          {invoice ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-4">
                <div className="text-sm font-semibold text-copy-primary">{invoice.invoice_number}</div>
                <div className="mt-1 text-sm text-copy-secondary">{invoice.customer_name}</div>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-copy-muted">Already paid</dt><dd className="mt-1 font-medium text-copy-primary">{money(invoice.amount_paid, invoice.currency)}</dd></div>
                  <div><dt className="text-copy-muted">Balance</dt><dd className="mt-1 font-medium text-copy-primary">{money(invoice.balance_due, invoice.currency)}</dd></div>
                </dl>
              </div>
              {error ? <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">{error}</div> : null}
              <FieldGroup>
                <Field data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor="payment-amount">Payment amount</FieldLabel>
                  <Input id="payment-amount" type="number" min="0.01" max={invoice.balance_due} step="0.01" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); setError(null); }} aria-invalid={Boolean(error)} autoFocus />
                  <FieldDescription>Maximum available balance: {money(invoice.balance_due, invoice.currency)}.</FieldDescription>
                  {error ? <FieldError>{error}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="payment-method">Payment method</FieldLabel>
                  <Input id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} placeholder="Bank transfer, card, cash…" maxLength={100} />
                </Field>
              </FieldGroup>
            </div>
          ) : null}
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
            <Button type="button" onClick={() => void submit()} disabled={!invoice || isSubmitting || !amount}>{isSubmitting ? "Recording…" : "Record payment"}</Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
