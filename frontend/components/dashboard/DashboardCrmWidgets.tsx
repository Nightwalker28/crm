import { Button } from "@/components/ui/button";
import { DashboardEmptyMessage } from "@/components/dashboard/DashboardOperationalWidgets";

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

export function formatDashboardCurrency(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount ?? NaN) ? amount ?? 0 : 0);
}

function Metric({ label, value, helper }: { label: string; value: string | number; helper: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-4">
      <div className="text-xs uppercase tracking-[0.16em] text-copy-muted">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-copy-primary">{value}</div>
      <div className="mt-1 text-sm text-copy-secondary">{helper}</div>
    </div>
  );
}

function BucketList({ rows, emptyLabel }: { rows: CrmBucket[]; emptyLabel: string }) {
  const total = Math.max(rows.reduce((sum, row) => sum + row.count, 0), 1);
  if (!rows.length) return <DashboardEmptyMessage>{emptyLabel}</DashboardEmptyMessage>;
  return (
    <div className="space-y-3">
      {rows.slice(0, 5).map((row) => (
        <div key={row.key}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-copy-secondary">{row.label}</span>
            <span className="font-medium text-copy-primary">{row.count}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-surface-raised">
            <div className="h-1.5 rounded-full bg-state-success/70" style={{ width: `${Math.max(6, (row.count / total) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PipelineFunnel({ rows }: { rows: CrmBucket[] }) {
  const data = rows.filter((row) => row.key !== "closed_lost").slice(0, 6);
  const max = Math.max(...data.map((row) => row.count), 1);
  if (!data.length) return <DashboardEmptyMessage>No pipeline stage data yet.</DashboardEmptyMessage>;
  return (
    <div className="space-y-2">
      {data.map((row, index) => {
        const width = Math.max(34, (row.count / max) * 100);
        return (
          <div key={row.key} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-xs text-copy-muted">{row.label}</div>
            <div className="min-w-0 flex-1">
              <div
                className="rounded-[var(--radius-control)] border border-state-success/20 bg-state-success-muted px-3 py-2 text-sm text-copy-primary"
                style={{ width: `${width}%`, marginLeft: `${Math.min(index * 3, 16)}%` }}
              >
                <span className="font-semibold">{row.count}</span>
                {row.value ? <span className="ml-2 text-state-success">{formatDashboardCurrency(row.value)}</span> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeightedForecast({ forecast }: { forecast: CrmDashboardSummary["forecast_summary"] | null }) {
  if (!forecast) return <DashboardEmptyMessage>No forecast data is available yet.</DashboardEmptyMessage>;
  const rows = forecast.by_stage.slice(0, 5);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Weighted" value={formatDashboardCurrency(forecast.weighted_pipeline_amount)} helper={`${forecast.open_opportunity_count} open deals`} />
        <Metric label="Actual" value={formatDashboardCurrency(forecast.actual_revenue_amount)} helper={`${forecast.won_opportunity_count} won this period`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Commit" value={formatDashboardCurrency(forecast.commit_amount)} helper="Expected pipeline commitment" />
        <Metric label="Best Case" value={formatDashboardCurrency(forecast.best_case_amount)} helper="Potential pipeline outcome" />
      </div>
      <div className="space-y-2">
        {rows.length ? rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-copy-primary">{row.label}</div>
              <div className="mt-1 text-xs text-copy-muted">{row.count} opportunities</div>
            </div>
            <div className="text-sm font-semibold text-state-success">{formatDashboardCurrency(row.weighted_pipeline_amount)}</div>
          </div>
        )) : <DashboardEmptyMessage>No open or won deals close in this period.</DashboardEmptyMessage>}
      </div>
    </div>
  );
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
  if (!hasReportAccess) {
    return <DashboardEmptyMessage>Reports access is required for this CRM summary widget.</DashboardEmptyMessage>;
  }
  if (isLoading) return <div className="text-sm text-copy-muted">Loading CRM summary...</div>;
  if (isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/30 bg-state-danger-muted p-3 text-sm text-copy-secondary">
        <span>This CRM summary could not be loaded.</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  if (!summary) return null;
  if (type === "crm_snapshot") {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric label="New Leads" value={summary.new_leads} helper={`Last ${summary.period_days} days`} />
        <Metric label="Pipeline Value" value={formatDashboardCurrency(summary.pipeline_value)} helper="Open deal stages" />
        <Metric label="Won / Lost" value={`${summary.won_deals} / ${summary.lost_deals}`} helper="Closed deal outcomes" />
        <Metric label="Follow-ups" value={summary.overdue_follow_ups} helper={`${summary.upcoming_tasks} upcoming this week`} />
      </div>
    );
  }
  if (type === "lead_status") return <BucketList rows={summary.lead_status} emptyLabel="No lead status data yet." />;
  if (type === "deal_stages") return <BucketList rows={summary.deal_stages} emptyLabel="No deal stage data yet." />;
  if (type === "quote_status") return <BucketList rows={summary.quote_status} emptyLabel="No quote status data yet." />;
  if (type === "pipeline_funnel") return <PipelineFunnel rows={summary.deal_stages} />;
  if (type === "weighted_forecast") return <WeightedForecast forecast={summary.forecast_summary ?? null} />;
  return (
    <div className="space-y-3">
      {summary.owner_performance.length ? summary.owner_performance.slice(0, 5).map((owner) => (
        <div key={`${owner.owner_id ?? "unassigned"}-${owner.owner_name}`} className="flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-copy-primary">{owner.owner_name}</div>
            <div className="mt-1 text-xs text-copy-muted">{owner.lead_count} leads / {owner.deal_count} deals / {owner.quote_count} quotes</div>
          </div>
          <div className="text-sm font-semibold text-state-success">{owner.won_deal_count} won</div>
        </div>
      )) : <DashboardEmptyMessage>No owner activity yet.</DashboardEmptyMessage>}
    </div>
  );
}
