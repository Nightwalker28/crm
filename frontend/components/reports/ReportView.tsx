"use client";

import { forwardRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/Card";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { StatGroup, StatTile } from "@/components/ui/StatTile";
import { fetchReportRecords, formatMeasureValue, runReport, serializeReportConfig, type ReportConfig, type ReportModule } from "@/lib/reports";
import { ReportChart } from "./ReportChart";
import { ReportRecordsPanel, type ReportDrill } from "./ReportRecordsPanel";
import { ReportRecordsTable, ReportResultTable } from "./ReportResultTable";

/**
 * A report, run: the totals, the chart and the table, and the drill-down panel. The viewer
 * page and the builder's live preview are the same component, so what the builder shows is
 * exactly what the saved report will show.
 */
export const ReportView = forwardRef<HTMLDivElement, {
  module: ReportModule;
  config: ReportConfig;
  /** The builder reruns as the definition changes; it keeps the last result on screen. */
  preview?: boolean;
  hasFilters?: boolean;
  onClearFilters?: () => void;
}>(function ReportView({ module, config, preview = false, hasFilters, onClearFilters }, chartRef) {
  const [drill, setDrill] = useState<ReportDrill | null>(null);
  const isTabular = config.format === "tabular";
  // The key is the definition as the server receives it, so a UI-only change (the filter
  // panel opening) does not rerun the report.
  const configKey = JSON.stringify(serializeReportConfig(config));
  const runQuery = useQuery({
    queryKey: ["report-run", module.module_key, configKey],
    queryFn: () => runReport(module.module_key, config),
    enabled: !isTabular,
    placeholderData: preview ? keepPreviousData : undefined,
  });

  if (isTabular) {
    return <TabularReport key={configKey} module={module} config={config} configKey={configKey} />;
  }
  if (runQuery.isLoading) return <Card className="p-4"><PanelLoading label="Running the report…" /></Card>;
  if (runQuery.isError || !runQuery.data) {
    return (
      <Card className="p-4">
        <PanelError
          message={preview ? "This report could not run. Check the grouping and measures, then try again." : "This report could not be run. Try again."}
          onRetry={() => void runQuery.refetch()}
        />
      </Card>
    );
  }

  const result = runQuery.data;
  const chartType = result.config.chart.type;
  // A metric is the totals row above, so it draws no second figure.
  const showChart = chartType !== "none" && chartType !== "metric" && result.rows.length > 0 && result.groupings.length > 0;
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-busy={runQuery.isFetching || undefined}>
      <Card>
        <StatGroup label="Report totals">
          <StatTile label="Records" value={formatMeasureValue(result.totals.count, "number")} />
          {result.measures.filter((measure) => measure.aggregate !== "count").map((measure) => (
            <StatTile key={measure.key} label={measure.label} value={formatMeasureValue(result.totals.values[result.measures.indexOf(measure)], measure.field_type)} />
          ))}
        </StatGroup>
        {showChart ? (
          <div className="border-t border-line-subtle p-4">
            <ReportChart ref={chartRef} result={result} type={chartType} onSelect={(keys, label) => setDrill({ keys, label })} />
          </div>
        ) : null}
      </Card>
      {result.truncated ? (
        <p className="text-p-sm text-copy-muted">
          This report shows its first {result.row_groups.length} groups{result.config.format === "matrix" ? " and up to 12 columns" : ""}. Totals count every record. Narrow the filters to see the rest.
        </p>
      ) : null}
      {result.groupings.length ? (
        <ReportResultTable result={result} onDrill={(keys, label) => setDrill({ keys, label })} hasFilters={hasFilters} onClearFilters={onClearFilters} />
      ) : null}
      <ReportRecordsPanel moduleKey={module.module_key} moduleLabel={module.label} config={config} drill={drill} onClose={() => setDrill(null)} />
    </div>
  );
});

function TabularReport({ module, config, configKey }: { module: ReportModule; config: ReportConfig; configKey: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const query = useQuery({
    queryKey: ["report-records", module.module_key, configKey, "all", page, pageSize],
    queryFn: () => fetchReportRecords(module.module_key, config, null, (page - 1) * pageSize, pageSize),
    placeholderData: keepPreviousData,
  });
  return (
    <ReportRecordsTable
      records={query.data}
      label={`${module.label} report`}
      page={page}
      pageSize={pageSize}
      onPageChange={setPage}
      onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
      isLoading={query.isLoading}
      isRefreshing={query.isFetching && !query.isLoading}
      hasError={query.isError}
      onRetry={() => void query.refetch()}
    />
  );
}
