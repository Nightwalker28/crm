"use client";

import { useState } from "react";
import Link from "next/link";
import { BarChart3, Gauge, Table2 } from "lucide-react";

import type { DashboardWidgetSize } from "@/components/dashboard/DashboardLayoutEditor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBackdrop, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogTitle } from "@/components/ui/dialog";
import { DialogIconClose } from "@/components/ui/DialogIconClose";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl, SegmentedItem } from "@/components/ui/SegmentedControl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { newWidgetId, WIDGET_KIND_LABELS, type DashboardWidgetKind, type ReportDashboardWidget } from "@/lib/reportDashboards";
import { CHART_LABELS, type ReportChartType, type SavedReport } from "@/lib/reports";
import { DASHBOARD_ROUTES } from "@/lib/routes";

const OWN_CHART = "__report__";
const WIDGET_CHARTS: ReportChartType[] = ["column", "bar", "line", "donut", "funnel"];
const SIZES: { value: DashboardWidgetSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "wide", label: "Full width" },
];

/**
 * Adds a widget, or changes one: which saved report, shown how (chart, table or one key
 * figure), and how wide. The report list is every report the owner can see, so a widget
 * never points at one they could not open.
 */
export function DashboardWidgetDialog({ open, widget, reports, dashboardShared, onClose, onSave }: {
  open: boolean;
  widget: ReportDashboardWidget | null;
  reports: SavedReport[];
  dashboardShared: boolean;
  onClose: () => void;
  onSave: (widget: ReportDashboardWidget) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogBackdrop />
      <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
        <DialogPanel size="md">
          {open ? <WidgetForm key={widget?.id ?? "new"} widget={widget} reports={reports} dashboardShared={dashboardShared} onClose={onClose} onSave={onSave} /> : null}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function WidgetForm({ widget, reports, dashboardShared, onClose, onSave }: {
  widget: ReportDashboardWidget | null;
  reports: SavedReport[];
  dashboardShared: boolean;
  onClose: () => void;
  onSave: (widget: ReportDashboardWidget) => void;
}) {
  const [reportId, setReportId] = useState(widget ? String(widget.report_id) : "");
  const [kind, setKind] = useState<DashboardWidgetKind>(widget?.type ?? "chart");
  const [chartType, setChartType] = useState(widget?.chart_type ?? OWN_CHART);
  const [title, setTitle] = useState(widget?.title ?? "");
  const [target, setTarget] = useState(widget?.target ? String(widget.target) : "");
  const [size, setSize] = useState<DashboardWidgetSize>(widget?.size ?? "medium");
  const [error, setError] = useState("");
  const report = reports.find((item) => String(item.id) === reportId) ?? null;
  const targetValue = target.trim() ? Number(target) : null;
  const targetInvalid = kind === "kpi" && targetValue !== null && (!Number.isFinite(targetValue) || targetValue <= 0);

  function submit() {
    if (!report) {
      setError("Choose a report.");
      return;
    }
    if (targetInvalid) return;
    onSave({
      id: widget?.id ?? newWidgetId(),
      type: kind,
      size,
      report_id: report.id,
      title: title.trim() || null,
      chart_type: kind === "chart" && chartType !== OWN_CHART ? (chartType as ReportChartType) : null,
      target: kind === "kpi" ? targetValue : null,
      report,
      unavailable_reason: null,
    });
  }

  return (
    <form noValidate onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <DialogHeader>
        <DialogTitle>{widget ? "Configure widget" : "Add widget"}</DialogTitle>
        <DialogDescription className="mt-1 text-p-sm text-copy-muted">Show a saved report as a chart, a table or one key figure.</DialogDescription>
        <DialogIconClose />
      </DialogHeader>
      <div className="mt-4 flex flex-col gap-4">
        <Field data-invalid={Boolean(error) || undefined}>
          <FieldLabel htmlFor="widget-report">Report</FieldLabel>
          {reports.length ? (
            <Select value={reportId} onValueChange={(value) => { setReportId(value); setError(""); }}>
              <SelectTrigger id="widget-report" aria-label="Report" aria-invalid={Boolean(error) || undefined}><SelectValue placeholder="Choose a saved report" /></SelectTrigger>
              <SelectContent>
                {reports.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name} · {item.module_label ?? item.module_key}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <FieldDescription>
              You have no saved reports yet. <Link className="underline underline-offset-2" href={`${DASHBOARD_ROUTES.reports}/new`}>Build one</Link>, then add it here.
            </FieldDescription>
          )}
          {error ? <FieldError>{error}</FieldError> : null}
          {dashboardShared && report?.visibility === "private" ? (
            <FieldDescription>This report is private, so only you will see this widget. Share the report to show it to everyone.</FieldDescription>
          ) : null}
        </Field>
        <Field>
          <FieldLabel>Show as</FieldLabel>
          <SegmentedControl aria-label="Show as" value={kind} onValueChange={setKind}>
            <SegmentedItem value="chart"><BarChart3 />{WIDGET_KIND_LABELS.chart}</SegmentedItem>
            <SegmentedItem value="table"><Table2 />{WIDGET_KIND_LABELS.table}</SegmentedItem>
            <SegmentedItem value="kpi"><Gauge />{WIDGET_KIND_LABELS.kpi}</SegmentedItem>
          </SegmentedControl>
        </Field>
        {kind === "chart" ? (
          <Field>
            <FieldLabel htmlFor="widget-chart">Chart</FieldLabel>
            <Select value={chartType} onValueChange={setChartType}>
              <SelectTrigger id="widget-chart" aria-label="Chart"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={OWN_CHART}>The report&rsquo;s own chart</SelectItem>
                {WIDGET_CHARTS.map((type) => <SelectItem key={type} value={type}>{CHART_LABELS[type]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        {kind === "kpi" ? (
          <Field data-invalid={targetInvalid || undefined}>
            <FieldLabel htmlFor="widget-target">Target</FieldLabel>
            <Input id="widget-target" inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} aria-invalid={targetInvalid} aria-describedby={targetInvalid ? "widget-target-error" : "widget-target-help"} placeholder="Optional" />
            {targetInvalid ? <FieldError id="widget-target-error">Enter a number greater than zero.</FieldError> : <FieldDescription id="widget-target-help">Shows progress toward it. The figure is the report&rsquo;s first measure.</FieldDescription>}
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor="widget-title">Title</FieldLabel>
          <Input id="widget-title" value={title} maxLength={150} onChange={(event) => setTitle(event.target.value)} placeholder={report?.name ?? "The report's name"} />
        </Field>
        <Field>
          <FieldLabel htmlFor="widget-size">Width</FieldLabel>
          <Select value={size} onValueChange={(value) => setSize(value as DashboardWidgetSize)}>
            <SelectTrigger id="widget-size" aria-label="Width"><SelectValue /></SelectTrigger>
            <SelectContent>{SIZES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      </div>
      <DialogFooter className="mt-4">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!reports.length}>{widget ? "Apply" : "Add widget"}</Button>
      </DialogFooter>
    </form>
  );
}
