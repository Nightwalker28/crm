"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckSquare, MessageCircle, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import CustomFieldInputs from "@/components/customFields/CustomFieldInputs";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { isModuleFieldEnabled, pickEnabledModulePayload, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useClientPortalActions, useCustomerGroups, type CustomerGroup } from "@/hooks/useClientPortal";
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

type RelatedQuote = {
  quote_id: number;
  quote_number: string;
  title?: string | null;
  customer_name: string;
  status?: string | null;
  currency?: string | null;
  total_amount?: number | string | null;
  expiry_date?: string | null;
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
    email_opt_out?: boolean | null;
    current_title?: string | null;
    region?: string | null;
    country?: string | null;
    organization_id?: number | null;
    last_contacted_at?: string | null;
    last_contacted_channel?: string | null;
    whatsapp_last_contacted_at?: string | null;
    customer_group_id?: number | null;
    customer_group?: CustomerGroup | null;
    custom_fields?: Record<string, unknown> | null;
  };
  organization?: OrganizationCompact | null;
  related_opportunities: RelatedOpportunity[];
  related_quotes: RelatedQuote[];
  inferred_services: string[];
  opportunity_count: number;
  quote_count: number;
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

const EMPTY_MESSAGE_TEMPLATES: MessageTemplate[] = [];

function formatMoney(value?: number | string | null, currency?: string | null) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || Number.isNaN(amount)) return "Unspecified";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}

async function fetchContactSummary(contactId: string) {
  const res = await apiFetch(`/sales/contacts/${contactId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as ContactSummary;
}

async function fetchWhatsAppTemplates() {
  const res = await apiFetch("/message-templates?channel=whatsapp&module_key=sales_contacts");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? "Failed to load WhatsApp templates.");
  return (body?.results ?? []) as MessageTemplate[];
}

function openPendingWhatsAppWindow() {
  if (typeof window === "undefined" || typeof window.open !== "function") return null;
  const popup = window.open("about:blank", "_blank");
  if (popup) {
    popup.opener = null;
  }
  return popup;
}

export default function ContactDetailPage() {
  const params = useParams<{ contactId: string }>();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [whatsAppSending, setWhatsAppSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [selectedWhatsAppTemplateId, setSelectedWhatsAppTemplateId] = useState<string>("");
  const [createWhatsAppReminder, setCreateWhatsAppReminder] = useState(true);
  const [whatsAppReminderDueAt, setWhatsAppReminderDueAt] = useState("");
  const customFieldsQuery = useModuleCustomFields("sales_contacts", true);
  const { fields: moduleFields } = useModuleFieldConfigs("sales_contacts");
  const fieldEnabled = (fieldKey: string) => isModuleFieldEnabled(moduleFields, fieldKey);
  const customerGroupsQuery = useCustomerGroups();
  const { assignContactGroup, isAssigningCustomerGroup } = useClientPortalActions();

  const summaryQuery = useQuery({
    queryKey: ["sales-contact-summary", params.contactId],
    queryFn: () => fetchContactSummary(params.contactId),
    enabled: Boolean(params.contactId),
    refetchOnWindowFocus: false,
  });
  const summary = summaryQuery.data ?? null;
  const loadError = summaryQuery.error instanceof Error ? summaryQuery.error.message : null;
  const whatsAppTemplatesQuery = useQuery({
    queryKey: ["message-templates", "whatsapp", "sales_contacts"],
    queryFn: fetchWhatsAppTemplates,
    staleTime: 5 * 60_000,
  });
  const whatsAppTemplates = whatsAppTemplatesQuery.data ?? EMPTY_MESSAGE_TEMPLATES;
  const selectedWhatsAppTemplate = useMemo(
    () =>
      whatsAppTemplates.find((template) => String(template.id) === selectedWhatsAppTemplateId) ??
      whatsAppTemplates[0] ??
      null,
    [selectedWhatsAppTemplateId, whatsAppTemplates],
  );
  const activeWhatsAppTemplateId = selectedWhatsAppTemplate ? String(selectedWhatsAppTemplate.id) : "";

  useEffect(() => {
    if (!summary) return;
    setError(null);
    setForm({
      first_name: summary.contact.first_name ?? "",
      last_name: summary.contact.last_name ?? "",
      primary_email: summary.contact.primary_email ?? "",
      contact_telephone: summary.contact.contact_telephone ?? "",
      linkedin_url: summary.contact.linkedin_url ?? "",
      current_title: summary.contact.current_title ?? "",
      region: summary.contact.region ?? "",
      country: summary.contact.country ?? "",
    });
    setCustomFieldValues(summary.contact.custom_fields ?? {});
  }, [summary]);

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      const payload = pickEnabledModulePayload({
        first_name: form.first_name.trim() || null,
        last_name: form.last_name.trim() || null,
        primary_email: form.primary_email.trim(),
        contact_telephone: form.contact_telephone.trim() || null,
        linkedin_url: form.linkedin_url.trim() || null,
        current_title: form.current_title.trim() || null,
        region: form.region.trim() || null,
        country: form.country.trim() || null,
        custom_fields: customFieldValues,
      }, moduleFields, ["primary_email", "custom_fields"]);
      const res = await apiFetch(`/sales/contacts/${params.contactId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-contacts"] }),
        summaryQuery.refetch(),
      ]);
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
    const pendingPopup = openPendingWhatsAppWindow();
    try {
      setWhatsAppSending(true);
      const res = await apiFetch(`/whatsapp/contacts/${summary.contact.contact_id}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_id: activeWhatsAppTemplateId ? Number(activeWhatsAppTemplateId) : null,
          create_follow_up_task: createWhatsAppReminder,
          follow_up_due_at: createWhatsAppReminder && whatsAppReminderDueAt ? new Date(whatsAppReminderDueAt).toISOString() : null,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (pendingPopup) {
        pendingPopup.location.href = body.whatsapp_url;
      } else if (typeof window !== "undefined" && typeof window.open === "function") {
        window.open(body.whatsapp_url, "_blank", "noopener,noreferrer");
      }
      toast.success(body.follow_up_task ? "WhatsApp chat opened and follow-up task created." : "WhatsApp chat opened.");
      await summaryQuery.refetch();
    } catch (sendError) {
      pendingPopup?.close();
      toast.error(sendError instanceof Error ? sendError.message : "Failed to start WhatsApp chat.");
    } finally {
      setWhatsAppSending(false);
    }
  }

  async function handleAssignCustomerGroup(value: string) {
    if (!summary) return;
    try {
      const parsedGroupId = value === "none" ? null : Number(value);
      await assignContactGroup({
        contactId: summary.contact.contact_id,
        customerGroupId: Number.isInteger(parsedGroupId) ? parsedGroupId : null,
      });
      await summaryQuery.refetch();
      toast.success("Customer group updated.");
    } catch (assignError) {
      toast.error(assignError instanceof Error ? assignError.message : "Failed to update customer group.");
    }
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <RecordPageHeader
        backHref="/dashboard/sales/contacts"
        backLabel="Back to Contacts"
        title={summary ? `${summary.contact.first_name || ""} ${summary.contact.last_name || ""}`.trim() || summary.contact.primary_email || "Contact" : "Contact"}
        description="Review the contact record, linked account, related deals, and inferred service history."
        primaryAction={(
          <>
            <RecordDeleteButton
              endpoint={`/sales/contacts/${params.contactId}`}
              label="Contact"
              recordName={summary ? `${summary.contact.first_name || ""} ${summary.contact.last_name || ""}`.trim() || summary.contact.primary_email : "this contact"}
              redirectHref="/dashboard/sales/contacts"
              queryKeys={["sales-contacts"]}
            />
            <Button onClick={handleSave} disabled={saving || !form.primary_email.trim()}>
              {saving ? "Saving..." : "Save Contact"}
            </Button>
          </>
        )}
      />

      {error || loadError ? <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error || loadError}</div> : null}

      {summaryQuery.isLoading || !summary ? (
        <Card className="px-5 py-5 text-sm text-neutral-500">Loading contact…</Card>
      ) : (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <CommunicationActions
                email={summary.contact.primary_email}
                phone={fieldEnabled("contact_telephone") ? summary.contact.contact_telephone : null}
                emailOptOut={Boolean(summary.contact.email_opt_out)}
                whatsAppBusy={whatsAppSending}
                whatsAppDisabled={!whatsAppTemplates.length || whatsAppTemplatesQuery.isLoading}
                onWhatsAppClick={handleWhatsAppClick}
                followUpTargetId="contact-record-tools"
              />
              <Button type="button" size="sm" variant="ghost" onClick={() => document.getElementById("contact-record-tools")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <StickyNote />
                Note
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => document.getElementById("contact-record-tools")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                <CheckSquare />
                Task
              </Button>
              <div className="ml-auto text-xs text-neutral-500">
                Last contacted: {summary.contact.last_contacted_at ? formatDateTime(summary.contact.last_contacted_at) : "Not logged"}
              </div>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="px-5 py-5">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-neutral-100">Contact Details</h2>
                <p className="mt-1 text-sm text-neutral-500">Edit the record directly on the page.</p>
              </div>
              <FieldGroup className="grid gap-4 md:grid-cols-2">
                {fieldEnabled("first_name") ? (
                <Field>
                  <FieldLabel>First Name</FieldLabel>
                  <Input value={form.first_name} onChange={(event) => setForm((current) => ({ ...current, first_name: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("last_name") ? (
                <Field>
                  <FieldLabel>Last Name</FieldLabel>
                  <Input value={form.last_name} onChange={(event) => setForm((current) => ({ ...current, last_name: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("primary_email") ? (
                <Field>
                  <FieldLabel>Email</FieldLabel>
                  <Input type="email" value={form.primary_email} onChange={(event) => setForm((current) => ({ ...current, primary_email: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("contact_telephone") ? (
                <Field>
                  <FieldLabel>Phone</FieldLabel>
                  <Input value={form.contact_telephone} onChange={(event) => setForm((current) => ({ ...current, contact_telephone: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("current_title") ? (
                <Field>
                  <FieldLabel>Job Title</FieldLabel>
                  <Input value={form.current_title} onChange={(event) => setForm((current) => ({ ...current, current_title: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("linkedin_url") ? (
                <Field>
                  <FieldLabel>LinkedIn URL</FieldLabel>
                  <Input value={form.linkedin_url} onChange={(event) => setForm((current) => ({ ...current, linkedin_url: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("region") ? (
                <Field>
                  <FieldLabel>Region</FieldLabel>
                  <Input value={form.region} onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))} />
                </Field>
                ) : null}
                {fieldEnabled("country") ? (
                <Field>
                  <FieldLabel>Country</FieldLabel>
                  <Input value={form.country} onChange={(event) => setForm((current) => ({ ...current, country: event.target.value }))} />
                </Field>
                ) : null}
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
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Account</div>
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
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Quotes</div>
                    <div className="mt-2 text-2xl font-semibold text-neutral-100">{summary.quote_count}</div>
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
                  <div className="text-xs uppercase tracking-wide text-neutral-500">Customer Group</div>
                  <div className="mt-2">
                    <Select
                      value={summary.contact.customer_group_id ? String(summary.contact.customer_group_id) : "none"}
                      onValueChange={(value) => void handleAssignCustomerGroup(value)}
                      disabled={customerGroupsQuery.isLoading || isAssigningCustomerGroup}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select customer group" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No group</SelectItem>
                        {(customerGroupsQuery.data ?? []).map((group) => (
                          <SelectItem key={group.id} value={String(group.id)} disabled={!group.is_active}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="mt-2 text-xs text-neutral-500">
                    {summary.contact.customer_group
                      ? `${summary.contact.customer_group.name} segmentation is assigned. Client portal pricing uses this group where pricing rules are configured.`
                      : "No group assigned. Public/default pricing remains the fallback."}
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
                    <Select value={activeWhatsAppTemplateId} onValueChange={setSelectedWhatsAppTemplateId} disabled={!whatsAppTemplates.length || whatsAppTemplatesQuery.isLoading}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={whatsAppTemplatesQuery.isLoading ? "Loading templates" : whatsAppTemplates.length ? "Select template" : "No templates available"} />
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
                      disabled={whatsAppSending || !summary.contact.contact_telephone || !whatsAppTemplates.length || whatsAppTemplatesQuery.isLoading}
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
              <h2 className="text-lg font-semibold text-neutral-100">Related Deals</h2>
              <div className="mt-4 space-y-3">
                {summary.related_opportunities.length ? summary.related_opportunities.map((opportunity) => (
                  <Link key={opportunity.opportunity_id} href={`/dashboard/sales/opportunities/${opportunity.opportunity_id}`} className="block rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4 hover:border-neutral-700">
                    <div className="text-sm font-semibold text-neutral-100">{opportunity.opportunity_name}</div>
                    <div className="mt-1 text-sm text-neutral-500">
                      {opportunity.sales_stage || "Unstaged"}{opportunity.expected_close_date ? ` · closes ${opportunity.expected_close_date}` : ""}
                    </div>
                    <div className="mt-2 text-sm text-neutral-300">
                      {opportunity.total_cost_of_project ? `${opportunity.total_cost_of_project}${opportunity.currency_type ? ` ${opportunity.currency_type}` : ""}` : "No commercial value recorded"}
                    </div>
                  </Link>
                )) : <div className="text-sm text-neutral-500">No related deals yet.</div>}
              </div>
            </Card>

            <Card className="px-5 py-5">
              <h2 className="text-lg font-semibold text-neutral-100">Related Quotes</h2>
              <FieldDescription className="mt-1">Quotes linked directly to this contact or its account.</FieldDescription>
              <div className="mt-4 space-y-3">
                {summary.related_quotes.length ? summary.related_quotes.map((quote) => (
                  <Link key={quote.quote_id} href={`/dashboard/sales/quotes/${quote.quote_id}`} className="block rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4 hover:border-neutral-700">
                    <div className="text-sm font-semibold text-neutral-100">{quote.quote_number}</div>
                    <div className="mt-1 text-sm text-neutral-500">{quote.title || quote.customer_name} · {quote.status || "Unknown status"}</div>
                    <div className="mt-2 text-sm text-neutral-300">{formatMoney(quote.total_amount, quote.currency)}</div>
                  </Link>
                )) : <div className="text-sm text-neutral-500">No related quotes yet.</div>}
              </div>
            </Card>

          </div>

          <div id="contact-record-tools" className="scroll-mt-6">
            <CrmRecordActivitySection
              moduleKey="sales_contacts"
              entityId={summary.contact.contact_id}
              recordLabel="Contact-level"
              taskSourceLabel={`${summary.contact.first_name || ""} ${summary.contact.last_name || ""}`.trim() || summary.contact.primary_email}
              followUp={{
                endpoint: `/sales/contacts/${summary.contact.contact_id}/follow-up`,
                lastContactedAt: summary.contact.last_contacted_at,
                lastContactedChannel: summary.contact.last_contacted_channel,
                email: summary.contact.primary_email,
                phone: summary.contact.contact_telephone,
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
