"use client";

import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { MenuItem } from "@headlessui/react";
import { Upload } from "lucide-react";
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
import {
  type DuplicateMode,
  type ImportExecutionResponse,
  type ImportPreviewResponse,
  type ImportSummaryResponse,
  getErrorMessage,
} from "@/components/ui/importExportUtils";
import { useJobPoller, type DataTransferJobResponse } from "@/hooks/useJobPoller";
import { apiFetch } from "@/lib/api";

type Props = {
  importEndpoint: string;
  importLabel: string;
  fileAccept: string;
  disabled?: boolean;
  onImportSuccess?: () => void;
};

export function ImportControls({ importEndpoint, importLabel, fileAccept, disabled, onImportSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>("skip");
  const [importSummary, setImportSummary] = useState<ImportSummaryResponse | null>(null);
  const [importJobId, setImportJobId] = useState<number | null>(null);
  const importJob = useJobPoller<ImportSummaryResponse>(
    importJobId,
    (job: DataTransferJobResponse<ImportSummaryResponse>) => {
      if (job.summary) {
        setImportSummary(job.summary);
      }
      onImportSuccess?.();
    },
    { failureMessage: "Background import failed." },
  );

  const previewEndpoint = `${importEndpoint}/preview`;
  const missingRequiredTargets = useMemo(() => {
    if (!preview) return [];
    return preview.required_headers.filter((target) => !mapping[target]);
  }, [mapping, preview]);

  async function loadPreview(file: File) {
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
    importJob.reset();
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleImportSubmit() {
    if (!selectedFile) return;
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
        importJob.start(body.job_status || "queued", "Import queued.");
        setImportSummary(null);
        toast.success(body.message || `Import queued as job #${body.job_id}.`);
        return;
      }
      const summary = body?.summary as ImportSummaryResponse | undefined;
      if (summary) {
        setImportSummary(summary);
        setImportJobId(null);
        importJob.reset();
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
    <>
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

      <MenuItem>
        {({ focus }) => (
          <button
            type="button"
            disabled={disabled || isImporting}
            onClick={() => inputRef.current?.click()}
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

      <Dialog open={isImportDialogOpen} onClose={resetImportState}>
        <DialogBackdrop />
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <DialogPanel size="3xl">
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
                <ImportSummary summary={importSummary} />
              ) : importJobId ? (
                <ImportJobProgress
                  jobId={importJobId}
                  status={importJob.status}
                  progress={importJob.progress}
                  message={importJob.message}
                  error={importJob.error}
                />
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

                  {preview ? <ImportMapping preview={preview} mapping={mapping} onMappingChange={setMapping} /> : null}
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
    </>
  );
}

function ImportSummary({ summary }: { summary: ImportSummaryResponse }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryCard label="Total rows" value={summary.total_rows} />
        <SummaryCard label="Imported" value={summary.imported_rows} valueClassName="text-emerald-300" />
        <SummaryCard label="Failed" value={summary.failed_rows} valueClassName="text-red-300" />
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <SummaryCard label="New" value={summary.new_rows} size="sm" />
        <SummaryCard label="Overwritten" value={summary.overwritten_rows} size="sm" />
        <SummaryCard label="Merged" value={summary.merged_rows} size="sm" />
        <SummaryCard label="Skipped" value={summary.skipped_rows} size="sm" />
      </div>
      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3 text-sm text-neutral-300">
        {summary.message}
      </div>
      <div>
        <h3 className="text-sm font-medium text-neutral-100">Failed rows</h3>
        <div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {summary.failures.length ? (
            summary.failures.map((failure, index) => (
              <div
                key={`${failure.row_number ?? "row"}-${index}`}
                className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-100"
              >
                <div className="font-medium">
                  Row {failure.row_number ?? "?"}
                  {failure.record_identifier ? ` - ${failure.record_identifier}` : ""}
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
  );
}

function SummaryCard({
  label,
  value,
  size = "lg",
  valueClassName = "text-neutral-100",
}: {
  label: string;
  value: number;
  size?: "lg" | "sm";
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`mt-1 font-semibold ${size === "lg" ? "text-2xl" : "text-lg"} ${valueClassName}`}>{value}</div>
    </div>
  );
}

function ImportJobProgress({
  jobId,
  status,
  progress,
  message,
  error,
}: {
  jobId: number;
  status: string | null;
  progress: number;
  message: string | null;
  error: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-neutral-800 bg-neutral-950 px-4 py-4">
        <div className="text-sm font-medium text-neutral-100">Background Import Job #{jobId}</div>
        <div className="mt-1 text-sm text-neutral-400">
          {status === "completed" ? "Import finished." : status === "failed" ? "Import failed." : "Import is running in the background."}
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
      {error ? <div className="rounded-md border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-100">{error}</div> : null}
    </div>
  );
}

function ImportMapping({
  preview,
  mapping,
  onMappingChange,
}: {
  preview: ImportPreviewResponse;
  mapping: Record<string, string | null>;
  onMappingChange: Dispatch<SetStateAction<Record<string, string | null>>>;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium text-neutral-100">Header mapping</h3>
        <p className="mt-1 text-xs text-neutral-400">Auto-matched fields are preselected. Adjust any mapping before importing.</p>
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
                  onMappingChange((current) => ({
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
  );
}
