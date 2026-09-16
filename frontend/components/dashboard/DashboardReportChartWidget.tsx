"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { BarChart3, Lock } from "lucide-react";

import { PanelEmpty, PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { CHART_AXIS_STROKE, CHART_GRID_STROKE, CHART_TICK_FILL, seriesColor } from "@/lib/chartColors";

type ReportField = {
  key: string;
  label: string;
  field_type: string;
};

type ReportRow = {
  key: string;
  label: string;
  count: number;
  value: number;
};

type ReportResponse = {
  module_key: string;
  dimension: ReportField;
  metric: string;
  metric_field?: ReportField | null;
  total_count: number;
  rows: ReportRow[];
};

type SavedReportConfig = {
  dimension: string;
  metric: "count" | "sum";
  metric_field?: string;
  filters?: SavedViewFilters;
  view_mode?: "table" | "bar" | "pie";
};

export type DashboardSavedReport = {
  id: number;
  module_key: string;
  name: string;
  config: SavedReportConfig;
  created_at: string;
  updated_at: string;
};

const DEFAULT_FILTERS: SavedViewFilters = {
  search: "",
  logic: "all",
  conditions: [],
  all_conditions: [],
  any_conditions: [],
};

export async function fetchDashboardSavedReports() {
  const res = await apiFetch("/reports/saved");
  if (!res.ok) throw new Error("saved-reports-unavailable");
  return res.json() as Promise<{ results: DashboardSavedReport[] }>;
}

function buildReportParams(config: SavedReportConfig) {
  const params = new URLSearchParams();
  params.set("dimension", config.dimension);
  params.set("metric", config.metric || "count");
  params.set("limit", "10");
  if (config.metric === "sum" && config.metric_field) params.set("metric_field", config.metric_field);
  appendSavedViewFilterParams(params, { ...DEFAULT_FILTERS, ...(config.filters ?? {}) });
  return params;
}

async function fetchReport(report: DashboardSavedReport) {
  const params = buildReportParams(report.config);
  const res = await apiFetch(`/reports/modules/${report.module_key}?${params.toString()}`);
  if (!res.ok) throw new Error("saved-report-chart-unavailable");
  return res.json() as Promise<ReportResponse>;
}

export function DashboardReportChartWidget({
  config,
  savedReports,
  hasReportAccess,
}: {
  config: Record<string, unknown> | undefined;
  savedReports: DashboardSavedReport[];
  hasReportAccess: boolean;
}) {
  const configuredId = config?.saved_report_id;
  const savedReportId = typeof configuredId === "number" ? configuredId : Number(configuredId || 0);
  const savedReport = savedReports.find((item) => item.id === savedReportId);
  const reportQuery = useQuery({
    queryKey: ["dashboard-report-chart", savedReportId],
    queryFn: () => fetchReport(savedReport as DashboardSavedReport),
    enabled: hasReportAccess && Boolean(savedReport),
    staleTime: 60000,
  });

  if (!hasReportAccess) {
    return <PanelEmpty icon={Lock} title="Reports access is required" description="Ask an administrator for access to reports to see this chart." />;
  }
  if (!savedReport) {
    return (
      <PanelEmpty
        icon={BarChart3}
        title="This saved report is no longer available"
        description="It may have been deleted. Remove this widget, or save the report again."
        action={<Button asChild variant="outline" size="sm"><Link href={DASHBOARD_ROUTES.reports}>Open reports</Link></Button>}
      />
    );
  }
  if (reportQuery.isLoading) return <PanelLoading label="Loading report…" />;
  if (reportQuery.isError) return <PanelError message="This saved report could not be loaded." onRetry={() => void reportQuery.refetch()} />;

  const report = reportQuery.data;
  const rows = report?.rows ?? [];
  const viewMode = savedReport.config.view_mode === "pie" ? "pie" : "bar";
  const valueLabel = savedReport.config.metric === "sum" ? report?.metric_field?.label ?? "Value" : "Records";

  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-copy-primary">{savedReport.name}</div>
        <div className="mt-1 truncate text-xs text-copy-muted">{getModuleDisplayName(savedReport.module_key)} by {report?.dimension.label ?? savedReport.config.dimension}</div>
      </div>
      {rows.length ? (
        <ChartContainer config={{ value: { label: valueLabel, color: seriesColor(0) } }} className="h-64 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            {viewMode === "pie" ? (
              <PieChart>
                <Tooltip content={<ChartTooltipContent />} />
                <Pie data={rows} dataKey="value" nameKey="label" outerRadius="82%" innerRadius="48%" paddingAngle={2}>
                  {rows.map((row, index) => <Cell key={row.key} fill={seriesColor(index)} />)}
                </Pie>
              </PieChart>
            ) : (
              <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 34 }}>
                <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
                <XAxis dataKey="label" interval={0} tickLine={false} axisLine={false} stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} angle={-22} textAnchor="end" height={48} />
                <YAxis tickLine={false} axisLine={false} stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} width={42} />
                <Tooltip content={<ChartTooltipContent />} />
                {/* One measure is one series, so one colour. Painting each bar its own hue
                    encoded rank as identity, and a filter that dropped a row repainted every
                    bar after it. */}
                <Bar dataKey="value" fill={seriesColor(0)} radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </ChartContainer>
      ) : <PanelEmpty icon={BarChart3} title="No rows match this report" description="The report's filters return nothing for the current data." />}
    </div>
  );
}
