"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import FollowUpPanel from "@/components/recordActivity/FollowUpPanel";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/datetime";

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
  updated_at?: string | null;
};

type OrganizationCompact = {
  org_id: number;
  org_name: string;
  primary_email?: string | null;
  website?: string | null;
};

type ContactSummary = {
  contact: {
    contact_id: number;
    first_name?: string | null;
    last_name?: string | null;
    contact_telephone?: string | null;
    linkedin_url?: string | null;
    primary_email: string;
    current_title?: string | null;
    region?: string | null;
    country?: string | null;
    organization_id?: number | null;
    last_contacted_at?: string | null;
    last_contacted_channel?: string | null;
    whatsapp_last_contacted_at?: string | null;
    custom_fields?: Record<string, unknown> | null;
  };
  organization?: OrganizationCompact | null;
  related_opportunities: RelatedOpportunity[];
  related_insertion_orders: RelatedInsertionOrder[];
  inferred_services: string[];
  opportunity_count: number;
  insertion_order_count: number;
};

type MessageTemplate = {
  id: number;
  name: string;
  body: string;
  variables: string[];
};

type ContactForm = {
  first_name: string;
  last_name: string;
  primary_email: string;
  contact_telephone: string;
  linkedin_url: string;
  current_title: string;
  region: string;
  country: string;
};

const emptyForm: ContactForm = {
  first_name: "",
  last_name: "",
  primary_email: "",
  contact_telephone: "",
  linkedin_url: "",
  current_title: "",
  region: "",
  country: "",
};

function formatMoney(value?: number | null, currency?: string | null) {
  if (typeof value !== "number") return "Unspecified";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

export default function ContactDetailPage() {
  const params = useParams<{ contactId: string }>();
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState<ContactSummary | null>(null);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [whatsAppSending, setWhatsAppSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [whatsAppTemplates, setWhatsAppTemplates] = useState<MessageTemplate[]>([]);
  const [selectedWhatsAppTemplateId, setSelectedWhatsAppTemplateId] = useState<string>("");
  const [createWhatsAppReminder, setCreateWhatsAppReminder] = useState(true);
  const [whatsAppReminderDueAt, setWhatsAppReminderDueAt] = useState("");
  const customFieldsQuery = useModuleCustomFields("sales_contacts", true);

  async function loadSummary(signal?: { cancelled: boolean }) {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/sales/contacts/${params.contactId}/summary`);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (signal?.cancelled) return;
      const data = body as ContactSummary;
      setSummary(data);
      setForm({
        first_name: data.contact.first_name ?? "",
        last_name: data.contact.last_name ?? "",
        primary_email: data.contact.primary_email ?? "",
        contact_telephone: data.contact.contact_telephone ?? "",
        linkedin_url: data.contact.linkedin_url ?? "",
        current_title: data.contact.current_title ?? "",
        region: data.contact.region ?? "",
        country: data.contact.country ?? "",
      });
      setCustomFieldValues(data.contact.custom_fields ?? {});
    } catch (loadError) {
      if (!signal?.cancelled) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load contact");
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
  }, [params.contactId]);

  useEffect(() => {
    let cancelled = false;
    async function loadWhatsAppTemplates() {
      try {
        const res = await apiFetch("/message-templates?channel=whatsapp&module_key=sales_contacts");
        const body = await res.json().catch(() => null);
        if (!res.ok) return;
        if (cancelled) return;
        const templates = (body?.results ?? []) as MessageTemplate[];
        setWhatsAppTemplates(templates);
        setSelectedWhatsAppTemplateId((current) => current || (templates[0]?.id ? String(templates[0].id) : ""));
      } catch {
        if (!cancelled) setWhatsAppTemplates([]);
      }
    }
    void loadWhatsAppTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const payload = {
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        primary_email: form.primary_email.trim(),
        contact_telephone: form.contact_telephone.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        current_title: form.current_title.trim() || null,
        region: form.region.trim() || null,
        country: form.country.trim() || null,
        organization_id: summary?.organization?.org_id ?? summary?.contact.organization_id ?? null,
        custom_fields: customFieldValues,
      };
      const res = await apiFetch(`/sales/contacts/${params.contactId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-contacts"] }),
        queryClient.refetchQueries({ queryKey: ["sales-contacts"], type: "all" }),
      ]);
      await loadSummary();
      toast.success("Contact updated.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save contact");
    } finally {
      setSaving(false);
    }
  }

  async function handleWhatsAppClick() {
    if (!summary?.contact.contact_telephone) {
      toast.error("Add a phone number before starting WhatsApp chat.");
      return;
    }
    try {
      setWhatsAppSending(true);
      const res = await apiFetch(`/whatsapp/contacts/${summary.contact.contact_id}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: selectedWhatsAppTemplateId ? Number(selectedWhatsAppTemplateId) : null,
          create_follow_up_task: createWhatsAppReminder,
          follow_up_due_at: createWhatsAppReminder && whatsAppReminderDueAt ? new Date(whatsAppReminderDueAt).toISOString() : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      window.open(body.whatsapp_url, "_blank", "noopener,noreferrer");
      toast.success(body.follow_up_task ? "WhatsApp chat opened and follow-up task created." : "WhatsApp chat opened.");
      await loadSummary();
    } catch (sendError) {
      toast.error(sendError instanceof Error ? sendError.message : "Failed to start WhatsApp chat.");
    } finally {
      setWhatsAppSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/sales/contacts"
        backLabel="Back to Contacts"
        title={summary ? `${summary.contact.first_name || ""} ${summary.contact.last_name || ""}`.trim() || summary.contact.primary_email || "Contact" : "Contact"}
        description="Review the contact record, linked organization, related opportunities, and inferred service history."
        primaryAction={(
          <Button onClick={handleSave} disabled={saving || !form.primary_email.trim()}>
            {saving ? "Saving..." : "Save Contact"}
          </Button>
        )}
      />

      {error ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div> : null}

      {loading || !summary ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading contact…</Card>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="px-5 py-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-neutral-100">Contact Details</h2>
                <p className="mt-1 text-sm text-neutral-500">Edit the record directly on the page.</p>
              </div>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>First Name</FieldLabel>
                  <Input value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Last Name</FieldLabel>
                  <Input value={form.last_name} onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input type="email" value={form.primary_email} onChange={(event) => setForm((current) => ({ ...current, primary_email: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Phone</FieldLabel>
                  <Input value={form.contact_telephone} onChange={(event) => setForm((current) => ({ ...current, contact_telephone: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Job Title</FieldLabel>
                  <Input value={form.current_title} onChange={(event) => setForm((current) => ({ ...current, current_title: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>LinkedIn URL</FieldLabel>
                  <Input value={form.linkedin_url} onChange={(event) => setForm((current) => ({ ...current, linkedin_url: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Region</FieldLabel>
                  <Input value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} />
                </Field>
                <Field>
                  <FieldLabel>Country</FieldLabel>
                  <Input value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} />
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
                <p className="mt-1 text-sm text-neutral-500">Quick context for the selected contact.</p>
              </div>
              <div className="grid gap-3">
                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Organization</div>
                  <div className="mt-2 text-sm text-neutral-100">
                    {summary.organization ? (
                      <Link href={`/dashboard/sales/organizations/${summary.organization.org_id}`} className="hover:text-white">
                        {summary.organization.org_name}
                      </Link>
                    ) : (
                      "No linked organization"
                    )}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
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
                <div className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-neutral-500">WhatsApp</div>
                      <div className="mt-2 text-sm text-neutral-300">
                        {summary.contact.whatsapp_last_contacted_at
                          ? `Last contacted ${formatDateTime(summary.contact.whatsapp_last_contacted_at)}`
                          : "No WhatsApp contact logged yet"}
                      </div>
                    </div>
                    <MessageCircle className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="mt-4 grid gap-3">
                    <Select value={selectedWhatsAppTemplateId} onValueChange={setSelectedWhatsAppTemplateId} disabled={!whatsAppTemplates.length}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={whatsAppTemplates.length ? "Select template" : "No templates available"} />
                      </SelectTrigger>
                      <SelectContent>
                        {whatsAppTemplates.map((template) => (
                          <SelectItem key={template.id} value={String(template.id)}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={createWhatsAppReminder}
                        onChange={(event) => setCreateWhatsAppReminder(event.target.checked)}
                        className="h-4 w-4 rounded border-neutral-700 bg-neutral-950"
                      />
                      Create follow-up task
                    </label>
                    {createWhatsAppReminder ? (
                      <Input
                        type="datetime-local"
                        value={whatsAppReminderDueAt}
                        onChange={(event) => setWhatsAppReminderDueAt(event.target.value)}
                      />
                    ) : null}
                    <Button
                      type="button"
                      onClick={handleWhatsAppClick}
                      disabled={whatsAppSending || !summary.contact.contact_telephone || !whatsAppTemplates.length}
                    >
                      <MessageCircle />
                      {whatsAppSending ? "Opening..." : "Open WhatsApp"}
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Related Opportunities</h2>
              <div className="mt-4 space-y-3">
                {summary.related_opportunities.length ? summary.related_opportunities.map((opportunity) => (
                  <div key={opportunity.opportunity_id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-sm font-semibold text-neutral-100">{opportunity.opportunity_name}</div>
                    <div className="mt-1 text-sm text-neutral-500">
                      {opportunity.sales_stage || "Unstaged"}{opportunity.expected_close_date ? ` · closes ${opportunity.expected_close_date}` : ""}
                    </div>
                    <div className="mt-2 text-sm text-neutral-300">
                      {opportunity.total_cost_of_project ? `${opportunity.total_cost_of_project}${opportunity.currency_type ? ` ${opportunity.currency_type}` : ""}` : "No commercial value recorded"}
                    </div>
                  </div>
                )) : <div className="text-sm text-neutral-500">No related deals yet.</div>}
              </div>
            </Card>

            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Related Insertion Orders</h2>
              <FieldDescription className="mt-1">These are inferred from the linked organization because contacts are not directly attached to finance records yet.</FieldDescription>
              <div className="mt-4 space-y-3">
                {summary.related_insertion_orders.length ? summary.related_insertion_orders.map((order) => (
                  <div key={order.id} className="rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4">
                    <div className="text-sm font-semibold text-neutral-100">{order.io_number}</div>
                    <div className="mt-1 text-sm text-neutral-500">{order.customer_name || "Unknown customer"} · {order.status || "Unknown status"}</div>
                    <div className="mt-2 text-sm text-neutral-300">{formatMoney(order.total_amount, order.currency)}</div>
                  </div>
                )) : <div className="text-sm text-neutral-500">No related insertion orders yet.</div>}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <FollowUpPanel
              endpoint={`/sales/contacts/${summary.contact.contact_id}/follow-up`}
              lastContactedAt={summary.contact.last_contacted_at}
              lastContactedChannel={summary.contact.last_contacted_channel}
              email={summary.contact.primary_email}
              phone={summary.contact.contact_telephone}
              onLogged={() => loadSummary()}
            />
            <RecordTasksPanel
              moduleKey="sales_contacts"
              entityId={summary.contact.contact_id}
            />
            <RecordDocumentsPanel
              moduleKey="sales_contacts"
              entityId={summary.contact.contact_id}
            />
            <RecordActivityTimeline
              moduleKey="sales_contacts"
              entityId={summary.contact.contact_id}
              description="Contact-level create, update, delete, restore, and note history."
            />
            <RecordCommentsPanel
              moduleKey="sales_contacts"
              entityId={summary.contact.contact_id}
            />
          </div>
        </>
      )}
    </div>
  );
}
