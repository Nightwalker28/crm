"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FileText, StickyNote, CheckSquare } from "lucide-react";
import { toast } from "sonner";

import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { apiFetch } from "@/lib/api";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

type QuoteSummary = {
  quote: {
    quote_id: number;
    quote_number: string;
    title?: string | null;
    customer_name: string;
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
};

type QuoteForm = {
  quote_number: string;
  title: string;
  customer_name: string;
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

function asInputValue(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

function formatMoney(value: string | number | null | undefined, currency: string | null | undefined) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(amount);
}

export default function QuoteDetailPage() {
  const params = useParams<{ quoteId: string }>();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<QuoteSummary | null>(null);
  const [form, setForm] = useState<QuoteForm>(emptyForm);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const customFieldsQuery = useModuleCustomFields("sales_quotes", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_quotes");
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);

  async function loadSummary(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/sales/quotes/${params.quoteId}/summary`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (signal?.cancelled) return;
      const data = body as QuoteSummary;
      setSummary(data);
      setForm({
        quote_number: data.quote.quote_number ?? "",
        title: data.quote.title ?? "",
        customer_name: data.quote.customer_name ?? "",
        status: data.quote.status ?? "draft",
        issue_date: data.quote.issue_date ?? "",
        expiry_date: data.quote.expiry_date ?? "",
        currency: data.quote.currency ?? "USD",
        subtotal_amount: asInputValue(data.quote.subtotal_amount),
        discount_amount: asInputValue(data.quote.discount_amount),
        tax_amount: asInputValue(data.quote.tax_amount),
        total_amount: asInputValue(data.quote.total_amount),
        notes: data.quote.notes ?? "",
      });
      setCustomFieldValues(data.quote.custom_fields ?? {});
    } catch (loadError) {
      if (!signal?.cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load quote");
    } finally {
      if (!signal?.cancelled) setLoading(false);
    }
  }

  useEffect(() => {
    const signal = { cancelled: false };
    void loadSummary(signal);
    return () => {
      signal.cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.quoteId]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const payload = pickEnabledModulePayload({
        quote_number: form.quote_number.trim(),
        title: form.title.trim() || null,
        customer_name: form.customer_name.trim(),
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
      }, moduleFields, ["quote_number", "customer_name", "custom_fields"]);
      const res = await apiFetch(`/sales/quotes/${params.quoteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-quotes"] }),
        queryClient.refetchQueries({ queryKey: ["sales-quotes"], type: "all" }),
      ]);
      await loadSummary();
      toast.success("Quote updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save quote");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/sales/quotes"
        backLabel="Back to Quotes"
        title={summary ? summary.quote.quote_number || "Quote" : "Quote"}
        description="Review quote value, customer status, and record history."
        primaryAction={<Button onClick={handleSave} disabled={saving || !form.customer_name.trim() || !form.quote_number.trim()}>{saving ? "Saving..." : "Save Quote"}</Button>}
      />

      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading || !summary ? (
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
                {fieldEnabled("quote_number") ? <Field><FieldLabel>Quote Number</FieldLabel><Input value={form.quote_number} onChange={(event) => setForm((current) => ({ ...current, quote_number: event.target.value }))} /></Field> : null}
                {fieldEnabled("customer_name") ? <Field><FieldLabel>Customer</FieldLabel><Input value={form.customer_name} onChange={(event) => setForm((current) => ({ ...current, customer_name: event.target.value }))} /></Field> : null}
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
                <SummaryTile label="Status" value={(summary.quote.status || "draft").replace(/_/g, " ")} />
                <SummaryTile label="Total" value={formatMoney(summary.quote.total_amount, summary.quote.currency)} />
                <SummaryTile label="Expires" value={summary.quote.expiry_date ? formatDateOnly(summary.quote.expiry_date) : "No expiry date"} />
              </div>
            </Card>
          </div>

          <div id="quote-record-tools" className="scroll-mt-6">
            <RecordTabs
              tabs={[
                { id: "activity", label: "Activity", content: <RecordActivityTimeline moduleKey="sales_quotes" entityId={summary.quote.quote_id} description="Quote-level create, update, delete, restore, and note history." /> },
                { id: "notes", label: "Notes", content: <RecordCommentsPanel moduleKey="sales_quotes" entityId={summary.quote.quote_id} /> },
                { id: "documents", label: "Documents", content: <RecordDocumentsPanel moduleKey="sales_quotes" entityId={summary.quote.quote_id} /> },
                { id: "tasks", label: "Tasks", content: <RecordTasksPanel moduleKey="sales_quotes" entityId={summary.quote.quote_id} /> },
              ]}
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
