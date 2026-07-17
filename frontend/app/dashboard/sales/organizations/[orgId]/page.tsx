"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, Pencil, StickyNote } from "lucide-react";
import { toast } from "sonner";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
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

async function fetchOrganizationSummary(orgId: string) {
  const res = await apiFetch(`/sales/organizations/${orgId}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as OrganizationSummary;
}

export default function OrganizationDetailPage() {
  const params = useParams<{ orgId: string }>();
  const { fields: moduleFields } = useModuleFieldConfigs("sales_organizations");
  const fieldEnabled = (key: string) => isModuleFieldEnabled(moduleFields, key);
  const customerGroupsQuery = useCustomerGroups();
  const { assignOrganizationGroup, isAssigningCustomerGroup } =
    useClientPortalActions();
  const summaryQuery = useQuery({
    queryKey: ["sales-organization-summary", params.orgId],
    queryFn: () => fetchOrganizationSummary(params.orgId),
    enabled: Boolean(params.orgId),
    refetchOnWindowFocus: false,
  });
  const summary = summaryQuery.data ?? null;
  const accountName = summary?.organization.org_name || "Account";

  async function handleAssignCustomerGroup(value: string) {
    if (!summary) return;
    try {
      const groupId = value === "none" ? null : Number(value);
      const valid =
        groupId === null ||
        (Number.isInteger(groupId) &&
          (customerGroupsQuery.data ?? []).some(
            (group) => group.id === groupId,
          ));
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
    <div className="flex flex-col gap-6 text-copy-secondary">
      <RecordPageHeader
        backHref="/dashboard/sales/organizations"
        backLabel="Back to Accounts"
        title={accountName}
        description="Review account ownership, contacts, commercial activity, transactions, and documents."
        primaryAction={
          <>
            <RecordDeleteButton
              endpoint={`/sales/organizations/${params.orgId}`}
              label="Account"
              recordName={accountName}
              redirectHref="/dashboard/sales/organizations"
              queryKeys={["sales-organizations"]}
            />
            <Button asChild>
              <Link
                href={`/dashboard/sales/organizations/${params.orgId}/edit`}
              >
                <Pencil />
                Edit
              </Link>
            </Button>
          </>
        }
      />
      {summaryQuery.error ? (
        <RouteErrorState
          title="Unable to load this account"
          reset={() => void summaryQuery.refetch()}
          backHref="/dashboard/sales/organizations"
          backLabel="Back to accounts"
        />
      ) : null}
      {summaryQuery.isLoading || (!summary && !summaryQuery.error) ? (
        <RouteLoadingState label="account" />
      ) : null}
      {summary ? (
        <>
          <Card className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <CommunicationActions
                email={summary.organization.primary_email}
                phone={
                  fieldEnabled("primary_phone")
                    ? summary.organization.primary_phone
                    : null
                }
              />
              <Button asChild size="sm" variant="ghost">
                <Link href="?tab=notes" scroll={false}>
                  <StickyNote />
                  Note
                </Link>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <Link href="?tab=related" scroll={false}>
                  <CheckSquare />
                  Task
                </Link>
              </Button>
              <div className="ml-auto text-xs text-copy-muted">
                Updated:{" "}
                {summary.organization.updated_at
                  ? formatDateTime(summary.organization.updated_at)
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
                  <AccountOverview
                    summary={summary}
                    fieldEnabled={fieldEnabled}
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
                  <RecordActivityTimeline
                    moduleKey="sales_organizations"
                    entityId={summary.organization.org_id}
                    title="Account activity"
                    description="Recent account changes and collaboration events."
                  />
                ),
              },
              {
                id: "related",
                label: "Related records",
                content: <RelatedRecords summary={summary} />,
              },
              {
                id: "notes",
                label: "Notes",
                content: (
                  <RecordCommentsPanel
                    moduleKey="sales_organizations"
                    entityId={summary.organization.org_id}
                  />
                ),
              },
              {
                id: "files",
                label: "Files",
                content: (
                  <RecordDocumentsPanel
                    moduleKey="sales_organizations"
                    entityId={summary.organization.org_id}
                  />
                ),
              },
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
      ) : null}
    </div>
  );
}

function AccountOverview({
  summary,
  fieldEnabled,
  customerGroups,
  customerGroupsLoading,
  customerGroupSaving,
  onAssignCustomerGroup,
}: {
  summary: OrganizationSummary;
  fieldEnabled: (key: string) => boolean;
  customerGroups: CustomerGroup[];
  customerGroupsLoading: boolean;
  customerGroupSaving: boolean;
  onAssignCustomerGroup: (value: string) => void;
}) {
  const org = summary.organization;
  const address = [
    org.billing_address,
    org.billing_city,
    org.billing_state,
    org.billing_postal_code,
    org.billing_country,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <Card className="px-5 py-5">
        <h2 className="text-lg font-semibold text-copy-primary">
          Account details
        </h2>
        <p className="mt-1 text-sm text-copy-muted">
          Core company, ownership, and billing information.
        </p>
        <div className="mt-5 grid gap-x-6 gap-y-4 md:grid-cols-2">
          {fieldEnabled("primary_email") ? (
            <DetailField label="Primary email" value={org.primary_email} />
          ) : null}
          {fieldEnabled("secondary_email") ? (
            <DetailField label="Secondary email" value={org.secondary_email} />
          ) : null}
          {fieldEnabled("primary_phone") ? (
            <DetailField label="Primary phone" value={org.primary_phone} />
          ) : null}
          {fieldEnabled("secondary_phone") ? (
            <DetailField label="Secondary phone" value={org.secondary_phone} />
          ) : null}
          {fieldEnabled("website") ? (
            <DetailField
              label="Website"
              value={org.website}
              href={safeExternalUrl(org.website)}
              external
            />
          ) : null}
          {fieldEnabled("industry") ? (
            <DetailField label="Industry" value={org.industry} />
          ) : null}
          {fieldEnabled("annual_revenue") ? (
            <DetailField label="Annual revenue" value={org.annual_revenue} />
          ) : null}
          {fieldEnabled("assigned_to") ? (
            <DetailField label="Owner" value={org.assigned_to_name} />
          ) : null}
          {address ? (
            <div className="md:col-span-2">
              <DetailField label="Billing address" value={address} />
            </div>
          ) : null}
        </div>
        {Object.keys(org.custom_fields ?? {}).length ? (
          <details className="mt-5 border-t border-line-subtle pt-5">
            <summary className="cursor-pointer text-sm font-medium text-copy-primary">
              Custom fields
            </summary>
            <div className="mt-4 grid gap-x-6 gap-y-4 md:grid-cols-2">
              {Object.entries(org.custom_fields ?? {}).map(([key, value]) => (
                <DetailField
                  key={key}
                  label={key.replace(/_/g, " ")}
                  value={String(value ?? "")}
                />
              ))}
            </div>
          </details>
        ) : null}
      </Card>
      <div className="grid gap-4">
        <Card className="px-5 py-5">
          <h2 className="text-lg font-semibold text-copy-primary">
            Commercial summary
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SummaryTile label="Contacts" value={summary.contact_count} />
            <SummaryTile label="Deals" value={summary.opportunity_count} />
            <SummaryTile label="Quotes" value={summary.quote_count} />
            <SummaryTile label="Orders" value={summary.order_count} />
            <SummaryTile label="Invoices" value={summary.invoice_count} />
            <SummaryTile
              label="Insertion orders"
              value={summary.insertion_order_count}
            />
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
              org.customer_group_id ? String(org.customer_group_id) : "none"
            }
            onValueChange={onAssignCustomerGroup}
            disabled={customerGroupsLoading || customerGroupSaving}
          >
            <SelectTrigger className="mt-3">
              <SelectValue placeholder="Select customer group" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No group</SelectItem>
              {customerGroups.map((group) => (
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
          <p className="mt-2 text-xs text-copy-muted">
            Client portal pricing uses this group where pricing rules are
            configured.
          </p>
        </Card>
      </div>
    </div>
  );
}

function RelatedRecords({ summary }: { summary: OrganizationSummary }) {
  const org = summary.organization;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <RelatedCard title="Contacts" empty="No linked contacts yet.">
        {summary.related_contacts.map((contact) => (
          <RelatedLink
            key={contact.contact_id}
            href={`/dashboard/sales/contacts/${contact.contact_id}`}
            title={
              [contact.first_name, contact.last_name]
                .filter(Boolean)
                .join(" ") || contact.primary_email
            }
            detail={contact.current_title || contact.primary_email}
          />
        ))}
      </RelatedCard>
      <RelatedCard title="Deals" empty="No related deals yet.">
        {summary.related_opportunities.map((deal) => (
          <RelatedLink
            key={deal.opportunity_id}
            href={`/dashboard/sales/opportunities/${deal.opportunity_id}`}
            title={deal.opportunity_name}
            detail={`${deal.sales_stage || "Unstaged"}${deal.expected_close_date ? ` · closes ${deal.expected_close_date}` : ""}`}
          />
        ))}
      </RelatedCard>
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
      <RelatedCard
        title="Insertion orders"
        empty="No related insertion orders yet."
      >
        {summary.related_insertion_orders.map((order) => (
          <RelatedLink
            key={order.id}
            href={`/dashboard/finance/insertion-orders/${order.id}`}
            title={order.io_number}
            detail={`${order.status || "Unknown status"} · ${formatMoney(order.total_amount, order.currency)}`}
          />
        ))}
      </RelatedCard>
      <div className="lg:col-span-2">
        <RecordTasksPanel
          moduleKey="sales_organizations"
          entityId={org.org_id}
          sourceLabel={org.org_name}
        />
      </div>
    </div>
  );
}

function RelatedCard({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <Card className="px-5 py-5">
      <h2 className="text-lg font-semibold text-copy-primary">{title}</h2>
      <div className="mt-4 space-y-3">
        {items.length && items.some(Boolean) ? (
          children
        ) : (
          <p className="text-sm text-copy-muted">{empty}</p>
        )}
      </div>
    </Card>
  );
}
function RelatedLink({
  href,
  title,
  detail,
}: {
  href: string;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-md border border-line-subtle bg-surface-muted px-4 py-4 hover:border-line-strong"
    >
      <div className="text-sm font-semibold text-copy-primary">{title}</div>
      <div className="mt-1 text-sm text-copy-muted">{detail}</div>
    </Link>
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
function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
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
