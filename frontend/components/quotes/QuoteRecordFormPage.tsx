"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import { FormErrorBanner } from "@/components/forms/FormErrorBanner";
import { LayoutRecordFormBody } from "@/components/forms/LayoutRecordFormBody";
import type { RecordFormValue } from "@/components/forms/RecordForm";
import { validateLayoutDrivenQuickCreate } from "@/components/forms/quickCreateLayout";
import {
  customFieldInputId,
  ServerFieldError,
  ServerFieldErrorsProvider,
  useServerFormErrors,
} from "@/components/forms/ServerFieldErrors";
import {
  FormSection,
  RecordFormLayout,
} from "@/components/forms/RecordFormLayout";
import { PicklistField } from "@/components/picklists/PicklistSelect";
import { useRecordTabHref } from "@/components/recordWorkspace/RecordWorkspace";
import {
  areTransactionItemsValid,
  calculateTransactionTotals,
  createTransactionLineItem,
  serializeTransactionItems,
  transactionCatalogLink,
  transactionItemsFromCopy,
  TransactionLineItemsEditor,
  type TransactionLineItem,
} from "@/components/transactions/TransactionLineItemsEditor";
import { TransactionTotals } from "@/components/transactions/TransactionTotals";
import { customerFieldRenderer } from "@/components/transactions/customerFieldRenderer";
import { fetchDealForDocument, type DealForDocument } from "@/components/transactions/dealPrefill";
import {
  documentHeaderFrom,
  documentHeaderInputId,
  documentHeaderPayload,
  EMPTY_DOCUMENT_HEADER,
  SameAsBillingButton,
  shippingChargeAmount,
} from "@/components/transactions/DocumentHeaderFields";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
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
import { useCloneDraft, type CloneDraft } from "@/hooks/useCloneDraft";
import { useBaseCurrency } from "@/hooks/useCompanyCurrencies";
import { useResolvedRecordLayout } from "@/hooks/useResolvedRecordLayout";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import {
  isModuleFieldEnabled,
  pickEnabledModulePayload,
  useModuleFieldConfigs,
} from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";
import { apiErrorFromResponse } from "@/lib/apiErrors";
import { formatDateTime } from "@/lib/datetime";
import { formValuesFromCopy } from "@/lib/formValues";

/** The quote form's value: flat, keyed by field key, as `RecordForm` draws it (13b Phase 4e). */
type QuoteForm = RecordFormValue & {
  quote_number: string;
  title: string;
  customer_name: string;
  contact_id: number | null;
  contact_name: string;
  organization_id: number | null;
  organization_name: string;
  opportunity_id: number | null;
  opportunity_name: string;
  assigned_to: number | null;
  assigned_to_name: string;
  status: string;
  issue_date: string;
  expiry_date: string;
  currency: string;
  notes: string;
};

const EMPTY_FORM: QuoteForm = {
  ...EMPTY_DOCUMENT_HEADER,
  quote_number: "",
  title: "",
  customer_name: "",
  contact_id: null,
  contact_name: "",
  organization_id: null,
  organization_name: "",
  opportunity_id: null,
  opportunity_name: "",
  assigned_to: null,
  assigned_to_name: "",
  status: "draft",
  issue_date: "",
  expiry_date: "",
  currency: "",
  notes: "",
};
const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
];

/** The ids these inputs had before the layout drew them; specs and focus still use them. */
const QUOTE_INPUT_IDS: Record<string, string> = {
  customer_name: "quote-customer",
  organization_id: "quote-account",
  contact_id: "quote-contact",
  opportunity_id: "quote-deal",
  title: "quote-title",
  notes: "quote-notes",
  quote_number: "quote-number",
  currency: "quote-currency",
  issue_date: "quote-issue",
  expiry_date: "quote-expiry",
  status: "quote-status",
  assigned_to: "quote-owner",
};

function quoteInputId(fieldKey: string) {
  return QUOTE_INPUT_IDS[fieldKey] ?? documentHeaderInputId("quote", fieldKey) ?? `quote-${fieldKey.replace(/_/g, "-")}`;
}

type QuoteEditSource = {
  quote: Record<string, unknown> & {
    quote_number?: string | null;
    title?: string | null;
    customer_name?: string | null;
    contact_id?: number | null;
    organization_id?: number | null;
    opportunity_id?: number | null;
    assigned_to?: number | null;
    status?: string | null;
    issue_date?: string | null;
    expiry_date?: string | null;
    currency?: string | null;
    notes?: string | null;
    updated_at?: string | null;
    custom_fields?: Record<string, unknown> | null;
    items?: Array<{
      catalog_product_id?: number | null;
      catalog_service_id?: number | null;
      name: string;
      description?: string | null;
      quantity: string | number;
      unit_price: string | number;
      discount_amount: string | number;
      tax_amount: string | number;
    }>;
  };
  contact?: {
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
  } | null;
  organization?: { org_name: string } | null;
  opportunity?: { opportunity_name: string } | null;
};

type QuoteSeed = {
  form: QuoteForm;
  items: TransactionLineItem[];
  customValues: Record<string, unknown>;
};

async function fetchQuoteForEdit(quoteId: string) {
  const res = await apiFetch(`/sales/quotes/${quoteId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("We could not load this quote.");
  return body as QuoteEditSource;
}

function quoteSeed(source?: QuoteEditSource, deal?: DealForDocument | null): QuoteSeed {
  if (!source)
    return {
      // *Create quote* on a deal (13a H13): the deal's customer, currency and link.
      form: deal
        ? {
            ...EMPTY_FORM,
            title: deal.opportunity_name,
            customer_name: deal.organization_name || deal.contact_name || "",
            organization_id: deal.organization_id ?? null,
            organization_name: deal.organization_name ?? "",
            contact_id: deal.contact_id ?? null,
            contact_name: deal.contact_name ?? "",
            opportunity_id: deal.opportunity_id,
            opportunity_name: deal.opportunity_name,
            currency: deal.currency_type || "",
          }
        : EMPTY_FORM,
      items: [createTransactionLineItem("quote")],
      customValues: {},
    };
  const quote = source.quote;
  const contactName = source.contact
    ? `${source.contact.first_name ?? ""} ${source.contact.last_name ?? ""}`.trim() ||
      source.contact.primary_email ||
      ""
    : "";
  return {
    form: {
      ...documentHeaderFrom(quote),
      quote_number: quote.quote_number ?? "",
      title: quote.title ?? "",
      customer_name: quote.customer_name ?? "",
      contact_id: quote.contact_id ?? null,
      contact_name: contactName,
      organization_id: quote.organization_id ?? null,
      organization_name: source.organization?.org_name ?? "",
      opportunity_id: quote.opportunity_id ?? null,
      opportunity_name: source.opportunity?.opportunity_name ?? "",
      assigned_to: quote.assigned_to ?? null,
      assigned_to_name: "",
      status: quote.status ?? "draft",
      issue_date: quote.issue_date ?? "",
      expiry_date: quote.expiry_date ?? "",
      currency: quote.currency ?? "",
      notes: quote.notes ?? "",
    },
    items: quote.items?.length
      ? quote.items.map((item) => ({
          ...createTransactionLineItem("quote"),
          ...transactionCatalogLink(item),
          name: item.name,
          description: item.description ?? "",
          quantity: String(item.quantity),
          unit_price: String(item.unit_price),
          discount_amount: String(item.discount_amount),
          tax_amount: String(item.tax_amount),
        }))
      : [createTransactionLineItem("quote")],
    customValues: quote.custom_fields ?? {},
  };
}

/** *Clone* (13b Phase 5): the copied customer, addresses, terms and lines; a new number, status and dates. */
function quoteSeedFromCopy(draft: CloneDraft): QuoteSeed {
  return {
    form: formValuesFromCopy(EMPTY_FORM, draft.fields),
    items: transactionItemsFromCopy(draft.lines, "quote"),
    customValues: draft.custom_fields,
  };
}

export default function QuoteRecordFormPage({
  mode = "create",
  quoteId,
}: {
  mode?: "create" | "edit";
  quoteId?: string;
}) {
  const query = useQuery({
    queryKey: ["sales-quote-edit", quoteId],
    queryFn: () => fetchQuoteForEdit(quoteId as string),
    enabled: mode === "edit" && Boolean(quoteId),
    staleTime: 30_000,
  });
  const dealId = useSearchParams().get("opportunity_id");
  const dealQuery = useQuery({
    queryKey: ["document-deal-prefill", dealId],
    queryFn: () => fetchDealForDocument(dealId as string),
    enabled: mode === "create" && Boolean(dealId),
    staleTime: 30_000,
  });
  const clone = useCloneDraft("sales_quotes", mode === "create");
  if (mode === "edit" && query.isLoading) return <RouteLoadingState />;
  if (mode === "create" && dealId && dealQuery.isLoading) return <RouteLoadingState />;
  if (clone.isLoading) return <RouteLoadingState />;
  if (clone.error)
    return (
      <RouteErrorState
        title="This quote could not be copied"
        reset={() => void clone.refetch()}
        backHref="/dashboard/sales/quotes"
        backLabel="Back to quotes"
      />
    );
  if (mode === "edit" && query.error)
    return (
      <RouteErrorState
        title="Quote could not be loaded"
        reset={() => void query.refetch()}
        backHref="/dashboard/sales/quotes"
        backLabel="Back to quotes"
      />
    );
  const seed = clone.draft ? quoteSeedFromCopy(clone.draft) : quoteSeed(query.data, dealQuery.data);
  return (
    <QuoteRecordFormEditor
      key={`${mode}:${quoteId ?? "new"}:${query.data?.quote.updated_at ?? ""}:${dealQuery.data?.opportunity_id ?? ""}:${clone.cloneId ?? ""}`}
      mode={mode}
      quoteId={quoteId}
      seed={seed}
      updatedAt={query.data?.quote.updated_at}
    />
  );
}

function QuoteRecordFormEditor({
  mode,
  quoteId,
  seed,
  updatedAt,
}: {
  mode: "create" | "edit";
  quoteId?: string;
  seed: QuoteSeed;
  updatedAt?: string | null;
}) {
  const router = useRouter();
  // R2 travels in both directions: the tab the operator left is on this page's own URL,
  // so Back, Cancel and the post-save redirect all return to it.
  const listHref = "/dashboard/sales/quotes";
  const backHref = useRecordTabHref(mode === "edit" && quoteId ? `${listHref}/${quoteId}` : listHref);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<QuoteForm>(seed.form);
  const [items, setItems] = useState<TransactionLineItem[]>(seed.items);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>(
    seed.customValues,
  );
  const [initialSnapshot] = useState(() =>
    JSON.stringify([seed.form, seed.items, seed.customValues]),
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [itemsError, setItemsError] = useState<string | null>(null);
  const inputIdFor = useCallback(
    (path: string) => customFieldInputId("sales_quotes", path) ?? quoteInputId(path),
    [],
  );
  const serverErrors = useServerFormErrors(inputIdFor);
  const [submitting, setSubmitting] = useState(false);
  // The `full_form` layout (13b Phase 4e); the body below reads the same cached query.
  const layoutQuery = useResolvedRecordLayout("sales_quotes", "full_form");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_quotes");
  const baseCurrency = useBaseCurrency();
  const currency = form.currency || baseCurrency.data || "USD";
  const totals = useMemo(() => calculateTransactionTotals(items), [items]);
  const shippingCharge = shippingChargeAmount(form);
  const snapshot = useMemo(
    () => JSON.stringify([form, items, customValues]),
    [form, items, customValues],
  );
  const dirty = snapshot !== initialSnapshot;
  useUnsavedChangesGuard(dirty, submitting);
  function validate() {
    const nextErrors = layoutQuery.data ? validateLayoutDrivenQuickCreate(layoutQuery.data, form, customValues) : {};
    if (!form.customer_name.trim() && !nextErrors.customer_name) nextErrors.customer_name = "Customer name is required.";
    const validItems = areTransactionItemsValid(items);
    setFieldErrors(nextErrors);
    setItemsError(
      validItems
        ? null
        : "Each line needs a name, positive quantity, and valid non-negative amounts.",
    );
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      const id = firstInvalid.startsWith("custom:")
        ? `custom-field-sales_quotes-${firstInvalid.slice("custom:".length)}`
        : quoteInputId(firstInvalid);
      document.getElementById(id)?.focus();
    } else if (!validItems) {
      document.querySelector<HTMLInputElement>("[data-line-field='name']")?.focus();
    }
    return !firstInvalid && validItems;
  }
  async function submit() {
    if (!validate()) return;
    try {
      setSubmitting(true);
      serverErrors.clear();
      const payload = pickEnabledModulePayload(
        {
          quote_number: form.quote_number.trim() || null,
          title: form.title.trim() || null,
          customer_name: form.customer_name.trim(),
          contact_id: form.contact_id,
          organization_id: form.organization_id,
          opportunity_id: form.opportunity_id,
          assigned_to: form.assigned_to,
          status: form.status,
          issue_date: form.issue_date || null,
          expiry_date: form.expiry_date || null,
          currency,
          notes: form.notes.trim() || null,
          ...documentHeaderPayload(form),
          custom_fields: customValues,
        },
        moduleFields,
        [
          "customer_name",
          "contact_id",
          "organization_id",
          "opportunity_id",
          "custom_fields",
        ],
      );
      const res = await apiFetch(
        mode === "edit" ? `/sales/quotes/${quoteId}` : "/sales/quotes",
        {
          method: mode === "edit" ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            items: serializeTransactionItems(items),
          }),
        },
      );
      if (!res.ok) throw await apiErrorFromResponse(res, "Check the form and your connection, then try again.");
      const body = (await res.json().catch(() => null)) as { quote_id?: number } | null;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
        queryClient.invalidateQueries({
          queryKey: ["sales-quote-edit", quoteId],
        }),
        queryClient.invalidateQueries({ queryKey: ["quote-summary", quoteId] }),
      ]);
      toast.success(mode === "edit" ? "Quote updated." : "Quote created.");
      const targetId = body?.quote_id ?? (quoteId ? Number(quoteId) : null);
      router.push(mode === "edit" ? backHref : (targetId ? `${listHref}/${targetId}` : listHref));
    } catch (error) {
      serverErrors.report(error, "Check the form and your connection, then try again.");
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
      title={mode === "edit" ? `Edit ${form.quote_number}` : "Create quote"}
      description={
        mode === "edit"
          ? "Update customer context, line items, pricing, ownership, and quote terms."
          : "Build a customer quote with itemized pricing, terms, and linked sales context."
      }
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft />
            Back to {mode === "edit" ? "quote" : "quotes"}
          </Link>
        </Button>
      }
    >
      {serverErrors.message ? (
        <FormErrorBanner title={`We could not ${mode === "edit" ? "update" : "create"} this quote.`}>{serverErrors.message}</FormErrorBanner>
      ) : null}
      <ServerFieldErrorsProvider errors={serverErrors.errors} inputIdFor={inputIdFor}>
      <RecordFormLayout
        title={mode === "edit" ? form.quote_number : "Create quote"}
        status={dirty
          ? "Unsaved changes"
          : mode === "edit"
          ? null
          : "Add the customer and line items to create this quote."}
        actions={(
          <>
            <Button asChild variant="outline">
              <Link href={backHref}>Cancel</Link>
            </Button>
            <Button onClick={() => void submit()} disabled={submitting}>
              <Save />
              {submitting
                ? "Saving…"
                : mode === "edit"
                  ? "Save changes"
                  : "Create quote"}
            </Button>
          </>
        )}
      >
        <LayoutRecordFormBody<QuoteForm>
          moduleKey="sales_quotes"
          value={form}
          onChange={setForm}
          customValues={customValues}
          onCustomChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))}
          inputId={quoteInputId}
          action={mode}
          errors={fieldErrors}
          renderField={customerFieldRenderer({ value: form, idPrefix: "quote" })}
          slots={{
            mainInsert: {
              afterSection: "quote",
              node: (
                <TransactionLineItemsEditor
                  items={items}
                  onChange={(nextItems) => {
                    setItems(nextItems);
                    setItemsError(null);
                  }}
                  currency={currency}
                  error={itemsError}
                  idPrefix="quote"
                />
              ),
            },
            sectionActions: { shipping: <SameAsBillingButton value={form} set={(patch) => setForm({ ...form, ...patch })} /> },
            fixedSidebar: (
              <>
                <TransactionTotals
                  description="Totals are calculated from the line items and verified again by the server."
                  currency={currency}
                  rows={[
                    { label: "Subtotal", amount: totals.subtotal },
                    { label: "Discount", amount: totals.discount, negative: true },
                    { label: "Tax", amount: totals.tax },
                    ...(shippingCharge ? [{ label: "Shipping", amount: shippingCharge }] : []),
                    { label: "Total", amount: totals.total + shippingCharge, resolved: true },
                  ]}
                />
                <QuoteDetails form={form} onChange={setForm} moduleFields={moduleFields} />
              </>
            ),
          }}
        />
      </RecordFormLayout>
      </ServerFieldErrorsProvider>
    </PageShell>
  );
}

/** Numbering and workflow: the system's part of the header, beside the totals. */
function QuoteDetails({
  form,
  onChange,
  moduleFields,
}: {
  form: QuoteForm;
  onChange: (form: QuoteForm) => void;
  moduleFields: ReturnType<typeof useModuleFieldConfigs>["fields"];
}) {
  const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  if (!enabled("quote_number") && !enabled("status")) return null;
  return (
    <FormSection title="Quote details" description="Numbering and workflow status.">
      <div className="space-y-4">
        {enabled("quote_number") ? (
          <Field>
            <FieldLabel htmlFor="quote-number">Quote number</FieldLabel>
            <Input
              id="quote-number"
              value={form.quote_number}
              onChange={(event) => onChange({ ...form, quote_number: event.target.value })}
              placeholder="Auto-generated if blank"
            />
            <ServerFieldError inputId="quote-number" />
          </Field>
        ) : null}
        {enabled("status") ? (
          <Field>
            <FieldLabel htmlFor="quote-status">Status</FieldLabel>
            <Select value={form.status} onValueChange={(status) => onChange({ ...form, status })}>
              <SelectTrigger id="quote-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {/* Only once declined: a field for a state the quote is not in is noise (§4.7, A12). */}
        {form.status === "declined" ? (
          <PicklistField
            id="quote-lost-reason"
            listKey="lost_reason"
            label="Declined reason"
            value={String(form.lost_reason ?? "")}
            onChange={(lost_reason) => onChange({ ...form, lost_reason })}
          />
        ) : null}
      </div>
    </FormSection>
  );
}
