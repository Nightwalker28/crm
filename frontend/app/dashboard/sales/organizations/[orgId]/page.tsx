"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type RelatedContact = {
  contact_id: number;
  first_name?: string | null;
  last_name?: string | null;
  primary_email: string;
  current_title?: string | null;
};

type RelatedOpportunity = {
  opportunity_id: number;
  opportunity_name: string;
  sales_stage?: string | null;
  expected_close_date?: string | null;
  total_cost_of_project?: string | null;
  currency_type?: string | null;
};

type RelatedInsertionOrder = {
  id: number;
  io_number: string;
  customer_name?: string | null;
  status?: string | null;
  total_amount?: number | null;
  currency?: string | null;
};

type OrganizationSummary = {
  organization: {
    org_id: number;
    org_name: string;
    primary_email?: string | null;
    secondary_email?: string | null;
    website?: string | null;
    primary_phone?: string | null;
    secondary_phone?: string | null;
    industry?: string | null;
    annual_revenue?: string | null;
    billing_address?: string | null;
    billing_city?: string | null;
    billing_state?: string | null;
    billing_postal_code?: string | null;
    billing_country?: string | null;
    custom_fields?: Record<string, unknown> | null;
  };
  related_contacts: RelatedContact[];
  related_opportunities: RelatedOpportunity[];
  related_insertion_orders: RelatedInsertionOrder[];
  inferred_services: string[];
  contact_count: number;
  opportunity_count: number;
  insertion_order_count: number;
};

type OrganizationForm = {
  org_name: string;
  primary_email: string;
  secondary_email: string;
  website: string;
  primary_phone: string;
  secondary_phone: string;
  industry: string;
  annual_revenue: string;
  billing_address: string;
  billing_city: string;
  billing_state: string;
  billing_postal_code: string;
  billing_country: string;
};

const emptyForm: OrganizationForm = {
  org_name: "",
  primary_email: "",
  secondary_email: "",
  website: "",
  primary_phone: "",
  secondary_phone: "",
  industry: "",
  annual_revenue: "",
  billing_address: "",
  billing_city: "",
  billing_state: "",
  billing_postal_code: "",
  billing_country: "",
};

function formatMoney(value?: number | null, currency?: string | null) {
  if (typeof value !== "number") return "Unspecified";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function OrganizationDetailPage() {
  const params = useParams<{ orgId: string }>();
  const [summary, setSummary] = useState<OrganizationSummary | null>(null);
  const [form, setForm] = useState<OrganizationForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const customFieldsQuery = useModuleCustomFields("sales_organizations", true);

  async function loadSummary(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/sales/organizations/${params.orgId}/summary`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (signal?.cancelled) return;
      const data = body as OrganizationSummary;
      setSummary(data);
      setForm({
        org_name: data.organization.org_name ?? "",
        primary_email: data.organization.primary_email ?? "",
        secondary_email: data.organization.secondary_email ?? "",
        website: data.organization.website ?? "",
        primary_phone: data.organization.primary_phone ?? "",
        secondary_phone: data.organization.secondary_phone ?? "",
        industry: data.organization.industry ?? "",
        annual_revenue: data.organization.annual_revenue ?? "",
        billing_address: data.organization.billing_address ?? "",
        billing_city: data.organization.billing_city ?? "",
        billing_state: data.organization.billing_state ?? "",
        billing_postal_code: data.organization.billing_postal_code ?? "",
        billing_country: data.organization.billing_country ?? "",
      });
      setCustomFieldValues(data.organization.custom_fields ?? {});
    } catch (loadError) {
      if (!signal?.cancelled) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load organization");
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
  }, [params.orgId]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, value.trim() || null]),
      );
      const requestPayload = {
        ...payload,
        custom_fields: customFieldValues,
      };
      const res = await apiFetch(`/sales/organizations/${params.orgId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await loadSummary();
      toast.success("Organization updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save organization");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/dashboard/sales/organizations" className="text-xs uppercase tracking-wide text-neutral-500 hover:text-neutral-300">
            Back to Organizations
          </Link>
          <h1 className="mt-2 text-2xl font-semibold leading-none">{summary?.organization.org_name || "Organization"}</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Review linked contacts, deals, insertion orders, and edit the organization record directly on the page.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving || !form.org_name.trim()}>
          {saving ? "Saving..." : "Save Organization"}
        </Button>
      </div>

      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading || !summary ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading organization…</Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="px-5 py-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-neutral-100">Organization Details</h2>
                <p className="mt-1 text-sm text-neutral-500">Primary commercial and billing information.</p>
              </div>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Name</FieldLabel>
                  <Input value={form.org_name} onChange={(event) => setForm((current) => ({ ...current, org_name: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Primary Email</FieldLabel>
                  <Input type="email" value={form.primary_email} onChange={(event) => setForm((current) => ({ ...current, primary_email: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Secondary Email</FieldLabel>
                  <Input type="email" value={form.secondary_email} onChange={(event) => setForm((current) => ({ ...current, secondary_email: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Website</FieldLabel>
                  <Input value={form.website} onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Primary Phone</FieldLabel>
                  <Input value={form.primary_phone} onChange={(event) => setForm((current) => ({ ...current, primary_phone: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Secondary Phone</FieldLabel>
                  <Input value={form.secondary_phone} onChange={(event) => setForm((current) => ({ ...current, secondary_phone: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Industry</FieldLabel>
                  <Input value={form.industry} onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Annual Revenue</FieldLabel>
                  <Input value={form.annual_revenue} onChange={(event) => setForm((current) => ({ ...current, annual_revenue: event.target.value }))} />
                </Field>
                <Field className="md:col-span-2">
                  <FieldLabel>Billing Address</FieldLabel>
                  <Textarea value={form.billing_address} onChange={(event) => setForm((current) => ({ ...current, billing_address: event.target.value }))} rows={3} />
                </Field>
                <Field>
                  <FieldLabel>Billing City</FieldLabel>
                  <Input value={form.billing_city} onChange={(event) => setForm((current) => ({ ...current, billing_city: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Billing State</FieldLabel>
                  <Input value={form.billing_state} onChange={(event) => setForm((current) => ({ ...current, billing_state: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Billing Postal Code</FieldLabel>
                  <Input value={form.billing_postal_code} onChange={(event) => setForm((current) => ({ ...current, billing_postal_code: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Billing Country</FieldLabel>
                  <Input value={form.billing_country} onChange={(event) => setForm((current) => ({ ...current, billing_country: event.target.value }))} />
                </Field>
              </FieldGroup>

              <div className="mt-4">
                <CustomFieldInputs
                  definitions={customFieldsQuery.data ?? []}
                  values={customFieldValues}
                  onChange={(fieldKey, value) =>
                    setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }))
                  }
                />
              </div>
            </Card>

            <Card className="px-5 py-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-neutral-100">Summary</h2>
                <p className="mt-1 text-sm text-neutral-500">Cross-module context for this organization.</p>
              </div>
              <div className="grid gap-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Contacts</div>
                    <div className="mt-2 text-2xl font-semibold text-neutral-100">{summary.contact_count}</div>
                  </div>
                  <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Deals</div>
                    <div className="mt-2 text-2xl font-semibold text-neutral-100">{summary.opportunity_count}</div>
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
                    )) : <span className="text-sm text-neutral-500">No service history yet</span>}
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Contacts</h2>
              <div className="mt-4 space-y-3">
                {summary.related_contacts.length ? summary.related_contacts.map((contact) => (
                  <Link key={contact.contact_id} href={`/dashboard/sales/contacts/${contact.contact_id}`} className="block rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4 hover:border-neutral-700">
                    <div className="text-sm font-semibold text-neutral-100">{`${contact.first_name || ""} ${contact.last_name || ""}`.trim() || contact.primary_email}</div>
                    <div className="mt-1 text-sm text-neutral-500">{contact.current_title || "No title"} · {contact.primary_email}</div>
                  </Link>
                )) : <div className="text-sm text-neutral-500">No linked contacts.</div>}
              </div>
            </Card>

            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Opportunities</h2>
              <div className="mt-4 space-y-3">
                {summary.related_opportunities.length ? summary.related_opportunities.map((opportunity) => (
                  <div key={opportunity.opportunity_id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-sm font-semibold text-neutral-100">{opportunity.opportunity_name}</div>
                    <div className="mt-1 text-sm text-neutral-500">{opportunity.sales_stage || "Unstaged"}</div>
                    <div className="mt-2 text-sm text-neutral-300">{opportunity.total_cost_of_project || "No value recorded"}{opportunity.currency_type ? ` ${opportunity.currency_type}` : ""}</div>
                  </div>
                )) : <div className="text-sm text-neutral-500">No linked opportunities.</div>}
              </div>
            </Card>

            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Insertion Orders</h2>
              <FieldDescription className="mt-1">Matched by organization name against the finance customer fields.</FieldDescription>
              <div className="mt-4 space-y-3">
                {summary.related_insertion_orders.length ? summary.related_insertion_orders.map((order) => (
                  <div key={order.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-sm font-semibold text-neutral-100">{order.io_number}</div>
                    <div className="mt-1 text-sm text-neutral-500">{order.status || "Unknown status"}</div>
                    <div className="mt-2 text-sm text-neutral-300">{formatMoney(order.total_amount, order.currency)}</div>
                  </div>
                )) : <div className="text-sm text-neutral-500">No linked insertion orders.</div>}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
