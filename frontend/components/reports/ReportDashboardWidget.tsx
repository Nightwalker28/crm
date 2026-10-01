"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { StatGroup, StatTile } from "@/components/ui/StatTile";
import { seriesColor } from "@/lib/chartColors";
import { applyDashboardFilters, UNAVAILABLE_COPY, type ReportDashboardFilters, type ReportDashboardWidget as Widget } from "@/lib/reportDashboards";
import { formatMeasureValue, reportHref, runReport, serializeReportConfig, upgradeReportConfig, type ReportModule, type ReportResult } from "@/lib/reports";
import { ReportChart } from "./ReportChart";
import { ReportRecordsPanel, type ReportDrill } from "./ReportRecordsPanel";
import { ReportResultTable } from "./ReportResultTable";

/** The heading a widget shows: its own title, else its report's name. */
export function dashboardWidgetTitle(widget: Widget) {
  return widget.title || widget.report?.name || "Report";
}

/**
 * One dashboard widget's body. The report runs as the person looking at the dashboard,
 * with the dashboard's filters laid over it, and every figure drills into its records,
 * as on the report page.
 */
export function ReportDashboardWidgetBody({ widget, modules, filters }: {
  widget: Widget;
  modules: ReportModule[];
  filters: ReportDashboardFilters;
}) {
  const [drill, setDrill] = useState<ReportDrill | null>(null);
  const report = widget.report ?? null;
  const reportModule = modules.find((item) => item.module_key === report?.module_key) ?? null;
  const config = report ? applyDashboardFilters(upgradeReportConfig(report.config), reportModule, filters) : null;
  const isList = config?.format === "tabular";
  const runQuery = useQuery({
    queryKey: ["report-run", report?.module_key, JSON.stringify(config ? serializeReportConfig(config) : null), "dashboard"],
    queryFn: () => runReport(report!.module_key, config!),
    enabled: Boolean(report && reportModule && config && !isList),
    staleTime: 60_000,
  });

  if (!report || !config) {
    const copy = UNAVAILABLE_COPY[widget.unavailable_reason ?? "missing"];
    return <PanelEmpty icon={EyeOff} title={copy.title} description={copy.description} />;
  }
  if (!reportModule) {
    const copy = UNAVAILABLE_COPY.no_access;
    return <PanelEmpty icon={EyeOff} title={copy.title} description={copy.description} />;
  }
  if (isList) {
    return (
      <PanelEmpty
        icon={BarChart3}
        title="This report is a list"
        description="A list has no chart or total to show here. Open it to see its records."
        action={<Button asChild variant="outline" size="sm"><Link href={reportHref(report.id)}>Open report</Link></Button>}
      />
    );
  }
  if (runQuery.isLoading) return <PanelLoading label="Running the report…" />;
  if (runQuery.isError || !runQuery.data) return <PanelError message="This report could not be run." onRetry={() => void runQuery.refetch()} />;

  const result = runQuery.data;
  const openDrill = (keys: string[], label: string) => setDrill({ keys, label });
  let content;
  if (widget.type === "kpi") {
    content = <KeyFigure result={result} target={widget.target} onOpen={() => openDrill([], "All records")} />;
  } else if (widget.type === "table") {
    content = <ReportResultTable result={result} onDrill={openDrill} />;
  } else if (!result.rows.length && result.groupings.length) {
    content = <PanelEmpty icon={BarChart3} title="No records match" description="Nothing in this report matches the dashboard's filters." />;
  } else {
    const chartType = widget.chart_type ?? (result.config.chart.type === "none" ? "column" : result.config.chart.type);
    content = <ReportChart result={result} type={chartType} onSelect={openDrill} className="h-64 w-full min-w-0" />;
  }

  return (
    <>
      {content}
      <ReportRecordsPanel moduleKey={reportModule.module_key} moduleLabel={reportModule.label} config={config} drill={drill} onClose={() => setDrill(null)} />
    </>
  );
}

/**
 * A report's first measure as one figure, with progress against a target when one is set
 * (Zoho's target meter, reduced to a bar). The bar is one series, so one colour, and the
 * figures beside it stay in ink.
 */
function KeyFigure({ result, target, onOpen }: { result: ReportResult; target: number | null; onOpen: () => void }) {
  const measure = result.measures[0];
  const value = measure?.aggregate === "count" ? result.totals.count : result.totals.values[0] ?? 0;
  const share = target ? Math.max(0, Math.min(1, (value ?? 0) / target)) : null;
  return (
    <div className="flex flex-col gap-3">
      <StatGroup label={`${result.label} key figure`} layout="stack">
        <StatTile
          label={measure?.label ?? "Records"}
          value={formatMeasureValue(value, measure?.field_type)}
          context={target ? `${Math.round(((value ?? 0) / target) * 100)}% of ${formatMeasureValue(target, measure?.field_type)} target` : `${formatMeasureValue(result.totals.count, "number")} records`}
        />
      </StatGroup>
      {share !== null ? (
        <div
          role="meter"
          aria-label="Progress to target"
          aria-valuemin={0}
          aria-valuemax={target ?? 0}
          aria-valuenow={value ?? 0}
          className="h-2 w-full overflow-hidden rounded-[var(--radius-control)] bg-surface-muted"
        >
          <div className="h-full rounded-[var(--radius-control)]" style={{ width: `${share * 100}%`, backgroundColor: seriesColor(0) }} />
        </div>
      ) : null}
      <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onOpen}>Show records</Button>
    </div>
  );
}
