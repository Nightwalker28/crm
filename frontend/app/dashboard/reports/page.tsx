"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, PieChart as PieChartIcon, Table2 } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { apiFetch } from "@/lib/api";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import type { ModuleFilterField } from "@/lib/moduleViewConfigs";

type ReportField = {
  key: string;
  label: string;
  field_type: string;
};

type ReportModule = {
  module_key: string;
  label: string;
  dimensions: ReportField[];
  metrics: ReportField[];
  filter_fields: ReportField[];
  default_dimension: string | null;
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

const DEFAULT_FILTERS: SavedViewFilters = {
  search: "",
  logic: "all",
  conditions: [],
  all_conditions: [],
  any_conditions: [],
};

const CHART_COLORS = ["#8bdbc1", "#7aa7ff", "#f2c86b", "#e58fb1", "#9fd56e", "#c2a5ff", "#f09568", "#6ed4e8"];

function toFilterField(field: ReportField): ModuleFilterField {
  return {
    key: field.key,
    label: field.label,
    type: field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : field.field_type === "boolean" || field.field_type === "select" ? "select" : "text",
  };
}

async function fetchReportModules() {
  const res = await apiFetch("/reports/modules");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<{ results: ReportModule[] }>;
}

async function fetchReport(moduleKey: string, dimension: string, metric: string, metricField: string, filters: SavedViewFilters) {
  const params = new URLSearchParams();
  params.set("dimension", dimension);
  params.set("metric", metric);
  params.set("limit", "20");
  if (metric === "sum" && metricField) params.set("metric_field", metricField);
  appendSavedViewFilterParams(params, filters);
  const res = await apiFetch(`/reports/modules/${moduleKey}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<ReportResponse>;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export default function ReportsPage() {
  const [moduleKey, setModuleKey] = useState("");
  const [dimension, setDimension] = useState("");
  const [metric, setMetric] = useState<"count" | "sum">("count");
  const [metricField, setMetricField] = useState("");
  const [filters, setFilters] = useState<SavedViewFilters>(DEFAULT_FILTERS);
  const [viewMode, setViewMode] = useState<"table" | "bar" | "pie">("bar");

  const modulesQuery = useQuery({ queryKey: ["report-modules"], queryFn: fetchReportModules, staleTime: 5 * 60_000 });
  const modules = modulesQuery.data?.results ?? [];
  const selectedModule = modules.find((item) => item.module_key === moduleKey) ?? modules[0] ?? null;
  const activeModuleKey = selectedModule?.module_key ?? "";
  const activeDimension = dimension || selectedModule?.default_dimension || selectedModule?.dimensions[0]?.key || "";
  const activeMetricField = metricField || selectedModule?.metrics[0]?.key || "";

  const filterFields = useMemo(() => (selectedModule?.filter_fields ?? []).map(toFilterField), [selectedModule]);
  const reportQuery = useQuery({
    queryKey: ["module-report", activeModuleKey, activeDimension, metric, activeMetricField, filters],
    queryFn: () => fetchReport(activeModuleKey, activeDimension, metric, activeMetricField, filters),
    enabled: Boolean(activeModuleKey && activeDimension && (metric === "count" || activeMetricField)),
  });
  const report = reportQuery.data;
  const chartData = report?.rows ?? [];
  const valueLabel = metric === "sum" ? report?.metric_field?.label ?? "Value" : "Records";

  function changeModule(nextModuleKey: string) {
    const nextModule = modules.find((item) => item.module_key === nextModuleKey);
    setModuleKey(nextModuleKey);
    setDimension(nextModule?.default_dimension || nextModule?.dimensions[0]?.key || "");
    setMetric("count");
    setMetricField(nextModule?.metrics[0]?.key || "");
    setFilters(DEFAULT_FILTERS);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 border-b border-neutral-800/80 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">Reports</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant={viewMode === "table" ? "default" : "outline"} size="sm" onClick={() => setViewMode("table")}>
            <Table2 className="h-4 w-4" />
            Table
          </Button>
          <Button type="button" variant={viewMode === "bar" ? "default" : "outline"} size="sm" onClick={() => setViewMode("bar")}>
            <BarChart3 className="h-4 w-4" />
            Bar
          </Button>
          <Button type="button" variant={viewMode === "pie" ? "default" : "outline"} size="sm" onClick={() => setViewMode("pie")}>
            <PieChartIcon className="h-4 w-4" />
            Pie
          </Button>
        </div>
      </div>

      <Card className="px-4 py-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Module
            <Select value={activeModuleKey} onValueChange={changeModule}>
              <SelectTrigger className="w-full border-neutral-700 bg-neutral-950 text-neutral-100">
                <SelectValue placeholder="Select module" />
              </SelectTrigger>
              <SelectContent className="border-neutral-800 bg-neutral-950 text-neutral-100">
                {modules.map((item) => (
                  <SelectItem key={item.module_key} value={item.module_key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Group By
            <Select value={activeDimension} onValueChange={setDimension} disabled={!selectedModule}>
              <SelectTrigger className="w-full border-neutral-700 bg-neutral-950 text-neutral-100">
                <SelectValue placeholder="Dimension" />
              </SelectTrigger>
              <SelectContent className="border-neutral-800 bg-neutral-950 text-neutral-100">
                {(selectedModule?.dimensions ?? []).map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Metric
            <Select value={metric} onValueChange={(value) => setMetric(value as "count" | "sum")}>
              <SelectTrigger className="w-full border-neutral-700 bg-neutral-950 text-neutral-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-neutral-800 bg-neutral-950 text-neutral-100">
                <SelectItem value="count">Record count</SelectItem>
                <SelectItem value="sum" disabled={!selectedModule?.metrics.length}>Sum field</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Sum Field
            <Select value={activeMetricField} onValueChange={setMetricField} disabled={metric !== "sum" || !selectedModule?.metrics.length}>
              <SelectTrigger className="w-full border-neutral-700 bg-neutral-950 text-neutral-100">
                <SelectValue placeholder="Numeric field" />
              </SelectTrigger>
              <SelectContent className="border-neutral-800 bg-neutral-950 text-neutral-100">
                {(selectedModule?.metrics ?? []).map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Search
            <Input
              value={typeof filters.search === "string" ? filters.search : ""}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search records"
              className="border-neutral-700 bg-neutral-950 text-neutral-100"
            />
          </label>
        </div>
      </Card>

      <InlineSavedViewFilters filterFields={filterFields} filters={filters} onChange={setFilters} />

      {reportQuery.error ? (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {(reportQuery.error as Error).message}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="min-h-[28rem] px-4 py-4">
          {viewMode === "table" ? (
            <ModuleTableShell className="min-h-[24rem] max-h-[24rem]" isRefreshing={reportQuery.isFetching && !reportQuery.isLoading}>
              <Table>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHead>{report?.dimension.label ?? "Group"}</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    <TableHead className="text-right">{valueLabel}</TableHead>
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {chartData.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium text-neutral-100">{row.label}</TableCell>
                      <TableCell className="text-right text-neutral-300">{formatNumber(row.count)}</TableCell>
                      <TableCell className="text-right text-neutral-300">{formatNumber(row.value)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ModuleTableShell>
          ) : (
            <div className="h-[24rem] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {viewMode === "pie" ? (
                  <PieChart>
                    <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 6 }} />
                    <Pie data={chartData} dataKey="value" nameKey="label" outerRadius="82%" innerRadius="52%" paddingAngle={2}>
                      {chartData.map((row, index) => (
                        <Cell key={row.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 42 }}>
                    <CartesianGrid stroke="#262626" vertical={false} />
                    <XAxis dataKey="label" stroke="#a3a3a3" tick={{ fill: "#a3a3a3", fontSize: 11 }} angle={-28} textAnchor="end" interval={0} height={58} />
                    <YAxis stroke="#a3a3a3" tick={{ fill: "#a3a3a3", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 6 }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {chartData.map((row, index) => (
                        <Cell key={row.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="px-4 py-4">
          <div className="space-y-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Records Matched</div>
              <div className="mt-2 text-3xl font-semibold text-neutral-100">{formatNumber(report?.total_count ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Buckets</div>
              <div className="mt-2 text-3xl font-semibold text-neutral-100">{formatNumber(chartData.length)}</div>
            </div>
            <div className="border-t border-neutral-800 pt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Top Result</div>
              <div className="mt-2 text-sm font-medium text-neutral-100">{chartData[0]?.label ?? "No data"}</div>
              <div className="mt-1 text-sm text-neutral-400">{formatNumber(chartData[0]?.value ?? 0)} {valueLabel.toLowerCase()}</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
