"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Download, FileDown, PieChart as PieChartIcon, Save, Table2, Trash2 } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
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

type SavedReportConfig = {
  dimension: string;
  metric: "count" | "sum";
  metric_field: string;
  filters: SavedViewFilters;
  view_mode: "table" | "bar" | "pie";
};

type SavedReport = {
  id: number;
  module_key: string;
  name: string;
  config: SavedReportConfig;
  created_at: string;
  updated_at: string;
};

type ReportPreset = {
  key: string;
  label: string;
  description: string;
  module_key: string;
  dimension: string;
  metric: "count" | "sum";
  metric_field?: string;
  filters?: SavedViewFilters;
  view_mode: "table" | "bar" | "pie";
};

const DEFAULT_FILTERS: SavedViewFilters = {
  search: "",
  logic: "all",
  conditions: [],
  all_conditions: [],
  any_conditions: [],
};

const CRM_REPORT_MODULE_KEYS = new Set(["sales_leads", "sales_contacts", "sales_organizations", "sales_opportunities", "sales_quotes", "tasks"]);
const CRM_TASK_SOURCE_MODULE_KEYS = ["sales_leads", "sales_contacts", "sales_organizations", "sales_opportunities", "sales_quotes"];
const CHART_COLORS = ["#8bdbc1", "#7aa7ff", "#f2c86b", "#e58fb1", "#9fd56e", "#c2a5ff", "#f09568", "#6ed4e8"];

const CRM_REPORT_PRESETS: ReportPreset[] = [
  {
    key: "lead-funnel",
    label: "Lead funnel",
    description: "Leads grouped by lifecycle status.",
    module_key: "sales_leads",
    dimension: "status",
    metric: "count",
    view_mode: "bar",
  },
  {
    key: "deal-pipeline",
    label: "Deal pipeline",
    description: "Deals grouped by pipeline stage.",
    module_key: "sales_opportunities",
    dimension: "sales_stage",
    metric: "count",
    view_mode: "bar",
  },
  {
    key: "activity-follow-up",
    label: "Activity and follow-up",
    description: "Open CRM tasks grouped by status.",
    module_key: "tasks",
    dimension: "status",
    metric: "count",
    filters: {
      ...DEFAULT_FILTERS,
      logic: "all",
      all_conditions: [{ id: "crm-open-tasks", field: "status", operator: "is_not", value: "completed" }],
      any_conditions: CRM_TASK_SOURCE_MODULE_KEYS.map((moduleKey) => ({
        id: `crm-task-source-${moduleKey}`,
        field: "source_module_key",
        operator: "is",
        value: moduleKey,
      })),
    },
    view_mode: "bar",
  },
  {
    key: "quote-value",
    label: "Quote report",
    description: "Quote value grouped by status.",
    module_key: "sales_quotes",
    dimension: "status",
    metric: "sum",
    metric_field: "total_amount",
    view_mode: "bar",
  },
  {
    key: "owner-performance",
    label: "Owner performance",
    description: "Deals grouped by assigned owner.",
    module_key: "sales_opportunities",
    dimension: "assigned_to",
    metric: "count",
    view_mode: "bar",
  },
];

function cloneFilters(filters: SavedViewFilters = DEFAULT_FILTERS): SavedViewFilters {
  return {
    ...DEFAULT_FILTERS,
    ...filters,
    conditions: Array.isArray(filters.conditions) ? [...filters.conditions] : [],
    all_conditions: Array.isArray(filters.all_conditions) ? [...filters.all_conditions] : [],
    any_conditions: Array.isArray(filters.any_conditions) ? [...filters.any_conditions] : [],
  };
}

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
  const params = buildReportParams(dimension, metric, metricField, filters, 20);
  const res = await apiFetch(`/reports/modules/${moduleKey}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<ReportResponse>;
}

async function fetchSavedReports(moduleKey: string) {
  const params = new URLSearchParams();
  params.set("module_key", moduleKey);
  const res = await apiFetch(`/reports/saved?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<{ results: SavedReport[] }>;
}

async function createSavedReport(payload: { module_key: string; name: string; config: SavedReportConfig }) {
  const res = await apiFetch("/reports/saved", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<SavedReport>;
}

async function updateSavedReport(reportId: number, payload: { name?: string; config?: SavedReportConfig }) {
  const res = await apiFetch(`/reports/saved/${reportId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<SavedReport>;
}

async function deleteSavedReport(reportId: number) {
  const res = await apiFetch(`/reports/saved/${reportId}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
}

function buildReportParams(dimension: string, metric: string, metricField: string, filters: SavedViewFilters, limit: number) {
  const params = new URLSearchParams();
  params.set("dimension", dimension);
  params.set("metric", metric);
  params.set("limit", String(limit));
  if (metric === "sum" && metricField) params.set("metric_field", metricField);
  appendSavedViewFilterParams(params, filters);
  return params;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [moduleKey, setModuleKey] = useState("");
  const [dimension, setDimension] = useState("");
  const [metric, setMetric] = useState<"count" | "sum">("count");
  const [metricField, setMetricField] = useState("");
  const [filters, setFilters] = useState<SavedViewFilters>(DEFAULT_FILTERS);
  const [viewMode, setViewMode] = useState<"table" | "bar" | "pie">("bar");
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [actionError, setActionError] = useState("");

  const modulesQuery = useQuery({ queryKey: ["report-modules"], queryFn: fetchReportModules, staleTime: 5 * 60_000 });
  const modules = (modulesQuery.data?.results ?? []).filter((item) => CRM_REPORT_MODULE_KEYS.has(item.module_key));
  const selectedModule = modules.find((item) => item.module_key === moduleKey) ?? modules[0] ?? null;
  const activeModuleKey = selectedModule?.module_key ?? "";
  const activeDimension = dimension || selectedModule?.default_dimension || selectedModule?.dimensions[0]?.key || "";
  const activeMetricField = metricField || selectedModule?.metrics[0]?.key || "";

  const filterFields = (selectedModule?.filter_fields ?? []).map(toFilterField);
  const reportQuery = useQuery({
    queryKey: ["module-report", activeModuleKey, activeDimension, metric, activeMetricField, filters],
    queryFn: () => fetchReport(activeModuleKey, activeDimension, metric, activeMetricField, filters),
    enabled: Boolean(activeModuleKey && activeDimension && (metric === "count" || activeMetricField)),
  });
  const report = reportQuery.data;
  const chartData = report?.rows ?? [];
  const valueLabel = metric === "sum" ? report?.metric_field?.label ?? "Value" : "Records";
  const savedReportsQuery = useQuery({
    queryKey: ["saved-module-reports", activeModuleKey],
    queryFn: () => fetchSavedReports(activeModuleKey),
    enabled: Boolean(activeModuleKey),
  });
  const savedReports = savedReportsQuery.data?.results ?? [];
  const selectedSavedReport = savedReports.find((item) => String(item.id) === selectedSavedId) ?? null;
  const currentConfig: SavedReportConfig = {
    dimension: activeDimension,
    metric,
    metric_field: metric === "sum" ? activeMetricField : "",
    filters,
    view_mode: viewMode,
  };

  const createMutation = useMutation({
    mutationFn: createSavedReport,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["saved-module-reports", created.module_key] });
      setSelectedSavedId(String(created.id));
      setSaveDialogOpen(false);
      setSaveName("");
      setActionError("");
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Failed to save report"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ reportId, payload }: { reportId: number; payload: { name?: string; config?: SavedReportConfig } }) =>
      updateSavedReport(reportId, payload),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["saved-module-reports", updated.module_key] });
      setActionError("");
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Failed to update report"),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSavedReport,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["saved-module-reports", activeModuleKey] });
      setSelectedSavedId("");
      setActionError("");
    },
    onError: (error) => setActionError(error instanceof Error ? error.message : "Failed to delete report"),
  });

  function changeModule(nextModuleKey: string) {
    const nextModule = modules.find((item) => item.module_key === nextModuleKey);
    setModuleKey(nextModuleKey);
    setDimension(nextModule?.default_dimension || nextModule?.dimensions[0]?.key || "");
    setMetric("count");
    setMetricField(nextModule?.metrics[0]?.key || "");
    setFilters(cloneFilters());
    setViewMode("bar");
    setSelectedSavedId("");
    setActionError("");
  }

  function applySavedReport(reportId: string) {
    setSelectedSavedId(reportId);
    const saved = savedReports.find((item) => String(item.id) === reportId);
    if (!saved) return;
    setDimension(saved.config.dimension || "");
    setMetric(saved.config.metric || "count");
    setMetricField(saved.config.metric_field || "");
    setFilters(cloneFilters(saved.config.filters));
    setViewMode(saved.config.view_mode || "bar");
    setActionError("");
  }

  function applyReportPreset(preset: ReportPreset) {
    const nextModule = modules.find((item) => item.module_key === preset.module_key);
    if (!nextModule) {
      setActionError("This CRM report is not available with your current module permissions.");
      return;
    }
    const hasDimension = nextModule.dimensions.some((item) => item.key === preset.dimension);
    const hasMetricField = preset.metric_field ? nextModule.metrics.some((item) => item.key === preset.metric_field) : true;

    setModuleKey(preset.module_key);
    setDimension(hasDimension ? preset.dimension : nextModule.default_dimension || nextModule.dimensions[0]?.key || "");
    setMetric(preset.metric === "sum" && hasMetricField ? "sum" : "count");
    setMetricField(preset.metric === "sum" && hasMetricField ? preset.metric_field || "" : nextModule.metrics[0]?.key || "");
    setFilters(cloneFilters(preset.filters));
    setViewMode(preset.view_mode);
    setSelectedSavedId("");
    setActionError("");
  }

  async function saveCurrentReport() {
    if (!selectedSavedReport) {
      setSaveName("");
      setActionError("");
      setSaveDialogOpen(true);
      return;
    }
    await updateMutation.mutateAsync({ reportId: selectedSavedReport.id, payload: { config: currentConfig } });
  }

  async function saveReportAs() {
    const trimmedName = saveName.trim();
    if (!trimmedName || !activeModuleKey) return;
    await createMutation.mutateAsync({ module_key: activeModuleKey, name: trimmedName, config: currentConfig });
  }

  async function exportCsv() {
    if (!activeModuleKey || !activeDimension) return;
    const params = buildReportParams(activeDimension, metric, activeMetricField, filters, 50);
    const res = await apiFetch(`/reports/modules/${activeModuleKey}/export.csv?${params.toString()}`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.detail ?? `Failed with ${res.status}`);
      return;
    }
    const blob = await res.blob();
    downloadBlob(blob, `${activeModuleKey}-report.csv`);
    setActionError("");
  }

  function exportChartSvg() {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg || viewMode === "table") return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    downloadBlob(blob, `${activeModuleKey || "module"}-chart.svg`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 border-b border-neutral-800/80 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">CRM Reports</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!chartData.length}>
            <FileDown className="h-4 w-4" />
            CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={exportChartSvg} disabled={viewMode === "table" || !chartData.length}>
            <Download className="h-4 w-4" />
            SVG
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={saveCurrentReport} disabled={!activeModuleKey || updateMutation.isPending}>
            <Save className="h-4 w-4" />
            Save
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => { setSaveName(""); setActionError(""); setSaveDialogOpen(true); }} disabled={!activeModuleKey || createMutation.isPending}>
            <Save className="h-4 w-4" />
            Save As
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => selectedSavedReport && deleteMutation.mutate(selectedSavedReport.id)} disabled={!selectedSavedReport || deleteMutation.isPending}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
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
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Report presets</h2>
            <p className="mt-1 text-sm text-neutral-400">Start from the core CRM reports, then refine dates, owners, and filters.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {CRM_REPORT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyReportPreset(preset)}
              className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-3 text-left transition hover:border-brand-400/70 hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-brand-400/60"
            >
              <span className="block text-sm font-medium text-neutral-100">{preset.label}</span>
              <span className="mt-1 block text-xs leading-5 text-neutral-400">{preset.description}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="px-4 py-4">
        <div className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
            Saved Report
            <Select value={selectedSavedId} onValueChange={applySavedReport} disabled={!savedReports.length}>
              <SelectTrigger className="w-full border-neutral-700 bg-neutral-950 text-neutral-100">
                <SelectValue placeholder="Select saved report" />
              </SelectTrigger>
              <SelectContent className="border-neutral-800 bg-neutral-950 text-neutral-100">
                {savedReports.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="flex items-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedSavedId("")} disabled={!selectedSavedId}>
              Clear
            </Button>
          </div>
        </div>

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
      {actionError ? (
        <div className="rounded-md border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
          {actionError}
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
            <ChartContainer ref={chartRef} config={{ value: { label: valueLabel, color: CHART_COLORS[0] } }} className="h-[24rem] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {viewMode === "pie" ? (
                  <PieChart>
                    <Tooltip content={<ChartTooltipContent />} />
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
                    <Tooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {chartData.map((row, index) => (
                        <Cell key={row.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </ChartContainer>
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

      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
          <DialogPanel size="md">
            <DialogHeader>
              <DialogTitle>Save report</DialogTitle>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <label className="flex flex-col gap-2 text-sm text-neutral-300">
                Name
                <Input
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="Monthly lead status"
                  className="border-neutral-700 bg-neutral-950 text-neutral-100"
                />
              </label>
              {actionError ? (
                <div className="rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                  {actionError}
                </div>
              ) : null}
            </div>
            <DialogFooter className="mt-5">
              <Button type="button" variant="ghost" onClick={() => setSaveDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={saveReportAs} disabled={!saveName.trim() || createMutation.isPending}>
                Save
              </Button>
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}
