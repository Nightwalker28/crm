"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  BarChart3,
  Bell,
  ClipboardList,
  Filter,
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
  type LucideIcon,
} from "lucide-react";

import { ActionBar } from "@/components/ui/ActionBar";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { SortableList } from "@/components/ui/SortableList";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { isFlushCrmWidget } from "@/components/dashboard/DashboardCrmWidgets";
import { Card } from "@/components/ui/Card";
import { PanelHeader } from "@/components/ui/PanelStates";
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

export const SIZE_LABELS: Record<DashboardWidgetSize, string> = {
  small: "S",
  medium: "M",
  large: "L",
  wide: "W",
};

/** The grid span per size. Home and the shared report dashboards use the same grid. */
export function sizeClass(size: DashboardWidgetSize) {
  if (size === "small") return "md:col-span-1 xl:col-span-1";
  if (size === "large") return "md:col-span-2 xl:col-span-3";
  if (size === "wide") return "md:col-span-2 xl:col-span-4";
  return "md:col-span-1 xl:col-span-2";
}

function widgetTitle(widget: DashboardWidget, modulesByName: Map<string, AccessibleModule>) {
  if (widget.type === "crm_snapshot") return "CRM snapshot";
  if (widget.type === "module_entry_points") return "Module entry points";
  if (widget.type === "quick_actions") return "Quick actions";
  if (widget.type === "recent_activity") return "Recent activity";
  if (widget.type === "notifications") return "Notifications";
  if (widget.type === "lead_status") return "Leads by status";
  if (widget.type === "deal_stages") return "Deals by stage";
  if (widget.type === "quote_status") return "Quotes by status";
  if (widget.type === "owner_performance") return "Owner performance";
  if (widget.type === "note") return "Quick note";
  if (widget.type === "summary_table") return "Summary table";
  if (widget.type === "pipeline_funnel") return "Pipeline funnel";
  if (widget.type === "weighted_forecast") return "Weighted forecast";
  if (widget.type === "report_chart") return "Saved report chart";
  const dashboardModule = widget.module_key ? modulesByName.get(widget.module_key) : null;
  return dashboardModule ? getModuleDisplayName(dashboardModule.name, dashboardModule.description ?? undefined) : "Module summary";
}

function widgetIcon(type: DashboardWidgetType): LucideIcon {
  if (type === "note") return NotebookText;
  if (type === "summary_table") return Table2;
  if (type === "pipeline_funnel") return Filter;
  if (type === "weighted_forecast" || type === "report_chart") return BarChart3;
  if (type === "notifications") return Bell;
  if (type === "recent_activity") return ClipboardList;
  if (type === "quick_actions") return Settings2;
  if (type === "module_entry_points" || type === "module_summary") return LayoutGrid;
  return LayoutDashboard;
}

/**
 * One dashboard panel: its heading, the edit-mode controls, and the body. Shared by the home
 * dashboard and the report dashboards, which differ in what a widget holds, not in how a
 * widget is moved, resized or removed.
 */
export function DashboardWidgetShell({
  title,
  widget,
  icon,
  flush = false,
  extraActions,
  children,
  handle,
  moveButtons,
  onResize,
  onRemove,
  isEditing,
}: {
  title: string;
  widget: { id: string; size: DashboardWidgetSize };
  icon?: LucideIcon;
  /** A body that fills the panel edge to edge (a stat group) draws its own padding. */
  flush?: boolean;
  /** Edit-mode controls beyond move, resize and remove, such as "Configure". */
  extraActions?: ReactNode;
  children: ReactNode;
  handle: ReactNode;
  moveButtons: ReactNode;
  onResize: (id: string, size: DashboardWidgetSize) => void;
  onRemove: (id: string) => void;
  isEditing: boolean;
}) {
  return (
    <Card
      asChild
      data-testid={`dashboard-widget-${widget.id}`}
      className={cn("h-full", isEditing && "border-line-strong")}
    >
      <section>
      {/* R7: the widget's name is a section heading, one ink step quieter than the figures
          under it. It was an `h2` in `text-copy-primary` — the same weight as the data. */}
      <div className="border-b border-line-subtle px-4 py-3">
        <PanelHeader
          title={title}
          icon={isEditing ? undefined : icon}
          action={isEditing ? (
            <div className="flex flex-wrap items-center gap-1">
              {handle}
              {moveButtons}
              {extraActions}
              <SegmentedControl
                aria-label={`Resize ${title}`}
                value={widget.size}
                onValueChange={(size) => onResize(widget.id, size as DashboardWidgetSize)}
                className="mx-1"
              >
                {(Object.keys(SIZE_LABELS) as DashboardWidgetSize[]).map((size) => (
                  <SegmentedItem key={size} value={size} aria-label={`Resize ${title} to ${size}`}>
                    {SIZE_LABELS[size]}
                  </SegmentedItem>
                ))}
              </SegmentedControl>
              <Button type="button" variant="destructiveGhost" size="icon-sm" aria-label={`Remove ${title}`} onClick={() => onRemove(widget.id)}>
                <Trash2 />
              </Button>
            </div>
          ) : undefined}
        />
      </div>
      {/* A stat group fills the panel edge to edge and carries its own cell padding (§4.7). */}
      <div className={cn(!flush && "p-4", isEditing && "pointer-events-none select-none opacity-80")}>{children}</div>
      </section>
    </Card>
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
  return (
    <>
      {/* R3: this was `sticky top-2` — a translucent `backdrop-blur` card floating over the
          grid, and the one sticky bar R3's count of `bottom-0` never saw. It is a row in flow,
          and the unsaved line is ink: colour carrying *unsaved* is §1.2's defect. */}
      {isEditing ? (
        <ActionBar align="between" className="border-b border-line-subtle pb-4">
          <div className="mr-auto min-w-0">
            <p className="text-sm font-semibold text-copy-primary">Dashboard edit mode</p>
            <p className="text-xs text-copy-muted">
              {isLayoutDirty ? "Unsaved layout changes" : "Move, resize, add, or remove widgets"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onAddOpenChange(true)} disabled={widgets.length >= 24}>
              <Plus />Add widget
            </Button>
            <Button type="button" variant="outline" onClick={onReset}>
              <RotateCcw />Reset
            </Button>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
              <X />Cancel
            </Button>
            <Button type="button" onClick={() => onSave(draftWidgets)} disabled={isSaving || !isLayoutDirty}>
              <Save />{isSaving ? "Saving…" : "Save layout"}
            </Button>
          </div>
        </ActionBar>
      ) : null}

      {/* 5.7 batch 3: the grid's drag-and-drop was hand-written here, with its own move
          buttons beside it. `SortableList` owns both, and puts focus back on the button after
          a move — the moved card used to take the focus with it. */}
      <SortableList
        label="Dashboard widgets"
        items={widgets}
        getKey={(widget) => widget.id}
        getItemLabel={(widget) => widgetTitle(widget, modulesByName)}
        onMove={onMove}
        disabled={!isEditing}
        className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-4"
        itemClassName={(widget) => sizeClass(widget.size)}
        renderItem={(widget, { handle, moveButtons }) => (
          <DashboardWidgetShell
            title={widgetTitle(widget, modulesByName)}
            widget={widget}
            icon={widgetIcon(widget.type)}
            flush={isFlushCrmWidget(widget.type)}
            handle={handle}
            moveButtons={moveButtons}
            onResize={onResize}
            onRemove={onRemove}
            isEditing={isEditing}
          >
            {renderWidget(widget)}
          </DashboardWidgetShell>
        )}
      />
      {isEditing && !widgets.length ? (
        <EmptyState
          icon={LayoutDashboard}
          title="Your dashboard draft is empty"
          description="Add a widget or reset to the default layout before saving."
          action={<Button type="button" onClick={() => onAddOpenChange(true)}><Plus />Add widget</Button>}
        />
      ) : null}

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
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {catalog.map((item) => (
                <Button
                  key={`${item.type}-${item.module_key ?? "base"}`}
                  type="button"
                  variant="outline"
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
                <span>{savedReportsLoading ? "Loading saved reports…" : savedReportsCount ? "Saved reports can be added as dashboard charts." : "Create saved reports to add them here as charts."}</span>
                <Button asChild variant="outline" size="sm">
                  <Link href={DASHBOARD_ROUTES.reports}>Open reports</Link>
                </Button>
              </div>
            ) : null}
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
