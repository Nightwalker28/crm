"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PosInvoice, PosInvoiceLine, PosInvoicePayload, PosInvoiceStatus, PosPaymentStatus, PosTemplateId } from "@/hooks/finance/usePosInvoices";

type Props = {
  open: boolean;
  invoice: PosInvoice | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: PosInvoicePayload) => Promise<void>;
};

type FormState = {
  customer_name: string;
  customer_email: string;
  customer_address: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  status: PosInvoiceStatus;
  payment_status: PosPaymentStatus;
  payment_method: string;
  template_id: PosTemplateId;
  accent_color: string;
  currency: string;
  discount_amount: string;
  tax_rate: string;
  amount_paid: string;
  payment_terms: string;
  notes: string;
};

type LineForm = {
  id: number;
  persistedId?: number;
  description: string;
  quantity: string;
  unit_price: string;
};

const today = new Date().toISOString().slice(0, 10);
const emptyForm: FormState = {
  customer_name: "Walk-in Customer",
  customer_email: "",
  customer_address: "",
  invoice_number: "",
  issue_date: today,
  due_date: "",
  status: "issued",
  payment_status: "unpaid",
  payment_method: "cash",
  template_id: "modern",
  accent_color: "#14b8a6",
  currency: "USD",
  discount_amount: "0",
  tax_rate: "0",
  amount_paid: "0",
  payment_terms: "Paid at counter unless marked unpaid.",
  notes: "",
};

const defaultLines: LineForm[] = [
  { id: 1, description: "Walk-in sale item", quantity: "1", unit_price: "0" },
];

function lineTotal(line: LineForm) {
  const quantity = Number(line.quantity) || 0;
  const unitPrice = Number(line.unit_price) || 0;
  return Math.max(0, quantity) * Math.max(0, unitPrice);
}

function toMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function toForm(invoice: PosInvoice | null): FormState {
  if (!invoice) return emptyForm;
  return {
    customer_name: invoice.customer_name,
    customer_email: invoice.customer_email ?? "",
    customer_address: invoice.customer_address ?? "",
    invoice_number: invoice.invoice_number,
    issue_date: invoice.issue_date ?? today,
    due_date: invoice.due_date ?? "",
    status: invoice.status,
    payment_status: invoice.payment_status,
    payment_method: invoice.payment_method ?? "",
    template_id: invoice.template_id,
    accent_color: invoice.accent_color,
    currency: invoice.currency,
    discount_amount: String(invoice.discount_amount ?? 0),
    tax_rate: String(invoice.tax_rate ?? 0),
    amount_paid: String(invoice.amount_paid ?? 0),
    payment_terms: invoice.payment_terms ?? "",
    notes: invoice.notes ?? "",
  };
}

function toLines(invoice: PosInvoice | null): LineForm[] {
  if (!invoice?.lines?.length) return defaultLines;
  return invoice.lines.map((line, index) => ({
    id: index + 1,
    persistedId: line.id,
    description: line.description,
    quantity: String(line.quantity),
    unit_price: String(line.unit_price),
  }));
}

export function PosInvoiceDialog({ open, invoice, isSubmitting = false, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [lines, setLines] = useState<LineForm[]>(defaultLines);
  const [nextLineId, setNextLineId] = useState(2);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const nextLines = toLines(invoice);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(toForm(invoice));
    setLines(nextLines);
    setNextLineId(Math.max(...nextLines.map((line) => line.id), 1) + 1);
    setError(null);
  }, [invoice, open]);

  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
    const discount = Math.max(0, Number(form.discount_amount) || 0);
    const taxable = Math.max(0, subtotal - discount);
    const tax = taxable * Math.max(0, Number(form.tax_rate) || 0) / 100;
    const total = taxable + tax;
    const paid = Math.max(0, Number(form.amount_paid) || 0);
    return { subtotal, discount, tax, total, balance: Math.max(0, total - paid) };
  }, [form.amount_paid, form.discount_amount, form.tax_rate, lines]);

  function updateLine(id: number, key: keyof LineForm, value: string) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, [key]: value } : line));
  }

  async function handleSubmit() {
    try {
      setError(null);
      await onSubmit({
        customer_name: form.customer_name.trim(),
        customer_email: form.customer_email.trim() || undefined,
        customer_address: form.customer_address.trim() || undefined,
        invoice_number: form.invoice_number.trim() || undefined,
        issue_date: form.issue_date || undefined,
        due_date: form.due_date || undefined,
        status: form.status,
        payment_status: form.payment_status,
        payment_method: form.payment_method.trim() || undefined,
        template_id: form.template_id,
        accent_color: form.accent_color,
        currency: form.currency.trim().toUpperCase() || "USD",
        discount_amount: Math.max(0, Number(form.discount_amount) || 0),
        tax_rate: Math.max(0, Number(form.tax_rate) || 0),
        amount_paid: Math.max(0, Number(form.amount_paid) || 0),
        payment_terms: form.payment_terms.trim() || undefined,
        notes: form.notes.trim() || undefined,
        lines: lines.map<PosInvoiceLine>((line) => ({
          id: line.persistedId,
          description: line.description.trim(),
          quantity: Math.max(0, Number(line.quantity) || 0),
          unit_price: Math.max(0, Number(line.unit_price) || 0),
        })),
      });
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save POS invoice");
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
        <DialogPanel size="3xl">
          <DialogHeader>
            <DialogTitle>{invoice ? "Edit POS Invoice" : "New POS Invoice"}</DialogTitle>
            <DialogIconClose />
          </DialogHeader>

          <div className="mt-4 max-h-[72vh] space-y-5 overflow-y-auto pr-1">
            {error ? <div className="rounded-md border border-red-800/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">{error}</div> : null}

            <FieldGroup className="grid gap-4 md:grid-cols-3">
              <Field className="md:col-span-2">
                <FieldLabel>Customer</FieldLabel>
                <Input value={form.customer_name} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Invoice Number</FieldLabel>
                <Input value={form.invoice_number} onChange={(event) => setForm((current) => ({ ...current, invoice_number: event.target.value }))} placeholder="Auto generated" disabled={Boolean(invoice)} />
              </Field>
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input type="email" value={form.customer_email} onChange={(event) => setForm((current) => ({ ...current, customer_email: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Issue Date</FieldLabel>
                <Input type="date" value={form.issue_date} onChange={(event) => setForm((current) => ({ ...current, issue_date: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Due Date</FieldLabel>
                <Input type="date" value={form.due_date} onChange={(event) => setForm((current) => ({ ...current, due_date: event.target.value }))} />
              </Field>
              <Field className="md:col-span-3">
                <FieldLabel>Customer Address</FieldLabel>
                <Textarea value={form.customer_address} onChange={(event) => setForm((current) => ({ ...current, customer_address: event.target.value }))} />
              </Field>
            </FieldGroup>

            <FieldGroup className="grid gap-4 md:grid-cols-4">
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value as PosInvoiceStatus }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="issued">Issued</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="void">Void</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Payment</FieldLabel>
                <Select value={form.payment_status} onValueChange={(value) => setForm((current) => ({ ...current, payment_status: value as PosPaymentStatus }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Method</FieldLabel>
                <Input value={form.payment_method} onChange={(event) => setForm((current) => ({ ...current, payment_method: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Template</FieldLabel>
                <Select value={form.template_id} onValueChange={(value) => setForm((current) => ({ ...current, template_id: value as PosTemplateId }))}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="classic">Classic</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Currency</FieldLabel>
                <Input value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value.toUpperCase() }))} />
              </Field>
              <Field>
                <FieldLabel>Discount</FieldLabel>
                <Input type="number" min="0" step="0.01" value={form.discount_amount} onChange={(event) => setForm((current) => ({ ...current, discount_amount: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Tax %</FieldLabel>
                <Input type="number" min="0" step="0.01" value={form.tax_rate} onChange={(event) => setForm((current) => ({ ...current, tax_rate: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Amount Paid</FieldLabel>
                <Input type="number" min="0" step="0.01" value={form.amount_paid} onChange={(event) => setForm((current) => ({ ...current, amount_paid: event.target.value }))} />
              </Field>
            </FieldGroup>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-neutral-100">Line Items</h3>
                <Button size="sm" variant="outline" onClick={() => {
                  setLines((current) => [...current, { id: nextLineId, description: "", quantity: "1", unit_price: "0" }]);
                  setNextLineId((current) => current + 1);
                }}>
                  <Plus /> Add Item
                </Button>
              </div>
              {lines.map((line) => (
                <div key={line.id} className="grid gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 p-3 md:grid-cols-[1fr_90px_120px_120px_36px]">
                  <Input value={line.description} onChange={(event) => updateLine(line.id, "description", event.target.value)} placeholder="Description" />
                  <Input type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => updateLine(line.id, "quantity", event.target.value)} />
                  <Input type="number" min="0" step="0.01" value={line.unit_price} onChange={(event) => updateLine(line.id, "unit_price", event.target.value)} />
                  <div className="flex items-center justify-end rounded-md border border-neutral-800 px-3 text-sm font-medium text-neutral-300">{toMoney(lineTotal(line), form.currency)}</div>
                  <Button variant="ghost" size="icon" onClick={() => setLines((current) => current.length > 1 ? current.filter((item) => item.id !== line.id) : current)} aria-label="Remove line item">
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>

            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel>Payment Terms</FieldLabel>
                <Textarea value={form.payment_terms} onChange={(event) => setForm((current) => ({ ...current, payment_terms: event.target.value }))} />
              </Field>
              <Field>
                <FieldLabel>Notes</FieldLabel>
                <Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
              </Field>
            </FieldGroup>
          </div>

          <DialogFooter className="sticky bottom-0 mt-5 border-t border-neutral-800 bg-neutral-900/95 px-0 py-4 backdrop-blur">
            <div className="mr-auto grid grid-cols-2 gap-x-5 gap-y-1 text-sm text-neutral-400">
              <span>Subtotal</span><span className="text-right text-neutral-200">{toMoney(totals.subtotal, form.currency)}</span>
              <span>Tax</span><span className="text-right text-neutral-200">{toMoney(totals.tax, form.currency)}</span>
              <span>Total</span><span className="text-right text-neutral-200">{toMoney(totals.total, form.currency)}</span>
              <span className="font-semibold text-neutral-200">Balance</span><span className="text-right font-semibold text-neutral-100">{toMoney(totals.balance, form.currency)}</span>
            </div>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save POS Invoice"}</Button>
          </DialogFooter>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
