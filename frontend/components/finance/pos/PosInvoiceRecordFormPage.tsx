"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormFieldContext, RecordFormValue } from "@/components/forms/RecordForm";
import { QuickCreateField, validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import {
  FormSection,
  RecordFormLayout,
} from "@/components/forms/RecordFormLayout";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import {
  areTransactionItemsValid,
  calculateTransactionTotals,
  createTransactionLineItem,
  parseTransactionDiscount,
  transactionCatalogLink,
  transactionLineFields,
  transactionTaxFields,
  TransactionLineItemsEditor,
  useTransactionTax,
  type TransactionLineItem,
} from "@/components/transactions/TransactionLineItemsEditor";
import { TransactionLineItemsTable } from "@/components/transactions/TransactionLineItemsTable";
import { TransactionTotals } from "@/components/transactions/TransactionTotals";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
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
import { useDefaultTaxMode, type TaxMode } from "@/hooks/finance/useTaxRates";
import { useBaseCurrency } from "@/hooks/useCompanyCurrencies";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useResolvedRecordLayout, type ResolvedRecordLayoutField } from "@/hooks/useResolvedRecordLayout";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { invoiceDisplayNumber, type PosInvoice } from "@/hooks/finance/usePosInvoices";
import { apiFetch } from "@/lib/api";
import { formatDateTime, todayIsoDate } from "@/lib/datetime";

/** The invoice form's value: flat, keyed by field key, as `RecordForm` draws it (13b Phase 4e). */
type InvoiceForm = RecordFormValue & {
  customer_name: string;
  customer_email: string;
  customer_address: string;
  customer_contact_id: number | null;
  customer_contact_name: string;
  customer_organization_id: number | null;
  customer_organization_name: string;
  issue_date: string;
  due_date: string;
  /** The POS fast path (12c §3.3): issue and record the payment in one step. */
  paid_now: string;
  payment_method: string;
  template_id: string;
  accent_color: string;
  currency: string;
  /** "" until chosen: the company's default applies (13d §3.1). */
  tax_mode: string;
  payment_terms: string;
  notes: string;
};
const EMPTY_FORM: InvoiceForm = {
  customer_name: "",
  customer_email: "",
  customer_address: "",
  customer_contact_id: null,
  customer_contact_name: "",
  customer_organization_id: null,
  customer_organization_name: "",
  issue_date: "",
  due_date: "",
  paid_now: "no",
  payment_method: "",
  template_id: "modern",
  accent_color: "#14b8a6", // design-exempt: tenant brand colour is data, this is the unset fallback (§2.5)
  currency: "",
  tax_mode: "",
  payment_terms: "",
  notes: "",
};
/** What an issued invoice still lets you change (12c §3.3); the server refuses the rest. */
const ISSUED_EDITABLE_KEYS = ["due_date", "notes", "payment_terms", "template_id", "accent_color", "custom_fields"] as const;
/** The layout's fields an issued invoice fixes: everything but the editable ones above. */
const ISSUED_LOCKED_FIELD_KEYS = [
  "customer_name",
  "customer_organization_id",
  "customer_contact_id",
  "customer_email",
  "customer_address",
  "issue_date",
  "currency",
  "payment_method",
] as const;
const TEMPLATES = [
  { value: "modern", label: "Modern" },
  { value: "classic", label: "Classic" },
  { value: "compact", label: "Compact" },
];

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const INVOICE_INPUT_IDS: Record<string, string> = {
  customer_name: "invoice-customer",
  customer_organization_id: "invoice-account",
  customer_contact_id: "invoice-contact",
  customer_email: "invoice-email",
  customer_address: "invoice-address",
  issue_date: "invoice-issue",
  due_date: "invoice-due",
  currency: "invoice-currency",
  payment_method: "invoice-payment-method",
  payment_terms: "invoice-terms",
  notes: "invoice-notes",
};

function invoiceInputId(fieldKey: string) {
  return INVOICE_INPUT_IDS[fieldKey] ?? `invoice-${fieldKey.replace(/_/g, "-")}`;
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type InvoiceSeed = { form: InvoiceForm; lines: TransactionLineItem[]; customValues: Record<string, unknown> };
async function fetchInvoiceForEdit(invoiceId: string) {
  const res = await apiFetch(`/finance/invoices/${invoiceId}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("We could not load this invoice.");
  return body as PosInvoice;
}

function invoiceSeed(invoice?: PosInvoice): InvoiceSeed {
  if (!invoice)
    return { form: { ...EMPTY_FORM, issue_date: todayIsoDate() }, lines: [createTransactionLineItem("invoice")], customValues: {} };
  return {
    form: {
      customer_name: invoice.customer_name,
      customer_email: invoice.customer_email ?? "",
      customer_address: invoice.customer_address ?? "",
      customer_contact_id: invoice.customer_contact_id ?? null,
      customer_contact_name: invoice.customer_contact_name ?? "",
      customer_organization_id: invoice.customer_organization_id ?? null,
      customer_organization_name: invoice.customer_organization_name ?? "",
      issue_date: invoice.issue_date ?? "",
      due_date: invoice.due_date ?? "",
      paid_now: "no",
      payment_method: invoice.payment_method ?? "",
      template_id: invoice.template_id,
      accent_color: invoice.accent_color,
      currency: invoice.currency,
      tax_mode: invoice.tax_mode ?? "",
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
          ...transactionTaxFields(line),
          ...transactionLineFields(line),
        }))
      : [createTransactionLineItem("invoice")],
    customValues: invoice.custom_fields ?? {},
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
        backHref={`/dashboard/finance/invoices/${invoiceId}`}
        backLabel="Back to invoice"
      />
    );
  if (mode === "edit" && query.error)
    return (
      <RouteErrorState
        title="Invoice could not be loaded"
        reset={() => void query.refetch()}
        backHref="/dashboard/finance/invoices"
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
  const listHref = "/dashboard/finance/invoices";
  const backHref = useRecordTabHref(mode === "edit" && invoiceId ? `${listHref}/${invoiceId}` : listHref);
  const queryClient = useQueryClient();
  const baseCurrency = useBaseCurrency();
  const [form, setForm] = useState<InvoiceForm>(seed.form);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(seed.customValues);
  const currency = form.currency || baseCurrency.data || "USD";
  const [lines, setLines] = useState<TransactionLineItem[]>(seed.lines);
  const [initialSnapshot] = useState(() =>
    JSON.stringify([seed.form, seed.lines, seed.customValues]),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [linesError, setLinesError] = useState<string | null>(null);
  // The `full_form` layout (13b Phase 4e); the body below reads the same cached query.
  const layoutQuery = useResolvedRecordLayout("finance_pos", "full_form");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The same line arithmetic the server applies (13d §3.1): one definition of totals (H16).
  const defaultTaxMode = useDefaultTaxMode();
  const taxMode: TaxMode = form.tax_mode === "inclusive" || form.tax_mode === "exclusive" ? form.tax_mode : (defaultTaxMode.data ?? "exclusive");
  const tax = useTransactionTax(taxMode);
  const totals = useMemo(() => calculateTransactionTotals(lines, tax), [lines, tax]);
  const snapshot = useMemo(() => JSON.stringify([form, lines, customValues]), [form, lines, customValues]);
  const dirty = snapshot !== initialSnapshot;
  useUnsavedChangesGuard(dirty, submitting);
  function validate() {
    if (locked) return true;
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, form, customValues) : {};
    if (!form.customer_name.trim() && !nextErrors.customer_name) nextErrors.customer_name = "Customer name is required.";
    if (form.customer_email.trim() && !/^\S+@\S+\.\S+$/.test(form.customer_email.trim()) && !nextErrors.customer_email) {
      nextErrors.customer_email = "Enter a valid email address.";
    }
    const validLines = areTransactionItemsValid(lines);
    setFieldErrors(nextErrors);
    setLinesError(
      validLines
        ? null
        : "Each line needs a description, positive quantity, and non-negative price.",
    );
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      document.getElementById(
        firstInvalid.startsWith("custom:")
          ? `custom-field-finance_pos-${firstInvalid.slice("custom:".length)}`
          : invoiceInputId(firstInvalid),
      )?.focus();
    } else if (!validLines)
      document
        .querySelector<HTMLInputElement>("[data-line-field='name']")
        ?.focus();
    return !firstInvalid && validLines;
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
      payment_method: form.payment_method || null,
      template_id: form.template_id,
      accent_color: form.accent_color,
      currency,
      tax_mode: taxMode,
      payment_terms: form.payment_terms.trim() || null,
      notes: form.notes.trim() || null,
      custom_fields: customValues,
      lines: lines.map((line) => ({
        ...(line.id ? { id: line.id } : {}),
        ...transactionCatalogLink(line),
        description: line.name.trim(),
        line_type: line.line_type,
        quantity: line.line_type === "item" ? numberValue(line.quantity) : 1,
        unit_price: line.line_type === "item" ? numberValue(line.unit_price) : 0,
        ...(() => {
          const discount = parseTransactionDiscount(line.discount_amount);
          return { discount_amount: numberValue(discount.amount), discount_percent: discount.percent === null ? null : numberValue(discount.percent) };
        })(),
        unit: line.unit.trim() || null,
        tax_rate_id: line.tax_rate_id,
        tax_manual: line.tax_manual,
        tax_amount: line.tax_manual ? numberValue(line.tax_amount) : 0,
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
        if (form.paid_now === "yes") body.paid_now = { method: form.payment_method || null };
      }
      const res = await apiFetch(
        mode === "edit" ? `/finance/invoices/${invoiceId}` : "/finance/invoices",
        { method: mode === "edit" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      const saved = (await res.json().catch(() => null)) as { id?: number; detail?: string; invoice_number?: string | null } | null;
      if (!res.ok) throw new Error(typeof saved?.detail === "string" ? saved.detail : "Check the form and your connection, then try again.");
      let number = saved?.invoice_number ?? null;
      if (mode === "edit" && intent === "issue" && saved?.id) {
        const issued = await apiFetch(`/finance/invoices/${saved.id}/issue`, { method: "POST" });
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
        <LayoutRecordFormBody<InvoiceForm>
          moduleKey="finance_pos"
          value={form}
          onChange={setForm}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={invoiceInputId}
          action={mode}
          errors={fieldErrors}
          lockedFieldKeys={locked ? ISSUED_LOCKED_FIELD_KEYS : []}
          renderField={invoiceCustomerRenderer(form)}
          slots={{
            mainInsert: {
              afterSection: "customer",
              node: locked && invoice ? (
                <TransactionLineItemsTable
                  items={(invoice.lines ?? []).map((line, index) => ({
                    id: line.id ?? index, name: line.description, quantity: line.quantity, unit_price: line.unit_price,
                    discount_amount: line.discount_amount ?? 0, tax_amount: line.tax_amount ?? 0, line_total: line.line_total ?? 0,
                    catalog_product_id: line.catalog_product_id, catalog_service_id: line.catalog_service_id, line_type: line.line_type, unit: line.unit,
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
                  currency={currency}
                  error={linesError}
                  idPrefix="invoice"
                  itemLabel="Description"
                  showDescription={false}
                  taxMode={taxMode}
                  onTaxModeChange={(next) => setForm({ ...form, tax_mode: next })}
                />
              ),
            },
            fixedSidebar: (
              <InvoiceSidebar
                form={form}
                onChange={setForm}
                currency={currency}
                totals={totals}
                showPaidNow={mode === "create" && canIssue && canPayNow}
              />
            ),
          }}
        />
      </RecordFormLayout>
    </PageShell>
  );
}

/**
 * An invoice's customer pickers (13b Phase 4e): the account narrows the contact and a new
 * one clears it; a contact fills its account and, while blank, the name and email.
 */
function invoiceCustomerRenderer(form: InvoiceForm) {
  return function renderField(field: ResolvedRecordLayoutField, context: RecordFormFieldContext) {
    const { inputId, aria, error, disabled, set } = context;
    const common = { inputId, disabled, ariaDescribedBy: aria.describedBy, ariaInvalid: aria.invalid };
    const noContact = { customer_contact_id: null, customer_contact_name: "" };
    if (field.field_key === "customer_organization_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            {...common}
            recordType="organization"
            valueId={form.customer_organization_id}
            displayValue={form.customer_organization_name}
            onDisplayValueChange={(customer_organization_name) => set({ customer_organization_id: null, customer_organization_name, ...noContact })}
            onSelect={(option) =>
              set({
                customer_organization_id: option.id,
                customer_organization_name: option.label,
                customer_name: form.customer_name.trim() || option.label,
                ...noContact,
              })
            }
            onClear={() => set({ customer_organization_id: null, customer_organization_name: "", ...noContact })}
            placeholder={field.placeholder ?? "Search accounts"}
            queryKeyPrefix="invoice-page-account"
          />
        </QuickCreateField>
      );
    }
    if (field.field_key === "customer_contact_id") {
      return (
        <QuickCreateField field={field} aria={aria} error={error}>
          <LinkedRecordPicker
            {...common}
            recordType="contact"
            valueId={form.customer_contact_id}
            displayValue={form.customer_contact_name}
            onDisplayValueChange={(customer_contact_name) => set({ customer_contact_id: null, customer_contact_name })}
            onSelect={(option) => {
              const raw = option.raw as { primary_email?: string | null } | undefined;
              set({
                customer_contact_id: option.id,
                customer_contact_name: option.label,
                customer_organization_id: option.organization_id ?? form.customer_organization_id,
                customer_organization_name: option.organization_name ?? form.customer_organization_name,
                customer_name: form.customer_name.trim() || option.label,
                customer_email: form.customer_email.trim() || raw?.primary_email || "",
              });
            }}
            onClear={() => set(noContact)}
            placeholder={field.placeholder ?? "Search contacts"}
            queryKeyPrefix="invoice-page-contact"
            filters={{ organizationId: form.customer_organization_id }}
          />
        </QuickCreateField>
      );
    }
    return undefined;
  };
}

/** Totals, the till's *paid now*, and print settings. */
function InvoiceSidebar({
  form,
  onChange,
  currency,
  totals,
  showPaidNow,
}: {
  form: InvoiceForm;
  onChange: (form: InvoiceForm) => void;
  currency: string;
  totals: { subtotal: number; discount: number; tax: number; total: number };
  showPaidNow: boolean;
}) {
  return (
    <>
      <TransactionTotals
        description="Totals are recalculated by the server before the invoice is saved."
        currency={currency}
        rows={[
          { label: "Subtotal", amount: totals.subtotal },
          { label: "Discount", amount: totals.discount, negative: true },
          { label: "Tax", amount: totals.tax },
          { label: "Total", amount: totals.total, resolved: true },
        ]}
      />
      {/* Money is recorded as payments on the issued invoice (12c §3.3). The one exception is
          the till: a walk-in sale is issued and paid in the same step. */}
      {showPaidNow ? (
        <FormSection title="Payment" description="For a sale paid at the counter: issue the invoice and record the payment together, by the invoice's payment method.">
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
          </div>
        </FormSection>
      ) : null}
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
