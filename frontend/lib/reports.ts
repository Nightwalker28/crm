/**
 * Reports, version 2 (docs/crm-evolution/11-reports.md). Types, API calls and the
 * vocabulary the library, the viewer and the builder share.
 *
 * Every run goes to the server: the engine evaluates a definition as the person viewing it,
 * so nothing here filters or totals records itself.
 */

import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { apiFetch } from "@/lib/api";
import { DEFAULT_CURRENCY, formatMoney } from "@/lib/currency";
import { formatDateOnly, formatDateTime } from "@/lib/datetime";
import type { ModuleFilterField } from "@/lib/moduleViewConfigs";

export type ReportFieldType = "text" | "select" | "number" | "money" | "date" | "datetime" | "boolean" | "user" | "reference";

export type ReportField = {
  key: string;
  label: string;
  field_type: ReportFieldType;
  groupable: boolean;
  measurable: boolean;
  filter_type: "text" | "number" | "date" | "boolean";
  reference?: string | null;
  options?: { value: string; label: string }[] | null;
};

export type ReportModule = {
  module_key: string;
  label: string;
  fields: ReportField[];
  default_date_field: string | null;
  default_columns: string[];
  supports_scope: boolean;
  has_record_pages: boolean;
};

export type ReportFormat = "summary" | "matrix" | "tabular";
export type ReportAggregate = "count" | "sum" | "avg" | "min" | "max";
export type ReportGranularity = "day" | "week" | "month" | "quarter" | "year";
export type ReportScope = "all" | "mine" | "my_team";
export type ReportChartType = "column" | "bar" | "line" | "donut" | "funnel" | "metric" | "none";

export type ReportGroupingConfig = { field: string; granularity?: ReportGranularity | null };
export type ReportMeasureConfig = { aggregate: ReportAggregate; field?: string | null };
export type ReportDateFilter = { field: string; range: string; start?: string | null; end?: string | null } | null;

export type ReportConfig = {
  version: 2;
  format: ReportFormat;
  groupings: ReportGroupingConfig[];
  measures: ReportMeasureConfig[];
  scope: ReportScope;
  date_filter: ReportDateFilter;
  filters: SavedViewFilters;
  columns: string[];
  chart: { type: ReportChartType };
  sort: { by: string; direction: "asc" | "desc" };
  limit: number;
};

export type ReportGroupRef = { key: string; label: string };
export type ReportMeasure = { key: string; aggregate: ReportAggregate; field: string | null; label: string; field_type: ReportFieldType };
export type ReportRow = { keys: string[]; labels: string[]; count: number; values: (number | null)[] };

export type ReportRecord = { id: number; label: string; path: string | null; values: Record<string, unknown> };
export type ReportRecords = { columns: ReportField[]; records: ReportRecord[]; total: number; offset: number; limit: number };

export type ReportResult = {
  module_key: string;
  label: string;
  config: ReportConfig;
  groupings: (ReportField & { granularity: ReportGranularity | null })[];
  measures: ReportMeasure[];
  rows: ReportRow[];
  subtotals: ReportRow[];
  totals: { count: number; values: (number | null)[] };
  row_groups: ReportGroupRef[];
  column_groups: ReportGroupRef[];
  truncated: boolean;
  records: ReportRecords | null;
  generated_at: string;
};

export type SavedReport = {
  id: number;
  module_key: string;
  module_label: string | null;
  name: string;
  description: string | null;
  visibility: "private" | "everyone";
  owner_id: number | null;
  owner_name: string | null;
  can_edit: boolean;
  config: Partial<ReportConfig> & Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ReportTemplate = {
  key: string;
  category: string;
  name: string;
  description: string;
  module_key: string;
  module_label: string;
  config: ReportConfig;
};

// ------------------------------------------------------------------------- vocabulary

export const EMPTY_GROUP_KEY = "__empty__";

export const FORMAT_LABELS: Record<ReportFormat, string> = {
  summary: "Summary",
  matrix: "Matrix",
  tabular: "Tabular",
};

export const FORMAT_DESCRIPTIONS: Record<ReportFormat, string> = {
  summary: "Groups records and totals each group.",
  matrix: "Groups by rows and by columns, like a pivot table.",
  tabular: "A list of records with the columns you choose.",
};

export const AGGREGATE_LABELS: Record<ReportAggregate, string> = {
  count: "Record count",
  sum: "Sum",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};

export const GRANULARITY_LABELS: Record<ReportGranularity, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  quarter: "Quarter",
  year: "Year",
};

export const SCOPE_LABELS: Record<ReportScope, string> = {
  all: "All records",
  mine: "My records",
  my_team: "My team's records",
};

export const CHART_LABELS: Record<ReportChartType, string> = {
  column: "Column",
  bar: "Bar",
  line: "Line",
  donut: "Donut",
  funnel: "Funnel",
  metric: "Metric",
  none: "No chart",
};

export const DATE_RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: "all_time", label: "All time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this_week", label: "This week" },
  { value: "last_week", label: "Last week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "next_quarter", label: "Next quarter" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
  { value: "last_7_days", label: "Last 7 days" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "next_30_days", label: "Next 30 days" },
  { value: "next_90_days", label: "Next 90 days" },
  { value: "custom", label: "Custom range" },
];

export function dateRangeLabel(range: string) {
  return DATE_RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range;
}

export const EMPTY_FILTERS: SavedViewFilters = { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] };

export function defaultReportConfig(module: ReportModule | null): ReportConfig {
  const firstGroup = module?.fields.find((field) => field.groupable && !["date", "datetime"].includes(field.field_type));
  return {
    version: 2,
    format: "summary",
    groupings: firstGroup ? [{ field: firstGroup.key }] : [],
    measures: [{ aggregate: "count" }],
    scope: "all",
    date_filter: null,
    filters: { ...EMPTY_FILTERS },
    columns: module?.default_columns ?? [],
    chart: { type: "column" },
    sort: { by: "value", direction: "desc" },
    limit: 25,
  };
}

/** A saved version 1 config, read the way the server reads it (11-reports.md §4.2). */
export function upgradeReportConfig(config: SavedReport["config"] | ReportConfig | null | undefined): ReportConfig {
  const raw = (config ?? {}) as Record<string, unknown>;
  if (raw.version === 2) {
    const base = defaultReportConfig(null);
    return { ...base, ...(raw as Partial<ReportConfig>), filters: { ...EMPTY_FILTERS, ...((raw.filters as SavedViewFilters) ?? {}) } } as ReportConfig;
  }
  const viewMode = String(raw.view_mode ?? "bar");
  return {
    ...defaultReportConfig(null),
    groupings: raw.dimension ? [{ field: String(raw.dimension), granularity: "month" }] : [],
    measures: raw.metric === "sum" && raw.metric_field ? [{ aggregate: "sum", field: String(raw.metric_field) }] : [{ aggregate: "count" }],
    filters: { ...EMPTY_FILTERS, ...((raw.filters as SavedViewFilters) ?? {}) },
    chart: { type: viewMode === "pie" ? "donut" : viewMode === "table" ? "none" : "column" },
  };
}

/** The filter editor's view of a report field. Owners pick people; accounts pick accounts. */
export function toFilterField(field: ReportField): ModuleFilterField {
  const recordType = field.reference === "user" || field.reference === "team" || field.reference === "organization" || field.reference === "contact"
    ? field.reference
    : undefined;
  if (recordType) {
    return { key: field.key, label: field.label, type: "relation", recordType, operators: ["is", "is_not", "is_empty", "is_not_empty"] };
  }
  if (field.options?.length) {
    return { key: field.key, label: field.label, type: "select", options: field.options };
  }
  if (field.field_type === "boolean") {
    return { key: field.key, label: field.label, type: "select", options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] };
  }
  const type = field.filter_type === "number" ? "number" : field.filter_type === "date" ? "date" : "text";
  return { key: field.key, label: field.label, type };
}

// ---------------------------------------------------------------------------- format

export function formatMeasureValue(value: number | null | undefined, fieldType: ReportFieldType | undefined, options: { compact?: boolean } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (fieldType === "money") {
    return formatMoney(value, DEFAULT_CURRENCY, options.compact ? { compact: true } : { maximumFractionDigits: 0 }) ?? "—";
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2, notation: options.compact ? "compact" : "standard" }).format(value);
}

export function formatRecordValue(value: unknown, field: ReportField): string | null {
  if (value === null || value === undefined || value === "") return null;
  switch (field.field_type) {
    case "money":
      return formatMoney(Number(value), DEFAULT_CURRENCY) ?? null;
    case "number":
      return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value));
    case "date":
      return formatDateOnly(String(value));
    case "datetime":
      return formatDateTime(String(value), { hour: "numeric", minute: "2-digit" });
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return String(value);
  }
}

/** "Deals · My records · Expected close this quarter · 2 filters" — what a report covers. */
export function describeReportScope(config: ReportConfig, module: ReportModule | null) {
  const parts: string[] = [];
  if (module) parts.push(module.label);
  if (module?.supports_scope) parts.push(SCOPE_LABELS[config.scope] ?? SCOPE_LABELS.all);
  if (config.date_filter && config.date_filter.range !== "all_time") {
    const field = module?.fields.find((item) => item.key === config.date_filter?.field);
    const range = config.date_filter.range === "custom"
      ? [config.date_filter.start, config.date_filter.end].filter(Boolean).map((value) => formatDateOnly(String(value))).join(" to ")
      : dateRangeLabel(config.date_filter.range).toLocaleLowerCase();
    parts.push(`${field?.label ?? "Date"} ${range}`);
  }
  const conditionCount = (config.filters.all_conditions?.length ?? 0) + (config.filters.any_conditions?.length ?? 0);
  if (conditionCount) parts.push(`${conditionCount} ${conditionCount === 1 ? "filter" : "filters"}`);
  if (typeof config.filters.search === "string" && config.filters.search.trim()) parts.push(`Matching “${config.filters.search.trim()}”`);
  return parts.join(" · ");
}

// -------------------------------------------------------------------------------- API

async function readJson<T>(response: Response, failure: string): Promise<T> {
  if (!response.ok) {
    const error = new Error(failure) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

/** Strip the editor's UI-only keys (`filtersOpen`) before a definition leaves the page. */
export function serializeReportConfig(config: ReportConfig): ReportConfig {
  const { all_conditions = [], any_conditions = [], search = "" } = config.filters;
  return { ...config, filters: { search, logic: "all", conditions: [], all_conditions, any_conditions } };
}

export async function fetchReportModules() {
  return readJson<{ results: ReportModule[] }>(await apiFetch("/reports/modules"), "report-modules-failed");
}

export async function fetchReportTemplates() {
  return readJson<{ results: ReportTemplate[] }>(await apiFetch("/reports/templates"), "report-templates-failed");
}

export async function runReport(moduleKey: string, config: ReportConfig) {
  return readJson<ReportResult>(
    await apiFetch("/reports/run", jsonPost({ module_key: moduleKey, config: serializeReportConfig(config) })),
    "report-run-failed",
  );
}

export async function fetchReportRecords(moduleKey: string, config: ReportConfig, groupKeys: string[] | null, offset = 0, limit = 25) {
  return readJson<ReportRecords>(
    await apiFetch(
      "/reports/run/records",
      jsonPost({ module_key: moduleKey, config: serializeReportConfig(config), group_keys: groupKeys, offset, limit }),
    ),
    "report-records-failed",
  );
}

export async function exportReportCsv(moduleKey: string, config: ReportConfig) {
  const response = await apiFetch("/reports/run/export.csv", jsonPost({ module_key: moduleKey, config: serializeReportConfig(config) }));
  if (!response.ok) throw new Error("report-export-failed");
  return response.blob();
}

export async function exportReportXlsx(moduleKey: string, config: ReportConfig) {
  const response = await apiFetch("/reports/run/export.xlsx", jsonPost({ module_key: moduleKey, config: serializeReportConfig(config) }));
  if (!response.ok) throw new Error("report-export-failed");
  return response.blob();
}

export async function fetchSavedReports(params: { scope?: "mine" | "shared"; search?: string; moduleKey?: string; sort?: { key: string; direction: "asc" | "desc" } | null } = {}) {
  const query = new URLSearchParams();
  if (params.scope) query.set("scope", params.scope);
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.moduleKey) query.set("module_key", params.moduleKey);
  if (params.sort) {
    query.set("sort_by", params.sort.key);
    query.set("sort_direction", params.sort.direction);
  }
  const suffix = query.toString();
  return readJson<{ results: SavedReport[] }>(await apiFetch(`/reports/saved${suffix ? `?${suffix}` : ""}`), "saved-reports-failed");
}

export async function fetchSavedReport(reportId: number) {
  return readJson<SavedReport>(await apiFetch(`/reports/saved/${reportId}`), "saved-report-failed");
}

export type SavedReportPayload = {
  name: string;
  description: string | null;
  visibility: "private" | "everyone";
  config: ReportConfig;
};

export async function createSavedReport(moduleKey: string, payload: SavedReportPayload) {
  return readJson<SavedReport>(
    await apiFetch("/reports/saved", jsonPost({ module_key: moduleKey, ...payload, config: serializeReportConfig(payload.config) })),
    "saved-report-create-failed",
  );
}

export async function updateSavedReport(reportId: number, payload: Partial<SavedReportPayload>) {
  return readJson<SavedReport>(
    await apiFetch(`/reports/saved/${reportId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload.config ? { ...payload, config: serializeReportConfig(payload.config) } : payload),
    }),
    "saved-report-update-failed",
  );
}

export async function deleteSavedReport(reportId: number) {
  const response = await apiFetch(`/reports/saved/${reportId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("saved-report-delete-failed");
}

export function reportHref(reportId: number) {
  return `/dashboard/reports/${reportId}`;
}
