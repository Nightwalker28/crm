"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { DashboardEmptyMessage } from "@/components/dashboard/DashboardOperationalWidgets";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { SavedViewFilters } from "@/hooks/useSavedViews";

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

const CHART_COLORS = ["#8bdbc1", "#7aa7ff", "#f2c86b", "#e58fb1", "#9fd56e", "#c2a5ff", "#f09568", "#6ed4e8"];

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

  if (!hasReportAccess) return <DashboardEmptyMessage>Reports access is required for saved report widgets.</DashboardEmptyMessage>;
  if (!savedReport) {
    return (
      <div className="space-y-3">
        <DashboardEmptyMessage>This saved report is no longer available.</DashboardEmptyMessage>
        <Button asChild variant="outline" size="sm"><Link href={DASHBOARD_ROUTES.reports}>Open Reports</Link></Button>
      </div>
    );
  }
  if (reportQuery.isLoading) return <div className="text-sm text-copy-muted">Loading report chart...</div>;
  if (reportQuery.isError) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/30 bg-state-danger-muted p-3 text-sm text-copy-secondary">
        <span>This saved report could not be loaded.</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void reportQuery.refetch()}>Retry</Button>
      </div>
    );
  }

  const report = reportQuery.data;
  const rows = report?.rows ?? [];
  const viewMode = savedReport.config.view_mode === "pie" ? "pie" : "bar";
  const valueLabel = savedReport.config.metric === "sum" ? report?.metric_field?.label ?? "Value" : "Records";

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium text-copy-primary">{savedReport.name}</div>
        <div className="mt-1 text-xs text-copy-muted">{getModuleDisplayName(savedReport.module_key)} / {report?.dimension.label ?? savedReport.config.dimension}</div>
      </div>
      {rows.length ? (
        <ChartContainer config={{ value: { label: valueLabel, color: CHART_COLORS[0] } }} className="h-64 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            {viewMode === "pie" ? (
              <PieChart>
                <Tooltip content={<ChartTooltipContent />} />
                <Pie data={rows} dataKey="value" nameKey="label" outerRadius="82%" innerRadius="48%" paddingAngle={2}>
                  {rows.map((row, index) => <Cell key={row.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Pie>
              </PieChart>
            ) : (
              <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 34 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" interval={0} tickLine={false} axisLine={false} angle={-22} textAnchor="end" height={48} />
                <YAxis tickLine={false} axisLine={false} width={42} />
                <Tooltip content={<ChartTooltipContent />} />
                <Bar dataKey="value" radius={[5, 5, 0, 0]}>
                  {rows.map((row, index) => <Cell key={row.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </ChartContainer>
      ) : <DashboardEmptyMessage>No report rows match this saved report.</DashboardEmptyMessage>}
    </div>
  );
}
