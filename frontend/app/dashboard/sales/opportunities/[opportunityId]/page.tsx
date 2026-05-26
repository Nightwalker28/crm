"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { getOpportunityStageLabel, normalizeOpportunityStage, OPPORTUNITY_STAGE_ORDER } from "@/components/opportunities/opportunityStages";
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
import { Textarea } from "@/components/ui/textarea";
import { useCompanyCurrencies } from "@/hooks/useCompanyCurrencies";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { formatDateTime } from "@/lib/datetime";

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
    last_contacted_at?: string | null;
    last_contacted_channel?: string | null;
  };
  contact?: {
    contact_id: number;
    first_name?: string | null;
    last_name?: string | null;
    primary_email?: string | null;
    contact_telephone?: string | null;
    current_title?: string | null;
  } | null;
  organization?: {
    org_id: number;
    org_name: string;
    primary_email?: string | null;
    website?: string | null;
  } | null;
  related_quotes: Array<{
    quote_id: number;
    quote_number: string;
    title?: string | null;
    customer_name: string;
    status?: string | null;
    currency?: string | null;
    total_amount?: number | string | null;
    expiry_date?: string | null;
  }>;
  inferred_services: string[];
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

function formatMoney(value?: number | string | null, currency?: string | null) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || Number.isNaN(amount)) return "Unspecified";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);
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
  const customFieldsQuery = useModuleCustomFields("sales_opportunities", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_opportunities");
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);
  const currenciesQuery = useCompanyCurrencies(true);

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
      const payload = pickEnabledModulePayload({
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
      }, moduleFields, ["opportunity_name", "contact_id", "custom_fields"]);
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

  async function handleStageChange(salesStage: string) {
    try {
      setSaving(true);
      setError(null);
      const res = await apiFetch(`/sales/opportunities/${params.opportunityId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sales_stage: salesStage }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities-pipeline-summary"] }),
      ]);
      await loadSummary();
      toast.success(salesStage === "closed_won" || salesStage === "closed_lost" ? "Deal closed." : "Deal stage updated.");
    } catch (stageError) {
      setError(stageError instanceof Error ? stageError.message : "Failed to update deal stage");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/sales/opportunities"
        backLabel="Back to Deals"
        title={summary?.opportunity.opportunity_name || "Deal"}
        description="Manage the deal record, linked customer context, quotes, and activity from the record page."
        primaryAction={(
          <>
            <RecordDeleteButton
              endpoint={`/sales/opportunities/${params.opportunityId}`}
              label="Deal"
              recordName={summary?.opportunity.opportunity_name || "this deal"}
              redirectHref="/dashboard/sales/opportunities"
              queryKeys={["sales-opportunities", "sales-opportunities-pipeline-summary"]}
            />
            <Button onClick={handleSave} disabled={saving || !form.opportunity_name.trim() || !form.contact_id}>
              {saving ? "Saving..." : "Save Deal"}
            </Button>
          </>
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
                <h2 className="text-lg font-semibold text-neutral-100">Deal Details</h2>
                <p className="mt-1 text-sm text-neutral-500">Edit the pipeline record directly on the page.</p>
              </div>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                {fieldEnabled("opportunity_name") ? (
                <Field>
                  <FieldLabel>Deal Name</FieldLabel>
                  <Input value={form.opportunity_name} onChange={(event) => setForm((current) => ({ ...current, opportunity_name: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("contact_id") ? (
                <Field>
                  <FieldLabel>Client Contact</FieldLabel>
                  <LinkedRecordPicker
                    recordType="contact"
                    valueId={form.contact_id}
                    displayValue={contactSearch}
                    onDisplayValueChange={(value) => {
                      setContactSearch(value);
                      setForm((current) => ({
                        ...current,
                        contact_id: null,
                        organization_id: null,
                        client: value,
                      }));
                    }}
                    onSelect={(option) => {
                      setContactSearch(option.label);
                      setForm((current) => ({
                        ...current,
                        contact_id: option.id,
                        organization_id: option.organization_id ?? current.organization_id ?? null,
                        client: option.label,
                      }));
                    }}
                    onClear={() => {
                      setContactSearch("");
                      setForm((current) => ({ ...current, contact_id: null, organization_id: null, client: "" }));
                    }}
                    placeholder="Search existing contact"
                    queryKeyPrefix="opportunity-detail-contact"
                    noResultsText="No existing contacts matched this search."
                  />
                  <FieldDescription>Deals must stay linked to an existing sales contact.</FieldDescription>
                </Field>
                ) : null}
                {fieldEnabled("sales_stage") ? (
                <Field>
                  <FieldLabel>Sales Stage</FieldLabel>
                  <Select
                    value={normalizeOpportunityStage(form.sales_stage) || "lead"}
                    onValueChange={(value) => {
                      setForm((current) => ({ ...current, sales_stage: value }));
                      void handleStageChange(value);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select stage" />
                    </SelectTrigger>
                    <SelectContent>
                      {OPPORTUNITY_STAGE_ORDER.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {getOpportunityStageLabel(stage)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                ) : null}
                {fieldEnabled("expected_close_date") ? (
                <Field>
                  <FieldLabel>Expected Close Date</FieldLabel>
                  <Input type="date" value={form.expected_close_date} onChange={(event) => setForm((current) => ({ ...current, expected_close_date: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("total_cost_of_project") ? (
                <Field>
                  <FieldLabel>Total Project Cost</FieldLabel>
                  <Input value={form.total_cost_of_project} onChange={(event) => setForm((current) => ({ ...current, total_cost_of_project: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("currency_type") ? (
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
                ) : null}
                {fieldEnabled("campaign_type") ? (
                <Field>
                  <FieldLabel>Campaign Type</FieldLabel>
                  <Input value={form.campaign_type} onChange={(event) => setForm((current) => ({ ...current, campaign_type: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("target_geography") ? (
                <Field>
                  <FieldLabel>Target Geography</FieldLabel>
                  <Input value={form.target_geography} onChange={(event) => setForm((current) => ({ ...current, target_geography: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("target_audience") ? (
                <Field>
                  <FieldLabel>Target Audience</FieldLabel>
                  <Input value={form.target_audience} onChange={(event) => setForm((current) => ({ ...current, target_audience: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("delivery_format") ? (
                <Field>
                  <FieldLabel>Delivery Format</FieldLabel>
                  <Input value={form.delivery_format} onChange={(event) => setForm((current) => ({ ...current, delivery_format: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("tactics") ? (
                <Field className="md:col-span-2">
                  <FieldLabel>Tactics</FieldLabel>
                  <Textarea rows={3} value={form.tactics} onChange={(event) => setForm((current) => ({ ...current, tactics: event.target.value }))} />
                </Field>
                ) : null}
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
                <p className="mt-1 text-sm text-neutral-500">Linked customer context and current pipeline state.</p>
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
                  {summary.contact ? (
                    <div className="mt-3">
                      <CommunicationActions
                        email={summary.contact.primary_email}
                        phone={summary.contact.contact_telephone}
                        followUpTargetId="opportunity-record-tools"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Account</div>
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
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Quotes</div>
                    <div className="mt-2 text-2xl font-semibold text-neutral-100">{summary.related_quotes.length}</div>
                  </div>
                </div>

                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Stage</div>
                      <div className="mt-2 text-sm text-neutral-100">
                        {getOpportunityStageLabel(summary.opportunity.sales_stage)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleStageChange("closed_won")}
                        disabled={saving || summary.opportunity.sales_stage === "closed_won"}
                        className="border-emerald-800/60 bg-emerald-950/20 text-emerald-300 hover:bg-emerald-950/40 hover:text-emerald-200"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Won
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void handleStageChange("closed_lost")}
                        disabled={saving || summary.opportunity.sales_stage === "closed_lost"}
                        className="border-red-800/60 bg-red-950/20 text-red-300 hover:bg-red-950/40 hover:text-red-200"
                      >
                        <XCircle className="h-4 w-4" />
                        Lost
                      </Button>
                    </div>
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

          <div className="grid gap-4">
            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Related Quotes</h2>
              <FieldDescription className="mt-1">
                Quotes explicitly linked to this deal.
              </FieldDescription>
              <div className="mt-4 space-y-3">
                {summary.related_quotes.length ? summary.related_quotes.map((quote) => (
                  <Link key={quote.quote_id} href={`/dashboard/sales/quotes/${quote.quote_id}`} className="block rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4 hover:border-neutral-700">
                    <div className="text-sm font-semibold text-neutral-100">{quote.quote_number}</div>
                    <div className="mt-1 text-sm text-neutral-500">{quote.title || quote.customer_name} · {quote.status || "Unknown status"}</div>
                    <div className="mt-2 text-sm text-neutral-300">{formatMoney(quote.total_amount, quote.currency)}</div>
                  </Link>
                )) : <div className="text-sm text-neutral-500">No quotes are linked to this deal yet.</div>}
              </div>
            </Card>
          </div>

          <div id="opportunity-record-tools" className="scroll-mt-6">
            <CrmRecordActivitySection
              moduleKey="sales_opportunities"
              entityId={summary.opportunity.opportunity_id}
              recordLabel="Deal-level"
              taskSourceLabel={summary.opportunity.opportunity_name}
              followUp={{
                endpoint: `/sales/opportunities/${summary.opportunity.opportunity_id}/follow-up`,
                lastContactedAt: summary.opportunity.last_contacted_at,
                lastContactedChannel: summary.opportunity.last_contacted_channel,
                email: summary.contact?.primary_email,
                phone: summary.contact?.contact_telephone,
                onLogged: () => loadSummary(),
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
