"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, BookmarkPlus, Download, FileDown, PieChart as PieChartIcon, Save, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ActionBar } from "@/components/ui/ActionBar";
import { Card } from "@/components/ui/Card";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { Fact, FactList } from "@/components/ui/Fact";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable } from "@/components/ui/RecordTable";
import { RouteErrorState, RouteLoadingState } from "@/components/ui/RouteStates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PanelEmpty, PanelError, PanelHeader, PanelLoading } from "@/components/ui/PanelStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatGroup, StatTile } from "@/components/ui/StatTile";
import { getConditionGroups } from "@/components/ui/SavedViewConditionEditor";
import { useConfirm } from "@/hooks/useConfirm";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { apiFetch } from "@/lib/api";
import { downloadBlob } from "@/lib/browser";
import { formatDateTime } from "@/lib/datetime";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/currency";
import { getModuleDisplayName } from "@/lib/module-display";
import { appendSavedViewFilterParams, canonicalSavedViewFiltersKey } from "@/lib/savedViewQuery";
import type { ModuleFilterField } from "@/lib/moduleViewConfigs";
import { CHART_AXIS_STROKE, CHART_GRID_STROKE, CHART_TICK_FILL, seriesColor } from "@/lib/chartColors";

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

// Zero, not `Not set`: a forecast figure with no rows is a zero pipeline rather than an
// absent field, so this keeps its own fallback. The formatting itself is lib/currency.ts's
// (design.md 7.1) — a local Intl.NumberFormat was also the only place in reports still on
// the browser locale.
function formatCurrency(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  const safe = Number.isFinite(amount ?? NaN) ? (amount as number) : 0;
  return formatMoney(safe, DEFAULT_CURRENCY, { maximumFractionDigits: 0 }) ?? "";
}

function isoDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function ReportsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { modules: accessibleModules } = useAccessibleModules();
  const reportActions = accessibleModules.find((module) => module.name === "reports")?.actions;
  const canCreateReport = Boolean(reportActions?.can_create);
  const canEditReport = Boolean(reportActions?.can_edit);
  const canDeleteReport = Boolean(reportActions?.can_delete);
  const canExportReport = Boolean(reportActions?.can_export);
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
  const [saveError, setSaveError] = useState("");
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
      setSaveError("");
      toast.success("Report saved.");
    },
    onError: (error) => setSaveError(error instanceof Error && error.message === "name-conflict" ? "A saved report with this name already exists. Choose another name." : "The report could not be saved. Try again."),
  });

  const updateMutation = useMutation({
    mutationFn: ({ reportId, payload }: { reportId: number; payload: { name?: string; config?: SavedReportConfig } }) =>
      updateSavedReport(reportId, payload),
    onSuccess: async (updated) => {
      await queryClient.invalidateQueries({ queryKey: ["saved-module-reports", updated.module_key] });
      toast.success("Saved report updated.");
    },
    onError: () => toast.error("The saved report could not be updated. Try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSavedReport,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["saved-module-reports", activeModuleKey] });
      setSelectedSavedId("");
      toast.success("Saved report deleted.");
    },
    onError: () => toast.error("The saved report could not be deleted. Try again."),
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
  }

  function toggleSavedReportSort(column: SavedReportSortableColumn) {
    setSavedReportSort((current) =>
      current?.key === column
        ? { key: column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key: column, direction: column === "updated_at" || column === "created_at" ? "desc" : "asc" },
    );
  }


  function applyReportPreset(preset: ReportPreset) {
    const nextModule = modules.find((item) => item.module_key === preset.module_key);
    if (!nextModule) {
      toast.error("This CRM report is not available with your current module permissions.");
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
      const params = buildReportParams(activeDimension, metric, activeMetricField, filters, 50);
      const res = await apiFetch(`/reports/modules/${activeModuleKey}/export.csv?${params.toString()}`);
      if (!res.ok) throw new Error("export-failed");
      const blob = await res.blob();
      downloadBlob(blob, `${activeModuleKey}-report.csv`);
      toast.success("CSV export downloaded.");
    } catch {
      toast.error("The CSV export could not be prepared. Check your export permission and try again.");
    } finally {
      setExporting(null);
    }
  }

  function exportChartSvg() {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg || viewMode === "table") return;
    try {
      setExporting("svg");
      const source = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      downloadBlob(blob, `${activeModuleKey || "module"}-chart.svg`);
      toast.success("Chart export downloaded.");
    } catch {
      toast.error("The chart export could not be prepared. Try again.");
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
    <PageShell
      title="Reports"
      context={selectedModule ? `Viewing ${selectedModule.label}` : undefined}
      actions={(
        <>
          {canExportReport ? <Button type="button" variant="outline" onClick={() => void exportCsv()} disabled={!chartData.length || Boolean(exporting)}>
            <FileDown />{exporting === "csv" ? "Preparing…" : "Export CSV"}
          </Button> : null}
          {canExportReport ? <Button type="button" variant="outline" onClick={exportChartSvg} disabled={viewMode === "table" || !chartData.length || Boolean(exporting)}>
            <Download />{exporting === "svg" ? "Preparing…" : "Export chart"}
          </Button> : null}
          {canCreateReport ? <Button type="button" variant="outline" onClick={() => { setSaveName(""); setSaveError(""); setSaveDialogOpen(true); }} disabled={!activeModuleKey || createMutation.isPending}>
            <Save />Save as
          </Button> : null}
          {canEditReport ? <Button type="button" onClick={() => void saveCurrentReport()} disabled={!isSavedReportDirty || updateMutation.isPending}>
            <Save />{updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button> : null}
        </>
      )}
    >
      {!modules.length ? (
        <Card className="p-4">
          <PanelEmpty
            icon={BarChart3}
            title="No reportable modules available"
            description="Reports only include modules you can view. Ask an administrator to enable a module and grant its view permission."
          />
        </Card>
      ) : null}

      {modules.length ? <>
      <Card className="p-4">
        <PanelHeader title="Report presets" description="Start from a common CRM question, then refine the module, measure, and filters." />
        {/* A preset is a box because it is a control (R8). It was a tinted box that took the
            primary action's colour on hover; it is an edge that strengthens, like a board card. */}
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {CRM_REPORT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyReportPreset(preset)}
              className="rounded-[var(--radius-control)] border border-line-subtle px-3 py-3 text-left transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <span className="block text-sm font-medium text-copy-primary">{preset.label}</span>
              <span className="mt-1 block text-p-xs text-copy-muted">{preset.description}</span>
            </button>
          ))}
        </div>
      </Card>

      {hasForecastAccess ? <Card>
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
          <PanelHeader title="Weighted forecast" description="Open deal value weighted by explicit probability or stage default." />
          <FieldGroup className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="forecast-start">Start</FieldLabel>
              <Input id="forecast-start" type="date" value={forecastStart} onChange={(event) => setForecastStart(event.target.value)} />
            </Field>
            <Field data-invalid={!forecastDatesValid || undefined}>
              <FieldLabel htmlFor="forecast-end">End</FieldLabel>
              <Input id="forecast-end" type="date" value={forecastEnd} onChange={(event) => setForecastEnd(event.target.value)} aria-invalid={!forecastDatesValid} aria-describedby={!forecastDatesValid ? "forecast-date-error" : undefined} />
              {/* A field error beside the field it names (§7.5), not a red banner under the
                  whole card. */}
              {!forecastDatesValid ? (
                <FieldError id="forecast-date-error">Forecast end date must be on or after the start date.</FieldError>
              ) : null}
            </Field>
          </FieldGroup>
        </div>
        {!forecastDatesValid ? null : forecastQuery.error ? (
          <div className="px-4 pb-4">
            <PanelError message="The forecast could not be loaded." onRetry={() => void forecastQuery.refetch()} />
          </div>
        ) : forecastQuery.isLoading ? (
          <div className="px-4 pb-4">
            <PanelLoading label="Loading forecast…" />
          </div>
        ) : (
          <>
            {/* Batch 2 of 5.7: `MetricCard` was a bordered box inside this card, at `text-xl` — the
                third of three stat sizes. The group fills the card edge to edge (§4.7 archetype 5). */}
            <StatGroup label="Forecast totals" className="border-y border-line-subtle">
              <StatTile label="Weighted" value={formatCurrency(forecast?.weighted_pipeline_amount)} context={`${forecast?.open_opportunity_count ?? 0} open deals`} />
              <StatTile label="Gross" value={formatCurrency(forecast?.gross_pipeline_amount)} context="Open pipeline" />
              <StatTile label="Commit" value={formatCurrency(forecast?.commit_amount)} context="Probability 75%+" />
              <StatTile label="Best case" value={formatCurrency(forecast?.best_case_amount)} context="Probability 50%+" />
              <StatTile label="Actual" value={formatCurrency(forecast?.actual_revenue_amount)} context={`${forecast?.won_opportunity_count ?? 0} won deals`} />
            </StatGroup>
            <div className="grid gap-6 p-4 lg:grid-cols-2">
              <ForecastBucketList title="By stage" rows={forecast?.by_stage ?? []} />
              <ForecastBucketList title="By owner" rows={forecast?.by_owner ?? []} />
            </div>
          </>
        )}
      </Card> : (
        <Card className="p-4">
          <PanelEmpty icon={BarChart3} title="Forecast unavailable" description="Weighted forecasting appears when the Deals module is enabled and you have permission to view it." />
        </Card>
      )}

      <Card id="report-builder" className="scroll-mt-6 p-4">
        <div className="mb-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
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
          {/* The select beside these is the row's height, so the buttons are too (R4). */}
          <ActionBar align="start">
            <Button type="button" variant="ghost" onClick={() => setSelectedSavedId("")} disabled={!selectedSavedId}>
              Clear
            </Button>
            {canDeleteReport ? <Button type="button" variant="destructive" onClick={() => void confirmDeleteSavedReport()} disabled={!selectedSavedReport || deleteMutation.isPending}>
              <Trash2 />{deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button> : null}
          </ActionBar>
        </div>

        {/* No height cap: §4.5/§11.1 — a capped shell is a second scroll container inside
            an already-scrolling page. The list grows and the page scrolls, like every
            other list on a document page. The row's own `Open` button went: the row already
            opens the report, and its label says so. */}
        <RecordTable
          label="Saved reports"
          shellVariant="nested"
          className="mb-4"
          columns={[
            { key: "name", label: "Name", size: "lg", sortable: true, render: (item) => <span className="font-medium text-copy-primary">{item.name}</span> },
            { key: "module_key", label: "Module", sortable: true, render: (item) => <span className="text-copy-secondary">{getModuleDisplayName(item.module_key)}</span> },
            { key: "updated_at", label: "Updated", sortable: true, render: (item) => <span className="text-copy-secondary">{formatDateTime(item.updated_at, { hour: "numeric", minute: "2-digit" })}</span> },
            { key: "created_at", label: "Created", sortable: true, render: (item) => <span className="text-copy-secondary">{formatDateTime(item.created_at, { hour: "numeric", minute: "2-digit" })}</span> },
          ]}
          rows={savedReports}
          rowKey={(item) => item.id}
          onOpenRow={(item) => applySavedReport(String(item.id))}
          rowLabel={(item) => `Open saved report ${item.name}`}
          sort={savedReportSort ? { column: savedReportSort.key, direction: savedReportSort.direction } : null}
          onSortChange={(next) => toggleSavedReportSort(next.column as SavedReportSortableColumn)}
          isLoading={savedReportsQuery.isLoading}
          isRefreshing={savedReportsQuery.isFetching && !savedReportsQuery.isLoading}
          hasError={Boolean(savedReportsQuery.error)}
          onRetry={() => void savedReportsQuery.refetch()}
          emptyState={{
            icon: BookmarkPlus,
            title: "No saved reports for this module",
            description: "Build a report below, then save it to reuse the same grouping and filters.",
          }}
        />

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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="min-h-[28rem] p-4">
          <PanelHeader
            title={`${selectedModule?.label ?? "Module"} report`}
            description={report?.dimension.label ? `Grouped by ${report.dimension.label.toLowerCase()}.` : "Choose how to group and measure the authorized records."}
            action={(
              <SegmentedControl aria-label="Report display" value={viewMode} onValueChange={setViewMode}>
                <SegmentedItem value="table"><Table2 />Table</SegmentedItem>
                <SegmentedItem value="bar"><BarChart3 />Bar</SegmentedItem>
                <SegmentedItem value="pie"><PieChartIcon />Pie</SegmentedItem>
              </SegmentedControl>
            )}
          />
          <div className="mt-4">
            {/* The error was a red banner between the filters and this panel, and the panel
                under it still drew its empty state — two messages for one failure. It is the
                panel's state now (§7.4). */}
            {reportQuery.error ? (
              <PanelError message="The report could not be generated. Adjust the configuration or try again." onRetry={() => void reportQuery.refetch()} />
            ) : reportQuery.isLoading ? (
              <PanelLoading label="Generating the report…" />
            ) : !chartData.length ? (
              <PanelEmpty
                icon={BarChart3}
                title={hasActiveFilters ? "No records match these filters" : "No report data yet"}
                description={hasActiveFilters ? "Clear the search and filters or choose a different grouping." : "Records will appear here when this module contains reportable data."}
                action={hasActiveFilters ? <Button type="button" variant="outline" onClick={clearReportFilters}>Clear filters</Button> : undefined}
              />
            ) : viewMode === "table" ? (
              // R10: this was the last raw `Table` outside the primitives on a dashboard page.
              <RecordTable
                variant="readOnly"
                shellVariant="nested"
                label={`${selectedModule?.label ?? "Module"} report`}
                columns={[
                  { key: "label", label: report?.dimension.label ?? "Group", render: (row) => <span className="font-medium text-copy-primary">{row.label}</span> },
                  { key: "count", label: "Records", align: "right", render: (row) => <span className="tabular-nums">{formatNumber(row.count)}</span> },
                  ...(metric === "sum"
                    ? [{ key: "value", label: valueLabel, align: "right" as const, render: (row: ReportRow) => <span className="tabular-nums">{formatNumber(row.value)}</span> }]
                    : []),
                ]}
                rows={chartData}
                rowKey={(row) => row.key}
                isRefreshing={reportQuery.isFetching && !reportQuery.isLoading}
                emptyState={{ icon: BarChart3, title: "No report data yet" }}
              />
            ) : (
              <ChartContainer ref={chartRef} config={{ value: { label: valueLabel, color: seriesColor(0) } }} className="h-[24rem] w-full" role="img" aria-label={`${selectedModule?.label ?? "Module"} report grouped by ${report?.dimension.label ?? "selected field"}`}>
                <ResponsiveContainer width="100%" height="100%">
                  {viewMode === "pie" ? (
                    <PieChart>
                      <Tooltip content={<ChartTooltipContent />} />
                      <Pie data={chartData} dataKey="value" nameKey="label" outerRadius="82%" innerRadius="52%" paddingAngle={2}>
                        {chartData.map((row, index) => (
                          <Cell key={row.key} fill={seriesColor(index)} />
                        ))}
                      </Pie>
                    </PieChart>
                  ) : (
                    <BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 42 }}>
                      <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
                      <XAxis dataKey="label" stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} angle={-28} textAnchor="end" interval={0} height={58} />
                      <YAxis stroke={CHART_AXIS_STROKE} tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} />
                      <Tooltip content={<ChartTooltipContent />} />
                      {/* One measure, one series, one colour — colouring bars by position encoded
                          rank as identity (5.7 batch 1, the same fix on the dashboard's chart). */}
                      <Bar dataKey="value" fill={seriesColor(0)} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>
        </Card>

        <Card>
          <StatGroup label="Report totals" layout="stack">
            <StatTile label="Records matched" value={reportQuery.isLoading ? "—" : formatNumber(report?.total_count ?? 0)} />
            <StatTile label="Groups" value={reportQuery.isLoading ? "—" : formatNumber(chartData.length)} />
          </StatGroup>
          {/* A label over a value is a `Fact` (§7.12). */}
          <FactList className="border-t border-line-subtle p-4">
            <Fact label="Top result">
              {chartData[0] ? (
                <>
                  <span className="font-medium">{chartData[0].label}</span>
                  <span className="mt-1 block text-copy-secondary">{`${formatNumber(chartData[0].value)} ${valueLabel.toLowerCase()}`}</span>
                </>
              ) : (
                <EmptyValue context="field" />
              )}
            </Fact>
          </FactList>
        </Card>
      </div>
      </> : null}

      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
          <DialogPanel size="md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Save report</DialogTitle>
              <DialogIconClose />
            </DialogHeader>
            <div className="mt-4 space-y-4">
              {/* The failure is the name field's, so it sits under the name (§7.5). It was a
                  red box here and the same red box on the page behind the dialog. */}
              <Field data-invalid={Boolean(saveError) || undefined}>
                <FieldLabel htmlFor="saved-report-name">Name</FieldLabel>
                <Input
                  id="saved-report-name"
                  value={saveName}
                  onChange={(event) => { setSaveName(event.target.value); setSaveError(""); }}
                  placeholder="Monthly lead status"
                  aria-invalid={Boolean(saveError)}
                  aria-describedby={saveError ? "saved-report-name-error" : undefined}
                />
                {saveError ? <FieldError id="saved-report-name-error">{saveError}</FieldError> : null}
              </Field>
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
    </PageShell>
  );
}

/** A forecast breakdown: an ink group under its heading, one `ListRow` per bucket (§7.15). */
function ForecastBucketList({ title, rows }: { title: string; rows: ForecastBucket[] }) {
  return (
    <section>
      <SectionHeading as="h3">{title}</SectionHeading>
      {rows.length ? (
        <RowList label={`Forecast ${title.toLowerCase()}`} className="mt-3">
          {rows.slice(0, 5).map((row) => (
            <ListRow
              key={row.key}
              title={row.label}
              meta={`${row.count} opportunities`}
              // A weighted amount is a number, not good news (R5).
              trailing={<span className="text-sm font-medium text-copy-primary">{formatCurrency(row.weighted_pipeline_amount)}</span>}
            />
          ))}
        </RowList>
      ) : (
        <p className="mt-3 text-sm text-copy-muted">No forecast data in this period.</p>
      )}
    </section>
  );
}
