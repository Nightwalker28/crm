/**
 * Report dashboards (docs/crm-evolution/11-reports.md Phase 2): pages of saved reports with
 * dashboard-wide filters. A widget holds a report ID; the server resolves it for the viewer,
 * and each widget then runs its report through `POST /reports/run` as that viewer.
 */

import type { DashboardWidgetSize } from "@/components/dashboard/DashboardLayoutEditor";
import { apiFetch } from "@/lib/api";
import { DATE_RANGE_OPTIONS, type ReportChartType, type ReportConfig, type ReportModule, type ReportScope, type SavedReport } from "@/lib/reports";

export type DashboardWidgetKind = "chart" | "table" | "kpi";

export type ReportDashboardFilters = { date_range: string; scope: "report" | ReportScope };

export type ReportDashboardWidget = {
  id: string;
  type: DashboardWidgetKind;
  size: DashboardWidgetSize;
  report_id: number;
  title: string | null;
  chart_type: ReportChartType | null;
  target: number | null;
  report?: SavedReport | null;
  unavailable_reason?: "missing" | "not_shared" | "no_access" | null;
};

export type ReportDashboardSummary = {
  id: number;
  name: string;
  description: string | null;
  visibility: "private" | "everyone";
  owner_id: number | null;
  owner_name: string | null;
  can_edit: boolean;
  widget_count: number;
  filters: ReportDashboardFilters;
  created_at: string;
  updated_at: string;
};

export type ReportDashboard = ReportDashboardSummary & { widgets: ReportDashboardWidget[] };

export const DEFAULT_DASHBOARD_FILTERS: ReportDashboardFilters = { date_range: "report", scope: "report" };

export const WIDGET_KIND_LABELS: Record<DashboardWidgetKind, string> = {
  chart: "Chart",
  table: "Table",
  kpi: "Key figure",
};

/** Dashboard date filters: each report's own range, or one relative range for all. */
export const DASHBOARD_DATE_OPTIONS = [
  { value: "report", label: "Each report's own dates" },
  ...DATE_RANGE_OPTIONS.filter((option) => option.value !== "custom"),
];

export const DASHBOARD_SCOPE_OPTIONS: { value: ReportDashboardFilters["scope"]; label: string }[] = [
  { value: "report", label: "Each report's own setting" },
  { value: "all", label: "All records" },
  { value: "mine", label: "My records" },
  { value: "my_team", label: "My team's records" },
];

export const UNAVAILABLE_COPY: Record<NonNullable<ReportDashboardWidget["unavailable_reason"]>, { title: string; description: string }> = {
  missing: { title: "This report was deleted", description: "Remove this widget, or replace it with another report." },
  not_shared: { title: "This report is not shared with you", description: "Its owner keeps it private. Ask them to share it with everyone." },
  no_access: { title: "You cannot view this report's module", description: "Ask an administrator for access to the module it reports on." },
};

/**
 * The dashboard's filters laid over one report's definition, the way HubSpot and Salesforce
 * dashboard filters work: a date range moves the report's own date field (or, if it has
 * none, its module's default date), and "Show me" replaces the report's own.
 */
export function applyDashboardFilters(config: ReportConfig, module: ReportModule | null, filters: ReportDashboardFilters): ReportConfig {
  let next = config;
  if (filters.date_range !== "report") {
    const field = config.date_filter?.field ?? module?.default_date_field ?? null;
    if (field) {
      next = { ...next, date_filter: filters.date_range === "all_time" ? null : { field, range: filters.date_range, start: null, end: null } };
    }
  }
  if (filters.scope !== "report" && module?.supports_scope) {
    next = { ...next, scope: filters.scope };
  }
  return next;
}

export function newWidgetId() {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function readJson<T>(response: Response, failure: string): Promise<T> {
  if (!response.ok) {
    const error = new Error(failure) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return response.json() as Promise<T>;
}

function body(method: string, payload: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

/** What the server stores for a widget: the resolved report stays behind. */
function serializeWidget(widget: ReportDashboardWidget) {
  const { id, type, size, report_id, title, chart_type, target } = widget;
  return { id, type, size, report_id, title, chart_type: type === "chart" ? chart_type : null, target: type === "kpi" ? target : null };
}

export async function fetchReportDashboards(params: { scope?: "mine" | "shared"; search?: string } = {}) {
  const query = new URLSearchParams();
  if (params.scope) query.set("scope", params.scope);
  if (params.search?.trim()) query.set("search", params.search.trim());
  const suffix = query.toString();
  return readJson<{ results: ReportDashboardSummary[] }>(await apiFetch(`/reports/dashboards${suffix ? `?${suffix}` : ""}`), "dashboards-failed");
}

export async function fetchReportDashboard(dashboardId: number) {
  return readJson<ReportDashboard>(await apiFetch(`/reports/dashboards/${dashboardId}`), "dashboard-failed");
}

export async function createReportDashboard(payload: { name: string; description: string | null; visibility: "private" | "everyone" }) {
  return readJson<ReportDashboard>(await apiFetch("/reports/dashboards", body("POST", { ...payload, widgets: [] })), "dashboard-create-failed");
}

export async function updateReportDashboard(
  dashboardId: number,
  payload: { name?: string; description?: string | null; visibility?: "private" | "everyone"; widgets?: ReportDashboardWidget[]; filters?: ReportDashboardFilters },
) {
  const { widgets, ...rest } = payload;
  return readJson<ReportDashboard>(
    await apiFetch(`/reports/dashboards/${dashboardId}`, body("PUT", widgets ? { ...rest, widgets: widgets.map(serializeWidget) } : rest)),
    "dashboard-update-failed",
  );
}

export async function deleteReportDashboard(dashboardId: number) {
  const response = await apiFetch(`/reports/dashboards/${dashboardId}`, { method: "DELETE" });
  if (!response.ok) throw new Error("dashboard-delete-failed");
}

export function dashboardHref(dashboardId: number) {
  return `/dashboard/reports/dashboards/${dashboardId}`;
}
