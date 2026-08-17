"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Pencil, Plus, StickyNote } from "lucide-react";
import { toast } from "sonner";

import { ContactQuickCreate } from "@/components/contacts/ContactQuickCreate";
import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
import { OpportunityQuickCreate } from "@/components/opportunities/OpportunityQuickCreate";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
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
type RelatedQuote = {
  quote_id: number;
  quote_number: string;
  title?: string | null;
  customer_name: string;
  status?: string | null;
  currency?: string | null;
  total_amount?: number | string | null;
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
type RelatedOrder = {
  id: number;
  order_number: string;
  status: string;
  currency: string;
  grand_total: number | string;
  updated_at?: string | null;
};
type RelatedInvoice = {
  id: number;
  invoice_number: string;
  status: string;
  payment_status: string;
  currency: string;
  total_amount: number | string;
  updated_at?: string | null;
};
type OrganizationSummary = {
  organization: {
    org_id: number;
    org_name: string;
    assigned_to?: number | null;
    assigned_to_name?: string | null;
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
    customer_group_id?: number | null;
    customer_group?: CustomerGroup | null;
    custom_fields?: Record<string, unknown> | null;
    created_time?: string | null;
    updated_at?: string | null;
  };
  related_contacts: RelatedContact[];
  related_opportunities: RelatedOpportunity[];
  related_quotes: RelatedQuote[];
  related_orders: RelatedOrder[];
  related_invoices: RelatedInvoice[];
  related_insertion_orders: RelatedInsertionOrder[];
  inferred_services: string[];
  contact_count: number;
  opportunity_count: number;
  quote_count: number;
  order_count: number;
  invoice_count: number;
  insertion_order_count: number;
};

class OrganizationSummaryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function fetchOrganizationSummary(orgId: string) {
  const res = await apiFetch(`/sales/organizations/${orgId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new OrganizationSummaryRequestError(body?.detail ?? `Failed with ${res.status}`, res.status);
  }
  return body as OrganizationSummary;
}

function focusWorkspaceControl(regionId: string, controlId: string) {
  const region = document.getElementById(regionId);
  region?.scrollIntoView({ block: "start" });
  window.requestAnimationFrame(() => document.getElementById(controlId)?.focus());
}

export default function OrganizationDetailPage() {
  const params = useParams<{ orgId: string }>();
  const searchParams = useSearchParams();
  const [taskCreateRequestId, setTaskCreateRequestId] = useState(0);
  const [contactQuickCreateOpen, setContactQuickCreateOpen] = useState(false);
  const [dealQuickCreateOpen, setDealQuickCreateOpen] = useState(false);
  const contactQuickCreateTriggerRef = useRef<HTMLButtonElement>(null);
  const dealQuickCreateTriggerRef = useRef<HTMLButtonElement>(null);

  const { modules } = useAccessibleModules();
  const moduleActions = (moduleKey: string) =>
    modules.find((module) => module.name === moduleKey)?.actions;
  const organizationActions = moduleActions("sales_organizations");
  const contactActions = moduleActions("sales_contacts");
  const opportunityActions = moduleActions("sales_opportunities");
  const taskActions = moduleActions("tasks");
  const documentActions = moduleActions("documents");
  const canEditOrganization = Boolean(organizationActions?.can_edit);
  const canDeleteOrganization = Boolean(organizationActions?.can_delete);
  const canViewContacts = Boolean(contactActions?.can_view);
  const canViewOpportunities = Boolean(opportunityActions?.can_view);
  const canViewTasks = Boolean(taskActions?.can_view);
  const canCreateTasks = Boolean(taskActions?.can_create);
  const canEditTasks = Boolean(taskActions?.can_edit);
  const canViewDocuments = Boolean(documentActions?.can_view);
  const canCreateDocuments = Boolean(documentActions?.can_create);
  const canEditDocuments = Boolean(documentActions?.can_edit);
  const canDeleteDocuments = Boolean(documentActions?.can_delete);
  // Contextual creation links the new record to this account, so both the create right on the
  // target module and view access to this one are required. The endpoints enforce the same pair.
  const canCreateContactHere = Boolean(contactActions?.can_create) && Boolean(organizationActions?.can_view);
  const canCreateOpportunityHere = Boolean(opportunityActions?.can_create) && Boolean(organizationActions?.can_view);

  const {
    fields: moduleFields,
    isLoading: moduleFieldsLoading,
    error: moduleFieldsError,
  } = useModuleFieldConfigs("sales_organizations");
  const fieldConfigsReady = !moduleFieldsLoading && !moduleFieldsError;
  const fieldEnabled = (key: string) => fieldConfigsReady && isModuleFieldEnabled(moduleFields, key);

  const customerGroupsQuery = useCustomerGroups();
  const { assignOrganizationGroup, isAssigningCustomerGroup } = useClientPortalActions();
  const summaryQuery = useQuery({
    queryKey: ["sales-organization-summary", params.orgId],
    queryFn: () => fetchOrganizationSummary(params.orgId),
    enabled: Boolean(params.orgId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_organizations", "detail");

  const summary = summaryQuery.data ?? null;
  const summaryError = summaryQuery.error;
  const accountName = summary?.organization.org_name || "Account";
  const requestedTab = searchParams.get("tab");

  // Notes used to be a tab. Old links now scroll to the region that replaced it.
  useEffect(() => {
    if (!summary || requestedTab !== "notes") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("account-notes")?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestedTab, summary]);

  async function handleAssignCustomerGroup(value: string) {
    if (!summary) return;
    try {
      const groupId = value === "none" ? null : Number(value);
      const valid =
        groupId === null
        || (Number.isInteger(groupId) && (customerGroupsQuery.data ?? []).some((group) => group.id === groupId));
      if (!valid) throw new Error("Select a valid customer group.");
      await assignOrganizationGroup({
        organizationId: summary.organization.org_id,
        customerGroupId: groupId,
      });
      await summaryQuery.refetch();
      toast.success("Customer group updated.");
    } catch {
      toast.error("Customer group could not be updated. Try again.");
    }
  }

  return (
    <RecordWorkspace title={accountName} description="Review account ownership, contacts, commercial activity, transactions, and documents.">
      {!summary ? (
        <RecordPageHeader
          backHref="/dashboard/sales/organizations"
          backLabel="Back to Accounts"
        />
      ) : null}

      {summaryError instanceof OrganizationSummaryRequestError && summaryError.status === 403 ? (
        <PermissionDeniedState titleAs="p" />
      ) : summaryError instanceof OrganizationSummaryRequestError && summaryError.status === 404 ? (
        <RouteNotFoundState
          titleAs="p"
          recordLabel="Account"
          backHref="/dashboard/sales/organizations"
          backLabel="Back to accounts"
        />
      ) : summaryError ? (
        <RouteErrorState
          titleAs="p"
          title="Unable to load this account"
          reset={() => void summaryQuery.refetch()}
          backHref="/dashboard/sales/organizations"
          backLabel="Back to accounts"
        />
      ) : summaryQuery.isLoading || !summary ? (
        <RouteLoadingState label="account" />
      ) : (
        <>
          <RecordWorkspaceHeader
            title={accountName}
            pageHeader={(
              <RecordPageHeader
                backHref="/dashboard/sales/organizations"
                backLabel="Back to Accounts"
                primaryAction={(
                  <>
                    {canDeleteOrganization ? (
                      <RecordDeleteButton
                        endpoint={`/sales/organizations/${params.orgId}`}
                        label="Account"
                        recordName={accountName}
                        redirectHref="/dashboard/sales/organizations"
                        queryKeys={["sales-organizations"]}
                      />
                    ) : null}
                    {canEditOrganization ? (
                      <Button asChild variant="outline">
                        <Link href={`/dashboard/sales/organizations/${params.orgId}/edit`}>
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
                {summary.organization.primary_email ? <span>{summary.organization.primary_email}</span> : null}
                {fieldEnabled("primary_phone") && summary.organization.primary_phone ? (
                  <span>{summary.organization.primary_phone}</span>
                ) : null}
                {fieldEnabled("industry") && summary.organization.industry ? (
                  <span>{summary.organization.industry}</span>
                ) : null}
                {fieldEnabled("assigned_to") ? (
                  <span>Owner: {summary.organization.assigned_to_name || "Unassigned"}</span>
                ) : null}
              </>
            )}
            actions={(
              <>
                <CommunicationActions
                  email={summary.organization.primary_email}
                  phone={fieldEnabled("primary_phone") ? summary.organization.primary_phone : null}
                  showCopyActions={false}
                />
                {canCreateContactHere ? (
                  <Button
                    ref={contactQuickCreateTriggerRef}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setContactQuickCreateOpen(true)}
                  >
                    <Plus />
                    Contact
                  </Button>
                ) : null}
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
                {canEditOrganization ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      focusWorkspaceControl(
                        "account-notes",
                        `record-note-sales_organizations-${summary.organization.org_id}`,
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
                      document.getElementById("account-tasks")?.scrollIntoView({ block: "start" });
                    }}
                  >
                    <CheckSquare />
                    Task
                  </Button>
                ) : null}
              </>
            )}
            updatedLabel={(
              <>
                Updated{" "}
                {summary.organization.updated_at
                  ? formatDateTime(summary.organization.updated_at)
                  : "Not recorded"}
              </>
            )}
          />

          {canCreateContactHere ? (
            <ContactQuickCreate
              open={contactQuickCreateOpen}
              onOpenChange={setContactQuickCreateOpen}
              returnFocusRef={contactQuickCreateTriggerRef}
              onCreated={() => void summaryQuery.refetch()}
              context={{
                sourceModuleKey: "sales_organizations",
                sourceEntityId: summary.organization.org_id,
                relationshipIntent: "account_contact",
                defaults: {
                  organization_id: summary.organization.org_id,
                  organization_name: summary.organization.org_name,
                },
              }}
            />
          ) : null}

          {canCreateOpportunityHere ? (
            <OpportunityQuickCreate
              open={dealQuickCreateOpen}
              onOpenChange={setDealQuickCreateOpen}
              returnFocusRef={dealQuickCreateTriggerRef}
              onCreated={() => void summaryQuery.refetch()}
              context={{
                sourceModuleKey: "sales_organizations",
                sourceEntityId: summary.organization.org_id,
                relationshipIntent: "account_deal",
                defaults: {
                  organization_id: summary.organization.org_id,
                  organization_name: summary.organization.org_name,
                  opportunity_name: `${summary.organization.org_name} — new deal`,
                },
              }}
            />
          ) : null}

          <RecordWorkspacePrimary
            relationshipRail={(
              fieldConfigsReady ? (
                <AccountRelationshipContext
                  summary={summary}
                  fieldEnabled={fieldEnabled}
                  customerGroups={customerGroupsQuery.data ?? []}
                  customerGroupsLoading={customerGroupsQuery.isLoading}
                  customerGroupSaving={isAssigningCustomerGroup}
                  canEditCustomerGroup={canEditOrganization}
                  onAssignCustomerGroup={(value) => void handleAssignCustomerGroup(value)}
                />
              ) : (
                <RecordRelationshipRail description="Ownership, commercial volume, and portal pricing context.">
                  <p className="text-p-sm text-copy-muted" role={moduleFieldsError ? "alert" : "status"}>
                    {moduleFieldsError ? "Relationship context is unavailable." : "Loading relationship context…"}
                  </p>
                </RecordRelationshipRail>
              )
            )}
          >
            {canViewContacts ? (
              <RecordWorkspaceRegion id="account-contacts">
                <AccountContactsPanel
                  contacts={summary.related_contacts}
                  canCreateContact={canCreateContactHere}
                  onCreateContact={() => setContactQuickCreateOpen(true)}
                />
              </RecordWorkspaceRegion>
            ) : null}
            {canViewTasks ? (
              <RecordWorkspaceRegion id="account-tasks">
                <RecordTasksPanel
                  moduleKey="sales_organizations"
                  entityId={summary.organization.org_id}
                  sourceLabel={accountName}
                  canCreate={canCreateTasks}
                  canEdit={canEditTasks}
                  createRequestId={taskCreateRequestId}
                  createActionVariant="outline"
                />
              </RecordWorkspaceRegion>
            ) : null}
            <RecordWorkspaceRegion id="account-notes">
              <RecordCommentsPanel
                moduleKey="sales_organizations"
                entityId={summary.organization.org_id}
                canEdit={canEditOrganization}
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
                  <AccountOverview
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
                    moduleKey="sales_organizations"
                    entityId={summary.organization.org_id}
                    canUpload={canCreateDocuments && canEditOrganization}
                    canEdit={canEditDocuments && canEditOrganization}
                    canDelete={canDeleteDocuments && canEditOrganization}
                  />
                ),
              }] : []),
              {
                id: "audit",
                label: "Audit history",
                content: (
                  <RecordActivityTimeline
                    moduleKey="sales_organizations"
                    entityId={summary.organization.org_id}
                    title="Audit history"
                    description="Chronological record changes and collaboration events for this account."
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

function AccountOverview({
  summary,
  layout,
  isLayoutLoading,
  layoutError,
  onRetryLayout,
}: {
  summary: OrganizationSummary;
  layout?: ResolvedRecordLayoutContract;
  isLayoutLoading: boolean;
  layoutError: Error | null;
  onRetryLayout: () => void;
}) {
  const org = summary.organization;
  const layoutValues: Record<string, unknown> = {
    ...org,
    assigned_to: org.assigned_to_name,
  };

  if (isLayoutLoading || !layout) {
    return (
      <Card className="px-5 py-5">
        {layoutError ? (
          <div role="alert">
            <h2 className="text-base font-semibold text-copy-primary">Account details are unavailable</h2>
            <p className="mt-1 text-p-sm text-copy-muted">The configurable details layout could not be loaded.</p>
            <Button className="mt-4" type="button" variant="outline" size="sm" onClick={onRetryLayout}>
              Try again
            </Button>
          </div>
        ) : (
          <div role="status" className="text-sm text-copy-muted">Loading account details…</div>
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={layoutValues}
      customValues={org.custom_fields ?? {}}
      renderValue={(field, value) => {
        if (field.field_key !== "website") return undefined;
        const href = safeExternalUrl(typeof value === "string" ? value : null);
        if (!href) return undefined;
        return (
          <Link href={href} target="_blank" rel="noopener noreferrer" className="text-action-primary hover:underline">
            {String(value)}
          </Link>
        );
      }}
    />
  );
}

function AccountRelationshipContext({
  summary,
  fieldEnabled,
  customerGroups,
  customerGroupsLoading,
  customerGroupSaving,
  canEditCustomerGroup,
  onAssignCustomerGroup,
}: {
  summary: OrganizationSummary;
  fieldEnabled: (key: string) => boolean;
  customerGroups: CustomerGroup[];
  customerGroupsLoading: boolean;
  customerGroupSaving: boolean;
  canEditCustomerGroup: boolean;
  onAssignCustomerGroup: (value: string) => void;
}) {
  const org = summary.organization;
  return (
    <RecordRelationshipRail description="Ownership, commercial volume, and portal pricing context.">
      {fieldEnabled("assigned_to") ? (
        <RecordRelationshipField label="Owner" value={org.assigned_to_name || "Unassigned"} />
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <SummaryTile label="Contacts" value={summary.contact_count} />
        <SummaryTile label="Deals" value={summary.opportunity_count} />
        <SummaryTile label="Quotes" value={summary.quote_count} />
        <SummaryTile label="Orders" value={summary.order_count} />
        <SummaryTile label="Invoices" value={summary.invoice_count} />
        <SummaryTile label="Insertion orders" value={summary.insertion_order_count} />
      </div>
      <RecordRelationshipField
        label="Services"
        value={summary.inferred_services.length ? summary.inferred_services.join(", ") : "No service history yet"}
      />
      <div>
        <div className="text-xs font-medium text-copy-label">Customer group</div>
        <Select
          value={org.customer_group_id ? String(org.customer_group_id) : "none"}
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
        <p className="mt-2 text-xs text-copy-muted">
          Client portal pricing uses this group where pricing rules are configured.
        </p>
      </div>
    </RecordRelationshipRail>
  );
}

function AccountContactsPanel({
  contacts,
  canCreateContact,
  onCreateContact,
}: {
  contacts: RelatedContact[];
  canCreateContact: boolean;
  onCreateContact: () => void;
}) {
  return (
    <Card className="px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-copy-primary">Contacts</h2>
          <p className="mt-1 text-p-sm text-copy-muted">People you work with at this account.</p>
        </div>
        {canCreateContact ? (
          <Button type="button" size="sm" variant="outline" onClick={onCreateContact}>
            <Plus />
            Contact
          </Button>
        ) : null}
      </div>
      <div className="mt-4 space-y-3">
        {contacts.length ? (
          contacts.map((contact) => (
            <Link
              key={contact.contact_id}
              href={`/dashboard/sales/contacts/${contact.contact_id}`}
              className="block rounded-[var(--radius-control)] border border-line-subtle px-4 py-3 transition-colors hover:border-line-strong hover:bg-surface-muted"
            >
              <div className="text-sm font-semibold text-copy-primary">
                {[contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.primary_email}
              </div>
              <div className="mt-1 text-sm text-copy-muted">
                {contact.current_title || contact.primary_email}
              </div>
            </Link>
          ))
        ) : (
          <p className="text-sm text-copy-muted">
            {canCreateContact
              ? "No contacts linked yet. Add the first one — this account is filled in for you."
              : "No contacts linked yet."}
          </p>
        )}
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
  summary: OrganizationSummary;
  canViewOpportunities: boolean;
  canCreateOpportunity: boolean;
  onCreateOpportunity: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canViewOpportunities ? (
        <RelatedCard
          title="Deals"
          empty="No related deals yet."
          action={
            canCreateOpportunity ? (
              <Button type="button" size="sm" variant="outline" onClick={onCreateOpportunity}>
                <Plus />
                Deal
              </Button>
            ) : null
          }
        >
          {summary.related_opportunities.map((deal) => (
            <RelatedLink
              key={deal.opportunity_id}
              href={`/dashboard/sales/opportunities/${deal.opportunity_id}`}
              title={deal.opportunity_name}
              detail={`${deal.sales_stage || "Unstaged"}${deal.expected_close_date ? ` · closes ${deal.expected_close_date}` : ""}`}
            />
          ))}
        </RelatedCard>
      ) : null}
      <RelatedCard title="Quotes" empty="No related quotes yet.">
        {summary.related_quotes.map((quote) => (
          <RelatedLink
            key={quote.quote_id}
            href={`/dashboard/sales/quotes/${quote.quote_id}`}
            title={quote.quote_number}
            detail={`${quote.status || "Unknown status"} · ${formatMoney(quote.total_amount, quote.currency)}`}
          />
        ))}
      </RelatedCard>
      <RelatedCard title="Orders" empty="No related orders yet.">
        {summary.related_orders.map((order) => (
          <RelatedLink
            key={order.id}
            href={`/dashboard/sales/orders/${order.id}`}
            title={order.order_number}
            detail={`${order.status || "Unknown status"} · ${formatMoney(order.grand_total, order.currency)}`}
          />
        ))}
      </RelatedCard>
      <RelatedCard title="Invoices" empty="No related invoices yet.">
        {summary.related_invoices.map((invoice) => (
          <RelatedLink
            key={invoice.id}
            href={`/dashboard/finance/pos/${invoice.id}`}
            title={invoice.invoice_number}
            detail={`${invoice.payment_status || invoice.status || "Unknown status"} · ${formatMoney(invoice.total_amount, invoice.currency)}`}
          />
        ))}
      </RelatedCard>
      <RelatedCard title="Insertion orders" empty="No related insertion orders yet.">
        {summary.related_insertion_orders.map((order) => (
          <RelatedLink
            key={order.id}
            href={`/dashboard/finance/insertion-orders/${order.id}`}
            title={order.io_number}
            detail={`${order.status || "Unknown status"} · ${formatMoney(order.total_amount, order.currency)}`}
          />
        ))}
      </RelatedCard>
    </div>
  );
}

function RelatedCard({
  title,
  empty,
  action,
  children,
}: {
  title: string;
  empty: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <Card className="px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-copy-primary">{title}</h2>
        {action}
      </div>
      <div className="mt-4 space-y-3">
        {items.length && items.some(Boolean) ? children : <p className="text-sm text-copy-muted">{empty}</p>}
      </div>
    </Card>
  );
}

function RelatedLink({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <Link
      href={href}
      className="block rounded-[var(--radius-control)] border border-line-subtle px-4 py-4 transition-colors hover:border-line-strong hover:bg-surface-muted"
    >
      <div className="text-sm font-semibold text-copy-primary">{title}</div>
      <div className="mt-1 text-sm text-copy-muted">{detail}</div>
    </Link>
  );
}

function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
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
