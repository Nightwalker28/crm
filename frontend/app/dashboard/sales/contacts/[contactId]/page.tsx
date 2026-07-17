"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, MessageCircle, Pencil, StickyNote } from "lucide-react";
import { toast } from "sonner";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import FollowUpPanel from "@/components/recordActivity/FollowUpPanel";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RecordTabs } from "@/components/ui/RecordTabs";
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
import {
  isModuleFieldEnabled,
  useModuleFieldConfigs,
} from "@/hooks/useModuleFieldConfigs";
import {
  useClientPortalActions,
  useCustomerGroups,
  type CustomerGroup,
} from "@/hooks/useClientPortal";
import { apiFetch } from "@/lib/api";
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
    assigned_to_name?: string | null;
    last_contacted_at?: string | null;
    last_contacted_channel?: string | null;
    whatsapp_last_contacted_at?: string | null;
    customer_group_id?: number | null;
    customer_group?: CustomerGroup | null;
    custom_fields?: Record<string, unknown> | null;
    updated_at?: string | null;
  };
  organization?: {
    org_id: number;
    org_name: string;
    primary_email?: string | null;
    website?: string | null;
  } | null;
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

const EMPTY_MESSAGE_TEMPLATES: MessageTemplate[] = [];

async function fetchContactSummary(contactId: string) {
  const res = await apiFetch(`/sales/contacts/${contactId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as ContactSummary;
}

async function fetchWhatsAppTemplates() {
  const res = await apiFetch(
    "/message-templates?channel=whatsapp&module_key=sales_contacts",
  );
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(body?.detail ?? "Failed to load WhatsApp templates.");
  return (body?.results ?? []) as MessageTemplate[];
}

function openPendingWhatsAppWindow() {
  if (typeof window === "undefined" || typeof window.open !== "function")
    return null;
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  return popup;
}

export default function ContactDetailPage() {
  const params = useParams<{ contactId: string }>();
  const [whatsAppSending, setWhatsAppSending] = useState(false);
  const [selectedWhatsAppTemplateId, setSelectedWhatsAppTemplateId] =
    useState("");
  const [createWhatsAppReminder, setCreateWhatsAppReminder] = useState(true);
  const [whatsAppReminderDueAt, setWhatsAppReminderDueAt] = useState("");
  const { fields: moduleFields } = useModuleFieldConfigs("sales_contacts");
  const fieldEnabled = (fieldKey: string) =>
    isModuleFieldEnabled(moduleFields, fieldKey);
  const customerGroupsQuery = useCustomerGroups();
  const { assignContactGroup, isAssigningCustomerGroup } =
    useClientPortalActions();
  const summaryQuery = useQuery({
    queryKey: ["sales-contact-summary", params.contactId],
    queryFn: () => fetchContactSummary(params.contactId),
    enabled: Boolean(params.contactId),
    refetchOnWindowFocus: false,
  });
  const whatsAppTemplatesQuery = useQuery({
    queryKey: ["message-templates", "whatsapp", "sales_contacts"],
    queryFn: fetchWhatsAppTemplates,
    staleTime: 5 * 60_000,
  });
  const summary = summaryQuery.data ?? null;
  const whatsAppTemplates =
    whatsAppTemplatesQuery.data ?? EMPTY_MESSAGE_TEMPLATES;
  const selectedWhatsAppTemplate = useMemo(
    () =>
      whatsAppTemplates.find(
        (template) => String(template.id) === selectedWhatsAppTemplateId,
      ) ??
      whatsAppTemplates[0] ??
      null,
    [selectedWhatsAppTemplateId, whatsAppTemplates],
  );
  const activeWhatsAppTemplateId = selectedWhatsAppTemplate
    ? String(selectedWhatsAppTemplate.id)
    : "";
  const contactName = summary
    ? [summary.contact.first_name, summary.contact.last_name]
        .filter(Boolean)
        .join(" ") || summary.contact.primary_email
    : "Contact";

  async function handleWhatsAppClick() {
    if (!summary?.contact.contact_telephone)
      return toast.error("Add a phone number before starting WhatsApp chat.");
    const pendingPopup = openPendingWhatsAppWindow();
    try {
      setWhatsAppSending(true);
      const res = await apiFetch(
        `/whatsapp/contacts/${summary.contact.contact_id}/click`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            template_id: activeWhatsAppTemplateId
              ? Number(activeWhatsAppTemplateId)
              : null,
            create_follow_up_task: createWhatsAppReminder,
            follow_up_due_at:
              createWhatsAppReminder && whatsAppReminderDueAt
                ? new Date(whatsAppReminderDueAt).toISOString()
                : null,
          }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      if (pendingPopup) pendingPopup.location.href = body.whatsapp_url;
      else window.open(body.whatsapp_url, "_blank", "noopener,noreferrer");
      toast.success(
        body.follow_up_task
          ? "WhatsApp chat opened and follow-up task created."
          : "WhatsApp chat opened.",
      );
      await summaryQuery.refetch();
    } catch {
      pendingPopup?.close();
      toast.error(
        "WhatsApp chat could not be started. Check the contact details and try again.",
      );
    } finally {
      setWhatsAppSending(false);
    }
  }

  async function handleAssignCustomerGroup(value: string) {
    if (!summary) return;
    try {
      const groupId = value === "none" ? null : Number(value);
      await assignContactGroup({
        contactId: summary.contact.contact_id,
        customerGroupId: Number.isInteger(groupId) ? groupId : null,
      });
      await summaryQuery.refetch();
      toast.success("Customer group updated.");
    } catch {
      toast.error("Customer group could not be updated. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-6 text-copy-secondary">
      <RecordPageHeader
        backHref="/dashboard/sales/contacts"
        backLabel="Back to Contacts"
        title={contactName}
        description="Review contact details, account context, communications, and related sales records."
        primaryAction={
          <>
            <RecordDeleteButton
              endpoint={`/sales/contacts/${params.contactId}`}
              label="Contact"
              recordName={contactName}
              redirectHref="/dashboard/sales/contacts"
              queryKeys={["sales-contacts"]}
            />
            <Button asChild>
              <Link href={`/dashboard/sales/contacts/${params.contactId}/edit`}>
                <Pencil />
                Edit
              </Link>
            </Button>
          </>
        }
      />

      {summaryQuery.error ? (
        <RouteErrorState
          title="Unable to load this contact"
          reset={() => void summaryQuery.refetch()}
          backHref="/dashboard/sales/contacts"
          backLabel="Back to contacts"
        />
      ) : null}
      {summaryQuery.isLoading || (!summary && !summaryQuery.error) ? (
        <RouteLoadingState label="contact" />
      ) : null}

      {summary ? (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <CommunicationActions
                email={summary.contact.primary_email}
                phone={
                  fieldEnabled("contact_telephone")
                    ? summary.contact.contact_telephone
                    : null
                }
                emailOptOut={Boolean(summary.contact.email_opt_out)}
                whatsAppBusy={whatsAppSending}
                whatsAppDisabled={
                  !whatsAppTemplates.length || whatsAppTemplatesQuery.isLoading
                }
                onWhatsAppClick={() => void handleWhatsAppClick()}
              />
              <Button asChild type="button" size="sm" variant="ghost">
                <Link href="?tab=notes" scroll={false}>
                  <StickyNote />
                  Note
                </Link>
              </Button>
              <Button asChild type="button" size="sm" variant="ghost">
                <Link href="?tab=related" scroll={false}>
                  <CheckSquare />
                  Task
                </Link>
              </Button>
              <div className="ml-auto text-xs text-copy-muted">
                Updated:{" "}
                {summary.contact.updated_at
                  ? formatDateTime(summary.contact.updated_at)
                  : "Not recorded"}
              </div>
            </div>
          </Card>
          <RecordTabs
            urlParam="tab"
            defaultTabId="overview"
            tabs={[
              {
                id: "overview",
                label: "Overview",
                content: (
                  <ContactOverview
                    summary={summary}
                    fieldEnabled={fieldEnabled}
                    activeWhatsAppTemplateId={activeWhatsAppTemplateId}
                    setSelectedWhatsAppTemplateId={
                      setSelectedWhatsAppTemplateId
                    }
                    whatsAppTemplates={whatsAppTemplates}
                    whatsAppTemplatesLoading={whatsAppTemplatesQuery.isLoading}
                    createWhatsAppReminder={createWhatsAppReminder}
                    setCreateWhatsAppReminder={setCreateWhatsAppReminder}
                    whatsAppReminderDueAt={whatsAppReminderDueAt}
                    setWhatsAppReminderDueAt={setWhatsAppReminderDueAt}
                    whatsAppSending={whatsAppSending}
                    onWhatsAppClick={() => void handleWhatsAppClick()}
                    customerGroups={customerGroupsQuery.data ?? []}
                    customerGroupsLoading={customerGroupsQuery.isLoading}
                    customerGroupSaving={isAssigningCustomerGroup}
                    onAssignCustomerGroup={(value) =>
                      void handleAssignCustomerGroup(value)
                    }
                  />
                ),
              },
              {
                id: "activity",
                label: "Activity",
                content: (
                  <FollowUpPanel
                    endpoint={`/sales/contacts/${summary.contact.contact_id}/follow-up`}
                    lastContactedAt={summary.contact.last_contacted_at}
                    lastContactedChannel={
                      summary.contact.last_contacted_channel
                    }
                    email={summary.contact.primary_email}
                    phone={summary.contact.contact_telephone}
                    onLogged={async () => {
                      await summaryQuery.refetch();
                    }}
                  />
                ),
              },
              {
                id: "related",
                label: "Related records",
                content: (
                  <RelatedRecords summary={summary} contactName={contactName} />
                ),
              },
              {
                id: "notes",
                label: "Notes",
                content: (
                  <RecordCommentsPanel
                    moduleKey="sales_contacts"
                    entityId={summary.contact.contact_id}
                  />
                ),
              },
              {
                id: "files",
                label: "Files",
                content: (
                  <RecordDocumentsPanel
                    moduleKey="sales_contacts"
                    entityId={summary.contact.contact_id}
                  />
                ),
              },
              {
                id: "audit",
                label: "Audit history",
                content: (
                  <RecordActivityTimeline
                    moduleKey="sales_contacts"
                    entityId={summary.contact.contact_id}
                    title="Audit history"
                    description="Chronological record changes and collaboration events for this contact."
                  />
                ),
              },
            ]}
          />
        </>
      ) : null}
    </div>
  );
}

type OverviewProps = {
  summary: ContactSummary;
  fieldEnabled: (key: string) => boolean;
  activeWhatsAppTemplateId: string;
  setSelectedWhatsAppTemplateId: (value: string) => void;
  whatsAppTemplates: MessageTemplate[];
  whatsAppTemplatesLoading: boolean;
  createWhatsAppReminder: boolean;
  setCreateWhatsAppReminder: (value: boolean) => void;
  whatsAppReminderDueAt: string;
  setWhatsAppReminderDueAt: (value: string) => void;
  whatsAppSending: boolean;
  onWhatsAppClick: () => void;
  customerGroups: CustomerGroup[];
  customerGroupsLoading: boolean;
  customerGroupSaving: boolean;
  onAssignCustomerGroup: (value: string) => void;
};

function ContactOverview(props: OverviewProps) {
  const { summary, fieldEnabled } = props;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="px-5 py-5">
        <h2 className="text-lg font-semibold text-copy-primary">
          Contact details
        </h2>
        <p className="mt-1 text-sm text-copy-muted">
          Core contact, account, and ownership information.
        </p>
        <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-2">
          {fieldEnabled("primary_email") ? (
            <DetailField label="Email" value={summary.contact.primary_email} />
          ) : null}
          {fieldEnabled("contact_telephone") ? (
            <DetailField
              label="Phone"
              value={summary.contact.contact_telephone}
            />
          ) : null}
          {fieldEnabled("current_title") ? (
            <DetailField
              label="Job title"
              value={summary.contact.current_title}
            />
          ) : null}
          {fieldEnabled("organization_id") ? (
            <DetailField
              label="Account"
              value={summary.organization?.org_name}
              href={
                summary.organization
                  ? `/dashboard/sales/organizations/${summary.organization.org_id}`
                  : undefined
              }
            />
          ) : null}
          {fieldEnabled("assigned_to") ? (
            <DetailField
              label="Owner"
              value={summary.contact.assigned_to_name}
            />
          ) : null}
          {fieldEnabled("region") ? (
            <DetailField label="Region" value={summary.contact.region} />
          ) : null}
          {fieldEnabled("country") ? (
            <DetailField label="Country" value={summary.contact.country} />
          ) : null}
          {fieldEnabled("linkedin_url") ? (
            <DetailField
              label="LinkedIn"
              value={summary.contact.linkedin_url}
              href={safeExternalUrl(summary.contact.linkedin_url)}
              external
            />
          ) : null}
          {fieldEnabled("email_opt_out") ? (
            <DetailField
              label="Email preference"
              value={
                summary.contact.email_opt_out ? "Opted out" : "Email allowed"
              }
            />
          ) : null}
        </div>
        {Object.keys(summary.contact.custom_fields ?? {}).length ? (
          <details className="mt-5 border-t border-line-subtle pt-5">
            <summary className="cursor-pointer text-sm font-medium text-copy-primary">
              Custom fields
            </summary>
            <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
              {Object.entries(summary.contact.custom_fields ?? {}).map(
                ([key, value]) => (
                  <DetailField
                    key={key}
                    label={key.replace(/_/g, " ")}
                    value={String(value ?? "")}
                  />
                ),
              )}
            </div>
          </details>
        ) : null}
      </Card>
      <div className="grid gap-4">
        <Card className="px-5 py-5">
          <h2 className="text-lg font-semibold text-copy-primary">
            Sales context
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SummaryTile
              label="Open deals"
              value={String(summary.opportunity_count)}
            />
            <SummaryTile label="Quotes" value={String(summary.quote_count)} />
          </div>
          <div className="mt-3">
            <SummaryTile
              label="Services"
              value={
                summary.inferred_services.length
                  ? summary.inferred_services.join(", ")
                  : "No service history yet"
              }
            />
          </div>
        </Card>
        <Card className="px-5 py-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-copy-secondary">
            Customer group
          </h2>
          <Select
            value={
              summary.contact.customer_group_id
                ? String(summary.contact.customer_group_id)
                : "none"
            }
            onValueChange={props.onAssignCustomerGroup}
            disabled={props.customerGroupsLoading || props.customerGroupSaving}
          >
            <SelectTrigger className="mt-3 w-full">
              <SelectValue placeholder="Select customer group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No group</SelectItem>
              {props.customerGroups.map((group) => (
                <SelectItem
                  key={group.id}
                  value={String(group.id)}
                  disabled={!group.is_active}
                >
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription className="mt-2">
            Client portal pricing uses this group where pricing rules are
            configured.
          </FieldDescription>
        </Card>
        <Card className="px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-copy-secondary">
                WhatsApp
              </h2>
              <p className="mt-2 text-sm text-copy-muted">
                {summary.contact.whatsapp_last_contacted_at
                  ? `Last contacted ${formatDateTime(summary.contact.whatsapp_last_contacted_at)}`
                  : "No WhatsApp contact logged yet"}
              </p>
            </div>
            <MessageCircle className="h-5 w-5 text-state-success" />
          </div>
          <div className="mt-4 grid gap-3">
            <Select
              value={props.activeWhatsAppTemplateId}
              onValueChange={props.setSelectedWhatsAppTemplateId}
              disabled={
                !props.whatsAppTemplates.length ||
                props.whatsAppTemplatesLoading
              }
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    props.whatsAppTemplatesLoading
                      ? "Loading templates"
                      : props.whatsAppTemplates.length
                        ? "Select template"
                        : "No templates available"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {props.whatsAppTemplates.map((template) => (
                  <SelectItem key={template.id} value={String(template.id)}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-copy-secondary">
              <input
                type="checkbox"
                checked={props.createWhatsAppReminder}
                onChange={(event) =>
                  props.setCreateWhatsAppReminder(event.target.checked)
                }
                className="h-4 w-4 rounded border-line-strong bg-app"
              />
              Create follow-up task
            </label>
            {props.createWhatsAppReminder ? (
              <Input
                type="datetime-local"
                value={props.whatsAppReminderDueAt}
                onChange={(event) =>
                  props.setWhatsAppReminderDueAt(event.target.value)
                }
              />
            ) : null}
            <Button
              type="button"
              onClick={props.onWhatsAppClick}
              disabled={
                props.whatsAppSending ||
                !summary.contact.contact_telephone ||
                !props.whatsAppTemplates.length ||
                props.whatsAppTemplatesLoading
              }
            >
              <MessageCircle />
              {props.whatsAppSending ? "Opening…" : "Open WhatsApp"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function RelatedRecords({
  summary,
  contactName,
}: {
  summary: ContactSummary;
  contactName: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="px-5 py-5">
        <h2 className="text-lg font-semibold text-copy-primary">
          Related deals
        </h2>
        <div className="mt-4 space-y-3">
          {summary.related_opportunities.length ? (
            summary.related_opportunities.map((opportunity) => (
              <Link
                key={opportunity.opportunity_id}
                href={`/dashboard/sales/opportunities/${opportunity.opportunity_id}`}
                className="block rounded-md border border-line-subtle bg-surface-muted px-4 py-4 hover:border-line-strong"
              >
                <div className="text-sm font-semibold text-copy-primary">
                  {opportunity.opportunity_name}
                </div>
                <div className="mt-1 text-sm text-copy-muted">
                  {opportunity.sales_stage || "Unstaged"}
                  {opportunity.expected_close_date
                    ? ` · closes ${opportunity.expected_close_date}`
                    : ""}
                </div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-copy-muted">No related deals yet.</p>
          )}
        </div>
      </Card>
      <Card className="px-5 py-5">
        <h2 className="text-lg font-semibold text-copy-primary">
          Related quotes
        </h2>
        <div className="mt-4 space-y-3">
          {summary.related_quotes.length ? (
            summary.related_quotes.map((quote) => (
              <Link
                key={quote.quote_id}
                href={`/dashboard/sales/quotes/${quote.quote_id}`}
                className="block rounded-md border border-line-subtle bg-surface-muted px-4 py-4 hover:border-line-strong"
              >
                <div className="text-sm font-semibold text-copy-primary">
                  {quote.quote_number}
                </div>
                <div className="mt-1 text-sm text-copy-muted">
                  {quote.title || quote.customer_name} ·{" "}
                  {quote.status || "Unknown status"}
                </div>
                <div className="mt-2 text-sm text-copy-secondary">
                  {formatMoney(quote.total_amount, quote.currency)}
                </div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-copy-muted">No related quotes yet.</p>
          )}
        </div>
      </Card>
      <div className="lg:col-span-2">
        <RecordTasksPanel
          moduleKey="sales_contacts"
          entityId={summary.contact.contact_id}
          sourceLabel={contactName}
        />
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  href,
  external = false,
}: {
  label: string;
  value?: string | null;
  href?: string;
  external?: boolean;
}) {
  const content = value || "Not recorded";
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">
        {label}
      </div>
      <div className="mt-1 text-sm text-copy-primary">
        {href ? (
          <Link
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="text-action-primary hover:underline"
          >
            {content}
          </Link>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line-subtle bg-surface-muted px-4 py-4">
      <div className="text-xs uppercase tracking-wide text-copy-muted">
        {label}
      </div>
      <div className="mt-2 text-sm font-medium text-copy-primary">{value}</div>
    </div>
  );
}

function safeExternalUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function formatMoney(value?: number | string | null, currency?: string | null) {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || Number.isNaN(amount)) return "Unspecified";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);
}
