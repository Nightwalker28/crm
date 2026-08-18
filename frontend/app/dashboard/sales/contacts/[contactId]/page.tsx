"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { OpportunityQuickCreate } from "@/components/opportunities/OpportunityQuickCreate";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import RecordAuditHistory from "@/components/recordActivity/RecordAuditHistory";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import RecordTimeline from "@/components/recordActivity/RecordTimeline";
import {
  RecordWorkspace,
  recordEditHref,
} from "@/components/recordWorkspace/RecordWorkspace";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
import { Money } from "@/components/ui/Money";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import {
  RecordSpine,
  RecordSpineBlock,
  RecordSpineCollection,
  RecordSpineField,
  RecordSpineLink,
  RecordSpineMeta,
} from "@/components/ui/RecordSpine";
import { RouteNotFoundState } from "@/components/ui/RouteStates";
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

/**
 * Fields the spine owns, which `Details` must not draw a second time (design.md §4.7).
 *
 * `customer_group_id` is the one that would otherwise read as two controls: the rail
 * autosaves it, and the configured layout would render a stale read-only copy beside.
 */
const SPINE_OWNED_FIELDS = ["assigned_to", "organization_id", "customer_group_id"] as const;

const NO_GROUP = "none";

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

export default function ContactDetailPage() {
  const params = useParams<{ contactId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const activeTab = searchParams.get("tab");
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
  const { assignContactGroup } = useClientPortalActions();
  const summaryQuery = useQuery({
    queryKey: ["sales-contact-summary", params.contactId],
    queryFn: () => fetchContactSummary(params.contactId),
    enabled: Boolean(params.contactId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_contacts", "detail");

  const summary = summaryQuery.data ?? null;
  const contact = summary?.contact;
  const summaryError = summaryQuery.error;
  const notFound = summaryError instanceof ContactSummaryRequestError && summaryError.status === 404;
  const contactName = summary
    ? [summary.contact.first_name, summary.contact.last_name].filter(Boolean).join(" ")
      || summary.contact.primary_email
    : "Contact";
  const recordHref = `/dashboard/sales/contacts/${params.contactId}`;

  /**
   * The one state field a contact has. Same shape as the lead's status commit: optimistic,
   * rolled back on failure, and `InlineFieldEdit` reads the moved cache rather than holding
   * a copy of its own.
   */
  async function updateCustomerGroup(next: string) {
    if (!summary) return;
    const groupId = next === NO_GROUP ? null : Number(next);
    if (groupId !== null && !Number.isInteger(groupId)) return;
    const previous = summary;
    queryClient.setQueryData(["sales-contact-summary", params.contactId], {
      ...summary,
      contact: { ...summary.contact, customer_group_id: groupId },
    });
    try {
      await assignContactGroup({ contactId: summary.contact.contact_id, customerGroupId: groupId });
      await queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "sales_contacts", params.contactId],
      });
    } catch (error) {
      queryClient.setQueryData(["sales-contact-summary", params.contactId], previous);
      throw error;
    }
  }

  const customerGroups = customerGroupsQuery.data ?? [];
  const currentGroupId = contact?.customer_group_id ?? null;
  // An archived group stays selectable only where it is the current value — otherwise the
  // rail would render a group the operator cannot see the name of.
  const customerGroupOptions: InlineFieldEditOption[] = [
    { value: NO_GROUP, tone: null, label: "No group" },
    ...customerGroups
      .filter((group) => group.is_active || group.id === currentGroupId)
      .map((group) => ({ value: String(group.id), tone: null, label: group.name })),
  ];
  // The group list is a second request, and the record arrives first. Without this the rail
  // shows the raw id for as long as that request is in flight, because `InlineFieldEdit`
  // falls back to the value when no option matches it.
  if (currentGroupId && !customerGroupOptions.some((option) => option.value === String(currentGroupId))) {
    customerGroupOptions.push({
      value: String(currentGroupId),
      tone: null,
      label: contact?.customer_group?.name ?? "Assigned group",
    });
  }

  return (
    <>
      <RecordWorkspace
        title={contactName}
        description="Review contact details, account context, communications, and related sales records."
        backHref="/dashboard/sales/contacts"
        backLabel="Contacts"
        isPermissionDenied={summaryError instanceof ContactSummaryRequestError && summaryError.status === 403}
        isLoading={summaryQuery.isLoading || (!summary && !summaryError)}
        hasError={Boolean(summaryError)}
        onRetry={() => void summaryQuery.refetch()}
        errorState={notFound ? (
          <RouteNotFoundState
            titleAs="p"
            recordLabel="Contact"
            backHref="/dashboard/sales/contacts"
            backLabel="Back to contacts"
          />
        ) : undefined}
        subtitle={summary ? (
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
          </>
        ) : null}
        actions={contact ? (
          <>
            {canCreateOpportunityHere ? (
              <Button
                ref={dealQuickCreateTriggerRef}
                type="button"
                onClick={() => setDealQuickCreateOpen(true)}
              >
                <Plus />
                Deal
              </Button>
            ) : null}
            <CommunicationActions
              email={contact.primary_email}
              phone={fieldEnabled("contact_telephone") ? contact.contact_telephone : null}
              emailOptOut={Boolean(contact.email_opt_out)}
              showCopyActions={false}
              // WhatsApp is the tracked click-to-chat in the Timeline composer (§4.7), so the
              // header must not also offer the untracked `wa.me` fallback.
              showWhatsApp={false}
            />
            {canEditContact ? (
              <Button asChild variant="outline">
                <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
                  <Pencil />
                  Edit
                </Link>
              </Button>
            ) : null}
          </>
        ) : null}
        overflowActions={contact && canDeleteContact ? (
          <RecordDeleteButton
            as="menuItem"
            endpoint={`/sales/contacts/${params.contactId}`}
            label="Contact"
            recordName={contactName}
            redirectHref="/dashboard/sales/contacts"
            queryKeys={["sales-contacts"]}
          />
        ) : null}
        spine={
          <RecordSpine>
            {summary && contact ? (
              <>
                <RecordSpineBlock title="State">
                  <RecordSpineField label="Customer group">
                    {canEditContact ? (
                      <InlineFieldEdit
                        fieldLabel="Customer group"
                        value={currentGroupId ? String(currentGroupId) : NO_GROUP}
                        options={customerGroupOptions}
                        disabled={customerGroupsQuery.isLoading}
                        onCommit={(next) => updateCustomerGroup(next.value)}
                      />
                    ) : (
                      contact.customer_group?.name ?? "No group"
                    )}
                  </RecordSpineField>
                </RecordSpineBlock>
  
                <RecordSpineBlock title="Connected">
                  {fieldEnabled("organization_id") ? (
                    <RecordSpineLink
                      label="Account"
                      value={summary.organization?.org_name}
                      href={
                        summary.organization && canViewOrganizations
                          ? `/dashboard/sales/organizations/${summary.organization.org_id}`
                          : null
                      }
                    />
                  ) : null}
                  {fieldEnabled("assigned_to") ? (
                    <RecordSpineLink label="Owner" value={contact.assigned_to_name} />
                  ) : null}
                  {canViewOpportunities ? (
                    <RecordSpineCollection
                      label="Deals"
                      count={summary.opportunity_count}
                      href={`${recordHref}?tab=related`}
                    />
                  ) : null}
                  <RecordSpineCollection
                    label="Quotes"
                    count={summary.quote_count}
                    href={`${recordHref}?tab=related`}
                  />
                </RecordSpineBlock>
  
                {summary.inferred_services.length ? (
                  <RecordSpineBlock title="Services">
                    <div className="text-sm text-copy-primary">
                      {summary.inferred_services.join(", ")}
                    </div>
                  </RecordSpineBlock>
                ) : null}
  
                <RecordSpineMeta
                  updatedLabel={
                    contact.updated_at ? `Updated ${formatDateTime(contact.updated_at)}` : undefined
                  }
                  history={
                    <RecordAuditHistory moduleKey="sales_contacts" entityId={contact.contact_id} />
                  }
                />
              </>
            ) : null}
          </RecordSpine>
        }
        details={summary ? (
          <ContactOverview
            summary={summary}
            layout={detailLayoutQuery.data}
            isLayoutLoading={detailLayoutQuery.isLoading}
            layoutError={detailLayoutQuery.error}
            onRetryLayout={() => void detailLayoutQuery.refetch()}
          />
        ) : null}
        timeline={contact ? (
          <RecordTimeline
            moduleKey="sales_contacts"
            entityId={contact.contact_id}
            canEdit={canEditContact}
            composer={{
              followUp: canEditContact
                ? {
                    endpoint: `/sales/contacts/${contact.contact_id}/follow-up`,
                    email: contact.primary_email,
                    phone: fieldEnabled("contact_telephone") ? contact.contact_telephone : null,
                    canCreateTask: canViewTasks && canCreateTasks,
                    onLogged: async () => {
                      await summaryQuery.refetch();
                    },
                  }
                : undefined,
              // The pre-5.3 WhatsApp panel. Tracked click-to-chat, so it replaces the generic
              // channel mode rather than sitting beside it (§4.7).
              whatsApp: canEditContact && fieldEnabled("contact_telephone")
                ? {
                    endpoint: `/whatsapp/contacts/${contact.contact_id}/click`,
                    phone: contact.contact_telephone,
                    canCreateTask: canViewTasks && canCreateTasks,
                    onLogged: async () => {
                      await summaryQuery.refetch();
                    },
                  }
                : undefined,
            }}
          />
        ) : undefined}
        tasks={contact && canViewTasks ? (
          <RecordTasksPanel
            moduleKey="sales_contacts"
            entityId={contact.contact_id}
            sourceLabel={contactName}
            canCreate={canCreateTasks}
            canEdit={canEditTasks}
            createActionVariant="outline"
          />
        ) : undefined}
        files={contact && canViewDocuments ? (
          <RecordDocumentsPanel
            moduleKey="sales_contacts"
            entityId={contact.contact_id}
            canUpload={canCreateDocuments && canEditContact}
            canEdit={canEditDocuments && canEditContact}
            canDelete={canDeleteDocuments && canEditContact}
          />
        ) : undefined}
        extraTabs={summary ? [
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
        ] : []}
      />
      {summary && canCreateOpportunityHere ? (
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
    </>
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
          <PanelError message="The contact details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading contact details…" />
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={layoutValues}
      customValues={summary.contact.custom_fields ?? {}}
      omitFieldKeys={SPINE_OWNED_FIELDS}
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
                  className="block rounded-[var(--radius-control)] border border-line-subtle px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-muted"
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
                className="block rounded-[var(--radius-control)] border border-line-subtle px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-muted"
              >
                <div className="text-sm font-semibold text-copy-primary">{quote.quote_number}</div>
                <div className="mt-1 text-sm text-copy-muted">
                  {quote.title || quote.customer_name} · {quote.status || "Unknown status"}
                </div>
                <div className="mt-2 text-sm text-copy-secondary">
                  <Money amount={quote.total_amount} currency={quote.currency} />
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

function safeExternalUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
