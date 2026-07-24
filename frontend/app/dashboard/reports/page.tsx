"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Download, FileDown, PieChart as PieChartIcon, RotateCcw, Save, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Input } from "@/components/ui/input";
import { ModuleTableShell } from "@/components/ui/ModuleTableShell";
import { PageHeader } from "@/components/ui/PageHeader";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SortableHead, Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { useConfirm } from "@/hooks/useConfirm";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { apiFetch } from "@/lib/api";
import { downloadBlob } from "@/lib/browser";
import { formatDateTime } from "@/lib/datetime";
import { getModuleDisplayName } from "@/lib/module-display";
import { appendSavedViewFilterParams, canonicalSavedViewFiltersKey } from "@/lib/savedViewQuery";
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

type ForecastBucket = {
  key: string;
  label: string;
  count: number;
  gross_pipeline_amount: number | string;
  weighted_pipeline_amount: number | string;
  commit_amount: number | string;
  best_case_amount: number | string;
  actual_revenue_amount: number | string;
};

type ForecastSummary = {
  period_start: string;
  period_end: string;
  gross_pipeline_amount: number | string;
  weighted_pipeline_amount: number | string;
  commit_amount: number | string;
  best_case_amount: number | string;
  actual_revenue_amount: number | string;
  open_opportunity_count: number;
  won_opportunity_count: number;
  by_stage: ForecastBucket[];
  by_owner: ForecastBucket[];
  by_team: ForecastBucket[];
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

type SavedReportSortState = { key: string; direction: "asc" | "desc" } | null;
type SavedReportSortableColumn = "name" | "module_key" | "created_at" | "updated_at";

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

const CRM_TASK_SOURCE_MODULE_KEYS = ["sales_leads", "sales_contacts", "sales_organizations", "sales_opportunities", "sales_quotes"];
// Concrete colors keep downloaded SVG charts portable outside the app's CSS token scope.
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
  if (!res.ok) throw new Error("modules-failed");
  return res.json() as Promise<{ results: ReportModule[] }>;
}

async function fetchReport(moduleKey: string, dimension: string, metric: string, metricField: string, filters: SavedViewFilters) {
  const params = buildReportParams(dimension, metric, metricField, filters, 20);
  const res = await apiFetch(`/reports/modules/${moduleKey}?${params.toString()}`);
  if (!res.ok) throw new Error("report-failed");
  return res.json() as Promise<ReportResponse>;
}

async function fetchForecast(periodStart: string, periodEnd: string) {
  const params = new URLSearchParams({ period_start: periodStart, period_end: periodEnd });
  const res = await apiFetch(`/reports/forecast?${params.toString()}`);
  if (!res.ok) throw new Error("forecast-failed");
  return res.json() as Promise<ForecastSummary>;
}

async function fetchSavedReports(moduleKey: string, sort: SavedReportSortState) {
  const params = new URLSearchParams();
  params.set("module_key", moduleKey);
  if (sort) {
    params.set("sort_by", sort.key);
    params.set("sort_direction", sort.direction);
  }
  const res = await apiFetch(`/reports/saved?${params.toString()}`);
  if (!res.ok) throw new Error("saved-reports-failed");
  return res.json() as Promise<{ results: SavedReport[] }>;
}

async function createSavedReport(payload: { module_key: string; name: string; config: SavedReportConfig }) {
  const res = await apiFetch("/reports/saved", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(res.status === 409 ? "name-conflict" : "create-failed");
  return res.json() as Promise<SavedReport>;
}

async function updateSavedReport(reportId: number, payload: { name?: string; config?: SavedReportConfig }) {
  const res = await apiFetch(`/reports/saved/${reportId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(res.status === 409 ? "name-conflict" : "update-failed");
  return res.json() as Promise<SavedReport>;
}

async function deleteSavedReport(reportId: number) {
  const res = await apiFetch(`/reports/saved/${reportId}`, { method: "DELETE" });
  if (!res.ok) throw new Error("delete-failed");
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

function formatCurrency(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number.isFinite(amount ?? NaN) ? amount ?? 0 : 0);
}

function isoDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [moduleKey, setModuleKey] = useState("");
  const [dimension, setDimension] = useState("");
  const [metric, setMetric] = useState<"count" | "sum">("count");
  const [metricField, setMetricField] = useState("");
  const [filters, setFilters] = useState<SavedViewFilters>(DEFAULT_FILTERS);
  const [viewMode, setViewMode] = useState<"table" | "bar" | "pie">("bar");
  const [selectedSavedId, setSelectedSavedId] = useState("");
  const [savedReportSort, setSavedReportSort] = useState<SavedReportSortState>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [actionError, setActionError] = useState("");
  const [exporting, setExporting] = useState<"csv" | "svg" | null>(null);
  const [forecastStart, setForecastStart] = useState(() => isoDateOffset(0));
  const [forecastEnd, setForecastEnd] = useState(() => isoDateOffset(90));

  const modulesQuery = useQuery({ queryKey: ["report-modules"], queryFn: fetchReportModules, staleTime: 5 * 60_000 });
  const modules = modulesQuery.data?.results ?? [];
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
    queryKey: ["saved-module-reports", activeModuleKey, savedReportSort],
    queryFn: () => fetchSavedReports(activeModuleKey, savedReportSort),
    enabled: Boolean(activeModuleKey),
  });
  const savedReports = savedReportsQuery.data?.results ?? [];
  const forecastQuery = useQuery({
    queryKey: ["reports-forecast", forecastStart, forecastEnd],
    queryFn: () => fetchForecast(forecastStart, forecastEnd),
    enabled: modules.some((item) => item.module_key === "sales_opportunities") && Boolean(forecastStart && forecastEnd && forecastStart <= forecastEnd),
  });
  const forecast = forecastQuery.data;
  const selectedSavedReport = savedReports.find((item) => String(item.id) === selectedSavedId) ?? null;
  const currentConfig: SavedReportConfig = {
    dimension: activeDimension,
    metric,
    metric_field: metric === "sum" ? activeMetricField : "",
    filters,
    view_mode: viewMode,
  };
  const { allConditions, anyConditions } = getConditionGroups(filters);
  const hasActiveFilters = Boolean(
    (typeof filters.search === "string" && filters.search.trim()) ||
    allConditions.length ||
    anyConditions.length,
  );
  const hasForecastAccess = modules.some((item) => item.module_key === "sales_opportunities");
  const forecastDatesValid = Boolean(forecastStart && forecastEnd && forecastStart <= forecastEnd);
  const isSavedReportDirty = Boolean(
    selectedSavedReport && (
      currentConfig.dimension !== selectedSavedReport.config.dimension ||
      currentConfig.metric !== selectedSavedReport.config.metric ||
      currentConfig.metric_field !== selectedSavedReport.config.metric_field ||
      currentConfig.view_mode !== selectedSavedReport.config.view_mode ||
      canonicalSavedViewFiltersKey(currentConfig.filters) !== canonicalSavedViewFiltersKey(selectedSavedReport.config.filters)
    ),
  );

  const createMutation = useMutation({
    mutationFn: createSavedReport,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["saved-module-reports", created.module_key] });
      setSelectedSavedId(String(created.id));
      setSaveDialogOpen(false);
      setSaveName("");
      setActionError("");
      toast.success("Report saved.");
    },
    onError: (error) => setActionError(error instanceof Error && error.message === "name-conflict" ? "A saved report with this name already exists." : "The report could not be saved. Try again."),
  });

  const updateMutation = useMutation({
    mutationFn: ({ reportId, payload }: { reportId: number; payload: { name?: string; config?: SavedReportConfig } }) =>
      updateSavedReport(reportId, payload),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["saved-module-reports", updated.module_key] });
      setActionError("");
      toast.success("Saved report updated.");
    },
    onError: () => setActionError("The saved report could not be updated. Try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSavedReport,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["saved-module-reports", activeModuleKey] });
      setSelectedSavedId("");
      setActionError("");
      toast.success("Saved report deleted.");
    },
    onError: () => setActionError("The saved report could not be deleted. Try again."),
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

  function toggleSavedReportSort(column: SavedReportSortableColumn) {
    setSavedReportSort((current) =>
      current?.key === column
        ? { key: column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column, direction: column === "updated_at" || column === "created_at" ? "desc" : "asc" },
    );
  }

  function renderSavedReportHead(column: SavedReportSortableColumn, label: string) {
    return (
      <SortableHead
        sorted={savedReportSort?.key === column}
        direction={savedReportSort?.key === column ? savedReportSort.direction : column === "updated_at" || column === "created_at" ? "desc" : "asc"}
        onClick={() => toggleSavedReportSort(column)}
      >
        {label}
      </SortableHead>
    );
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

  function saveCurrentReport() {
    if (!selectedSavedReport || !isSavedReportDirty) return;
    updateMutation.mutate({ reportId: selectedSavedReport.id, payload: { config: currentConfig } });
  }

  function saveReportAs() {
    const trimmedName = saveName.trim();
    if (!trimmedName || !activeModuleKey) return;
    createMutation.mutate({ module_key: activeModuleKey, name: trimmedName, config: currentConfig });
  }

  async function exportCsv() {
    if (!activeModuleKey || !activeDimension) return;
    try {
      setExporting("csv");
      setActionError("");
      const params = buildReportParams(activeDimension, metric, activeMetricField, filters, 50);
      const res = await apiFetch(`/reports/modules/${activeModuleKey}/export.csv?${params.toString()}`);
      if (!res.ok) throw new Error("export-failed");
      const blob = await res.blob();
      downloadBlob(blob, `${activeModuleKey}-report.csv`);
      toast.success("CSV export downloaded.");
    } catch {
      setActionError("The CSV export could not be prepared. Check your export permission and try again.");
    } finally {
      setExporting(null);
    }
  }

  function exportChartSvg() {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg || viewMode === "table") return;
    try {
      setExporting("svg");
      setActionError("");
      const source = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, `${activeModuleKey || "module"}-chart.svg`);
      toast.success("Chart export downloaded.");
    } catch {
      setActionError("The chart export could not be prepared. Try again.");
    } finally {
      setExporting(null);
    }
  }

  async function confirmDeleteSavedReport() {
    if (!selectedSavedReport) return;
    const confirmed = await confirm({
      title: "Delete saved report?",
      description: `Delete "${selectedSavedReport.name}"? This removes the saved configuration, not the underlying CRM data.`,
      confirmLabel: "Delete report",
      variant: "destructive",
    });
    if (confirmed) deleteMutation.mutate(selectedSavedReport.id);
  }

  function clearReportFilters() {
    setFilters(cloneFilters());
  }

  if (modulesQuery.isLoading) return <RouteLoadingState label="reports" />;
  if (modulesQuery.error) {
    return <RouteErrorState title="Unable to load reports" reset={() => void modulesQuery.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Explore tenant-authorized CRM, finance, task, and custom-module data without changing the underlying records."
        eyebrow={selectedModule ? `Viewing ${selectedModule.label}` : undefined}
        actions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => void exportCsv()} disabled={!chartData.length || Boolean(exporting)}>
              <FileDown />{exporting === "csv" ? "Preparing…" : "Export CSV"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={exportChartSvg} disabled={viewMode === "table" || !chartData.length || Boolean(exporting)}>
              <Download />{exporting === "svg" ? "Preparing…" : "Export chart"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => { setSaveName(""); setActionError(""); setSaveDialogOpen(true); }} disabled={!activeModuleKey || createMutation.isPending}>
              <Save />Save as
            </Button>
            <Button type="button" size="sm" onClick={() => void saveCurrentReport()} disabled={!isSavedReportDirty || updateMutation.isPending}>
              <Save />{updateMutation.isPending ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      />

      {!modules.length ? (
        <Card>
          <EmptyState
            icon={BarChart3}
            title="No reportable modules available"
            description="Reports only include modules you can view. Ask an administrator to enable a module and grant its view permission."
          />
        </Card>
      ) : null}

      {modules.length ? <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-copy-primary">Report presets</h2>
            <p className="mt-1 text-sm text-copy-secondary">Start from a common CRM question, then refine the module, measure, and filters.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {CRM_REPORT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyReportPreset(preset)}
              className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-3 text-left transition hover:border-action-primary/60 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span className="block text-sm font-medium text-copy-primary">{preset.label}</span>
              <span className="mt-1 block text-xs leading-5 text-copy-secondary">{preset.description}</span>
            </button>
          ))}
        </div>
      </Card> : null}

      {modules.length ? <>
      {hasForecastAccess ? <Card className="p-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-copy-primary">Weighted forecast</h2>
            <p className="mt-1 text-sm text-copy-secondary">Open deal value weighted by explicit probability or stage default.</p>
          </div>
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="forecast-start">Start</FieldLabel>
              <Input id="forecast-start" type="date" value={forecastStart} onChange={(event) => setForecastStart(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="forecast-end">End</FieldLabel>
              <Input id="forecast-end" type="date" value={forecastEnd} onChange={(event) => setForecastEnd(event.target.value)} aria-invalid={!forecastDatesValid} aria-describedby={!forecastDatesValid ? "forecast-date-error" : undefined} />
            </Field>
          </FieldGroup>
        </div>
        {!forecastDatesValid ? (
          <div id="forecast-date-error" role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
            Forecast end date must be on or after the start date.
          </div>
        ) : forecastQuery.error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
            <span>The forecast could not be loaded. Try again.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void forecastQuery.refetch()}><RotateCcw />Retry</Button>
          </div>
        ) : forecastQuery.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" aria-label="Loading forecast">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-[var(--radius-control)]" />)}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Weighted" value={formatCurrency(forecast?.weighted_pipeline_amount)} helper={`${forecast?.open_opportunity_count ?? 0} open deals`} />
            <MetricCard label="Gross" value={formatCurrency(forecast?.gross_pipeline_amount)} helper="Open pipeline" />
            <MetricCard label="Commit" value={formatCurrency(forecast?.commit_amount)} helper="Probability 75%+" />
            <MetricCard label="Best Case" value={formatCurrency(forecast?.best_case_amount)} helper="Probability 50%+" />
            <MetricCard label="Actual" value={formatCurrency(forecast?.actual_revenue_amount)} helper={`${forecast?.won_opportunity_count ?? 0} won deals`} />
          </div>
        )}
        {forecastDatesValid && !forecastQuery.isLoading && !forecastQuery.error ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <ForecastBucketList title="By stage" rows={forecast?.by_stage ?? []} />
            <ForecastBucketList title="By owner" rows={forecast?.by_owner ?? []} />
          </div>
        ) : null}
      </Card> : (
        <Card className="p-4">
          <EmptyState icon={BarChart3} title="Forecast unavailable" description="Weighted forecasting appears when the Deals module is enabled and you have permission to view it." />
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <Field>
            <FieldLabel>Saved report</FieldLabel>
            <Select value={selectedSavedId} onValueChange={applySavedReport} disabled={!savedReports.length}>
              <SelectTrigger className="w-full" aria-label="Saved report">
                <SelectValue placeholder="Select saved report" />
              </SelectTrigger>
              <SelectContent>
                {savedReports.map((item) => (
                  <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedSavedId("")} disabled={!selectedSavedId}>
              Clear
            </Button>
            <Button type="button" variant="destructive" size="sm" onClick={() => void confirmDeleteSavedReport()} disabled={!selectedSavedReport || deleteMutation.isPending}>
              <Trash2 />{deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>

        {savedReportsQuery.error ? (
          <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
            <span>Saved reports could not be loaded.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void savedReportsQuery.refetch()}><RotateCcw />Retry</Button>
          </div>
        ) : null}

        <ModuleTableShell className="mb-4 max-h-72" isRefreshing={savedReportsQuery.isFetching && !savedReportsQuery.isLoading}>
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableHeaderRow>
                {renderSavedReportHead("name", "Name")}
                {renderSavedReportHead("module_key", "Module")}
                {renderSavedReportHead("updated_at", "Updated")}
                {renderSavedReportHead("created_at", "Created")}
                <TableHead className="text-right">Actions</TableHead>
              </TableHeaderRow>
            </TableHeader>
            <TableBody>
              {savedReportsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-copy-muted">Loading saved reports…</TableCell>
                </TableRow>
              ) : savedReports.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-sm text-copy-muted">No saved reports for this module.</TableCell>
                </TableRow>
              ) : (
                savedReports.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer"
                    tabIndex={0}
                    aria-label={`Open saved report ${item.name}`}
                    onClick={() => applySavedReport(String(item.id))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        applySavedReport(String(item.id));
                      }
                    }}
                  >
                    <TableCell className="font-medium text-copy-primary">{item.name}</TableCell>
                    <TableCell className="text-copy-secondary">{getModuleDisplayName(item.module_key)}</TableCell>
                    <TableCell className="text-copy-secondary">{formatDateTime(item.updated_at, { hour: "numeric", minute: "2-digit" })}</TableCell>
                    <TableCell className="text-copy-secondary">{formatDateTime(item.created_at, { hour: "numeric", minute: "2-digit" })}</TableCell>
                    <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                      <Button type="button" variant="ghost" size="sm" onClick={() => applySavedReport(String(item.id))}>
                        Open
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>

        <FieldGroup className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <Field>
            <FieldLabel>Module</FieldLabel>
            <Select value={activeModuleKey} onValueChange={changeModule}>
              <SelectTrigger className="w-full" aria-label="Report module">
                <SelectValue placeholder="Select module" />
              </SelectTrigger>
              <SelectContent>
                {modules.map((item) => (
                  <SelectItem key={item.module_key} value={item.module_key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Group by</FieldLabel>
            <Select value={activeDimension} onValueChange={setDimension} disabled={!selectedModule}>
              <SelectTrigger className="w-full" aria-label="Group by">
                <SelectValue placeholder="Dimension" />
              </SelectTrigger>
              <SelectContent>
                {(selectedModule?.dimensions ?? []).map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Metric</FieldLabel>
            <Select value={metric} onValueChange={(value) => setMetric(value as "count" | "sum")}>
              <SelectTrigger className="w-full" aria-label="Metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="count">Record count</SelectItem>
                <SelectItem value="sum" disabled={!selectedModule?.metrics.length}>Sum field</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Sum field</FieldLabel>
            <Select value={activeMetricField} onValueChange={setMetricField} disabled={metric !== "sum" || !selectedModule?.metrics.length}>
              <SelectTrigger className="w-full" aria-label="Sum field">
                <SelectValue placeholder="Numeric field" />
              </SelectTrigger>
              <SelectContent>
                {(selectedModule?.metrics ?? []).map((item) => (
                  <SelectItem key={item.key} value={item.key}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="report-search">Search</FieldLabel>
            <Input
              id="report-search"
              value={typeof filters.search === "string" ? filters.search : ""}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="Search records"
            />
          </Field>
        </FieldGroup>
      </Card>

      <InlineSavedViewFilters filterFields={filterFields} filters={filters} onChange={setFilters} />

      {reportQuery.error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <span>The report could not be generated. Adjust the configuration or try again.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void reportQuery.refetch()}><RotateCcw />Retry</Button>
        </div>
      ) : null}
      {actionError ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="min-h-[28rem] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-copy-primary">{selectedModule?.label ?? "Module"} report</h2>
              <FieldDescription className="mt-1">{report?.dimension.label ? `Grouped by ${report.dimension.label.toLowerCase()}.` : "Choose how to group and measure the authorized records."}</FieldDescription>
            </div>
            <div className="inline-flex rounded-[var(--radius-control)] border border-line-default p-0.5" aria-label="Report display">
              <Button type="button" variant={viewMode === "table" ? "secondary" : "ghost"} size="sm" aria-pressed={viewMode === "table"} onClick={() => setViewMode("table")}><Table2 />Table</Button>
              <Button type="button" variant={viewMode === "bar" ? "secondary" : "ghost"} size="sm" aria-pressed={viewMode === "bar"} onClick={() => setViewMode("bar")}><BarChart3 />Bar</Button>
              <Button type="button" variant={viewMode === "pie" ? "secondary" : "ghost"} size="sm" aria-pressed={viewMode === "pie"} onClick={() => setViewMode("pie")}><PieChartIcon />Pie</Button>
            </div>
          </div>
          {reportQuery.isLoading ? (
            <Skeleton className="h-[24rem] w-full rounded-[var(--radius-control)]" />
          ) : !chartData.length && !reportQuery.error ? (
            <EmptyState
              icon={BarChart3}
              className="min-h-[24rem]"
              title={hasActiveFilters ? "No records match these filters" : "No report data yet"}
              description={hasActiveFilters ? "Clear the search and filters or choose a different grouping." : "Records will appear here when this module contains reportable data."}
              action={hasActiveFilters ? <Button type="button" variant="outline" onClick={clearReportFilters}>Clear filters</Button> : undefined}
            />
          ) : viewMode === "table" ? (
            <ModuleTableShell className="min-h-[24rem] max-h-[24rem]" isRefreshing={reportQuery.isFetching && !reportQuery.isLoading}>
              <Table>
                <TableHeader>
                  <TableHeaderRow>
                    <TableHead>{report?.dimension.label ?? "Group"}</TableHead>
                    <TableHead className="text-right">Records</TableHead>
                    {metric === "sum" ? <TableHead className="text-right">{valueLabel}</TableHead> : null}
                  </TableHeaderRow>
                </TableHeader>
                <TableBody>
                  {chartData.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium text-copy-primary">{row.label}</TableCell>
                      <TableCell className="text-right text-copy-secondary">{formatNumber(row.count)}</TableCell>
                      {metric === "sum" ? <TableCell className="text-right text-copy-secondary">{formatNumber(row.value)}</TableCell> : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ModuleTableShell>
          ) : (
            <ChartContainer ref={chartRef} config={{ value: { label: valueLabel, color: CHART_COLORS[0] } }} className="h-[24rem] w-full" role="img" aria-label={`${selectedModule?.label ?? "Module"} report grouped by ${report?.dimension.label ?? "selected field"}`}>
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

        <Card className="p-4">
          <div className="space-y-5">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">Records matched</div>
              <div className="mt-2 text-3xl font-semibold text-copy-primary">{reportQuery.isLoading ? "—" : formatNumber(report?.total_count ?? 0)}</div>
            </div>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">Groups</div>
              <div className="mt-2 text-3xl font-semibold text-copy-primary">{reportQuery.isLoading ? "—" : formatNumber(chartData.length)}</div>
            </div>
            <div className="border-t border-line-subtle pt-4">
              <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">Top result</div>
              <div className="mt-2 text-sm font-medium text-copy-primary">{chartData[0]?.label ?? "No data"}</div>
              <div className="mt-1 text-sm text-copy-secondary">{chartData[0] ? `${formatNumber(chartData[0].value)} ${valueLabel.toLowerCase()}` : "No grouped results"}</div>
            </div>
          </div>
        </Card>
      </div>
      </> : null}

      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
          <DialogPanel size="md">
            <DialogHeader>
              <DialogTitle>Save report</DialogTitle>
              <DialogIconClose />
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <Field>
                <FieldLabel htmlFor="saved-report-name">Name</FieldLabel>
                <Input
                  id="saved-report-name"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="Monthly lead status"
                />
              </Field>
              {actionError ? (
                <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-3 py-2 text-sm text-copy-primary">
                  {actionError}
                </div>
              ) : null}
            </div>
            <DialogFooter className="mt-5">
              <Button type="button" variant="ghost" onClick={() => setSaveDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={saveReportAs} disabled={!saveName.trim() || createMutation.isPending}>
                {createMutation.isPending ? "Saving…" : "Save report"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-copy-muted">{label}</div>
      <div className="mt-2 text-xl font-semibold text-copy-primary">{value}</div>
      <div className="mt-1 text-xs text-copy-muted">{helper}</div>
    </div>
  );
}

function ForecastBucketList({ title, rows }: { title: string; rows: ForecastBucket[] }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
      <div className="border-b border-line-subtle px-3 py-2 text-xs font-medium uppercase tracking-wide text-copy-muted">{title}</div>
      <div className="divide-y divide-line-subtle">
        {rows.length ? rows.slice(0, 5).map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 px-3 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-copy-primary">{row.label}</div>
              <div className="mt-1 text-xs text-copy-muted">{row.count} opportunities</div>
            </div>
            <div className="text-right text-sm font-semibold text-state-success">{formatCurrency(row.weighted_pipeline_amount)}</div>
          </div>
        )) : <div className="px-3 py-5 text-sm text-copy-muted">No forecast data in this period.</div>}
      </div>
    </div>
  );
}
