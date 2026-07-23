"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardList,
  Filter,
  FileText,
  GripVertical,
  NotebookText,
  Rows3,
  LayoutDashboard,
  LayoutGrid,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { useAccessibleModules, type AccessibleModule } from "@/hooks/useAccessibleModules";
import { useNotifications } from "@/hooks/useNotifications";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { getModuleDisplayName } from "@/lib/module-display";
import { getModuleRoute } from "@/lib/module-registry";
import { DASHBOARD_ROUTES, SETTINGS_ROUTES, canonicalizeDashboardHref } from "@/lib/routes";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";
import { cn } from "@/lib/utils";
import type { SavedViewFilters } from "@/hooks/useSavedViews";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltipContent } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/EmptyState";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";

type ActivityItem = {
  id: number;
  module_key: string;
  entity_type: string;
  entity_id: string;
  action: string;
  description?: string | null;
  created_at: string;
};

type ActivityResponse = {
  results: ActivityItem[];
  total_count: number;
};

type CrmBucket = {
  key: string;
  label: string;
  count: number;
  value: number;
};

type OwnerPerformance = {
  owner_id?: number | null;
  owner_name: string;
  lead_count: number;
  deal_count: number;
  won_deal_count: number;
  quote_count: number;
  total_activity: number;
};

type CrmDashboardSummary = {
  period_days: number;
  modules?: Record<string, boolean>;
  lead_status: CrmBucket[];
  lead_sources: CrmBucket[];
  new_leads: number;
  deal_stages: CrmBucket[];
  pipeline_value: number;
  forecast_summary?: {
    weighted_pipeline_amount: number | string;
    gross_pipeline_amount: number | string;
    commit_amount: number | string;
    best_case_amount: number | string;
    actual_revenue_amount: number | string;
    open_opportunity_count: number;
    won_opportunity_count: number;
    by_stage: CrmForecastBucket[];
  } | null;
  won_deals: number;
  lost_deals: number;
  quote_status: CrmBucket[];
  overdue_follow_ups: number;
  upcoming_tasks: number;
  owner_performance: OwnerPerformance[];
};

type CrmForecastBucket = {
  key: string;
  label: string;
  count: number;
  gross_pipeline_amount: number | string;
  weighted_pipeline_amount: number | string;
  commit_amount: number | string;
  best_case_amount: number | string;
  actual_revenue_amount: number | string;
};

type WidgetSize = "small" | "medium" | "large" | "wide";
type WidgetType =
  | "crm_snapshot"
  | "module_entry_points"
  | "quick_actions"
  | "recent_activity"
  | "notifications"
  | "lead_status"
  | "deal_stages"
  | "quote_status"
  | "owner_performance"
  | "module_summary"
  | "note"
  | "summary_table"
  | "pipeline_funnel"
  | "weighted_forecast"
  | "report_chart";

type DashboardWidget = {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  module_key?: string;
  config?: Record<string, unknown>;
};

type DashboardLayoutResponse = {
  widgets: DashboardWidget[];
  has_layout: boolean;
};

type WidgetCatalogItem = {
  type: WidgetType;
  title: string;
  description: string;
  defaultSize: WidgetSize;
  module_key?: string;
  config?: Record<string, unknown>;
};

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

type SavedReport = {
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

const DEFAULT_WIDGETS: DashboardWidget[] = [
  { id: "default-crm-snapshot", type: "crm_snapshot", size: "wide" },
  { id: "default-weighted-forecast", type: "weighted_forecast", size: "large" },
  { id: "default-pipeline-funnel", type: "pipeline_funnel", size: "large" },
  { id: "default-quick-actions", type: "quick_actions", size: "medium" },
  { id: "default-summary-table", type: "summary_table", size: "large" },
  { id: "default-lead-status", type: "lead_status", size: "medium" },
  { id: "default-deal-stages", type: "deal_stages", size: "medium" },
  { id: "default-quote-status", type: "quote_status", size: "medium" },
  { id: "default-owner-performance", type: "owner_performance", size: "large" },
  { id: "default-recent-activity", type: "recent_activity", size: "large" },
  { id: "default-notifications", type: "notifications", size: "medium" },
];

const SIZE_LABELS: Record<WidgetSize, string> = {
  small: "S",
  medium: "M",
  large: "L",
  wide: "W",
};

async function fetchDashboardActivity(): Promise<ActivityResponse> {
  const res = await apiFetch("/activity?page=1&page_size=6");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load recent activity.");
  }
  return body as ActivityResponse;
}

async function fetchCrmDashboardSummary(periodDays: number): Promise<CrmDashboardSummary> {
  const res = await apiFetch(`/reports/crm-summary?period_days=${periodDays}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load CRM dashboard summary.");
  }
  return body as CrmDashboardSummary;
}

async function fetchDashboardLayout(): Promise<DashboardLayoutResponse> {
  const res = await apiFetch("/users/dashboard-layout");
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to load dashboard layout.");
  }
  return body as DashboardLayoutResponse;
}

async function saveDashboardLayout(widgets: DashboardWidget[]): Promise<DashboardLayoutResponse> {
  const res = await apiFetch("/users/dashboard-layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ widgets }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to save dashboard layout.");
  }
  return body as DashboardLayoutResponse;
}

async function fetchSavedReports() {
  const res = await apiFetch("/reports/saved");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<{ results: SavedReport[] }>;
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

async function fetchReportForSavedReport(report: SavedReport) {
  const params = buildReportParams(report.config);
  const res = await apiFetch(`/reports/modules/${report.module_key}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
  return res.json() as Promise<ReportResponse>;
}

function getActionLabel(action: string) {
  return action.replace(/_/g, " ");
}

function formatCurrency(value: number | string | null | undefined) {
  const amount = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount ?? NaN) ? amount ?? 0 : 0);
}

function totalCount(rows: CrmBucket[]) {
  return rows.reduce((sum, row) => sum + row.count, 0);
}

function sizeClass(size: WidgetSize) {
  if (size === "small") return "md:col-span-1 xl:col-span-1";
  if (size === "large") return "md:col-span-2 xl:col-span-3";
  if (size === "wide") return "md:col-span-2 xl:col-span-4";
  return "md:col-span-1 xl:col-span-2";
}

function nextWidgetId(type: WidgetType, moduleKey?: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return [type, moduleKey, suffix].filter(Boolean).join("-");
}

function isCrmWidget(type: WidgetType) {
  return ["crm_snapshot", "lead_status", "deal_stages", "quote_status", "owner_performance", "pipeline_funnel", "weighted_forecast", "summary_table"].includes(type);
}

function widgetTitle(widget: DashboardWidget, modulesByName: Map<string, AccessibleModule>) {
  if (widget.type === "crm_snapshot") return "CRM Snapshot";
  if (widget.type === "module_entry_points") return "Module Entry Points";
  if (widget.type === "quick_actions") return "Quick Actions";
  if (widget.type === "recent_activity") return "Recent Activity";
  if (widget.type === "notifications") return "Notifications";
  if (widget.type === "lead_status") return "Leads By Status";
  if (widget.type === "deal_stages") return "Deals By Stage";
  if (widget.type === "quote_status") return "Quotes By Status";
  if (widget.type === "owner_performance") return "Owner Performance";
  if (widget.type === "note") return "Quick Note";
  if (widget.type === "summary_table") return "Summary Table";
  if (widget.type === "pipeline_funnel") return "Pipeline Funnel";
  if (widget.type === "weighted_forecast") return "Weighted Forecast";
  if (widget.type === "report_chart") return "Saved Report Chart";
  const dashboardModule = widget.module_key ? modulesByName.get(widget.module_key) : null;
  return dashboardModule ? getModuleDisplayName(dashboardModule.name, dashboardModule.description ?? undefined) : "Module Summary";
}

function BucketList({ rows, emptyLabel }: { rows: CrmBucket[]; emptyLabel: string }) {
  const total = Math.max(totalCount(rows), 1);
  if (!rows.length) {
    return <div className="rounded-lg border border-dashed border-neutral-800 bg-black/20 px-4 py-5 text-sm text-neutral-500">{emptyLabel}</div>;
  }
  return (
    <div className="space-y-3">
      {rows.slice(0, 5).map((row) => (
        <div key={row.key}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate text-neutral-300">{row.label}</span>
            <span className="font-medium text-neutral-100">{row.count}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-neutral-900">
            <div className="h-1.5 rounded-full bg-emerald-400/70" style={{ width: `${Math.max(6, (row.count / total) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function WidgetShell({
  title,
  icon,
  widget,
  index,
  count,
  children,
  onMove,
  onResize,
  onRemove,
  onDragStart,
  onDrop,
  isEditing,
}: {
  title: string;
  icon: ReactNode;
  widget: DashboardWidget;
  index: number;
  count: number;
  children: ReactNode;
  onMove: (from: number, to: number) => void;
  onResize: (id: string, size: WidgetSize) => void;
  onRemove: (id: string) => void;
  onDragStart: (index: number) => void;
  onDrop: (index: number) => void;
  isEditing: boolean;
}) {
  return (
    <section
      data-testid={`dashboard-widget-${widget.id}`}
      draggable={isEditing}
      onDragStart={() => {
        if (isEditing) onDragStart(index);
      }}
      onDragOver={(event) => {
        if (isEditing) event.preventDefault();
      }}
      onDrop={() => {
        if (isEditing) onDrop(index);
      }}
      className={cn(
        "rounded-[var(--radius-card)] border border-line-subtle bg-surface",
        isEditing && "border-line-strong bg-surface-raised shadow-sm",
        sizeClass(widget.size),
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {isEditing ? <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-copy-muted" aria-label="Drag widget" /> : null}
          <div className="text-copy-muted">{icon}</div>
          <h2 className="truncate text-sm font-semibold text-copy-primary">{title}</h2>
        </div>
        {isEditing ? (
          <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
              <ArrowUp />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move ${title} down`} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
              <ArrowDown />
            </Button>
            <div className="mx-1 flex rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted p-0.5" aria-label={`Resize ${title}`}>
              {(Object.keys(SIZE_LABELS) as WidgetSize[]).map((size) => (
                <button
                  key={size}
                  type="button"
                  aria-label={`Resize ${title} to ${size}`}
                  aria-pressed={widget.size === size}
                  onClick={() => onResize(widget.id, size)}
                  className={cn(
                    "h-7 min-w-7 rounded-[var(--radius-control-sm)] px-2 text-xs font-medium text-copy-muted hover:bg-surface-raised hover:text-copy-primary",
                    widget.size === size && "bg-primary text-primary-foreground",
                  )}
                >
                  {SIZE_LABELS[size]}
                </button>
              ))}
            </div>
            <Button type="button" variant="dangerGhost" size="icon-sm" aria-label={`Remove ${title}`} onClick={() => onRemove(widget.id)}>
              <Trash2 />
            </Button>
          </div>
        ) : null}
      </div>
      <div className={cn("p-4", isEditing && "pointer-events-none select-none opacity-80")}>{children}</div>
    </section>
  );
}

export default function DashboardHomePage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draftWidgets, setDraftWidgets] = useState<DashboardWidget[]>(DEFAULT_WIDGETS);
  const [periodDays, setPeriodDays] = useState(30);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { modules, isLoading: isModulesLoading } = useAccessibleModules();
  const { notifications, unreadCount, isLoading: isNotificationsLoading } = useNotifications();

  const layoutQuery = useQuery({
    queryKey: ["dashboard-layout"],
    queryFn: fetchDashboardLayout,
    staleTime: 30000,
  });

  const persistedWidgets = layoutQuery.data?.has_layout ? layoutQuery.data.widgets : DEFAULT_WIDGETS;
  const widgets = isEditing ? draftWidgets : persistedWidgets;
  const isLayoutDirty = isEditing && JSON.stringify(draftWidgets) !== JSON.stringify(persistedWidgets);

  const accessibleRoutes = useMemo(
    () => new Set(modules.map((module) => getModuleRoute(module.name, module.base_route)).filter(Boolean)),
    [modules],
  );
  const modulesByName = useMemo(() => new Map(modules.map((module) => [module.name, module])), [modules]);
  const hasReportAccess = accessibleRoutes.has(DASHBOARD_ROUTES.reports);
  const hasCrmWidgets = widgets.some((widget) => (
    isCrmWidget(widget.type) ||
    (widget.type === "module_summary" && ["sales_leads", "sales_opportunities", "sales_quotes", "tasks"].includes(widget.module_key || ""))
  ));

  const activityQuery = useQuery({
    queryKey: ["dashboard-home-activity"],
    queryFn: fetchDashboardActivity,
    staleTime: 30000,
    enabled: widgets.some((widget) => widget.type === "recent_activity"),
  });
  const crmSummaryQuery = useQuery({
    queryKey: ["dashboard-crm-summary", periodDays],
    queryFn: () => fetchCrmDashboardSummary(periodDays),
    staleTime: 30000,
    enabled: hasReportAccess && hasCrmWidgets,
  });
  const savedReportsQuery = useQuery({
    queryKey: ["dashboard-saved-reports"],
    queryFn: fetchSavedReports,
    staleTime: 60000,
    enabled: hasReportAccess,
  });
  const savedReports = useMemo(() => savedReportsQuery.data?.results ?? [], [savedReportsQuery.data?.results]);

  const saveMutation = useMutation({
    mutationFn: saveDashboardLayout,
    onSuccess: (data) => {
      queryClient.setQueryData(["dashboard-layout"], data);
      setDraftWidgets(data.widgets);
      setIsEditing(false);
      setAddOpen(false);
      toast.success("Dashboard layout saved.");
    },
    onError: () => toast.error("The dashboard layout could not be saved."),
  });
  useUnsavedChangesGuard(isLayoutDirty, saveMutation.isPending);

  const quickActions = useMemo(() => {
    const actions = [
      { href: DASHBOARD_ROUTES.tasks, label: "Tasks", helper: "Open assigned and team work queues" },
      { href: DASHBOARD_ROUTES.calendar, label: "Calendar", helper: "Schedule internal events and review invites" },
      { href: DASHBOARD_ROUTES.mail, label: "Mail", helper: "Open connected mailbox and CRM communication history" },
      { href: DASHBOARD_ROUTES.documents, label: "Documents", helper: "Review uploaded and record-linked documents" },
      { href: DASHBOARD_ROUTES.contacts, label: "Contacts", helper: "Open the CRM contact list" },
      { href: DASHBOARD_ROUTES.accounts, label: "Accounts", helper: "Open account records" },
      { href: DASHBOARD_ROUTES.deals, label: "Deals", helper: "Review and update pipeline" },
      { href: DASHBOARD_ROUTES.quotes, label: "Quotes", helper: "Review CRM quote status and follow-up" },
    ];
    return actions.filter((action) => accessibleRoutes.has(action.href));
  }, [accessibleRoutes]);

  const catalog = useMemo<WidgetCatalogItem[]>(() => {
    const items: WidgetCatalogItem[] = [
      { type: "note", title: "Quick Note", description: "A personal scratchpad that stays on your dashboard.", defaultSize: "medium", config: { body: "" } },
      { type: "summary_table", title: "Summary Table", description: "A searchable table of available modules and key CRM totals.", defaultSize: "large" },
      { type: "module_entry_points", title: "Module Entry Points", description: "A compact launcher for every module you can access.", defaultSize: "large" },
      { type: "quick_actions", title: "Quick Actions", description: "Fast links into common work areas.", defaultSize: "medium" },
      { type: "recent_activity", title: "Recent Activity", description: "Latest audited platform writes.", defaultSize: "large" },
      { type: "notifications", title: "Notifications", description: "Recent per-user operational updates.", defaultSize: "medium" },
    ];
    if (hasReportAccess) {
      items.unshift(
        { type: "crm_snapshot", title: "CRM Snapshot", description: "Pipeline, leads, closed deals, and follow-ups.", defaultSize: "wide" },
        { type: "weighted_forecast", title: "Weighted Forecast", description: "Weighted pipeline forecast for the next reporting period.", defaultSize: "large" },
        { type: "pipeline_funnel", title: "Pipeline Funnel", description: "A funnel view of deal stages and pipeline value.", defaultSize: "large" },
        { type: "lead_status", title: "Leads By Status", description: "Lead distribution by current status.", defaultSize: "medium" },
        { type: "deal_stages", title: "Deals By Stage", description: "Opportunity counts and value by stage.", defaultSize: "medium" },
        { type: "quote_status", title: "Quotes By Status", description: "Quote distribution by status.", defaultSize: "medium" },
        { type: "owner_performance", title: "Owner Performance", description: "Assigned CRM workload and won deals.", defaultSize: "large" },
      );
      savedReports.forEach((report) => {
        items.push({
          type: "report_chart",
          title: `Chart: ${report.name}`,
          description: `${getModuleDisplayName(report.module_key)} by ${report.config.dimension}`,
          defaultSize: "large",
          config: { saved_report_id: report.id },
        });
      });
    }
    modules.forEach((module) => {
      if (!module.base_route) return;
      items.push({
        type: "module_summary",
        title: `${getModuleDisplayName(module.name, module.description ?? undefined)} Summary`,
        description: module.description || "Quick access and module context.",
        defaultSize: "small",
        module_key: module.name,
      });
    });
    return items;
  }, [hasReportAccess, modules, savedReports]);

  function updateDraft(nextWidgets: DashboardWidget[]) {
    if (!isEditing) return;
    setDraftWidgets(nextWidgets);
  }

  function moveWidget(from: number, to: number) {
    if (to < 0 || to >= widgets.length) return;
    const next = [...widgets];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    updateDraft(next);
  }

  function resizeWidget(id: string, size: WidgetSize) {
    updateDraft(widgets.map((widget) => (widget.id === id ? { ...widget, size } : widget)));
  }

  function removeWidget(id: string) {
    updateDraft(widgets.filter((widget) => widget.id !== id));
  }

  function addWidget(item: WidgetCatalogItem) {
    if (widgets.length >= 24) {
      toast.error("A dashboard can include at most 24 widgets.");
      return;
    }
    updateDraft([
      ...widgets,
      {
        id: nextWidgetId(item.type, item.module_key),
        type: item.type,
        size: item.defaultSize,
        module_key: item.module_key,
        config: item.config,
      },
    ]);
    setAddOpen(false);
  }

  function updateWidgetConfig(id: string, config: Record<string, unknown>) {
    const nextWidgets = widgets.map((widget) => (widget.id === id ? { ...widget, config: { ...(widget.config ?? {}), ...config } } : widget));
    if (isEditing) {
      setDraftWidgets(nextWidgets);
      return;
    }
    saveMutation.mutate(nextWidgets);
  }

  function resetLayout() {
    if (!window.confirm("Reset this draft to the default dashboard widgets?")) return;
    setDraftWidgets(DEFAULT_WIDGETS);
  }

  function beginEditing() {
    setDraftWidgets(persistedWidgets);
    setIsEditing(true);
  }

  function cancelEditing() {
    if (isLayoutDirty && !window.confirm("Discard unsaved dashboard layout changes?")) return;
    setDraftWidgets(persistedWidgets);
    setAddOpen(false);
    setIsEditing(false);
  }

  async function refreshDashboard() {
    setIsRefreshing(true);
    try {
      const refreshes: Promise<unknown>[] = [
        layoutQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: ["user-notifications"] }),
      ];
      if (widgets.some((widget) => widget.type === "recent_activity")) refreshes.push(activityQuery.refetch());
      if (hasReportAccess && hasCrmWidgets) refreshes.push(crmSummaryQuery.refetch());
      if (hasReportAccess) refreshes.push(savedReportsQuery.refetch());
      await Promise.all(refreshes);
      toast.success("Dashboard refreshed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  function renderCrmGuard(children: ReactNode) {
    if (!hasReportAccess) {
      return <div className="rounded-lg border border-dashed border-neutral-800 bg-black/20 px-4 py-5 text-sm text-neutral-500">Reports access is required for this CRM summary widget.</div>;
    }
    if (crmSummaryQuery.isLoading) {
      return <div className="text-sm text-neutral-500">Loading CRM summary...</div>;
    }
    if (crmSummaryQuery.error) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/30 bg-state-danger-muted p-3 text-sm text-copy-secondary">
          <span>This CRM summary could not be loaded.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void crmSummaryQuery.refetch()}>Retry</Button>
        </div>
      );
    }
    return children;
  }

  function renderWidget(widget: DashboardWidget) {
    const summary = crmSummaryQuery.data;
    if (widget.type === "crm_snapshot") {
      return renderCrmGuard(summary ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="New Leads" value={summary.new_leads} helper={`Last ${summary.period_days} days`} />
          <Metric label="Pipeline Value" value={formatCurrency(summary.pipeline_value)} helper="Open deal stages" />
          <Metric label="Won / Lost" value={`${summary.won_deals} / ${summary.lost_deals}`} helper="Closed deal outcomes" />
          <Metric label="Follow-ups" value={summary.overdue_follow_ups} helper={`${summary.upcoming_tasks} upcoming this week`} />
        </div>
      ) : null);
    }
    if (widget.type === "lead_status") {
      return renderCrmGuard(summary ? <BucketList rows={summary.lead_status} emptyLabel="No lead status data yet." /> : null);
    }
    if (widget.type === "deal_stages") {
      return renderCrmGuard(summary ? <BucketList rows={summary.deal_stages} emptyLabel="No deal stage data yet." /> : null);
    }
    if (widget.type === "quote_status") {
      return renderCrmGuard(summary ? <BucketList rows={summary.quote_status} emptyLabel="No quote status data yet." /> : null);
    }
    if (widget.type === "owner_performance") {
      return renderCrmGuard(summary ? (
        <div className="space-y-3">
          {summary.owner_performance.length ? summary.owner_performance.slice(0, 5).map((owner) => (
            <div key={`${owner.owner_id ?? "unassigned"}-${owner.owner_name}`} className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-neutral-100">{owner.owner_name}</div>
                <div className="mt-1 text-xs text-neutral-500">{owner.lead_count} leads / {owner.deal_count} deals / {owner.quote_count} quotes</div>
              </div>
              <div className="text-sm font-semibold text-emerald-300">{owner.won_deal_count} won</div>
            </div>
          )) : <div className="rounded-lg border border-dashed border-neutral-800 bg-black/20 px-4 py-5 text-sm text-neutral-500">No owner activity yet.</div>}
        </div>
      ) : null);
    }
    if (widget.type === "pipeline_funnel") {
      return renderCrmGuard(summary ? <PipelineFunnel rows={summary.deal_stages} /> : null);
    }
    if (widget.type === "weighted_forecast") {
      return renderCrmGuard(summary ? <WeightedForecast forecast={summary.forecast_summary ?? null} /> : null);
    }
    if (widget.type === "summary_table") {
      return <SummaryTable modules={modules} summary={summary} unreadCount={unreadCount} />;
    }
    if (widget.type === "note") {
      return <NoteWidget widget={widget} onSave={updateWidgetConfig} />;
    }
    if (widget.type === "report_chart") {
      return <ReportChartWidget widget={widget} savedReports={savedReports} hasReportAccess={hasReportAccess} />;
    }
    if (widget.type === "module_entry_points") {
      if (isModulesLoading) return <div className="text-sm text-neutral-500">Loading module access...</div>;
      return modules.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {modules.map((module) => (
            <ModuleLink key={module.id} module={module} />
          ))}
        </div>
      ) : <EmptyMessage>No operational modules are currently available.</EmptyMessage>;
    }
    if (widget.type === "quick_actions") {
      return quickActions.length ? (
        <div className="space-y-3">
          {quickActions.map((action) => (
            <Link key={action.href} href={action.href} className="block rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-neutral-100">{action.label}</div>
                  <div className="mt-1 text-sm text-neutral-400">{action.helper}</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-neutral-600" />
              </div>
            </Link>
          ))}
        </div>
      ) : <EmptyMessage>No quick actions are available until operational modules are enabled.</EmptyMessage>;
    }
    if (widget.type === "recent_activity") {
      if (activityQuery.isLoading) return <div className="text-sm text-neutral-500">Loading activity...</div>;
      if (activityQuery.error) {
        return (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-state-danger/30 bg-state-danger-muted p-3 text-sm text-copy-secondary">
            <span>Recent activity could not be loaded.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void activityQuery.refetch()}>Retry</Button>
          </div>
        );
      }
      return activityQuery.data?.results.length ? (
        <div className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
          {activityQuery.data.results.map((item) => (
            <div key={item.id} className="px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-neutral-300">{getActionLabel(item.action)}</span>
                <span className="text-sm font-medium text-neutral-100">{getModuleDisplayName(item.module_key)}</span>
                <span className="text-xs text-neutral-500">{item.entity_type} #{item.entity_id}</span>
              </div>
              <div className="mt-2 text-sm text-neutral-300">{item.description || `${item.entity_type} ${item.entity_id}`}</div>
              <div className="mt-1 text-xs text-neutral-500">{formatDateTime(item.created_at)}</div>
            </div>
          ))}
        </div>
      ) : <EmptyMessage>No recent activity is available yet.</EmptyMessage>;
    }
    if (widget.type === "notifications") {
      if (isNotificationsLoading) return <div className="text-sm text-neutral-500">Loading notifications...</div>;
      return notifications.length ? (
        <div className="divide-y divide-neutral-800 rounded-lg border border-neutral-800">
          {notifications.slice(0, 6).map((notification) => (
            <Link key={notification.id} href={canonicalizeDashboardHref(notification.link_url || SETTINGS_ROUTES.activityLog)} className="block px-4 py-4 transition-colors hover:bg-neutral-900/50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-neutral-100">{notification.title}</div>
                  <div className="mt-1 text-sm leading-6 text-neutral-400">{notification.message}</div>
                  <div className="mt-2 text-xs text-neutral-500">{formatDateTime(notification.created_at)}</div>
                </div>
                {notification.read_at ? null : <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400" />}
              </div>
            </Link>
          ))}
        </div>
      ) : <EmptyMessage>No notifications yet.</EmptyMessage>;
    }
    if (widget.type === "module_summary") {
      const dashboardModule = widget.module_key ? modulesByName.get(widget.module_key) : null;
      if (!dashboardModule) return <EmptyMessage>This module is no longer available in your access scope.</EmptyMessage>;
      return <ModuleSummary module={dashboardModule} summary={summary} unreadCount={unreadCount} />;
    }
    return null;
  }

  function widgetIcon(type: WidgetType) {
    if (type === "note") return <NotebookText className="h-4 w-4" />;
    if (type === "summary_table") return <Table2 className="h-4 w-4" />;
    if (type === "pipeline_funnel") return <Filter className="h-4 w-4" />;
    if (type === "weighted_forecast") return <BarChart3 className="h-4 w-4" />;
    if (type === "report_chart") return <BarChart3 className="h-4 w-4" />;
    if (type === "notifications") return <Bell className="h-4 w-4" />;
    if (type === "recent_activity") return <ClipboardList className="h-4 w-4" />;
    if (type === "quick_actions") return <Settings2 className="h-4 w-4" />;
    if (type === "module_entry_points" || type === "module_summary") return <LayoutGrid className="h-4 w-4" />;
    return <LayoutDashboard className="h-4 w-4" />;
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Dashboard"
        description="Your configurable workspace for module summaries, quick views, and operational shortcuts."
        actions={
          isEditing ? undefined : (
            <>
              <Select value={String(periodDays)} onValueChange={(value) => setPeriodDays(Number(value))}>
                <SelectTrigger aria-label="Dashboard date range" className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" onClick={() => void refreshDashboard()} disabled={isRefreshing}>
                <RefreshCw className={cn(isRefreshing && "animate-spin")} />
                {isRefreshing ? "Refreshing…" : "Refresh"}
              </Button>
              <Button type="button" variant="outline" onClick={beginEditing}>
                <Pencil />
                Edit dashboard
              </Button>
              <Button asChild variant="outline">
                <Link href={SETTINGS_ROUTES.activityLog}>
                  <ClipboardList />
                  Activity log
                </Link>
              </Button>
              {accessibleRoutes.has(DASHBOARD_ROUTES.tasks) ? (
                <Button asChild>
                  <Link href={DASHBOARD_ROUTES.tasks}>
                    <Plus />
                    New work
                  </Link>
                </Button>
              ) : null}
              {accessibleRoutes.has(DASHBOARD_ROUTES.calendar) ? <HeaderLink href={DASHBOARD_ROUTES.calendar} icon={<CalendarDays />} label="Calendar" /> : null}
              {accessibleRoutes.has(DASHBOARD_ROUTES.mail) ? <HeaderLink href={DASHBOARD_ROUTES.mail} icon={<Mail />} label="Mail" /> : null}
              {accessibleRoutes.has(DASHBOARD_ROUTES.documents) ? <HeaderLink href={DASHBOARD_ROUTES.documents} icon={<FileText />} label="Documents" /> : null}
            </>
          )
        }
      />

      {layoutQuery.error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/30 bg-state-danger-muted px-4 py-3 text-sm text-copy-secondary">
          <span>Your saved dashboard layout could not be loaded. The default layout is shown.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void layoutQuery.refetch()}>Try again</Button>
        </div>
      ) : null}
      {saveMutation.error ? (
        <div role="alert" className="rounded-[var(--radius-card)] border border-state-danger/30 bg-state-danger-muted px-4 py-3 text-sm text-state-danger">
          The dashboard layout could not be saved. Your draft is still available.
        </div>
      ) : null}

      {isEditing ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line-strong bg-surface-raised/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mr-auto">
            <p className="text-sm font-semibold text-copy-primary">Dashboard edit mode</p>
            <p className={cn("text-xs", isLayoutDirty ? "text-state-warning" : "text-copy-muted")}>
              {isLayoutDirty ? "Unsaved layout changes" : "Move, resize, add, or remove widgets"}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)} disabled={widgets.length >= 24}>
            <Plus />Add widget
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={resetLayout}>
            <RotateCcw />Reset
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={cancelEditing} disabled={saveMutation.isPending}>
            <X />Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => saveMutation.mutate(draftWidgets)} disabled={saveMutation.isPending || !isLayoutDirty}>
            <Save />{saveMutation.isPending ? "Saving…" : "Save layout"}
          </Button>
        </div>
      ) : null}

      <div className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-4">
        {widgets.map((widget, index) => (
          <WidgetShell
            key={widget.id}
            title={widgetTitle(widget, modulesByName)}
            icon={widgetIcon(widget.type)}
            widget={widget}
            index={index}
            count={widgets.length}
            onMove={moveWidget}
            onResize={resizeWidget}
            onRemove={removeWidget}
            onDragStart={setDragIndex}
            isEditing={isEditing}
            onDrop={(dropIndex) => {
              if (dragIndex !== null && dragIndex !== dropIndex) {
                moveWidget(dragIndex, dropIndex);
              }
              setDragIndex(null);
            }}
          >
            {renderWidget(widget)}
          </WidgetShell>
        ))}
        {isEditing && !widgets.length ? (
          <div className="md:col-span-2 xl:col-span-4">
            <EmptyState
              icon={LayoutDashboard}
              title="Your dashboard draft is empty"
              description="Add a widget or reset to the default layout before saving."
              action={<Button type="button" onClick={() => setAddOpen(true)}><Plus />Add widget</Button>}
            />
          </div>
        ) : null}
      </div>

      <Dialog open={isEditing && addOpen} onClose={() => setAddOpen(false)}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-30 flex items-center justify-center p-4">
          <DialogPanel size="3xl">
            <DialogHeader>
              <DialogTitle className="text-lg text-copy-primary">Add dashboard widget</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-copy-secondary">
                Choose a module summary or quick view to add to your personal dashboard.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {catalog.map((item) => (
                <button
                  key={`${item.type}-${item.module_key ?? "base"}`}
                  type="button"
                  onClick={() => addWidget(item)}
                  className="rounded-[var(--radius-card)] border border-line-default bg-surface-muted px-4 py-4 text-left transition-colors hover:border-line-strong hover:bg-surface-raised"
                >
                  <div className="text-sm font-semibold text-copy-primary">{item.title}</div>
                  <div className="mt-1 text-sm leading-6 text-copy-secondary">{item.description}</div>
                </button>
              ))}
            </div>
            {hasReportAccess ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-black/20 px-4 py-3 text-sm text-neutral-400">
                <span>{savedReportsQuery.isLoading ? "Loading saved reports..." : savedReports.length ? "Saved reports can be added as dashboard charts." : "Create saved reports to add them here as charts."}</span>
                <Button asChild variant="outline" size="sm">
                  <Link href={DASHBOARD_ROUTES.reports}>Open Reports</Link>
                </Button>
              </div>
            ) : null}
          </DialogPanel>
        </div>
      </Dialog>
    </div>
  );
}

function NoteWidget({ widget, onSave }: { widget: DashboardWidget; onSave: (id: string, config: Record<string, unknown>) => void }) {
  const [body, setBody] = useState(typeof widget.config?.body === "string" ? widget.config.body : "");

  return (
    <textarea
      value={body}
      onChange={(event) => setBody(event.target.value)}
      onBlur={() => onSave(widget.id, { body })}
      maxLength={2000}
      className="min-h-44 w-full resize-y rounded-lg border border-neutral-800 bg-black/30 px-3 py-3 text-sm leading-6 text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-neutral-600"
      placeholder="Write a quick note..."
    />
  );
}

function SummaryTable({ modules, summary, unreadCount }: { modules: AccessibleModule[]; summary?: CrmDashboardSummary; unreadCount: number }) {
  const [query, setQuery] = useState("");
  const filtered = modules.filter((item) => {
    const label = getModuleDisplayName(item.name, item.description ?? undefined);
    return `${label} ${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase());
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-black/20 px-3 py-2">
        <Rows3 className="h-4 w-4 text-neutral-500" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-600"
          placeholder="Filter modules..."
        />
      </div>
      <div className="overflow-hidden rounded-lg border border-neutral-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-950 text-xs uppercase tracking-[0.14em] text-neutral-500">
            <tr>
              <th className="px-3 py-3 font-medium">Module</th>
              <th className="px-3 py-3 font-medium">Summary</th>
              <th className="px-3 py-3 font-medium">Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {filtered.slice(0, 8).map((item) => (
              <tr key={item.id} className="bg-black/20">
                <td className="px-3 py-3 text-neutral-100">{getModuleDisplayName(item.name, item.description ?? undefined)}</td>
                <td className="px-3 py-3 text-neutral-400">{moduleSummaryText(item, summary, unreadCount)}</td>
                <td className="px-3 py-3">
                  <Link href={getModuleRoute(item.name, item.base_route) || "/dashboard/profile"} className="inline-flex items-center gap-1 text-neutral-200 hover:text-white">
                    View
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-neutral-500">No modules match this filter.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function moduleSummaryText(module: AccessibleModule, summary: CrmDashboardSummary | undefined, unreadCount: number) {
  if (module.name === "sales_leads" && summary) return `${summary.lead_status.reduce((total, row) => total + row.count, 0)} leads / ${summary.new_leads} new`;
  if (module.name === "sales_opportunities" && summary) return `${formatCurrency(summary.pipeline_value)} pipeline`;
  if (module.name === "sales_quotes" && summary) return `${summary.quote_status.reduce((total, row) => total + row.count, 0)} quotes`;
  if (module.name === "tasks" && summary) return `${summary.overdue_follow_ups} overdue / ${summary.upcoming_tasks} upcoming`;
  if (module.name === "mail") return `${unreadCount} unread updates`;
  return module.description || "Available in your access scope";
}

function PipelineFunnel({ rows }: { rows: CrmBucket[] }) {
  const data = rows.filter((row) => !["closed_lost"].includes(row.key)).slice(0, 6);
  const max = Math.max(...data.map((row) => row.count), 1);
  if (!data.length) return <EmptyMessage>No pipeline stage data yet.</EmptyMessage>;

  return (
    <div className="space-y-2">
      {data.map((row, index) => {
        const width = Math.max(34, (row.count / max) * 100);
        return (
          <div key={row.key} className="flex items-center gap-3">
            <div className="w-28 shrink-0 truncate text-xs text-neutral-500">{row.label}</div>
            <div className="min-w-0 flex-1">
              <div
                className="rounded-md border border-emerald-400/20 bg-emerald-400/15 px-3 py-2 text-sm text-emerald-100"
                style={{ width: `${width}%`, marginLeft: `${Math.min(index * 3, 16)}%` }}
              >
                <span className="font-semibold">{row.count}</span>
                {row.value ? <span className="ml-2 text-emerald-200/70">{formatCurrency(row.value)}</span> : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WeightedForecast({ forecast }: { forecast: CrmDashboardSummary["forecast_summary"] | null }) {
  if (!forecast) return <EmptyMessage>No forecast data is available yet.</EmptyMessage>;
  const rows = forecast.by_stage.slice(0, 5);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Metric label="Weighted" value={formatCurrency(forecast.weighted_pipeline_amount)} helper={`${forecast.open_opportunity_count} open deals`} />
        <Metric label="Actual" value={formatCurrency(forecast.actual_revenue_amount)} helper={`${forecast.won_opportunity_count} won this period`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4">
          <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">Commit</div>
          <div className="mt-2 text-xl font-semibold text-neutral-100">{formatCurrency(forecast.commit_amount)}</div>
        </div>
        <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4">
          <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">Best Case</div>
          <div className="mt-2 text-xl font-semibold text-neutral-100">{formatCurrency(forecast.best_case_amount)}</div>
        </div>
      </div>
      <div className="space-y-2">
        {rows.length ? rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-neutral-100">{row.label}</div>
              <div className="mt-1 text-xs text-neutral-500">{row.count} opportunities</div>
            </div>
            <div className="text-sm font-semibold text-emerald-300">{formatCurrency(row.weighted_pipeline_amount)}</div>
          </div>
        )) : <EmptyMessage>No open or won deals close in this period.</EmptyMessage>}
      </div>
    </div>
  );
}

function ReportChartWidget({ widget, savedReports, hasReportAccess }: { widget: DashboardWidget; savedReports: SavedReport[]; hasReportAccess: boolean }) {
  const savedReportId = typeof widget.config?.saved_report_id === "number" ? widget.config.saved_report_id : Number(widget.config?.saved_report_id || 0);
  const savedReport = savedReports.find((item) => item.id === savedReportId);
  const reportQuery = useQuery({
    queryKey: ["dashboard-report-chart", savedReportId],
    queryFn: () => fetchReportForSavedReport(savedReport as SavedReport),
    enabled: hasReportAccess && Boolean(savedReport),
    staleTime: 60000,
  });

  if (!hasReportAccess) return <EmptyMessage>Reports access is required for saved report widgets.</EmptyMessage>;
  if (!savedReport) {
    return (
      <div className="space-y-3">
        <EmptyMessage>This saved report is no longer available.</EmptyMessage>
        <Button asChild variant="outline" size="sm"><Link href={DASHBOARD_ROUTES.reports}>Open Reports</Link></Button>
      </div>
    );
  }
  if (reportQuery.isLoading) return <div className="text-sm text-neutral-500">Loading report chart...</div>;
  if (reportQuery.error) {
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
        <div className="text-sm font-medium text-neutral-100">{savedReport.name}</div>
        <div className="mt-1 text-xs text-neutral-500">{getModuleDisplayName(savedReport.module_key)} / {report?.dimension.label ?? savedReport.config.dimension}</div>
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
      ) : <EmptyMessage>No report rows match this saved report.</EmptyMessage>}
    </div>
  );
}

function HeaderLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  return (
    <Button asChild variant="outline">
      <Link href={href}>
        {icon}
        {label}
      </Link>
    </Button>
  );
}

function Metric({ label, value, helper }: { label: string; value: string | number; helper: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-black/20 px-4 py-4">
      <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">{label}</div>
      <div className="mt-3 text-3xl font-semibold text-neutral-100">{value}</div>
      <div className="mt-1 text-sm text-neutral-400">{helper}</div>
    </div>
  );
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-neutral-800 bg-black/20 px-4 py-6 text-sm text-neutral-500">{children}</div>;
}

function ModuleLink({ module }: { module: AccessibleModule }) {
  const href = getModuleRoute(module.name, module.base_route) || "/dashboard/profile";
  return (
    <Link href={href} className="group rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-neutral-100">{getModuleDisplayName(module.name, module.description ?? undefined)}</div>
          <div className="mt-1 text-sm leading-6 text-neutral-400">{module.description || "Open this module and continue where your role allows."}</div>
        </div>
        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-600 transition-transform group-hover:translate-x-0.5 group-hover:text-neutral-300" />
      </div>
    </Link>
  );
}

function ModuleSummary({ module, summary, unreadCount }: { module: AccessibleModule; summary?: CrmDashboardSummary; unreadCount: number }) {
  const moduleName = getModuleDisplayName(module.name, module.description ?? undefined);
  const href = getModuleRoute(module.name, module.base_route) || "/dashboard/profile";
  let value: string | number = "Open";
  let helper = module.description || "Module quick view";

  if (module.name === "sales_leads" && summary) {
    value = summary.lead_status.reduce((total, row) => total + row.count, 0);
    helper = `${summary.new_leads} new in ${summary.period_days} days`;
  } else if (module.name === "sales_opportunities" && summary) {
    value = formatCurrency(summary.pipeline_value);
    helper = `${summary.won_deals} won / ${summary.lost_deals} lost`;
  } else if (module.name === "sales_quotes" && summary) {
    value = summary.quote_status.reduce((total, row) => total + row.count, 0);
    helper = "Active quote statuses";
  } else if (module.name === "tasks" && summary) {
    value = summary.overdue_follow_ups;
    helper = `${summary.upcoming_tasks} upcoming this week`;
  } else if (module.name === "mail" || module.name === "notifications") {
    value = unreadCount;
    helper = "Unread user updates";
  }

  return (
    <Link href={href} className="block rounded-lg border border-neutral-800 bg-black/20 px-4 py-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60">
      <div className="text-xs uppercase tracking-[0.16em] text-neutral-500">{moduleName}</div>
      <div className="mt-3 text-3xl font-semibold text-neutral-100">{value}</div>
      <div className="mt-2 text-sm leading-6 text-neutral-400">{helper}</div>
      <div className="mt-4 flex items-center gap-2 text-sm font-medium text-neutral-200">
        Open module
        <ArrowRight className="h-4 w-4" />
      </div>
    </Link>
  );
}
