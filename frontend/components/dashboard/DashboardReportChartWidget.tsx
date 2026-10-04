"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Lock } from "lucide-react";

import { ReportChart } from "@/components/reports/ReportChart";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { Button } from "@/components/ui/button";
import { fetchSavedReports, reportHref, runReport, upgradeReportConfig, type SavedReport } from "@/lib/reports";
import { DASHBOARD_ROUTES } from "@/lib/routes";

export type DashboardSavedReport = SavedReport;

export async function fetchDashboardSavedReports() {
  return fetchSavedReports();
}

/** A one-line summary of a saved report for the widget catalogue: "Deals by Owner". */
export function describeSavedReport(report: SavedReport) {
  const config = upgradeReportConfig(report.config);
  const reportModule = report.module_label ?? report.module_key;
  return config.format === "tabular" ? `${reportModule} list` : `${reportModule} report`;
}

/**
 * A saved report's chart on the home dashboard. It runs through the same engine as the
 * report page, as the person looking at the dashboard, so it can never show them more than
 * the report would.
 */
export function DashboardReportChartWidget({
  config,
  savedReports,
  hasReportAccess,
  isAccessLoading = false,
}: {
  config: Record<string, unknown> | undefined;
  savedReports: DashboardSavedReport[];
  hasReportAccess: boolean;
  /** The user's modules are still loading (or the session refreshing): not a denial (13a I2). */
  isAccessLoading?: boolean;
}) {
  const configuredId = config?.saved_report_id;
  const savedReportId = typeof configuredId === "number" ? configuredId : Number(configuredId || 0);
  const savedReport = savedReports.find((item) => item.id === savedReportId);
  const reportConfig = upgradeReportConfig(savedReport?.config);
  // A table-only or list report still charts on a dashboard, as columns.
  const chartType = reportConfig.chart.type === "none" ? "column" : reportConfig.chart.type;
  const chartable = reportConfig.format !== "tabular";
  const reportQuery = useQuery({
    queryKey: ["dashboard-report-chart", savedReportId, savedReport?.updated_at],
    queryFn: () => runReport(savedReport!.module_key, { ...reportConfig, limit: Math.min(reportConfig.limit, 12) }),
    enabled: hasReportAccess && Boolean(savedReport) && chartable,
    staleTime: 60000,
  });

  if (isAccessLoading) return <PanelLoading label="Loading chart…" />;
  if (!hasReportAccess) {
    return <PanelEmpty icon={Lock} title="Reports access is required" description="Ask an administrator for access to reports to see this chart." />;
  }
  if (!savedReport) {
    return (
      <PanelEmpty
        icon={BarChart3}
        title="This saved report is no longer available"
        description="It may have been deleted or is no longer shared with you. Remove this widget, or choose another report."
        action={<Button asChild variant="outline" size="sm"><Link href={DASHBOARD_ROUTES.reports}>Open reports</Link></Button>}
      />
    );
  }
  if (!chartable) {
    return (
      <PanelEmpty
        icon={BarChart3}
        title="This report is a list"
        description="A list has no chart. Open it to see its records."
        action={<Button asChild variant="outline" size="sm"><Link href={reportHref(savedReport.id)}>Open report</Link></Button>}
      />
    );
  }
  if (reportQuery.isLoading) return <PanelLoading label="Loading report…" />;
  if (reportQuery.isError || !reportQuery.data) return <PanelError message="This saved report could not be loaded." onRetry={() => void reportQuery.refetch()} />;

  const result = reportQuery.data;
  return (
    <div className="space-y-3">
      <div className="min-w-0">
        <Link href={reportHref(savedReport.id)} className="block truncate text-sm font-medium text-copy-primary underline-offset-2 hover:underline">{savedReport.name}</Link>
        <div className="mt-1 truncate text-xs text-copy-muted">
          {result.label}{result.groupings.length ? ` by ${result.groupings.map((grouping) => grouping.label.toLocaleLowerCase()).join(" and ")}` : ""}
        </div>
      </div>
      {result.rows.length || chartType === "metric" ? (
        <ReportChart result={result} type={chartType} className="h-64 w-full min-w-0" />
      ) : <PanelEmpty icon={BarChart3} title="No rows match this report" description="The report's filters return nothing for the current data." />}
    </div>
  );
}
