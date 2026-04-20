"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { ChevronDown, Download, Upload } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiFetch } from "@/lib/api";

type DuplicateMode = "skip" | "overwrite" | "merge";
type ExportMode = "all" | "current" | "selected";

type ImportPreviewResponse = {
  source_headers: string[];
  target_headers: string[];
  required_headers: string[];
  default_duplicate_mode?: DuplicateMode;
  suggested_mapping: Record<string, string | null>;
};

type ImportFailure = {
  row_number?: number | null;
  record_identifier?: string | null;
  reason: string;
};

type ImportSummaryResponse = {
  message: string;
  total_rows: number;
  processed_rows: number;
  imported_rows: number;
  new_rows: number;
  skipped_rows: number;
  overwritten_rows: number;
  merged_rows: number;
  failed_rows: number;
  failures: ImportFailure[];
};

type ImportExecutionResponse = {
  mode: "inline" | "background";
  message: string;
  summary?: ImportSummaryResponse | null;
  job_id?: number | null;
  job_status?: string | null;
};

type DataTransferJobResponse = {
  id: number;
  status: string;
  summary?: ImportSummaryResponse | Record<string, unknown> | null;
  result_file_name?: string | null;
  error_message?: string | null;
  progress_percent?: number;
  progress_message?: string | null;
};

type Props = {
  importEndpoint?: string;
  exportEndpoint?: string;
  exportMethod?: "GET" | "POST";
  exportBody?: unknown;
  importLabel?: string;
  exportLabel?: string;
  fileAccept?: string;
  onImportSuccess?: () => void;
  onImportClick?: () => void;
  selectedIds?: number[];
  currentPageIds?: number[];
  onExportSuccess?: () => void;
};

function getFilenameFromDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const match = header.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const detail = "detail" in body ? body.detail : undefined;
    const message = "message" in body ? body.message : undefined;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") {
      return detail.message;
    }
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

export function ModuleImportExportControls({
  importEndpoint,
  exportEndpoint,
  exportMethod = "GET",
  exportBody,
  importLabel = "Import",
  exportLabel = "Export",
  fileAccept = ".csv",
  onImportSuccess,
  onImportClick,
  selectedIds = [],
  currentPageIds = [],
  onExportSuccess,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const downloadedExportJobRef = useRef<number | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("skip");
  const [importSummary, setImportSummary] = useState<ImportSummaryResponse | null>(null);
  const [importJobId, setImportJobId] = useState<number | null>(null);
  const [importJobStatus, setImportJobStatus] = useState<string | null>(null);
  const [importJobError, setImportJobError] = useState<string | null>(null);
  const [importJobProgress, setImportJobProgress] = useState(0);
  const [importJobMessage, setImportJobMessage] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<ExportMode>("all");
  const [exportJobId, setExportJobId] = useState<number | null>(null);
  const [exportJobStatus, setExportJobStatus] = useState<string | null>(null);
  const [exportJobError, setExportJobError] = useState<string | null>(null);
  const [exportSummary, setExportSummary] = useState<Record<string, unknown> | null>(null);
  const [exportJobProgress, setExportJobProgress] = useState(0);
  const [exportJobMessage, setExportJobMessage] = useState<string | null>(null);

  const previewEndpoint = importEndpoint ? `${importEndpoint}/preview` : null;

  const missingRequiredTargets = useMemo(() => {
    if (!preview) return [];
    return preview.required_headers.filter((target) => !mapping[target]);
  }, [mapping, preview]);

  async function loadPreview(file: File) {
    if (!previewEndpoint) return;
    const formData = new FormData();
    formData.append("file", file);
    const res = await apiFetch(previewEndpoint, {
      method: "POST",
      body: formData,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(getErrorMessage(body, `Preview failed with ${res.status}`));
    }
    const nextPreview = body as ImportPreviewResponse;
    setPreview(nextPreview);
    setMapping(nextPreview.suggested_mapping ?? {});
    setDuplicateMode(nextPreview.default_duplicate_mode ?? "skip");
    setImportSummary(null);
  }

  function resetImportState() {
    setIsImportDialogOpen(false);
    setSelectedFile(null);
    setPreview(null);
    setMapping({});
    setImportSummary(null);
    setImportJobId(null);
    setImportJobStatus(null);
    setImportJobError(null);
    setImportJobProgress(0);
    setImportJobMessage(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function resetExportState() {
    setIsExportDialogOpen(false);
    setIsExporting(false);
    setExportMode("all");
    setExportJobId(null);
    setExportJobStatus(null);
    setExportJobError(null);
    setExportSummary(null);
    setExportJobProgress(0);
    setExportJobMessage(null);
    downloadedExportJobRef.current = null;
  }

  useEffect(() => {
    if (!importJobId) return;
    if (!importJobStatus || !["queued", "running"].includes(importJobStatus)) return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const res = await apiFetch(`/jobs/data-transfer/${importJobId}`);
        const body = (await res.json().catch(() => null)) as DataTransferJobResponse | null;
        if (!res.ok || !body || cancelled) return;
        setImportJobStatus(body.status);
        setImportJobProgress(body.progress_percent ?? 0);
        setImportJobMessage(body.progress_message ?? null);
        if (body.status === "completed" && body.summary) {
          setImportSummary(body.summary as ImportSummaryResponse);
          setImportJobError(null);
          onImportSuccess?.();
        } else if (body.status === "failed") {
          setImportJobError(body.error_message || "Background import failed.");
        }
      } catch {
        // keep polling quietly
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [importJobId, importJobStatus, onImportSuccess]);

  useEffect(() => {
    if (!exportJobId) return;
    if (!exportJobStatus || !["queued", "running"].includes(exportJobStatus)) return;

    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const res = await apiFetch(`/jobs/data-transfer/${exportJobId}`);
        const body = (await res.json().catch(() => null)) as DataTransferJobResponse | null;
        if (!res.ok || !body || cancelled) return;
        setExportJobStatus(body.status);
        setExportJobProgress(body.progress_percent ?? 0);
        setExportJobMessage(body.progress_message ?? null);
        if (body.status === "completed") {
          setExportSummary(body.summary ?? null);
          setExportJobError(null);
          onExportSuccess?.();
        } else if (body.status === "failed") {
          setExportJobError(body.error_message || "Background export failed.");
        }
      } catch {
        // keep polling quietly
      }
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [exportJobId, exportJobStatus, onExportSuccess]);

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
    if (!exportJobId || exportJobStatus !== "completed") return;
    if (downloadedExportJobRef.current === exportJobId) return;

    downloadedExportJobRef.current = exportJobId;
    void downloadExportJobResult(exportJobId).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Failed to download export.");
    });
  }, [exportJobId, exportJobStatus]);

  async function handleExportSubmit() {
    if (!exportEndpoint) return;
    if (exportMode === "selected" && !selectedIds.length) {
      toast.error("Select at least one record before exporting selected rows.");
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
        setExportJobStatus(body.job_status || "queued");
        setExportJobError(null);
        setExportSummary(null);
        setExportJobProgress(0);
        setExportJobMessage("Export queued.");
        toast.success(body.message || `Export queued as job #${body.job_id}.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleImportSubmit() {
    if (!importEndpoint || !selectedFile) return;
    if (missingRequiredTargets.length) {
      toast.error(`Map all required fields before importing: ${missingRequiredTargets.join(", ")}`);
      return;
    }
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("mapping_json", JSON.stringify(mapping));
      const params = new URLSearchParams({ duplicate_mode: duplicateMode });
      const res = await apiFetch(`${importEndpoint}?${params.toString()}`, {
        method: "POST",
        body: formData,
      });
      const body = (await res.json().catch(() => null)) as ImportExecutionResponse | null;
      if (!res.ok) {
        throw new Error(getErrorMessage(body, `Import failed with ${res.status}`));
      }
      if (body?.mode === "background" && body.job_id) {
        setImportJobId(body.job_id);
        setImportJobStatus(body.job_status || "queued");
        setImportJobError(null);
        setImportSummary(null);
        setImportJobProgress(0);
        setImportJobMessage("Import queued.");
        toast.success(body.message || `Import queued as job #${body.job_id}.`);
        return;
      }
      const summary = body?.summary as ImportSummaryResponse | undefined;
      if (summary) {
        setImportSummary(summary);
        setImportJobId(null);
        setImportJobStatus(null);
        setImportJobError(null);
        toast.success(body?.message || summary.message || "Import completed.");
        onImportSuccess?.();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      {importEndpoint || onImportClick ? (
        <input
          ref={inputRef}
          type="file"
          accept={fileAccept}
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              setSelectedFile(file);
              await loadPreview(file);
              setIsImportDialogOpen(true);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed to preview import.");
            }
          }}
        />
      ) : null}

      {importEndpoint || exportEndpoint || onImportClick ? (
        <Menu as="div" className="relative">
          <MenuButton
            as={Button}
            type="button"
            variant="outline"
            className="border-neutral-800 bg-neutral-950/70 text-neutral-200 hover:bg-neutral-900 hover:text-neutral-100"
            disabled={isImporting || isExporting}
          >
            Actions
            <ChevronDown className="h-4 w-4" />
          </MenuButton>
          <MenuItems
            anchor="bottom end"
            className="z-50 mt-2 w-44 rounded-lg border border-neutral-800 bg-[#0d0d0d] p-1 shadow-2xl outline-none"
          >
            {importEndpoint || onImportClick ? (
              <MenuItem>
                {({ focus }) => (
                  <button
                    type="button"
                    onClick={() => {
                      if (onImportClick) {
                        onImportClick();
                        return;
                      }
                      inputRef.current?.click();
                    }}
                    className={
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-neutral-200 transition-colors " +
                      (focus ? "bg-neutral-800 text-neutral-100" : "")
                    }
                  >
                    <Upload className="h-4 w-4" />
                    {isImporting ? "Importing..." : importLabel}
                  </button>
                )}
              </MenuItem>
            ) : null}
            {exportEndpoint ? (
              <MenuItem>
                {({ focus }) => (
                  <button
                    type="button"
                    onClick={() => {
                      setIsExportDialogOpen(true);
                    }}
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
            ) : null}
          </MenuItems>
        </Menu>
      ) : null}

      <Dialog open={isImportDialogOpen} onClose={resetImportState}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-3xl">
            <DialogHeader className="mb-4">
              <div>
                <DialogTitle className="text-lg text-neutral-100">
                  {importSummary ? "Import Summary" : "Import Preview"}
                </DialogTitle>
                <DialogDescription className="mt-1 text-neutral-400">
                  {importSummary
                    ? "Review the result of the import and any row-level failures."
                    : "Review the detected header mapping and choose how duplicate records should be handled."}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="space-y-5">
              {importSummary ? (
                <div className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Total rows</div>
                      <div className="mt-1 text-2xl font-semibold text-neutral-100">{importSummary.total_rows}</div>
                    </div>
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Imported</div>
                      <div className="mt-1 text-2xl font-semibold text-emerald-300">{importSummary.imported_rows}</div>
                    </div>
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Failed</div>
                      <div className="mt-1 text-2xl font-semibold text-red-300">{importSummary.failed_rows}</div>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">New</div>
                      <div className="mt-1 text-lg font-semibold text-neutral-100">{importSummary.new_rows}</div>
                    </div>
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Overwritten</div>
                      <div className="mt-1 text-lg font-semibold text-neutral-100">{importSummary.overwritten_rows}</div>
                    </div>
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Merged</div>
                      <div className="mt-1 text-lg font-semibold text-neutral-100">{importSummary.merged_rows}</div>
                    </div>
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3">
                      <div className="text-xs uppercase tracking-wide text-neutral-500">Skipped</div>
                      <div className="mt-1 text-lg font-semibold text-neutral-100">{importSummary.skipped_rows}</div>
                    </div>
                  </div>
                  <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300">
                    {importSummary.message}
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-neutral-100">Failed rows</h3>
                    <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto pr-1">
                      {importSummary.failures.length ? (
                        importSummary.failures.map((failure, index) => (
                          <div key={`${failure.row_number ?? "row"}-${index}`} className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-100">
                            <div className="font-medium">
                              Row {failure.row_number ?? "?"}
                              {failure.record_identifier ? ` • ${failure.record_identifier}` : ""}
                            </div>
                            <div className="mt-1 text-red-200/90">{failure.reason}</div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-md border border-emerald-900/50 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200">
                          No failed rows.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : importJobId ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-4">
                    <div className="text-sm font-medium text-neutral-100">Background Import Job #{importJobId}</div>
                    <div className="mt-1 text-sm text-neutral-400">
                      {importJobStatus === "completed"
                        ? "Import finished."
                        : importJobStatus === "failed"
                          ? "Import failed."
                          : "Import is running in the background."}
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-900">
                      <div className="h-full rounded-full bg-white transition-all" style={{ width: `${importJobProgress}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                      <span>{importJobMessage || "Waiting for progress..."}</span>
                      <span>{importJobProgress}%</span>
                    </div>
                    <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">Status</div>
                    <div className="mt-1 text-lg font-semibold text-neutral-100">{importJobStatus || "queued"}</div>
                  </div>
                  {importJobError ? (
                    <div className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-100">
                      {importJobError}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {!importSummary ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label className="mb-2 block">File</Label>
                      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
                        {selectedFile?.name || "No file selected"}
                      </div>
                    </div>
                    <div>
                      <Label className="mb-2 block">Duplicate handling</Label>
                      <Select value={duplicateMode} onValueChange={(value) => setDuplicateMode(value as DuplicateMode)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select duplicate mode" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="skip">Skip duplicates</SelectItem>
                          <SelectItem value="overwrite">Overwrite duplicates</SelectItem>
                          <SelectItem value="merge">Merge duplicates</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {preview ? (
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-sm font-medium text-neutral-100">Header mapping</h3>
                        <p className="mt-1 text-xs text-neutral-400">
                          Auto-matched fields are preselected. Adjust any mapping before importing.
                        </p>
                      </div>
                      <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                        {preview.target_headers.map((targetHeader) => {
                          const required = preview.required_headers.includes(targetHeader);
                          return (
                            <div key={targetHeader} className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                              <Label className="text-sm text-neutral-200">
                                {targetHeader}
                                {required ? <span className="ml-1 text-red-400">*</span> : null}
                              </Label>
                              <Select
                                value={mapping[targetHeader] ?? "__none__"}
                                onValueChange={(value) =>
                                  setMapping((current) => ({
                                    ...current,
                                    [targetHeader]: value === "__none__" ? null : value,
                                  }))
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Do not import this field" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Do not import this field</SelectItem>
                                  {preview.source_headers.map((sourceHeader) => (
                                    <SelectItem key={sourceHeader} value={sourceHeader}>
                                      {sourceHeader}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <DialogFooter className="mt-6">
              {importSummary || importJobId ? (
                <Button type="button" onClick={resetImportState}>
                  Done
                </Button>
              ) : (
                <>
                  <Button type="button" variant="outline" onClick={resetImportState} disabled={isImporting}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={() => void handleImportSubmit()} disabled={isImporting || !preview}>
                    {isImporting ? "Importing..." : "Run Import"}
                  </Button>
                </>
              )}
            </DialogFooter>
          </DialogPanel>
        </div>
      </Dialog>

      <Dialog open={isExportDialogOpen} onClose={resetExportState}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <DialogPanel className="w-full max-w-xl">
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
                <div className="space-y-4">
                  <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-4">
                    <div className="text-sm font-medium text-neutral-100">Background Export Job #{exportJobId}</div>
                    <div className="mt-1 text-sm text-neutral-400">
                      {exportJobStatus === "completed"
                        ? "Export finished. Your download should start automatically."
                        : exportJobStatus === "failed"
                          ? "Export failed."
                          : "Export is running in the background."}
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-neutral-900">
                      <div className="h-full rounded-full bg-white transition-all" style={{ width: `${exportJobProgress}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-neutral-500">
                      <span>{exportJobMessage || "Waiting for progress..."}</span>
                      <span>{exportJobProgress}%</span>
                    </div>
                    <div className="mt-3 text-xs uppercase tracking-wide text-neutral-500">Status</div>
                    <div className="mt-1 text-lg font-semibold text-neutral-100">{exportJobStatus || "queued"}</div>
                  </div>
                  {exportSummary ? (
                    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300">
                      {typeof exportSummary.file_name === "string" ? (
                        <div>Generated file: <span className="font-medium text-neutral-100">{exportSummary.file_name}</span></div>
                      ) : null}
                      {typeof exportSummary.mode === "string" ? (
                        <div className="mt-1">Mode: <span className="font-medium text-neutral-100">{exportSummary.mode}</span></div>
                      ) : null}
                    </div>
                  ) : null}
                  {exportJobError ? (
                    <div className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-100">
                      {exportJobError}
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <button
                      type="button"
                      onClick={() => setExportMode("all")}
                      className={
                        "rounded-md border px-4 py-3 text-left transition-colors " +
                        (exportMode === "all"
                          ? "border-neutral-600 bg-neutral-900 text-neutral-100"
                          : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200")
                      }
                    >
                      <div className="text-sm font-medium">All records</div>
                      <div className="mt-1 text-xs text-inherit/80">Export the full active dataset for this module.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportMode("current")}
                      className={
                        "rounded-md border px-4 py-3 text-left transition-colors " +
                        (exportMode === "current"
                          ? "border-neutral-600 bg-neutral-900 text-neutral-100"
                          : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200")
                      }
                    >
                      <div className="text-sm font-medium">Current page</div>
                      <div className="mt-1 text-xs text-inherit/80">{currentPageIds.length} row(s) currently visible.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setExportMode("selected")}
                      className={
                        "rounded-md border px-4 py-3 text-left transition-colors " +
                        (exportMode === "selected"
                          ? "border-neutral-600 bg-neutral-900 text-neutral-100"
                          : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200")
                      }
                    >
                      <div className="text-sm font-medium">Selected rows</div>
                      <div className="mt-1 text-xs text-inherit/80">{selectedIds.length} row(s) selected across pages.</div>
                    </button>
                  </div>
                  {exportMode === "selected" && !selectedIds.length ? (
                    <div className="rounded-md border border-amber-900/50 bg-amber-950/30 px-4 py-3 text-sm text-amber-200">
                      No rows are selected yet. Use the table checkboxes to select records across pages first.
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <DialogFooter className="mt-6">
              {exportJobId ? (
                <>
                  {exportJobStatus === "completed" ? (
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
    </div>
  );
}
