"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Gauge, LayoutDashboard, Mail, Pencil, Plus, Save, Settings2, Table2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { DashboardWidgetShell, sizeClass } from "@/components/dashboard/DashboardLayoutEditor";
import { DashboardWidgetDialog } from "@/components/reports/DashboardWidgetDialog";
import { ReportSubscriptionDialog } from "@/components/reports/ReportSubscriptionDialog";
import { SaveReportDialog } from "@/components/reports/ReportBuilder";
import { dashboardWidgetTitle, ReportDashboardWidgetBody } from "@/components/reports/ReportDashboardWidget";
import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, FieldLabel } from "@/components/ui/field";
import { PageShell } from "@/components/ui/PageShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SortableList } from "@/components/ui/SortableList";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { usePageAddress } from "@/hooks/usePageAddress";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { isForbiddenError } from "@/lib/api";
import {
  DASHBOARD_DATE_OPTIONS,
  DASHBOARD_SCOPE_OPTIONS,
  deleteReportDashboard,
  fetchReportDashboard,
  updateReportDashboard,
  type ReportDashboardFilters,
  type ReportDashboardWidget,
} from "@/lib/reportDashboards";
import { fetchReportModules, fetchSavedReports } from "@/lib/reports";

const MAX_WIDGETS = 24;
const KIND_ICONS = { chart: BarChart3, table: Table2, kpi: Gauge } as const;

/**
 * One report dashboard (archetype 5): a filter row, then panels. The date range and "Show
 * me" apply to every widget, live in the address so a filtered view can be linked, and
 * start from the defaults its owner saved. Editing is the home dashboard's edit mode: move,
 * resize, configure, remove, and one Save.
 */
export default function ReportDashboardPage() {
  const params = useParams<{ dashboardId: string }>();
  const dashboardId = Number(params.dashboardId);
  const router = useRouter();
  const searchParams = useSearchParams();
  const { updateAddress } = usePageAddress();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const { modules: accessibleModules } = useAccessibleModules();
  const actions = accessibleModules.find((module) => module.name === "reports")?.actions;

  const dashboardQuery = useQuery({ queryKey: ["report-dashboard", dashboardId], queryFn: () => fetchReportDashboard(dashboardId), enabled: Number.isFinite(dashboardId), retry: false });
  const modulesQuery = useQuery({ queryKey: ["report-modules"], queryFn: fetchReportModules, staleTime: 5 * 60_000 });
  const dashboard = dashboardQuery.data;
  const modules = modulesQuery.data?.results ?? [];

  const [isEditing, setIsEditing] = useState(() => searchParams.get("edit") === "1");
  const [draftWidgets, setDraftWidgets] = useState<ReportDashboardWidget[] | null>(null);
  const [draftFilters, setDraftFilters] = useState<ReportDashboardFilters | null>(null);
  const [dialogWidget, setDialogWidget] = useState<ReportDashboardWidget | null | "new">(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const reportsQuery = useQuery({ queryKey: ["saved-reports", "all", "", "all", null], queryFn: () => fetchSavedReports(), enabled: isEditing });

  const canEdit = Boolean(dashboard?.can_edit && actions?.can_edit);
  const editing = isEditing && canEdit;
  const widgets = editing ? draftWidgets ?? dashboard?.widgets ?? [] : dashboard?.widgets ?? [];
  const savedFilters = dashboard?.filters ?? { date_range: "report", scope: "report" as const };
  // Viewing: the address wins over the saved defaults. Editing: the draft is the new default.
  const filters: ReportDashboardFilters = editing
    ? draftFilters ?? savedFilters
    : {
        date_range: searchParams.get("range") ?? savedFilters.date_range,
        scope: (searchParams.get("scope") as ReportDashboardFilters["scope"] | null) ?? savedFilters.scope,
      };
  const isDirty = editing && (
    (draftWidgets !== null && JSON.stringify(draftWidgets.map(stripReport)) !== JSON.stringify((dashboard?.widgets ?? []).map(stripReport)))
    || (draftFilters !== null && JSON.stringify(draftFilters) !== JSON.stringify(savedFilters))
  );

  const saveMutation = useMutation({
    mutationFn: (payload: Parameters<typeof updateReportDashboard>[1]) => updateReportDashboard(dashboardId, payload),
    onSuccess: (saved) => {
      queryClient.setQueryData(["report-dashboard", dashboardId], saved);
      void queryClient.invalidateQueries({ queryKey: ["report-dashboards"] });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteReportDashboard(dashboardId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["report-dashboards"] });
      toast.success("Dashboard deleted.");
      router.push("/dashboard/reports/dashboards");
    },
    onError: () => toast.error("The dashboard could not be deleted. Try again."),
  });
  useUnsavedChangesGuard(isDirty, saveMutation.isPending);

  const reportsForDialog = useMemo(() => reportsQuery.data?.results ?? [], [reportsQuery.data]);

  if (dashboardQuery.isLoading || modulesQuery.isLoading || dashboardQuery.isError || !dashboard) {
    const notFound = (dashboardQuery.error as { status?: number } | null)?.status === 404 || !Number.isFinite(dashboardId);
    return (
      <PageShell
        title={notFound ? "Dashboard not found" : "Dashboard"}
        isLoading={dashboardQuery.isLoading || modulesQuery.isLoading}
        isPermissionDenied={isForbiddenError(dashboardQuery.error)}
        hasError
        errorDescription={notFound ? "It may have been deleted, or it is not shared with you." : "Check your connection and try again."}
        onRetry={() => void dashboardQuery.refetch()}
        backHref="/dashboard/reports/dashboards"
        backLabel="Back to dashboards"
      >
        {null}
      </PageShell>
    );
  }

  function setFilter(patch: Partial<ReportDashboardFilters>) {
    if (editing) {
      setDraftFilters({ ...filters, ...patch });
      return;
    }
    updateAddress((address) => {
      if (patch.date_range !== undefined) {
        if (patch.date_range === savedFilters.date_range) address.delete("range");
        else address.set("range", patch.date_range);
      }
      if (patch.scope !== undefined) {
        if (patch.scope === savedFilters.scope) address.delete("scope");
        else address.set("scope", patch.scope);
      }
    });
  }

  function updateWidgets(next: ReportDashboardWidget[]) {
    setDraftWidgets(next);
  }

  function startEditing() {
    setDraftWidgets(null);
    setDraftFilters(null);
    setIsEditing(true);
  }

  function stopEditing() {
    setIsEditing(false);
    setDraftWidgets(null);
    setDraftFilters(null);
    updateAddress((address) => address.delete("edit"));
  }

  function saveLayout() {
    saveMutation.mutate({ widgets, filters }, {
      onSuccess: () => { toast.success("Dashboard saved."); stopEditing(); },
      onError: (error) => toast.error((error as Error & { status?: number }).status === 400 ? "A widget points at a report you can no longer see. Remove or replace it, then save." : "The dashboard could not be saved. Your draft is still open."),
    });
  }

  async function remove() {
    if (!dashboard) return;
    const confirmed = await confirm({
      title: `Delete ${dashboard.name}?`,
      description: dashboard.visibility === "everyone"
        ? "Everyone it is shared with loses it too. The saved reports on it are not deleted."
        : "The saved reports on it are not deleted.",
      confirmLabel: "Delete dashboard",
      variant: "destructive",
    });
    if (confirmed) deleteMutation.mutate();
  }

  const ownerLine = dashboard.can_edit
    ? dashboard.visibility === "everyone" ? "Yours · shared with everyone" : "Yours · only you"
    : `Shared by ${dashboard.owner_name ?? "a colleague"}`;

  return (
    <PageShell
      title={dashboard.name}
      description={dashboard.description ?? undefined}
      context={ownerLine}
      actions={editing ? undefined : (
        <>
          <Button asChild variant="ghost"><Link href="/dashboard/reports/dashboards"><LayoutDashboard />All dashboards</Link></Button>
          <Button type="button" variant="outline" onClick={() => setSubscriptionOpen(true)}><Mail />Schedule email</Button>
          {canEdit ? (
            <>
              <Button type="button" variant="outline" onClick={() => setDetailsOpen(true)}><Settings2 />Details</Button>
              <Button type="button" onClick={startEditing}><Pencil />Edit</Button>
            </>
          ) : null}
          {dashboard.can_edit && actions?.can_delete ? (
            <Button type="button" variant="ghost" onClick={() => void remove()} disabled={deleteMutation.isPending} aria-label={`Delete ${dashboard.name}`}><Trash2 />Delete</Button>
          ) : null}
        </>
      )}
    >
      <ReportSubscriptionDialog open={subscriptionOpen} onClose={() => setSubscriptionOpen(false)} targetType="dashboard" targetId={dashboardId} />
      {editing ? (
        <ActionBar align="between" className="border-b border-line-subtle pb-4">
          <div className="mr-auto min-w-0">
            <p className="text-sm font-semibold text-copy-primary">Editing the dashboard</p>
            <p className="text-xs text-copy-muted">{isDirty ? "Unsaved changes" : "Add, move, resize or configure widgets. The filters below become the defaults."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => setDialogWidget("new")} disabled={widgets.length >= MAX_WIDGETS}><Plus />Add widget</Button>
            <Button type="button" variant="ghost" onClick={stopEditing} disabled={saveMutation.isPending}><X />Cancel</Button>
            <Button type="button" onClick={saveLayout} disabled={saveMutation.isPending || !isDirty}><Save />{saveMutation.isPending ? "Saving…" : "Save dashboard"}</Button>
          </div>
        </ActionBar>
      ) : null}

      {/* Filters in one row above the panels, applying to every one of them. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
        <Field>
          <FieldLabel htmlFor="dashboard-date-range">Dates</FieldLabel>
          <Select value={filters.date_range} onValueChange={(value) => setFilter({ date_range: value })}>
            <SelectTrigger id="dashboard-date-range" aria-label="Dates"><SelectValue /></SelectTrigger>
            <SelectContent>{DASHBOARD_DATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="dashboard-scope">Show me</FieldLabel>
          <Select value={filters.scope} onValueChange={(value) => setFilter({ scope: value as ReportDashboardFilters["scope"] })}>
            <SelectTrigger id="dashboard-scope" aria-label="Show me"><SelectValue /></SelectTrigger>
            <SelectContent>{DASHBOARD_SCOPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>

      {widgets.length ? (
        <SortableList
          label="Dashboard widgets"
          items={widgets}
          getKey={(widget) => widget.id}
          getItemLabel={(widget) => dashboardWidgetTitle(widget)}
          onMove={(from, to) => {
            const next = [...widgets];
            const [item] = next.splice(from, 1);
            next.splice(to, 0, item);
            updateWidgets(next);
          }}
          disabled={!editing}
          className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-4"
          itemClassName={(widget) => sizeClass(widget.size)}
          renderItem={(widget, { handle, moveButtons }) => (
            <DashboardWidgetShell
              title={dashboardWidgetTitle(widget)}
              widget={widget}
              icon={KIND_ICONS[widget.type]}
              handle={handle}
              moveButtons={moveButtons}
              extraActions={(
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Configure ${dashboardWidgetTitle(widget)}`} onClick={() => setDialogWidget(widget)}>
                  <Settings2 />
                </Button>
              )}
              onResize={(id, size) => updateWidgets(widgets.map((item) => (item.id === id ? { ...item, size } : item)))}
              onRemove={(id) => updateWidgets(widgets.filter((item) => item.id !== id))}
              isEditing={editing}
            >
              <ReportDashboardWidgetBody widget={widget} modules={modules} filters={filters} />
            </DashboardWidgetShell>
          )}
        />
      ) : (
        <EmptyState
          icon={LayoutDashboard}
          title="This dashboard has no widgets yet"
          description={canEdit ? "Add a saved report as a chart, a table or a key figure." : "Its owner has not added any reports to it yet."}
          action={canEdit ? <Button type="button" onClick={() => { if (!editing) startEditing(); setDialogWidget("new"); }}><Plus />Add widget</Button> : undefined}
        />
      )}

      <DashboardWidgetDialog
        open={dialogWidget !== null}
        widget={dialogWidget === "new" ? null : dialogWidget}
        reports={reportsForDialog}
        dashboardShared={dashboard.visibility === "everyone"}
        onClose={() => setDialogWidget(null)}
        onSave={(widget) => {
          const exists = widgets.some((item) => item.id === widget.id);
          updateWidgets(exists ? widgets.map((item) => (item.id === widget.id ? widget : item)) : [...widgets, widget]);
          setDialogWidget(null);
        }}
      />
      <SaveReportDialog
        open={detailsOpen}
        noun="dashboard"
        title="Dashboard details"
        initialName={dashboard.name}
        initialDescription={dashboard.description ?? ""}
        initialVisibility={dashboard.visibility}
        submitLabel="Save details"
        isPending={saveMutation.isPending}
        onClose={() => setDetailsOpen(false)}
        onSave={(details, onError) => saveMutation.mutate(details, {
          onSuccess: (saved) => { setDetailsOpen(false); toast.success(saved.visibility === "everyone" ? "Dashboard saved and shared with everyone." : "Dashboard saved."); },
          onError,
        })}
      />
    </PageShell>
  );
}

/** A widget as the server stores it, for the dirty check. */
function stripReport(widget: ReportDashboardWidget) {
  return { id: widget.id, type: widget.type, size: widget.size, report_id: widget.report_id, title: widget.title, chart_type: widget.chart_type, target: widget.target };
}
