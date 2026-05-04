"use client";

import { useEffect, useRef, useState } from "react";
import { MenuItem } from "@headlessui/react";
import { Download } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  type ExportMode,
  getErrorMessage,
  getFilenameFromDisposition,
} from "@/components/ui/importExportUtils";
import { useJobPoller } from "@/hooks/useJobPoller";
import { apiFetch } from "@/lib/api";

type Props = {
  exportEndpoint: string;
  exportMethod: "GET" | "POST";
  exportBody?: unknown;
  exportLabel: string;
  selectedIds: number[];
  currentPageIds: number[];
  disabled?: boolean;
  onExportSuccess?: () => void;
};

export function ExportControls({
  exportEndpoint,
  exportMethod,
  exportBody,
  exportLabel,
  selectedIds,
  currentPageIds,
  disabled,
  onExportSuccess,
}: Props) {
  const downloadedExportJobRef = useRef<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("all");
  const [exportJobId, setExportJobId] = useState<number | null>(null);
  const [exportSummary, setExportSummary] = useState<Record<string, unknown> | null>(null);
  const exportJob = useJobPoller<Record<string, unknown>>(
    exportJobId,
    (job) => {
      setExportSummary(job.summary ?? null);
      onExportSuccess?.();
    },
    { failureMessage: "Background export failed." },
  );

  function resetExportState() {
    setIsExportDialogOpen(false);
    setIsExporting(false);
    setExportMode("all");
    setExportJobId(null);
    setExportSummary(null);
    exportJob.reset();
    downloadedExportJobRef.current = null;
  }

  async function downloadExportJobResult(jobId: number) {
    const res = await apiFetch(`/jobs/data-transfer/${jobId}/download`);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(getErrorMessage(body, `Export download failed with ${res.status}`));
    }
    const blob = await res.blob();
    const filename = getFilenameFromDisposition(res.headers.get("Content-Disposition"), "export.csv");
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (!exportJobId || exportJob.status !== "completed") return;
    if (downloadedExportJobRef.current === exportJobId) return;

    downloadedExportJobRef.current = exportJobId;
    void downloadExportJobResult(exportJobId).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to download export.");
    });
  }, [exportJobId, exportJob.status]);

  async function handleExportSubmit() {
    if (exportMode === "selected" && !selectedIds.length) {
      toast.error("Select at least one record before exporting selected rows.");
      return;
    }
    if (exportMode === "current" && !currentPageIds.length) {
      toast.error("There are no rows on the current page to export.");
      return;
    }

    setIsExporting(true);
    try {
      const res = await apiFetch(exportEndpoint, {
        method: exportMethod,
        headers: exportMethod === "POST" ? { "Content-Type": "application/json" } : undefined,
        body:
          exportMethod === "POST"
            ? JSON.stringify({
                ...(typeof exportBody === "object" && exportBody !== null ? exportBody : {}),
                mode: exportMode,
                selected_ids: exportMode === "selected" ? selectedIds : undefined,
                current_page_ids: exportMode === "current" ? currentPageIds : undefined,
              })
            : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(getErrorMessage(body, `Export failed with ${res.status}`));
      }
      const body = (await res.json().catch(() => null)) as { job_id?: number | null; job_status?: string | null; message?: string } | null;
      if (body?.job_id) {
        setExportJobId(body.job_id);
        setExportSummary(null);
        exportJob.start(body.job_status || "queued", "Export queued.");
        toast.success(body.message || `Export queued as job #${body.job_id}.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <>
      <MenuItem>
        {({ focus }) => (
          <button
            type="button"
            disabled={disabled || isExporting}
            onClick={() => setIsExportDialogOpen(true)}
            className={
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-200 transition-colors " +
              (focus ? "bg-neutral-800 text-neutral-100" : "")
            }
          >
            <Download className="h-4 w-4" />
            {isExporting ? "Exporting..." : exportLabel}
          </button>
        )}
      </MenuItem>

      <Dialog open={isExportDialogOpen} onClose={resetExportState}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <DialogPanel size="xl">
            <DialogHeader className="mb-4">
              <div>
                <DialogTitle className="text-lg text-neutral-100">Export Records</DialogTitle>
                <DialogDescription className="mt-1 text-neutral-400">
                  Choose which records to export. Exports run as background jobs and download automatically when ready.
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="space-y-5">
              {exportJobId ? (
                <ExportJobProgress
                  jobId={exportJobId}
                  status={exportJob.status}
                  progress={exportJob.progress}
                  message={exportJob.message}
                  error={exportJob.error}
                  summary={exportSummary}
                />
              ) : (
                <ExportModePicker
                  exportMode={exportMode}
                  setExportMode={setExportMode}
                  selectedIds={selectedIds}
                  currentPageIds={currentPageIds}
                />
              )}
            </div>

            <DialogFooter className="mt-6">
              {exportJobId ? (
                <>
                  {exportJob.status === "completed" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (exportJobId) {
                          void downloadExportJobResult(exportJobId).catch((error) => {
                            toast.error(error instanceof Error ? error.message : "Failed to download export.");
                          });
                        }
                      }}
                    >
                      Download Again
                    </Button>
                  ) : null}
                  <Button type="button" onClick={resetExportState}>
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={resetExportState} disabled={isExporting}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleExportSubmit()}
                    disabled={isExporting || (exportMode === "selected" && !selectedIds.length)}
                  >
                    {isExporting ? "Queueing..." : "Run Export"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}

function ExportModePicker({
  exportMode,
  setExportMode,
  selectedIds,
  currentPageIds,
}: {
  exportMode: ExportMode;
  setExportMode: (mode: ExportMode) => void;
  selectedIds: number[];
  currentPageIds: number[];
}) {
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <ExportModeButton
          active={exportMode === "all"}
          title="All records"
          description="Export all records that match the active filters in this view."
          onClick={() => setExportMode("all")}
        />
        <ExportModeButton
          active={exportMode === "current"}
          title="Current page"
          description={`${currentPageIds.length} row(s) currently visible.`}
          onClick={() => setExportMode("current")}
        />
        <ExportModeButton
          active={exportMode === "selected"}
          title="Selected rows"
          description={`${selectedIds.length} row(s) selected across pages.`}
          onClick={() => setExportMode("selected")}
        />
      </div>
      {exportMode === "selected" && !selectedIds.length ? (
        <div className="rounded-md border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
          No rows are selected yet. Use the table checkboxes to select records across pages first.
        </div>
      ) : null}
    </>
  );
}

function ExportModeButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-md border px-4 py-3 text-left transition-colors " +
        (active
          ? "border-neutral-600 bg-neutral-900 text-neutral-100"
          : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200")
      }
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="mt-1 text-xs text-inherit/80">{description}</div>
    </button>
  );
}

function ExportJobProgress({
  jobId,
  status,
  progress,
  message,
  error,
  summary,
}: {
  jobId: number;
  status: string | null;
  progress: number;
  message: string | null;
  error: string | null;
  summary: Record<string, unknown> | null;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-4">
        <div className="text-sm font-medium text-neutral-100">Background Export Job #{jobId}</div>
        <div className="mt-1 text-sm text-neutral-400">
          {status === "completed"
            ? "Export finished. Your download should start automatically."
            : status === "failed"
              ? "Export failed."
              : "Export is running in the background."}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-900">
          <div className="h-full rounded-full bg-white transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
          <span>{message || "Waiting for progress..."}</span>
          <span>{progress}%</span>
        </div>
        <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">Status</div>
        <div className="mt-1 text-lg font-semibold text-neutral-100">{status || "queued"}</div>
      </div>
      {summary ? (
        <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300">
          {typeof summary.file_name === "string" ? (
            <div>
              Generated file: <span className="font-medium text-neutral-100">{summary.file_name}</span>
            </div>
          ) : null}
          {typeof summary.mode === "string" ? (
            <div className="mt-1">
              Mode: <span className="font-medium text-neutral-100">{summary.mode}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-100">{error}</div> : null}
    </div>
  );
}
