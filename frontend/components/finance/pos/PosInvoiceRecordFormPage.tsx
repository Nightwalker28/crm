"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import {
  FormSection,
  RecordFormLayout,
} from "@/components/forms/RecordFormLayout";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import {
  areTransactionItemsValid,
  calculateTransactionTotals,
  createTransactionLineItem,
  transactionCatalogLink,
  TransactionLineItemsEditor,
  type TransactionLineItem,
} from "@/components/transactions/TransactionLineItemsEditor";
import { TransactionLineItemsTable } from "@/components/transactions/TransactionLineItemsTable";
import { TransactionTotals } from "@/components/transactions/TransactionTotals";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import {
  RouteErrorState,
  RouteLoadingState,
} from "@/components/ui/RouteStates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { invoiceDisplayNumber, type PosInvoice } from "@/hooks/finance/usePosInvoices";
import { apiFetch } from "@/lib/api";
import { formatDateTime, todayIsoDate } from "@/lib/datetime";

type InvoiceForm = {
  customer_name: string;
  customer_email: string;
  customer_address: string;
  customer_contact_id: number | null;
  contact_name: string;
  customer_organization_id: number | null;
  organization_name: string;
  issue_date: string;
  due_date: string;
  /** The POS fast path (12c §3.3): issue and record the payment in one step. */
  paid_now: string;
  payment_method: string;
  template_id: string;
  accent_color: string;
  currency: string;
  discount_amount: string;
  tax_rate: string;
  payment_terms: string;
  notes: string;
};
const EMPTY_FORM: InvoiceForm = {
  customer_name: "",
  customer_email: "",
  customer_address: "",
  customer_contact_id: null,
  contact_name: "",
  customer_organization_id: null,
  organization_name: "",
  issue_date: "",
  due_date: "",
  paid_now: "no",
  payment_method: "",
  template_id: "modern",
  accent_color: "#14b8a6", // design-exempt: tenant brand colour is data, this is the unset fallback (§2.5)
  currency: "USD",
  discount_amount: "0",
  tax_rate: "0",
  payment_terms: "",
  notes: "",
};
/** What an issued invoice still lets you change (12c §3.3); the server refuses the rest. */
const ISSUED_EDITABLE_KEYS = ["due_date", "notes", "payment_terms", "template_id", "accent_color"] as const;
const TEMPLATES = [
  { value: "modern", label: "Modern" },
  { value: "classic", label: "Classic" },
  { value: "compact", label: "Compact" },
];
function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type InvoiceSeed = { form: InvoiceForm; lines: TransactionLineItem[] };

async function fetchInvoiceForEdit(invoiceId: string) {
  const res = await apiFetch(`/finance/pos-invoices/${invoiceId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("We could not load this invoice.");
  return body as PosInvoice;
}

function invoiceSeed(invoice?: PosInvoice): InvoiceSeed {
  if (!invoice)
    return { form: { ...EMPTY_FORM, issue_date: todayIsoDate() }, lines: [createTransactionLineItem("invoice")] };
  return {
    form: {
      customer_name: invoice.customer_name,
      customer_email: invoice.customer_email ?? "",
      customer_address: invoice.customer_address ?? "",
      customer_contact_id: invoice.customer_contact_id ?? null,
      contact_name: invoice.customer_contact_name ?? "",
      customer_organization_id: invoice.customer_organization_id ?? null,
      organization_name: invoice.customer_organization_name ?? "",
      issue_date: invoice.issue_date ?? "",
      due_date: invoice.due_date ?? "",
      paid_now: "no",
      payment_method: invoice.payment_method ?? "",
      template_id: invoice.template_id,
      accent_color: invoice.accent_color,
      currency: invoice.currency,
      discount_amount: String(invoice.discount_amount),
      tax_rate: String(invoice.tax_rate),
      payment_terms: invoice.payment_terms ?? "",
      notes: invoice.notes ?? "",
    },
    lines: invoice.lines?.length
      ? invoice.lines.map((line) => ({
          ...createTransactionLineItem("invoice"),
          ...transactionCatalogLink(line),
          // The line's id keeps its order and delivery links on save (12c §3.4).
          id: line.id ?? null,
          name: line.description,
          description: "",
          quantity: String(line.quantity),
          unit_price: String(line.unit_price),
          discount_amount: String(line.discount_amount ?? 0),
          tax_amount: String(line.tax_amount ?? 0),
        }))
      : [createTransactionLineItem("invoice")],
  };
}

export default function PosInvoiceRecordFormPage({
  mode = "create",
  invoiceId,
}: {
  mode?: "create" | "edit";
  invoiceId?: string;
}) {
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const actions = modules.find((module) => module.name === "finance_pos")?.actions;
  const permitted = mode === "edit" ? Boolean(actions?.can_edit) : Boolean(actions?.can_create);
  const query = useQuery({
    queryKey: ["pos-invoice", invoiceId ? Number(invoiceId) : null],
    queryFn: () => fetchInvoiceForEdit(invoiceId as string),
    enabled: mode === "edit" && Boolean(invoiceId),
    staleTime: 30_000,
  });
  if (modulesLoading || (mode === "edit" && query.isLoading)) return <RouteLoadingState label="invoice form" />;
  if (!permitted) return <PermissionDeniedState />;
  if (mode === "edit" && query.data?.status === "void")
    return (
      <RouteErrorState
        title="A void invoice cannot be changed"
        description="Open the invoice to see why it was voided; a corrected copy is a new draft."
        reset={() => void query.refetch()}
        backHref={`/dashboard/finance/pos/${invoiceId}`}
        backLabel="Back to invoice"
      />
    );
  if (mode === "edit" && query.error)
    return (
      <RouteErrorState
        title="Invoice could not be loaded"
        reset={() => void query.refetch()}
        backHref="/dashboard/finance/pos"
        backLabel="Back to invoices"
      />
    );
  const seed = invoiceSeed(query.data);
  return (
    <PosInvoiceRecordFormEditor
      key={`${mode}:${invoiceId ?? "new"}:${query.data?.updated_at ?? ""}`}
      mode={mode}
      invoiceId={invoiceId}
      seed={seed}
      updatedAt={query.data?.updated_at}
      invoice={query.data}
      canIssue={Boolean(actions?.can_edit)}
      canPayNow={Boolean(modules.find((module) => module.name === "finance_payments")?.actions?.can_create)}
    />
  );
}

function PosInvoiceRecordFormEditor({
  mode,
  invoiceId,
  seed,
  updatedAt,
  invoice,
  canIssue,
  canPayNow,
}: {
  mode: "create" | "edit";
  invoiceId?: string;
  seed: InvoiceSeed;
  updatedAt?: string | null;
  invoice?: PosInvoice;
  canIssue: boolean;
  canPayNow: boolean;
}) {
  // An issued invoice is final: only its due date, terms, notes and print settings change.
  const locked = invoice?.status === "issued";
  const displayNumber = invoice ? invoiceDisplayNumber(invoice) : "Create invoice";
  const router = useRouter();
  // R2 travels in both directions: the tab the operator left is on this page's own URL,
  // so Back, Cancel and the post-save redirect all return to it.
  const listHref = "/dashboard/finance/pos";
  const backHref = useRecordTabHref(mode === "edit" && invoiceId ? `${listHref}/${invoiceId}` : listHref);
  const queryClient = useQueryClient();
  const currencies = useCompanyCurrencies(true);
  const [form, setForm] = useState<InvoiceForm>(seed.form);
  const [lines, setLines] = useState<TransactionLineItem[]>(seed.lines);
  const [initialSnapshot] = useState(() =>
    JSON.stringify([seed.form, seed.lines]),
  );
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [linesError, setLinesError] = useState<string | null>(null);
  // One error per pricing field: an error names the fix (§7.5).
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [taxRateError, setTaxRateError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const baseTotals = useMemo(() => calculateTransactionTotals(lines), [lines]);
  // Lines first (quantity × price − discount + tax, as on orders), then the invoice-level
  // discount and tax rate — the same arithmetic the server applies.
  const totals = useMemo(() => {
    const net = baseTotals.subtotal - baseTotals.discount;
    const discount = Math.max(0, numberValue(form.discount_amount));
    const taxable = Math.max(0, net - discount);
    const tax = baseTotals.tax + (taxable * Math.max(0, numberValue(form.tax_rate))) / 100;
    return { subtotal: net, discount, tax, total: taxable + tax };
  }, [baseTotals.subtotal, baseTotals.discount, baseTotals.tax, form.discount_amount, form.tax_rate]);
  const snapshot = useMemo(() => JSON.stringify([form, lines]), [form, lines]);
  const dirty = snapshot !== initialSnapshot;
  useUnsavedChangesGuard(dirty, submitting);
  function validate() {
    const validCustomer = Boolean(form.customer_name.trim());
    const validEmail =
      !form.customer_email.trim() ||
      /^\S+@\S+\.\S+$/.test(form.customer_email.trim());
    const validLines = areTransactionItemsValid(lines);
    if (locked) return true;
    const validDiscount =
      numberValue(form.discount_amount) >= 0 &&
      numberValue(form.discount_amount) <= totals.subtotal;
    const validTaxRate =
      numberValue(form.tax_rate) >= 0 && numberValue(form.tax_rate) <= 100;
    setCustomerError(validCustomer ? null : "Customer name is required.");
    setEmailError(validEmail ? null : "Enter a valid email address.");
    setLinesError(
      validLines
        ? null
        : "Each line needs a description, positive quantity, and non-negative price.",
    );
    setDiscountError(
      validDiscount ? null : "Enter a discount between zero and the subtotal.",
    );
    setTaxRateError(validTaxRate ? null : "Enter a tax rate between 0 and 100.");
    if (!validCustomer) document.getElementById("invoice-customer")?.focus();
    else if (!validEmail) document.getElementById("invoice-email")?.focus();
    else if (!validLines)
      document
        .querySelector<HTMLInputElement>("[data-transaction-field='name']")
        ?.focus();
    else if (!validDiscount) document.getElementById("invoice-discount")?.focus();
    else if (!validTaxRate) document.getElementById("invoice-tax-rate")?.focus();
    return validCustomer && validEmail && validLines && validDiscount && validTaxRate;
  }
  function payload() {
    const full: Record<string, unknown> = {
      customer_name: form.customer_name.trim(),
      customer_email: form.customer_email.trim() || null,
      customer_address: form.customer_address.trim() || null,
      customer_contact_id: form.customer_contact_id,
      customer_organization_id: form.customer_organization_id,
      create_customer_if_missing: false,
      issue_date: form.issue_date || null,
      due_date: form.due_date || null,
      payment_method: form.payment_method.trim() || null,
      template_id: form.template_id,
      accent_color: form.accent_color,
      currency: form.currency,
      discount_amount: numberValue(form.discount_amount),
      tax_rate: numberValue(form.tax_rate),
      payment_terms: form.payment_terms.trim() || null,
      notes: form.notes.trim() || null,
      lines: lines.map((line) => ({
        ...(line.id ? { id: line.id } : {}),
        ...transactionCatalogLink(line),
        description: line.name.trim(),
        quantity: numberValue(line.quantity),
        unit_price: numberValue(line.unit_price),
        discount_amount: numberValue(line.discount_amount),
        tax_amount: numberValue(line.tax_amount),
      })),
    };
    if (!locked) return full;
    return Object.fromEntries(ISSUED_EDITABLE_KEYS.map((key) => [key, full[key]]));
  }
  /** `draft` saves; `issue` saves then issues (it gets its number then). */
  async function submit(intent: "draft" | "issue") {
    if (!validate()) return;
    try {
      setSubmitting(true);
      setSubmitError(null);
      const body = payload();
      if (mode === "create" && intent === "issue") {
        body.issue = true;
        if (form.paid_now === "yes") body.paid_now = { method: form.payment_method.trim() || null };
      }
      const res = await apiFetch(
        mode === "edit" ? `/finance/pos-invoices/${invoiceId}` : "/finance/pos-invoices",
        { method: mode === "edit" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const saved = (await res.json().catch(() => null)) as { id?: number; detail?: string; invoice_number?: string | null } | null;
      if (!res.ok) throw new Error(typeof saved?.detail === "string" ? saved.detail : "Check the form and your connection, then try again.");
      let number = saved?.invoice_number ?? null;
      if (mode === "edit" && intent === "issue" && saved?.id) {
        const issued = await apiFetch(`/finance/pos-invoices/${saved.id}/issue`, { method: "POST" });
        const issuedBody = (await issued.json().catch(() => null)) as { detail?: string; invoice_number?: string | null } | null;
        if (!issued.ok) throw new Error(typeof issuedBody?.detail === "string" ? `Saved as a draft, but it could not be issued: ${issuedBody.detail}` : "Saved as a draft, but it could not be issued.");
        number = issuedBody?.invoice_number ?? number;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pos-invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["pos-invoice"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-payments"] }),
      ]);
      toast.success(intent === "issue" ? (number ? `Invoice ${number} issued.` : "Invoice issued.") : mode === "edit" ? "Invoice saved." : "Draft invoice saved.");
      const targetId = saved?.id ?? (invoiceId ? Number(invoiceId) : null);
      router.push(mode === "edit" ? backHref : (targetId ? `${listHref}/${targetId}` : listHref));
    } catch (failure) {
      setSubmitError(failure instanceof Error ? failure.message : "Check the form and your connection, then try again.");
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <PageShell
      eyebrow={
        mode === "edit" && updatedAt
          ? `Last modified ${formatDateTime(updatedAt)}`
          : undefined
      }
      title={mode === "edit" ? `Edit ${displayNumber}` : "Create invoice"}
      description={
        locked
          ? "This invoice is issued, so only its due date, terms, notes and print settings can change. To change anything else, create a credit note, or void it and issue a corrected copy."
          : mode === "edit"
            ? "Update the draft's customer, lines and pricing. It gets its number when you issue it."
            : "Save a draft, or issue the invoice now. It gets its number when it is issued."
      }
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft />
            Back to {mode === "edit" ? "invoice" : "invoices"}
          </Link>
        </Button>
      }
    >
      {submitError ? (
        <FormErrorBanner title={`We could not ${mode === "edit" ? "update" : "create"} this invoice.`}>{submitError}</FormErrorBanner>
      ) : null}
      <RecordFormLayout
        title={displayNumber}
        sidebar={
          <InvoiceSidebar
            form={form}
            onChange={setForm}
            totals={totals}
            currencies={currencies.data ?? ["USD"]}
            discountError={discountError}
            taxRateError={taxRateError}
            locked={locked}
            showPaidNow={mode === "create" && canIssue && canPayNow}
            onClearPricingError={() => {
              setDiscountError(null);
              setTaxRateError(null);
            }}
          />
        }
        status={dirty
          ? "Unsaved changes"
          : locked
          ? null
          : "A draft is not sent to anyone and has no number until it is issued."}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link href={backHref}>Cancel</Link>
            </Button>
            {locked ? (
              <Button onClick={() => void submit("draft")} disabled={submitting}>
                <Save />
                {submitting ? "Saving…" : "Save changes"}
              </Button>
            ) : (
              <>
                <Button variant={canIssue ? "outline" : "default"} onClick={() => void submit("draft")} disabled={submitting}>
                  <Save />
                  {submitting ? "Saving…" : "Save draft"}
                </Button>
                {canIssue ? (
                  <Button onClick={() => void submit("issue")} disabled={submitting}>
                    {form.paid_now === "yes" && mode === "create" ? "Issue and mark paid" : "Issue invoice"}
                  </Button>
                ) : null}
              </>
            )}
          </>
        )}
      >
        <FormSection
          title="Customer and billing details"
          description={locked ? "Fixed once the invoice is issued." : "Link an existing CRM customer or enter walk-in billing information."}
        >
          <fieldset disabled={locked} className="contents">
          <FieldGroup columns={2}>
            <Field
              data-invalid={Boolean(customerError)}
              className="md:col-span-2"
            >
              <FieldLabel htmlFor="invoice-customer">
                Customer name <RequiredMark />
              </FieldLabel>
              <Input
                id="invoice-customer"
                value={form.customer_name}
                onChange={(event) => {
                  setForm({ ...form, customer_name: event.target.value });
                  setCustomerError(null);
                }}
                aria-invalid={Boolean(customerError)}
              />
              {customerError ? <FieldError>{customerError}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="invoice-account">Account</FieldLabel>
              <LinkedRecordPicker
                inputId="invoice-account"
                recordType="organization"
                valueId={form.customer_organization_id}
                displayValue={form.organization_name}
                onDisplayValueChange={(organization_name) =>
                  setForm({
                    ...form,
                    customer_organization_id: null,
                    organization_name,
                    customer_contact_id: null,
                    contact_name: "",
                  })
                }
                onSelect={(option) =>
                  setForm({
                    ...form,
                    customer_organization_id: option.id,
                    organization_name: option.label,
                    customer_name: form.customer_name.trim() || option.label,
                    customer_contact_id: null,
                    contact_name: "",
                  })
                }
                onClear={() =>
                  setForm({
                    ...form,
                    customer_organization_id: null,
                    organization_name: "",
                    customer_contact_id: null,
                    contact_name: "",
                  })
                }
                placeholder="Search accounts"
                queryKeyPrefix="invoice-page-account"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invoice-contact">Contact</FieldLabel>
              <LinkedRecordPicker
                inputId="invoice-contact"
                recordType="contact"
                valueId={form.customer_contact_id}
                displayValue={form.contact_name}
                onDisplayValueChange={(contact_name) =>
                  setForm({ ...form, customer_contact_id: null, contact_name })
                }
                onSelect={(option) => {
                  const raw = option.raw as
                    { primary_email?: string | null } | undefined;
                  setForm({
                    ...form,
                    customer_contact_id: option.id,
                    contact_name: option.label,
                    customer_organization_id:
                      option.organization_id ?? form.customer_organization_id,
                    organization_name:
                      option.organization_name ?? form.organization_name,
                    customer_name: form.customer_name.trim() || option.label,
                    customer_email:
                      form.customer_email.trim() || raw?.primary_email || "",
                  });
                }}
                onClear={() =>
                  setForm({
                    ...form,
                    customer_contact_id: null,
                    contact_name: "",
                  })
                }
                placeholder="Search contacts"
                queryKeyPrefix="invoice-page-contact"
                filters={{ organizationId: form.customer_organization_id }}
              />
            </Field>
            <Field data-invalid={Boolean(emailError)}>
              <FieldLabel htmlFor="invoice-email">Email</FieldLabel>
              <Input
                id="invoice-email"
                type="email"
                value={form.customer_email}
                onChange={(event) => {
                  setForm({ ...form, customer_email: event.target.value });
                  setEmailError(null);
                }}
                aria-invalid={Boolean(emailError)}
              />
              {emailError ? <FieldError>{emailError}</FieldError> : null}
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="invoice-address">Billing address</FieldLabel>
              <Textarea
                id="invoice-address"
                rows={4}
                value={form.customer_address}
                onChange={(event) =>
                  setForm({ ...form, customer_address: event.target.value })
                }
              />
            </Field>
          </FieldGroup>
          </fieldset>
        </FormSection>
        {locked && invoice ? (
          <TransactionLineItemsTable
            items={(invoice.lines ?? []).map((line, index) => ({
              id: line.id ?? index, name: line.description, quantity: line.quantity, unit_price: line.unit_price,
              discount_amount: line.discount_amount ?? 0, tax_amount: line.tax_amount ?? 0, line_total: line.line_total ?? 0,
              catalog_product_id: line.catalog_product_id, catalog_service_id: line.catalog_service_id,
            }))}
            currency={invoice.currency}
            itemLabel="Description"
          />
        ) : (
          <TransactionLineItemsEditor
            items={lines}
            onChange={(nextLines) => {
              setLines(nextLines);
              setLinesError(null);
            }}
            currency={form.currency}
            error={linesError}
            idPrefix="invoice"
            itemLabel="Description"
            showDescription={false}
          />
        )}
        <FormSection
          title="Terms and notes"
          description="Customer-facing payment terms and internal invoice notes."
        >
          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="invoice-terms">Payment terms</FieldLabel>
              <Textarea
                id="invoice-terms"
                rows={3}
                value={form.payment_terms}
                onChange={(event) =>
                  setForm({ ...form, payment_terms: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="invoice-notes">Notes</FieldLabel>
              <Textarea
                id="invoice-notes"
                rows={5}
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </Field>
          </div>
        </FormSection>
      </RecordFormLayout>
    </PageShell>
  );
}

function InvoiceSidebar({
  form,
  onChange,
  totals,
  currencies,
  discountError,
  taxRateError,
  locked,
  showPaidNow,
  onClearPricingError,
}: {
  form: InvoiceForm;
  onChange: (form: InvoiceForm) => void;
  totals: { subtotal: number; discount: number; tax: number; total: number };
  currencies: string[];
  discountError: string | null;
  taxRateError: string | null;
  locked: boolean;
  showPaidNow: boolean;
  onClearPricingError: () => void;
}) {
  return (
    <>
      <TransactionTotals
        description="Totals are recalculated by the server before the invoice is saved."
        currency={form.currency}
        rows={[
          { label: "Subtotal", amount: totals.subtotal },
          { label: "Invoice discount", amount: totals.discount, negative: true },
          { label: "Tax", amount: totals.tax },
          { label: "Total", amount: totals.total, resolved: true },
        ]}
      />
      <FormSection
        title="Pricing and tax"
        description={locked ? "Fixed once the invoice is issued." : "Invoice-level adjustments, applied after the lines' own discount and tax."}
      >
        <fieldset disabled={locked} className="space-y-4">
          <Field data-invalid={Boolean(discountError)}>
            <FieldLabel htmlFor="invoice-discount">Discount amount</FieldLabel>
            <Input
              id="invoice-discount"
              type="number"
              min="0"
              step="0.01"
              value={form.discount_amount}
              aria-invalid={Boolean(discountError)}
              onChange={(event) => {
                onClearPricingError();
                onChange({ ...form, discount_amount: event.target.value });
              }}
            />
            {discountError ? <FieldError>{discountError}</FieldError> : null}
          </Field>
          <Field data-invalid={Boolean(taxRateError)}>
            <FieldLabel htmlFor="invoice-tax-rate">Tax rate (%)</FieldLabel>
            <Input
              id="invoice-tax-rate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.tax_rate}
              aria-invalid={Boolean(taxRateError)}
              onChange={(event) => {
                onClearPricingError();
                onChange({ ...form, tax_rate: event.target.value });
              }}
            />
            {taxRateError ? <FieldError>{taxRateError}</FieldError> : null}
          </Field>
        </fieldset>
      </FormSection>
      {/* Money is recorded as payments on the issued invoice (12c §3.3). The one exception is
          the till: a walk-in sale is issued and paid in the same step. */}
      {showPaidNow ? (
        <FormSection title="Payment" description="For a sale paid at the counter: issue the invoice and record the payment together.">
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="invoice-paid-now">Paid now</FieldLabel>
              <Select value={form.paid_now} onValueChange={(paid_now) => onChange({ ...form, paid_now })}>
                <SelectTrigger id="invoice-paid-now"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">No, invoice the customer</SelectItem>
                  <SelectItem value="yes">Yes, paid in full</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {form.paid_now === "yes" ? (
              <Field>
                <FieldLabel htmlFor="invoice-payment-method">Payment method</FieldLabel>
                <Input id="invoice-payment-method" value={form.payment_method} placeholder="Cash, card…" maxLength={100}
                  onChange={(event) => onChange({ ...form, payment_method: event.target.value })} />
              </Field>
            ) : null}
          </div>
        </FormSection>
      ) : null}
      <FormSection
        title="Invoice details"
        description="Currency and dates. The number is given when the invoice is issued."
      >
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="invoice-currency">Currency</FieldLabel>
            <Select
              value={form.currency}
              onValueChange={(currency) => onChange({ ...form, currency })}
              disabled={locked}
            >
              <SelectTrigger id="invoice-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((currency) => (
                  <SelectItem key={currency} value={currency}>
                    {currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="invoice-issue">Issue date</FieldLabel>
            <Input
              id="invoice-issue"
              type="date"
              disabled={locked}
              value={form.issue_date}
              onChange={(event) =>
                onChange({ ...form, issue_date: event.target.value })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="invoice-due">Due date</FieldLabel>
            {!form.due_date && !locked ? <FieldDescription>Blank uses the account&apos;s payment terms when the invoice is issued.</FieldDescription> : null}
            <Input
              id="invoice-due"
              type="date"
              min={form.issue_date || undefined}
              value={form.due_date}
              onChange={(event) =>
                onChange({ ...form, due_date: event.target.value })
              }
            />
          </Field>

        </div>
      </FormSection>
      <FormSection
        title="Print"
        description="How this invoice looks when it is printed or sent."
      >
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="invoice-template">Print template</FieldLabel>
            <Select
              value={form.template_id}
              onValueChange={(template_id) =>
                onChange({ ...form, template_id })
              }
            >
              <SelectTrigger id="invoice-template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATES.map((template) => (
                  <SelectItem key={template.value} value={template.value}>
                    {template.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="invoice-accent">Accent color</FieldLabel>
            <Input
              id="invoice-accent"
              type="color"
              value={form.accent_color}
              onChange={(event) =>
                onChange({ ...form, accent_color: event.target.value })
              }
            />
            <FieldDescription>
              Used by the printable invoice template.
            </FieldDescription>
          </Field>
        </div>
      </FormSection>
    </>
  );
}
