import { formatSnakeCaseLabel } from "@/lib/module-display";
import type { ReactNode } from "react";
import { BarChart3, Filter, Lock, Users } from "lucide-react";

import { ListRow, RowList } from "@/components/ui/ListRow";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { StatGroup, StatTile } from "@/components/ui/StatTile";
import { seriesColor } from "@/lib/chartColors";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/currency";

export type CrmBucket = {
  key: string;
  label: string;
  count: number;
  value: number;
};

type OwnerPerformance = {
  owner_id?: number | null;
  owner_name: string;
  lead_count: number;
  deal_count: number;
  won_deal_count: number;
  quote_count: number;
  total_activity: number;
};

type CrmForecastBucket = {
  key: string;
  label: string;
  count: number;
  gross_pipeline_amount: number | string;
  weighted_pipeline_amount: number | string;
  commit_amount: number | string;
  best_case_amount: number | string;
  actual_revenue_amount: number | string;
};

export type CrmDashboardSummary = {
  period_days: number;
  modules?: Record<string, boolean>;
  lead_status: CrmBucket[];
  lead_sources: CrmBucket[];
  new_leads: number;
  deal_stages: CrmBucket[];
  pipeline_value: number;
  forecast_summary?: {
    weighted_pipeline_amount: number | string;
    gross_pipeline_amount: number | string;
    commit_amount: number | string;
    best_case_amount: number | string;
    actual_revenue_amount: number | string;
    open_opportunity_count: number;
    won_opportunity_count: number;
    by_stage: CrmForecastBucket[];
  } | null;
  won_deals: number;
  lost_deals: number;
  quote_status: CrmBucket[];
  overdue_follow_ups: number;
  upcoming_tasks: number;
  owner_performance: OwnerPerformance[];
};

export type CrmSummaryWidgetType =
  | "crm_snapshot"
  | "lead_status"
  | "deal_stages"
  | "quote_status"
  | "owner_performance"
  | "pipeline_funnel"
  | "weighted_forecast";

const CRM_WIDGET_TYPES = new Set<string>([
  "crm_snapshot",
  "lead_status",
  "deal_stages",
  "quote_status",
  "owner_performance",
  "pipeline_funnel",
  "weighted_forecast",
]);

export function isCrmSummaryWidget(type: string): type is CrmSummaryWidgetType {
  return CRM_WIDGET_TYPES.has(type);
}

// Zero, not `Not set`: a dashboard figure with no rows is a zero total rather than an
// absent field. Formatting is lib/currency.ts's (design.md 7.1).
export function formatDashboardCurrency(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  const safe = Number.isFinite(amount ?? NaN) ? (amount as number) : 0;
  return formatMoney(safe, DEFAULT_CURRENCY, { maximumFractionDigits: 0 }) ?? "";
}

/**
 * A bucket distribution is a single-series bar chart, so the bar takes the first series
 * colour and nothing else does: the label and the count stay in ink (R5). They were
 * `bg-state-success/70` — green for a count of lost deals as much as for won ones.
 */
function BucketList({ rows, emptyLabel }: { rows: CrmBucket[]; emptyLabel: string }) {
  const total = Math.max(rows.reduce((sum, row) => sum + row.count, 0), 1);
  if (!rows.length) return <PanelEmpty icon={BarChart3} title={emptyLabel} />;
  return (
    <ul className="space-y-3">
      {rows.slice(0, 5).map((row) => (
        <li key={row.key}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-copy-secondary">{formatSnakeCaseLabel(row.label)}</span>
            <span className="font-medium tabular-nums text-copy-primary">{row.count}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-raised" aria-hidden="true">
            <div
              className="h-1.5 rounded-full"
              style={{ width: `${Math.max(2, (row.count / total) * 100)}%`, backgroundColor: seriesColor(0) }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Stages, widest first. The indent that made it look like a funnel went: it offset each
 * bar by its *index*, so a stage's left edge encoded its position in the list and its width
 * encoded its count, and the two read as one quantity. A bar anchored to one baseline is the
 * only honest length comparison (dataviz: marks anchored to the baseline).
 */
function PipelineFunnel({ rows }: { rows: CrmBucket[] }) {
  const data = rows.filter((row) => row.key !== "closed_lost").slice(0, 6);
  const max = Math.max(...data.map((row) => row.count), 1);
  if (!data.length) return <PanelEmpty icon={Filter} title="No pipeline stage data yet" />;
  return (
    <ul className="space-y-3">
      {data.map((row) => (
        <li key={row.key} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
          <span className="truncate text-xs text-copy-muted">{formatSnakeCaseLabel(row.label)}</span>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium tabular-nums text-copy-primary">{row.count}</span>
              {row.value ? <span className="tabular-nums text-copy-secondary">{formatDashboardCurrency(row.value)}</span> : null}
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-raised" aria-hidden="true">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${Math.max(2, (row.count / max) * 100)}%`, backgroundColor: seriesColor(0) }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A line under a stat group: a name, its metadata, and an amount in ink. */
function AmountRow({ title, meta, amount }: { title: string; meta: string; amount: string }) {
  return (
    <ListRow
      title={title}
      meta={meta}
      trailing={<span className="text-sm font-medium text-copy-primary">{amount}</span>}
    />
  );
}

function WeightedForecast({ forecast }: { forecast: CrmDashboardSummary["forecast_summary"] | null }) {
  if (!forecast) return <div className="p-4"><PanelEmpty icon={BarChart3} title="No forecast data yet" /></div>;
  const rows = forecast.by_stage.slice(0, 5);
  return (
    <>
      <StatGroup label="Forecast totals" className="border-b border-line-subtle">
        <StatTile label="Weighted" value={formatDashboardCurrency(forecast.weighted_pipeline_amount)} context={`${forecast.open_opportunity_count} open deals`} />
        <StatTile label="Actual" value={formatDashboardCurrency(forecast.actual_revenue_amount)} context={`${forecast.won_opportunity_count} won this period`} />
        <StatTile label="Commit" value={formatDashboardCurrency(forecast.commit_amount)} context="Expected commitment" />
        <StatTile label="Best case" value={formatDashboardCurrency(forecast.best_case_amount)} context="Potential outcome" />
      </StatGroup>
      <div className="p-4">
        {rows.length ? (
          <RowList label="Weighted pipeline by stage">
            {rows.map((row) => (
              <AmountRow key={row.key} title={formatSnakeCaseLabel(row.label)} meta={`${row.count} opportunities`} amount={formatDashboardCurrency(row.weighted_pipeline_amount)} />
            ))}
          </RowList>
        ) : <PanelEmpty icon={BarChart3} title="No deals close in this period" />}
      </div>
    </>
  );
}

/**
 * The widgets whose content fills the panel edge to edge. A `StatGroup` carries its own cell
 * padding (§4.7 archetype 5), so the shell must not pad around it.
 */
export function isFlushCrmWidget(type: string) {
  return type === "crm_snapshot" || type === "weighted_forecast";
}

export function DashboardCrmWidget({
  type,
  summary,
  hasReportAccess,
  isLoading,
  isError,
  onRetry,
}: {
  type: CrmSummaryWidgetType;
  summary: CrmDashboardSummary | undefined;
  hasReportAccess: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  // A flush widget has no body padding, so its states supply the padding the shell would have.
  const padState = (state: ReactNode) => (isFlushCrmWidget(type) ? <div className="p-4">{state}</div> : state);
  if (!hasReportAccess) {
    return padState(<PanelEmpty icon={Lock} title="Reports access is required" description="Ask an administrator for access to reports to see this summary." />);
  }
  if (isLoading) return padState(<PanelLoading label="Loading CRM summary…" />);
  if (isError) return padState(<PanelError message="This CRM summary could not be loaded." onRetry={onRetry} />);
  if (!summary) return null;
  if (type === "crm_snapshot") {
    return (
      <StatGroup label="CRM snapshot">
        <StatTile label="New leads" value={summary.new_leads} context={`Last ${summary.period_days} days`} />
        <StatTile label="Pipeline value" value={formatDashboardCurrency(summary.pipeline_value)} context="Open deal stages" />
        <StatTile label="Won / lost" value={`${summary.won_deals} / ${summary.lost_deals}`} context="Closed deal outcomes" />
        <StatTile label="Overdue follow-ups" value={summary.overdue_follow_ups} context={`${summary.upcoming_tasks} upcoming this week`} />
      </StatGroup>
    );
  }
  if (type === "lead_status") return <BucketList rows={summary.lead_status} emptyLabel="No lead status data yet" />;
  if (type === "deal_stages") return <BucketList rows={summary.deal_stages} emptyLabel="No deal stage data yet" />;
  if (type === "quote_status") return <BucketList rows={summary.quote_status} emptyLabel="No quote status data yet" />;
  if (type === "pipeline_funnel") return <PipelineFunnel rows={summary.deal_stages} />;
  if (type === "weighted_forecast") return <WeightedForecast forecast={summary.forecast_summary ?? null} />;
  if (!summary.owner_performance.length) return <PanelEmpty icon={Users} title="No owner activity yet" />;
  return (
    <RowList label="Owner performance">
      {summary.owner_performance.slice(0, 5).map((owner) => (
        <AmountRow
          key={`${owner.owner_id ?? "unassigned"}-${owner.owner_name}`}
          title={owner.owner_name}
          meta={`${owner.lead_count} leads · ${owner.deal_count} deals · ${owner.quote_count} quotes`}
          amount={`${owner.won_deal_count} won`}
        />
      ))}
    </RowList>
  );
}
