"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Edit3,
  Percent,
  UserRound,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  getOpportunityStageLabel,
  getOpportunityStageStyle,
  normalizeOpportunityStage,
  OPPORTUNITY_STAGE_ORDER,
} from "@/components/opportunities/opportunityStages";
import CommunicationActions from "@/components/recordActivity/CommunicationActions";
import CrmRecordActivitySection from "@/components/recordActivity/CrmRecordActivitySection";
import RecordDeleteButton from "@/components/recordActivity/RecordDeleteButton";
import RecordPageHeader from "@/components/recordActivity/RecordPageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { RecordTabs } from "@/components/ui/RecordTabs";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";

type OpportunitySummary = {
  opportunity: {
    opportunity_id: number;
    opportunity_name: string;
    client?: string | null;
    sales_stage?: string | null;
    assigned_to_name?: string | null;
    start_date?: string | null;
    expected_close_date?: string | null;
    probability_percent?: number | string | null;
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
    created_time?: string | null;
    updated_at?: string | null;
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

async function fetchSummary(id: string) {
  const res = await apiFetch(`/sales/opportunities/${id}/summary`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as OpportunitySummary;
}
function formatMoney(value?: number | string | null, currency?: string | null) {
  const amount = Number(value);
  return value !== null &&
    value !== undefined &&
    value !== "" &&
    Number.isFinite(amount)
    ? new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 2,
      }).format(amount)
    : "Not set";
}
function displayContact(summary: OpportunitySummary) {
  return (
    [summary.contact?.first_name, summary.contact?.last_name]
      .filter(Boolean)
      .join(" ") ||
    summary.contact?.primary_email ||
    summary.opportunity.client ||
    "Unnamed contact"
  );
}

export default function OpportunityDetailPage() {
  const params = useParams<{ opportunityId: string }>();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["sales-opportunity-summary", params.opportunityId],
    queryFn: () => fetchSummary(params.opportunityId),
    enabled: Boolean(params.opportunityId),
    refetchOnWindowFocus: false,
  });
  const summary = query.data;
  async function updateStage(stage: string) {
    if (
      !summary ||
      normalizeOpportunityStage(summary.opportunity.sales_stage) === stage
    )
      return;
    const previous = summary;
    queryClient.setQueryData(
      ["sales-opportunity-summary", params.opportunityId],
      {
        ...summary,
        opportunity: { ...summary.opportunity, sales_stage: stage },
      },
    );
    try {
      const res = await apiFetch(
        `/sales/opportunities/${params.opportunityId}/stage`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sales_stage: stage }),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["sales-opportunities"] }),
        queryClient.invalidateQueries({
          queryKey: ["sales-opportunities-pipeline-summary"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["sales-opportunity-summary", params.opportunityId],
        }),
      ]);
      toast.success(
        ["closed_won", "closed_lost"].includes(stage)
          ? "Deal closed."
          : "Deal stage updated.",
      );
    } catch {
      queryClient.setQueryData(
        ["sales-opportunity-summary", params.opportunityId],
        previous,
      );
      toast.error("Deal stage could not be updated. Try again.");
    }
  }
  if (query.isLoading) return <RouteLoadingState label="deal" />;
  if (!summary || query.error)
    return (
      <RouteErrorState
        title="Unable to load this deal"
        reset={() => void query.refetch()}
        backHref="/dashboard/sales/opportunities"
        backLabel="Back to deals"
      />
    );
  const opportunity = summary.opportunity;
  const stage = normalizeOpportunityStage(opportunity.sales_stage) || "lead";
  const stageStyle = getOpportunityStageStyle(stage);
  const overview = (
    <div className="grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={CircleDollarSign}
          label="Value"
          value={formatMoney(
            opportunity.total_cost_of_project,
            opportunity.currency_type,
          )}
        />
        <MetricCard
          icon={Percent}
          label="Probability"
          value={
            opportunity.probability_percent !== null &&
            opportunity.probability_percent !== undefined
              ? `${Number(opportunity.probability_percent)}%`
              : "Stage default"
          }
        />
        <MetricCard
          icon={CalendarClock}
          label="Expected close"
          value={
            opportunity.expected_close_date
              ? formatDateOnly(opportunity.expected_close_date)
              : "Not set"
          }
        />
        <MetricCard
          icon={UserRound}
          label="Owner"
          value={opportunity.assigned_to_name || "Unassigned"}
        />
      </div>
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-copy-primary">Stage progress</h2>
            <p className="mt-1 text-sm text-copy-muted">
              Move the deal through the pipeline as qualification advances.
            </p>
          </div>
          <Select
            value={stage}
            onValueChange={(value) => void updateStage(value)}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPPORTUNITY_STAGE_ORDER.map((item) => (
                <SelectItem key={item} value={item}>
                  {getOpportunityStageLabel(item)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2 sm:grid-cols-6">
          {OPPORTUNITY_STAGE_ORDER.map((item, index) => {
            const activeIndex = OPPORTUNITY_STAGE_ORDER.indexOf(
              stage as (typeof OPPORTUNITY_STAGE_ORDER)[number],
            );
            const active = item === stage;
            const complete =
              activeIndex >= 0 &&
              index < activeIndex &&
              !stage.startsWith("closed_");
            return (
              <button
                type="button"
                key={item}
                onClick={() => void updateStage(item)}
                className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${active ? "border-action-primary bg-action-primary-muted text-copy-primary" : complete ? "border-state-success/40 bg-state-success-muted text-copy-primary" : "border-line-default bg-surface-subtle text-copy-muted hover:border-line-strong"}`}
              >
                <span className="block font-medium">
                  {getOpportunityStageLabel(item)}
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold text-copy-primary">Customer context</h2>
          <div className="mt-4 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-copy-muted">
                Contact
              </div>
              {summary.contact ? (
                <Link
                  href={`/dashboard/sales/contacts/${summary.contact.contact_id}`}
                  className="mt-1 inline-block font-medium text-link hover:underline"
                >
                  {displayContact(summary)}
                </Link>
              ) : (
                <p className="mt-1 text-sm text-copy-secondary">
                  No linked contact
                </p>
              )}
              {summary.contact?.current_title ? (
                <p className="text-sm text-copy-muted">
                  {summary.contact.current_title}
                </p>
              ) : null}
              {summary.contact ? (
                <div className="mt-3">
                  <CommunicationActions
                    email={summary.contact.primary_email}
                    phone={summary.contact.contact_telephone}
                    followUpTargetId="deal-activity"
                  />
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-copy-muted">
                Account
              </div>
              {summary.organization ? (
                <Link
                  href={`/dashboard/sales/organizations/${summary.organization.org_id}`}
                  className="mt-1 inline-block font-medium text-link hover:underline"
                >
                  {summary.organization.org_name}
                </Link>
              ) : (
                <p className="mt-1 text-sm text-copy-secondary">
                  No linked account
                </p>
              )}
            </div>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold text-copy-primary">Delivery context</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Detail label="Campaign" value={opportunity.campaign_type} />
            <Detail label="Geography" value={opportunity.target_geography} />
            <Detail label="Audience" value={opportunity.target_audience} />
            <Detail
              label="Delivery format"
              value={opportunity.delivery_format}
            />
            <Detail label="Total leads" value={opportunity.total_leads} />
            <Detail label="Cost per lead" value={opportunity.cpl} />
          </dl>
          {opportunity.tactics ? (
            <div className="mt-4 border-t border-line-subtle pt-4">
              <div className="text-xs uppercase tracking-wide text-copy-muted">
                Tactics
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-copy-secondary">
                {opportunity.tactics}
              </p>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
  const related = (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
      <Card className="p-5">
        <h2 className="font-semibold text-copy-primary">Related quotes</h2>
        <p className="mt-1 text-sm text-copy-muted">
          Quotes explicitly linked to this deal.
        </p>
        <div className="mt-4 space-y-3">
          {summary.related_quotes.length ? (
            summary.related_quotes.map((quote) => (
              <Link
                key={quote.quote_id}
                href={`/dashboard/sales/quotes/${quote.quote_id}`}
                className="block rounded-md border border-line-default bg-surface-subtle px-4 py-3 hover:border-line-strong"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-copy-primary">
                      {quote.quote_number}
                    </div>
                    <div className="mt-1 text-sm text-copy-muted">
                      {quote.title || quote.customer_name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium text-copy-primary">
                      {formatMoney(quote.total_amount, quote.currency)}
                    </div>
                    <div className="mt-1 text-xs text-copy-muted">
                      {quote.status || "Unknown status"}
                    </div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <p className="rounded-md border border-dashed border-line-default px-4 py-8 text-center text-sm text-copy-muted">
              No quotes are linked yet.
            </p>
          )}
        </div>
      </Card>
      <Card className="p-5">
        <h2 className="font-semibold text-copy-primary">Inferred services</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {summary.inferred_services.length ? (
            summary.inferred_services.map((service) => (
              <Pill key={service}>{service}</Pill>
            ))
          ) : (
            <span className="text-sm text-copy-muted">
              No service details recorded.
            </span>
          )}
        </div>
        <div className="mt-6 border-t border-line-subtle pt-4 text-sm text-copy-muted">
          Last modified{" "}
          {opportunity.updated_at
            ? formatDateTime(opportunity.updated_at)
            : "date not recorded"}
        </div>
      </Card>
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <RecordPageHeader
        backHref="/dashboard/sales/opportunities"
        backLabel="Back to deals"
        title={opportunity.opportunity_name}
        description={`${summary.organization?.org_name || opportunity.client || "Unlinked customer"} · ${formatMoney(opportunity.total_cost_of_project, opportunity.currency_type)}`}
        primaryAction={
          <>
            <RecordDeleteButton
              endpoint={`/sales/opportunities/${params.opportunityId}`}
              label="Deal"
              recordName={opportunity.opportunity_name}
              redirectHref="/dashboard/sales/opportunities"
              queryKeys={[
                "sales-opportunities",
                "sales-opportunities-pipeline-summary",
              ]}
            />
            <Button asChild>
              <Link
                href={`/dashboard/sales/opportunities/${params.opportunityId}/edit`}
              >
                <Edit3 />
                Edit deal
              </Link>
            </Button>
          </>
        }
      />
      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <Pill
            bg={stageStyle.bg}
            text={stageStyle.text}
            border={stageStyle.border}
          >
            {getOpportunityStageLabel(stage)}
          </Pill>
          <CommunicationActions
            email={summary.contact?.primary_email}
            phone={summary.contact?.contact_telephone}
            followUpTargetId="deal-activity"
          />
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void updateStage("closed_won")}
              disabled={stage === "closed_won"}
            >
              <CheckCircle2 />
              Won
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void updateStage("closed_lost")}
              disabled={stage === "closed_lost"}
            >
              <XCircle />
              Lost
            </Button>
          </div>
        </div>
      </Card>
      <RecordTabs
        urlParam="tab"
        defaultTabId="overview"
        tabs={[
          { id: "overview", label: "Overview", content: overview },
          {
            id: "related",
            label: `Related (${summary.related_quotes.length})`,
            content: related,
          },
          {
            id: "activity",
            label: "Activity",
            content: (
              <div id="deal-activity" className="scroll-mt-6">
                <CrmRecordActivitySection
                  moduleKey="sales_opportunities"
                  entityId={opportunity.opportunity_id}
                  recordLabel="Deal-level"
                  taskSourceLabel={opportunity.opportunity_name}
                  followUp={{
                    endpoint: `/sales/opportunities/${opportunity.opportunity_id}/follow-up`,
                    lastContactedAt: opportunity.last_contacted_at,
                    lastContactedChannel: opportunity.last_contacted_channel,
                    email: summary.contact?.primary_email,
                    phone: summary.contact?.contact_telephone,
                    onLogged: async () => {
                      await query.refetch();
                    },
                  }}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CircleDollarSign;
  label: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-copy-muted">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div
        className="mt-2 truncate text-lg font-semibold text-copy-primary"
        title={value}
      >
        {value}
      </div>
    </Card>
  );
}
function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-copy-muted">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-copy-secondary">{value || "Not set"}</dd>
    </div>
  );
}
