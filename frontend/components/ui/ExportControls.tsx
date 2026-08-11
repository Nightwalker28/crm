"use client";

import { useEffect, useRef, useState } from "react";
import { MenuItem } from "@headlessui/react";
import { Download, FileDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { DataTransferJobProgress } from "@/components/ui/DataTransferJobProgress";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { type ExportMode, getFilenameFromDisposition } from "@/components/ui/importExportUtils";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useJobPoller } from "@/hooks/useJobPoller";
import { apiFetch } from "@/lib/api";
import { downloadBlob } from "@/lib/browser";

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

type ExportExecutionResponse = {
  job_id?: number | null;
  job_status?: string | null;
};

async function downloadResponse(response: Response, fallbackFilename = "export.csv") {
  const blob = await response.blob();
  const filename = getFilenameFromDisposition(response.headers.get("Content-Disposition"), fallbackFilename);
  downloadBlob(blob, filename);
}

async function downloadExportJobResult(jobId: number) {
  const response = await apiFetch(`/jobs/data-transfer/${jobId}/download`);
  if (!response.ok) throw new Error("The export file could not be downloaded.");
  await downloadResponse(response);
}

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
  const [exportError, setExportError] = useState<string | null>(null);
  const supportsScopedExport = exportMethod === "POST";
  const exportJob = useJobPoller<Record<string, unknown>>(
    exportJobId,
    (job) => {
      setExportSummary(job.summary ?? null);
      onExportSuccess?.();
    },
    { failureMessage: "The background export could not be completed." },
  );

  function resetExportState() {
    setIsExportDialogOpen(false);
    setIsExporting(false);
    setExportMode("all");
    setExportJobId(null);
    setExportSummary(null);
    setExportError(null);
    exportJob.reset();
    downloadedExportJobRef.current = null;
  }

  async function handleDownload(jobId: number) {
    try {
      setExportError(null);
      await downloadExportJobResult(jobId);
    } catch {
      setExportError("The export file could not be downloaded. It may have expired; run the export again.");
    }
  }

  useEffect(() => {
    if (!exportJobId || exportJob.status !== "completed") return;
    if (downloadedExportJobRef.current === exportJobId) return;

    downloadedExportJobRef.current = exportJobId;
    void handleDownload(exportJobId);
  }, [exportJobId, exportJob.status]);

  async function handleExportSubmit() {
    if (supportsScopedExport && exportMode === "selected" && !selectedIds.length) {
      setExportError("Select at least one record before exporting selected rows.");
      return;
    }
    if (supportsScopedExport && exportMode === "current" && !currentPageIds.length) {
      setExportError("There are no rows on the current page to export.");
      return;
    }

    setIsExporting(true);
    setExportError(null);
    try {
      const response = await apiFetch(exportEndpoint, {
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
      if (!response.ok) throw new Error("The export could not be started.");

      const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
      const contentDisposition = response.headers.get("Content-Disposition");
      if (contentDisposition || !contentType.includes("application/json")) {
        await downloadResponse(response);
        toast.success("Export downloaded.");
        onExportSuccess?.();
        resetExportState();
        return;
      }

      const body = (await response.json().catch(() => null)) as ExportExecutionResponse | null;
      if (!body?.job_id) throw new Error("The export could not be started.");

      setExportJobId(body.job_id);
      setExportSummary(null);
      exportJob.start(body.job_status || "queued", "Export queued.");
      toast.success("Export queued. The download will start automatically when it is ready.");
    } catch {
      setExportError("The export could not be started. Check your access and try again.");
    } finally {
      setIsExporting(false);
    }
  }

  const modeInvalid =
    supportsScopedExport &&
    ((exportMode === "selected" && !selectedIds.length) || (exportMode === "current" && !currentPageIds.length));

  return (
    <>
      <MenuItem>
        {({ focus }) => (
          <button
            type="button"
            disabled={disabled || isExporting}
            onClick={() => setIsExportDialogOpen(true)}
            className={`flex w-full items-center gap-2 rounded-[var(--radius-control-sm)] px-3 py-2 text-sm text-copy-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:pointer-events-none disabled:text-copy-disabled ${
              focus ? "bg-action-primary-muted text-copy-primary" : ""
            }`}
          >
            <Download aria-hidden="true" />
            {isExporting ? "Preparing export..." : exportLabel}
          </button>
        )}
      </MenuItem>

      <Dialog open={isExportDialogOpen} onClose={() => { if (!isExporting) resetExportState(); }}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <DialogPanel size="xl">
            <DialogHeader className="mb-4">
              <div>
                <DialogTitle className="text-lg text-copy-primary">
                  {exportJobId ? "Export progress" : "Export records"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-copy-secondary">
                  {exportJobId
                    ? "The tenant-scoped export continues in the background. Its file downloads automatically when ready."
                    : supportsScopedExport
                      ? "Choose which records to export using the current view and selection."
                      : "This module exports all records available to you as a CSV file."}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="space-y-5">
              {exportError ? (
                <div role="alert" className="rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                  {exportError}
                </div>
              ) : null}

              {exportJobId ? (
                <DataTransferJobProgress
                  operation="export"
                  jobId={exportJobId}
                  status={exportJob.status}
                  progress={exportJob.progress}
                  message={exportJob.message}
                  hasError={Boolean(exportJob.error)}
                  completedDescription="Export finished. Your download should start automatically."
                  failureMessage="The background export could not be completed. Run the export again."
                >
                  {exportSummary ? <ExportSummary summary={exportSummary} /> : null}
                </DataTransferJobProgress>
              ) : supportsScopedExport ? (
                <ExportModePicker
                  exportMode={exportMode}
                  setExportMode={(mode) => {
                    setExportError(null);
                    setExportMode(mode);
                  }}
                  selectedIds={selectedIds}
                  currentPageIds={currentPageIds}
                />
              ) : (
                <Card variant="muted" className="flex items-start gap-3 px-4 py-4">
                  <FileDown className="mt-0.5 size-5 shrink-0 text-copy-muted" aria-hidden="true" />
                  <div>
                    <div className="text-sm font-medium text-copy-primary">All accessible records</div>
                    <div className="mt-1 text-p-sm text-copy-secondary">
                      The download respects the module and tenant access enforced by the server.
                    </div>
                  </div>
                </Card>
              )}
            </div>

            <DialogFooter className="mt-6">
              {exportJobId ? (
                <>
                  {exportJob.status === "completed" ? (
                    <Button type="button" variant="outline" onClick={() => void handleDownload(exportJobId)}>
                      <Download />
                      Download again
                    </Button>
                  ) : null}
                  <Button type="button" onClick={resetExportState}>
                    Close
                  </Button>
                </>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={resetExportState} disabled={isExporting}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void handleExportSubmit()} disabled={isExporting || modeInvalid}>
                    <Download />
                    {isExporting ? "Preparing..." : supportsScopedExport ? "Run export" : "Download CSV"}
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
    <RadioGroup
      value={exportMode}
      onValueChange={(value) => setExportMode(value as ExportMode)}
      className="grid gap-3 md:grid-cols-3"
      aria-label="Export scope"
    >
      <ExportModeOption
        value="all"
        active={exportMode === "all"}
        title="All matching records"
        description="Export records matching the active filters in this view."
      />
      <ExportModeOption
        value="current"
        active={exportMode === "current"}
        title="Current page"
        description={`${currentPageIds.length} row(s) currently visible.`}
      />
      <ExportModeOption
        value="selected"
        active={exportMode === "selected"}
        title="Selected rows"
        description={`${selectedIds.length} row(s) selected across pages.`}
      />
    </RadioGroup>
  );
}

function ExportModeOption({
  value,
  active,
  title,
  description,
}: {
  value: ExportMode;
  active: boolean;
  title: string;
  description: string;
}) {
  return (
    <RadioGroupItem
      value={value}
      className={`rounded-[var(--radius-card)] border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
        active
          ? "border-primary bg-action-primary-muted text-copy-primary"
          : "border-line-default bg-surface-muted text-copy-secondary hover:border-line-strong hover:bg-surface"
      }`}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="mt-1 block text-p-xs text-copy-muted">{description}</span>
    </RadioGroupItem>
  );
}

function ExportSummary({ summary }: { summary: Record<string, unknown> }) {
  const fileName = typeof summary.file_name === "string" ? summary.file_name : null;
  const mode = typeof summary.mode === "string" ? summary.mode : null;
  if (!fileName && !mode) return null;

  return (
    <Card variant="status" className="px-4 py-3 text-sm text-copy-secondary">
      {fileName ? (
        <div>
          Generated file: <span className="font-medium text-copy-primary">{fileName}</span>
        </div>
      ) : null}
      {mode ? (
        <div className={fileName ? "mt-1" : ""}>
          Scope: <span className="font-medium text-copy-primary">{mode.replaceAll("_", " ")}</span>
        </div>
      ) : null}
    </Card>
  );
}
