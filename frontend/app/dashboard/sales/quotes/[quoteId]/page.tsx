"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, ExternalLink, FileText, RefreshCw, Send, ShoppingCart, StickyNote } from "lucide-react";
import { toast } from "sonner";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import LinkedRecordPicker from "@/components/crm/LinkedRecordPicker";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

type QuoteProposal = {
  id: number;
  quote_id: number;
  document_id?: number | null;
  template_name: string;
  status: string;
  title: string;
  content_text: string;
  sent_to?: string | null;
  generated_at: string;
  sent_at?: string | null;
  public_expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

type QuoteProposalEvent = {
  id: number;
  quote_id: number;
  quote_document_id: number;
  event_type: string;
  recipient_email?: string | null;
  occurred_at: string;
};

type RelatedOrder = {
  id: number;
  order_number: string;
  quote_id?: number | null;
  status: string;
  currency: string;
  grand_total: string | number;
  created_at: string;
  updated_at: string;
};

type QuoteSummary = {
  quote: {
    quote_id: number;
    quote_number: string;
    title?: string | null;
    customer_name: string;
    contact_id?: number | null;
    organization_id?: number | null;
    opportunity_id?: number | null;
    status?: string | null;
    issue_date?: string | null;
    expiry_date?: string | null;
    currency?: string | null;
    subtotal_amount?: string | number | null;
    discount_amount?: string | number | null;
    tax_amount?: string | number | null;
    total_amount?: string | number | null;
    notes?: string | null;
    created_time?: string | null;
    updated_at?: string | null;
    custom_fields?: Record<string, unknown> | null;
  };
  opportunity?: {
    opportunity_id: number;
    opportunity_name: string;
    sales_stage?: string | null;
    expected_close_date?: string | null;
    total_cost_of_project?: string | null;
    currency_type?: string | null;
  } | null;
  contact?: {
    contact_id: number;
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
    contact_telephone?: string | null;
  } | null;
  organization?: {
    org_id: number;
    org_name: string;
    primary_email?: string | null;
    website?: string | null;
  } | null;
  latest_proposal?: QuoteProposal | null;
  proposal_events?: QuoteProposalEvent[];
  related_order?: RelatedOrder | null;
};

type QuoteForm = {
  quote_number: string;
  title: string;
  customer_name: string;
  contact_id: number | null;
  organization_id: number | null;
  opportunity_id: string;
  status: string;
  issue_date: string;
  expiry_date: string;
  currency: string;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  notes: string;
};

const emptyForm: QuoteForm = {
  quote_number: "",
  title: "",
  customer_name: "",
  contact_id: null,
  organization_id: null,
  opportunity_id: "",
  status: "draft",
  issue_date: "",
  expiry_date: "",
  currency: "USD",
  subtotal_amount: "0",
  discount_amount: "0",
  tax_amount: "0",
  total_amount: "0",
  notes: "",
};

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "declined", label: "Declined" },
  { value: "expired", label: "Expired" },
];

const QUOTE_ALWAYS_INCLUDED_FIELDS = ["quote_number", "customer_name", "contact_id", "organization_id", "opportunity_id", "custom_fields"];

function asInputValue(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
}

function getContactLabel(contact: QuoteSummary["contact"]) {
  if (!contact) return "";
  return `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || contact.primary_email || `Contact #${contact.contact_id}`;
}

async function fetchQuoteSummary(quoteId: string) {
  const res = await apiFetch(`/sales/quotes/${quoteId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as QuoteSummary;
}

export default function QuoteDetailPage() {
  const params = useParams<{ quoteId: string }>();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<QuoteForm>(emptyForm);
  const [contactSearch, setContactSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [dealSearch, setDealSearch] = useState("");
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [proposalSendingTo, setProposalSendingTo] = useState("");
  const [proposalBusy, setProposalBusy] = useState<"generate" | "send" | null>(null);
  const [proposalLinkPath, setProposalLinkPath] = useState<string | null>(null);
  const [convertingOrder, setConvertingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customFieldsQuery = useModuleCustomFields("sales_quotes", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_quotes");
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);

  const summaryQuery = useQuery({
    queryKey: ["sales-quote-summary", params.quoteId],
    queryFn: () => fetchQuoteSummary(params.quoteId),
    enabled: Boolean(params.quoteId),
    refetchOnWindowFocus: false,
  });
  const summary = summaryQuery.data ?? null;
  const loadError = summaryQuery.error instanceof Error ? summaryQuery.error.message : null;

  useEffect(() => {
    if (!summary) return;
    setError(null);
    setForm({
      quote_number: summary.quote.quote_number ?? "",
      title: summary.quote.title ?? "",
      customer_name: summary.quote.customer_name ?? "",
      contact_id: summary.quote.contact_id ?? null,
      organization_id: summary.quote.organization_id ?? null,
      opportunity_id: summary.quote.opportunity_id ? String(summary.quote.opportunity_id) : "",
      status: summary.quote.status ?? "draft",
      issue_date: summary.quote.issue_date ?? "",
      expiry_date: summary.quote.expiry_date ?? "",
      currency: summary.quote.currency ?? "USD",
      subtotal_amount: asInputValue(summary.quote.subtotal_amount),
      discount_amount: asInputValue(summary.quote.discount_amount),
      tax_amount: asInputValue(summary.quote.tax_amount),
      total_amount: asInputValue(summary.quote.total_amount),
      notes: summary.quote.notes ?? "",
    });
    setContactSearch(getContactLabel(summary.contact));
    setAccountSearch(summary.organization?.org_name ?? (summary.quote.organization_id ? `Account #${summary.quote.organization_id}` : ""));
    setDealSearch(summary.opportunity?.opportunity_name ?? (summary.quote.opportunity_id ? `Deal #${summary.quote.opportunity_id}` : ""));
    setCustomFieldValues(summary.quote.custom_fields ?? {});
    setProposalSendingTo(summary.latest_proposal?.sent_to ?? summary.contact?.primary_email ?? "");
  }, [summary]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const payload = pickEnabledModulePayload({
        quote_number: form.quote_number.trim(),
        title: form.title.trim() || null,
        customer_name: form.customer_name.trim(),
        contact_id: form.contact_id,
        organization_id: form.organization_id,
        opportunity_id: form.opportunity_id.trim() ? Number(form.opportunity_id) : null,
        status: form.status,
        issue_date: form.issue_date || null,
        expiry_date: form.expiry_date || null,
        currency: form.currency.trim().toUpperCase() || "USD",
        subtotal_amount: form.subtotal_amount || "0",
        discount_amount: form.discount_amount || "0",
        tax_amount: form.tax_amount || "0",
        total_amount: form.total_amount || "0",
        notes: form.notes.trim() || null,
        custom_fields: customFieldValues,
      }, moduleFields, QUOTE_ALWAYS_INCLUDED_FIELDS);
      const res = await apiFetch(`/sales/quotes/${params.quoteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
        summaryQuery.refetch(),
      ]);
      toast.success("Quote updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save quote");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateProposal() {
    try {
      setProposalBusy("generate");
      setError(null);
      const res = await apiFetch(`/sales/quotes/${params.quoteId}/proposal/generate`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setProposalLinkPath(null);
      await summaryQuery.refetch();
      toast.success("Proposal generated.");
    } catch (proposalError) {
      setError(proposalError instanceof Error ? proposalError.message : "Failed to generate proposal");
    } finally {
      setProposalBusy(null);
    }
  }

  async function handleSendProposal() {
    try {
      setProposalBusy("send");
      setError(null);
      const res = await apiFetch(`/sales/quotes/${params.quoteId}/proposal/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sent_to: proposalSendingTo.trim() || null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      setProposalLinkPath(body.public_url_path ?? null);
      await summaryQuery.refetch();
      toast.success("Proposal marked sent.");
    } catch (proposalError) {
      setError(proposalError instanceof Error ? proposalError.message : "Failed to send proposal");
    } finally {
      setProposalBusy(null);
    }
  }

  async function handleConvertToOrder() {
    try {
      setConvertingOrder(true);
      setError(null);
      const res = await apiFetch(`/sales/quotes/${params.quoteId}/convert-to-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allow_duplicate: false }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-orders"] }),
        summaryQuery.refetch(),
      ]);
      toast.success("Quote converted to order.");
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : "Failed to convert quote to order");
    } finally {
      setConvertingOrder(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/sales/quotes"
        backLabel="Back to Quotes"
        title={summary ? summary.quote.quote_number || "Quote" : "Quote"}
        description="Review quote value, customer status, and record history."
        primaryAction={(
          <>
            <RecordDeleteButton
              endpoint={`/sales/quotes/${params.quoteId}`}
              label="Quote"
              recordName={summary?.quote.quote_number || "this quote"}
              redirectHref="/dashboard/sales/quotes"
              queryKeys={["sales-quotes"]}
            />
            <Button onClick={handleSave} disabled={saving || !form.customer_name.trim() || !form.quote_number.trim()}>{saving ? "Saving..." : "Save Quote"}</Button>
          </>
        )}
      />

      {error || loadError ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error || loadError}</div> : null}

      {summaryQuery.isLoading || !summary ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading quote...</Card>
      ) : (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => document.getElementById("quote-record-tools")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <FileText />Documents
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => document.getElementById("quote-record-tools")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <StickyNote />Note
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => document.getElementById("quote-record-tools")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <CheckSquare />Task
              </Button>
              <div className="ml-auto text-xs text-neutral-500">
                Updated: {summary.quote.updated_at ? formatDateTime(summary.quote.updated_at) : "Not recorded"}
              </div>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="px-5 py-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-neutral-100">Quote Details</h2>
                <FieldDescription className="mt-1">Edit the record directly on the page.</FieldDescription>
              </div>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field><FieldLabel>Quote Number</FieldLabel><Input value={form.quote_number} onChange={(event) => setForm((current) => ({ ...current, quote_number: event.target.value }))} /></Field>
                {fieldEnabled("customer_name") ? <Field><FieldLabel>Customer</FieldLabel><Input value={form.customer_name} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} /></Field> : null}
                {fieldEnabled("contact_id") ? (
                <Field>
                  <FieldLabel>Contact</FieldLabel>
                  <LinkedRecordPicker
                    recordType="contact"
                    valueId={form.contact_id}
                    displayValue={contactSearch}
                    onDisplayValueChange={(value) => {
                      setContactSearch(value);
                      setForm((current) => ({ ...current, contact_id: null }));
                    }}
                    onSelect={(option) => {
                      setContactSearch(option.label);
                      setForm((current) => ({
                        ...current,
                        contact_id: option.id,
                        organization_id: option.organization_id ?? current.organization_id,
                        customer_name: current.customer_name.trim() ? current.customer_name : option.label,
                      }));
                      if (option.organization_id) {
                        setAccountSearch(option.organization_name || `Account #${option.organization_id}`);
                      }
                    }}
                    onClear={() => {
                      setContactSearch("");
                      setForm((current) => ({ ...current, contact_id: null }));
                    }}
                    placeholder="Search contacts"
                    queryKeyPrefix="quote-detail-contact"
                  />
                </Field>
                ) : null}
                {fieldEnabled("organization_id") ? (
                <Field>
                  <FieldLabel>Account</FieldLabel>
                  <LinkedRecordPicker
                    recordType="organization"
                    valueId={form.organization_id}
                    displayValue={accountSearch}
                    onDisplayValueChange={(value) => {
                      setAccountSearch(value);
                      setForm((current) => ({ ...current, organization_id: null }));
                    }}
                    onSelect={(option) => {
                      setAccountSearch(option.label);
                      setForm((current) => ({
                        ...current,
                        organization_id: option.id,
                        customer_name: current.customer_name.trim() ? current.customer_name : option.label,
                      }));
                    }}
                    onClear={() => {
                      setAccountSearch("");
                      setForm((current) => ({ ...current, organization_id: null }));
                    }}
                    placeholder="Search accounts"
                    queryKeyPrefix="quote-detail-account"
                  />
                </Field>
                ) : null}
                {fieldEnabled("opportunity_id") ? (
                <Field>
                  <FieldLabel>Deal</FieldLabel>
                  <LinkedRecordPicker
                    recordType="opportunity"
                    valueId={form.opportunity_id ? Number(form.opportunity_id) : null}
                    displayValue={dealSearch}
                    onDisplayValueChange={(value) => {
                      setDealSearch(value);
                      setForm((current) => ({ ...current, opportunity_id: "" }));
                    }}
                    onSelect={(option) => {
                      setDealSearch(option.label);
                      if (option.contact_id) {
                        setContactSearch(`Contact #${option.contact_id}`);
                      }
                      if (option.organization_id) {
                        setAccountSearch(`Account #${option.organization_id}`);
                      }
                      setForm((current) => ({
                        ...current,
                        opportunity_id: String(option.id),
                        contact_id: option.contact_id ?? current.contact_id,
                        organization_id: option.organization_id ?? current.organization_id,
                        customer_name: current.customer_name.trim() ? current.customer_name : option.description?.split(" · ")[0] || option.label,
                      }));
                    }}
                    onClear={() => {
                      setDealSearch("");
                      setForm((current) => ({ ...current, opportunity_id: "" }));
                    }}
                    placeholder="Search deals"
                    queryKeyPrefix="quote-detail-deal"
                  />
                  <FieldDescription>Links this quote to a sales deal and inherits contact/account when available.</FieldDescription>
                </Field>
                ) : null}
                {fieldEnabled("title") ? <Field><FieldLabel>Title</FieldLabel><Input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} /></Field> : null}
                {fieldEnabled("status") ? (
                  <Field>
                    <FieldLabel>Status</FieldLabel>
                    <Select value={form.status} onValueChange={(value) => setForm((current) => ({ ...current, status: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                ) : null}
                {fieldEnabled("issue_date") ? <Field><FieldLabel>Issue Date</FieldLabel><Input type="date" value={form.issue_date} onChange={(event) => setForm((current) => ({ ...current, issue_date: event.target.value }))} /></Field> : null}
                {fieldEnabled("expiry_date") ? <Field><FieldLabel>Expiry Date</FieldLabel><Input type="date" value={form.expiry_date} onChange={(event) => setForm((current) => ({ ...current, expiry_date: event.target.value }))} /></Field> : null}
                {fieldEnabled("currency") ? <Field><FieldLabel>Currency</FieldLabel><Input value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))} /></Field> : null}
                {fieldEnabled("total_amount") ? <Field><FieldLabel>Total</FieldLabel><Input type="number" step="0.01" value={form.total_amount} onChange={(event) => setForm((current) => ({ ...current, total_amount: event.target.value }))} /></Field> : null}
                {fieldEnabled("subtotal_amount") ? <Field><FieldLabel>Subtotal</FieldLabel><Input type="number" step="0.01" value={form.subtotal_amount} onChange={(event) => setForm((current) => ({ ...current, subtotal_amount: event.target.value }))} /></Field> : null}
                {fieldEnabled("discount_amount") ? <Field><FieldLabel>Discount</FieldLabel><Input type="number" step="0.01" value={form.discount_amount} onChange={(event) => setForm((current) => ({ ...current, discount_amount: event.target.value }))} /></Field> : null}
                {fieldEnabled("tax_amount") ? <Field><FieldLabel>Tax</FieldLabel><Input type="number" step="0.01" value={form.tax_amount} onChange={(event) => setForm((current) => ({ ...current, tax_amount: event.target.value }))} /></Field> : null}
              </FieldGroup>
              {fieldEnabled("notes") ? <div className="mt-4"><Field><FieldLabel>Notes</FieldLabel><Input value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></Field></div> : null}
              <div className="mt-4">
                <CustomFieldInputs definitions={customFieldsQuery.data ?? []} values={customFieldValues} onChange={(fieldKey, value) => setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))} />
              </div>
            </Card>

            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Summary</h2>
              <div className="mt-4 grid gap-3">
                <SummaryTile label="Customer" value={summary.quote.customer_name || "No customer recorded"} />
                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Deal</div>
                  <div className="mt-2 text-sm text-neutral-100">
                    {summary.opportunity ? (
                      <Link href={`/dashboard/sales/opportunities/${summary.opportunity.opportunity_id}`} className="hover:text-white">
                        {summary.opportunity.opportunity_name}
                      </Link>
                    ) : (
                      "No linked deal"
                    )}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <LinkedRecordTile label="Contact" value={summary.contact ? getContactLabel(summary.contact) : "No contact"} href={summary.quote.contact_id ? `/dashboard/sales/contacts/${summary.quote.contact_id}` : null} />
                  <LinkedRecordTile label="Account" value={summary.organization?.org_name || "No account"} href={summary.quote.organization_id ? `/dashboard/sales/organizations/${summary.quote.organization_id}` : null} />
                </div>
                <SummaryTile label="Status" value={(summary.quote.status || "draft").replace(/_/g, " ")} />
                <SummaryTile label="Total" value={formatMoney(summary.quote.total_amount, summary.quote.currency)} />
                <SummaryTile label="Expires" value={summary.quote.expiry_date ? formatDateOnly(summary.quote.expiry_date) : "No expiry date"} />
                {summary.related_order ? (
                  <LinkedRecordTile label="Order" value={summary.related_order.order_number} href={`/dashboard/sales/orders/${summary.related_order.id}`} />
                ) : null}
              </div>
            </Card>

            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Communication</h2>
              <p className="mt-1 text-sm text-neutral-500">Follow up on this quote through the linked contact.</p>
              <div className="mt-4">
                <CommunicationActions
                  email={summary.contact?.primary_email}
                  phone={summary.contact?.contact_telephone}
                  followUpTargetId="quote-record-tools"
                />
              </div>
            </Card>

            <Card className="px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-100">Proposal</h2>
                  <FieldDescription className="mt-1">Generate the quote proposal and track signed-link activity.</FieldDescription>
                </div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={handleGenerateProposal} disabled={proposalBusy !== null}>
                    {proposalBusy === "generate" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                    {proposalBusy === "generate" ? "Generating..." : "Generate"}
                  </Button>
                  <Button type="button" size="sm" onClick={handleSendProposal} disabled={proposalBusy !== null || !proposalSendingTo.trim()}>
                    {proposalBusy === "send" ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {proposalBusy === "send" ? "Sending..." : "Send"}
                  </Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                <Field>
                  <FieldLabel>Recipient</FieldLabel>
                  <Input type="email" value={proposalSendingTo} onChange={(event) => setProposalSendingTo(event.target.value)} placeholder="client@example.com" />
                </Field>
                <div className="grid gap-3 md:grid-cols-3">
                  <SummaryTile label="Status" value={(summary.latest_proposal?.status ?? "not generated").replace(/_/g, " ")} />
                  <SummaryTile label="Generated" value={summary.latest_proposal?.generated_at ? formatDateTime(summary.latest_proposal.generated_at) : "Not generated"} />
                  <SummaryTile label="Sent" value={summary.latest_proposal?.sent_at ? formatDateTime(summary.latest_proposal.sent_at) : "Not sent"} />
                </div>
                {proposalLinkPath ? (
                  <a className="inline-flex w-fit items-center gap-2 text-sm text-sky-300 hover:text-sky-200" href={proposalLinkPath} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />Open signed proposal link
                  </a>
                ) : null}
                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Lifecycle</div>
                  <div className="mt-3 grid gap-3">
                    {(summary.proposal_events ?? []).length ? (summary.proposal_events ?? []).map((event) => (
                      <div key={event.id} className="flex items-start justify-between gap-3 text-sm">
                        <div>
                          <div className="capitalize text-neutral-100">{event.event_type}</div>
                          <div className="text-xs text-neutral-500">{event.recipient_email || "Signed link"}</div>
                        </div>
                        <div className="shrink-0 text-xs text-neutral-500">{formatDateTime(event.occurred_at)}</div>
                      </div>
                    )) : <div className="text-sm text-neutral-500">No proposal events yet.</div>}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="px-5 py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-neutral-100">Order</h2>
                  <FieldDescription className="mt-1">Accepted quotes can be converted once into a sales order.</FieldDescription>
                </div>
                {summary.related_order ? (
                  <Button type="button" size="sm" variant="outline" asChild>
                    <Link href={`/dashboard/sales/orders/${summary.related_order.id}`}><ShoppingCart className="h-4 w-4" />Open Order</Link>
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={handleConvertToOrder} disabled={convertingOrder || summary.quote.status !== "accepted"}>
                    {convertingOrder ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                    {convertingOrder ? "Converting..." : "Convert"}
                  </Button>
                )}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <SummaryTile label="Status" value={summary.related_order?.status ?? (summary.quote.status === "accepted" ? "Ready" : "Requires accepted quote")} />
                <SummaryTile label="Order" value={summary.related_order?.order_number ?? "Not converted"} />
                <SummaryTile label="Total" value={summary.related_order ? formatMoney(summary.related_order.grand_total, summary.related_order.currency) : formatMoney(summary.quote.total_amount, summary.quote.currency)} />
              </div>
            </Card>
          </div>

          <div id="quote-record-tools" className="scroll-mt-6">
            <CrmRecordActivitySection
              moduleKey="sales_quotes"
              entityId={summary.quote.quote_id}
              recordLabel="Quote-level"
              taskSourceLabel={summary.quote.quote_number}
              followUp={{
                endpoint: `/sales/quotes/${summary.quote.quote_id}/follow-up`,
                email: summary.contact?.primary_email,
                phone: summary.contact?.contact_telephone,
                onLogged: () => {
                  void summaryQuery.refetch();
                },
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm capitalize text-neutral-100">{value}</div>
    </div>
  );
}

function LinkedRecordTile({ label, value, href }: { label: string; value: string; href: string | null }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-2 text-sm text-neutral-100">
        {href ? <Link href={href} className="hover:text-white">{value}</Link> : value}
      </div>
    </div>
  );
}
