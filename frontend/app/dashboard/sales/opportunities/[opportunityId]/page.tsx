"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

type ContactOption = {
  contact_id: number;
  first_name?: string | null;
  last_name?: string | null;
  primary_email?: string | null;
  organization_id?: number | null;
  organization_name?: string | null;
};

type OpportunitySummary = {
  opportunity: {
    opportunity_id: number;
    opportunity_name: string;
    client?: string | null;
    sales_stage?: string | null;
    contact_id?: number | null;
    organization_id?: number | null;
    assigned_to?: number | null;
    start_date?: string | null;
    expected_close_date?: string | null;
    campaign_type?: string | null;
    total_leads?: string | null;
    cpl?: string | null;
    total_cost_of_project?: string | null;
    currency_type?: string | null;
    target_geography?: string | null;
    target_audience?: string | null;
    domain_cap?: string | null;
    tactics?: string | null;
    delivery_format?: string | null;
    attachments?: string[] | null;
    custom_fields?: Record<string, unknown> | null;
    created_time?: string | null;
  };
  contact?: {
    contact_id: number;
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
    current_title?: string | null;
  } | null;
  organization?: {
    org_id: number;
    org_name: string;
    primary_email?: string | null;
    website?: string | null;
  } | null;
  related_insertion_orders: Array<{
    id: number;
    io_number: string;
    customer_name?: string | null;
    status?: string | null;
    total_amount?: number | null;
    currency?: string | null;
    updated_at?: string | null;
  }>;
  inferred_services: string[];
  insertion_order_count: number;
};

type OpportunityForm = {
  opportunity_name: string;
  client: string;
  sales_stage: string;
  contact_id: number | null;
  organization_id: number | null;
  assigned_to: number | null;
  start_date: string;
  expected_close_date: string;
  campaign_type: string;
  total_leads: string;
  cpl: string;
  total_cost_of_project: string;
  currency_type: string;
  target_geography: string;
  target_audience: string;
  domain_cap: string;
  tactics: string;
  delivery_format: string;
  attachments: string[];
  custom_fields: Record<string, unknown>;
};

const emptyForm: OpportunityForm = {
  opportunity_name: "",
  client: "",
  sales_stage: "",
  contact_id: null,
  organization_id: null,
  assigned_to: null,
  start_date: "",
  expected_close_date: "",
  campaign_type: "",
  total_leads: "",
  cpl: "",
  total_cost_of_project: "",
  currency_type: "USD",
  target_geography: "",
  target_audience: "",
  domain_cap: "",
  tactics: "",
  delivery_format: "",
  attachments: [],
  custom_fields: {},
};

async function fetchContactOptions(search: string): Promise<ContactOption[]> {
  const params = new URLSearchParams({
    page: "1",
    page_size: "10",
    query: search,
  });

  const res = await apiFetch(`/sales/contacts/search?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }

  const body = await res.json().catch(() => ({ results: [] }));
  return Array.isArray(body?.results) ? body.results : [];
}

function getContactDisplay(option: ContactOption): string {
  return `${option.first_name ?? ""} ${option.last_name ?? ""}`.trim() || option.primary_email || "Unnamed contact";
}

function formatMoney(value?: number | null, currency?: string | null) {
  if (typeof value !== "number") return "Unspecified";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function OpportunityDetailPage() {
  const params = useParams<{ opportunityId: string }>();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<OpportunitySummary | null>(null);
  const [form, setForm] = useState<OpportunityForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contactSearch, setContactSearch] = useState("");
  const [isContactDropdownOpen, setIsContactDropdownOpen] = useState(false);
  const deferredContactSearch = useDeferredValue(contactSearch.trim());
  const customFieldsQuery = useModuleCustomFields("sales_opportunities", true);
  const currenciesQuery = useCompanyCurrencies(true);
  const contactQuery = useQuery({
    queryKey: ["opportunity-detail-contact-options", deferredContactSearch],
    queryFn: () => fetchContactOptions(deferredContactSearch),
    enabled: deferredContactSearch.length > 0,
    staleTime: 30_000,
  });

  async function loadSummary(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/sales/opportunities/${params.opportunityId}/summary`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (signal?.cancelled) return;
      const data = body as OpportunitySummary;
      setSummary(data);
      setForm({
        opportunity_name: data.opportunity.opportunity_name ?? "",
        client: data.opportunity.client ?? "",
        sales_stage: data.opportunity.sales_stage ?? "",
        contact_id: data.opportunity.contact_id ?? null,
        organization_id: data.opportunity.organization_id ?? null,
        assigned_to: data.opportunity.assigned_to ?? null,
        start_date: data.opportunity.start_date ?? "",
        expected_close_date: data.opportunity.expected_close_date ?? "",
        campaign_type: data.opportunity.campaign_type ?? "",
        total_leads: data.opportunity.total_leads ?? "",
        cpl: data.opportunity.cpl ?? "",
        total_cost_of_project: data.opportunity.total_cost_of_project ?? "",
        currency_type: data.opportunity.currency_type ?? "USD",
        target_geography: data.opportunity.target_geography ?? "",
        target_audience: data.opportunity.target_audience ?? "",
        domain_cap: data.opportunity.domain_cap ?? "",
        tactics: data.opportunity.tactics ?? "",
        delivery_format: data.opportunity.delivery_format ?? "",
        attachments: data.opportunity.attachments ?? [],
        custom_fields: data.opportunity.custom_fields ?? {},
      });
      setContactSearch(data.opportunity.client ?? "");
    } catch (loadError) {
      if (!signal?.cancelled) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load opportunity");
      }
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
  }, [params.opportunityId]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const payload = {
        opportunity_name: form.opportunity_name.trim(),
        client: form.client.trim() || null,
        sales_stage: form.sales_stage.trim() || null,
        contact_id: form.contact_id,
        organization_id: form.organization_id,
        assigned_to: form.assigned_to,
        start_date: form.start_date || null,
        expected_close_date: form.expected_close_date || null,
        campaign_type: form.campaign_type.trim() || null,
        total_leads: form.total_leads.trim() || null,
        cpl: form.cpl.trim() || null,
        total_cost_of_project: form.total_cost_of_project.trim() || null,
        currency_type: form.currency_type || null,
        target_geography: form.target_geography.trim() || null,
        target_audience: form.target_audience.trim() || null,
        domain_cap: form.domain_cap.trim() || null,
        tactics: form.tactics.trim() || null,
        delivery_format: form.delivery_format.trim() || null,
        attachments: form.attachments,
        custom_fields: form.custom_fields,
      };
      const res = await apiFetch(`/sales/opportunities/${params.opportunityId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities-pipeline-summary"] }),
      ]);
      await loadSummary();
      toast.success("Opportunity updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save opportunity");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/sales/opportunities"
        backLabel="Back to Opportunities"
        title={summary?.opportunity.opportunity_name || "Opportunity"}
        description="Manage the opportunity record, linked customer context, and finance handoff from the record page."
        primaryAction={(
          <Button onClick={handleSave} disabled={saving || !form.opportunity_name.trim() || !form.contact_id}>
            {saving ? "Saving..." : "Save Opportunity"}
          </Button>
        )}
      />

      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading || !summary ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading opportunity…</Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="px-5 py-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-neutral-100">Opportunity Details</h2>
                <p className="mt-1 text-sm text-neutral-500">Edit the pipeline record directly on the page.</p>
              </div>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Opportunity Name</FieldLabel>
                  <Input value={form.opportunity_name} onChange={(event) => setForm((current) => ({ ...current, opportunity_name: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Client Contact</FieldLabel>
                  <div className="relative">
                    <Input
                      value={contactSearch}
                      onFocus={() => setIsContactDropdownOpen(true)}
                      onBlur={() => window.setTimeout(() => setIsContactDropdownOpen(false), 120)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setContactSearch(value);
                        setForm((current) => ({
                          ...current,
                          contact_id: null,
                          organization_id: null,
                          client: value,
                        }));
                      }}
                      placeholder="Search existing contact"
                    />
                    {isContactDropdownOpen && deferredContactSearch ? (
                      <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-20 rounded-md border border-neutral-800 bg-neutral-950 shadow-2xl">
                        {contactQuery.isLoading ? (
                          <div className="px-3 py-2 text-sm text-neutral-500">Searching contacts…</div>
                        ) : contactQuery.error ? (
                          <div className="px-3 py-2 text-sm text-red-300">
                            {contactQuery.error instanceof Error ? contactQuery.error.message : "Failed to search contacts."}
                          </div>
                        ) : (contactQuery.data ?? []).length ? (
                          <div className="max-h-56 overflow-y-auto py-1">
                            {(contactQuery.data ?? []).map((option) => (
                              <button
                                key={option.contact_id}
                                type="button"
                                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-neutral-900"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => {
                                  const display = getContactDisplay(option);
                                  setContactSearch(display);
                                  setForm((current) => ({
                                    ...current,
                                    contact_id: option.contact_id,
                                    organization_id: option.organization_id ?? current.organization_id ?? null,
                                    client: display,
                                  }));
                                  setIsContactDropdownOpen(false);
                                }}
                              >
                                <span className="text-sm text-neutral-100">{getContactDisplay(option)}</span>
                                <span className="text-xs text-neutral-500">
                                  {option.organization_name || option.primary_email || "Existing contact"}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="px-3 py-2 text-sm text-neutral-500">No existing contacts matched this search.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <FieldDescription>Opportunities must stay linked to an existing sales contact.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Sales Stage</FieldLabel>
                  <Input value={form.sales_stage} onChange={(event) => setForm((current) => ({ ...current, sales_stage: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Expected Close Date</FieldLabel>
                  <Input type="date" value={form.expected_close_date} onChange={(event) => setForm((current) => ({ ...current, expected_close_date: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Total Project Cost</FieldLabel>
                  <Input value={form.total_cost_of_project} onChange={(event) => setForm((current) => ({ ...current, total_cost_of_project: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Currency</FieldLabel>
                  <Select
                    value={form.currency_type || "USD"}
                    onValueChange={(value) => setForm((current) => ({ ...current, currency_type: value }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select currency" />
                    </SelectTrigger>
                    <SelectContent>
                      {(currenciesQuery.data ?? ["USD"]).map((currency) => (
                        <SelectItem key={currency} value={currency}>
                          {currency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>Campaign Type</FieldLabel>
                  <Input value={form.campaign_type} onChange={(event) => setForm((current) => ({ ...current, campaign_type: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Target Geography</FieldLabel>
                  <Input value={form.target_geography} onChange={(event) => setForm((current) => ({ ...current, target_geography: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Target Audience</FieldLabel>
                  <Input value={form.target_audience} onChange={(event) => setForm((current) => ({ ...current, target_audience: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Delivery Format</FieldLabel>
                  <Input value={form.delivery_format} onChange={(event) => setForm((current) => ({ ...current, delivery_format: event.target.value }))} />
                </Field>
                <Field className="md:col-span-2">
                  <FieldLabel>Tactics</FieldLabel>
                  <Textarea rows={3} value={form.tactics} onChange={(event) => setForm((current) => ({ ...current, tactics: event.target.value }))} />
                </Field>
              </FieldGroup>

              <div className="mt-4">
                <CustomFieldInputs
                  definitions={customFieldsQuery.data ?? []}
                  values={form.custom_fields}
                  onChange={(fieldKey, value) =>
                    setForm((current) => ({
                      ...current,
                      custom_fields: { ...current.custom_fields, [fieldKey]: value },
                    }))
                  }
                />
              </div>
            </Card>

            <Card className="px-5 py-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-neutral-100">Summary</h2>
                <p className="mt-1 text-sm text-neutral-500">Linked record context and finance readiness.</p>
              </div>
              <div className="grid gap-3">
                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Contact</div>
                  <div className="mt-2 text-sm text-neutral-100">
                    {summary.contact ? (
                      <Link href={`/dashboard/sales/contacts/${summary.contact.contact_id}`} className="hover:text-white">
                        {[summary.contact.first_name, summary.contact.last_name].filter(Boolean).join(" ").trim() || summary.contact.primary_email || "Unnamed contact"}
                      </Link>
                    ) : "No linked contact"}
                  </div>
                  {summary.contact?.current_title ? <div className="mt-1 text-sm text-neutral-500">{summary.contact.current_title}</div> : null}
                </div>

                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Organization</div>
                  <div className="mt-2 text-sm text-neutral-100">
                    {summary.organization ? (
                      <Link href={`/dashboard/sales/organizations/${summary.organization.org_id}`} className="hover:text-white">
                        {summary.organization.org_name}
                      </Link>
                    ) : "No linked organization"}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Created</div>
                    <div className="mt-2 text-sm text-neutral-100">
                      {summary.opportunity.created_time ? formatDateTime(summary.opportunity.created_time) : "Unknown"}
                    </div>
                  </div>
                  <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Insertion Orders</div>
                    <div className="mt-2 text-2xl font-semibold text-neutral-100">{summary.insertion_order_count}</div>
                  </div>
                </div>

                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Inferred Services</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {summary.inferred_services.length ? summary.inferred_services.map((item) => (
                      <span key={item} className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300">
                        {item}
                      </span>
                    )) : <span className="text-sm text-neutral-500">No service details recorded yet</span>}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Finance Handoff</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Current commercial values and dates that will shape insertion-order creation.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Expected Close</div>
                  <div className="mt-2 text-sm text-neutral-100">
                    {summary.opportunity.expected_close_date ? formatDateOnly(summary.opportunity.expected_close_date) : "Not set"}
                  </div>
                </div>
                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Commercial Value</div>
                  <div className="mt-2 text-sm text-neutral-100">
                    {summary.opportunity.total_cost_of_project || "No value recorded"}{summary.opportunity.currency_type ? ` ${summary.opportunity.currency_type}` : ""}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Related Insertion Orders</h2>
              <FieldDescription className="mt-1">
                Matched through the linked contact and organization so finance handoff context stays visible on the record.
              </FieldDescription>
              <div className="mt-4 space-y-3">
                {summary.related_insertion_orders.length ? summary.related_insertion_orders.map((order) => (
                  <div key={order.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-sm font-semibold text-neutral-100">{order.io_number}</div>
                    <div className="mt-1 text-sm text-neutral-500">
                      {order.customer_name || "Unknown customer"} · {order.status || "Unknown status"}
                    </div>
                    <div className="mt-2 text-sm text-neutral-300">{formatMoney(order.total_amount, order.currency)}</div>
                    {order.updated_at ? <div className="mt-2 text-xs text-neutral-500">Updated {formatDateTime(order.updated_at)}</div> : null}
                  </div>
                )) : <div className="text-sm text-neutral-500">No related insertion orders yet.</div>}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RecordDocumentsPanel
              moduleKey="sales_opportunities"
              entityId={summary.opportunity.opportunity_id}
            />
            <RecordActivityTimeline
              moduleKey="sales_opportunities"
              entityId={summary.opportunity.opportunity_id}
              description="Opportunity-level create, update, delete, restore, and note history."
            />
            <RecordCommentsPanel
              moduleKey="sales_opportunities"
              entityId={summary.opportunity.opportunity_id}
            />
          </div>
        </>
      )}
    </div>
  );
}
