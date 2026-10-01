"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, FileDown, Mail, Pencil, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { SaveReportDialog } from "@/components/reports/ReportBuilder";
import { ReportView } from "@/components/reports/ReportView";
import { ReportSubscriptionDialog } from "@/components/reports/ReportSubscriptionDialog";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/PageShell";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useJobPoller } from "@/hooks/useJobPoller";
import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch, isForbiddenError } from "@/lib/api";
import { downloadBlob } from "@/lib/browser";
import {
  deleteSavedReport,
  describeReportScope,
  exportReportCsv,
  exportReportXlsx,
  fetchReportModules,
  fetchSavedReport,
  updateSavedReport,
  upgradeReportConfig,
} from "@/lib/reports";
import { DASHBOARD_ROUTES } from "@/lib/routes";

/**
 * A saved report (11-reports.md §4.6, archetype 5): what it covers, its totals, chart and
 * table, and every group one click from its records. The report runs as whoever opens it,
 * so a shared report never shows someone a record they could not already open.
 */
export default function ReportViewerPage() {
  const params = useParams<{ reportId: string }>();
  const reportId = Number(params.reportId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const [exportJobId, setExportJobId] = useState<number | null>(null);
  const downloadedJob = useRef<number | null>(null);
  const exportJob = useJobPoller(exportJobId, (job) => {
    if (downloadedJob.current === job.id) return;
    downloadedJob.current = job.id;
    void apiFetch(`/jobs/data-transfer/${job.id}/download`).then(async (response) => {
      if (!response.ok) throw new Error("download-failed");
      downloadBlob(await response.blob(), `${reportQuery.data?.name ?? "report"}.xlsx`);
      toast.success("Full Excel export downloaded.");
    }).catch(() => toast.error("The export is ready, but could not be downloaded. Try again from your export jobs."));
  }, { failureMessage: "The full export could not be prepared." });
  const { modules: accessibleModules } = useAccessibleModules();
  const actions = accessibleModules.find((item) => item.name === "reports")?.actions;

  const reportQuery = useQuery({ queryKey: ["saved-report", reportId], queryFn: () => fetchSavedReport(reportId), enabled: Number.isFinite(reportId), retry: false });
  const modulesQuery = useQuery({ queryKey: ["report-modules"], queryFn: fetchReportModules, staleTime: 5 * 60_000 });
  const report = reportQuery.data;
  const reportModule = modulesQuery.data?.results.find((item) => item.module_key === report?.module_key) ?? null;
  const config = upgradeReportConfig(report?.config);

  const detailsMutation = useMutation({
    mutationFn: (details: { name: string; description: string | null; visibility: "private" | "everyone" }) => updateSavedReport(reportId, details),
    onSuccess: async (saved) => {
      queryClient.setQueryData(["saved-report", reportId], saved);
      await queryClient.invalidateQueries({ queryKey: ["saved-reports"] });
      setDetailsOpen(false);
      toast.success(saved.visibility === "everyone" ? "Report saved and shared with everyone." : "Report saved.");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteSavedReport(reportId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["saved-reports"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard-saved-reports"] });
      toast.success("Report deleted.");
      router.push(DASHBOARD_ROUTES.reports);
    },
    onError: () => toast.error("The report could not be deleted. Try again."),
  });

  const notFound = (reportQuery.error as { status?: number } | null)?.status === 404 || !Number.isFinite(reportId);
  if (reportQuery.isLoading || modulesQuery.isLoading || reportQuery.isError || modulesQuery.isError || !report || !reportModule) {
    return (
      <PageShell
        title={notFound ? "Report not found" : "Report"}
        isLoading={reportQuery.isLoading || modulesQuery.isLoading}
        isPermissionDenied={isForbiddenError(reportQuery.error ?? modulesQuery.error)}
        hasError
        errorDescription={notFound ? "It may have been deleted, or it is not shared with you." : "Check your connection and try again."}
        onRetry={() => { void reportQuery.refetch(); void modulesQuery.refetch(); }}
        backHref={DASHBOARD_ROUTES.reports}
        backLabel="Back to reports"
      >
        {null}
      </PageShell>
    );
  }

  async function exportCsv() {
    if (!report) return;
    setExporting(true);
    try {
      downloadBlob(await exportReportCsv(report.module_key, config), `${report.name}.csv`);
      toast.success("CSV downloaded.");
    } catch {
      toast.error("The CSV could not be prepared. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function exportXlsx() {
    if (!report) return;
    setExporting(true);
    try {
      downloadBlob(await exportReportXlsx(report.module_key, config), `${report.name}.xlsx`);
      toast.success("Excel file downloaded.");
    } catch {
      toast.error("The Excel file could not be prepared. Try again.");
    } finally {
      setExporting(false);
    }
  }

  async function exportFullXlsx() {
    if (!report) return;
    setExporting(true);
    try {
      const response = await apiFetch("/reports/run/export-job", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module_key: report.module_key, config, format: "xlsx" }) });
      if (!response.ok) throw new Error("queue-failed");
      const body = await response.json() as { job_id: number; status: string };
      setExportJobId(body.job_id);
      exportJob.start(body.status, "Preparing full report…");
      toast.success("Full export queued. The download starts when it is ready.");
    } catch { toast.error("The full export could not be queued. Try again."); }
    finally { setExporting(false); }
  }

  function exportChart() {
    const svg = chartRef.current?.querySelector("svg");
    if (!svg || !report) return;
    downloadBlob(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml;charset=utf-8" }), `${report.name}.svg`);
  }

  async function remove() {
    if (!report) return;
    const confirmed = await confirm({
      title: `Delete ${report.name}?`,
      description: report.visibility === "everyone"
        ? "Everyone it is shared with loses it too, and dashboard charts built on it stop drawing. The records it reports on are not touched."
        : "Dashboard charts built on it stop drawing. The records it reports on are not touched.",
      confirmLabel: "Delete report",
      variant: "destructive",
    });
    if (confirmed) deleteMutation.mutate();
  }

  const ownerLine = report.can_edit
    ? report.visibility === "everyone" ? "Yours · shared with everyone" : "Yours · only you"
    : `Shared by ${report.owner_name ?? "a colleague"}`;
  const hasChart = config.format !== "tabular" && config.chart.type !== "none" && config.chart.type !== "metric";

  return (
    <PageShell
      title={report.name}
      description={report.description ?? undefined}
      context={`${describeReportScope(config, reportModule)} · ${ownerLine}`}
      actions={(
        <>
          {actions?.can_export ? (
            <>
              <Button type="button" variant="outline" onClick={() => void exportCsv()} disabled={exporting}><FileDown />{exporting ? "Preparing…" : "Export CSV"}</Button>
              <Button type="button" variant="outline" onClick={() => void exportXlsx()} disabled={exporting}><FileDown />{exporting ? "Preparing…" : "Export Excel"}</Button>
              {config.format === "tabular" ? <Button type="button" variant="outline" onClick={() => void exportFullXlsx()} disabled={exporting || exportJob.status === "queued" || exportJob.status === "running"}><FileDown />{exportJob.status === "queued" || exportJob.status === "running" ? "Preparing full export…" : "Export up to 100,000"}</Button> : null}
              {hasChart ? <Button type="button" variant="outline" onClick={exportChart}><Download />Export chart</Button> : null}
            </>
          ) : null}
          <Button type="button" variant="outline" onClick={() => setSubscriptionOpen(true)}><Mail />Schedule email</Button>
          {report.can_edit && actions?.can_edit ? (
            <>
              <Button type="button" variant="outline" onClick={() => setDetailsOpen(true)}><Settings2 />Details</Button>
              <Button asChild><Link href={`${DASHBOARD_ROUTES.reports}/${report.id}/edit`}><Pencil />Edit</Link></Button>
            </>
          ) : actions?.can_create ? (
            <Button asChild variant="outline"><Link href={`${DASHBOARD_ROUTES.reports}/${report.id}/edit`}><Copy />Save a copy</Link></Button>
          ) : null}
          {report.can_edit && actions?.can_delete ? (
            <Button type="button" variant="ghost" onClick={() => void remove()} disabled={deleteMutation.isPending} aria-label={`Delete ${report.name}`}><Trash2 />Delete</Button>
          ) : null}
        </>
      )}
    >
      <ReportView ref={chartRef} module={reportModule} config={config} />
      {exportJob.error ? <p role="alert" className="text-p-sm text-state-danger">{exportJob.error}</p> : null}
      <ReportSubscriptionDialog open={subscriptionOpen} onClose={() => setSubscriptionOpen(false)} targetType="report" targetId={reportId} />
      <SaveReportDialog
        open={detailsOpen}
        title="Report details"
        initialName={report.name}
        initialDescription={report.description ?? ""}
        initialVisibility={report.visibility}
        submitLabel="Save details"
        isPending={detailsMutation.isPending}
        onClose={() => setDetailsOpen(false)}
        onSave={(details, onError) => detailsMutation.mutate(details, { onError })}
      />
    </PageShell>
  );
}
