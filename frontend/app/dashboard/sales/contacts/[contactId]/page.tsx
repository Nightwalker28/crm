"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, MessageCircle, Pencil, Plus, StickyNote } from "lucide-react";
import { toast } from "sonner";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { OpportunityQuickCreate } from "@/components/opportunities/OpportunityQuickCreate";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import FollowUpPanel from "@/components/recordActivity/FollowUpPanel";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import {
  RecordRelationshipField,
  RecordRelationshipRail,
  RecordWorkspace,
  RecordWorkspaceHeader,
  RecordWorkspacePrimary,
  RecordWorkspaceRegion,
} from "@/components/recordWorkspace/RecordWorkspace";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PermissionDeniedState } from "@/components/ui/PermissionDeniedState";
import { RecordTabs } from "@/components/ui/RecordTabs";
import {
  RouteErrorState,
  RouteLoadingState,
  RouteNotFoundState,
} from "@/components/ui/RouteStates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import {
  isModuleFieldEnabled,
  useModuleFieldConfigs,
} from "@/hooks/useModuleFieldConfigs";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout as ResolvedRecordLayoutContract,
} from "@/hooks/useResolvedRecordLayout";
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
    organization_id?: number | null;
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

class ContactSummaryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchContactSummary(contactId: string) {
  const res = await apiFetch(`/sales/contacts/${contactId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ContactSummaryRequestError(body?.detail ?? `Failed with ${res.status}`, res.status);
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
  if (popup) popup.opener = null;
  return popup;
}

function focusWorkspaceControl(regionId: string, controlId: string) {
  const region = document.getElementById(regionId);
  region?.scrollIntoView({ block: "start" });
  window.requestAnimationFrame(() => document.getElementById(controlId)?.focus());
}

export default function ContactDetailPage() {
  const params = useParams<{ contactId: string }>();
  const searchParams = useSearchParams();
  const [whatsAppSending, setWhatsAppSending] = useState(false);
  const [selectedWhatsAppTemplateId, setSelectedWhatsAppTemplateId] = useState("");
  const [createWhatsAppReminder, setCreateWhatsAppReminder] = useState(true);
  const [whatsAppReminderDueAt, setWhatsAppReminderDueAt] = useState("");
  const [taskCreateRequestId, setTaskCreateRequestId] = useState(0);
  const [dealQuickCreateOpen, setDealQuickCreateOpen] = useState(false);
  const dealQuickCreateTriggerRef = useRef<HTMLButtonElement>(null);

  const { modules } = useAccessibleModules();
  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const contactActions = moduleActions("sales_contacts");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const opportunityActions = moduleActions("sales_opportunities");
  const organizationActions = moduleActions("sales_organizations");
  const canEditContact = Boolean(contactActions?.can_edit);
  const canDeleteContact = Boolean(contactActions?.can_delete);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canCreateTasks = Boolean(taskActions?.can_create);
  const canEditTasks = Boolean(taskActions?.can_edit);
  const canViewDocuments = Boolean(documentActions?.can_view);
  const canCreateDocuments = Boolean(documentActions?.can_create);
  const canEditDocuments = Boolean(documentActions?.can_edit);
  const canDeleteDocuments = Boolean(documentActions?.can_delete);
  const canViewOpportunities = Boolean(opportunityActions?.can_view);
  // Contextual deal creation links the deal to this contact, so it needs both rights. The
  // create endpoint enforces exactly the same pair.
  const canCreateOpportunityHere = Boolean(opportunityActions?.can_create) && Boolean(contactActions?.can_view);
  const canViewOrganizations = Boolean(organizationActions?.can_view);

  const {
    fields: moduleFields,
    isLoading: moduleFieldsLoading,
    error: moduleFieldsError,
  } = useModuleFieldConfigs("sales_contacts");
  const fieldConfigsReady = !moduleFieldsLoading && !moduleFieldsError;
  const fieldEnabled = (fieldKey: string) =>
    fieldKey === "primary_email" || (fieldConfigsReady && isModuleFieldEnabled(moduleFields, fieldKey));

  const customerGroupsQuery = useCustomerGroups();
  const { assignContactGroup, isAssigningCustomerGroup } = useClientPortalActions();
  const summaryQuery = useQuery({
    queryKey: ["sales-contact-summary", params.contactId],
    queryFn: () => fetchContactSummary(params.contactId),
    enabled: Boolean(params.contactId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_contacts", "detail");
  const whatsAppTemplatesQuery = useQuery({
    queryKey: ["message-templates", "whatsapp", "sales_contacts"],
    queryFn: fetchWhatsAppTemplates,
    staleTime: 5 * 60_000,
  });

  const summary = summaryQuery.data ?? null;
  const summaryError = summaryQuery.error;
  const requestedTab = searchParams.get("tab");

  // Follow-up, notes, and tasks used to be tabs. Old links now scroll to the region that
  // replaced them instead of landing on a tab that no longer exists.
  useEffect(() => {
    if (!summary) return;
    const legacyRegion = {
      activity: "contact-follow-up",
      notes: "contact-notes",
    }[requestedTab || ""];
    if (!legacyRegion) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(legacyRegion)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedTab, summary]);
  const whatsAppTemplates = whatsAppTemplatesQuery.data ?? EMPTY_MESSAGE_TEMPLATES;
  const selectedWhatsAppTemplate = useMemo(
    () =>
      whatsAppTemplates.find((template) => String(template.id) === selectedWhatsAppTemplateId)
      ?? whatsAppTemplates[0]
      ?? null,
    [selectedWhatsAppTemplateId, whatsAppTemplates],
  );
  const activeWhatsAppTemplateId = selectedWhatsAppTemplate ? String(selectedWhatsAppTemplate.id) : "";
  const contactName = summary
    ? [summary.contact.first_name, summary.contact.last_name].filter(Boolean).join(" ")
      || summary.contact.primary_email
    : "Contact";

  async function handleWhatsAppClick() {
    if (!summary?.contact.contact_telephone) {
      return toast.error("Add a phone number before starting WhatsApp chat.");
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
          follow_up_due_at:
            createWhatsAppReminder && whatsAppReminderDueAt
              ? new Date(whatsAppReminderDueAt).toISOString()
              : null,
        }),
      });
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
      toast.error("WhatsApp chat could not be started. Check the contact details and try again.");
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
    <RecordWorkspace title={contactName} description="Review contact details, account context, communications, and related sales records.">
      {!summary ? (
        <RecordPageHeader
          backHref="/dashboard/sales/contacts"
          backLabel="Back to Contacts"
        />
      ) : null}

      {summaryError instanceof ContactSummaryRequestError && summaryError.status === 403 ? (
        <PermissionDeniedState titleAs="p" />
      ) : summaryError instanceof ContactSummaryRequestError && summaryError.status === 404 ? (
        <RouteNotFoundState titleAs="p" recordLabel="Contact" backHref="/dashboard/sales/contacts" backLabel="Back to contacts" />
      ) : summaryError ? (
        <RouteErrorState
          titleAs="p"
          title="Unable to load this contact"
          reset={() => void summaryQuery.refetch()}
          backHref="/dashboard/sales/contacts"
          backLabel="Back to contacts"
        />
      ) : summaryQuery.isLoading || !summary ? (
        <RouteLoadingState label="contact" />
      ) : (
        <>
          <RecordWorkspaceHeader
            title={contactName}
            pageHeader={(
              <RecordPageHeader
                backHref="/dashboard/sales/contacts"
                backLabel="Back to Contacts"
                primaryAction={(
                  <>
                    {canDeleteContact ? (
                      <RecordDeleteButton
                        endpoint={`/sales/contacts/${params.contactId}`}
                        label="Contact"
                        recordName={contactName}
                        redirectHref="/dashboard/sales/contacts"
                        queryKeys={["sales-contacts"]}
                      />
                    ) : null}
                    {canEditContact ? (
                      <Button asChild variant="outline">
                        <Link href={`/dashboard/sales/contacts/${params.contactId}/edit`}>
                          <Pencil />
                          Edit
                        </Link>
                      </Button>
                    ) : null}
                  </>
                )}
              />
            )}
            metadata={(
              <>
                {summary.organization ? (
                  canViewOrganizations ? (
                    <Link
                      href={`/dashboard/sales/organizations/${summary.organization.org_id}`}
                      className="text-action-primary hover:underline"
                    >
                      {summary.organization.org_name}
                    </Link>
                  ) : (
                    <span>{summary.organization.org_name}</span>
                  )
                ) : null}
                <span>{summary.contact.primary_email}</span>
                {fieldEnabled("contact_telephone") && summary.contact.contact_telephone ? (
                  <span>{summary.contact.contact_telephone}</span>
                ) : null}
                {fieldEnabled("assigned_to") ? (
                  <span>Owner: {summary.contact.assigned_to_name || "Unassigned"}</span>
                ) : null}
              </>
            )}
            actions={(
              <>
                <CommunicationActions
                  email={summary.contact.primary_email}
                  phone={fieldEnabled("contact_telephone") ? summary.contact.contact_telephone : null}
                  emailOptOut={Boolean(summary.contact.email_opt_out)}
                  showCopyActions={false}
                  whatsAppBusy={whatsAppSending}
                  whatsAppDisabled={!whatsAppTemplates.length || whatsAppTemplatesQuery.isLoading}
                  onWhatsAppClick={() => void handleWhatsAppClick()}
                />
                {canCreateOpportunityHere ? (
                  <Button
                    ref={dealQuickCreateTriggerRef}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDealQuickCreateOpen(true)}
                  >
                    <Plus />
                    Deal
                  </Button>
                ) : null}
                {canEditContact ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      focusWorkspaceControl(
                        "contact-notes",
                        `record-note-sales_contacts-${summary.contact.contact_id}`,
                      )
                    }
                  >
                    <StickyNote />
                    Note
                  </Button>
                ) : null}
                {canViewTasks && canCreateTasks ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTaskCreateRequestId((current) => current + 1);
                      document.getElementById("contact-tasks")?.scrollIntoView({ block: "start" });
                    }}
                  >
                    <CheckSquare />
                    Task
                  </Button>
                ) : null}
              </>
            )}
            updatedLabel={(
              <>Updated {summary.contact.updated_at ? formatDateTime(summary.contact.updated_at) : "Not recorded"}</>
            )}
          />

          {canCreateOpportunityHere ? (
            <OpportunityQuickCreate
              open={dealQuickCreateOpen}
              onOpenChange={setDealQuickCreateOpen}
              returnFocusRef={dealQuickCreateTriggerRef}
              onCreated={() => void summaryQuery.refetch()}
              context={{
                sourceModuleKey: "sales_contacts",
                sourceEntityId: summary.contact.contact_id,
                relationshipIntent: "contact_deal",
                defaults: {
                  contact_id: summary.contact.contact_id,
                  contact_name: contactName,
                  client: contactName,
                  organization_id: summary.organization?.org_id ?? null,
                  organization_name: summary.organization?.org_name ?? "",
                  opportunity_name: summary.organization?.org_name
                    ? `${summary.organization.org_name} — new deal`
                    : "",
                },
              }}
            />
          ) : null}

          <RecordWorkspacePrimary
            relationshipRail={(
              fieldConfigsReady ? (
                <ContactRelationshipContext
                  summary={summary}
                  fieldEnabled={fieldEnabled}
                  canViewOrganizations={canViewOrganizations}
                  customerGroups={customerGroupsQuery.data ?? []}
                  customerGroupsLoading={customerGroupsQuery.isLoading}
                  customerGroupSaving={isAssigningCustomerGroup}
                  canEditCustomerGroup={canEditContact}
                  onAssignCustomerGroup={(value) => void handleAssignCustomerGroup(value)}
                />
              ) : (
                <RecordRelationshipRail description="Account, ownership, and commercial context for this contact.">
                  <p className="text-p-sm text-copy-muted" role={moduleFieldsError ? "alert" : "status"}>
                    {moduleFieldsError ? "Relationship context is unavailable." : "Loading relationship context…"}
                  </p>
                </RecordRelationshipRail>
              )
            )}
          >
            <RecordWorkspaceRegion id="contact-follow-up">
              <FollowUpPanel
                endpoint={`/sales/contacts/${summary.contact.contact_id}/follow-up`}
                lastContactedAt={summary.contact.last_contacted_at}
                lastContactedChannel={summary.contact.last_contacted_channel}
                email={summary.contact.primary_email}
                phone={fieldEnabled("contact_telephone") ? summary.contact.contact_telephone : null}
                canLog={canEditContact}
                canCreateTask={canViewTasks && canCreateTasks}
                onLogged={async () => {
                  await summaryQuery.refetch();
                }}
              />
            </RecordWorkspaceRegion>
            <RecordWorkspaceRegion id="contact-whatsapp">
              <WhatsAppPanel
                lastContactedAt={summary.contact.whatsapp_last_contacted_at}
                hasPhone={Boolean(summary.contact.contact_telephone)}
                templates={whatsAppTemplates}
                templatesLoading={whatsAppTemplatesQuery.isLoading}
                activeTemplateId={activeWhatsAppTemplateId}
                onTemplateChange={setSelectedWhatsAppTemplateId}
                createReminder={createWhatsAppReminder}
                onCreateReminderChange={setCreateWhatsAppReminder}
                reminderDueAt={whatsAppReminderDueAt}
                onReminderDueAtChange={setWhatsAppReminderDueAt}
                sending={whatsAppSending}
                onClick={() => void handleWhatsAppClick()}
              />
            </RecordWorkspaceRegion>
            {canViewTasks ? (
              <RecordWorkspaceRegion id="contact-tasks">
                <RecordTasksPanel
                  moduleKey="sales_contacts"
                  entityId={summary.contact.contact_id}
                  sourceLabel={contactName}
                  canCreate={canCreateTasks}
                  canEdit={canEditTasks}
                  createRequestId={taskCreateRequestId}
                  createActionVariant="outline"
                />
              </RecordWorkspaceRegion>
            ) : null}
            <RecordWorkspaceRegion id="contact-notes">
              <RecordCommentsPanel
                moduleKey="sales_contacts"
                entityId={summary.contact.contact_id}
                canEdit={canEditContact}
                submitVariant="outline"
              />
            </RecordWorkspaceRegion>
          </RecordWorkspacePrimary>

          <RecordTabs
            urlParam="tab"
            defaultTabId="overview"
            tabs={[
              {
                id: "overview",
                label: "Details",
                content: (
                  <ContactOverview
                    summary={summary}
                    layout={detailLayoutQuery.data}
                    isLayoutLoading={detailLayoutQuery.isLoading}
                    layoutError={detailLayoutQuery.error}
                    onRetryLayout={() => void detailLayoutQuery.refetch()}
                  />
                ),
              },
              {
                id: "related",
                label: "Related records",
                content: (
                  <RelatedRecords
                    summary={summary}
                    canViewOpportunities={canViewOpportunities}
                    canCreateOpportunity={canCreateOpportunityHere}
                    onCreateOpportunity={() => setDealQuickCreateOpen(true)}
                  />
                ),
              },
              ...(canViewDocuments ? [{
                id: "files",
                label: "Files",
                content: (
                  <RecordDocumentsPanel
                    moduleKey="sales_contacts"
                    entityId={summary.contact.contact_id}
                    canUpload={canCreateDocuments && canEditContact}
                    canEdit={canEditDocuments && canEditContact}
                    canDelete={canDeleteDocuments && canEditContact}
                  />
                ),
              }] : []),
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
      )}
    </RecordWorkspace>
  );
}

function ContactOverview({
  summary,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  summary: ContactSummary;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  const layoutValues: Record<string, unknown> = {
    ...summary.contact,
    organization_id: summary.organization?.org_name,
    assigned_to: summary.contact.assigned_to_name,
  };

  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <div role="alert">
            <h2 className="text-base font-semibold text-copy-primary">Contact details are unavailable</h2>
            <p className="mt-1 text-p-sm text-copy-muted">The configurable details layout could not be loaded.</p>
            <Button className="mt-4" type="button" variant="outline" size="sm" onClick={onRetryLayout}>
              Try again
            </Button>
          </div>
        ) : (
          <div role="status" className="text-sm text-copy-muted">Loading contact details…</div>
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={layoutValues}
      customValues={summary.contact.custom_fields ?? {}}
      renderValue={(field, value) => {
        if (field.field_key === "linkedin_url") {
          const href = safeExternalUrl(typeof value === "string" ? value : null);
          if (!href) return undefined;
          return (
            <Link href={href} target="_blank" rel="noopener noreferrer" className="text-action-primary hover:underline">
              {String(value)}
            </Link>
          );
        }
        if (field.field_key === "email_opt_out") {
          return value === true ? "Opted out" : "Email allowed";
        }
        return undefined;
      }}
    />
  );
}

function ContactRelationshipContext({
  summary,
  fieldEnabled,
  canViewOrganizations,
  customerGroups,
  customerGroupsLoading,
  customerGroupSaving,
  canEditCustomerGroup,
  onAssignCustomerGroup,
}: {
  summary: ContactSummary;
  fieldEnabled: (fieldKey: string) => boolean;
  canViewOrganizations: boolean;
  customerGroups: CustomerGroup[];
  customerGroupsLoading: boolean;
  customerGroupSaving: boolean;
  canEditCustomerGroup: boolean;
  onAssignCustomerGroup: (value: string) => void;
}) {
  return (
    <RecordRelationshipRail description="Account, ownership, and commercial context for this contact.">
      {fieldEnabled("organization_id") ? (
        <RecordRelationshipField
          label="Account"
          value={
            summary.organization ? (
              canViewOrganizations ? (
                <Link
                  href={`/dashboard/sales/organizations/${summary.organization.org_id}`}
                  className="text-action-primary hover:underline"
                >
                  {summary.organization.org_name}
                </Link>
              ) : (
                summary.organization.org_name
              )
            ) : (
              "No account linked"
            )
          }
        />
      ) : null}
      {fieldEnabled("assigned_to") ? (
        <RecordRelationshipField label="Owner" value={summary.contact.assigned_to_name || "Unassigned"} />
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <SummaryTile label="Open deals" value={String(summary.opportunity_count)} />
        <SummaryTile label="Quotes" value={String(summary.quote_count)} />
      </div>
      <RecordRelationshipField
        label="Services"
        value={summary.inferred_services.length ? summary.inferred_services.join(", ") : "No service history yet"}
      />
      <div>
        <div className="text-xs font-medium text-copy-label">Customer group</div>
        <Select
          value={summary.contact.customer_group_id ? String(summary.contact.customer_group_id) : "none"}
          onValueChange={onAssignCustomerGroup}
          disabled={!canEditCustomerGroup || customerGroupsLoading || customerGroupSaving}
        >
          <SelectTrigger className="mt-2 w-full">
            <SelectValue placeholder="Select customer group" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No group</SelectItem>
            {customerGroups.map((group) => (
              <SelectItem key={group.id} value={String(group.id)} disabled={!group.is_active}>
                {group.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription className="mt-2">
          Client portal pricing uses this group where pricing rules are configured.
        </FieldDescription>
      </div>
    </RecordRelationshipRail>
  );
}

function WhatsAppPanel({
  lastContactedAt,
  hasPhone,
  templates,
  templatesLoading,
  activeTemplateId,
  onTemplateChange,
  createReminder,
  onCreateReminderChange,
  reminderDueAt,
  onReminderDueAtChange,
  sending,
  onClick,
}: {
  lastContactedAt?: string | null;
  hasPhone: boolean;
  templates: MessageTemplate[];
  templatesLoading: boolean;
  activeTemplateId: string;
  onTemplateChange: (value: string) => void;
  createReminder: boolean;
  onCreateReminderChange: (value: boolean) => void;
  reminderDueAt: string;
  onReminderDueAtChange: (value: string) => void;
  sending: boolean;
  onClick: () => void;
}) {
  return (
    <Card className="px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-copy-primary">WhatsApp</h2>
          <p className="mt-1 text-p-sm text-copy-muted">
            {lastContactedAt
              ? `Last contacted ${formatDateTime(lastContactedAt)}`
              : "No WhatsApp contact logged yet"}
          </p>
        </div>
        <MessageCircle className="h-5 w-5 text-state-success" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Select
          value={activeTemplateId}
          onValueChange={onTemplateChange}
          disabled={!templates.length || templatesLoading}
        >
          <SelectTrigger>
            <SelectValue
              placeholder={
                templatesLoading
                  ? "Loading templates"
                  : templates.length
                    ? "Select template"
                    : "No templates available"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={String(template.id)}>{template.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {createReminder ? (
          <Input
            type="datetime-local"
            aria-label="Follow-up reminder due"
            value={reminderDueAt}
            onChange={(event) => onReminderDueAtChange(event.target.value)}
          />
        ) : null}
        <label className="flex items-center gap-2 text-sm text-copy-secondary">
          <Checkbox
            checked={createReminder}
            onCheckedChange={(checked) => onCreateReminderChange(checked === true)}
            aria-label="Create follow-up task"
          />
          Create follow-up task
        </label>
        <div className="sm:col-span-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClick}
            disabled={sending || !hasPhone || !templates.length || templatesLoading}
          >
            <MessageCircle />
            {sending ? "Opening…" : "Open WhatsApp"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function RelatedRecords({
  summary,
  canViewOpportunities,
  canCreateOpportunity,
  onCreateOpportunity,
}: {
  summary: ContactSummary;
  canViewOpportunities: boolean;
  canCreateOpportunity: boolean;
  onCreateOpportunity: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canViewOpportunities ? (
        <Card className="px-5 py-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-copy-primary">Related deals</h2>
            {canCreateOpportunity ? (
              <Button type="button" size="sm" variant="outline" onClick={onCreateOpportunity}>
                <Plus />
                Deal
              </Button>
            ) : null}
          </div>
          <div className="mt-4 space-y-3">
            {summary.related_opportunities.length ? (
              summary.related_opportunities.map((opportunity) => (
                <Link
                  key={opportunity.opportunity_id}
                  href={`/dashboard/sales/opportunities/${opportunity.opportunity_id}`}
                  className="block rounded-[var(--radius-card)] border border-line-subtle bg-surface-muted px-4 py-4 hover:border-line-strong"
                >
                  <div className="text-sm font-semibold text-copy-primary">{opportunity.opportunity_name}</div>
                  <div className="mt-1 text-sm text-copy-muted">
                    {opportunity.sales_stage || "Unstaged"}
                    {opportunity.expected_close_date ? ` · closes ${opportunity.expected_close_date}` : ""}
                  </div>
                </Link>
              ))
            ) : (
              <p className="text-sm text-copy-muted">No related deals yet.</p>
            )}
          </div>
        </Card>
      ) : null}
      <Card className="px-5 py-5">
        <h2 className="text-base font-semibold text-copy-primary">Related quotes</h2>
        <div className="mt-4 space-y-3">
          {summary.related_quotes.length ? (
            summary.related_quotes.map((quote) => (
              <Link
                key={quote.quote_id}
                href={`/dashboard/sales/quotes/${quote.quote_id}`}
                className="block rounded-[var(--radius-card)] border border-line-subtle bg-surface-muted px-4 py-4 hover:border-line-strong"
              >
                <div className="text-sm font-semibold text-copy-primary">{quote.quote_number}</div>
                <div className="mt-1 text-sm text-copy-muted">
                  {quote.title || quote.customer_name} · {quote.status || "Unknown status"}
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
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line-subtle bg-surface-muted px-4 py-3">
      <div className="text-xs font-medium text-copy-label">{label}</div>
      <div className="mt-2 text-sm font-medium text-copy-primary">{value}</div>
    </div>
  );
}

function safeExternalUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
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
