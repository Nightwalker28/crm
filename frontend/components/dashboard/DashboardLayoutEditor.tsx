"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bell,
  ClipboardList,
  Filter,
  GripVertical,
  LayoutDashboard,
  LayoutGrid,
  NotebookText,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Table2,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import type { AccessibleModule } from "@/hooks/useAccessibleModules";
import { getModuleDisplayName } from "@/lib/module-display";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";

export type DashboardWidgetSize = "small" | "medium" | "large" | "wide";

export type DashboardWidgetType =
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

export type DashboardWidget = {
  id: string;
  type: DashboardWidgetType;
  size: DashboardWidgetSize;
  module_key?: string;
  config?: Record<string, unknown>;
};

export type DashboardWidgetCatalogItem = {
  type: DashboardWidgetType;
  title: string;
  description: string;
  defaultSize: DashboardWidgetSize;
  module_key?: string;
  config?: Record<string, unknown>;
};

export const DEFAULT_DASHBOARD_WIDGETS: DashboardWidget[] = [
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

const SIZE_LABELS: Record<DashboardWidgetSize, string> = {
  small: "S",
  medium: "M",
  large: "L",
  wide: "W",
};

function sizeClass(size: DashboardWidgetSize) {
  if (size === "small") return "md:col-span-1 xl:col-span-1";
  if (size === "large") return "md:col-span-2 xl:col-span-3";
  if (size === "wide") return "md:col-span-2 xl:col-span-4";
  return "md:col-span-1 xl:col-span-2";
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

function widgetIcon(type: DashboardWidgetType) {
  if (type === "note") return <NotebookText />;
  if (type === "summary_table") return <Table2 />;
  if (type === "pipeline_funnel") return <Filter />;
  if (type === "weighted_forecast" || type === "report_chart") return <BarChart3 />;
  if (type === "notifications") return <Bell />;
  if (type === "recent_activity") return <ClipboardList />;
  if (type === "quick_actions") return <Settings2 />;
  if (type === "module_entry_points" || type === "module_summary") return <LayoutGrid />;
  return <LayoutDashboard />;
}

function DashboardWidgetShell({
  title,
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
  widget: DashboardWidget;
  index: number;
  count: number;
  children: ReactNode;
  onMove: (from: number, to: number) => void;
  onResize: (id: string, size: DashboardWidgetSize) => void;
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
        isEditing && "border-line-strong bg-surface-raised",
        sizeClass(widget.size),
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-subtle px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          {isEditing ? <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-copy-muted" aria-label="Drag widget" /> : null}
          <div className="text-copy-muted [&_svg]:h-4 [&_svg]:w-4">{widgetIcon(widget.type)}</div>
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
            <div
              role="group"
              className="mx-1 flex rounded-[var(--radius-control-sm)] border border-line-default bg-surface-muted p-0.5"
              aria-label={`Resize ${title}`}
            >
              {(Object.keys(SIZE_LABELS) as DashboardWidgetSize[]).map((size) => (
                <Button
                  key={size}
                  type="button"
                  variant={widget.size === size ? "primary" : "ghost"}
                  size="icon-sm"
                  aria-label={`Resize ${title} to ${size}`}
                  aria-pressed={widget.size === size}
                  onClick={() => onResize(widget.id, size)}
                  className="h-7 min-w-7 rounded-[var(--radius-control-sm)] px-2 text-xs"
                >
                  {SIZE_LABELS[size]}
                </Button>
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

export function DashboardLayoutEditor({
  widgets,
  draftWidgets,
  catalog,
  modulesByName,
  isEditing,
  isLayoutDirty,
  isSaving,
  addOpen,
  hasReportAccess,
  savedReportsLoading,
  savedReportsCount,
  onAddOpenChange,
  onMove,
  onResize,
  onRemove,
  onAdd,
  onReset,
  onCancel,
  onSave,
  renderWidget,
}: {
  widgets: DashboardWidget[];
  draftWidgets: DashboardWidget[];
  catalog: DashboardWidgetCatalogItem[];
  modulesByName: Map<string, AccessibleModule>;
  isEditing: boolean;
  isLayoutDirty: boolean;
  isSaving: boolean;
  addOpen: boolean;
  hasReportAccess: boolean;
  savedReportsLoading: boolean;
  savedReportsCount: number;
  onAddOpenChange: (open: boolean) => void;
  onMove: (from: number, to: number) => void;
  onResize: (id: string, size: DashboardWidgetSize) => void;
  onRemove: (id: string) => void;
  onAdd: (item: DashboardWidgetCatalogItem) => void;
  onReset: () => void;
  onCancel: () => void;
  onSave: (widgets: DashboardWidget[]) => void;
  renderWidget: (widget: DashboardWidget) => ReactNode;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  return (
    <>
      {isEditing ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line-strong bg-surface-raised/95 px-4 py-3 backdrop-blur">
          <div className="mr-auto">
            <p className="text-sm font-semibold text-copy-primary">Dashboard edit mode</p>
            <p className={cn("text-xs", isLayoutDirty ? "text-state-warning" : "text-copy-muted")}>
              {isLayoutDirty ? "Unsaved layout changes" : "Move, resize, add, or remove widgets"}
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => onAddOpenChange(true)} disabled={widgets.length >= 24}>
            <Plus />Add widget
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            <RotateCcw />Reset
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isSaving}>
            <X />Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => onSave(draftWidgets)} disabled={isSaving || !isLayoutDirty}>
            <Save />{isSaving ? "Saving…" : "Save layout"}
          </Button>
        </div>
      ) : null}

      <div className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-4">
        {widgets.map((widget, index) => (
          <DashboardWidgetShell
            key={widget.id}
            title={widgetTitle(widget, modulesByName)}
            widget={widget}
            index={index}
            count={widgets.length}
            onMove={onMove}
            onResize={onResize}
            onRemove={onRemove}
            onDragStart={setDragIndex}
            isEditing={isEditing}
            onDrop={(dropIndex) => {
              if (dragIndex !== null && dragIndex !== dropIndex) onMove(dragIndex, dropIndex);
              setDragIndex(null);
            }}
          >
            {renderWidget(widget)}
          </DashboardWidgetShell>
        ))}
        {isEditing && !widgets.length ? (
          <div className="md:col-span-2 xl:col-span-4">
            <EmptyState
              icon={LayoutDashboard}
              title="Your dashboard draft is empty"
              description="Add a widget or reset to the default layout before saving."
              action={<Button type="button" onClick={() => onAddOpenChange(true)}><Plus />Add widget</Button>}
            />
          </div>
        ) : null}
      </div>

      <Dialog open={isEditing && addOpen} onClose={() => onAddOpenChange(false)}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
          <DialogPanel size="3xl">
            <DialogHeader>
              <DialogTitle className="text-lg text-copy-primary">Add dashboard widget</DialogTitle>
              <DialogDescription className="mt-1 text-sm text-copy-secondary">
                Choose a module summary or quick view to add to your personal dashboard.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {catalog.map((item) => (
                <Button
                  key={`${item.type}-${item.module_key ?? "base"}`}
                  type="button"
                  variant="secondary"
                  onClick={() => onAdd(item)}
                  className="h-auto w-full items-start justify-start whitespace-normal px-4 py-4 text-left"
                >
                  <span>
                    <span className="block text-sm font-semibold text-copy-primary">{item.title}</span>
                    <span className="mt-1 block text-p-sm font-normal text-copy-secondary">{item.description}</span>
                  </span>
                </Button>
              ))}
            </div>
            {hasReportAccess ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-4 py-3 text-sm text-copy-secondary">
                <span>{savedReportsLoading ? "Loading saved reports..." : savedReportsCount ? "Saved reports can be added as dashboard charts." : "Create saved reports to add them here as charts."}</span>
                <Button asChild variant="outline" size="sm">
                  <Link href={DASHBOARD_ROUTES.reports}>Open Reports</Link>
                </Button>
              </div>
            ) : null}
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
