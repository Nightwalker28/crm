"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import { FormSection, RecordFormLayout } from "@/components/forms/RecordFormLayout";
import { areTransactionItemsValid, calculateTransactionTotals, createTransactionLineItem, formatTransactionMoney, serializeTransactionItems, TransactionLineItemsEditor, type TransactionLineItem } from "@/components/transactions/TransactionLineItemsEditor";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";

type QuoteForm = { quote_number: string; title: string; customer_name: string; contact_id: number | null; contact_name: string; organization_id: number | null; organization_name: string; opportunity_id: number | null; opportunity_name: string; assigned_to: number | null; assigned_to_name: string; status: string; issue_date: string; expiry_date: string; currency: string; notes: string };

const EMPTY_FORM: QuoteForm = { quote_number: "", title: "", customer_name: "", contact_id: null, contact_name: "", organization_id: null, organization_name: "", opportunity_id: null, opportunity_name: "", assigned_to: null, assigned_to_name: "", status: "draft", issue_date: "", expiry_date: "", currency: "USD", notes: "" };
const STATUSES = [{ value: "draft", label: "Draft" }, { value: "sent", label: "Sent" }, { value: "accepted", label: "Accepted" }, { value: "declined", label: "Declined" }, { value: "expired", label: "Expired" }];

type QuoteEditSource = {
  quote: Omit<QuoteForm, "contact_name" | "organization_name" | "opportunity_name" | "assigned_to_name"> & {
    updated_at?: string | null;
    custom_fields?: Record<string, unknown> | null;
    items?: Array<{ name: string; description?: string | null; quantity: string | number; unit_price: string | number; discount_amount: string | number; tax_amount: string | number }>;
  };
  contact?: { first_name?: string | null; last_name?: string | null; primary_email?: string | null } | null;
  organization?: { org_name: string } | null;
  opportunity?: { opportunity_name: string } | null;
};

type QuoteSeed = { form: QuoteForm; items: TransactionLineItem[]; customValues: Record<string, unknown> };

async function fetchQuoteForEdit(quoteId: string) {
  const res = await apiFetch(`/sales/quotes/${quoteId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? "We could not load this quote.");
  return body as QuoteEditSource;
}

function quoteSeed(source?: QuoteEditSource): QuoteSeed {
  if (!source) return { form: EMPTY_FORM, items: [createTransactionLineItem("quote")], customValues: {} };
  const quote = source.quote;
  const contactName = source.contact ? `${source.contact.first_name ?? ""} ${source.contact.last_name ?? ""}`.trim() || source.contact.primary_email || "" : "";
  return {
    form: {
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
      currency: quote.currency ?? "USD",
      notes: quote.notes ?? "",
    },
    items: quote.items?.length ? quote.items.map((item) => ({ ...createTransactionLineItem("quote"), name: item.name, description: item.description ?? "", quantity: String(item.quantity), unit_price: String(item.unit_price), discount_amount: String(item.discount_amount), tax_amount: String(item.tax_amount) })) : [createTransactionLineItem("quote")],
    customValues: quote.custom_fields ?? {},
  };
}

export default function QuoteRecordFormPage({ mode = "create", quoteId }: { mode?: "create" | "edit"; quoteId?: string }) {
  const query = useQuery({ queryKey: ["sales-quote-edit", quoteId], queryFn: () => fetchQuoteForEdit(quoteId as string), enabled: mode === "edit" && Boolean(quoteId), staleTime: 30_000 });
  if (mode === "edit" && query.isLoading) return <div className="space-y-6"><Skeleton className="h-16 w-full" /><Skeleton className="h-[640px] w-full rounded-[var(--radius-card)]" /></div>;
  if (mode === "edit" && query.error) return <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted p-6"><h1 className="text-lg font-semibold text-copy-primary">Unable to load quote</h1><p className="mt-2 text-sm text-copy-secondary">It may have been deleted or you may not have access.</p><Button className="mt-4" asChild variant="outline"><Link href="/dashboard/sales/quotes">Back to quotes</Link></Button></div>;
  const seed = quoteSeed(query.data);
  return <QuoteRecordFormEditor key={`${mode}:${quoteId ?? "new"}:${query.data?.quote.updated_at ?? ""}`} mode={mode} quoteId={quoteId} seed={seed} />;
}

function QuoteRecordFormEditor({ mode, quoteId, seed }: { mode: "create" | "edit"; quoteId?: string; seed: QuoteSeed }) {
  const router = useRouter(); const queryClient = useQueryClient();
  const [form, setForm] = useState<QuoteForm>(seed.form); const [items, setItems] = useState<TransactionLineItem[]>(seed.items); const [customValues, setCustomValues] = useState<Record<string, unknown>>(seed.customValues);
  const [initialSnapshot] = useState(() => JSON.stringify([seed.form, seed.items, seed.customValues])); const [customerError, setCustomerError] = useState<string | null>(null); const [itemsError, setItemsError] = useState<string | null>(null); const [submitError, setSubmitError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false);
  const customFields = useModuleCustomFields("sales_quotes", true); const { fields: moduleFields } = useModuleFieldConfigs("sales_quotes"); const currencies = useCompanyCurrencies(true); const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const totals = useMemo(() => calculateTransactionTotals(items), [items]);
  const snapshot = useMemo(() => JSON.stringify([form, items, customValues]), [form, items, customValues]); const dirty = snapshot !== initialSnapshot;
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (!dirty || submitting) return; event.preventDefault(); }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty, submitting]);
  function validate() { const validCustomer = Boolean(form.customer_name.trim()); const validItems = areTransactionItemsValid(items); setCustomerError(validCustomer ? null : "Customer name is required."); setItemsError(validItems ? null : "Each line needs a name, positive quantity, and valid non-negative amounts."); if (!validCustomer) document.getElementById("quote-customer")?.focus(); else if (!validItems) document.querySelector<HTMLInputElement>("[data-transaction-field='name']")?.focus(); return validCustomer && validItems; }
  async function submit() { if (!validate()) return; try { setSubmitting(true); setSubmitError(null); const payload = pickEnabledModulePayload({ quote_number: form.quote_number.trim() || null, title: form.title.trim() || null, customer_name: form.customer_name.trim(), contact_id: form.contact_id, organization_id: form.organization_id, opportunity_id: form.opportunity_id, assigned_to: form.assigned_to, status: form.status, issue_date: form.issue_date || null, expiry_date: form.expiry_date || null, currency: form.currency, notes: form.notes.trim() || null, custom_fields: customValues }, moduleFields, ["customer_name", "contact_id", "organization_id", "opportunity_id", "custom_fields"]); const res = await apiFetch(mode === "edit" ? `/sales/quotes/${quoteId}` : "/sales/quotes", { method: mode === "edit" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, items: serializeTransactionItems(items) }) }); const body = await res.json().catch(() => null) as { quote_id?: number; detail?: string } | null; if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`); await Promise.all([queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }), queryClient.invalidateQueries({ queryKey: ["sales-quote-edit", quoteId] }), queryClient.invalidateQueries({ queryKey: ["quote-summary", quoteId] })]); toast.success(mode === "edit" ? "Quote updated." : "Quote created."); const targetId = body?.quote_id ?? (quoteId ? Number(quoteId) : null); router.push(targetId ? `/dashboard/sales/quotes/${targetId}` : "/dashboard/sales/quotes"); } catch (error) { setSubmitError(error instanceof Error ? error.message : `Failed to ${mode === "edit" ? "update" : "create"} quote`); } finally { setSubmitting(false); } }
  const backHref = mode === "edit" && quoteId ? `/dashboard/sales/quotes/${quoteId}` : "/dashboard/sales/quotes";
  return <div className="flex flex-col gap-6"><PageHeader title={mode === "edit" ? `Edit ${form.quote_number}` : "Create quote"} description={mode === "edit" ? "Update customer context, line items, pricing, ownership, and quote terms." : "Build a customer quote with itemized pricing, terms, and linked sales context."} actions={<Button asChild variant="ghost" size="sm"><Link href={backHref}><ArrowLeft />Back to {mode === "edit" ? "quote" : "quotes"}</Link></Button>} />{submitError ? <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary"><div className="font-medium">We could not {mode === "edit" ? "update" : "create"} this quote.</div><div className="mt-1 text-copy-secondary">{submitError}</div></div> : null}<RecordFormLayout sidebar={<QuoteSummary form={form} onChange={setForm} totals={totals} currencies={currencies.data ?? ["USD"]} moduleFields={moduleFields} mode={mode} />} footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-copy-muted">{dirty ? "You have unsaved changes." : mode === "edit" ? "No unsaved changes." : "Add the customer and line items to create this quote."}</span><div className="flex items-center gap-2"><Button asChild variant="outline"><Link href={backHref}>Cancel</Link></Button><Button onClick={() => void submit()} disabled={submitting}><Save />{submitting ? "Saving…" : mode === "edit" ? "Save changes" : "Create quote"}</Button></div></div>}>
    <FormSection title="Customer and billing details" description="Link the quote to canonical CRM records while preserving the customer-facing name."><div className="grid gap-4 md:grid-cols-2">{enabled("customer_name") ? <Field data-invalid={Boolean(customerError)} className="md:col-span-2"><FieldLabel htmlFor="quote-customer">Customer name <RequiredMark /></FieldLabel><Input id="quote-customer" value={form.customer_name} onChange={(event) => { setForm({ ...form, customer_name: event.target.value }); setCustomerError(null); }} aria-invalid={Boolean(customerError)} />{customerError ? <FieldError>{customerError}</FieldError> : null}</Field> : null}{enabled("organization_id") ? <Field><FieldLabel>Account</FieldLabel><LinkedRecordPicker recordType="organization" valueId={form.organization_id} displayValue={form.organization_name} onDisplayValueChange={(organization_name) => setForm({ ...form, organization_id: null, organization_name, contact_id: null, contact_name: "", opportunity_id: null, opportunity_name: "" })} onSelect={(option) => setForm({ ...form, organization_id: option.id, organization_name: option.label, customer_name: form.customer_name.trim() || option.label, contact_id: null, contact_name: "", opportunity_id: null, opportunity_name: "" })} onClear={() => setForm({ ...form, organization_id: null, organization_name: "", contact_id: null, contact_name: "", opportunity_id: null, opportunity_name: "" })} placeholder="Search accounts" queryKeyPrefix="quote-page-account" /></Field> : null}{enabled("contact_id") ? <Field><FieldLabel>Contact</FieldLabel><LinkedRecordPicker recordType="contact" valueId={form.contact_id} displayValue={form.contact_name} onDisplayValueChange={(contact_name) => setForm({ ...form, contact_id: null, contact_name, opportunity_id: null, opportunity_name: "" })} onSelect={(option) => setForm({ ...form, contact_id: option.id, contact_name: option.label, organization_id: option.organization_id ?? form.organization_id, organization_name: option.organization_name ?? form.organization_name, customer_name: form.customer_name.trim() || option.label })} onClear={() => setForm({ ...form, contact_id: null, contact_name: "" })} placeholder="Search contacts" queryKeyPrefix="quote-page-contact" filters={{ organizationId: form.organization_id }} /></Field> : null}{enabled("opportunity_id") ? <Field className="md:col-span-2"><FieldLabel>Deal</FieldLabel><LinkedRecordPicker recordType="opportunity" valueId={form.opportunity_id} displayValue={form.opportunity_name} onDisplayValueChange={(opportunity_name) => setForm({ ...form, opportunity_id: null, opportunity_name })} onSelect={(option) => setForm({ ...form, opportunity_id: option.id, opportunity_name: option.label, contact_id: option.contact_id ?? form.contact_id, organization_id: option.organization_id ?? form.organization_id, customer_name: form.customer_name.trim() || option.description?.split(" · ")[0] || option.label })} onClear={() => setForm({ ...form, opportunity_id: null, opportunity_name: "" })} placeholder="Search deals" queryKeyPrefix="quote-page-deal" filters={{ contactId: form.contact_id, organizationId: form.organization_id }} /><FieldDescription>When linked, the server verifies the contact and account match this deal.</FieldDescription></Field> : null}</div></FormSection>
    <TransactionLineItemsEditor items={items} onChange={(nextItems) => { setItems(nextItems); setItemsError(null); }} currency={form.currency} error={itemsError} idPrefix="quote" />
    <FormSection title="Terms and notes" description="Customer-facing context included with the quote."><div className="grid gap-4 md:grid-cols-2">{enabled("title") ? <Field className="md:col-span-2"><FieldLabel htmlFor="quote-title">Title</FieldLabel><Input id="quote-title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Proposal title" /></Field> : null}{enabled("notes") ? <Field className="md:col-span-2"><FieldLabel htmlFor="quote-notes">Terms and notes</FieldLabel><Textarea id="quote-notes" rows={6} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field> : null}</div></FormSection>
    {customFields.data?.length ? <FormSection title="Custom fields" description="Additional quote information configured for your workspace."><CustomFieldInputs definitions={customFields.data} values={customValues} onChange={(key, value) => setCustomValues((current) => ({ ...current, [key]: value }))} /></FormSection> : null}
  </RecordFormLayout></div>;
}

function QuoteSummary({ form, onChange, totals, currencies, moduleFields, mode }: { form: QuoteForm; onChange: (form: QuoteForm) => void; totals: { subtotal: number; discount: number; tax: number; total: number }; currencies: string[]; moduleFields: ReturnType<typeof useModuleFieldConfigs>["fields"]; mode: "create" | "edit" }) { const enabled = (key: string) => isModuleFieldEnabled(moduleFields, key); return <><FormSection title="Review summary" description="Totals are calculated from the line items and verified again by the server."><dl className="space-y-3"><SummaryRow label="Subtotal" value={formatTransactionMoney(totals.subtotal, form.currency)} /><SummaryRow label="Discount" value={`− ${formatTransactionMoney(totals.discount, form.currency)}`} /><SummaryRow label="Tax" value={formatTransactionMoney(totals.tax, form.currency)} /><div className="border-t border-line-default pt-3"><SummaryRow label="Total" value={formatTransactionMoney(totals.total, form.currency)} strong /></div></dl></FormSection><FormSection title="Delivery and validity" description="Control numbering, dates, currency, and workflow status."><div className="space-y-4">{enabled("quote_number") ? <Field><FieldLabel htmlFor="quote-number">Quote number</FieldLabel><Input id="quote-number" value={form.quote_number} onChange={(event) => onChange({ ...form, quote_number: event.target.value })} placeholder="Auto-generated if blank" /></Field> : null}{enabled("currency") ? <Field><FieldLabel>Currency</FieldLabel><Select value={form.currency} onValueChange={(currency) => onChange({ ...form, currency })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{currencies.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent></Select></Field> : null}{enabled("issue_date") ? <Field><FieldLabel htmlFor="quote-issue">Issue date</FieldLabel><Input id="quote-issue" type="date" value={form.issue_date} onChange={(event) => onChange({ ...form, issue_date: event.target.value })} /></Field> : null}{enabled("expiry_date") ? <Field><FieldLabel htmlFor="quote-expiry">Expiry date</FieldLabel><Input id="quote-expiry" type="date" value={form.expiry_date} min={form.issue_date || undefined} onChange={(event) => onChange({ ...form, expiry_date: event.target.value })} /></Field> : null}{enabled("status") ? <Field><FieldLabel>Status</FieldLabel><Select value={form.status} onValueChange={(status) => onChange({ ...form, status })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent></Select></Field> : null}</div></FormSection><FormSection title="Ownership" description="Assign responsibility for this quote.">{enabled("assigned_to") ? <Field><FieldLabel>Owner</FieldLabel><LinkedRecordPicker recordType="user" valueId={form.assigned_to} displayValue={form.assigned_to_name} onDisplayValueChange={(assigned_to_name) => onChange({ ...form, assigned_to: null, assigned_to_name })} onSelect={(option) => onChange({ ...form, assigned_to: option.id, assigned_to_name: option.label })} onClear={() => onChange({ ...form, assigned_to: null, assigned_to_name: "" })} placeholder="Search owners (defaults to you)" queryKeyPrefix="quote-page-owner" sourceModuleKey="sales_quotes" sourceAction={mode === "edit" ? "edit" : "create"} /></Field> : <p className="text-sm text-copy-muted">Ownership is not enabled.</p>}</FormSection></>; }
function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div className={`flex items-center justify-between gap-3 ${strong ? "text-base font-semibold text-copy-primary" : "text-sm text-copy-secondary"}`}><dt>{label}</dt><dd className="tabular-nums">{value}</dd></div>; }
