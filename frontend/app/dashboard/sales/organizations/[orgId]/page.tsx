"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";

import { ContactQuickCreate } from "@/components/contacts/ContactQuickCreate";
import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import { ReadOnlyRecordLayout } from "@/components/forms/ReadOnlyRecordLayout";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { InlineFieldEdit, type InlineFieldEditOption } from "@/components/ui/InlineFieldEdit";
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
import { EMPTY_CELL_VALUE } from "@/components/ui/EmptyValue";
import { formatDateTime } from "@/lib/datetime";
import { formatMoney } from "@/lib/currency";

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

/** Fields the spine owns, which `Details` must not draw a second time (design.md §4.7). */
const SPINE_OWNED_FIELDS = ["assigned_to", "customer_group_id"] as const;

const NO_GROUP = "none";

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

export default function OrganizationDetailPage() {
  const params = useParams<{ orgId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const activeTab = searchParams.get("tab");
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
  const { assignOrganizationGroup } = useClientPortalActions();
  const summaryQuery = useQuery({
    queryKey: ["sales-organization-summary", params.orgId],
    queryFn: () => fetchOrganizationSummary(params.orgId),
    enabled: Boolean(params.orgId),
    refetchOnWindowFocus: false,
  });
  const detailLayoutQuery = useResolvedRecordLayout("sales_organizations", "detail");

  const summary = summaryQuery.data ?? null;
  const org = summary?.organization;
  const summaryError = summaryQuery.error;
  const notFound =
    summaryError instanceof OrganizationSummaryRequestError && summaryError.status === 404;
  const accountName = org?.org_name || "Account";
  const recordHref = `/dashboard/sales/organizations/${params.orgId}`;
  const relatedHref = `${recordHref}?tab=related`;

  /** The account's one state field. Optimistic, and rolled back if the write fails (R1). */
  async function updateCustomerGroup(next: string) {
    if (!summary) return;
    const groupId = next === NO_GROUP ? null : Number(next);
    if (groupId !== null && !Number.isInteger(groupId)) return;
    const previous = summary;
    queryClient.setQueryData(["sales-organization-summary", params.orgId], {
      ...summary,
      organization: { ...summary.organization, customer_group_id: groupId },
    });
    try {
      await assignOrganizationGroup({
        organizationId: summary.organization.org_id,
        customerGroupId: groupId,
      });
      await queryClient.invalidateQueries({
        queryKey: ["record-audit-history", "sales_organizations", params.orgId],
      });
    } catch (error) {
      queryClient.setQueryData(["sales-organization-summary", params.orgId], previous);
      throw error;
    }
  }

  const customerGroups = customerGroupsQuery.data ?? [];
  const currentGroupId = org?.customer_group_id ?? null;
  const customerGroupOptions: InlineFieldEditOption[] = [
    { value: NO_GROUP, tone: null, label: "No group" },
    ...customerGroups
      .filter((group) => group.is_active || group.id === currentGroupId)
      .map((group) => ({ value: String(group.id), tone: null, label: group.name })),
  ];
  // The record arrives before the group list does; without this the rail shows the raw id
  // until that second request lands (`InlineFieldEdit` falls back to the unmatched value).
  if (currentGroupId && !customerGroupOptions.some((option) => option.value === String(currentGroupId))) {
    customerGroupOptions.push({
      value: String(currentGroupId),
      tone: null,
      label: org?.customer_group?.name ?? "Assigned group",
    });
  }

  return (
    <>
      <RecordWorkspace
        title={accountName}
        description="Review account ownership, contacts, commercial activity, transactions, and documents."
        backHref="/dashboard/sales/organizations"
        backLabel="Accounts"
        isPermissionDenied={
          summaryError instanceof OrganizationSummaryRequestError && summaryError.status === 403
        }
        isLoading={summaryQuery.isLoading || (!summary && !summaryError)}
        hasError={Boolean(summaryError)}
        onRetry={() => void summaryQuery.refetch()}
        errorState={notFound ? (
          <RouteNotFoundState
            titleAs="p"
            recordLabel="Account"
            backHref="/dashboard/sales/organizations"
            backLabel="Back to accounts"
          />
        ) : undefined}
        subtitle={org ? (
          <>
            {org.primary_email ? <span>{org.primary_email}</span> : null}
            {fieldEnabled("primary_phone") && org.primary_phone ? (
              <span>{org.primary_phone}</span>
            ) : null}
            {fieldEnabled("industry") && org.industry ? <span>{org.industry}</span> : null}
          </>
        ) : null}
        actions={org ? (
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
            {canCreateContactHere ? (
              <Button
                ref={contactQuickCreateTriggerRef}
                type="button"
                variant="outline"
                onClick={() => setContactQuickCreateOpen(true)}
              >
                <Plus />
                Contact
              </Button>
            ) : null}
            <CommunicationActions
              email={org.primary_email}
              phone={fieldEnabled("primary_phone") ? org.primary_phone : null}
              showCopyActions={false}
            />
            {canEditOrganization ? (
              <Button asChild variant="outline">
                <Link href={recordEditHref(`${recordHref}/edit`, activeTab)}>
                  <Pencil />
                  Edit
                </Link>
              </Button>
            ) : null}
          </>
        ) : null}
        overflowActions={org && canDeleteOrganization ? (
          <RecordDeleteButton
            as="menuItem"
            endpoint={`/sales/organizations/${params.orgId}`}
            label="Account"
            recordName={accountName}
            redirectHref="/dashboard/sales/organizations"
            queryKeys={["sales-organizations"]}
          />
        ) : null}
        spine={
          <RecordSpine>
            {summary && org ? (
              <>
                <RecordSpineBlock title="State">
                  <RecordSpineField label="Customer group">
                    {canEditOrganization ? (
                      <InlineFieldEdit
                        fieldLabel="Customer group"
                        value={currentGroupId ? String(currentGroupId) : NO_GROUP}
                        options={customerGroupOptions}
                        disabled={customerGroupsQuery.isLoading}
                        onCommit={(next) => updateCustomerGroup(next.value)}
                      />
                    ) : (
                      org.customer_group?.name ?? "No group"
                    )}
                  </RecordSpineField>
                </RecordSpineBlock>

                <RecordSpineBlock title="Connected">
                  {fieldEnabled("assigned_to") ? (
                    <RecordSpineLink label="Owner" value={org.assigned_to_name} />
                  ) : null}
                  {canViewContacts ? (
                    <RecordSpineCollection
                      label="Contacts"
                      count={summary.contact_count}
                      href={relatedHref}
                    />
                  ) : null}
                  {canViewOpportunities ? (
                    <RecordSpineCollection
                      label="Deals"
                      count={summary.opportunity_count}
                      href={relatedHref}
                    />
                  ) : null}
                  <RecordSpineCollection
                    label="Quotes"
                    count={summary.quote_count}
                    href={relatedHref}
                  />
                  <RecordSpineCollection
                    label="Orders"
                    count={summary.order_count}
                    href={relatedHref}
                  />
                  <RecordSpineCollection
                    label="Invoices"
                    count={summary.invoice_count}
                    href={relatedHref}
                  />
                  <RecordSpineCollection
                    label="Insertion orders"
                    count={summary.insertion_order_count}
                    href={relatedHref}
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
                  createdLabel={
                    org.created_time ? `Created ${formatDateTime(org.created_time)}` : undefined
                  }
                  updatedLabel={
                    org.updated_at ? `Updated ${formatDateTime(org.updated_at)}` : undefined
                  }
                  history={
                    <RecordAuditHistory moduleKey="sales_organizations" entityId={org.org_id} />
                  }
                />
              </>
            ) : null}
          </RecordSpine>
        }
        details={summary ? (
          <AccountOverview
            summary={summary}
            layout={detailLayoutQuery.data}
            isLayoutLoading={detailLayoutQuery.isLoading}
            layoutError={detailLayoutQuery.error}
            onRetryLayout={() => void detailLayoutQuery.refetch()}
          />
        ) : null}
        timeline={org ? (
          // An account has no follow-up endpoint — you call a person, not a company — so the
          // composer offers the note mode alone rather than channels that would post nowhere.
          <RecordTimeline
            moduleKey="sales_organizations"
            entityId={org.org_id}
            canEdit={canEditOrganization}
          />
        ) : undefined}
        tasks={org && canViewTasks ? (
          <RecordTasksPanel
            moduleKey="sales_organizations"
            entityId={org.org_id}
            sourceLabel={accountName}
            canCreate={canCreateTasks}
            canEdit={canEditTasks}
            createActionVariant="outline"
          />
        ) : undefined}
        files={org && canViewDocuments ? (
          <RecordDocumentsPanel
            moduleKey="sales_organizations"
            entityId={org.org_id}
            canUpload={canCreateDocuments && canEditOrganization}
            canEdit={canEditDocuments && canEditOrganization}
            canDelete={canDeleteDocuments && canEditOrganization}
          />
        ) : undefined}
        extraTabs={summary ? [
          {
            id: "related",
            label: "Related records",
            content: (
              <RelatedRecords
                summary={summary}
                canViewContacts={canViewContacts}
                canViewOpportunities={canViewOpportunities}
                canCreateContact={canCreateContactHere}
                canCreateOpportunity={canCreateOpportunityHere}
                onCreateContact={() => setContactQuickCreateOpen(true)}
                onCreateOpportunity={() => setDealQuickCreateOpen(true)}
              />
            ),
          },
        ] : []}
      />

      {summary && canCreateContactHere ? (
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

      {summary && canCreateOpportunityHere ? (
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
    </>
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
          <PanelError message="The account details layout could not be loaded." onRetry={onRetryLayout} />
        ) : (
          <PanelLoading label="Loading account details…" />
        )}
      </Card>
    );
  }

  return (
    <ReadOnlyRecordLayout
      layout={layout}
      values={layoutValues}
      customValues={org.custom_fields ?? {}}
      omitFieldKeys={SPINE_OWNED_FIELDS}
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

function RelatedRecords({
  summary,
  canViewContacts,
  canViewOpportunities,
  canCreateContact,
  canCreateOpportunity,
  onCreateContact,
  onCreateOpportunity,
}: {
  summary: OrganizationSummary;
  canViewContacts: boolean;
  canViewOpportunities: boolean;
  canCreateContact: boolean;
  canCreateOpportunity: boolean;
  onCreateContact: () => void;
  onCreateOpportunity: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {canViewContacts ? (
        <RelatedCard
          title="Contacts"
          empty={
            canCreateContact
              ? "No contacts linked yet. Add the first one — this account is filled in for you."
              : "No contacts linked yet."
          }
          action={
            canCreateContact ? (
              <Button type="button" size="sm" variant="outline" onClick={onCreateContact}>
                <Plus />
                Contact
              </Button>
            ) : null
          }
        >
          {summary.related_contacts.map((contact) => (
            <RelatedLink
              key={contact.contact_id}
              href={`/dashboard/sales/contacts/${contact.contact_id}`}
              title={
                [contact.first_name, contact.last_name].filter(Boolean).join(" ")
                || contact.primary_email
              }
              detail={contact.current_title || contact.primary_email}
            />
          ))}
        </RelatedCard>
      ) : null}
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
            detail={`${quote.status || "Unknown status"} · ${formatMoney(quote.total_amount, quote.currency) ?? EMPTY_CELL_VALUE}`}
          />
        ))}
      </RelatedCard>
      <RelatedCard title="Orders" empty="No related orders yet.">
        {summary.related_orders.map((order) => (
          <RelatedLink
            key={order.id}
            href={`/dashboard/sales/orders/${order.id}`}
            title={order.order_number}
            detail={`${order.status || "Unknown status"} · ${formatMoney(order.grand_total, order.currency) ?? EMPTY_CELL_VALUE}`}
          />
        ))}
      </RelatedCard>
      <RelatedCard title="Invoices" empty="No related invoices yet.">
        {summary.related_invoices.map((invoice) => (
          <RelatedLink
            key={invoice.id}
            href={`/dashboard/finance/pos/${invoice.id}`}
            title={invoice.invoice_number}
            detail={`${invoice.payment_status || invoice.status || "Unknown status"} · ${formatMoney(invoice.total_amount, invoice.currency) ?? EMPTY_CELL_VALUE}`}
          />
        ))}
      </RelatedCard>
      <RelatedCard title="Insertion orders" empty="No related insertion orders yet.">
        {summary.related_insertion_orders.map((order) => (
          <RelatedLink
            key={order.id}
            href={`/dashboard/finance/insertion-orders/${order.id}`}
            title={order.io_number}
            detail={`${order.status || "Unknown status"} · ${formatMoney(order.total_amount, order.currency) ?? EMPTY_CELL_VALUE}`}
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

function safeExternalUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
