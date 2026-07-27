"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ClipboardList,
  FileText,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useNotifications } from "@/hooks/useNotifications";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";
import { getModuleRoute } from "@/lib/module-registry";
import { DASHBOARD_ROUTES, SETTINGS_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  DashboardCrmWidget,
  isCrmSummaryWidget,
  type CrmDashboardSummary,
} from "@/components/dashboard/DashboardCrmWidgets";
import {
  DashboardEmptyMessage as EmptyMessage,
  DashboardModuleEntryPoints,
  DashboardNotifications,
  DashboardQuickActions,
  DashboardRecentActivity,
  type DashboardActivityItem,
} from "@/components/dashboard/DashboardOperationalWidgets";
import {
  DashboardModuleSummary,
  DashboardNoteWidget,
  DashboardSummaryTable,
} from "@/components/dashboard/DashboardPersonalWidgets";
import {
  DashboardReportChartWidget,
  fetchDashboardSavedReports,
} from "@/components/dashboard/DashboardReportChartWidget";
import {
  DashboardLayoutEditor,
  DEFAULT_DASHBOARD_WIDGETS,
  type DashboardWidget,
  type DashboardWidgetCatalogItem,
  type DashboardWidgetSize,
} from "@/components/dashboard/DashboardLayoutEditor";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type ActivityResponse = {
  results: DashboardActivityItem[];
  total_count: number;
};

type DashboardLayoutResponse = {
  widgets: DashboardWidget[];
  has_layout: boolean;
};

async function fetchDashboardActivity(): Promise<ActivityResponse> {
  const res = await apiFetch("/activity?page=1&page_size=6");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("dashboard-activity-unavailable");
  return body as ActivityResponse;
}

async function fetchCrmDashboardSummary(periodDays: number): Promise<CrmDashboardSummary> {
  const res = await apiFetch(`/reports/crm-summary?period_days=${periodDays}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("dashboard-summary-unavailable");
  return body as CrmDashboardSummary;
}

async function fetchDashboardLayout(): Promise<DashboardLayoutResponse> {
  const res = await apiFetch("/users/dashboard-layout");
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("dashboard-layout-unavailable");
  return body as DashboardLayoutResponse;
}

async function saveDashboardLayout(widgets: DashboardWidget[]): Promise<DashboardLayoutResponse> {
  const res = await apiFetch("/users/dashboard-layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ widgets }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error("dashboard-layout-save-failed");
  return body as DashboardLayoutResponse;
}

function nextWidgetId(type: DashboardWidget["type"], moduleKey?: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return [type, moduleKey, suffix].filter(Boolean).join("-");
}

function isCrmWidget(type: DashboardWidget["type"]) {
  return isCrmSummaryWidget(type) || type === "summary_table";
}

export default function DashboardHomePage() {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftWidgets, setDraftWidgets] = useState<DashboardWidget[]>(DEFAULT_DASHBOARD_WIDGETS);
  const [periodDays, setPeriodDays] = useState(30);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { modules, isLoading: isModulesLoading } = useAccessibleModules();
  const {
    notifications,
    unreadCount,
    isLoading: isNotificationsLoading,
    isError: isNotificationsError,
    refetch: refetchNotifications,
    markRead: markNotificationRead,
  } = useNotifications();

  const layoutQuery = useQuery({
    queryKey: ["dashboard-layout"],
    queryFn: fetchDashboardLayout,
    staleTime: 30000,
  });

  const persistedWidgets = layoutQuery.data?.has_layout ? layoutQuery.data.widgets : DEFAULT_DASHBOARD_WIDGETS;
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
    queryFn: fetchDashboardSavedReports,
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

  const catalog = useMemo<DashboardWidgetCatalogItem[]>(() => {
    const items: DashboardWidgetCatalogItem[] = [
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

  function resizeWidget(id: string, size: DashboardWidgetSize) {
    updateDraft(widgets.map((widget) => (widget.id === id ? { ...widget, size } : widget)));
  }

  function removeWidget(id: string) {
    updateDraft(widgets.filter((widget) => widget.id !== id));
  }

  function addWidget(item: DashboardWidgetCatalogItem) {
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
    setDraftWidgets(DEFAULT_DASHBOARD_WIDGETS);
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

  function renderWidget(widget: DashboardWidget) {
    const summary = crmSummaryQuery.data;
    if (isCrmSummaryWidget(widget.type)) {
      return (
        <DashboardCrmWidget
          type={widget.type}
          summary={summary}
          hasReportAccess={hasReportAccess}
          isLoading={crmSummaryQuery.isLoading}
          isError={crmSummaryQuery.isError}
          onRetry={() => void crmSummaryQuery.refetch()}
        />
      );
    }
    if (widget.type === "summary_table") {
      return <DashboardSummaryTable modules={modules} summary={summary} unreadCount={unreadCount} />;
    }
    if (widget.type === "note") {
      return (
        <DashboardNoteWidget
          widgetId={widget.id}
          initialBody={typeof widget.config?.body === "string" ? widget.config.body : ""}
          onSave={updateWidgetConfig}
        />
      );
    }
    if (widget.type === "report_chart") {
      return <DashboardReportChartWidget config={widget.config} savedReports={savedReports} hasReportAccess={hasReportAccess} />;
    }
    if (widget.type === "module_entry_points") {
      return <DashboardModuleEntryPoints modules={modules} isLoading={isModulesLoading} />;
    }
    if (widget.type === "quick_actions") {
      return <DashboardQuickActions actions={quickActions} />;
    }
    if (widget.type === "recent_activity") {
      return (
        <DashboardRecentActivity
          items={activityQuery.data?.results ?? []}
          isLoading={activityQuery.isLoading}
          isError={activityQuery.isError}
          onRetry={() => void activityQuery.refetch()}
        />
      );
    }
    if (widget.type === "notifications") {
      return (
        <DashboardNotifications
          notifications={notifications}
          isLoading={isNotificationsLoading}
          isError={isNotificationsError}
          onRetry={() => void refetchNotifications()}
          onRead={(notificationId) => void markNotificationRead(notificationId).catch(() => undefined)}
        />
      );
    }
    if (widget.type === "module_summary") {
      const dashboardModule = widget.module_key ? modulesByName.get(widget.module_key) : null;
      if (!dashboardModule) return <EmptyMessage>This module is no longer available in your access scope.</EmptyMessage>;
      return <DashboardModuleSummary module={dashboardModule} summary={summary} unreadCount={unreadCount} />;
    }
    return null;
  }

  return (
    <div className="flex flex-col gap-6 text-copy-secondary">
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

      <DashboardLayoutEditor
        widgets={widgets}
        draftWidgets={draftWidgets}
        catalog={catalog}
        modulesByName={modulesByName}
        isEditing={isEditing}
        isLayoutDirty={isLayoutDirty}
        isSaving={saveMutation.isPending}
        addOpen={addOpen}
        hasReportAccess={hasReportAccess}
        savedReportsLoading={savedReportsQuery.isLoading}
        savedReportsCount={savedReports.length}
        onAddOpenChange={setAddOpen}
        onMove={moveWidget}
        onResize={resizeWidget}
        onRemove={removeWidget}
        onAdd={addWidget}
        onReset={resetLayout}
        onCancel={cancelEditing}
        onSave={(nextWidgets) => saveMutation.mutate(nextWidgets)}
        renderWidget={renderWidget}
      />
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
